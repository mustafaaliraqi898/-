import ExcelJS from 'exceljs';
import type {
  AbsenceAlertLevel,
  AbsenceReportsQuery,
  AbsenceReportsResponse,
  AbsenceReportsSummary,
  AbsenceReportStudentRow,
  AbsenceReportTypeId,
  AbsenceThresholdsSettings,
} from '../../src/types/school';
import type { SqliteDb } from '../db/connection';
import { ServiceError } from '../utils/validation';
import { getAcademicYearAbsenceTotalsMap } from './absenceService';
import { getSimplifiedAbsenceThresholds } from './legalRegulationsService';
import { getActiveAcademicYear, getSchoolSettings } from './settingsService';

const VALID_REPORT_TYPES = new Set<AbsenceReportTypeId>([
  'warning',
  'preliminary_warning',
  'final_warning',
  'exceeded_limit',
]);

export const REPORT_TYPE_TITLES: Record<AbsenceReportTypeId, string> = {
  warning: 'تقرير الطلاب الذين بلغوا عتبة التحذير',
  preliminary_warning: 'تقرير الطلاب الذين بلغوا عتبة الإنذار الأولي',
  final_warning: 'تقرير الطلاب الذين بلغوا عتبة الإنذار النهائي',
  exceeded_limit: 'تقرير الطلاب المتجاوزين لحد الغياب المؤثر',
};

export const ALERT_LEVEL_LABELS: Record<AbsenceAlertLevel, string> = {
  within_limit: 'ضمن الحد المسموح',
  warning: 'تحذير',
  preliminary_warning: 'إنذار أولي',
  final_warning: 'إنذار نهائي',
  exceeded_limit: 'متجاوز لحد الغياب المؤثر',
};

function resolveThresholdForReport(
  reportType: AbsenceReportTypeId,
  thresholds: AbsenceThresholdsSettings
): number {
  switch (reportType) {
    case 'warning':
      return thresholds.warning_days;
    case 'preliminary_warning':
      return thresholds.preliminary_warning_days;
    case 'final_warning':
      return thresholds.final_warning_days;
    case 'exceeded_limit':
      return thresholds.effective_absence_limit;
  }
}

function classifyStudentAlert(
  countedDays: number,
  thresholds: AbsenceThresholdsSettings
): { alert_level: AbsenceAlertLevel; alert_label: string } {
  if (countedDays >= thresholds.effective_absence_limit) {
    return {
      alert_level: 'exceeded_limit',
      alert_label: ALERT_LEVEL_LABELS.exceeded_limit,
    };
  }
  if (countedDays >= thresholds.final_warning_days) {
    return {
      alert_level: 'final_warning',
      alert_label: ALERT_LEVEL_LABELS.final_warning,
    };
  }
  if (countedDays >= thresholds.preliminary_warning_days) {
    return {
      alert_level: 'preliminary_warning',
      alert_label: ALERT_LEVEL_LABELS.preliminary_warning,
    };
  }
  if (countedDays >= thresholds.warning_days) {
    return {
      alert_level: 'warning',
      alert_label: ALERT_LEVEL_LABELS.warning,
    };
  }
  return {
    alert_level: 'within_limit',
    alert_label: ALERT_LEVEL_LABELS.within_limit,
  };
}

export function getSimplifiedAbsenceReports(
  db: SqliteDb,
  query: AbsenceReportsQuery
): AbsenceReportsResponse {
  if (!VALID_REPORT_TYPES.has(query.report_type)) {
    throw new ServiceError('نوع التقرير المطلوب غير صالح.', 400, 'INVALID_REPORT_TYPE');
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
  const thresholds = getSimplifiedAbsenceThresholds(db, academicYear.id);
  const reportThresholdDays = resolveThresholdForReport(query.report_type, thresholds);

  const enrollments = db
    .prepare(
      `SELECT st.id as student_id, st.student_uid, st.registry_number, st.full_name,
              g.id as grade_id, g.name as grade_name,
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
    grade_id: number;
    grade_name: string;
    section_id: number;
    section_name: string;
  }>;

  // Direct single-source-of-truth read from absenceService.ts
  const totalsMap = getAcademicYearAbsenceTotalsMap(db, academicYear.id);

  const summary: AbsenceReportsSummary = {
    total_active_students: enrollments.length,
    within_limit_count: 0,
    warning_count: 0,
    preliminary_warning_count: 0,
    final_warning_count: 0,
    exceeded_limit_count: 0,
  };

  const allRows: AbsenceReportStudentRow[] = enrollments.map((st) => {
    const totals = totalsMap.get(st.student_id);
    const directFullDays = totals?.direct_full_days ?? 0;
    const countedDailyPermissionDays = totals?.counted_daily_permission_days ?? 0;
    const convertedLessonDays = totals?.converted_lesson_days ?? 0;
    const countedAbsenceDays = totals?.total_full_days ?? 0;
    const pendingLessons = totals?.pending_lessons ?? 0;

    if (countedAbsenceDays < thresholds.warning_days) {
      summary.within_limit_count += 1;
    }
    if (countedAbsenceDays >= thresholds.warning_days) {
      summary.warning_count += 1;
    }
    if (countedAbsenceDays >= thresholds.preliminary_warning_days) {
      summary.preliminary_warning_count += 1;
    }
    if (countedAbsenceDays >= thresholds.final_warning_days) {
      summary.final_warning_count += 1;
    }
    if (countedAbsenceDays >= thresholds.effective_absence_limit) {
      summary.exceeded_limit_count += 1;
    }

    const { alert_level, alert_label } = classifyStudentAlert(countedAbsenceDays, thresholds);

    return {
      student_id: st.student_id,
      student_uid: st.student_uid,
      registry_number: st.registry_number,
      full_name: st.full_name,
      grade_id: st.grade_id,
      grade_name: st.grade_name,
      section_id: st.section_id,
      section_name: st.section_name,
      direct_full_days: directFullDays,
      counted_daily_permission_days: countedDailyPermissionDays,
      converted_lesson_days: convertedLessonDays,
      counted_absence_days: countedAbsenceDays,
      pending_lessons: pendingLessons,
      alert_level,
      alert_label,
      report_threshold_days: reportThresholdDays,
      days_over_report_threshold: Math.max(0, countedAbsenceDays - reportThresholdDays),
      remaining_to_effective_limit: Math.max(
        0,
        thresholds.effective_absence_limit - countedAbsenceDays
      ),
      days_over_effective_limit: Math.max(
        0,
        countedAbsenceDays - thresholds.effective_absence_limit
      ),
    };
  });

  const searchTerm = (query.search ?? '').trim().toLowerCase();

  const filteredRows = allRows.filter((row) => {
    if (query.grade_id && row.grade_id !== query.grade_id) return false;
    if (query.section_id && row.section_id !== query.section_id) return false;
    if (searchTerm) {
      const hay = `${row.full_name} ${row.registry_number ?? ''} ${row.student_uid}`.toLowerCase();
      if (!hay.includes(searchTerm)) return false;
    }

    return row.counted_absence_days >= reportThresholdDays;
  });

  filteredRows.sort((a, b) => {
    if (b.counted_absence_days !== a.counted_absence_days) {
      return b.counted_absence_days - a.counted_absence_days;
    }
    return a.full_name.localeCompare(b.full_name, 'ar');
  });

  return {
    academic_year: academicYear,
    school_settings: schoolSettings,
    report_type: query.report_type,
    thresholds,
    summary,
    rows: filteredRows,
  };
}

export async function generateSimplifiedReportsExcel(
  db: SqliteDb,
  query: AbsenceReportsQuery
): Promise<{ buffer: Buffer; filename: string }> {
  const reportData = getSimplifiedAbsenceReports(db, query);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = reportData.school_settings.school_name;
  workbook.created = new Date();

  const sheetTitle = REPORT_TYPE_TITLES[reportData.report_type];
  const thresholdDays = resolveThresholdForReport(reportData.report_type, reportData.thresholds);
  const sheet = workbook.addWorksheet('التقرير', {
    views: [{ rightToLeft: true }],
  });

  sheet.mergeCells('A1:G1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = `${reportData.school_settings.directorate_name} — ${reportData.school_settings.school_name}`;
  titleCell.font = { bold: true, size: 13 };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

  sheet.mergeCells('A2:G2');
  const subCell = sheet.getCell('A2');
  subCell.value = `${sheetTitle} (العتبة المعتمدة: ${thresholdDays} يوم فأكثر) — العام الدراسي ${reportData.academic_year.name}`;
  subCell.font = { bold: true, size: 12 };
  subCell.alignment = { horizontal: 'center', vertical: 'middle' };

  const headers = [
    'ت',
    'اسم الطالب',
    'رقم القيد',
    'الصف',
    'الشعبة',
    'عدد أيام الغياب المحتسبة',
    'نوع التحذير أو الإنذار',
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
    const dataRow = sheet.addRow([
      index + 1,
      row.full_name,
      row.registry_number ?? row.student_uid,
      row.grade_name,
      row.section_name,
      row.counted_absence_days,
      row.alert_label,
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
    { width: 30 },
    { width: 15 },
    { width: 18 },
    { width: 14 },
    { width: 22 },
    { width: 26 },
  ];

  const rawBuf = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.isBuffer(rawBuf) ? rawBuf : Buffer.from(rawBuf as ArrayBuffer);
  const safeName = `${sheetTitle.replace(/\s+/g, '_')}_${reportData.academic_year.name}.xlsx`;
  return { buffer, filename: safeName };
}
