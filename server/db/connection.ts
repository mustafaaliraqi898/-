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
  // Iraqi academic year typically starts in September/October
  if (month >= 9) {
    return `${year}-${year + 1}`;
  }
  return `${year - 1}-${year}`;
}

export function initializeDatabase(db: SqliteDb): void {
  db.pragma('foreign_keys = ON');
  if (!db.memory) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }

  db.exec(SCHEMA_SQL);

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
        `INSERT INTO school_settings (id, school_name, directorate_name, academic_year_id)
         VALUES (1, ?, ?, ?)`
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
