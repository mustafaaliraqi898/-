import type { AcademicYear, NumberDisplayMode, SchoolSettings } from '../../src/types/school';
import { UNIFIED_OFFICIAL_LETTER_TEMPLATE } from '../../src/utils/officialDocumentHtml';
import type { SqliteDb } from '../db/connection';
import {
  ServiceError,
  normalizeNullableString,
  normalizeWhitespace,
  validatePhotoDataUrl,
} from '../utils/validation';
import { resolveAssetIdFromImageRef } from './imageService';
import { recordAuditLog } from './auditLogService';

function normalizeEditableLetterTemplate(rawTemplate: string): string {
  const normalized = String(rawTemplate ?? '').replace(/\r\n/g, '\n');
  if (normalized.trim().length === 0) {
    throw new ServiceError('يرجى إدخال النص الرسمي الموحد قبل الحفظ.', 400, 'EMPTY_LETTER_TEMPLATE');
  }
  return normalized;
}

export function getSchoolSettings(db: SqliteDb): SchoolSettings {
  const row = db
    .prepare(
      `SELECT s.id, s.school_name, s.directorate_name, s.principal_name, s.academic_year_id,
              s.lessons_per_absence_day, s.daily_lessons_count,
              s.daily_permission_counts_as_absence, s.lesson_permission_counts_as_absence,
              COALESCE(s.number_display_mode, 'english') as number_display_mode,
              s.unified_letter_template,
              s.school_logo_data, s.school_logo_asset_id, s.updated_at,
              ay.name as academic_year_name
       FROM school_settings s
       LEFT JOIN academic_years ay ON ay.id = s.academic_year_id
       WHERE s.id = 1`
    )
    .get() as SchoolSettings | undefined;

  if (!row) {
    throw new ServiceError('تعذر العثور على إعدادات المدرسة.', 500, 'SETTINGS_MISSING');
  }
  return {
    ...row,
    number_display_mode: row.number_display_mode === 'arabic' ? 'arabic' : 'english',
    unified_letter_template: row.unified_letter_template ?? UNIFIED_OFFICIAL_LETTER_TEMPLATE,
  };
}

export function updateUnifiedLetterTemplate(
  db: SqliteDb,
  template: string
): { unified_letter_template: string } {
  const normalized = normalizeEditableLetterTemplate(template);
  const currentSettings = getSchoolSettings(db);
  const previousTemplate = currentSettings.unified_letter_template ?? UNIFIED_OFFICIAL_LETTER_TEMPLATE;
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE school_settings
       SET unified_letter_template = ?,
           updated_at = datetime('now')
       WHERE id = 1`
    ).run(normalized);
    db.prepare(
      `UPDATE absence_stages
       SET letter_template = ?,
           updated_at = datetime('now')`
    ).run(normalized);
    recordAuditLog(db, {
      operation_type: 'update',
      section: 'letters',
      description: 'تحديث النص الرسمي الموحد للكتب الرسمية',
      target_id: 'unified_letter_template',
      target_label: 'النص الرسمي الموحد',
      old_value: { unified_letter_template: previousTemplate },
      new_value: { unified_letter_template: normalized },
    });
  });
  tx();
  return { unified_letter_template: normalized };
}

export function updateSchoolSettings(
  db: SqliteDb,
  input: {
    school_name: string;
    directorate_name: string;
    principal_name?: string | null;
    lessons_per_absence_day?: number;
    daily_lessons_count?: number;
    daily_permission_counts_as_absence?: number | boolean;
    lesson_permission_counts_as_absence?: number | boolean;
    number_display_mode?: NumberDisplayMode;
    unified_letter_template?: string;
    school_logo_data?: string | null;
    school_logo_asset_id?: number | null;
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
  const principalName =
    input.principal_name !== undefined
      ? normalizeNullableString(input.principal_name)
      : (current.principal_name ?? null);
  let lessonsPerDay = current.lessons_per_absence_day;
  let dailyLessonsCount = current.daily_lessons_count;
  let dailyPermCounts = current.daily_permission_counts_as_absence;
  let lessonPermCounts = current.lesson_permission_counts_as_absence;
  let numberDisplayMode: NumberDisplayMode = current.number_display_mode ?? 'english';
  let unifiedLetterTemplate =
    current.unified_letter_template ?? UNIFIED_OFFICIAL_LETTER_TEMPLATE;
  let schoolLogoData = current.school_logo_data ?? null;
  let schoolLogoAssetId = current.school_logo_asset_id ?? null;

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

  if (input.number_display_mode !== undefined) {
    if (input.number_display_mode !== 'arabic' && input.number_display_mode !== 'english') {
      throw new ServiceError('قيمة إعداد نظام عرض الأرقام غير صالحة.');
    }
    numberDisplayMode = input.number_display_mode;
  }

  if (input.unified_letter_template !== undefined) {
    unifiedLetterTemplate = normalizeEditableLetterTemplate(input.unified_letter_template);
  }

  if (input.school_logo_data !== undefined || input.school_logo_asset_id !== undefined) {
    const normalizedLogo =
      input.school_logo_data !== undefined
        ? validatePhotoDataUrl(normalizeNullableString(input.school_logo_data))
        : null;
    const candidateId =
      input.school_logo_asset_id ?? resolveAssetIdFromImageRef(normalizedLogo);

    if (candidateId) {
      const exists = db.prepare('SELECT id FROM media_assets WHERE id = ?').get(candidateId) as
        | { id: number }
        | undefined;
      if (!exists) {
        throw new ServiceError('ملف الشعار غير موجود في وحدة تخزين الصور.', 400, 'MEDIA_NOT_FOUND');
      }
      schoolLogoAssetId = exists.id;
      schoolLogoData = normalizedLogo ?? `/api/media/${exists.id}/optimized`;
    } else {
      schoolLogoAssetId = null;
      schoolLogoData = normalizedLogo;
    }
  }

  db.prepare(
    `UPDATE school_settings
     SET school_name = ?,
         directorate_name = ?,
         principal_name = ?,
         lessons_per_absence_day = ?,
         daily_lessons_count = ?,
         daily_permission_counts_as_absence = ?,
         lesson_permission_counts_as_absence = ?,
         number_display_mode = ?,
         unified_letter_template = ?,
         school_logo_data = ?,
         school_logo_asset_id = ?,
         updated_at = datetime('now')
     WHERE id = 1`
  ).run(
    schoolName,
    directorateName,
    principalName,
    lessonsPerDay,
    dailyLessonsCount,
    dailyPermCounts,
    lessonPermCounts,
    numberDisplayMode,
    unifiedLetterTemplate,
    schoolLogoData,
    schoolLogoAssetId
  );

  if (input.unified_letter_template !== undefined) {
    db.prepare(
      `UPDATE absence_stages
       SET letter_template = ?,
           updated_at = datetime('now')`
    ).run(unifiedLetterTemplate);
  }

  const updated = getSchoolSettings(db);
  recordAuditLog(db, {
    operation_type: 'update',
    section: 'settings',
    description: `تحديث إعدادات المدرسة (${updated.school_name})`,
    target_id: 1,
    target_label: updated.school_name,
    old_value: {
      school_name: current.school_name,
      directorate_name: current.directorate_name,
      principal_name: current.principal_name ?? null,
      lessons_per_absence_day: current.lessons_per_absence_day,
      daily_lessons_count: current.daily_lessons_count,
      daily_permission_counts_as_absence: current.daily_permission_counts_as_absence,
      lesson_permission_counts_as_absence: current.lesson_permission_counts_as_absence,
      number_display_mode: current.number_display_mode,
      school_logo_asset_id: current.school_logo_asset_id ?? null,
    },
    new_value: {
      school_name: updated.school_name,
      directorate_name: updated.directorate_name,
      principal_name: updated.principal_name ?? null,
      lessons_per_absence_day: updated.lessons_per_absence_day,
      daily_lessons_count: updated.daily_lessons_count,
      daily_permission_counts_as_absence: updated.daily_permission_counts_as_absence,
      lesson_permission_counts_as_absence: updated.lesson_permission_counts_as_absence,
      number_display_mode: updated.number_display_mode,
      school_logo_asset_id: updated.school_logo_asset_id ?? null,
    },
  });
  return updated;
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
      db.prepare(
        'UPDATE legal_year_regulation_bindings SET is_locked = 1 WHERE academic_year_id != ?'
      ).run(newId);
    }

    // Bind new academic year to latest legal regulation versions per stage
    const stages = ['primary', 'intermediate', 'preparatory'] as const;
    for (const stage of stages) {
      const latestVer = db
        .prepare(
          'SELECT id FROM legal_regulation_versions WHERE stage = ? ORDER BY version_number DESC LIMIT 1'
        )
        .get(stage) as { id: number } | undefined;
      if (latestVer) {
        db.prepare(
          `INSERT OR IGNORE INTO legal_year_regulation_bindings (
             academic_year_id, stage, regulation_version_id, is_locked
           ) VALUES (?, ?, ?, 0)`
        ).run(newId, stage, latestVer.id);
      }
    }

    const created = db
      .prepare('SELECT id, name, is_active, created_at FROM academic_years WHERE id = ?')
      .get(newId) as AcademicYear;

    recordAuditLog(db, {
      operation_type: 'create',
      section: 'settings',
      description: `إضافة سنة دراسية جديدة: ${created.name}${created.is_active ? ' (وتفعيلها)' : ''}`,
      target_id: created.id,
      target_label: created.name,
      new_value: created,
    });

    return created;
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

  const previousActive = getActiveAcademicYear(db);

  const tx = db.transaction(() => {
    db.prepare('UPDATE academic_years SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END').run(
      yearId
    );
    db.prepare(
      `UPDATE school_settings SET academic_year_id = ?, updated_at = datetime('now') WHERE id = 1`
    ).run(yearId);
    recordAuditLog(db, {
      operation_type: 'update',
      section: 'settings',
      description: `تغيير السنة الدراسية الفعالة من (${previousActive.name}) إلى (${target.name})`,
      target_id: target.id,
      target_label: target.name,
      old_value: { academic_year_id: previousActive.id, name: previousActive.name },
      new_value: { academic_year_id: target.id, name: target.name },
    });
  });

  tx();

  return db
    .prepare('SELECT id, name, is_active, created_at FROM academic_years WHERE id = ?')
    .get(yearId) as AcademicYear;
}
