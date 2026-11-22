import type {
  EducationalStage,
  ExcusedAbsenceMode,
  GuardianFrequency,
  LegalRegulationVersion,
  LegalStageRegulation,
  UpdateLegalRegulationInput,
} from '../../src/types/school';
import type { SqliteDb } from '../db/connection';
import { ServiceError, normalizeNullableString, normalizeWhitespace } from '../utils/validation';
import { getActiveAcademicYear } from './settingsService';

export const ORDERED_STAGES: EducationalStage[] = ['primary', 'intermediate', 'preparatory'];

export const STAGE_LABELS: Record<EducationalStage, string> = {
  primary: 'المرحلة الابتدائية',
  intermediate: 'المرحلة المتوسطة',
  preparatory: 'المرحلة الإعدادية',
};

const VALID_EXCUSED_MODES = new Set<ExcusedAbsenceMode>([
  'include_all',
  'exclude_all',
  'exclude_with_approved_rule',
]);

const VALID_FREQUENCIES = new Set<GuardianFrequency>([
  'weekly',
  'biweekly',
  'monthly',
  'upon_threshold',
]);

export function validateStage(raw: string): EducationalStage {
  const s = raw.trim() as EducationalStage;
  if (s !== 'primary' && s !== 'intermediate' && s !== 'preparatory') {
    throw new ServiceError('المرحلة الدراسية المحددة غير صالحة.', 400, 'INVALID_STAGE');
  }
  return s;
}

function validateIsoDateOptional(raw: string | null | undefined, label: string): string | null {
  const cleaned = normalizeNullableString(raw);
  if (!cleaned) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    throw new ServiceError(`صيغة ${label} غير صالحة. يجب أن تكون YYYY-MM-DD.`, 400);
  }
  return cleaned;
}

function normalizeRegulationRow(row: Record<string, unknown>): LegalStageRegulation {
  return {
    stage: row.stage as EducationalStage,
    stage_name: String(row.stage_name ?? STAGE_LABELS[row.stage as EducationalStage]),
    effective_absence_limit: Number(row.effective_absence_limit),
    absence_calculation_method: String(row.absence_calculation_method ?? ''),
    excused_absence_mode: (row.excused_absence_mode as ExcusedAbsenceMode) ?? 'include_all',
    unexcused_absence_handling: String(row.unexcused_absence_handling ?? ''),
    dispersed_lessons_rule: String(row.dispersed_lessons_rule ?? ''),
    lesson_conversion_rule: String(row.lesson_conversion_rule ?? ''),
    preliminary_warning_days: Number(row.preliminary_warning_days),
    first_warning_days: Number(row.first_warning_days),
    final_warning_days: Number(row.final_warning_days),
    final_effective_limit_days: Number(row.final_effective_limit_days),
    thresholds_are_provisional: Number(row.thresholds_are_provisional ?? 1),
    guardian_notify_frequency: (row.guardian_notify_frequency as GuardianFrequency) ?? 'biweekly',
    guardian_summons_frequency: (row.guardian_summons_frequency as GuardianFrequency) ?? 'biweekly',
    guardian_notify_notes: row.guardian_notify_notes ? String(row.guardian_notify_notes) : null,
    attendance_score_deduction_enabled: Number(row.attendance_score_deduction_enabled ?? 0),
    attendance_score_deduction_per_unexcused_day: Number(
      row.attendance_score_deduction_per_unexcused_day ?? 0
    ),
    attendance_score_article: row.attendance_score_article
      ? String(row.attendance_score_article)
      : null,
    conduct_failure_enabled: Number(row.conduct_failure_enabled ?? 0),
    conduct_failure_threshold: Number(row.conduct_failure_threshold ?? 51),
    conduct_failure_article: row.conduct_failure_article
      ? String(row.conduct_failure_article)
      : null,
    truancy_handling_enabled: Number(row.truancy_handling_enabled ?? 1),
    truancy_handling_notes: row.truancy_handling_notes ? String(row.truancy_handling_notes) : null,
    truancy_article: row.truancy_article ? String(row.truancy_article) : null,
    dispersed_lessons_counting_enabled: Number(row.dispersed_lessons_counting_enabled ?? 1),
    dispersed_lessons_article: row.dispersed_lessons_article
      ? String(row.dispersed_lessons_article)
      : null,
    warnings_article: row.warnings_article ? String(row.warnings_article) : null,
    decision_name: row.decision_name ? String(row.decision_name) : null,
    decision_number: row.decision_number ? String(row.decision_number) : null,
    decision_issue_date: row.decision_issue_date ? String(row.decision_issue_date) : null,
    effective_from_date: row.effective_from_date ? String(row.effective_from_date) : null,
    legal_notes: row.legal_notes ? String(row.legal_notes) : null,
    is_legally_approved: Number(row.is_legally_approved ?? 0),
    official_letter_approved: Number(row.official_letter_approved ?? 0),
    warning_letter_template: String(row.warning_letter_template ?? ''),
    summons_letter_template: String(row.summons_letter_template ?? ''),
    current_version: Number(row.current_version ?? 1),
    updated_at: String(row.updated_at ?? ''),
  };
}

export function getStageRegulationForYear(
  db: SqliteDb,
  stage: EducationalStage,
  academicYearId?: number
): LegalStageRegulation {
  const validStage = validateStage(stage);
  const activeYear = getActiveAcademicYear(db);
  const targetYearId = academicYearId ?? activeYear.id;

  const binding = db
    .prepare(
      `SELECT b.regulation_version_id, b.is_locked, v.snapshot_json
       FROM legal_year_regulation_bindings b
       JOIN legal_regulation_versions v ON v.id = b.regulation_version_id
       WHERE b.academic_year_id = ? AND b.stage = ?`
    )
    .get(targetYearId, validStage) as
    | { regulation_version_id: number; is_locked: number; snapshot_json: string }
    | undefined;

  if (binding) {
    try {
      const parsed = JSON.parse(binding.snapshot_json) as Record<string, unknown>;
      const normalized = normalizeRegulationRow(parsed);
      return {
        ...normalized,
        resolved_version_id: binding.regulation_version_id,
        is_historical_year_snapshot: targetYearId !== activeYear.id || binding.is_locked === 1,
      };
    } catch {
      // Fallback to live stage table if JSON was malformed
    }
  }

  const liveRow = db
    .prepare('SELECT * FROM legal_stage_regulations WHERE stage = ?')
    .get(validStage) as Record<string, unknown> | undefined;

  if (!liveRow) {
    throw new ServiceError(`تعذر العثور على الضوابط القانونية للمرحلة (${validStage}).`, 404);
  }

  const latestVer = db
    .prepare(
      'SELECT id FROM legal_regulation_versions WHERE stage = ? ORDER BY version_number DESC LIMIT 1'
    )
    .get(validStage) as { id: number } | undefined;

  return {
    ...normalizeRegulationRow(liveRow),
    resolved_version_id: latestVer?.id ?? null,
    is_historical_year_snapshot: false,
  };
}

export function listAllStageRegulations(
  db: SqliteDb,
  academicYearId?: number
): Record<EducationalStage, LegalStageRegulation> {
  return {
    primary: getStageRegulationForYear(db, 'primary', academicYearId),
    intermediate: getStageRegulationForYear(db, 'intermediate', academicYearId),
    preparatory: getStageRegulationForYear(db, 'preparatory', academicYearId),
  };
}

export function listRegulationVersions(
  db: SqliteDb,
  stage?: EducationalStage
): LegalRegulationVersion[] {
  const params: unknown[] = [];
  let whereSql = '';
  if (stage) {
    validateStage(stage);
    whereSql = 'WHERE v.stage = ?';
    params.push(stage);
  }

  const rows = db
    .prepare(
      `SELECT v.id, v.stage, v.version_number, v.academic_year_id,
              ay.name as academic_year_name,
              v.effective_from_date, v.decision_name, v.decision_number,
              v.decision_issue_date, v.is_legally_approved, v.change_summary,
              v.snapshot_json, v.created_at
       FROM legal_regulation_versions v
       LEFT JOIN academic_years ay ON ay.id = v.academic_year_id
       ${whereSql}
       ORDER BY v.stage ASC, v.version_number DESC`
    )
    .all(...params) as Array<{
    id: number;
    stage: EducationalStage;
    version_number: number;
    academic_year_id: number | null;
    academic_year_name: string | null;
    effective_from_date: string;
    decision_name: string | null;
    decision_number: string | null;
    decision_issue_date: string | null;
    is_legally_approved: number;
    change_summary: string | null;
    snapshot_json: string;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    stage: r.stage,
    version_number: r.version_number,
    academic_year_id: r.academic_year_id,
    academic_year_name: r.academic_year_name,
    effective_from_date: r.effective_from_date,
    decision_name: r.decision_name,
    decision_number: r.decision_number,
    decision_issue_date: r.decision_issue_date,
    is_legally_approved: r.is_legally_approved,
    change_summary: r.change_summary,
    snapshot: normalizeRegulationRow(JSON.parse(r.snapshot_json) as Record<string, unknown>),
    created_at: r.created_at,
  }));
}

export function updateStageRegulation(
  db: SqliteDb,
  rawStage: string,
  input: UpdateLegalRegulationInput
): { regulation: LegalStageRegulation; version: LegalRegulationVersion } {
  const stage = validateStage(rawStage);

  const effectiveLimit = Number(input.effective_absence_limit);
  const prelimDays = Number(input.preliminary_warning_days);
  const firstDays = Number(input.first_warning_days);
  const finalDays = Number(input.final_warning_days);
  const finalLimitDays = Number(input.final_effective_limit_days);

  const intsToCheck = [
    { name: 'حد الغياب المؤثر', val: effectiveLimit },
    { name: 'عتبة التحذير الأولي', val: prelimDays },
    { name: 'عتبة الإنذار الأول', val: firstDays },
    { name: 'عتبة الإنذار النهائي', val: finalDays },
    { name: 'عتبة حد الغياب المؤثر النهائي', val: finalLimitDays },
  ];

  for (const item of intsToCheck) {
    if (!Number.isInteger(item.val) || item.val < 1 || item.val > 365) {
      throw new ServiceError(
        `قيمة "${item.name}" يجب أن تكون عدداً صحيحاً موجباً بين 1 و 365.`,
        400,
        'INVALID_THRESHOLD'
      );
    }
  }

  // Strict monotonic threshold verification to prevent contradictory or inverted thresholds
  if (
    !(
      prelimDays < firstDays &&
      firstDays < finalDays &&
      finalDays <= finalLimitDays &&
      finalLimitDays <= effectiveLimit
    )
  ) {
    throw new ServiceError(
      'تسلسل عتبات التحذير والإنذارات غير متوافق: يجب أن يكون (التحذير الأولي < الإنذار الأول < الإنذار النهائي <= الحد النهائي المؤثر <= حد الغياب المؤثر للمرحلة).',
      400,
      'THRESHOLD_ORDER_CONFLICT'
    );
  }

  if (!VALID_EXCUSED_MODES.has(input.excused_absence_mode)) {
    throw new ServiceError('طريقة احتساب الغياب بعذر غير صالحة.', 400);
  }
  if (!VALID_FREQUENCIES.has(input.guardian_notify_frequency)) {
    throw new ServiceError('دورية تبليغ ولي الأمر غير صالحة.', 400);
  }
  if (!VALID_FREQUENCIES.has(input.guardian_summons_frequency)) {
    throw new ServiceError('دورية استدعاء ولي الأمر غير صالحة.', 400);
  }

  const deductionEnabled =
    input.attendance_score_deduction_enabled === true ||
    input.attendance_score_deduction_enabled === 1
      ? 1
      : 0;
  const deductionPoints = Number(input.attendance_score_deduction_per_unexcused_day);
  if (Number.isNaN(deductionPoints) || deductionPoints < 0 || deductionPoints > 50) {
    throw new ServiceError('مقدار خصم درجات المواظبة يجب أن يكون رقماً بين 0 و 50.', 400);
  }

  const conductFailureEnabled =
    input.conduct_failure_enabled === true || input.conduct_failure_enabled === 1 ? 1 : 0;
  const conductThreshold = Number(input.conduct_failure_threshold);
  if (!Number.isInteger(conductThreshold) || conductThreshold < 1 || conductThreshold > 200) {
    throw new ServiceError('حد الرسوب بسبب السلوك يجب أن يكون عدداً صحيحاً بين 1 و 200.', 400);
  }

  const truancyEnabled =
    input.truancy_handling_enabled === true || input.truancy_handling_enabled === 1 ? 1 : 0;
  const dispersedEnabled =
    input.dispersed_lessons_counting_enabled === true ||
    input.dispersed_lessons_counting_enabled === 1
      ? 1
      : 0;

  const isProvisional =
    input.thresholds_are_provisional === true || input.thresholds_are_provisional === 1 ? 1 : 0;
  const isApproved =
    input.is_legally_approved === true || input.is_legally_approved === 1 ? 1 : 0;
  const letterApproved =
    input.official_letter_approved === true || input.official_letter_approved === 1 ? 1 : 0;

  const decisionName = normalizeNullableString(input.decision_name);
  const decisionNumber = normalizeNullableString(input.decision_number);
  const decisionIssueDate = validateIsoDateOptional(input.decision_issue_date, 'تاريخ صدور القرار');
  const todayIso = new Date().toISOString().slice(0, 10);
  const effectiveFromDate =
    validateIsoDateOptional(input.effective_from_date, 'تاريخ بدء السريان') ?? todayIso;

  if (isApproved === 1 && isProvisional === 1) {
    throw new ServiceError(
      'لا يمكن اعتماد الضابطة قانونياً مع بقاء العتبات مصنفة كقيم تجريبية. يرجى مراجعة الأرقام وإلغاء وسم "تجريبية" أولاً.',
      400,
      'PROVISIONAL_CANNOT_BE_APPROVED'
    );
  }

  if (isApproved === 1 && (!decisionNumber || !decisionIssueDate)) {
    throw new ServiceError(
      'لاعتماد الضابطة قانونياً بشكل رسمي، يجب توثيق رقم القرار/التعميم وتاريخ صدوره.',
      400,
      'DECISION_METADATA_REQUIRED'
    );
  }

  if (letterApproved === 1 && isApproved === 0) {
    throw new ServiceError(
      'لا يمكن اعتماد صيغة الكتاب القانوني الرسمي قبل اعتماد الضابطة القانونية للمرحلة.',
      400,
      'APPROVE_REGULATION_BEFORE_LETTER'
    );
  }

  const absenceCalcMethod = normalizeWhitespace(input.absence_calculation_method);
  const unexcusedHandling = normalizeWhitespace(input.unexcused_absence_handling);
  const dispersedRule = normalizeWhitespace(input.dispersed_lessons_rule);
  const conversionRule = normalizeWhitespace(input.lesson_conversion_rule);
  const warningTemplate = (input.warning_letter_template ?? '').trim();
  const summonsTemplate = (input.summons_letter_template ?? '').trim();

  if (!absenceCalcMethod || !unexcusedHandling || !dispersedRule || !conversionRule) {
    throw new ServiceError('يرجى استكمال نصوص قواعد الاحتساب والمعالجة لهذه المرحلة.', 400);
  }
  if (!warningTemplate || !summonsTemplate) {
    throw new ServiceError('صيغة كتاب الإنذار وصيغة كتاب الاستدعاء حقول إجبارية.', 400);
  }

  const activeYear = getActiveAcademicYear(db);
  const targetYearId = input.academic_year_id ?? activeYear.id;
  const targetYearRow = db
    .prepare('SELECT id, name FROM academic_years WHERE id = ?')
    .get(targetYearId) as { id: number; name: string } | undefined;
  if (!targetYearRow) {
    throw new ServiceError('السنة الدراسية المحددة غير موجودة.', 404, 'YEAR_NOT_FOUND');
  }

  const targetBinding = db
    .prepare(
      'SELECT is_locked FROM legal_year_regulation_bindings WHERE academic_year_id = ? AND stage = ?'
    )
    .get(targetYearId, stage) as { is_locked: number } | undefined;
  if (targetYearId !== activeYear.id && targetBinding?.is_locked === 1) {
    throw new ServiceError(
      `لا يمكن تطبيق تعديلات جديدة بأثر رجعي على السنة الدراسية السابقة (${targetYearRow.name}). يتم تعديل الضوابط للسنة الدراسية الفعالة فقط.`,
      409,
      'HISTORICAL_YEAR_LOCKED'
    );
  }

  const result = db.transaction(() => {
    const existing = db
      .prepare('SELECT * FROM legal_stage_regulations WHERE stage = ?')
      .get(stage) as Record<string, unknown> | undefined;
    if (!existing) {
      throw new ServiceError('المرحلة المحددة غير موجودة في جدول الضوابط.', 404);
    }

    // Preserve non-retroactivity: ensure every other academic year keeps its prior bound version
    const priorVer = db
      .prepare(
        'SELECT id FROM legal_regulation_versions WHERE stage = ? ORDER BY version_number DESC LIMIT 1'
      )
      .get(stage) as { id: number } | undefined;

    if (priorVer) {
      const otherYears = db
        .prepare('SELECT id FROM academic_years WHERE id != ?')
        .all(targetYearId) as Array<{ id: number }>;
      for (const yr of otherYears) {
        db.prepare(
          `INSERT OR IGNORE INTO legal_year_regulation_bindings (
             academic_year_id, stage, regulation_version_id, is_locked
           ) VALUES (?, ?, ?, 1)`
        ).run(yr.id, stage, priorVer.id);
      }
    }

    const nextVersion = Number(existing.current_version ?? 1) + 1;

    db.prepare(
      `UPDATE legal_stage_regulations
       SET effective_absence_limit = ?,
           absence_calculation_method = ?,
           excused_absence_mode = ?,
           unexcused_absence_handling = ?,
           dispersed_lessons_rule = ?,
           lesson_conversion_rule = ?,
           preliminary_warning_days = ?,
           first_warning_days = ?,
           final_warning_days = ?,
           final_effective_limit_days = ?,
           thresholds_are_provisional = ?,
           guardian_notify_frequency = ?,
           guardian_summons_frequency = ?,
           guardian_notify_notes = ?,
           attendance_score_deduction_enabled = ?,
           attendance_score_deduction_per_unexcused_day = ?,
           attendance_score_article = ?,
           conduct_failure_enabled = ?,
           conduct_failure_threshold = ?,
           conduct_failure_article = ?,
           truancy_handling_enabled = ?,
           truancy_handling_notes = ?,
           truancy_article = ?,
           dispersed_lessons_counting_enabled = ?,
           dispersed_lessons_article = ?,
           warnings_article = ?,
           decision_name = ?,
           decision_number = ?,
           decision_issue_date = ?,
           effective_from_date = ?,
           legal_notes = ?,
           is_legally_approved = ?,
           official_letter_approved = ?,
           warning_letter_template = ?,
           summons_letter_template = ?,
           current_version = ?,
           updated_at = datetime('now')
       WHERE stage = ?`
    ).run(
      effectiveLimit,
      absenceCalcMethod,
      input.excused_absence_mode,
      unexcusedHandling,
      dispersedRule,
      conversionRule,
      prelimDays,
      firstDays,
      finalDays,
      finalLimitDays,
      isProvisional,
      input.guardian_notify_frequency,
      input.guardian_summons_frequency,
      normalizeNullableString(input.guardian_notify_notes),
      deductionEnabled,
      deductionPoints,
      normalizeNullableString(input.attendance_score_article),
      conductFailureEnabled,
      conductThreshold,
      normalizeNullableString(input.conduct_failure_article),
      truancyEnabled,
      normalizeNullableString(input.truancy_handling_notes),
      normalizeNullableString(input.truancy_article),
      dispersedEnabled,
      normalizeNullableString(input.dispersed_lessons_article),
      normalizeNullableString(input.warnings_article),
      decisionName,
      decisionNumber,
      decisionIssueDate,
      effectiveFromDate,
      normalizeNullableString(input.legal_notes),
      isApproved,
      letterApproved,
      warningTemplate,
      summonsTemplate,
      nextVersion,
      stage
    );

    const updatedLive = db
      .prepare('SELECT * FROM legal_stage_regulations WHERE stage = ?')
      .get(stage) as Record<string, unknown>;

    const changeSummary =
      normalizeNullableString(input.change_summary) ??
      (isApproved === 1
        ? `تحديث واعتماد الضابطة القانونية (${decisionNumber ?? ''})`
        : 'تحديث إعدادات وضوابط المرحلة الدراسية');

    const verInfo = db
      .prepare(
        `INSERT INTO legal_regulation_versions (
           stage, version_number, academic_year_id, effective_from_date,
           decision_name, decision_number, decision_issue_date, is_legally_approved,
           change_summary, snapshot_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        stage,
        nextVersion,
        targetYearId,
        effectiveFromDate,
        decisionName,
        decisionNumber,
        decisionIssueDate,
        isApproved,
        changeSummary,
        JSON.stringify(updatedLive)
      );
    const newVersionId = Number(verInfo.lastInsertRowid);

    // Update binding ONLY for targetYearId (current/active academic year)
    db.prepare(
      `INSERT INTO legal_year_regulation_bindings (
         academic_year_id, stage, regulation_version_id, is_locked, bound_at
       ) VALUES (?, ?, ?, 0, datetime('now'))
       ON CONFLICT(academic_year_id, stage)
       DO UPDATE SET regulation_version_id = excluded.regulation_version_id,
                     bound_at = datetime('now')`
    ).run(targetYearId, stage, newVersionId);

    const versions = listRegulationVersions(db, stage);
    const createdVersion = versions.find((v) => v.id === newVersionId)!;
    const resolvedReg = getStageRegulationForYear(db, stage, targetYearId);
    return { regulation: resolvedReg, version: createdVersion };
  });

  return result();
}
