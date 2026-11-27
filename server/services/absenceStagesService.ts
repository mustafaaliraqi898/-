import type { SqliteDb } from '../db/connection';
import { ServiceError, normalizeWhitespace } from '../utils/validation';
import { getAcademicYearAbsenceTotalsMap } from './absenceService';
import { getActiveAcademicYear, getSchoolSettings } from './settingsService';
import { recordAuditLog } from './auditLogService';
import {
  UNIFIED_OFFICIAL_LETTER_TEMPLATE,
  resolveOfficialLetterTemplate,
} from '../../src/utils/officialDocumentHtml';
import type {
  AbsenceStage,
  AbsenceReportStudentRow,
  DynamicStageReportResponse,
  DynamicStageStudentRow,
  IssuedOfficialLetter,
} from '../../src/types/school';

export function listAbsenceStages(db: SqliteDb, academicYearId: number): AbsenceStage[] {
  seedDefaultAbsenceStagesIfNeeded(db, academicYearId);
  return db
    .prepare(
      `SELECT id, academic_year_id, name, days_threshold, letter_template, sort_order, created_at, updated_at
       FROM absence_stages
       WHERE academic_year_id = ?
       ORDER BY days_threshold ASC, sort_order ASC, id ASC`
    )
    .all(academicYearId) as AbsenceStage[];
}

export function seedDefaultAbsenceStagesIfNeeded(db: SqliteDb, academicYearId: number): void {
  const countRow = db
    .prepare('SELECT COUNT(*) as cnt FROM absence_stages WHERE academic_year_id = ?')
    .get(academicYearId) as { cnt: number };

  if (countRow.cnt === 0) {
    const savedTemplate =
      getSchoolSettings(db).unified_letter_template ?? UNIFIED_OFFICIAL_LETTER_TEMPLATE;
    const defaults = [
      { name: 'تحذير', days: 10 },
      { name: 'إنذار أولي', days: 20 },
      { name: 'إنذار نهائي', days: 25 },
      { name: 'فصل', days: 26 },
    ];

    const insert = db.prepare(
      `INSERT INTO absence_stages (academic_year_id, name, days_threshold, letter_template, sort_order)
       VALUES (?, ?, ?, ?, ?)`
    );

    db.transaction(() => {
      defaults.forEach((d, idx) => {
        insert.run(
          academicYearId,
          d.name,
          d.days,
          savedTemplate,
          idx
        );
      });
    })();
  }
}

export function createAbsenceStage(
  db: SqliteDb,
  input: {
    academic_year_id?: number;
    name: string;
    days_threshold: number;
    letter_template?: string;
  }
): AbsenceStage {
  const activeYear = getActiveAcademicYear(db);
  const yearId = input.academic_year_id ?? activeYear.id;
  const name = normalizeWhitespace(input.name);
  const days = Number(input.days_threshold);
  const template =
    getSchoolSettings(db).unified_letter_template ?? UNIFIED_OFFICIAL_LETTER_TEMPLATE;

  if (!name) {
    throw new ServiceError('اسم المرحلة حقل إجباري.', 400, 'INVALID_STAGE_NAME');
  }
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new ServiceError('عدد أيام الغياب يجب أن يكون عدداً صحيحاً بين 1 و 365.', 400, 'INVALID_DAYS_THRESHOLD');
  }

  // Check duplicate name or days
  const conflict = db
    .prepare(
      `SELECT id, name, days_threshold FROM absence_stages
       WHERE academic_year_id = ? AND (name = ? OR days_threshold = ?)`
    )
    .get(yearId, name, days) as { id: number; name: string; days_threshold: number } | undefined;

  if (conflict) {
    if (conflict.name === name) {
      throw new ServiceError(`اسم المرحلة "${name}" موجود مسبقاً في هذه السنة الدراسية.`, 409, 'DUPLICATE_STAGE_NAME');
    }
    throw new ServiceError(`عتبة الأيام (${days}) مستخدمة مسبقاً للمرحلة "${conflict.name}".`, 409, 'DUPLICATE_STAGE_DAYS');
  }

  const info = db
    .prepare(
      `INSERT INTO absence_stages (academic_year_id, name, days_threshold, letter_template, sort_order)
       VALUES (?, ?, ?, ?, 0)`
    )
    .run(yearId, name, days, template);

  const stageId = Number(info.lastInsertRowid);
  const created = db.prepare('SELECT * FROM absence_stages WHERE id = ?').get(stageId) as AbsenceStage;
  recordAuditLog(db, {
    operation_type: 'create',
    section: 'stages',
    description: `إضافة مرحلة غياب جديدة: ${created.name} (${created.days_threshold} يوم)`,
    target_id: created.id,
    target_label: created.name,
    new_value: {
      academic_year_id: created.academic_year_id,
      name: created.name,
      days_threshold: created.days_threshold,
    },
  });
  return created;
}

export function updateAbsenceStage(
  db: SqliteDb,
  stageId: number,
  input: {
    name: string;
    days_threshold: number;
    letter_template?: string;
  }
): AbsenceStage {
  const existing = db.prepare('SELECT * FROM absence_stages WHERE id = ?').get(stageId) as AbsenceStage | undefined;
  if (!existing) {
    throw new ServiceError('المرحلة المحددة غير موجودة.', 404, 'STAGE_NOT_FOUND');
  }

  const name = normalizeWhitespace(input.name);
  const days = Number(input.days_threshold);
  const template =
    getSchoolSettings(db).unified_letter_template ?? UNIFIED_OFFICIAL_LETTER_TEMPLATE;

  if (!name) {
    throw new ServiceError('اسم المرحلة حقل إجباري.', 400, 'INVALID_STAGE_NAME');
  }
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new ServiceError('عدد أيام الغياب يجب أن يكون عدداً صحيحاً بين 1 و 365.', 400, 'INVALID_DAYS_THRESHOLD');
  }

  const conflict = db
    .prepare(
      `SELECT id, name, days_threshold FROM absence_stages
       WHERE academic_year_id = ? AND id != ? AND (name = ? OR days_threshold = ?)`
    )
    .get(existing.academic_year_id, stageId, name, days) as { id: number; name: string; days_threshold: number } | undefined;

  if (conflict) {
    if (conflict.name === name) {
      throw new ServiceError(`اسم المرحلة "${name}" موجود مسبقاً في هذه السنة الدراسية.`, 409, 'DUPLICATE_STAGE_NAME');
    }
    throw new ServiceError(`عتبة الأيام (${days}) مستخدمة مسبقاً للمرحلة "${conflict.name}".`, 409, 'DUPLICATE_STAGE_DAYS');
  }

  const legacyToKeep =
    existing.letter_template && existing.letter_template.trim() !== template.trim()
      ? existing.letter_template
      : null;

  db.prepare(
    `UPDATE absence_stages
     SET name = ?,
         days_threshold = ?,
         legacy_letter_template = COALESCE(legacy_letter_template, ?),
         letter_template = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(name, days, legacyToKeep, template, stageId);

  const updated = db.prepare('SELECT * FROM absence_stages WHERE id = ?').get(stageId) as AbsenceStage;
  recordAuditLog(db, {
    operation_type: 'update',
    section: 'stages',
    description: `تعديل مرحلة الغياب: ${existing.name} ← ${updated.name}`,
    target_id: updated.id,
    target_label: updated.name,
    old_value: {
      name: existing.name,
      days_threshold: existing.days_threshold,
    },
    new_value: {
      name: updated.name,
      days_threshold: updated.days_threshold,
    },
  });
  return updated;
}

export function deleteAbsenceStage(db: SqliteDb, stageId: number, _fallbackStageId?: number): { deleted: true } {
  const stage = db.prepare('SELECT * FROM absence_stages WHERE id = ?').get(stageId) as AbsenceStage | undefined;
  if (!stage) {
    throw new ServiceError('المرحلة المحددة غير موجودة.', 404, 'STAGE_NOT_FOUND');
  }

  const tx = db.transaction(() => {
    // Since classification is dynamic based on student absence days and remaining stages thresholds,
    // deleting a stage automatically reclassifies students because classification evaluates against remaining stages!
    db.prepare('DELETE FROM absence_stages WHERE id = ?').run(stageId);
    recordAuditLog(db, {
      operation_type: 'delete',
      section: 'stages',
      description: `حذف مرحلة الغياب: ${stage.name} (${stage.days_threshold} يوم)`,
      target_id: stage.id,
      target_label: stage.name,
      old_value: {
        academic_year_id: stage.academic_year_id,
        name: stage.name,
        days_threshold: stage.days_threshold,
      },
    });
  });

  tx();
  return { deleted: true };
}

const ARABIC_COLLATOR = new Intl.Collator('ar');

export function getDynamicStageReport(
  db: SqliteDb,
  query: {
    academic_year_id?: number;
    stage_id?: number;
    grade_id?: number;
    section_id?: number;
    search?: string;
  }
): DynamicStageReportResponse {
  const academicYear = query.academic_year_id
    ? (db.prepare('SELECT id, name, is_active, created_at FROM academic_years WHERE id = ?').get(query.academic_year_id) as ReturnType<typeof getActiveAcademicYear> | undefined)
    : getActiveAcademicYear(db);

  if (!academicYear) {
    throw new ServiceError('السنة الدراسية المحددة غير موجودة.', 404, 'YEAR_NOT_FOUND');
  }

  const schoolSettings = getSchoolSettings(db);
  const stages = listAbsenceStages(db, academicYear.id);

  const enrollments = db
    .prepare(
      `SELECT st.id as student_id, st.student_uid, st.registry_number, st.full_name,
              g.id as grade_id, g.name as grade_name,
              sec.id as section_id, sec.name as section_name
       FROM student_enrollments se
       JOIN students st ON st.id = se.student_id
       JOIN grades g ON g.id = se.grade_id
       JOIN sections sec ON sec.id = se.section_id
       WHERE se.academic_year_id = ? AND se.is_current = 1 AND st.status = 'active'`
    )
    .all(academicYear.id) as Array<{
    student_id: number;
    student_uid: string;
    registry_number: string | null;
    full_name: string;
    grade_id: number;
    grade_name: string;
    section_id: number;
    section_name: string;
  }>;

  const totalsMap = getAcademicYearAbsenceTotalsMap(db, academicYear.id);
  const seenStudentIds = new Set<number>();
  const allRows: DynamicStageStudentRow[] = [];

  const stageCounts: Record<number, number> = {};
  stages.forEach((s) => {
    stageCounts[s.id] = 0;
  });
  let withinLimitCount = 0;

  for (const st of enrollments) {
    if (seenStudentIds.has(st.student_id)) continue;
    seenStudentIds.add(st.student_id);

    const totals = totalsMap.get(st.student_id);
    const countedAbsenceDays = totals?.total_full_days ?? 0;

    // Find highest stage where countedAbsenceDays >= stage.days_threshold
    let matchedStage: AbsenceStage | null = null;
    for (const s of stages) {
      if (countedAbsenceDays >= s.days_threshold) {
        matchedStage = s; // since stages are sorted ascending, later stages override earlier ones
      }
    }

    if (matchedStage) {
      stageCounts[matchedStage.id] = (stageCounts[matchedStage.id] ?? 0) + 1;
    } else {
      withinLimitCount += 1;
    }

    allRows.push({
      student_id: st.student_id,
      student_uid: st.student_uid,
      registry_number: st.registry_number,
      full_name: st.full_name,
      grade_id: st.grade_id,
      grade_name: st.grade_name,
      section_id: st.section_id,
      section_name: st.section_name,
      direct_full_days: totals?.direct_full_days ?? 0,
      counted_daily_permission_days: totals?.counted_daily_permission_days ?? 0,
      converted_lesson_days: totals?.converted_lesson_days ?? 0,
      counted_absence_days: countedAbsenceDays,
      pending_lessons: totals?.pending_lessons ?? 0,
      alert_level: matchedStage ? 'warning' : 'within_limit',
      alert_label: matchedStage ? matchedStage.name : 'ضمن الحد المسموح',
      report_threshold_days: matchedStage ? matchedStage.days_threshold : 0,
      days_over_report_threshold: matchedStage ? Math.max(0, countedAbsenceDays - matchedStage.days_threshold) : 0,
      remaining_to_effective_limit: 0,
      days_over_effective_limit: 0,
      stage_id: matchedStage ? matchedStage.id : null,
      stage_name: matchedStage ? matchedStage.name : null,
    });
  }

  const searchTerm = (query.search ?? '').trim().toLowerCase();
  const selectedStageId = query.stage_id ?? stages[0]?.id;
  const currentStage = stages.find((s) => s.id === Number(selectedStageId)) ?? stages[0] ?? null;

  const filteredRows = allRows.filter((row) => {
    if (query.grade_id && row.grade_id !== query.grade_id) return false;
    if (query.section_id && row.section_id !== query.section_id) return false;
    if (searchTerm) {
      const hay = `${row.full_name} ${row.registry_number ?? ''} ${row.student_uid}`.toLowerCase();
      if (!hay.includes(searchTerm)) return false;
    }
    if (currentStage && row.stage_id !== currentStage.id) return false;
    return true;
  });

  filteredRows.sort((a, b) => {
    if (b.counted_absence_days !== a.counted_absence_days) {
      return b.counted_absence_days - a.counted_absence_days;
    }
    return ARABIC_COLLATOR.compare(a.full_name, b.full_name);
  });

  return {
    academic_year: academicYear,
    school_settings: schoolSettings,
    stages,
    current_stage: currentStage,
    summary: {
      total_active_students: allRows.length,
      within_limit_count: withinLimitCount,
      stage_counts: stageCounts,
    },
    rows: filteredRows,
  };
}

export function issueOfficialLetter(
  db: SqliteDb,
  input: {
    academic_year_id: number;
    stage_id: number;
    document_number: string;
    letter_date: string;
    subject?: string;
    custom_body?: string;
    grade_id?: number;
    section_id?: number;
    search?: string;
  }
): IssuedOfficialLetter {
  const stage = db.prepare('SELECT * FROM absence_stages WHERE id = ?').get(input.stage_id) as AbsenceStage | undefined;
  if (!stage) {
    throw new ServiceError('المرحلة المحددة غير موجودة.', 404, 'STAGE_NOT_FOUND');
  }
  const settings = getSchoolSettings(db);
  const savedUnifiedTemplate =
    settings.unified_letter_template ?? UNIFIED_OFFICIAL_LETTER_TEMPLATE;
  const templateText =
    input.custom_body !== undefined && input.custom_body.trim().length > 0
      ? input.custom_body.trim()
      : savedUnifiedTemplate;

  const reportData = getDynamicStageReport(db, {
    academic_year_id: input.academic_year_id,
    stage_id: input.stage_id,
    grade_id: input.grade_id,
    section_id: input.section_id,
    search: input.search,
  });

  const students = reportData.rows;
  const subjectText = (input.subject ?? `الإعلان عن أسماء الطلبة المشمولين بمرحلة ${stage.name}`).trim();

  const content = resolveOfficialLetterTemplate(templateText, {
    absence_days: stage.days_threshold,
    stage_name: stage.name,
    academic_year: reportData.academic_year.name,
    school_name: settings.school_name,
    date: input.letter_date,
    document_number: input.document_number,
    student_count: students.length,
  });

  const info = db
    .prepare(
      `INSERT INTO issued_official_letters
         (academic_year_id, stage_id, stage_name, days_threshold, document_number, letter_date, subject, rendered_content, students_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.academic_year_id,
      stage.id,
      stage.name,
      stage.days_threshold,
      input.document_number,
      input.letter_date,
      subjectText,
      content,
      JSON.stringify(students)
    );

  const letterId = Number(info.lastInsertRowid);
  const letter = db.prepare('SELECT * FROM issued_official_letters WHERE id = ?').get(letterId) as IssuedOfficialLetter;
  recordAuditLog(db, {
    operation_type: 'issue_letter',
    section: 'letters',
    description: `إصدار كتاب رسمي رقم (${letter.document_number}) لمرحلة ${letter.stage_name} بعدد ${students.length} طالب`,
    target_id: letter.id,
    target_label: letter.document_number,
    new_value: {
      academic_year_id: letter.academic_year_id,
      stage_id: letter.stage_id,
      stage_name: letter.stage_name,
      days_threshold: letter.days_threshold,
      document_number: letter.document_number,
      letter_date: letter.letter_date,
      subject: letter.subject,
      student_count: students.length,
    },
  });
  return letter;
}

export function listIssuedLetters(db: SqliteDb, academicYearId: number): IssuedOfficialLetter[] {
  return db
    .prepare(
      `SELECT id, academic_year_id, stage_id, stage_name, days_threshold, document_number, letter_date, subject, rendered_content, students_json, created_at
       FROM issued_official_letters
       WHERE academic_year_id = ?
       ORDER BY id DESC`
    )
    .all(academicYearId) as IssuedOfficialLetter[];
}

export function getIssuedLetterById(db: SqliteDb, letterId: number): IssuedOfficialLetter {
  const letter = db
    .prepare(
      `SELECT id, academic_year_id, stage_id, stage_name, days_threshold, document_number, letter_date, subject, rendered_content, students_json, created_at
       FROM issued_official_letters
       WHERE id = ?`
    )
    .get(letterId) as IssuedOfficialLetter | undefined;

  if (!letter) {
    throw new ServiceError('الكتاب الرسمي المطلوب غير موجود.', 404, 'LETTER_NOT_FOUND');
  }
  return letter;
}
