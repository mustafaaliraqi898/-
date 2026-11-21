import type {
  AbsenceStatus,
  AcademicYear,
  AttendanceEntryInput,
  AttendanceSessionInfo,
  LeaveType,
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
  counted_as_absence: number;
  permission_rule_snapshot: number | null;
  notes: string | null;
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
  const maxDailyLessons = Math.max(1, Math.min(12, settings.daily_lessons_count || 7));
  const maxLessonAbsence = Math.max(12, maxDailyLessons);

  if (status === 'present' || status === 'full_day') {
    if (rawLeaveType !== null || rawLessonNumbers.length > 0) {
      throw new ServiceError('بيانات الإجازة أو الدروس تتعارض مع الحالة المختارة.', 400);
    }
    return {
      student_id: studentId,
      status,
      lessons_count: 0,
      leave_type: null,
      permission_type: null,
      lesson_numbers: [],
      lesson_numbers_json: null,
      counted_as_absence: status === 'full_day' ? 1 : 0,
      permission_rule_snapshot: null,
      notes: normalizeNullableString(entry.notes),
    };
  }

  if (status === 'lesson_absence') {
    if (rawLeaveType !== null || rawLessonNumbers.length > 0) {
      throw new ServiceError('بيانات الإجازة أو أرقام الدروس غير مطلوبة مع حالة غياب الدروس.', 400);
    }
    const parsedLessons = Number(entry.lessons_count);
    if (!Number.isInteger(parsedLessons) || parsedLessons < 1 || parsedLessons > maxLessonAbsence) {
      throw new ServiceError(
        `عند اختيار "غائب عن درس" يجب تحديد عدد الدروس كرقم صحيح بين 1 و ${maxLessonAbsence}.`,
        400
      );
    }
    return {
      student_id: studentId,
      status,
      lessons_count: parsedLessons,
      leave_type: null,
      permission_type: null,
      lesson_numbers: [],
      lesson_numbers_json: null,
      counted_as_absence: 1,
      permission_rule_snapshot: null,
      notes: normalizeNullableString(entry.notes),
    };
  }

  if (status === 'full_day_leave') {
    if (rawLessonNumbers.length > 0) {
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
      counted_as_absence: dailyRuleSnapshot,
      permission_rule_snapshot: dailyRuleSnapshot,
      notes: normalizeNullableString(entry.notes),
    };
  }

  // status === 'lesson_permission'
  if (rawLeaveType !== null) {
    throw new ServiceError('لا يمكن تحديد نوع إجازة يومية مع حالة "رخصة عن درس".', 400);
  }

  if (rawLessonNumbers.length === 0) {
    throw new ServiceError(
      'عند اختيار "رخصة عن درس" يجب تحديد درس واحد على الأقل من قائمة الدروس.',
      400
    );
  }

  const uniqueSet = new Set<number>();
  for (const rawNum of rawLessonNumbers) {
    const num = Number(rawNum);
    if (!Number.isInteger(num) || num < 1 || num > maxDailyLessons) {
      throw new ServiceError(
        `رقم الدرس (${rawNum}) غير صالح. الدروس المتاحة حسب الإعدادات من 1 إلى ${maxDailyLessons}.`,
        400
      );
    }
    uniqueSet.add(num);
  }

  const sortedLessons = Array.from(uniqueSet).sort((a, b) => a - b);
  const lessonRuleSnapshot = settings.lesson_permission_counts_as_absence ? 1 : 0;

  return {
    student_id: studentId,
    status: 'lesson_permission',
    lessons_count: sortedLessons.length,
    leave_type: null,
    permission_type: 'lesson_permission',
    lesson_numbers: sortedLessons,
    lesson_numbers_json: JSON.stringify(sortedLessons),
    counted_as_absence: lessonRuleSnapshot,
    permission_rule_snapshot: lessonRuleSnapshot,
    notes: normalizeNullableString(entry.notes),
  };
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

function loadLessonNumbersMap(db: SqliteDb, absenceIds: number[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  if (absenceIds.length === 0) return map;

  const placeholders = absenceIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT absence_id, lesson_number
       FROM absence_lesson_details
       WHERE absence_id IN (${placeholders})
       ORDER BY lesson_number ASC`
    )
    .all(...absenceIds) as Array<{ absence_id: number; lesson_number: number }>;

  for (const r of rows) {
    const list = map.get(r.absence_id);
    if (list) list.push(r.lesson_number);
    else map.set(r.absence_id, [r.lesson_number]);
  }
  return map;
}

function syncAbsenceLessonDetails(
  db: SqliteDb,
  absenceId: number,
  lessonNumbers: number[]
): void {
  db.prepare('DELETE FROM absence_lesson_details WHERE absence_id = ?').run(absenceId);
  if (lessonNumbers.length === 0) return;

  const insertDetail = db.prepare(
    'INSERT INTO absence_lesson_details (absence_id, lesson_number) VALUES (?, ?)'
  );
  for (const lessonNum of lessonNumbers) {
    insertDetail.run(absenceId, lessonNum);
  }
}

function isLessonCounterStatus(status: AbsenceStatus): boolean {
  return status === 'lesson_absence' || status === 'lesson_permission';
}

/**
 * Deterministically reconciles converted absence days from preserved daily lesson records
 * (both direct lesson_absence and counted lesson_permission) for a student in an academic year.
 * - Uses each row's stored threshold_snapshot so changes to Settings affect new/edited records only.
 * - Never deletes or modifies original daily absence, leave, or permission records.
 * - Completely independent of direct full_day and daily_permission absences.
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
      `SELECT id, grade_id, section_id, absence_date, lessons_count, threshold_snapshot
       FROM absences
       WHERE student_id = ? AND academic_year_id = ?
         AND lessons_count > 0
         AND (
           status = 'lesson_absence'
           OR (status = 'lesson_permission' AND counted_as_absence = 1)
         )
       ORDER BY absence_date ASC, id ASC`
    )
    .all(studentId, academicYearId) as Array<{
    id: number;
    grade_id: number;
    section_id: number;
    absence_date: string;
    lessons_count: number;
    threshold_snapshot: number;
  }>;

  const insertConversion = db.prepare(
    `INSERT INTO lesson_converted_days
       (student_id, academic_year_id, grade_id, section_id, source_absence_id, converted_date, lessons_consumed, threshold_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let pending = 0;
  let newTotalConverted = 0;

  for (const row of lessonRows) {
    pending += row.lessons_count;
    const threshold = Math.max(1, row.threshold_snapshot);

    while (pending >= threshold) {
      insertConversion.run(
        studentId,
        academicYearId,
        row.grade_id,
        row.section_id,
        row.id,
        row.absence_date,
        threshold,
        threshold
      );
      pending -= threshold;
      newTotalConverted += 1;
    }
  }

  return newTotalConverted - beforeRow.count;
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

  // Include active students currently enrolled in this section, PLUS any student who already has
  // a saved absence record in this section on this date (preserving historical editability after transfers).
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
    saved_notes: string | null;
    record_created_at: string | null;
    record_updated_at: string | null;
  }>;

  const recordIds = roster
    .map((r) => r.record_id)
    .filter((id): id is number => id !== null);
  const lessonNumbersMap = loadLessonNumbersMap(db, recordIds);

  // Cumulative counts per student for this academic year
  const summaryRows = db
    .prepare(
      `SELECT
         student_id,
         SUM(CASE WHEN status = 'full_day' THEN 1 ELSE 0 END) as direct_full_days,
         SUM(CASE WHEN status = 'full_day_leave' AND leave_type = 'daily_permission' AND counted_as_absence = 1 THEN 1 ELSE 0 END) as counted_daily_permission_days,
         SUM(CASE WHEN status = 'full_day_leave' AND leave_type = 'sick_leave' THEN 1 ELSE 0 END) as sick_leave_days,
         SUM(CASE WHEN status = 'full_day_leave' AND leave_type = 'daily_permission' THEN 1 ELSE 0 END) as daily_permission_days,
         SUM(CASE WHEN status = 'lesson_permission' THEN 1 ELSE 0 END) as lesson_permission_records,
         COALESCE(SUM(CASE WHEN status = 'lesson_absence' OR (status = 'lesson_permission' AND counted_as_absence = 1) THEN lessons_count ELSE 0 END), 0) as total_lessons_missed
       FROM absences
       WHERE academic_year_id = ?
       GROUP BY student_id`
    )
    .all(year.id) as Array<{
    student_id: number;
    direct_full_days: number;
    counted_daily_permission_days: number;
    sick_leave_days: number;
    daily_permission_days: number;
    lesson_permission_records: number;
    total_lessons_missed: number;
  }>;

  const summaryMap = new Map<
    number,
    {
      direct_full_days: number;
      counted_daily_permission_days: number;
      sick_leave_days: number;
      daily_permission_days: number;
      lesson_permission_records: number;
      total_lessons_missed: number;
    }
  >();
  for (const row of summaryRows) {
    summaryMap.set(row.student_id, row);
  }

  const convertedRows = db
    .prepare(
      `SELECT student_id, COUNT(*) as converted_days, COALESCE(SUM(lessons_consumed), 0) as consumed_lessons
       FROM lesson_converted_days
       WHERE academic_year_id = ?
       GROUP BY student_id`
    )
    .all(year.id) as Array<{
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

  const students: StudentAbsenceSheetRow[] = roster.map((r) => {
    const sum = summaryMap.get(r.student_id) ?? {
      direct_full_days: 0,
      counted_daily_permission_days: 0,
      sick_leave_days: 0,
      daily_permission_days: 0,
      lesson_permission_records: 0,
      total_lessons_missed: 0,
    };
    const conv = convertedMap.get(r.student_id) ?? { converted_days: 0, consumed_lessons: 0 };
    const pendingLessons = Math.max(0, sum.total_lessons_missed - conv.consumed_lessons);

    const savedStatus = r.saved_status ?? 'present';
    const lessonNumbers =
      r.record_id && savedStatus === 'lesson_permission'
        ? (lessonNumbersMap.get(r.record_id) ??
          parseLessonNumbersFallback(r.saved_lesson_numbers_json))
        : [];

    const lessonsCount =
      savedStatus === 'lesson_absence'
        ? (r.saved_lessons_count ?? 1)
        : savedStatus === 'lesson_permission'
          ? (r.saved_lessons_count ?? lessonNumbers.length)
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
      lesson_numbers: lessonNumbers,
      counted_as_absence: r.saved_counted_as_absence ?? 0,
      permission_rule_snapshot: r.saved_permission_rule_snapshot ?? null,
      applied_settings_at: r.saved_applied_settings_at ?? null,
      notes: r.saved_notes ?? null,
      record_created_at: r.record_created_at ?? null,
      record_updated_at: r.record_updated_at ?? null,
      has_saved_record: r.record_id !== null,
      direct_full_days: sum.direct_full_days,
      counted_daily_permission_days: sum.counted_daily_permission_days,
      sick_leave_days: sum.sick_leave_days,
      daily_permission_days: sum.daily_permission_days,
      lesson_permission_records: sum.lesson_permission_records,
      converted_lesson_days: conv.converted_days,
      total_full_days: sum.direct_full_days + sum.counted_daily_permission_days + conv.converted_days,
      pending_lessons: pendingLessons,
      total_lessons_missed: sum.total_lessons_missed,
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
      if (item.status === 'present') presentCount += 1;
      else if (item.status === 'full_day') fullDayCount += 1;
      else if (item.status === 'lesson_absence') lessonAbsenceCount += 1;
      else if (item.status === 'full_day_leave') fullDayLeaveCount += 1;
      else lessonPermissionCount += 1;

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
        // Prevent duplicate / cross-section collision on the exact same date
        if (existing.section_id !== section_id || existing.academic_year_id !== year.id) {
          throw new ServiceError(
            `الطالب رقم ${item.student_id} مسجل له سجل حضور/غياب مسبق بتاريخ ${attendanceDate} في شعبة أو سنة أخرى.`,
            409,
            'DUPLICATE_ABSENCE_DATE'
          );
        }

        const existingLessonsArr =
          existing.status === 'lesson_permission'
            ? (loadLessonNumbersMap(db, [existing.id]).get(existing.id) ??
              parseLessonNumbersFallback(existing.lesson_numbers_json))
            : [];
        const existingLessonsNormalizedJson =
          existingLessonsArr.length > 0 ? JSON.stringify(existingLessonsArr) : null;

        const sameCoreState =
          existing.status === item.status &&
          (existing.leave_type ?? null) === item.leave_type &&
          existing.lessons_count === item.lessons_count &&
          existingLessonsNormalizedJson === item.lesson_numbers_json;

        if (sameCoreState) {
          // Preserve historical rule snapshots untouched when student's attendance state didn't change
          if ((existing.notes ?? null) !== item.notes) {
            updateNotesOnly.run(item.notes, existing.id);
          }
          continue;
        }

        // State/type/lessons changed: apply current rules & snapshot settings time,
        // keeping historical threshold_snapshot if staying within a counted lesson status?
        // When explicitly edited, apply current threshold_snapshot if transitioning into lesson counting,
        // or preserve if editing lesson count on an already-lesson row.
        const thresholdSnapshotToSave = isLessonCounterStatus(existing.status)
          ? existing.threshold_snapshot
          : currentThreshold;

        const nowTs = (getDbNow.get() as { now_ts: string }).now_ts;

        updateAbsence.run(
          item.status,
          item.lessons_count,
          item.leave_type,
          item.permission_type,
          item.lesson_numbers_json,
          item.counted_as_absence,
          item.permission_rule_snapshot,
          nowTs,
          thresholdSnapshotToSave,
          item.notes,
          existing.id
        );

        syncAbsenceLessonDetails(db, existing.id, item.lesson_numbers);

        if (isLessonCounterStatus(existing.status) || isLessonCounterStatus(item.status)) {
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
        syncAbsenceLessonDetails(db, newAbsenceId, item.lesson_numbers);

        if (item.status === 'lesson_absence' || (item.status === 'lesson_permission' && item.counted_as_absence === 1)) {
          const deltaConverted = reconcileStudentLessonCounter(db, item.student_id, year.id);
          totalNewlyConvertedDays += deltaConverted;
        }
      }
    }

    // Upsert attendance_sessions
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
    syncAbsenceLessonDetails(db, createdId, normalized.lesson_numbers);

    if (
      normalized.status === 'lesson_absence' ||
      (normalized.status === 'lesson_permission' && normalized.counted_as_absence === 1)
    ) {
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

  db.transaction(() => {
    db.prepare('DELETE FROM absences WHERE id = ?').run(recordId);
    if (isLessonCounterStatus(existing.status)) {
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

  const lessonNumbersMap = loadLessonNumbersMap(
    db,
    rawRecords.map((r) => r.id)
  );

  const records: StudentAbsenceDetailResponse['records'] = rawRecords.map((r) => ({
    id: r.id,
    absence_date: r.absence_date,
    status: r.status,
    lessons_count: r.lessons_count,
    leave_type: r.leave_type,
    permission_type: r.permission_type,
    lesson_numbers:
      r.status === 'lesson_permission'
        ? (lessonNumbersMap.get(r.id) ?? parseLessonNumbersFallback(r.lesson_numbers_json))
        : [],
    counted_as_absence: r.counted_as_absence,
    permission_rule_snapshot: r.permission_rule_snapshot,
    applied_settings_at: r.applied_settings_at,
    threshold_snapshot: r.threshold_snapshot,
    notes: r.notes,
    grade_name: r.grade_name,
    section_name: r.section_name,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  const conversions = db
    .prepare(
      `SELECT id, converted_date, lessons_consumed, threshold_used, created_at
       FROM lesson_converted_days
       WHERE student_id = ? AND academic_year_id = ?
       ORDER BY converted_date DESC, id DESC`
    )
    .all(studentId, yearId) as StudentAbsenceDetailResponse['conversions'];

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
    (r) => r.status === 'lesson_permission'
  ).length;

  const convertedLessonDays = conversions.length;
  const totalLessonsMissed = records
    .filter(
      (r) =>
        r.status === 'lesson_absence' ||
        (r.status === 'lesson_permission' && r.counted_as_absence === 1)
    )
    .reduce((acc, r) => acc + r.lessons_count, 0);
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
    converted_lesson_days: convertedLessonDays,
    total_full_days: directFullDays + countedDailyPermissionDays + convertedLessonDays,
    pending_lessons: Math.max(0, totalLessonsMissed - consumedLessons),
    total_lessons_missed: totalLessonsMissed,
    records,
    conversions,
  };
}
