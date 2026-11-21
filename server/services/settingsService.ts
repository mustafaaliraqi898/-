import type { AcademicYear, SchoolSettings } from '../../src/types/school';
import type { SqliteDb } from '../db/connection';
import { ServiceError, normalizeWhitespace } from '../utils/validation';

export function getSchoolSettings(db: SqliteDb): SchoolSettings {
  const row = db
    .prepare(
      `SELECT s.id, s.school_name, s.directorate_name, s.academic_year_id,
              s.lessons_per_absence_day, s.daily_lessons_count,
              s.daily_permission_counts_as_absence, s.lesson_permission_counts_as_absence,
              s.updated_at,
              ay.name as academic_year_name
       FROM school_settings s
       LEFT JOIN academic_years ay ON ay.id = s.academic_year_id
       WHERE s.id = 1`
    )
    .get() as SchoolSettings | undefined;

  if (!row) {
    throw new ServiceError('تعذر العثور على إعدادات المدرسة.', 500, 'SETTINGS_MISSING');
  }
  return row;
}

export function updateSchoolSettings(
  db: SqliteDb,
  input: {
    school_name: string;
    directorate_name: string;
    lessons_per_absence_day?: number;
    daily_lessons_count?: number;
    daily_permission_counts_as_absence?: number | boolean;
    lesson_permission_counts_as_absence?: number | boolean;
  }
): SchoolSettings {
  const schoolName = normalizeWhitespace(input.school_name);
  const directorateName = normalizeWhitespace(input.directorate_name);

  if (!schoolName) {
    throw new ServiceError('اسم المدرسة حقل إجباري.');
  }
  if (!directorateName) {
    throw new ServiceError('اسم المديرية حقل إجباري.');
  }

  const current = getSchoolSettings(db);
  let lessonsPerDay = current.lessons_per_absence_day;
  let dailyLessonsCount = current.daily_lessons_count;
  let dailyPermCounts = current.daily_permission_counts_as_absence;
  let lessonPermCounts = current.lesson_permission_counts_as_absence;

  if (input.lessons_per_absence_day !== undefined) {
    const parsed = Number(input.lessons_per_absence_day);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
      throw new ServiceError(
        'عدد الدروس المحتسبة كيوم غياب كامل يجب أن يكون رقماً صحيحاً بين 1 و 20.'
      );
    }
    lessonsPerDay = parsed;
  }

  if (input.daily_lessons_count !== undefined) {
    const parsedDaily = Number(input.daily_lessons_count);
    if (!Number.isInteger(parsedDaily) || parsedDaily < 1 || parsedDaily > 12) {
      throw new ServiceError('عدد الدروس اليومية يجب أن يكون رقماً صحيحاً بين 1 و 12.');
    }
    dailyLessonsCount = parsedDaily;
  }

  if (input.daily_permission_counts_as_absence !== undefined) {
    const raw = input.daily_permission_counts_as_absence;
    if (raw !== 0 && raw !== 1 && raw !== true && raw !== false) {
      throw new ServiceError('قيمة إعداد احتساب الرخصة اليومية غير صالحة.');
    }
    dailyPermCounts = raw === 1 || raw === true ? 1 : 0;
  }

  if (input.lesson_permission_counts_as_absence !== undefined) {
    const raw = input.lesson_permission_counts_as_absence;
    if (raw !== 0 && raw !== 1 && raw !== true && raw !== false) {
      throw new ServiceError('قيمة إعداد احتساب رخصة الدرس غير صالحة.');
    }
    lessonPermCounts = raw === 1 || raw === true ? 1 : 0;
  }

  // Note: Changing lessons_per_absence_day or leave/permission rules applies to new/edited
  // records only and never retroactively recalculates historical records.
  db.prepare(
    `UPDATE school_settings
     SET school_name = ?,
         directorate_name = ?,
         lessons_per_absence_day = ?,
         daily_lessons_count = ?,
         daily_permission_counts_as_absence = ?,
         lesson_permission_counts_as_absence = ?,
         updated_at = datetime('now')
     WHERE id = 1`
  ).run(
    schoolName,
    directorateName,
    lessonsPerDay,
    dailyLessonsCount,
    dailyPermCounts,
    lessonPermCounts
  );

  return getSchoolSettings(db);
}

export function listAcademicYears(db: SqliteDb): AcademicYear[] {
  return db
    .prepare('SELECT id, name, is_active, created_at FROM academic_years ORDER BY name DESC, id DESC')
    .all() as AcademicYear[];
}

export function getActiveAcademicYear(db: SqliteDb): AcademicYear {
  const active = db
    .prepare(
      `SELECT ay.id, ay.name, ay.is_active, ay.created_at
       FROM school_settings s
       JOIN academic_years ay ON ay.id = s.academic_year_id
       WHERE s.id = 1`
    )
    .get() as AcademicYear | undefined;

  if (active) return active;

  const fallback = db
    .prepare('SELECT id, name, is_active, created_at FROM academic_years WHERE is_active = 1 LIMIT 1')
    .get() as AcademicYear | undefined;

  if (!fallback) {
    throw new ServiceError('لا توجد سنة دراسية فعالة في النظام.', 500, 'NO_ACTIVE_YEAR');
  }
  return fallback;
}

export function createAcademicYear(
  db: SqliteDb,
  input: { name: string; set_active?: boolean }
): AcademicYear {
  const name = normalizeWhitespace(input.name);
  if (!name || name.length < 4) {
    throw new ServiceError('يرجى إدخال اسم سنة دراسية صحيح (مثال: 2026-2027).');
  }

  const existing = db.prepare('SELECT id FROM academic_years WHERE name = ?').get(name) as
    | { id: number }
    | undefined;
  if (existing) {
    throw new ServiceError(`السنة الدراسية "${name}" موجودة مسبقاً.`, 409, 'DUPLICATE_YEAR');
  }

  const tx = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO academic_years (name, is_active) VALUES (?, ?)')
      .run(name, input.set_active ? 1 : 0);
    const newId = Number(info.lastInsertRowid);

    if (input.set_active) {
      db.prepare('UPDATE academic_years SET is_active = 0 WHERE id != ?').run(newId);
      db.prepare(
        `UPDATE school_settings SET academic_year_id = ?, updated_at = datetime('now') WHERE id = 1`
      ).run(newId);
    }

    return db
      .prepare('SELECT id, name, is_active, created_at FROM academic_years WHERE id = ?')
      .get(newId) as AcademicYear;
  });

  return tx();
}

export function setActiveAcademicYear(db: SqliteDb, yearId: number): AcademicYear {
  const target = db
    .prepare('SELECT id, name, is_active, created_at FROM academic_years WHERE id = ?')
    .get(yearId) as AcademicYear | undefined;

  if (!target) {
    throw new ServiceError('السنة الدراسية المحددة غير موجودة.', 404, 'YEAR_NOT_FOUND');
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE academic_years SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END').run(
      yearId
    );
    db.prepare(
      `UPDATE school_settings SET academic_year_id = ?, updated_at = datetime('now') WHERE id = 1`
    ).run(yearId);
  });

  tx();

  return db
    .prepare('SELECT id, name, is_active, created_at FROM academic_years WHERE id = ?')
    .get(yearId) as AcademicYear;
}
