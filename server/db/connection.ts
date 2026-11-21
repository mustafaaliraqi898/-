import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { SCHEMA_SQL } from './schema';

export type SqliteDb = Database.Database;

let defaultDbInstance: SqliteDb | null = null;

function computeDefaultAcademicYearName(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 9) {
    return `${year}-${year + 1}`;
  }
  return `${year - 1}-${year}`;
}

function runSafeMigrations(db: SqliteDb): void {
  // 1. Ensure school_settings has lessons_per_absence_day
  const settingsCols = db.prepare('PRAGMA table_info(school_settings)').all() as Array<{
    name: string;
  }>;
  if (!settingsCols.some((c) => c.name === 'lessons_per_absence_day')) {
    db.exec(
      'ALTER TABLE school_settings ADD COLUMN lessons_per_absence_day INTEGER NOT NULL DEFAULT 5'
    );
  }

  // 2. Migrate legacy absences table if it still has old Phase 1 CHECK constraint
  const absMeta = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'absences'")
    .get() as { sql: string } | undefined;

  if (absMeta && !absMeta.sql.includes('lesson_absence')) {
    db.pragma('foreign_keys = OFF');
    const migrateTx = db.transaction(() => {
      db.exec(`
        CREATE TABLE absences_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
          enrollment_id INTEGER NOT NULL REFERENCES student_enrollments(id) ON DELETE RESTRICT,
          academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
          grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE RESTRICT,
          section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
          absence_date TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('present', 'full_day', 'lesson_absence')),
          lessons_count INTEGER NOT NULL DEFAULT 0 CHECK (lessons_count >= 0),
          threshold_snapshot INTEGER NOT NULL DEFAULT 5 CHECK (threshold_snapshot >= 1),
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(student_id, absence_date)
        );

        INSERT INTO absences_new (
          id, student_id, enrollment_id, academic_year_id, grade_id, section_id,
          absence_date, status, lessons_count, threshold_snapshot, notes, created_at, updated_at
        )
        SELECT
          id, student_id, enrollment_id, academic_year_id, grade_id, section_id,
          absence_date,
          CASE WHEN status = 'late' THEN 'lesson_absence' ELSE 'full_day' END,
          CASE WHEN status = 'late' THEN 1 ELSE 0 END,
          5,
          notes,
          created_at,
          created_at
        FROM absences;

        DROP TABLE absences;
        ALTER TABLE absences_new RENAME TO absences;

        CREATE INDEX IF NOT EXISTS idx_absences_student_date ON absences(student_id, absence_date);
        CREATE INDEX IF NOT EXISTS idx_absences_year_grade_section ON absences(academic_year_id, grade_id, section_id, absence_date);
        CREATE INDEX IF NOT EXISTS idx_absences_student_year_status ON absences(student_id, academic_year_id, status);
      `);
    });
    migrateTx();
    db.pragma('foreign_keys = ON');
  }
}

export function initializeDatabase(db: SqliteDb): void {
  db.pragma('foreign_keys = ON');
  if (!db.memory) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }

  db.exec(SCHEMA_SQL);
  runSafeMigrations(db);

  // Bootstrap default academic year and school settings ONLY (no fake students or classes)
  const bootstrapTx = db.transaction(() => {
    const existingYearsCount = db
      .prepare('SELECT COUNT(*) as count FROM academic_years')
      .get() as { count: number };

    let activeYearId: number | null = null;

    if (existingYearsCount.count === 0) {
      const defaultYearName = computeDefaultAcademicYearName();
      const insertYear = db
        .prepare('INSERT INTO academic_years (name, is_active) VALUES (?, 1)')
        .run(defaultYearName);
      activeYearId = Number(insertYear.lastInsertRowid);
    } else {
      const activeYear = db
        .prepare('SELECT id FROM academic_years WHERE is_active = 1 LIMIT 1')
        .get() as { id: number } | undefined;
      if (activeYear) {
        activeYearId = activeYear.id;
      } else {
        const firstYear = db
          .prepare('SELECT id FROM academic_years ORDER BY id DESC LIMIT 1')
          .get() as { id: number } | undefined;
        if (firstYear) {
          db.prepare('UPDATE academic_years SET is_active = 1 WHERE id = ?').run(firstYear.id);
          activeYearId = firstYear.id;
        }
      }
    }

    const existingSettings = db
      .prepare('SELECT id, academic_year_id FROM school_settings WHERE id = 1')
      .get() as { id: number; academic_year_id: number | null } | undefined;

    if (!existingSettings) {
      db.prepare(
        `INSERT INTO school_settings (id, school_name, directorate_name, academic_year_id, lessons_per_absence_day)
         VALUES (1, ?, ?, ?, 5)`
      ).run('المدرسة النموذجية', 'المديرية العامة للتربية', activeYearId);
    } else if (!existingSettings.academic_year_id && activeYearId) {
      db.prepare('UPDATE school_settings SET academic_year_id = ? WHERE id = 1').run(activeYearId);
    }
  });

  bootstrapTx();
}

export function createDatabaseConnection(dbPath?: string): SqliteDb {
  const resolvedPath =
    dbPath ||
    process.env.SQLITE_DB_PATH ||
    path.resolve(process.cwd(), 'data', 'school_attendance.db');

  if (resolvedPath !== ':memory:') {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(resolvedPath);
  initializeDatabase(db);
  return db;
}

export function getDb(): SqliteDb {
  if (!defaultDbInstance) {
    defaultDbInstance = createDatabaseConnection();
  }
  return defaultDbInstance;
}

export function setDbInstance(db: SqliteDb): void {
  defaultDbInstance = db;
}

export function closeDb(): void {
  if (defaultDbInstance) {
    defaultDbInstance.close();
    defaultDbInstance = null;
  }
}
