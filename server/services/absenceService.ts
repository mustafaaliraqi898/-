import type {
  AbsenceStatus,
  AcademicYear,
  AttendanceEntryInput,
  AttendanceSessionInfo,
  ConversionContributingLesson,
  LeaveType,
  LessonDetailInput,
  LessonDetailItem,
  LessonStatusType,
  PermissionType,
  SaveSectionAttendanceInput,
  SaveSectionAttendanceResult,
  SchoolSettings,
  SectionAttendanceSheet,
  StudentAbsenceDetailResponse,
  StudentAbsenceSheetRow,
} from '../../src/types/school';
import type { SqliteDb } from '../db/connection';
import { ServiceError, normalizeNullableString } from '../utils/validation';
import { resolveDateHolidayStatus } from './holidayService';
import { getActiveAcademicYear, getSchoolSettings } from './settingsService';

const VALID_STATUSES: ReadonlySet<string> = new Set([
  'present',
  'full_day',
  'lesson_absence',
  'full_day_leave',
  'lesson_permission',
  'lesson_escape',
]);

const VALID_LESSON_STATUSES: ReadonlySet<string> = new Set([
  'lesson_absence',
  'lesson_permission',
  'lesson_escape',
]);

function validateDateIso(rawDate: string | undefined): string {
  const dateStr = (rawDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new ServiceError('صيغة تاريخ الغياب غير صالحة. يجب أن تكون بصيغة YYYY-MM-DD.', 400);
  }
  const parsed = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new ServiceError('التاريخ المحدد غير صالح.', 400);
  }
  return dateStr;
}

function verifyYearGradeSection(
  db: SqliteDb,
  academicYearId: number | undefined,
  gradeId: number,
  sectionId: number
): {
  year: AcademicYear;
  grade_id: number;
  grade_name: string;
  section_id: number;
  section_name: string;
} {
  const year = academicYearId
    ? (db
        .prepare('SELECT id, name, is_active, created_at FROM academic_years WHERE id = ?')
        .get(academicYearId) as AcademicYear | undefined)
    : getActiveAcademicYear(db);

  if (!year) {
    throw new ServiceError('السنة الدراسية المحددة غير موجودة.', 404, 'YEAR_NOT_FOUND');
  }

  const gs = db
    .prepare(
      `SELECT g.id as grade_id, g.name as grade_name, s.id as section_id, s.name as section_name
       FROM sections s
       JOIN grades g ON g.id = s.grade_id
       WHERE s.id = ? AND g.id = ?`
    )
    .get(sectionId, gradeId) as
    | { grade_id: number; grade_name: string; section_id: number; section_name: string }
    | undefined;

  if (!gs) {
    throw new ServiceError('الصف أو الشعبة المحددة غير صالحة أو غير مرتبطة ببعضها.', 400);
  }

  return { year, ...gs };
}

interface NormalizedAbsenceEntry {
  student_id: number;
  status: AbsenceStatus;
  lessons_count: number;
  leave_type: LeaveType | null;
  permission_type: PermissionType | null;
  lesson_numbers: number[];
  lesson_numbers_json: string | null;
  lesson_details: LessonDetailItem[];
  counted_as_absence: number;
  permission_rule_snapshot: number | null;
  notes: string | null;
}

function isLessonStatus(status: string): status is LessonStatusType {
  return VALID_LESSON_STATUSES.has(status);
}

function resolvePrimaryLessonStatus(
  requestedStatus: AbsenceStatus,
  details: LessonDetailItem[]
): LessonStatusType {
  if (details.length === 0) {
    return isLessonStatus(requestedStatus) ? requestedStatus : 'lesson_absence';
  }
  const hasEscape = details.some((d) => d.lesson_status === 'lesson_escape');
  const hasAbsence = details.some((d) => d.lesson_status === 'lesson_absence');
  const hasPermission = details.some((d) => d.lesson_status === 'lesson_permission');

  if (isLessonStatus(requestedStatus) && details.some((d) => d.lesson_status === requestedStatus)) {
    return requestedStatus;
  }
  if (hasEscape) return 'lesson_escape';
  if (hasAbsence) return 'lesson_absence';
  if (hasPermission) return 'lesson_permission';
  return 'lesson_absence';
}

function normalizeAbsenceEntry(
  entry: AttendanceEntryInput,
  settings: SchoolSettings
): NormalizedAbsenceEntry {
  const studentId = Number(entry.student_id);
  if (!Number.isInteger(studentId) || studentId <= 0) {
    throw new ServiceError('معرف الطالب غير صالح.', 400);
  }

  const status = entry.status;
  if (!VALID_STATUSES.has(status)) {
    throw new ServiceError('حالة الحضور المدخلة غير صالحة.', 400);
  }

  const rawLeaveType = entry.leave_type ?? null;
  const rawLessonNumbers = Array.isArray(entry.lesson_numbers) ? entry.lesson_numbers : [];
  const rawLessonDetails = Array.isArray(entry.lesson_details) ? entry.lesson_details : [];
  const maxDailyLessons = Math.max(1, Math.min(12, settings.daily_lessons_count || 7));
  const maxLessonAbsence = Math.max(12, maxDailyLessons);
  const currentThreshold = Math.max(1, settings.lessons_per_absence_day || 5);
  const lessonRuleSnapshot = settings.lesson_permission_counts_as_absence ? 1 : 0;

  if (status === 'full_day') {
    if (rawLeaveType !== null || rawLessonNumbers.length > 0 || rawLessonDetails.length > 0) {
      throw new ServiceError('لا يمكن تسجيل حالات الدروس أو الإجازات مع حالة غائب يوم كامل.', 400);
    }
    return {
      student_id: studentId,
      status: 'full_day',
      lessons_count: 0,
      leave_type: null,
      permission_type: null,
      lesson_numbers: [],
      lesson_numbers_json: null,
      lesson_details: [],
      counted_as_absence: 1,
      permission_rule_snapshot: null,
      notes: normalizeNullableString(entry.notes),
    };
  }

  if (status === 'present') {
    if (rawLeaveType !== null) {
      throw new ServiceError('لا يمكن تسجيل إجازة يومية مع حالة الحضور.', 400);
    }
    if (rawLessonDetails.length === 0 && rawLessonNumbers.length === 0) {
      return {
        student_id: studentId,
        status: 'present',
        lessons_count: 0,
        leave_type: null,
        permission_type: null,
        lesson_numbers: [],
        lesson_numbers_json: null,
        lesson_details: [],
        counted_as_absence: 0,
        permission_rule_snapshot: null,
        notes: normalizeNullableString(entry.notes),
      };
    }
    if (rawLessonDetails.length === 0 && rawLessonNumbers.length > 0) {
      throw new ServiceError(
        'عند تسجيل حالات دروس مع الحضور، يجب تحديد نوع حالة كل درس في lesson_details.',
        400
      );
    }
    // Falls through to shared per-lesson validation & normalization while keeping status = 'present'
  }

  if (status === 'full_day_leave') {
    if (rawLessonNumbers.length > 0 || rawLessonDetails.length > 0) {
      throw new ServiceError('لا يمكن تحديد أرقام دروس مع حالة "مجاز يوم كامل".', 400);
    }
    if (rawLeaveType !== 'sick_leave' && rawLeaveType !== 'daily_permission') {
      throw new ServiceError(
        'عند اختيار "مجاز يوم كامل" يجب تحديد نوع الإجازة (إجازة مرضية أو رخصة يومية).',
        400
      );
    }

    if (rawLeaveType === 'sick_leave') {
      return {
        student_id: studentId,
        status,
        lessons_count: 0,
        leave_type: 'sick_leave',
        permission_type: null,
        lesson_numbers: [],
        lesson_numbers_json: null,
        lesson_details: [],
        counted_as_absence: 0,
        permission_rule_snapshot: null,
        notes: normalizeNullableString(entry.notes),
      };
    }

    const dailyRuleSnapshot = settings.daily_permission_counts_as_absence ? 1 : 0;
    return {
      student_id: studentId,
      status,
      lessons_count: 0,
      leave_type: 'daily_permission',
      permission_type: 'daily_permission',
      lesson_numbers: [],
      lesson_numbers_json: null,
      lesson_details: [],
      counted_as_absence: dailyRuleSnapshot,
      permission_rule_snapshot: dailyRuleSnapshot,
      notes: normalizeNullableString(entry.notes),
    };
  }

  // Lesson-level statuses OR 'present' combined with lesson_details
  if (rawLeaveType !== null) {
    throw new ServiceError('لا يمكن تحديد نوع إجازة يومية مع حالات الدروس.', 400);
  }

  // Preferred path 1: Explicit per-lesson details (supports single or mixed reasons on different lessons)
  if (rawLessonDetails.length > 0) {
    const seenLessonNums = new Set<number>();
    const normalizedDetails: LessonDetailItem[] = [];

    for (const rawDetail of rawLessonDetails) {
      const lessonNum = Number(rawDetail?.lesson_number);
      const lessonStatus = rawDetail?.lesson_status;
      if (!Number.isInteger(lessonNum) || lessonNum < 1 || lessonNum > maxDailyLessons) {
        throw new ServiceError(
          `رقم الدرس (${rawDetail?.lesson_number}) غير صالح. الدروس المتاحة حسب الإعدادات من 1 إلى ${maxDailyLessons}.`,
          400
        );
      }
      if (!lessonStatus || !isLessonStatus(lessonStatus)) {
        throw new ServiceError('نوع حالة الدرس المحددة غير صالح.', 400);
      }
      if (seenLessonNums.has(lessonNum)) {
        throw new ServiceError(
          `لا يجوز تسجيل أكثر من سبب لعدم حضور الطالب في الدرس رقم ${lessonNum} بالتاريخ نفسه.`,
          409,
          'DUPLICATE_LESSON_ENTRY'
        );
      }
      seenLessonNums.add(lessonNum);

      const isPerm = lessonStatus === 'lesson_permission';
      normalizedDetails.push({
        lesson_number: lessonNum,
        lesson_status: lessonStatus,
        counted_as_absence: isPerm ? lessonRuleSnapshot : 1,
        permission_rule_snapshot: isPerm ? lessonRuleSnapshot : null,
        threshold_snapshot: currentThreshold,
      });
    }

    normalizedDetails.sort((a, b) => a.lesson_number - b.lesson_number);
    const lessonNumbers = normalizedDetails.map((d) => d.lesson_number);
    const storedStatus: AbsenceStatus =
      status === 'present' ? 'present' : resolvePrimaryLessonStatus(status, normalizedDetails);
    const hasPermissionDetail = normalizedDetails.some(
      (d) => d.lesson_status === 'lesson_permission'
    );
    const anyCounted = normalizedDetails.some((d) => d.counted_as_absence === 1);

    return {
      student_id: studentId,
      status: storedStatus,
      lessons_count: normalizedDetails.length,
      leave_type: null,
      permission_type: hasPermissionDetail ? 'lesson_permission' : null,
      lesson_numbers: lessonNumbers,
      lesson_numbers_json: JSON.stringify(lessonNumbers),
      lesson_details: normalizedDetails,
      counted_as_absence: anyCounted ? 1 : 0,
      permission_rule_snapshot: hasPermissionDetail ? lessonRuleSnapshot : null,
      notes: normalizeNullableString(entry.notes),
    };
  }

  // Preferred path 2: Unified lesson_numbers array for the selected lesson status
  if (rawLessonNumbers.length > 0) {
    const seenLessonNums = new Set<number>();
    for (const rawNum of rawLessonNumbers) {
      const num = Number(rawNum);
      if (!Number.isInteger(num) || num < 1 || num > maxDailyLessons) {
        throw new ServiceError(
          `رقم الدرس (${rawNum}) غير صالح. الدروس المتاحة حسب الإعدادات من 1 إلى ${maxDailyLessons}.`,
          400
        );
      }
      if (seenLessonNums.has(num)) {
        throw new ServiceError(
          `لا يجوز تكرار رقم الدرس (${num}) أكثر من مرة في التاريخ نفسه.`,
          409,
          'DUPLICATE_LESSON_ENTRY'
        );
      }
      seenLessonNums.add(num);
    }

    const sortedLessons = Array.from(seenLessonNums).sort((a, b) => a - b);
    const isPerm = status === 'lesson_permission';
    const details: LessonDetailItem[] = sortedLessons.map((num) => ({
      lesson_number: num,
      lesson_status: status as LessonStatusType,
      counted_as_absence: isPerm ? lessonRuleSnapshot : 1,
      permission_rule_snapshot: isPerm ? lessonRuleSnapshot : null,
      threshold_snapshot: currentThreshold,
    }));

    return {
      student_id: studentId,
      status,
      lessons_count: sortedLessons.length,
      leave_type: null,
      permission_type: isPerm ? 'lesson_permission' : null,
      lesson_numbers: sortedLessons,
      lesson_numbers_json: JSON.stringify(sortedLessons),
      lesson_details: details,
      counted_as_absence: isPerm ? lessonRuleSnapshot : 1,
      permission_rule_snapshot: isPerm ? lessonRuleSnapshot : null,
      notes: normalizeNullableString(entry.notes),
    };
  }

  // Backward-compatible legacy fallback ONLY for historical lesson_absence callers passing lessons_count without lesson_numbers
  if (status === 'lesson_absence' && entry.lessons_count !== undefined && entry.lessons_count !== null) {
    const parsedLessons = Number(entry.lessons_count);
    if (!Number.isInteger(parsedLessons) || parsedLessons < 1 || parsedLessons > maxLessonAbsence) {
      throw new ServiceError(
        `عند اختيار "غائب عن درس" يجب تحديد الدروس أو عدد صحيح بين 1 و ${maxLessonAbsence}.`,
        400
      );
    }
    return {
      student_id: studentId,
      status: 'lesson_absence',
      lessons_count: parsedLessons,
      leave_type: null,
      permission_type: null,
      lesson_numbers: [],
      lesson_numbers_json: null,
      lesson_details: [],
      counted_as_absence: 1,
      permission_rule_snapshot: null,
      notes: normalizeNullableString(entry.notes),
    };
  }

  const label =
    status === 'lesson_permission'
      ? 'رخصة عن درس'
      : status === 'lesson_escape'
        ? 'هروب من درس'
        : 'غائب عن درس';
  throw new ServiceError(
    `عند اختيار "${label}" يجب تحديد درس واحد على الأقل من قائمة الدروس.`,
    400
  );
}

function parseLessonNumbersFallback(jsonStr: string | null): number[] {
  if (!jsonStr) return [];
  try {
    const arr = JSON.parse(jsonStr);
    if (Array.isArray(arr)) {
      return arr
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12)
        .sort((a, b) => a - b);
    }
  } catch {
    // ignore malformed json
  }
  return [];
}

function loadLessonDetailsMap(db: SqliteDb, absenceIds: number[]): Map<number, LessonDetailItem[]> {
  const map = new Map<number, LessonDetailItem[]>();
  if (absenceIds.length === 0) return map;

  const placeholders = absenceIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT absence_id, lesson_number, lesson_status, counted_as_absence,
              permission_rule_snapshot, threshold_snapshot
       FROM absence_lesson_details
       WHERE absence_id IN (${placeholders})
       ORDER BY lesson_number ASC`
    )
    .all(...absenceIds) as Array<{
    absence_id: number;
    lesson_number: number;
    lesson_status: LessonStatusType;
    counted_as_absence: number;
    permission_rule_snapshot: number | null;
    threshold_snapshot: number;
  }>;

  for (const r of rows) {
    const item: LessonDetailItem = {
      lesson_number: r.lesson_number,
      lesson_status: r.lesson_status,
      counted_as_absence: r.counted_as_absence,
      permission_rule_snapshot: r.permission_rule_snapshot,
      threshold_snapshot: r.threshold_snapshot,
    };
    const list = map.get(r.absence_id);
    if (list) list.push(item);
    else map.set(r.absence_id, [item]);
  }
  return map;
}

function parseContributingLessonsJson(jsonStr: string | null): ConversionContributingLesson[] {
  if (!jsonStr) return [];
  try {
    const arr = JSON.parse(jsonStr);
    if (Array.isArray(arr)) {
      return arr.filter(
        (item) =>
          item &&
          typeof item === 'object' &&
          typeof item.absence_date === 'string' &&
          typeof item.lesson_status === 'string'
      ) as ConversionContributingLesson[];
    }
  } catch {
    // ignore malformed json
  }
  return [];
}

function syncAbsenceLessonDetails(
  db: SqliteDb,
  absenceId: number,
  studentId: number,
  absenceDate: string,
  lessonDetails: LessonDetailItem[]
): void {
  db.prepare('DELETE FROM absence_lesson_details WHERE absence_id = ?').run(absenceId);
  if (lessonDetails.length === 0) return;

  const checkConflict = db.prepare(
    `SELECT lesson_number, lesson_status
     FROM absence_lesson_details
     WHERE student_id = ? AND absence_date = ? AND lesson_number = ? AND absence_id != ?`
  );

  const insertDetail = db.prepare(
    `INSERT INTO absence_lesson_details
       (absence_id, student_id, absence_date, lesson_number, lesson_status,
        counted_as_absence, permission_rule_snapshot, threshold_snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const detail of lessonDetails) {
    const conflict = checkConflict.get(studentId, absenceDate, detail.lesson_number, absenceId) as
      | { lesson_number: number; lesson_status: LessonStatusType }
      | undefined;
    if (conflict) {
      throw new ServiceError(
        `لا يجوز تسجيل أكثر من سبب لعدم حضور الطالب في الدرس رقم ${detail.lesson_number} بتاريخ ${absenceDate}.`,
        409,
        'DUPLICATE_LESSON_ENTRY'
      );
    }
    insertDetail.run(
      absenceId,
      studentId,
      absenceDate,
      detail.lesson_number,
      detail.lesson_status,
      detail.counted_as_absence,
      detail.permission_rule_snapshot,
      Math.max(1, detail.threshold_snapshot || 5)
    );
  }
}

function isLessonCounterStatus(status: AbsenceStatus): boolean {
  return (
    status === 'lesson_absence' ||
    status === 'lesson_permission' ||
    status === 'lesson_escape'
  );
}

/**
 * Deterministically reconciles converted absence days from preserved daily lesson records
 * (lesson_absence, lesson_escape, and counted lesson_permission) for a student in an academic year.
 * - Counts year-wide chronologically without resetting at month boundaries.
 * - Uses each detail/row's stored threshold_snapshot & counted_as_absence snapshot.
 * - Never modifies or deletes historical records.
 * - Preserves exact contributing lesson breakdown per converted day.
 */
function reconcileStudentLessonCounter(
  db: SqliteDb,
  studentId: number,
  academicYearId: number
): number {
  const beforeRow = db
    .prepare(
      'SELECT COUNT(*) as count FROM lesson_converted_days WHERE student_id = ? AND academic_year_id = ?'
    )
    .get(studentId, academicYearId) as { count: number };

  db.prepare(
    'DELETE FROM lesson_converted_days WHERE student_id = ? AND academic_year_id = ?'
  ).run(studentId, academicYearId);

  const lessonRows = db
    .prepare(
      `SELECT id, grade_id, section_id, absence_date, status, lessons_count,
              counted_as_absence, threshold_snapshot
       FROM absences
       WHERE student_id = ? AND academic_year_id = ?
         AND (
           status IN ('lesson_absence', 'lesson_permission', 'lesson_escape')
           OR EXISTS (SELECT 1 FROM absence_lesson_details ald WHERE ald.absence_id = absences.id)
         )
       ORDER BY absence_date ASC, id ASC`
    )
    .all(studentId, academicYearId) as Array<{
    id: number;
    grade_id: number;
    section_id: number;
    absence_date: string;
    status: AbsenceStatus;
    lessons_count: number;
    counted_as_absence: number;
    threshold_snapshot: number;
  }>;

  const detailsMap = loadLessonDetailsMap(
    db,
    lessonRows.map((r) => r.id)
  );

  interface CounterUnit {
    absence_id: number;
    absence_date: string;
    grade_id: number;
    section_id: number;
    lesson_number: number | null;
    lesson_status: LessonStatusType;
    threshold: number;
  }

  const countedUnits: CounterUnit[] = [];

  for (const row of lessonRows) {
    const details = detailsMap.get(row.id) ?? [];
    if (details.length > 0) {
      for (const d of details) {
        const isCounted =
          d.lesson_status === 'lesson_absence' ||
          d.lesson_status === 'lesson_escape' ||
          (d.lesson_status === 'lesson_permission' && d.counted_as_absence === 1);
        if (isCounted) {
          countedUnits.push({
            absence_id: row.id,
            absence_date: row.absence_date,
            grade_id: row.grade_id,
            section_id: row.section_id,
            lesson_number: d.lesson_number,
            lesson_status: d.lesson_status,
            threshold: Math.max(1, d.threshold_snapshot || row.threshold_snapshot),
          });
        }
      }
    } else {
      // Legacy lesson_absence (or count-only row without detail rows)
      const isCounted =
        row.status === 'lesson_absence' ||
        row.status === 'lesson_escape' ||
        (row.status === 'lesson_permission' && row.counted_as_absence === 1);
      if (isCounted && row.lessons_count > 0 && isLessonStatus(row.status)) {
        const threshold = Math.max(1, row.threshold_snapshot);
        for (let i = 0; i < row.lessons_count; i += 1) {
          countedUnits.push({
            absence_id: row.id,
            absence_date: row.absence_date,
            grade_id: row.grade_id,
            section_id: row.section_id,
            lesson_number: null,
            lesson_status: row.status,
            threshold,
          });
        }
      }
    }
  }

  const insertConversion = db.prepare(
    `INSERT INTO lesson_converted_days
       (student_id, academic_year_id, grade_id, section_id, source_absence_id,
        converted_date, lessons_consumed, threshold_used, contributing_lessons_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const pendingQueue: CounterUnit[] = [];
  let newTotalConverted = 0;

  for (const unit of countedUnits) {
    pendingQueue.push(unit);
    const threshold = unit.threshold;

    while (pendingQueue.length >= threshold) {
      const consumed = pendingQueue.splice(0, threshold);
      const contributingPayload: ConversionContributingLesson[] = consumed.map((c) => ({
        absence_id: c.absence_id,
        absence_date: c.absence_date,
        lesson_number: c.lesson_number,
        lesson_status: c.lesson_status,
      }));
      insertConversion.run(
        studentId,
        academicYearId,
        unit.grade_id,
        unit.section_id,
        unit.absence_id,
        unit.absence_date,
        threshold,
        threshold,
        JSON.stringify(contributingPayload)
      );
      newTotalConverted += 1;
    }
  }

  return newTotalConverted - beforeRow.count;
}

function buildEffectiveLessonDetails(
  rowStatus: AbsenceStatus,
  lessonsCount: number,
  lessonNumbersJson: string | null,
  countedAsAbsence: number,
  permissionRuleSnapshot: number | null,
  thresholdSnapshot: number,
  storedDetails: LessonDetailItem[] | undefined
): { lesson_numbers: number[]; lesson_details: LessonDetailItem[] } {
  if (storedDetails && storedDetails.length > 0) {
    return {
      lesson_numbers: storedDetails.map((d) => d.lesson_number),
      lesson_details: storedDetails,
    };
  }
  if (!isLessonStatus(rowStatus)) {
    return { lesson_numbers: [], lesson_details: [] };
  }
  const fallbackNums = parseLessonNumbersFallback(lessonNumbersJson);
  if (fallbackNums.length > 0) {
    const isPerm = rowStatus === 'lesson_permission';
    return {
      lesson_numbers: fallbackNums,
      lesson_details: fallbackNums.map((num) => ({
        lesson_number: num,
        lesson_status: rowStatus,
        counted_as_absence: isPerm ? countedAsAbsence : 1,
        permission_rule_snapshot: isPerm ? permissionRuleSnapshot : null,
        threshold_snapshot: thresholdSnapshot,
      })),
    };
  }
  return {
    lesson_numbers: [],
    lesson_details: [],
  };
}

export interface StudentAcademicYearAbsenceTotals {
  student_id: number;
  direct_full_days: number;
  counted_daily_permission_days: number;
  sick_leave_days: number;
  daily_permission_days: number;
  lesson_permission_records: number;
  lesson_absence_lessons: number;
  lesson_escape_lessons: number;
  counted_lesson_permission_lessons: number;
  converted_lesson_days: number;
  total_full_days: number;
  pending_lessons: number;
  total_lessons_missed: number;
}

export function getAcademicYearAbsenceTotalsMap(
  db: SqliteDb,
  academicYearId: number
): Map<number, StudentAcademicYearAbsenceTotals> {
  const summaryRows = db
    .prepare(
      `WITH lesson_detail_agg AS (
         SELECT
           d.absence_id,
           COUNT(*) as detail_count,
           SUM(CASE WHEN d.lesson_status = 'lesson_permission' THEN 1 ELSE 0 END) as perm_detail_count,
           SUM(CASE WHEN d.lesson_status = 'lesson_absence' THEN 1 ELSE 0 END) as absence_detail_count,
           SUM(CASE WHEN d.lesson_status = 'lesson_escape' THEN 1 ELSE 0 END) as escape_detail_count,
           SUM(CASE WHEN d.lesson_status = 'lesson_permission' AND d.counted_as_absence = 1 THEN 1 ELSE 0 END) as counted_perm_detail_count,
           SUM(CASE
             WHEN d.lesson_status IN ('lesson_absence', 'lesson_escape')
               OR (d.lesson_status = 'lesson_permission' AND d.counted_as_absence = 1)
             THEN 1 ELSE 0 END) as counted_total_detail_count
         FROM absence_lesson_details d
         JOIN absences a_yr ON a_yr.id = d.absence_id
         WHERE a_yr.academic_year_id = ?
         GROUP BY d.absence_id
       )
       SELECT
         a.student_id,
         SUM(CASE WHEN a.status = 'full_day' THEN 1 ELSE 0 END) as direct_full_days,
         SUM(CASE WHEN a.status = 'full_day_leave' AND a.leave_type = 'daily_permission' AND a.counted_as_absence = 1 THEN 1 ELSE 0 END) as counted_daily_permission_days,
         SUM(CASE WHEN a.status = 'full_day_leave' AND a.leave_type = 'sick_leave' THEN 1 ELSE 0 END) as sick_leave_days,
         SUM(CASE WHEN a.status = 'full_day_leave' AND a.leave_type = 'daily_permission' THEN 1 ELSE 0 END) as daily_permission_days,
         SUM(CASE
           WHEN a.status = 'lesson_permission'
             OR COALESCE(lda.perm_detail_count, 0) > 0
           THEN 1 ELSE 0 END) as lesson_permission_records,
         COALESCE(SUM(CASE
           WHEN COALESCE(lda.detail_count, 0) > 0 THEN lda.absence_detail_count
           WHEN a.status = 'lesson_absence' THEN a.lessons_count
           ELSE 0 END), 0) as lesson_absence_lessons,
         COALESCE(SUM(CASE
           WHEN COALESCE(lda.detail_count, 0) > 0 THEN lda.escape_detail_count
           WHEN a.status = 'lesson_escape' THEN a.lessons_count
           ELSE 0 END), 0) as lesson_escape_lessons,
         COALESCE(SUM(CASE
           WHEN COALESCE(lda.detail_count, 0) > 0 THEN lda.counted_perm_detail_count
           WHEN a.status = 'lesson_permission' AND a.counted_as_absence = 1 THEN a.lessons_count
           ELSE 0 END), 0) as counted_lesson_permission_lessons,
         COALESCE(SUM(CASE
           WHEN COALESCE(lda.detail_count, 0) > 0 THEN lda.counted_total_detail_count
           WHEN a.status IN ('lesson_absence', 'lesson_escape') OR (a.status = 'lesson_permission' AND a.counted_as_absence = 1) THEN a.lessons_count
           ELSE 0 END), 0) as total_lessons_missed
       FROM absences a
       LEFT JOIN lesson_detail_agg lda ON lda.absence_id = a.id
       WHERE a.academic_year_id = ?
       GROUP BY a.student_id`
    )
    .all(academicYearId, academicYearId) as Array<{
    student_id: number;
    direct_full_days: number;
    counted_daily_permission_days: number;
    sick_leave_days: number;
    daily_permission_days: number;
    lesson_permission_records: number;
    lesson_absence_lessons: number;
    lesson_escape_lessons: number;
    counted_lesson_permission_lessons: number;
    total_lessons_missed: number;
  }>;

  const convertedRows = db
    .prepare(
      `SELECT student_id, COUNT(*) as converted_days, COALESCE(SUM(lessons_consumed), 0) as consumed_lessons
       FROM lesson_converted_days
       WHERE academic_year_id = ?
       GROUP BY student_id`
    )
    .all(academicYearId) as Array<{
    student_id: number;
    converted_days: number;
    consumed_lessons: number;
  }>;

  const convertedMap = new Map<number, { converted_days: number; consumed_lessons: number }>();
  for (const r of convertedRows) {
    convertedMap.set(r.student_id, {
      converted_days: r.converted_days,
      consumed_lessons: r.consumed_lessons,
    });
  }

  const result = new Map<number, StudentAcademicYearAbsenceTotals>();
  for (const sum of summaryRows) {
    const conv = convertedMap.get(sum.student_id) ?? { converted_days: 0, consumed_lessons: 0 };
    result.set(sum.student_id, {
      ...sum,
      converted_lesson_days: conv.converted_days,
      total_full_days: sum.direct_full_days + sum.counted_daily_permission_days + conv.converted_days,
      pending_lessons: Math.max(0, sum.total_lessons_missed - conv.consumed_lessons),
    });
  }
  return result;
}

export function getSectionAttendanceSheet(
  db: SqliteDb,
  params: {
    academic_year_id?: number;
    grade_id: number;
    section_id: number;
    attendance_date: string;
  }
): SectionAttendanceSheet {
  const attendanceDate = validateDateIso(params.attendance_date);
  const { year, grade_id, grade_name, section_id, section_name } = verifyYearGradeSection(
    db,
    params.academic_year_id,
    params.grade_id,
    params.section_id
  );

  const settings = getSchoolSettings(db);
  const holidayInfo = resolveDateHolidayStatus(db, attendanceDate);

  const session =
    (db
      .prepare(
        `SELECT id, academic_year_id, grade_id, section_id, attendance_date,
                recorded_count, created_at, updated_at
         FROM attendance_sessions
         WHERE academic_year_id = ? AND section_id = ? AND attendance_date = ?`
      )
      .get(year.id, section_id, attendanceDate) as AttendanceSessionInfo | undefined) ?? null;

  const roster = db
    .prepare(
      `SELECT DISTINCT st.id as student_id,
              COALESCE(day_abs.enrollment_id, se.id) as enrollment_id,
              st.student_uid, st.registry_number, st.full_name,
              day_abs.id as record_id,
              day_abs.status as saved_status,
              day_abs.lessons_count as saved_lessons_count,
              day_abs.leave_type as saved_leave_type,
              day_abs.permission_type as saved_permission_type,
              day_abs.lesson_numbers_json as saved_lesson_numbers_json,
              day_abs.counted_as_absence as saved_counted_as_absence,
              day_abs.permission_rule_snapshot as saved_permission_rule_snapshot,
              day_abs.applied_settings_at as saved_applied_settings_at,
              day_abs.threshold_snapshot as saved_threshold_snapshot,
              day_abs.notes as saved_notes,
              day_abs.created_at as record_created_at,
              day_abs.updated_at as record_updated_at
       FROM students st
       LEFT JOIN student_enrollments se
         ON se.student_id = st.id
        AND se.academic_year_id = ?
        AND se.grade_id = ?
        AND se.section_id = ?
        AND se.is_current = 1
       LEFT JOIN absences day_abs
         ON day_abs.student_id = st.id
        AND day_abs.academic_year_id = ?
        AND day_abs.section_id = ?
        AND day_abs.absence_date = ?
       WHERE (se.id IS NOT NULL AND st.status = 'active')
          OR day_abs.id IS NOT NULL
       ORDER BY st.full_name ASC, st.id ASC`
    )
    .all(
      year.id,
      grade_id,
      section_id,
      year.id,
      section_id,
      attendanceDate
    ) as Array<{
    student_id: number;
    enrollment_id: number;
    student_uid: string;
    registry_number: string | null;
    full_name: string;
    record_id: number | null;
    saved_status: AbsenceStatus | null;
    saved_lessons_count: number | null;
    saved_leave_type: LeaveType | null;
    saved_permission_type: PermissionType | null;
    saved_lesson_numbers_json: string | null;
    saved_counted_as_absence: number | null;
    saved_permission_rule_snapshot: number | null;
    saved_applied_settings_at: string | null;
    saved_threshold_snapshot: number | null;
    saved_notes: string | null;
    record_created_at: string | null;
    record_updated_at: string | null;
  }>;

  const recordIds = roster
    .map((r) => r.record_id)
    .filter((id): id is number => id !== null);
  const lessonDetailsMap = loadLessonDetailsMap(db, recordIds);

  // Cumulative counts per student for this academic year (shared read-only source of truth)
  const totalsMap = getAcademicYearAbsenceTotalsMap(db, year.id);

  const students: StudentAbsenceSheetRow[] = roster.map((r) => {
    const tot = totalsMap.get(r.student_id) ?? {
      student_id: r.student_id,
      direct_full_days: 0,
      counted_daily_permission_days: 0,
      sick_leave_days: 0,
      daily_permission_days: 0,
      lesson_permission_records: 0,
      lesson_absence_lessons: 0,
      lesson_escape_lessons: 0,
      counted_lesson_permission_lessons: 0,
      converted_lesson_days: 0,
      total_full_days: 0,
      pending_lessons: 0,
      total_lessons_missed: 0,
    };

    const savedStatus = r.saved_status ?? 'present';
    const storedDetails = r.record_id ? lessonDetailsMap.get(r.record_id) : undefined;
    const resolved = buildEffectiveLessonDetails(
      savedStatus,
      r.saved_lessons_count ?? 0,
      r.saved_lesson_numbers_json,
      r.saved_counted_as_absence ?? 0,
      r.saved_permission_rule_snapshot ?? null,
      r.saved_threshold_snapshot ?? settings.lessons_per_absence_day,
      storedDetails
    );

    const lessonsCount =
      isLessonStatus(savedStatus) || resolved.lesson_details.length > 0
        ? resolved.lesson_details.length > 0
          ? resolved.lesson_details.length
          : (r.saved_lessons_count ?? 0)
        : 0;

    return {
      student_id: r.student_id,
      enrollment_id: r.enrollment_id,
      student_uid: r.student_uid,
      registry_number: r.registry_number,
      full_name: r.full_name,
      record_id: r.record_id,
      status: savedStatus,
      lessons_count: lessonsCount,
      leave_type: r.saved_leave_type ?? null,
      permission_type: r.saved_permission_type ?? null,
      lesson_numbers: resolved.lesson_numbers,
      lesson_details: resolved.lesson_details,
      counted_as_absence: r.saved_counted_as_absence ?? 0,
      permission_rule_snapshot: r.saved_permission_rule_snapshot ?? null,
      applied_settings_at: r.saved_applied_settings_at ?? null,
      notes: r.saved_notes ?? null,
      record_created_at: r.record_created_at ?? null,
      record_updated_at: r.record_updated_at ?? null,
      has_saved_record: r.record_id !== null,
      direct_full_days: tot.direct_full_days,
      counted_daily_permission_days: tot.counted_daily_permission_days,
      sick_leave_days: tot.sick_leave_days,
      daily_permission_days: tot.daily_permission_days,
      lesson_permission_records: tot.lesson_permission_records,
      lesson_absence_lessons: tot.lesson_absence_lessons,
      lesson_escape_lessons: tot.lesson_escape_lessons,
      counted_lesson_permission_lessons: tot.counted_lesson_permission_lessons,
      converted_lesson_days: tot.converted_lesson_days,
      total_full_days: tot.total_full_days,
      pending_lessons: tot.pending_lessons,
      total_lessons_missed: tot.total_lessons_missed,
    };
  });

  return {
    academic_year: year,
    grade_id,
    grade_name,
    section_id,
    section_name,
    attendance_date: attendanceDate,
    lessons_per_absence_day: settings.lessons_per_absence_day,
    daily_lessons_count: settings.daily_lessons_count,
    daily_permission_counts_as_absence: settings.daily_permission_counts_as_absence,
    lesson_permission_counts_as_absence: settings.lesson_permission_counts_as_absence,
    holiday_info: holidayInfo,
    session,
    students,
  };
}

export function saveSectionAttendance(
  db: SqliteDb,
  input: SaveSectionAttendanceInput
): SaveSectionAttendanceResult {
  const attendanceDate = validateDateIso(input.attendance_date);
  const { year, grade_id, section_id } = verifyYearGradeSection(
    db,
    input.academic_year_id,
    input.grade_id,
    input.section_id
  );

  if (!Array.isArray(input.entries) || input.entries.length === 0) {
    throw new ServiceError('لا توجد سجلات طلاب لحفظها في هذه الشعبة.', 400);
  }

  const holidayInfo = resolveDateHolidayStatus(db, attendanceDate);
  if (holidayInfo.is_holiday) {
    throw new ServiceError(
      `لا يمكن تسجيل الحضور أو الغياب بتاريخ ${attendanceDate} (${holidayInfo.day_name}) لأنه يوم عطلة: ${holidayInfo.primary_reason ?? 'عطلة رسمية'}.`,
      409,
      'DATE_IS_HOLIDAY'
    );
  }

  const currentSettings = getSchoolSettings(db);
  const currentThreshold = currentSettings.lessons_per_absence_day;

  const seenStudentIds = new Set<number>();
  const normalizedEntries: NormalizedAbsenceEntry[] = [];

  for (const entry of input.entries) {
    const normalized = normalizeAbsenceEntry(entry, currentSettings);
    if (seenStudentIds.has(normalized.student_id)) {
      throw new ServiceError(
        'تم اكتشاف تكرار في بيانات الطالب داخل نفس الدفعة. لا يمكن تسجيل الطالب مرتين في التاريخ نفسه.',
        409,
        'DUPLICATE_STUDENT_IN_BATCH'
      );
    }
    seenStudentIds.add(normalized.student_id);
    normalizedEntries.push(normalized);
  }

  let presentCount = 0;
  let fullDayCount = 0;
  let lessonAbsenceCount = 0;
  let fullDayLeaveCount = 0;
  let lessonPermissionCount = 0;
  let lessonEscapeCount = 0;
  let totalNewlyConvertedDays = 0;

  db.transaction(() => {
    const findExistingDayRecord = db.prepare(
      `SELECT id, enrollment_id, academic_year_id, grade_id, section_id, status,
              lessons_count, leave_type, permission_type, lesson_numbers_json,
              counted_as_absence, permission_rule_snapshot, applied_settings_at,
              threshold_snapshot, notes
       FROM absences
       WHERE student_id = ? AND absence_date = ?`
    );

    const findCurrentEnrollment = db.prepare(
      `SELECT id
       FROM student_enrollments
       WHERE student_id = ? AND academic_year_id = ? AND grade_id = ? AND section_id = ? AND is_current = 1
       LIMIT 1`
    );

    const insertAbsence = db.prepare(
      `INSERT INTO absences
         (student_id, enrollment_id, academic_year_id, grade_id, section_id, absence_date,
          status, lessons_count, leave_type, permission_type, lesson_numbers_json,
          counted_as_absence, permission_rule_snapshot, applied_settings_at,
          threshold_snapshot, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, datetime('now'), datetime('now'))`
    );

    const updateAbsence = db.prepare(
      `UPDATE absences
       SET status = ?,
           lessons_count = ?,
           leave_type = ?,
           permission_type = ?,
           lesson_numbers_json = ?,
           counted_as_absence = ?,
           permission_rule_snapshot = ?,
           applied_settings_at = ?,
           threshold_snapshot = ?,
           notes = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    );

    const updateNotesOnly = db.prepare(
      `UPDATE absences SET notes = ?, updated_at = datetime('now') WHERE id = ?`
    );

    const getDbNow = db.prepare("SELECT datetime('now') as now_ts");

    for (const item of normalizedEntries) {
      if (item.status === 'present') {
        presentCount += 1;
        if (item.lesson_details.some((d) => d.lesson_status === 'lesson_absence')) {
          lessonAbsenceCount += 1;
        }
        if (item.lesson_details.some((d) => d.lesson_status === 'lesson_permission')) {
          lessonPermissionCount += 1;
        }
        if (item.lesson_details.some((d) => d.lesson_status === 'lesson_escape')) {
          lessonEscapeCount += 1;
        }
      } else if (item.status === 'full_day') fullDayCount += 1;
      else if (item.status === 'lesson_absence') lessonAbsenceCount += 1;
      else if (item.status === 'full_day_leave') fullDayLeaveCount += 1;
      else if (item.status === 'lesson_permission') lessonPermissionCount += 1;
      else if (item.status === 'lesson_escape') lessonEscapeCount += 1;

      const existing = findExistingDayRecord.get(item.student_id, attendanceDate) as
        | {
            id: number;
            enrollment_id: number;
            academic_year_id: number;
            grade_id: number;
            section_id: number;
            status: AbsenceStatus;
            lessons_count: number;
            leave_type: LeaveType | null;
            permission_type: PermissionType | null;
            lesson_numbers_json: string | null;
            counted_as_absence: number;
            permission_rule_snapshot: number | null;
            applied_settings_at: string | null;
            threshold_snapshot: number;
            notes: string | null;
          }
        | undefined;

      if (existing) {
        if (existing.section_id !== section_id || existing.academic_year_id !== year.id) {
          throw new ServiceError(
            `الطالب رقم ${item.student_id} مسجل له سجل حضور/غياب مسبق بتاريخ ${attendanceDate} في شعبة أو سنة أخرى.`,
            409,
            'DUPLICATE_ABSENCE_DATE'
          );
        }

        const existingDetails = loadLessonDetailsMap(db, [existing.id]).get(existing.id) ?? [];
        const existingDetailsSignature = JSON.stringify(
          existingDetails.map((d) => ({
            lesson_number: d.lesson_number,
            lesson_status: d.lesson_status,
          }))
        );
        const newDetailsSignature = JSON.stringify(
          item.lesson_details.map((d) => ({
            lesson_number: d.lesson_number,
            lesson_status: d.lesson_status,
          }))
        );

        const sameLegacyFallback =
          existingDetails.length === 0 &&
          item.lesson_details.length === 0 &&
          (existing.lesson_numbers_json ?? null) === item.lesson_numbers_json;

        const sameDetails =
          existingDetails.length > 0 || item.lesson_details.length > 0
            ? existingDetailsSignature === newDetailsSignature
            : sameLegacyFallback;

        const sameCoreState =
          existing.status === item.status &&
          (existing.leave_type ?? null) === item.leave_type &&
          existing.lessons_count === item.lessons_count &&
          sameDetails;

        if (sameCoreState) {
          // Preserve historical rule snapshots untouched when student's attendance state didn't change
          if ((existing.notes ?? null) !== item.notes) {
            updateNotesOnly.run(item.notes, existing.id);
          }
          continue;
        }

        const hadLessonState =
          isLessonCounterStatus(existing.status) || existingDetails.length > 0;
        const hasLessonStateNow =
          isLessonCounterStatus(item.status) || item.lesson_details.length > 0;

        const thresholdSnapshotToSave = hadLessonState
          ? existing.threshold_snapshot
          : currentThreshold;

        // If student had existing lesson_permission details whose exact lesson_numbers were NOT changed
        // (e.g. user only added an unrelated lesson_escape on another lesson of the same day),
        // preserve the historical permission rule snapshot for those untouched permission lessons.
        const existingPermLessons = existingDetails
          .filter((d) => d.lesson_status === 'lesson_permission')
          .map((d) => d.lesson_number);
        const newPermLessons = item.lesson_details
          .filter((d) => d.lesson_status === 'lesson_permission')
          .map((d) => d.lesson_number);
        const unchangedPermissionSubset =
          existingPermLessons.length > 0 &&
          JSON.stringify(existingPermLessons) === JSON.stringify(newPermLessons);

        const detailsToSave: LessonDetailItem[] = item.lesson_details.map((d) => {
          if (d.lesson_status === 'lesson_permission' && unchangedPermissionSubset) {
            const prevDetail = existingDetails.find(
              (ed) => ed.lesson_number === d.lesson_number && ed.lesson_status === 'lesson_permission'
            );
            if (prevDetail) {
              return {
                ...d,
                counted_as_absence: prevDetail.counted_as_absence,
                permission_rule_snapshot: prevDetail.permission_rule_snapshot,
                threshold_snapshot: prevDetail.threshold_snapshot,
              };
            }
          }
          return {
            ...d,
            threshold_snapshot: thresholdSnapshotToSave,
          };
        });

        const effectiveCountedAsAbsence =
          detailsToSave.length > 0
            ? detailsToSave.some((d) => d.counted_as_absence === 1)
              ? 1
              : 0
            : item.counted_as_absence;

        const effectivePermRuleSnapshot = unchangedPermissionSubset
          ? existing.permission_rule_snapshot
          : item.permission_rule_snapshot;

        const nowTs = (getDbNow.get() as { now_ts: string }).now_ts;

        updateAbsence.run(
          item.status,
          item.lessons_count,
          item.leave_type,
          item.permission_type,
          item.lesson_numbers_json,
          effectiveCountedAsAbsence,
          effectivePermRuleSnapshot,
          nowTs,
          thresholdSnapshotToSave,
          item.notes,
          existing.id
        );

        syncAbsenceLessonDetails(db, existing.id, item.student_id, attendanceDate, detailsToSave);

        if (hadLessonState || hasLessonStateNow) {
          const deltaConverted = reconcileStudentLessonCounter(db, item.student_id, year.id);
          totalNewlyConvertedDays += deltaConverted;
        }
      } else {
        const enrollment = findCurrentEnrollment.get(
          item.student_id,
          year.id,
          grade_id,
          section_id
        ) as { id: number } | undefined;

        if (!enrollment) {
          throw new ServiceError(
            `الطالب رقم ${item.student_id} غير مسجل حالياً في هذه الشعبة للسنة الدراسية المختارة.`,
            400,
            'STUDENT_NOT_IN_SECTION'
          );
        }

        const info = insertAbsence.run(
          item.student_id,
          enrollment.id,
          year.id,
          grade_id,
          section_id,
          attendanceDate,
          item.status,
          item.lessons_count,
          item.leave_type,
          item.permission_type,
          item.lesson_numbers_json,
          item.counted_as_absence,
          item.permission_rule_snapshot,
          currentThreshold,
          item.notes
        );

        const newAbsenceId = Number(info.lastInsertRowid);
        syncAbsenceLessonDetails(db, newAbsenceId, item.student_id, attendanceDate, item.lesson_details);

        const hasLessonStateNow =
          isLessonCounterStatus(item.status) || item.lesson_details.length > 0;
        if (hasLessonStateNow && item.counted_as_absence === 1) {
          const deltaConverted = reconcileStudentLessonCounter(db, item.student_id, year.id);
          totalNewlyConvertedDays += deltaConverted;
        }
      }
    }

    db.prepare(
      `INSERT INTO attendance_sessions
         (academic_year_id, grade_id, section_id, attendance_date, recorded_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(academic_year_id, section_id, attendance_date)
       DO UPDATE SET grade_id = excluded.grade_id,
                     recorded_count = excluded.recorded_count,
                     updated_at = datetime('now')`
    ).run(year.id, grade_id, section_id, attendanceDate, normalizedEntries.length);
  })();

  const updatedSheet = getSectionAttendanceSheet(db, {
    academic_year_id: year.id,
    grade_id,
    section_id,
    attendance_date: attendanceDate,
  });

  return {
    saved_count: normalizedEntries.length,
    present_count: presentCount,
    full_day_count: fullDayCount,
    lesson_absence_count: lessonAbsenceCount,
    full_day_leave_count: fullDayLeaveCount,
    lesson_permission_count: lessonPermissionCount,
    lesson_escape_count: lessonEscapeCount,
    newly_converted_days: totalNewlyConvertedDays,
    sheet: updatedSheet,
  };
}

/**
 * Direct single-record creation helper enforcing unique (student_id, absence_date)
 * so duplicate inserts for the same student and date are explicitly rejected.
 */
export function createSingleAbsenceRecord(
  db: SqliteDb,
  input: {
    student_id: number;
    academic_year_id?: number;
    absence_date: string;
    status: AbsenceStatus;
    lessons_count?: number;
    leave_type?: LeaveType | null;
    lesson_numbers?: number[];
    lesson_details?: LessonDetailInput[];
    notes?: string | null;
  }
) {
  const absenceDate = validateDateIso(input.absence_date);
  const year = input.academic_year_id
    ? (db
        .prepare('SELECT id, name, is_active, created_at FROM academic_years WHERE id = ?')
        .get(input.academic_year_id) as AcademicYear | undefined)
    : getActiveAcademicYear(db);

  if (!year) {
    throw new ServiceError('السنة الدراسية غير موجودة.', 404);
  }

  const holidayInfo = resolveDateHolidayStatus(db, absenceDate);
  if (holidayInfo.is_holiday) {
    throw new ServiceError(
      `لا يمكن تسجيل الحضور أو الغياب بتاريخ ${absenceDate} (${holidayInfo.day_name}) لأنه يوم عطلة: ${holidayInfo.primary_reason ?? 'عطلة رسمية'}.`,
      409,
      'DATE_IS_HOLIDAY'
    );
  }

  const existing = db
    .prepare('SELECT id FROM absences WHERE student_id = ? AND absence_date = ?')
    .get(input.student_id, absenceDate) as { id: number } | undefined;

  if (existing) {
    throw new ServiceError(
      `يوجد سجل غياب مسجل مسبقاً لهذا الطالب بتاريخ ${absenceDate}. لا يمكن تكرار التسجيل في التاريخ نفسه.`,
      409,
      'DUPLICATE_ABSENCE_DATE'
    );
  }

  const enrollment = db
    .prepare(
      `SELECT id, grade_id, section_id
       FROM student_enrollments
       WHERE student_id = ? AND academic_year_id = ? AND is_current = 1
       LIMIT 1`
    )
    .get(input.student_id, year.id) as
    | { id: number; grade_id: number; section_id: number }
    | undefined;

  if (!enrollment) {
    throw new ServiceError('الطالب غير مسجل في هذه السنة الدراسية.', 400);
  }

  const currentSettings = getSchoolSettings(db);
  const normalized = normalizeAbsenceEntry(
    {
      student_id: input.student_id,
      status: input.status,
      lessons_count: input.lessons_count,
      leave_type: input.leave_type,
      lesson_numbers: input.lesson_numbers,
      lesson_details: input.lesson_details,
      notes: input.notes,
    },
    currentSettings
  );

  const newId = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO absences
           (student_id, enrollment_id, academic_year_id, grade_id, section_id, absence_date,
            status, lessons_count, leave_type, permission_type, lesson_numbers_json,
            counted_as_absence, permission_rule_snapshot, applied_settings_at,
            threshold_snapshot, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, datetime('now'), datetime('now'))`
      )
      .run(
        normalized.student_id,
        enrollment.id,
        year.id,
        enrollment.grade_id,
        enrollment.section_id,
        absenceDate,
        normalized.status,
        normalized.lessons_count,
        normalized.leave_type,
        normalized.permission_type,
        normalized.lesson_numbers_json,
        normalized.counted_as_absence,
        normalized.permission_rule_snapshot,
        currentSettings.lessons_per_absence_day,
        normalized.notes
      );

    const createdId = Number(info.lastInsertRowid);
    syncAbsenceLessonDetails(
      db,
      createdId,
      normalized.student_id,
      absenceDate,
      normalized.lesson_details
    );

    const hasLessonStateNow =
      isLessonCounterStatus(normalized.status) || normalized.lesson_details.length > 0;
    if (hasLessonStateNow && normalized.counted_as_absence === 1) {
      reconcileStudentLessonCounter(db, normalized.student_id, year.id);
    }
    return createdId;
  })();

  const created = db.prepare('SELECT * FROM absences WHERE id = ?').get(newId) as Record<
    string,
    unknown
  >;
  return {
    ...created,
    lesson_numbers: normalized.lesson_numbers,
    lesson_details: normalized.lesson_details,
  };
}

/**
 * Appends non-overlapping lesson-level records (lesson_absence / lesson_permission / lesson_escape)
 * for a student on a specific date, rejecting any duplicate or conflicting lesson number
 * regardless of status type.
 */
export function addStudentLessonRecords(
  db: SqliteDb,
  input: {
    student_id: number;
    academic_year_id?: number;
    absence_date: string;
    lesson_details: LessonDetailInput[];
    notes?: string | null;
  }
) {
  const absenceDate = validateDateIso(input.absence_date);
  const year = input.academic_year_id
    ? (db
        .prepare('SELECT id, name, is_active, created_at FROM academic_years WHERE id = ?')
        .get(input.academic_year_id) as AcademicYear | undefined)
    : getActiveAcademicYear(db);

  if (!year) {
    throw new ServiceError('السنة الدراسية غير موجودة.', 404);
  }

  const holidayInfo = resolveDateHolidayStatus(db, absenceDate);
  if (holidayInfo.is_holiday) {
    throw new ServiceError(
      `لا يمكن تسجيل الحضور أو الغياب بتاريخ ${absenceDate} (${holidayInfo.day_name}) لأنه يوم عطلة: ${holidayInfo.primary_reason ?? 'عطلة رسمية'}.`,
      409,
      'DATE_IS_HOLIDAY'
    );
  }

  if (!Array.isArray(input.lesson_details) || input.lesson_details.length === 0) {
    throw new ServiceError('يجب تحديد درس واحد على الأقل.', 400);
  }

  const currentSettings = getSchoolSettings(db);
  const normalizedIncoming = normalizeAbsenceEntry(
    {
      student_id: input.student_id,
      status: input.lesson_details[0].lesson_status,
      lesson_details: input.lesson_details,
      notes: input.notes,
    },
    currentSettings
  );

  const existing = db
    .prepare(
      `SELECT id, academic_year_id, status, lessons_count, lesson_numbers_json,
              counted_as_absence, permission_rule_snapshot, threshold_snapshot, notes
       FROM absences
       WHERE student_id = ? AND absence_date = ?`
    )
    .get(input.student_id, absenceDate) as
    | {
        id: number;
        academic_year_id: number;
        status: AbsenceStatus;
        lessons_count: number;
        lesson_numbers_json: string | null;
        counted_as_absence: number;
        permission_rule_snapshot: number | null;
        threshold_snapshot: number;
        notes: string | null;
      }
    | undefined;

  if (!existing) {
    return createSingleAbsenceRecord(db, {
      student_id: input.student_id,
      academic_year_id: year.id,
      absence_date: absenceDate,
      status: normalizedIncoming.status,
      lesson_details: input.lesson_details,
      notes: input.notes,
    });
  }

  if (existing.academic_year_id !== year.id) {
    throw new ServiceError(
      `الطالب مسجل له سجل بتاريخ ${absenceDate} في سنة دراسية أخرى.`,
      409,
      'DUPLICATE_ABSENCE_DATE'
    );
  }

  if (existing.status === 'full_day' || existing.status === 'full_day_leave') {
    throw new ServiceError(
      `الطالب مسجل له حالة يوم كامل بتاريخ ${absenceDate} ولا يمكن إضافة دروس جزئية فوقها.`,
      409,
      'CONFLICTING_DAY_STATUS'
    );
  }

  const existingDetails = loadLessonDetailsMap(db, [existing.id]).get(existing.id) ?? [];
  const existingLessonNums = new Set(existingDetails.map((d) => d.lesson_number));

  for (const incoming of normalizedIncoming.lesson_details) {
    if (existingLessonNums.has(incoming.lesson_number)) {
      throw new ServiceError(
        `لا يجوز تسجيل أكثر من سبب لعدم حضور الطالب في الدرس رقم ${incoming.lesson_number} بتاريخ ${absenceDate}.`,
        409,
        'DUPLICATE_LESSON_ENTRY'
      );
    }
  }

  const mergedDetails: LessonDetailItem[] = [
    ...existingDetails,
    ...normalizedIncoming.lesson_details,
  ].sort((a, b) => a.lesson_number - b.lesson_number);

  const mergedNumbers = mergedDetails.map((d) => d.lesson_number);
  const primaryStatus: AbsenceStatus =
    existing.status === 'present'
      ? 'present'
      : resolvePrimaryLessonStatus(existing.status, mergedDetails);
  const hasPerm = mergedDetails.some((d) => d.lesson_status === 'lesson_permission');
  const anyCounted = mergedDetails.some((d) => d.counted_as_absence === 1);
  const mergedNotes = normalizeNullableString(
    [existing.notes, normalizedIncoming.notes].filter(Boolean).join(' · ')
  );

  db.transaction(() => {
    db.prepare(
      `UPDATE absences
       SET status = ?,
           lessons_count = ?,
           permission_type = ?,
           lesson_numbers_json = ?,
           counted_as_absence = ?,
           permission_rule_snapshot = COALESCE(permission_rule_snapshot, ?),
           notes = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      primaryStatus,
      mergedDetails.length,
      hasPerm ? 'lesson_permission' : null,
      JSON.stringify(mergedNumbers),
      anyCounted ? 1 : 0,
      normalizedIncoming.permission_rule_snapshot,
      mergedNotes,
      existing.id
    );

    syncAbsenceLessonDetails(
      db,
      existing.id,
      input.student_id,
      absenceDate,
      mergedDetails
    );

    reconcileStudentLessonCounter(db, input.student_id, year.id);
  })();

  const updated = db.prepare('SELECT * FROM absences WHERE id = ?').get(existing.id) as Record<
    string,
    unknown
  >;
  return {
    ...updated,
    lesson_numbers: mergedNumbers,
    lesson_details: mergedDetails,
  };
}

export function deleteAbsenceRecord(db: SqliteDb, recordId: number): void {
  const existing = db
    .prepare(
      'SELECT id, student_id, academic_year_id, section_id, absence_date, status FROM absences WHERE id = ?'
    )
    .get(recordId) as
    | {
        id: number;
        student_id: number;
        academic_year_id: number;
        section_id: number;
        absence_date: string;
        status: AbsenceStatus;
      }
    | undefined;

  if (!existing) {
    throw new ServiceError('سجل الغياب المطلوب حذفه غير موجود.', 404, 'ABSENCE_NOT_FOUND');
  }

  const hadLessonDetails = Boolean(
    db.prepare('SELECT 1 FROM absence_lesson_details WHERE absence_id = ? LIMIT 1').get(recordId)
  );

  db.transaction(() => {
    db.prepare('DELETE FROM absences WHERE id = ?').run(recordId);
    if (isLessonCounterStatus(existing.status) || hadLessonDetails) {
      reconcileStudentLessonCounter(db, existing.student_id, existing.academic_year_id);
    }

    const remainingInDay = db
      .prepare(
        'SELECT COUNT(*) as count FROM absences WHERE academic_year_id = ? AND section_id = ? AND absence_date = ?'
      )
      .get(existing.academic_year_id, existing.section_id, existing.absence_date) as {
      count: number;
    };

    if (remainingInDay.count === 0) {
      db.prepare(
        'DELETE FROM attendance_sessions WHERE academic_year_id = ? AND section_id = ? AND attendance_date = ?'
      ).run(existing.academic_year_id, existing.section_id, existing.absence_date);
    } else {
      db.prepare(
        `UPDATE attendance_sessions
         SET recorded_count = ?, updated_at = datetime('now')
         WHERE academic_year_id = ? AND section_id = ? AND attendance_date = ?`
      ).run(
        remainingInDay.count,
        existing.academic_year_id,
        existing.section_id,
        existing.absence_date
      );
    }
  })();
}

export function getStudentAbsenceDetails(
  db: SqliteDb,
  studentId: number,
  academicYearId?: number
): StudentAbsenceDetailResponse {
  const yearId = academicYearId ?? getActiveAcademicYear(db).id;
  const settings = getSchoolSettings(db);

  const student = db
    .prepare('SELECT id, full_name, student_uid, registry_number FROM students WHERE id = ?')
    .get(studentId) as
    | { id: number; full_name: string; student_uid: string; registry_number: string | null }
    | undefined;

  if (!student) {
    throw new ServiceError('الطالب غير موجود.', 404, 'STUDENT_NOT_FOUND');
  }

  const rawRecords = db
    .prepare(
      `SELECT a.id, a.absence_date, a.status, a.lessons_count,
              a.leave_type, a.permission_type, a.lesson_numbers_json,
              a.counted_as_absence, a.permission_rule_snapshot, a.applied_settings_at,
              a.threshold_snapshot, a.notes,
              g.name as grade_name, s.name as section_name, a.created_at, a.updated_at
       FROM absences a
       JOIN grades g ON g.id = a.grade_id
       JOIN sections s ON s.id = a.section_id
       WHERE a.student_id = ? AND a.academic_year_id = ?
       ORDER BY a.absence_date DESC, a.id DESC`
    )
    .all(studentId, yearId) as Array<{
    id: number;
    absence_date: string;
    status: AbsenceStatus;
    lessons_count: number;
    leave_type: LeaveType | null;
    permission_type: PermissionType | null;
    lesson_numbers_json: string | null;
    counted_as_absence: number;
    permission_rule_snapshot: number | null;
    applied_settings_at: string | null;
    threshold_snapshot: number;
    notes: string | null;
    grade_name: string;
    section_name: string;
    created_at: string;
    updated_at: string;
  }>;

  const lessonDetailsMap = loadLessonDetailsMap(
    db,
    rawRecords.map((r) => r.id)
  );

  const records: StudentAbsenceDetailResponse['records'] = rawRecords.map((r) => {
    const resolved = buildEffectiveLessonDetails(
      r.status,
      r.lessons_count,
      r.lesson_numbers_json,
      r.counted_as_absence,
      r.permission_rule_snapshot,
      r.threshold_snapshot,
      lessonDetailsMap.get(r.id)
    );
    return {
      id: r.id,
      absence_date: r.absence_date,
      status: r.status,
      lessons_count: r.lessons_count,
      leave_type: r.leave_type,
      permission_type: r.permission_type,
      lesson_numbers: resolved.lesson_numbers,
      lesson_details: resolved.lesson_details,
      counted_as_absence: r.counted_as_absence,
      permission_rule_snapshot: r.permission_rule_snapshot,
      applied_settings_at: r.applied_settings_at,
      threshold_snapshot: r.threshold_snapshot,
      notes: r.notes,
      grade_name: r.grade_name,
      section_name: r.section_name,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  });

  const rawConversions = db
    .prepare(
      `SELECT id, converted_date, lessons_consumed, threshold_used, contributing_lessons_json, created_at
       FROM lesson_converted_days
       WHERE student_id = ? AND academic_year_id = ?
       ORDER BY converted_date DESC, id DESC`
    )
    .all(studentId, yearId) as Array<{
    id: number;
    converted_date: string;
    lessons_consumed: number;
    threshold_used: number;
    contributing_lessons_json: string | null;
    created_at: string;
  }>;

  const conversions: StudentAbsenceDetailResponse['conversions'] = rawConversions.map((c) => ({
    id: c.id,
    converted_date: c.converted_date,
    lessons_consumed: c.lessons_consumed,
    threshold_used: c.threshold_used,
    contributing_lessons: parseContributingLessonsJson(c.contributing_lessons_json),
    created_at: c.created_at,
  }));

  const directFullDays = records.filter((r) => r.status === 'full_day').length;
  const countedDailyPermissionDays = records.filter(
    (r) =>
      r.status === 'full_day_leave' &&
      r.leave_type === 'daily_permission' &&
      r.counted_as_absence === 1
  ).length;
  const sickLeaveDays = records.filter(
    (r) => r.status === 'full_day_leave' && r.leave_type === 'sick_leave'
  ).length;
  const dailyPermissionDays = records.filter(
    (r) => r.status === 'full_day_leave' && r.leave_type === 'daily_permission'
  ).length;
  const lessonPermissionRecords = records.filter(
    (r) =>
      r.status === 'lesson_permission' ||
      r.lesson_details.some((d) => d.lesson_status === 'lesson_permission')
  ).length;

  let lessonAbsenceLessons = 0;
  let lessonEscapeLessons = 0;
  let countedLessonPermissionLessons = 0;

  for (const r of records) {
    if (r.lesson_details.length > 0) {
      for (const d of r.lesson_details) {
        if (d.lesson_status === 'lesson_absence') lessonAbsenceLessons += 1;
        else if (d.lesson_status === 'lesson_escape') lessonEscapeLessons += 1;
        else if (d.lesson_status === 'lesson_permission' && d.counted_as_absence === 1) {
          countedLessonPermissionLessons += 1;
        }
      }
    } else if (r.status === 'lesson_absence') {
      lessonAbsenceLessons += r.lessons_count;
    } else if (r.status === 'lesson_escape') {
      lessonEscapeLessons += r.lessons_count;
    } else if (r.status === 'lesson_permission' && r.counted_as_absence === 1) {
      countedLessonPermissionLessons += r.lessons_count;
    }
  }

  const convertedLessonDays = conversions.length;
  const totalLessonsMissed =
    lessonAbsenceLessons + lessonEscapeLessons + countedLessonPermissionLessons;
  const consumedLessons = conversions.reduce((acc, c) => acc + c.lessons_consumed, 0);

  return {
    student_id: student.id,
    full_name: student.full_name,
    student_uid: student.student_uid,
    registry_number: student.registry_number,
    lessons_per_absence_day: settings.lessons_per_absence_day,
    daily_lessons_count: settings.daily_lessons_count,
    direct_full_days: directFullDays,
    counted_daily_permission_days: countedDailyPermissionDays,
    sick_leave_days: sickLeaveDays,
    daily_permission_days: dailyPermissionDays,
    lesson_permission_records: lessonPermissionRecords,
    lesson_absence_lessons: lessonAbsenceLessons,
    lesson_escape_lessons: lessonEscapeLessons,
    counted_lesson_permission_lessons: countedLessonPermissionLessons,
    converted_lesson_days: convertedLessonDays,
    total_full_days: directFullDays + countedDailyPermissionDays + convertedLessonDays,
    pending_lessons: Math.max(0, totalLessonsMissed - consumedLessons),
    total_lessons_missed: totalLessonsMissed,
    records,
    conversions,
  };
}
