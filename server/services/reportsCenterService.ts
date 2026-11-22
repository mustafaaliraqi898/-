import ExcelJS from 'exceljs';
import type {
  CreateStudentLegalProcedureInput,
  EducationalStage,
  LegalProcedureType,
  LegalStageRegulation,
  ReportCategoryId,
  ReportsCenterQuery,
  ReportsCenterResponse,
  ReportsCenterStudentRow,
  ReportsCenterSummaryStats,
  StudentLegalProcedureRecord,
  UpdateStudentLegalProcedureInput,
} from '../../src/types/school';
import type { SqliteDb } from '../db/connection';
import { ServiceError, normalizeNullableString } from '../utils/validation';
import {
  getStageRegulationForYear,
  listAllStageRegulations,
  STAGE_LABELS,
} from './legalRegulationsService';
import { getActiveAcademicYear, getSchoolSettings } from './settingsService';

const VALID_REPORT_TYPES = new Set<ReportCategoryId>([
  'preliminary_warnings',
  'first_warnings',
  'final_warnings',
  'effective_limit_reached',
  'guardian_notifications',
  'guardian_summons',
]);

const VALID_PROCEDURE_TYPES = new Set<LegalProcedureType>([
  'preliminary_warning',
  'first_warning',
  'final_warning',
  'effective_limit_notice',
  'guardian_notification',
  'guardian_summons',
]);

const WARNING_STAGE_TYPES = new Set<LegalProcedureType>([
  'preliminary_warning',
  'first_warning',
  'final_warning',
  'effective_limit_notice',
]);

export const PROCEDURE_TYPE_LABELS: Record<LegalProcedureType, string> = {
  preliminary_warning: 'تحذير أولي',
  first_warning: 'إنذار أول',
  final_warning: 'إنذار نهائي',
  effective_limit_notice: 'إشعار بلوغ حد الغياب المؤثر',
  guardian_notification: 'تبليغ ولي أمر',
  guardian_summons: 'استدعاء ولي أمر',
};

export const REPORT_TYPE_LABELS: Record<ReportCategoryId, string> = {
  preliminary_warnings: 'تقرير التحذيرات الأولية',
  first_warnings: 'تقرير الإنذار الأول',
  final_warnings: 'تقرير الإنذار النهائي',
  effective_limit_reached: 'كشف الطلاب الذين بلغوا حد الغياب المؤثر',
  guardian_notifications: 'سجل تبليغات أولياء الأمور',
  guardian_summons: 'سجل استدعاءات أولياء الأمور',
};

function validateIsoDate(raw: string | undefined): string {
  const cleaned = (raw ?? new Date().toISOString().slice(0, 10)).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    throw new ServiceError('صيغة التاريخ غير صالحة. يجب أن تكون YYYY-MM-DD.', 400);
  }
  return cleaned;
}

function getCountedLegalDaysForStage(
  unexcusedDays: number,
  excusedDays: number,
  reg: LegalStageRegulation | null
): number {
  if (!reg) {
    return unexcusedDays + excusedDays;
  }
  if (reg.excused_absence_mode === 'exclude_all') {
    return unexcusedDays;
  }
  if (reg.excused_absence_mode === 'exclude_with_approved_rule') {
    return reg.is_legally_approved === 1 ? unexcusedDays : unexcusedDays + excusedDays;
  }
  // 'include_all': does not automatically exclude excused absences
  return unexcusedDays + excusedDays;
}

function resolveThresholdForReport(
  reportType: ReportCategoryId,
  reg: LegalStageRegulation | null
): number | null {
  if (!reg) return null;
  switch (reportType) {
    case 'preliminary_warnings':
      return reg.preliminary_warning_days;
    case 'first_warnings':
      return reg.first_warning_days;
    case 'final_warnings':
      return reg.final_warning_days;
    case 'effective_limit_reached':
      return reg.final_effective_limit_days;
    case 'guardian_notifications':
      return reg.preliminary_warning_days;
    case 'guardian_summons':
      return reg.first_warning_days;
    default:
      return null;
  }
}

function computeNextThresholdInfo(
  countedDays: number,
  reg: LegalStageRegulation | null
): {
  next_threshold_label: string;
  next_threshold_days: number | null;
  remaining_days_to_next_threshold: number | null;
  days_over_limit: number;
} {
  if (!reg) {
    return {
      next_threshold_label: 'غير محدد (المرحلة غير مربوطة)',
      next_threshold_days: null,
      remaining_days_to_next_threshold: null,
      days_over_limit: 0,
    };
  }

  if (countedDays < reg.preliminary_warning_days) {
    return {
      next_threshold_label: 'التحذير الأولي',
      next_threshold_days: reg.preliminary_warning_days,
      remaining_days_to_next_threshold: reg.preliminary_warning_days - countedDays,
      days_over_limit: 0,
    };
  }
  if (countedDays < reg.first_warning_days) {
    return {
      next_threshold_label: 'الإنذار الأول',
      next_threshold_days: reg.first_warning_days,
      remaining_days_to_next_threshold: reg.first_warning_days - countedDays,
      days_over_limit: 0,
    };
  }
  if (countedDays < reg.final_warning_days) {
    return {
      next_threshold_label: 'الإنذار النهائي',
      next_threshold_days: reg.final_warning_days,
      remaining_days_to_next_threshold: reg.final_warning_days - countedDays,
      days_over_limit: 0,
    };
  }
  if (countedDays < reg.final_effective_limit_days) {
    return {
      next_threshold_label: 'حد الغياب المؤثر',
      next_threshold_days: reg.final_effective_limit_days,
      remaining_days_to_next_threshold: reg.final_effective_limit_days - countedDays,
      days_over_limit: 0,
    };
  }

  return {
    next_threshold_label: 'بلغ/تجاوز حد الغياب المؤثر',
    next_threshold_days: reg.final_effective_limit_days,
    remaining_days_to_next_threshold: 0,
    days_over_limit: countedDays - reg.final_effective_limit_days,
  };
}

export function getReportsCenterData(
  db: SqliteDb,
  query: ReportsCenterQuery
): ReportsCenterResponse {
  if (!VALID_REPORT_TYPES.has(query.report_type)) {
    throw new ServiceError('نوع التقرير المطلوب غير صالح.', 400);
  }

  const academicYear = query.academic_year_id
    ? (db
        .prepare('SELECT id, name, is_active, created_at FROM academic_years WHERE id = ?')
        .get(query.academic_year_id) as ReturnType<typeof getActiveAcademicYear> | undefined)
    : getActiveAcademicYear(db);

  if (!academicYear) {
    throw new ServiceError('السنة الدراسية المحددة غير موجودة.', 404, 'YEAR_NOT_FOUND');
  }

  const schoolSettings = getSchoolSettings(db);
  const stageRegulations = listAllStageRegulations(db, academicYear.id);

  // Unmapped grades check
  const unmappedGrades = db
    .prepare('SELECT id, name FROM grades WHERE stage IS NULL ORDER BY sort_order ASC, id ASC')
    .all() as Array<{ id: number; name: string }>;

  // Active enrolled students in this academic year
  const enrollments = db
    .prepare(
      `SELECT st.id as student_id, st.student_uid, st.registry_number, st.full_name, st.phone,
              g.id as grade_id, g.name as grade_name, g.stage as stage,
              sec.id as section_id, sec.name as section_name
       FROM student_enrollments se
       JOIN students st ON st.id = se.student_id
       JOIN grades g ON g.id = se.grade_id
       JOIN sections sec ON sec.id = se.section_id
       WHERE se.academic_year_id = ? AND se.is_current = 1 AND st.status = 'active'
       ORDER BY g.sort_order ASC, sec.name ASC, st.full_name ASC`
    )
    .all(academicYear.id) as Array<{
    student_id: number;
    student_uid: string;
    registry_number: string | null;
    full_name: string;
    phone: string | null;
    grade_id: number;
    grade_name: string;
    stage: EducationalStage | null;
    section_id: number;
    section_name: string;
  }>;

  // Live absence aggregation from SQLite absences table
  const absSummaryRows = db
    .prepare(
      `SELECT
         a.student_id,
         SUM(CASE WHEN a.status = 'full_day' THEN 1 ELSE 0 END) as direct_unexcused_full_days,
         SUM(CASE WHEN a.status = 'full_day_leave' AND a.leave_type = 'daily_permission' AND a.counted_as_absence = 1 THEN 1 ELSE 0 END) as counted_daily_permission_days,
         SUM(CASE WHEN a.status = 'full_day_leave' AND a.leave_type = 'daily_permission' AND a.counted_as_absence = 0 THEN 1 ELSE 0 END) as uncounted_daily_permission_days,
         SUM(CASE WHEN a.status = 'full_day_leave' AND a.leave_type = 'sick_leave' THEN 1 ELSE 0 END) as sick_leave_days,
         COALESCE(SUM(CASE
           WHEN EXISTS (SELECT 1 FROM absence_lesson_details d WHERE d.absence_id = a.id)
             THEN (SELECT COUNT(*) FROM absence_lesson_details d WHERE d.absence_id = a.id AND d.lesson_status = 'lesson_absence')
           WHEN a.status = 'lesson_absence' THEN a.lessons_count
           ELSE 0 END), 0) as lesson_absence_lessons,
         COALESCE(SUM(CASE
           WHEN EXISTS (SELECT 1 FROM absence_lesson_details d WHERE d.absence_id = a.id)
             THEN (SELECT COUNT(*) FROM absence_lesson_details d WHERE d.absence_id = a.id AND d.lesson_status = 'lesson_escape')
           WHEN a.status = 'lesson_escape' THEN a.lessons_count
           ELSE 0 END), 0) as lesson_escape_lessons,
         COALESCE(SUM(CASE
           WHEN EXISTS (SELECT 1 FROM absence_lesson_details d WHERE d.absence_id = a.id)
             THEN (SELECT COUNT(*) FROM absence_lesson_details d WHERE d.absence_id = a.id AND d.lesson_status = 'lesson_permission' AND d.counted_as_absence = 1)
           WHEN a.status = 'lesson_permission' AND a.counted_as_absence = 1 THEN a.lessons_count
           ELSE 0 END), 0) as counted_lesson_permission_lessons,
         COALESCE(SUM(CASE
           WHEN EXISTS (SELECT 1 FROM absence_lesson_details d WHERE d.absence_id = a.id)
             THEN (SELECT COUNT(*) FROM absence_lesson_details d WHERE d.absence_id = a.id AND (d.lesson_status IN ('lesson_absence', 'lesson_escape') OR (d.lesson_status = 'lesson_permission' AND d.counted_as_absence = 1)))
           WHEN a.status IN ('lesson_absence', 'lesson_escape') OR (a.status = 'lesson_permission' AND a.counted_as_absence = 1) THEN a.lessons_count
           ELSE 0 END), 0) as total_lessons_missed
       FROM absences a
       WHERE a.academic_year_id = ?
       GROUP BY a.student_id`
    )
    .all(academicYear.id) as Array<{
    student_id: number;
    direct_unexcused_full_days: number;
    counted_daily_permission_days: number;
    uncounted_daily_permission_days: number;
    sick_leave_days: number;
    lesson_absence_lessons: number;
    lesson_escape_lessons: number;
    counted_lesson_permission_lessons: number;
    total_lessons_missed: number;
  }>;

  const absMap = new Map<number, (typeof absSummaryRows)[number]>();
  for (const r of absSummaryRows) {
    absMap.set(r.student_id, r);
  }

  // Converted lesson days per student
  const convRows = db
    .prepare(
      `SELECT student_id, COUNT(*) as converted_days, COALESCE(SUM(lessons_consumed), 0) as consumed_lessons
       FROM lesson_converted_days
       WHERE academic_year_id = ?
       GROUP BY student_id`
    )
    .all(academicYear.id) as Array<{
    student_id: number;
    converted_days: number;
    consumed_lessons: number;
  }>;

  const convMap = new Map<number, { converted_days: number; consumed_lessons: number }>();
  for (const r of convRows) {
    convMap.set(r.student_id, {
      converted_days: r.converted_days,
      consumed_lessons: r.consumed_lessons,
    });
  }

  // Historical student legal procedures in this academic year
  const procedureRows = db
    .prepare(
      `SELECT p.*, st.full_name as student_name, st.student_uid, st.registry_number,
              ay.name as academic_year_name, g.name as grade_name, sec.name as section_name
       FROM student_legal_procedures p
       JOIN students st ON st.id = p.student_id
       JOIN academic_years ay ON ay.id = p.academic_year_id
       JOIN grades g ON g.id = p.grade_id
       JOIN sections sec ON sec.id = p.section_id
       WHERE p.academic_year_id = ?
       ORDER BY p.procedure_date DESC, p.id DESC`
    )
    .all(academicYear.id) as StudentLegalProcedureRecord[];

  const procMap = new Map<number, StudentLegalProcedureRecord[]>();
  for (const p of procedureRows) {
    const list = procMap.get(p.student_id);
    if (list) list.push(p);
    else procMap.set(p.student_id, [p]);
  }

  const summary: ReportsCenterSummaryStats = {
    total_active_students: enrollments.length,
    unmapped_stage_students: 0,
    preliminary_warnings_count: 0,
    first_warnings_count: 0,
    final_warnings_count: 0,
    effective_limit_reached_count: 0,
    guardian_notifications_due_count: 0,
    guardian_notifications_logged_count: 0,
    guardian_summons_due_count: 0,
    guardian_summons_logged_count: 0,
    conduct_failure_risk_count: 0,
  };

  const allComputedRows: ReportsCenterStudentRow[] = enrollments.map((st) => {
    const abs = absMap.get(st.student_id) ?? {
      student_id: st.student_id,
      direct_unexcused_full_days: 0,
      counted_daily_permission_days: 0,
      uncounted_daily_permission_days: 0,
      sick_leave_days: 0,
      lesson_absence_lessons: 0,
      lesson_escape_lessons: 0,
      counted_lesson_permission_lessons: 0,
      total_lessons_missed: 0,
    };
    const conv = convMap.get(st.student_id) ?? { converted_days: 0, consumed_lessons: 0 };
    const pendingLessons = Math.max(0, abs.total_lessons_missed - conv.consumed_lessons);

    const reg = st.stage ? stageRegulations[st.stage] : null;
    const effectiveConvertedDays =
      reg && reg.dispersed_lessons_counting_enabled === 0 ? 0 : conv.converted_days;

    const unexcusedDays =
      abs.direct_unexcused_full_days + effectiveConvertedDays + abs.counted_daily_permission_days;
    const excusedDays = abs.sick_leave_days + abs.uncounted_daily_permission_days;
    const countedLegalDays = getCountedLegalDaysForStage(unexcusedDays, excusedDays, reg);

    const attendanceScoreDeducted =
      reg && reg.attendance_score_deduction_enabled === 1
        ? Number((unexcusedDays * reg.attendance_score_deduction_per_unexcused_day).toFixed(2))
        : 0;

    const conductFailureTriggered = Boolean(
      reg &&
        reg.conduct_failure_enabled === 1 &&
        attendanceScoreDeducted >= reg.conduct_failure_threshold
    );

    const truancyRisk = Boolean(
      reg &&
        reg.truancy_handling_enabled === 1 &&
        (abs.lesson_escape_lessons > 0 || countedLegalDays >= reg.final_warning_days)
    );

    const reachedPrelim = Boolean(reg && countedLegalDays >= reg.preliminary_warning_days);
    const reachedFirst = Boolean(reg && countedLegalDays >= reg.first_warning_days);
    const reachedFinal = Boolean(reg && countedLegalDays >= reg.final_warning_days);
    const reachedEffectiveLimit = Boolean(reg && countedLegalDays >= reg.final_effective_limit_days);

    const studentProcs = procMap.get(st.student_id) ?? [];
    const issuedWarningTypes = Array.from(
      new Set(
        studentProcs
          .map((p) => p.procedure_type)
          .filter((t) => WARNING_STAGE_TYPES.has(t))
      )
    );
    const notifications = studentProcs.filter((p) => p.procedure_type === 'guardian_notification');
    const summons = studentProcs.filter((p) => p.procedure_type === 'guardian_summons');

    const lastProc = studentProcs[0] ?? null;
    const lastNotif = notifications[0] ?? null;
    const lastSummons = summons[0] ?? null;

    if (!st.stage) summary.unmapped_stage_students += 1;
    if (reachedPrelim) summary.preliminary_warnings_count += 1;
    if (reachedFirst) summary.first_warnings_count += 1;
    if (reachedFinal) summary.final_warnings_count += 1;
    if (reachedEffectiveLimit) summary.effective_limit_reached_count += 1;
    if (conductFailureTriggered) summary.conduct_failure_risk_count += 1;
    summary.guardian_notifications_logged_count += notifications.length;
    summary.guardian_summons_logged_count += summons.length;
    if (reachedPrelim && notifications.length === 0) summary.guardian_notifications_due_count += 1;
    if ((reachedFirst || reachedFinal) && summons.length === 0) summary.guardian_summons_due_count += 1;

    const nextInfo = computeNextThresholdInfo(countedLegalDays, reg);
    const reportThresholdDays = resolveThresholdForReport(query.report_type, reg);

    // Determine procedural status label
    let procStatus: ReportsCenterStudentRow['procedure_status'] = 'monitoring';
    let procStatusLabel = 'ضمن المتابعة الاعتيادية';

    if (!st.stage || !reg) {
      procStatus = 'unmapped_stage';
      procStatusLabel = 'المرحلة الدراسية غير محددة للصف';
    } else if (reachedEffectiveLimit) {
      procStatus = issuedWarningTypes.includes('effective_limit_notice')
        ? 'issued'
        : 'effective_limit_reached';
      procStatusLabel = issuedWarningTypes.includes('effective_limit_notice')
        ? 'بلغ حد الغياب المؤثر (تم توثيق الإجراء)'
        : 'بلغ حد الغياب المؤثر — يستوجب إجراءً فورياً';
    } else if (reachedFinal) {
      procStatus = issuedWarningTypes.includes('final_warning') ? 'issued' : 'final_warning_due';
      procStatusLabel = issuedWarningTypes.includes('final_warning')
        ? 'صدر الإنذار النهائي'
        : 'مستحق للإنذار النهائي';
    } else if (reachedFirst) {
      procStatus = issuedWarningTypes.includes('first_warning') ? 'issued' : 'first_warning_due';
      procStatusLabel = issuedWarningTypes.includes('first_warning')
        ? 'صدر الإنذار الأول'
        : 'مستحق للإنذار الأول';
    } else if (reachedPrelim) {
      procStatus = issuedWarningTypes.includes('preliminary_warning')
        ? 'issued'
        : 'preliminary_due';
      procStatusLabel = issuedWarningTypes.includes('preliminary_warning')
        ? 'صدر التحذير الأولي'
        : 'مستحق للتحذير الأولي';
    } else if (summons.length > 0) {
      procStatus = 'summoned';
      procStatusLabel = 'تم استدعاء ولي الأمر';
    } else if (notifications.length > 0) {
      procStatus = 'notified';
      procStatusLabel = 'تم تبليغ ولي الأمر';
    } else if (
      nextInfo.remaining_days_to_next_threshold !== null &&
      nextInfo.remaining_days_to_next_threshold <= 3
    ) {
      procStatus = 'approaching_threshold';
      procStatusLabel = `قريب من ${nextInfo.next_threshold_label}`;
    }

    return {
      student_id: st.student_id,
      student_uid: st.student_uid,
      registry_number: st.registry_number,
      full_name: st.full_name,
      phone: st.phone,
      grade_id: st.grade_id,
      grade_name: st.grade_name,
      section_id: st.section_id,
      section_name: st.section_name,
      stage: st.stage,
      stage_name: st.stage ? STAGE_LABELS[st.stage] : null,
      direct_unexcused_full_days: abs.direct_unexcused_full_days,
      converted_lesson_days: effectiveConvertedDays,
      counted_daily_permission_days: abs.counted_daily_permission_days,
      uncounted_daily_permission_days: abs.uncounted_daily_permission_days,
      sick_leave_days: abs.sick_leave_days,
      excused_absence_days: excusedDays,
      unexcused_absence_days: unexcusedDays,
      counted_legal_absence_days: countedLegalDays,
      pending_lessons: pendingLessons,
      lesson_absence_lessons: abs.lesson_absence_lessons,
      lesson_escape_lessons: abs.lesson_escape_lessons,
      counted_lesson_permission_lessons: abs.counted_lesson_permission_lessons,
      attendance_score_deducted: attendanceScoreDeducted,
      conduct_failure_triggered: conductFailureTriggered,
      truancy_risk: truancyRisk,
      report_threshold_days: reportThresholdDays,
      next_threshold_label: nextInfo.next_threshold_label,
      next_threshold_days: nextInfo.next_threshold_days,
      remaining_days_to_next_threshold: nextInfo.remaining_days_to_next_threshold,
      days_over_limit: nextInfo.days_over_limit,
      reached_preliminary: reachedPrelim,
      reached_first_warning: reachedFirst,
      reached_final_warning: reachedFinal,
      reached_effective_limit: reachedEffectiveLimit,
      procedure_status: procStatus,
      procedure_status_label: procStatusLabel,
      last_action_date: lastProc ? lastProc.procedure_date : null,
      last_action_type: lastProc ? lastProc.procedure_type : null,
      last_action_label: lastProc ? PROCEDURE_TYPE_LABELS[lastProc.procedure_type] : null,
      last_notification_date: lastNotif ? lastNotif.procedure_date : null,
      last_summons_date: lastSummons ? lastSummons.procedure_date : null,
      last_summons_result: lastSummons ? lastSummons.summons_result : null,
      issued_warning_types: issuedWarningTypes,
      notifications_count: notifications.length,
      summons_count: summons.length,
      is_legally_approved_stage: Boolean(reg && reg.is_legally_approved === 1),
      thresholds_are_provisional: Boolean(!reg || reg.thresholds_are_provisional === 1),
      procedures: studentProcs,
    };
  });

  // Apply report category filter + UI filters
  const includeApproaching = Boolean(query.include_approaching);
  const searchTerm = (query.search ?? '').trim().toLowerCase();

  const filteredRows = allComputedRows.filter((row) => {
    if (query.stage && query.stage !== 'all' && row.stage !== query.stage) return false;
    if (query.grade_id && row.grade_id !== query.grade_id) return false;
    if (query.section_id && row.section_id !== query.section_id) return false;
    if (searchTerm) {
      const hay = `${row.full_name} ${row.registry_number ?? ''} ${row.student_uid}`.toLowerCase();
      if (!hay.includes(searchTerm)) return false;
    }

    const reg = row.stage ? stageRegulations[row.stage] : null;
    if (!reg) {
      // Unmapped students only appear if user didn't filter them out and report is approaching or search matches
      return includeApproaching;
    }

    switch (query.report_type) {
      case 'preliminary_warnings':
        return (
          row.reached_preliminary ||
          row.issued_warning_types.includes('preliminary_warning') ||
          (includeApproaching && reg.preliminary_warning_days - row.counted_legal_absence_days <= 3)
        );
      case 'first_warnings':
        return (
          row.reached_first_warning ||
          row.issued_warning_types.includes('first_warning') ||
          (includeApproaching && reg.first_warning_days - row.counted_legal_absence_days <= 3)
        );
      case 'final_warnings':
        return (
          row.reached_final_warning ||
          row.issued_warning_types.includes('final_warning') ||
          (includeApproaching && reg.final_warning_days - row.counted_legal_absence_days <= 3)
        );
      case 'effective_limit_reached':
        return (
          row.reached_effective_limit ||
          row.issued_warning_types.includes('effective_limit_notice') ||
          (includeApproaching && reg.final_effective_limit_days - row.counted_legal_absence_days <= 3)
        );
      case 'guardian_notifications':
        return (
          row.notifications_count > 0 ||
          row.reached_preliminary ||
          row.truancy_risk ||
          (includeApproaching && row.counted_legal_absence_days >= 1)
        );
      case 'guardian_summons':
        return (
          row.summons_count > 0 ||
          row.reached_first_warning ||
          row.reached_preliminary ||
          row.conduct_failure_triggered ||
          row.truancy_risk ||
          (includeApproaching && row.counted_legal_absence_days >= 1)
        );
      default:
        return true;
    }
  });

  filteredRows.sort((a, b) => {
    if (b.counted_legal_absence_days !== a.counted_legal_absence_days) {
      return b.counted_legal_absence_days - a.counted_legal_absence_days;
    }
    return a.full_name.localeCompare(b.full_name, 'ar');
  });

  const filteredLogs = procedureRows.filter((log) => {
    if (query.stage && query.stage !== 'all' && log.stage !== query.stage) return false;
    if (query.grade_id && log.grade_id !== query.grade_id) return false;
    if (query.section_id && log.section_id !== query.section_id) return false;
    if (searchTerm) {
      const hay = `${log.student_name ?? ''} ${log.registry_number ?? ''} ${log.student_uid ?? ''}`.toLowerCase();
      if (!hay.includes(searchTerm)) return false;
    }
    if (query.report_type === 'guardian_notifications') {
      return log.procedure_type === 'guardian_notification';
    }
    if (query.report_type === 'guardian_summons') {
      return log.procedure_type === 'guardian_summons';
    }
    return true;
  });

  return {
    academic_year: academicYear,
    school_settings: schoolSettings,
    report_type: query.report_type,
    stage_regulations: stageRegulations,
    unmapped_grades: unmappedGrades,
    summary,
    rows: filteredRows,
    procedure_logs: filteredLogs,
  };
}

export function createStudentLegalProcedure(
  db: SqliteDb,
  input: CreateStudentLegalProcedureInput
): StudentLegalProcedureRecord {
  const studentId = Number(input.student_id);
  if (!Number.isInteger(studentId) || studentId <= 0) {
    throw new ServiceError('معرف الطالب غير صالح.', 400);
  }
  if (!VALID_PROCEDURE_TYPES.has(input.procedure_type)) {
    throw new ServiceError('نوع الإجراء الإداري/القانوني غير صالح.', 400);
  }

  const academicYear = input.academic_year_id
    ? (db
        .prepare('SELECT id, name FROM academic_years WHERE id = ?')
        .get(input.academic_year_id) as { id: number; name: string } | undefined)
    : getActiveAcademicYear(db);
  if (!academicYear) {
    throw new ServiceError('السنة الدراسية غير موجودة.', 404, 'YEAR_NOT_FOUND');
  }

  const enrollment = db
    .prepare(
      `SELECT st.id as student_id, st.full_name, se.grade_id, se.section_id, g.stage, g.name as grade_name
       FROM student_enrollments se
       JOIN students st ON st.id = se.student_id
       JOIN grades g ON g.id = se.grade_id
       WHERE se.student_id = ? AND se.academic_year_id = ? AND se.is_current = 1
       LIMIT 1`
    )
    .get(studentId, academicYear.id) as
    | {
        student_id: number;
        full_name: string;
        grade_id: number;
        section_id: number;
        stage: EducationalStage | null;
        grade_name: string;
      }
    | undefined;

  if (!enrollment) {
    throw new ServiceError('الطالب غير مسجل في السنة الدراسية المحددة.', 404, 'ENROLLMENT_NOT_FOUND');
  }
  if (!enrollment.stage) {
    throw new ServiceError(
      `لا يمكن تسجيل إجراء قانوني للصف "${enrollment.grade_name}" قبل ربطه بالمرحلة الدراسية (الابتدائية / المتوسطة / الإعدادية).`,
      400,
      'GRADE_STAGE_UNMAPPED'
    );
  }

  const regulation = getStageRegulationForYear(db, enrollment.stage, academicYear.id);
  const isOfficialLegal = Boolean(input.is_official_legal_issue);

  if (
    isOfficialLegal &&
    (regulation.is_legally_approved !== 1 || regulation.official_letter_approved !== 1)
  ) {
    throw new ServiceError(
      `لا يمكن إصدار كتاب قانوني بصيغة رسمية نهائية لمرحلة "${regulation.stage_name}" لأن الضابطة القانونية أو صيغة الكتاب غير معتمدة قانونياً بعد.`,
      400,
      'REGULATION_NOT_APPROVED'
    );
  }

  const overrideReason = normalizeNullableString(input.override_reason);

  // Prevent duplicate warning stage in the same academic year unless an explicit override reason is documented
  if (WARNING_STAGE_TYPES.has(input.procedure_type)) {
    const existingWarning = db
      .prepare(
        `SELECT id, procedure_date FROM student_legal_procedures
         WHERE student_id = ? AND academic_year_id = ? AND procedure_type = ?
         LIMIT 1`
      )
      .get(studentId, academicYear.id, input.procedure_type) as
      | { id: number; procedure_date: string }
      | undefined;

    if (existingWarning && !overrideReason) {
      throw new ServiceError(
        `تم تسجيل "${PROCEDURE_TYPE_LABELS[input.procedure_type]}" مسبقاً للطالب "${enrollment.full_name}" في العام الدراسي ${academicYear.name} بتاريخ ${existingWarning.procedure_date}. لا يجوز تكرار الإنذار نفسه إلا مع توثيق سبب إداري صريح.`,
        409,
        'DUPLICATE_WARNING_PROCEDURE'
      );
    }
  }

  // Snapshot student's current absence count at action time
  const reportSnapshot = getReportsCenterData(db, {
    academic_year_id: academicYear.id,
    report_type: 'preliminary_warnings',
    stage: enrollment.stage,
    include_approaching: true,
  });
  const studentMetrics = reportSnapshot.rows.find((r) => r.student_id === studentId);
  const absenceAtAction = studentMetrics?.counted_legal_absence_days ?? 0;
  const unexcusedAtAction = studentMetrics?.unexcused_absence_days ?? 0;

  let thresholdAtAction = 0;
  if (input.procedure_type === 'preliminary_warning') {
    thresholdAtAction = regulation.preliminary_warning_days;
  } else if (input.procedure_type === 'first_warning') {
    thresholdAtAction = regulation.first_warning_days;
  } else if (input.procedure_type === 'final_warning') {
    thresholdAtAction = regulation.final_warning_days;
  } else if (input.procedure_type === 'effective_limit_notice') {
    thresholdAtAction = regulation.final_effective_limit_days;
  }

  const procedureDate = validateIsoDate(input.procedure_date);
  const info = db
    .prepare(
      `INSERT INTO student_legal_procedures (
         student_id, academic_year_id, grade_id, section_id, stage,
         regulation_version_id, procedure_type, procedure_date,
         absence_days_at_action, unexcused_days_at_action, threshold_at_action,
         delivery_method, summons_result, recorded_by, notes, override_reason,
         is_official_legal_issue
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      studentId,
      academicYear.id,
      enrollment.grade_id,
      enrollment.section_id,
      enrollment.stage,
      regulation.resolved_version_id ?? null,
      input.procedure_type,
      procedureDate,
      absenceAtAction,
      unexcusedAtAction,
      thresholdAtAction,
      normalizeNullableString(input.delivery_method),
      normalizeNullableString(input.summons_result),
      normalizeNullableString(input.recorded_by),
      normalizeNullableString(input.notes),
      overrideReason,
      isOfficialLegal ? 1 : 0
    );

  const created = db
    .prepare(
      `SELECT p.*, st.full_name as student_name, st.student_uid, st.registry_number,
              ay.name as academic_year_name, g.name as grade_name, sec.name as section_name
       FROM student_legal_procedures p
       JOIN students st ON st.id = p.student_id
       JOIN academic_years ay ON ay.id = p.academic_year_id
       JOIN grades g ON g.id = p.grade_id
       JOIN sections sec ON sec.id = p.section_id
       WHERE p.id = ?`
    )
    .get(Number(info.lastInsertRowid)) as StudentLegalProcedureRecord;

  return created;
}

export function updateStudentLegalProcedure(
  db: SqliteDb,
  procedureId: number,
  input: UpdateStudentLegalProcedureInput
): StudentLegalProcedureRecord {
  const existing = db
    .prepare('SELECT id, procedure_date, delivery_method, summons_result, recorded_by, notes FROM student_legal_procedures WHERE id = ?')
    .get(procedureId) as
    | {
        id: number;
        procedure_date: string;
        delivery_method: string | null;
        summons_result: string | null;
        recorded_by: string | null;
        notes: string | null;
      }
    | undefined;

  if (!existing) {
    throw new ServiceError('سجل الإجراء الإداري غير موجود.', 404, 'PROCEDURE_NOT_FOUND');
  }

  const nextDate = input.procedure_date ? validateIsoDate(input.procedure_date) : existing.procedure_date;
  const nextDelivery =
    input.delivery_method !== undefined
      ? normalizeNullableString(input.delivery_method)
      : existing.delivery_method;
  const nextSummonsResult =
    input.summons_result !== undefined
      ? normalizeNullableString(input.summons_result)
      : existing.summons_result;
  const nextRecordedBy =
    input.recorded_by !== undefined
      ? normalizeNullableString(input.recorded_by)
      : existing.recorded_by;
  const nextNotes =
    input.notes !== undefined ? normalizeNullableString(input.notes) : existing.notes;

  db.prepare(
    `UPDATE student_legal_procedures
     SET procedure_date = ?,
         delivery_method = ?,
         summons_result = ?,
         recorded_by = ?,
         notes = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(nextDate, nextDelivery, nextSummonsResult, nextRecordedBy, nextNotes, procedureId);

  return db
    .prepare(
      `SELECT p.*, st.full_name as student_name, st.student_uid, st.registry_number,
              ay.name as academic_year_name, g.name as grade_name, sec.name as section_name
       FROM student_legal_procedures p
       JOIN students st ON st.id = p.student_id
       JOIN academic_years ay ON ay.id = p.academic_year_id
       JOIN grades g ON g.id = p.grade_id
       JOIN sections sec ON sec.id = p.section_id
       WHERE p.id = ?`
    )
    .get(procedureId) as StudentLegalProcedureRecord;
}

export function deleteStudentLegalProcedure(db: SqliteDb, procedureId: number): void {
  const existing = db
    .prepare('SELECT id FROM student_legal_procedures WHERE id = ?')
    .get(procedureId) as { id: number } | undefined;
  if (!existing) {
    throw new ServiceError('سجل الإجراء الإداري غير موجود.', 404, 'PROCEDURE_NOT_FOUND');
  }
  db.prepare('DELETE FROM student_legal_procedures WHERE id = ?').run(procedureId);
}

export async function generateReportsExcel(
  db: SqliteDb,
  query: ReportsCenterQuery
): Promise<{ buffer: Buffer; filename: string }> {
  const reportData = getReportsCenterData(db, query);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = reportData.school_settings.school_name;
  workbook.created = new Date();

  const sheetTitle = REPORT_TYPE_LABELS[reportData.report_type];
  const sheet = workbook.addWorksheet('التقرير', {
    views: [{ rightToLeft: true }],
  });

  sheet.mergeCells('A1:J1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = `${reportData.school_settings.directorate_name} — ${reportData.school_settings.school_name}`;
  titleCell.font = { bold: true, size: 13 };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

  sheet.mergeCells('A2:J2');
  const subCell = sheet.getCell('A2');
  subCell.value = `${sheetTitle} — العام الدراسي ${reportData.academic_year.name}`;
  subCell.font = { bold: true, size: 12 };
  subCell.alignment = { horizontal: 'center', vertical: 'middle' };

  const headers = [
    'ت',
    'اسم الطالب',
    'رقم القيد',
    'الصف والشعبة',
    'المرحلة الدراسية',
    'الغياب المحتسب',
    'الغياب دون عذر',
    'الحد المحدد للإجراء',
    'المتبقي للحد التالي',
    'حالة الإجراء وتاريخ آخر تبليغ',
  ];

  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' },
    };
    cell.border = {
      top: { style: 'thin' },
      bottom: { style: 'thin' },
      left: { style: 'thin' },
      right: { style: 'thin' },
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });

  reportData.rows.forEach((row, index) => {
    const lastDate = row.last_action_date
      ? `${row.last_action_label ?? ''} (${row.last_action_date})`
      : 'لا يوجد إجراء مسجل';
    const dataRow = sheet.addRow([
      index + 1,
      row.full_name,
      row.registry_number ?? row.student_uid,
      `${row.grade_name} — ${row.section_name}`,
      row.stage_name ?? 'غير محدد',
      row.counted_legal_absence_days,
      row.unexcused_absence_days,
      row.report_threshold_days ?? '—',
      row.remaining_days_to_next_threshold !== null ? row.remaining_days_to_next_threshold : '—',
      `${row.procedure_status_label} | ${lastDate}`,
    ]);
    dataRow.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin' },
        bottom: { style: 'thin' },
        left: { style: 'thin' },
        right: { style: 'thin' },
      };
      cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    });
  });

  sheet.columns = [
    { width: 6 },
    { width: 28 },
    { width: 14 },
    { width: 22 },
    { width: 18 },
    { width: 14 },
    { width: 14 },
    { width: 16 },
    { width: 16 },
    { width: 34 },
  ];

  const rawBuf = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.isBuffer(rawBuf) ? rawBuf : Buffer.from(rawBuf as ArrayBuffer);
  const safeName = `${sheetTitle.replace(/\s+/g, '_')}_${reportData.academic_year.name}.xlsx`;
  return { buffer, filename: safeName };
}
