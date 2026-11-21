import ExcelJS from 'exceljs';
import type {
  AbsenceStatus,
  AcademicYear,
  HolidayCheckResult,
  LeaveType,
  MonthCalendarDay,
  MonthlyDayCellData,
  MonthlyLegendItem,
  MonthlyRegisterData,
  MonthlyRegisterQuery,
  MonthlyRegisterStats,
  MonthlyStudentRow,
  SaveMonthlyNoteInput,
} from '../../src/types/school';
import type { SqliteDb } from '../db/connection';
import { ServiceError, normalizeNullableString, normalizeArabicLookup } from '../utils/validation';
import { getMonthHolidayCalendar } from './holidayService';
import { getActiveAcademicYear, getSchoolSettings } from './settingsService';

export const ARABIC_MONTH_NAMES: readonly string[] = [
  'كانون الثاني',
  'شباط',
  'آذار',
  'نيسان',
  'أيار',
  'حزيران',
  'تموز',
  'آب',
  'أيلول',
  'تشرين الأول',
  'تشرين الثاني',
  'كانون الأول',
];

const LESSON_ORDINALS: readonly string[] = [
  'الدرس الأول',
  'الدرس الثاني',
  'الدرس الثالث',
  'الدرس الرابع',
  'الدرس الخامس',
  'الدرس السادس',
  'الدرس السابع',
  'الدرس الثامن',
  'الدرس التاسع',
  'الدرس العاشر',
  'الدرس الحادي عشر',
  'الدرس الثاني عشر',
];

const ARABIC_INDIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'] as const;

export function toArabicIndicDigits(value: number | string): string {
  return String(value).replace(/\d/g, (digit) => ARABIC_INDIC_DIGITS[Number(digit)] ?? digit);
}

export function formatLessonOrdinals(numbers: number[]): string {
  if (!numbers || numbers.length === 0) return '—';
  return numbers.map((n) => LESSON_ORDINALS[n - 1] ?? `الدرس ${n}`).join('، ');
}

export const MONTHLY_LEGEND: MonthlyLegendItem[] = [
  {
    symbol: 'غ',
    label: 'غائب يوم كامل',
    description: 'غياب يوم كامل مباشر ويُحسب يوماً واحداً ضمن أيام الغياب.',
  },
  {
    symbol: 'ج',
    label: 'غياب متراكم من الدروس',
    description: 'يوم غياب كامل ناتج عن اكتمال نصاب تراكم الدروس في هذا التاريخ.',
  },
  {
    symbol: 'د',
    label: 'غائب عن درس / دروس',
    description: 'الرقم بجانب (د) مثل د١، د٢ يمثل عدد الدروس الغائبة في ذلك اليوم.',
  },
  {
    symbol: 'م',
    label: 'إجازة مرضية',
    description: 'إجازة مرضية معتمدة وتُعرض إدارياً ولا تُحتسب غياباً.',
  },
  {
    symbol: 'ر',
    label: 'رخصة يومية',
    description: 'رخصة خروج/غياب ليوم كامل، وتُحتسب غياباً أو تُعفى حسب إعدادات المدرسة وقت التسجيل.',
  },
  {
    symbol: 'ح',
    label: 'رخصة عن درس / دروس',
    description: 'الرقم بجانب (ح) مثل ح١، ح٢ يمثل عدد الدروس المرخصة في ذلك اليوم.',
  },
  {
    symbol: 'ع',
    label: 'عطلة',
    description: 'عطلة أسبوعية أو رسمية أو استثنائية أو خاصة بالمدرسة ولا تُحتسب غياباً.',
  },
  {
    symbol: '✓',
    label: 'حاضر',
    description: 'الطالب حاضر في الدوام المدرسي وفق سجل الحضور المعتمد لذلك اليوم.',
  },
];

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
    // ignore malformed JSON
  }
  return [];
}

function calendarDayToHolidayCheck(cal: MonthCalendarDay): HolidayCheckResult {
  return {
    date: cal.date,
    day_of_week: cal.day_of_week,
    day_name: cal.day_name,
    is_holiday: cal.is_holiday,
    is_weekly_holiday: cal.is_weekly_holiday,
    is_official_or_special_holiday: cal.is_official_or_special_holiday,
    holiday_category: cal.holiday_category,
    primary_reason: cal.reason,
    weekly_reason: cal.weekly_reason,
    matching_holidays: cal.holidays,
  };
}

function validateMonthlyParams(
  db: SqliteDb,
  query: MonthlyRegisterQuery
): {
  year: number;
  month: number;
  monthName: string;
  monthStart: string;
  monthEnd: string;
  daysInMonth: number;
  academicYear: AcademicYear;
  gradeId: number;
  gradeName: string;
  sectionId: number;
  sectionName: string;
} {
  const year = Number(query.year);
  const month = Number(query.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new ServiceError('السنة الميلادية المطلوبة غير صالحة (2000 - 2100).', 400);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new ServiceError('الشهر المطلوب غير صالح (1 - 12).', 400);
  }

  const gradeId = Number(query.grade_id);
  const sectionId = Number(query.section_id);
  if (!Number.isInteger(gradeId) || gradeId <= 0) {
    throw new ServiceError('يرجى اختيار الصف الدراسي.', 400);
  }
  if (!Number.isInteger(sectionId) || sectionId <= 0) {
    throw new ServiceError('يرجى اختيار الشعبة الدراسية.', 400);
  }

  const academicYear = query.academic_year_id
    ? (db
        .prepare('SELECT id, name, is_active, created_at FROM academic_years WHERE id = ?')
        .get(query.academic_year_id) as AcademicYear | undefined)
    : getActiveAcademicYear(db);

  if (!academicYear) {
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

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthPadded = String(month).padStart(2, '0');
  const monthStart = `${year}-${monthPadded}-01`;
  const monthEnd = `${year}-${monthPadded}-${String(daysInMonth).padStart(2, '0')}`;

  return {
    year,
    month,
    monthName: ARABIC_MONTH_NAMES[month - 1],
    monthStart,
    monthEnd,
    daysInMonth,
    academicYear,
    gradeId: gs.grade_id,
    gradeName: gs.grade_name,
    sectionId: gs.section_id,
    sectionName: gs.section_name,
  };
}

interface EnrollmentIntervalRow {
  id: number;
  student_id: number;
  student_uid: string;
  registry_number: string | null;
  full_name: string;
  student_status: string;
  student_updated_at: string;
  grade_id: number;
  grade_name: string;
  section_id: number;
  section_name: string;
  enrollment_date: string;
  is_current: number;
  ended_at: string | null;
}

interface ResolvedSectionMembership {
  student_id: number;
  student_uid: string;
  registry_number: string | null;
  full_name: string;
  intervals: Array<{ start: string; exclusiveEnd: string | null; inclusiveEnd: string | null }>;
  enrollment_start_date: string | null;
  enrollment_end_date: string | null;
  transfer_in_date: string | null;
  transfer_out_date: string | null;
  transfer_in_from: string | null;
  transfer_out_to: string | null;
  has_section_activity_in_month: boolean;
}

function isDateWithinIntervals(
  dateIso: string,
  intervals: Array<{ start: string; exclusiveEnd: string | null; inclusiveEnd: string | null }>
): boolean {
  if (intervals.length === 0) return false;
  return intervals.some((iv) => {
    if (dateIso < iv.start) return false;
    if (iv.exclusiveEnd && dateIso >= iv.exclusiveEnd) return false;
    if (iv.inclusiveEnd && dateIso > iv.inclusiveEnd) return false;
    return true;
  });
}

export function getMonthlyAbsenceRegister(
  db: SqliteDb,
  query: MonthlyRegisterQuery
): MonthlyRegisterData {
  const ctx = validateMonthlyParams(db, query);
  const schoolSettings = getSchoolSettings(db);
  const calendarDays = getMonthHolidayCalendar(db, ctx.year, ctx.month);

  // 1. Load all enrollments for this academic year to accurately resolve mid-month transfers
  const allEnrollments = db
    .prepare(
      `SELECT se.id, se.student_id, st.student_uid, st.registry_number, st.full_name,
              st.status as student_status, st.updated_at as student_updated_at,
              se.grade_id, g.name as grade_name, se.section_id, s.name as section_name,
              se.enrollment_date, se.is_current, se.ended_at
       FROM student_enrollments se
       JOIN students st ON st.id = se.student_id
       JOIN grades g ON g.id = se.grade_id
       JOIN sections s ON s.id = se.section_id
       WHERE se.academic_year_id = ?
       ORDER BY se.student_id ASC, se.enrollment_date ASC, se.id ASC`
    )
    .all(ctx.academicYear.id) as EnrollmentIntervalRow[];

  const enrollmentsByStudent = new Map<number, EnrollmentIntervalRow[]>();
  for (const row of allEnrollments) {
    const arr = enrollmentsByStudent.get(row.student_id);
    if (arr) arr.push(row);
    else enrollmentsByStudent.set(row.student_id, [row]);
  }

  // 2. Load absences & lesson_converted_days for this section in the selected month
  const monthAbsences = db
    .prepare(
      `SELECT id, student_id, absence_date, status, lessons_count, leave_type,
              permission_type, lesson_numbers_json, counted_as_absence,
              permission_rule_snapshot, threshold_snapshot, notes
       FROM absences
       WHERE academic_year_id = ?
         AND grade_id = ?
         AND section_id = ?
         AND absence_date >= ?
         AND absence_date <= ?
       ORDER BY absence_date ASC, id ASC`
    )
    .all(
      ctx.academicYear.id,
      ctx.gradeId,
      ctx.sectionId,
      ctx.monthStart,
      ctx.monthEnd
    ) as Array<{
    id: number;
    student_id: number;
    absence_date: string;
    status: AbsenceStatus;
    lessons_count: number;
    leave_type: LeaveType | null;
    permission_type: string | null;
    lesson_numbers_json: string | null;
    counted_as_absence: number;
    permission_rule_snapshot: number | null;
    threshold_snapshot: number;
    notes: string | null;
  }>;

  const monthConversions = db
    .prepare(
      `SELECT id, student_id, source_absence_id, converted_date, lessons_consumed, threshold_used
       FROM lesson_converted_days
       WHERE academic_year_id = ?
         AND grade_id = ?
         AND section_id = ?
         AND converted_date >= ?
         AND converted_date <= ?
       ORDER BY converted_date ASC, id ASC`
    )
    .all(
      ctx.academicYear.id,
      ctx.gradeId,
      ctx.sectionId,
      ctx.monthStart,
      ctx.monthEnd
    ) as Array<{
    id: number;
    student_id: number;
    source_absence_id: number;
    converted_date: string;
    lessons_consumed: number;
    threshold_used: number;
  }>;

  const sessionRows = db
    .prepare(
      `SELECT attendance_date
       FROM attendance_sessions
       WHERE academic_year_id = ?
         AND section_id = ?
         AND attendance_date >= ?
         AND attendance_date <= ?`
    )
    .all(ctx.academicYear.id, ctx.sectionId, ctx.monthStart, ctx.monthEnd) as Array<{
    attendance_date: string;
  }>;

  const recordedDatesSet = new Set<string>();
  for (const sr of sessionRows) recordedDatesSet.add(sr.attendance_date);
  for (const a of monthAbsences) recordedDatesSet.add(a.absence_date);

  const activeStudentsInMonthSet = new Set<number>();
  for (const a of monthAbsences) activeStudentsInMonthSet.add(a.student_id);
  for (const c of monthConversions) activeStudentsInMonthSet.add(c.student_id);

  // 3. Determine all students belonging to this section during [monthStart, monthEnd]
  const memberList: ResolvedSectionMembership[] = [];

  for (const [studentId, list] of enrollmentsByStudent.entries()) {
    const first = list[0];
    const intervals: Array<{ start: string; exclusiveEnd: string | null; inclusiveEnd: string | null }> =
      [];
    let transferInDate: string | null = null;
    let transferInFrom: string | null = null;
    let transferOutDate: string | null = null;
    let transferOutTo: string | null = null;
    let earliestStart: string | null = null;
    let latestEnd: string | null = null;

    for (let i = 0; i < list.length; i += 1) {
      const enr = list[i];
      if (enr.grade_id !== ctx.gradeId || enr.section_id !== ctx.sectionId) {
        continue;
      }

      const start = enr.enrollment_date;
      const nextEnr = i + 1 < list.length ? list[i + 1] : null;
      const exclusiveEnd = nextEnr ? nextEnr.enrollment_date : null;

      let inclusiveEnd: string | null = null;
      if (!nextEnr) {
        if (enr.is_current === 0 && enr.ended_at) {
          inclusiveEnd = enr.ended_at.slice(0, 10);
        } else if (first.student_status !== 'active') {
          inclusiveEnd = first.student_updated_at.slice(0, 10);
        }
      }

      const intervalOverlapsMonth =
        start <= ctx.monthEnd &&
        (!exclusiveEnd || (exclusiveEnd > ctx.monthStart && exclusiveEnd > start)) &&
        (!inclusiveEnd || (inclusiveEnd >= ctx.monthStart && inclusiveEnd >= start));

      if (intervalOverlapsMonth || activeStudentsInMonthSet.has(studentId)) {
        intervals.push({ start, exclusiveEnd, inclusiveEnd });
        if (!earliestStart || start < earliestStart) earliestStart = start;
        if (exclusiveEnd && (!latestEnd || exclusiveEnd > latestEnd)) {
          latestEnd = exclusiveEnd;
        } else if (inclusiveEnd && (!latestEnd || inclusiveEnd > latestEnd)) {
          latestEnd = inclusiveEnd;
        }
      }

      if (
        i > 0 &&
        (list[i - 1].grade_id !== ctx.gradeId || list[i - 1].section_id !== ctx.sectionId) &&
        start >= ctx.monthStart &&
        start <= ctx.monthEnd
      ) {
        transferInDate = start;
        transferInFrom = `${list[i - 1].grade_name} - ${list[i - 1].section_name}`;
      }

      if (
        nextEnr &&
        (nextEnr.grade_id !== ctx.gradeId || nextEnr.section_id !== ctx.sectionId) &&
        nextEnr.enrollment_date >= ctx.monthStart &&
        nextEnr.enrollment_date <= ctx.monthEnd
      ) {
        transferOutDate = nextEnr.enrollment_date;
        transferOutTo = `${nextEnr.grade_name} - ${nextEnr.section_name}`;
      }
    }

    const hasOverlappingEnrollment = intervals.some(
      (iv) =>
        iv.start <= ctx.monthEnd &&
        (!iv.exclusiveEnd || (iv.exclusiveEnd > ctx.monthStart && iv.exclusiveEnd > iv.start)) &&
        (!iv.inclusiveEnd || (iv.inclusiveEnd >= ctx.monthStart && iv.inclusiveEnd >= iv.start))
    );

    if (hasOverlappingEnrollment || activeStudentsInMonthSet.has(studentId)) {
      memberList.push({
        student_id: studentId,
        student_uid: first.student_uid,
        registry_number: first.registry_number,
        full_name: first.full_name,
        intervals,
        enrollment_start_date: earliestStart,
        enrollment_end_date: latestEnd,
        transfer_in_date: transferInDate,
        transfer_out_date: transferOutDate,
        transfer_in_from: transferInFrom,
        transfer_out_to: transferOutTo,
        has_section_activity_in_month: activeStudentsInMonthSet.has(studentId),
      });
    }
  }

  // Fallback for any absence row whose student somehow wasn't in enrollments map
  const memberIdsSet = new Set(memberList.map((m) => m.student_id));
  for (const stId of activeStudentsInMonthSet) {
    if (!memberIdsSet.has(stId)) {
      const st = db
        .prepare('SELECT id, student_uid, registry_number, full_name FROM students WHERE id = ?')
        .get(stId) as
        | { id: number; student_uid: string; registry_number: string | null; full_name: string }
        | undefined;
      if (st) {
        memberList.push({
          student_id: st.id,
          student_uid: st.student_uid,
          registry_number: st.registry_number,
          full_name: st.full_name,
          intervals: [],
          enrollment_start_date: null,
          enrollment_end_date: null,
          transfer_in_date: null,
          transfer_out_date: null,
          transfer_in_from: null,
          transfer_out_to: null,
          has_section_activity_in_month: true,
        });
      }
    }
  }

  // Original order = deterministic SQLite student ID ascending (original enrollment order)
  memberList.sort((a, b) => a.student_id - b.student_id);

  // 4. Load lesson numbers for lesson_permission records in this month
  const absenceIds = monthAbsences.map((a) => a.id);
  const lessonNumbersMap = new Map<number, number[]>();
  if (absenceIds.length > 0) {
    const placeholders = absenceIds.map(() => '?').join(',');
    const detailRows = db
      .prepare(
        `SELECT absence_id, lesson_number
         FROM absence_lesson_details
         WHERE absence_id IN (${placeholders})
         ORDER BY lesson_number ASC`
      )
      .all(...absenceIds) as Array<{ absence_id: number; lesson_number: number }>;

    for (const r of detailRows) {
      const arr = lessonNumbersMap.get(r.absence_id);
      if (arr) arr.push(r.lesson_number);
      else lessonNumbersMap.set(r.absence_id, [r.lesson_number]);
    }
  }

  // Map absences and conversions by (student_id, date)
  const absenceByStudentDate = new Map<string, (typeof monthAbsences)[number]>();
  for (const a of monthAbsences) {
    absenceByStudentDate.set(`${a.student_id}:${a.absence_date}`, a);
  }

  const conversionsByStudentDate = new Map<string, Array<(typeof monthConversions)[number]>>();
  const conversionsByStudent = new Map<number, Array<(typeof monthConversions)[number]>>();
  for (const c of monthConversions) {
    const key = `${c.student_id}:${c.converted_date}`;
    const list = conversionsByStudentDate.get(key);
    if (list) list.push(c);
    else conversionsByStudentDate.set(key, [c]);

    const sList = conversionsByStudent.get(c.student_id);
    if (sList) sList.push(c);
    else conversionsByStudent.set(c.student_id, [c]);
  }

  // 5. Load year-wide pending lessons & manual notes for member students
  const memberIds = memberList.map((m) => m.student_id);
  const yearPendingMap = new Map<number, number>();
  const manualNotesMap = new Map<number, string>();

  if (memberIds.length > 0) {
    const placeholders = memberIds.map(() => '?').join(',');

    const yearMissedRows = db
      .prepare(
        `SELECT student_id,
                COALESCE(SUM(CASE WHEN status = 'lesson_absence' OR (status = 'lesson_permission' AND counted_as_absence = 1) THEN lessons_count ELSE 0 END), 0) as total_missed
         FROM absences
         WHERE academic_year_id = ? AND student_id IN (${placeholders})
         GROUP BY student_id`
      )
      .all(ctx.academicYear.id, ...memberIds) as Array<{
      student_id: number;
      total_missed: number;
    }>;

    const yearConsumedRows = db
      .prepare(
        `SELECT student_id, COALESCE(SUM(lessons_consumed), 0) as consumed
         FROM lesson_converted_days
         WHERE academic_year_id = ? AND student_id IN (${placeholders})
         GROUP BY student_id`
      )
      .all(ctx.academicYear.id, ...memberIds) as Array<{
      student_id: number;
      consumed: number;
    }>;

    const consumedMap = new Map<number, number>();
    for (const r of yearConsumedRows) consumedMap.set(r.student_id, r.consumed);
    for (const r of yearMissedRows) {
      const consumed = consumedMap.get(r.student_id) ?? 0;
      yearPendingMap.set(r.student_id, Math.max(0, r.total_missed - consumed));
    }

    const noteRows = db
      .prepare(
        `SELECT student_id, note_text
         FROM monthly_student_notes
         WHERE academic_year_id = ? AND year = ? AND month = ? AND student_id IN (${placeholders})`
      )
      .all(ctx.academicYear.id, ctx.year, ctx.month, ...memberIds) as Array<{
      student_id: number;
      note_text: string;
    }>;

    for (const nr of noteRows) {
      manualNotesMap.set(nr.student_id, nr.note_text);
    }
  }

  // 6. Build rows & full section statistics
  const allStudentRows: MonthlyStudentRow[] = memberList.map((member, index) => {
    const days: Record<number, MonthlyDayCellData> = {};
    const autoNotes: string[] = [];

    if (member.transfer_in_date && member.transfer_in_from) {
      autoNotes.push(
        `نُقل الطالب إلى هذه الشعبة بتاريخ ${member.transfer_in_date} قادماً من (${member.transfer_in_from}).`
      );
    }
    if (member.transfer_out_date && member.transfer_out_to) {
      autoNotes.push(
        `نُقل الطالب من هذه الشعبة بتاريخ ${member.transfer_out_date} إلى (${member.transfer_out_to}).`
      );
    }

    let directFullDays = 0;
    let convertedLessonDays = 0;
    let missedLessonsCount = 0;
    let sickLeaveDays = 0;
    let dailyPermissionDays = 0;
    let countedDailyPermissionDays = 0;
    let lessonPermissionRecords = 0;

    for (const calDay of calendarDays) {
      const key = `${member.student_id}:${calDay.date}`;
      const absRow = absenceByStudentDate.get(key);
      const dayConversions = conversionsByStudentDate.get(key) ?? [];
      const inMembership = isDateWithinIntervals(calDay.date, member.intervals);
      const outsideMembership = !inMembership && !absRow && dayConversions.length === 0;

      if (calDay.is_holiday) {
        days[calDay.day_of_month] = {
          date: calDay.date,
          day_of_month: calDay.day_of_month,
          day_name: calDay.day_name,
          symbol: 'ع',
          status_kind: 'holiday',
          has_record: false,
          record_id: null,
          raw_status: null,
          lessons_count: 0,
          lesson_numbers: [],
          leave_type: null,
          counted_as_absence: false,
          contributed_to_counter: false,
          generated_converted_day: false,
          converted_days_count: 0,
          threshold_used: null,
          notes: null,
          holiday_info: calendarDayToHolidayCheck(calDay),
          outside_section_membership: outsideMembership,
        };
        continue;
      }

      const lessonNumbers =
        absRow && absRow.status === 'lesson_permission'
          ? (lessonNumbersMap.get(absRow.id) ??
            parseLessonNumbersFallback(absRow.lesson_numbers_json))
          : [];

      const lessonsCount = absRow ? absRow.lessons_count : 0;
      const convertedCountToday = dayConversions.length;
      const generatedConverted = convertedCountToday > 0;
      const thresholdUsed = generatedConverted
        ? dayConversions[0].threshold_used
        : absRow
          ? absRow.threshold_snapshot
          : null;

      // Totals tracking (strictly based on stored records in this section & month)
      if (absRow) {
        if (absRow.status === 'full_day') {
          directFullDays += 1;
        } else if (absRow.status === 'lesson_absence') {
          missedLessonsCount += absRow.lessons_count;
        } else if (absRow.status === 'full_day_leave') {
          if (absRow.leave_type === 'sick_leave') {
            sickLeaveDays += 1;
            const reasonSuffix = absRow.notes ? ` (${absRow.notes})` : '';
            autoNotes.push(
              `إجازة مرضية بتاريخ ${calDay.date} — لا تُحتسب غياباً${reasonSuffix}.`
            );
          } else if (absRow.leave_type === 'daily_permission') {
            dailyPermissionDays += 1;
            const isCounted = absRow.counted_as_absence === 1;
            if (isCounted) countedDailyPermissionDays += 1;
            const reasonSuffix = absRow.notes ? ` (${absRow.notes})` : '';
            autoNotes.push(
              isCounted
                ? `رخصة يومية بتاريخ ${calDay.date} — احتُسبت يوم غياب كامل${reasonSuffix}.`
                : `رخصة يومية بتاريخ ${calDay.date} — غير محسوبة ضمن الغياب${reasonSuffix}.`
            );
          }
        } else if (absRow.status === 'lesson_permission') {
          lessonPermissionRecords += 1;
          const isCounted = absRow.counted_as_absence === 1;
          if (isCounted) {
            missedLessonsCount += absRow.lessons_count;
          }
          const lessonNamesText = formatLessonOrdinals(lessonNumbers);
          const reasonSuffix = absRow.notes ? ` (${absRow.notes})` : '';
          autoNotes.push(
            isCounted
              ? `رخصة درس بتاريخ ${calDay.date} (${lessonNamesText}) — أُضيفت لعداد الدروس${reasonSuffix}.`
              : `رخصة درس بتاريخ ${calDay.date} (${lessonNamesText}) — غير محسوبة${reasonSuffix}.`
          );
        }
      }

      if (generatedConverted) {
        convertedLessonDays += convertedCountToday;
        for (const conv of dayConversions) {
          autoNotes.push(
            `تم احتساب يوم غياب كامل بتاريخ ${conv.converted_date} نتيجة تراكم ${conv.threshold_used} دروس غياب (بواقع يوم واحد).`
          );
        }
      }

      // Cell Symbol Determination:
      // Conversion takes display priority ('ج') on the date it completed
      if (generatedConverted) {
        const contributed =
          absRow?.status === 'lesson_absence' ||
          (absRow?.status === 'lesson_permission' && absRow.counted_as_absence === 1);
        days[calDay.day_of_month] = {
          date: calDay.date,
          day_of_month: calDay.day_of_month,
          day_name: calDay.day_name,
          symbol: 'ج',
          status_kind: 'lesson_converted',
          has_record: Boolean(absRow),
          record_id: absRow?.id ?? null,
          raw_status: absRow?.status ?? null,
          lessons_count: lessonsCount,
          lesson_numbers: lessonNumbers,
          leave_type: absRow?.leave_type ?? null,
          counted_as_absence: true,
          contributed_to_counter: Boolean(contributed),
          generated_converted_day: true,
          converted_days_count: convertedCountToday,
          threshold_used: thresholdUsed,
          notes: absRow?.notes ?? null,
          holiday_info: null,
          outside_section_membership: outsideMembership,
        };
        continue;
      }

      if (!absRow || absRow.status === 'present') {
        const isRecordedPresent =
          absRow?.status === 'present' ||
          (inMembership && recordedDatesSet.has(calDay.date));

        days[calDay.day_of_month] = {
          date: calDay.date,
          day_of_month: calDay.day_of_month,
          day_name: calDay.day_name,
          symbol: isRecordedPresent ? '✓' : '',
          status_kind: isRecordedPresent ? 'present' : 'unrecorded',
          has_record: Boolean(absRow),
          record_id: absRow?.id ?? null,
          raw_status: absRow?.status ?? null,
          lessons_count: 0,
          lesson_numbers: [],
          leave_type: null,
          counted_as_absence: false,
          contributed_to_counter: false,
          generated_converted_day: false,
          converted_days_count: 0,
          threshold_used: null,
          notes: absRow?.notes ?? null,
          holiday_info: null,
          outside_section_membership: outsideMembership,
        };
        continue;
      }

      if (absRow.status === 'full_day') {
        days[calDay.day_of_month] = {
          date: calDay.date,
          day_of_month: calDay.day_of_month,
          day_name: calDay.day_name,
          symbol: 'غ',
          status_kind: 'full_day',
          has_record: true,
          record_id: absRow.id,
          raw_status: absRow.status,
          lessons_count: 0,
          lesson_numbers: [],
          leave_type: null,
          counted_as_absence: true,
          contributed_to_counter: false,
          generated_converted_day: false,
          converted_days_count: 0,
          threshold_used: null,
          notes: absRow.notes,
          holiday_info: null,
          outside_section_membership: outsideMembership,
        };
      } else if (absRow.status === 'lesson_absence') {
        days[calDay.day_of_month] = {
          date: calDay.date,
          day_of_month: calDay.day_of_month,
          day_name: calDay.day_name,
          symbol: `د${toArabicIndicDigits(absRow.lessons_count)}`,
          status_kind: 'lesson_absence',
          has_record: true,
          record_id: absRow.id,
          raw_status: absRow.status,
          lessons_count: absRow.lessons_count,
          lesson_numbers: [],
          leave_type: null,
          counted_as_absence: false,
          contributed_to_counter: true,
          generated_converted_day: false,
          converted_days_count: 0,
          threshold_used: absRow.threshold_snapshot,
          notes: absRow.notes,
          holiday_info: null,
          outside_section_membership: outsideMembership,
        };
      } else if (absRow.status === 'full_day_leave') {
        const isSick = absRow.leave_type === 'sick_leave';
        days[calDay.day_of_month] = {
          date: calDay.date,
          day_of_month: calDay.day_of_month,
          day_name: calDay.day_name,
          symbol: isSick ? 'م' : 'ر',
          status_kind: isSick ? 'sick_leave' : 'daily_permission',
          has_record: true,
          record_id: absRow.id,
          raw_status: absRow.status,
          lessons_count: 0,
          lesson_numbers: [],
          leave_type: absRow.leave_type,
          counted_as_absence: isSick ? false : absRow.counted_as_absence === 1,
          contributed_to_counter: false,
          generated_converted_day: false,
          converted_days_count: 0,
          threshold_used: null,
          notes: absRow.notes,
          holiday_info: null,
          outside_section_membership: outsideMembership,
        };
      } else {
        // lesson_permission
        const count = absRow.lessons_count || lessonNumbers.length;
        const isCounted = absRow.counted_as_absence === 1;
        days[calDay.day_of_month] = {
          date: calDay.date,
          day_of_month: calDay.day_of_month,
          day_name: calDay.day_name,
          symbol: `ح${toArabicIndicDigits(count)}`,
          status_kind: 'lesson_permission',
          has_record: true,
          record_id: absRow.id,
          raw_status: absRow.status,
          lessons_count: count,
          lesson_numbers: lessonNumbers,
          leave_type: null,
          counted_as_absence: isCounted,
          contributed_to_counter: isCounted,
          generated_converted_day: false,
          converted_days_count: 0,
          threshold_used: isCounted ? absRow.threshold_snapshot : null,
          notes: absRow.notes,
          holiday_info: null,
          outside_section_membership: outsideMembership,
        };
      }
    }

    const totalCountedAbsenceDays =
      directFullDays + countedDailyPermissionDays + convertedLessonDays;

    return {
      student_id: member.student_id,
      student_uid: member.student_uid,
      registry_number: member.registry_number,
      full_name: member.full_name,
      original_order: index + 1,
      enrollment_start_date: member.enrollment_start_date,
      enrollment_end_date: member.enrollment_end_date,
      transfer_in_date: member.transfer_in_date,
      transfer_out_date: member.transfer_out_date,
      transfer_in_from: member.transfer_in_from,
      transfer_out_to: member.transfer_out_to,
      days,
      direct_full_days: directFullDays,
      converted_lesson_days: convertedLessonDays,
      missed_lessons_count: missedLessonsCount,
      sick_leave_days: sickLeaveDays,
      daily_permission_days: dailyPermissionDays,
      counted_daily_permission_days: countedDailyPermissionDays,
      lesson_permission_records: lessonPermissionRecords,
      total_counted_absence_days: totalCountedAbsenceDays,
      year_pending_lessons: yearPendingMap.get(member.student_id) ?? 0,
      auto_notes: autoNotes,
      manual_note: manualNotesMap.get(member.student_id) ?? null,
    };
  });

  // Compute section-wide stats before applying search filter
  const stats: MonthlyRegisterStats = {
    total_students: allStudentRows.length,
    students_with_counted_absence: allStudentRows.filter(
      (r) => r.total_counted_absence_days > 0
    ).length,
    total_counted_absence_days: allStudentRows.reduce(
      (sum, r) => sum + r.total_counted_absence_days,
      0
    ),
    total_direct_full_days: allStudentRows.reduce((sum, r) => sum + r.direct_full_days, 0),
    total_converted_lesson_days: allStudentRows.reduce(
      (sum, r) => sum + r.converted_lesson_days,
      0
    ),
    total_sick_leave_days: allStudentRows.reduce((sum, r) => sum + r.sick_leave_days, 0),
    total_daily_permission_days: allStudentRows.reduce(
      (sum, r) => sum + r.daily_permission_days,
      0
    ),
    total_lesson_permission_records: allStudentRows.reduce(
      (sum, r) => sum + r.lesson_permission_records,
      0
    ),
  };

  let visibleRows = allStudentRows;
  const searchQuery = normalizeArabicLookup(query.search ?? '');
  if (searchQuery) {
    visibleRows = visibleRows.filter(
      (row) =>
        normalizeArabicLookup(row.full_name).includes(searchQuery) ||
        normalizeArabicLookup(row.registry_number ?? '').includes(searchQuery) ||
        normalizeArabicLookup(row.student_uid).includes(searchQuery)
    );
  }

  if (query.sort_mode === 'alphabetical') {
    visibleRows = [...visibleRows].sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'));
  }

  return {
    academic_year: ctx.academicYear,
    year: ctx.year,
    month: ctx.month,
    month_name: ctx.monthName,
    days_in_month: ctx.daysInMonth,
    calendar_days: calendarDays,
    grade_id: ctx.gradeId,
    grade_name: ctx.gradeName,
    section_id: ctx.sectionId,
    section_name: ctx.sectionName,
    school_settings: schoolSettings,
    stats,
    students: visibleRows,
    legend: MONTHLY_LEGEND,
  };
}

export function saveMonthlyStudentNote(
  db: SqliteDb,
  input: SaveMonthlyNoteInput
): { student_id: number; year: number; month: number; manual_note: string | null } {
  const academicYearId = Number(input.academic_year_id);
  const studentId = Number(input.student_id);
  const year = Number(input.year);
  const month = Number(input.month);

  if (!Number.isInteger(academicYearId) || academicYearId <= 0) {
    throw new ServiceError('معرف السنة الدراسية غير صالح.', 400);
  }
  if (!Number.isInteger(studentId) || studentId <= 0) {
    throw new ServiceError('معرف الطالب غير صالح.', 400);
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new ServiceError('السنة الميلادية غير صالحة.', 400);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new ServiceError('الشهر غير صالح.', 400);
  }

  const student = db.prepare('SELECT id FROM students WHERE id = ?').get(studentId) as
    | { id: number }
    | undefined;
  if (!student) {
    throw new ServiceError('الطالب غير موجود.', 404, 'STUDENT_NOT_FOUND');
  }

  const cleanText = normalizeNullableString(input.note_text);
  if (!cleanText) {
    db.prepare(
      `DELETE FROM monthly_student_notes
       WHERE academic_year_id = ? AND student_id = ? AND year = ? AND month = ?`
    ).run(academicYearId, studentId, year, month);

    return { student_id: studentId, year, month, manual_note: null };
  }

  if (cleanText.length > 500) {
    throw new ServiceError('يجب ألا يتجاوز نص الملاحظة اليدوية 500 حرف.', 400);
  }

  db.prepare(
    `INSERT INTO monthly_student_notes
       (academic_year_id, student_id, year, month, note_text, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(academic_year_id, student_id, year, month)
     DO UPDATE SET note_text = excluded.note_text, updated_at = datetime('now')`
  ).run(academicYearId, studentId, year, month, cleanText);

  return { student_id: studentId, year, month, manual_note: cleanText };
}

export function deleteMonthlyStudentNote(
  db: SqliteDb,
  params: { academic_year_id: number; student_id: number; year: number; month: number }
): void {
  const academicYearId = Number(params.academic_year_id);
  const studentId = Number(params.student_id);
  const year = Number(params.year);
  const month = Number(params.month);

  if (!Number.isInteger(academicYearId) || academicYearId <= 0) {
    throw new ServiceError('معرف السنة الدراسية غير صالح.', 400);
  }
  if (!Number.isInteger(studentId) || studentId <= 0) {
    throw new ServiceError('معرف الطالب غير صالح.', 400);
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new ServiceError('السنة غير صالحة.', 400);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new ServiceError('الشهر غير صالح.', 400);
  }

  db.prepare(
    `DELETE FROM monthly_student_notes
     WHERE academic_year_id = ? AND student_id = ? AND year = ? AND month = ?`
  ).run(academicYearId, studentId, year, month);
}

function getExcelCellStyleForSymbol(cellData: MonthlyDayCellData): {
  bg: string;
  fg: string;
  bold: boolean;
} {
  switch (cellData.status_kind) {
    case 'full_day':
      return { bg: 'FFFEE2E2', fg: 'FF991B1B', bold: true };
    case 'lesson_converted':
      return { bg: 'FFF3E8FF', fg: 'FF6B21A8', bold: true };
    case 'lesson_absence':
      return { bg: 'FFFEF3C7', fg: 'FF92400E', bold: true };
    case 'sick_leave':
      return { bg: 'FFCCFBF1', fg: 'FF115E59', bold: true };
    case 'daily_permission':
      return { bg: 'FFE0F2FE', fg: 'FF075985', bold: true };
    case 'lesson_permission':
      return { bg: 'FFE0E7FF', fg: 'FF3730A3', bold: true };
    case 'holiday':
      return { bg: 'FFF1F5F9', fg: 'FF475569', bold: true };
    case 'present':
      return { bg: 'FFDCFCE7', fg: 'FF15803D', bold: true };
    default:
      return { bg: 'FFFFFFFF', fg: 'FFCBD5E1', bold: false };
  }
}

export async function generateMonthlyRegisterExcel(
  db: SqliteDb,
  query: MonthlyRegisterQuery
): Promise<{ buffer: Buffer; filename: string; data: MonthlyRegisterData }> {
  const data = getMonthlyAbsenceRegister(db, query);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'نظام إدارة الغيابات المدرسية الإلكتروني';
  workbook.created = new Date();

  const sheetTitle = `السجل الشهري - ${data.month_name}`;
  const sheet = workbook.addWorksheet(sheetTitle.slice(0, 31), {
    views: [{ rightToLeft: true, state: 'frozen', xSplit: 1, ySplit: 5 }],
    pageSetup: {
      paperSize: 8 as ExcelJS.PaperSize,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.35,
        right: 0.35,
        top: 0.45,
        bottom: 0.45,
        header: 0.2,
        footer: 0.2,
      },
    },
  });

  const totalCols = 1 + data.days_in_month + 8; // Student Name + days + 7 totals + notes

  const colWidths: number[] = [28];
  for (let d = 0; d < data.days_in_month; d += 1) {
    colWidths.push(4.4);
  }
  colWidths.push(11, 12, 11, 11, 11, 11, 13, 42);
  colWidths.forEach((w, idx) => {
    sheet.getColumn(idx + 1).width = w;
  });

  const thinBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  };

  // Row 1: Official Header
  sheet.mergeCells(1, 1, 1, totalCols);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `${data.school_settings.directorate_name} — ${data.school_settings.school_name} | السجل الشهري للغيابات (${data.month_name} ${data.year})`;
  titleCell.font = { name: 'Cairo', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 30;

  // Row 2: Filter Metadata
  sheet.mergeCells(2, 1, 2, totalCols);
  const metaCell = sheet.getCell(2, 1);
  metaCell.value = `السنة الدراسية: ${data.academic_year.name}   |   الصف: ${data.grade_name}   |   الشعبة: ${data.section_name}   |   عدد الطلاب: ${data.stats.total_students}   |   نصاب تحويل الدروس: ${data.school_settings.lessons_per_absence_day} دروس = يوم واحد`;
  metaCell.font = { name: 'Almarai', size: 10.5, bold: true, color: { argb: 'FF0F172A' } };
  metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  metaCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(2).height = 24;

  // Row 3: Legend
  sheet.mergeCells(3, 1, 3, totalCols);
  const legendCell = sheet.getCell(3, 1);
  legendCell.value =
    'دليل الرموز:   ✓ = حاضر   |   غ = غائب يوم كامل   |   ج = يوم غياب من تراكم الدروس   |   د١.. = عدد الدروس الغائبة   |   م = إجازة مرضية (لا تُحسب)   |   ر = رخصة يومية   |   ح١.. = رخصة عن دروس   |   ع = عطلة';
  legendCell.font = { name: 'Almarai', size: 10, color: { argb: 'FF334155' } };
  legendCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAF5FF' } };
  legendCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  sheet.getRow(3).height = 22;

  // Row 4 & 5: Table Header
  const headerRowTop = sheet.getRow(4);
  const headerRowSub = sheet.getRow(5);
  headerRowTop.height = 24;
  headerRowSub.height = 22;

  sheet.getCell(4, 1).value = 'اسم الطالب';
  sheet.mergeCells(4, 1, 5, 1);

  for (let i = 0; i < data.calendar_days.length; i += 1) {
    const colIdx = 2 + i;
    const calDay = data.calendar_days[i];
    sheet.getCell(4, colIdx).value = calDay.day_of_month;
    sheet.getCell(5, colIdx).value = calDay.day_name.replace('ال', '');
  }

  const summaryTitles = [
    'الغياب المباشر',
    'أيام تراكم الدروس',
    'الدروس الغائبة',
    'الإجازات المرضية',
    'الرخص اليومية',
    'رخص الدروس',
    'مجموع الغياب المحتسب',
    'الملاحظات',
  ];

  const summaryStartCol = 2 + data.days_in_month;
  for (let i = 0; i < summaryTitles.length; i += 1) {
    const colIdx = summaryStartCol + i;
    sheet.getCell(4, colIdx).value = summaryTitles[i];
    sheet.mergeCells(4, colIdx, 5, colIdx);
  }

  // Style Header Rows
  for (let col = 1; col <= totalCols; col += 1) {
    const topCell = sheet.getCell(4, col);
    const subCell = sheet.getCell(5, col);
    const isDayCol = col >= 2 && col < summaryStartCol;
    const calDay = isDayCol ? data.calendar_days[col - 2] : null;
    const isHolidayCol = Boolean(calDay?.is_holiday);
    const isTotalCol = col === summaryStartCol + 6;

    const bgColor = isHolidayCol
      ? 'FF475569'
      : isTotalCol
        ? 'FF991B1B'
        : col === 1
          ? 'FF0F766E'
          : 'FF1E293B';

    for (const c of [topCell, subCell]) {
      c.font = { name: 'Cairo', size: isDayCol ? 9.5 : 10, bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      c.border = thinBorder;
    }
  }

  // Data Rows
  let currentRowIdx = 6;
  for (let rIdx = 0; rIdx < data.students.length; rIdx += 1) {
    const st = data.students[rIdx];
    const row = sheet.getRow(currentRowIdx);

    const nameCell = row.getCell(1);
    nameCell.value = `${rIdx + 1}. ${st.full_name}`;
    nameCell.font = { name: 'Cairo', size: 10.5, bold: true, color: { argb: 'FF0F172A' } };
    nameCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: rIdx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC' },
    };
    nameCell.alignment = { vertical: 'middle', horizontal: 'right' };
    nameCell.border = thinBorder;

    for (let i = 0; i < data.calendar_days.length; i += 1) {
      const calDay = data.calendar_days[i];
      const cellData = st.days[calDay.day_of_month];
      const cell = row.getCell(2 + i);
      cell.value = cellData.symbol;

      const style = getExcelCellStyleForSymbol(cellData);
      cell.font = { name: 'Cairo', size: 10, bold: style.bold, color: { argb: style.fg } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.bg } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = thinBorder;
    }

    const numericValues = [
      st.direct_full_days,
      st.converted_lesson_days,
      st.missed_lessons_count,
      st.sick_leave_days,
      st.daily_permission_days,
      st.lesson_permission_records,
      st.total_counted_absence_days,
    ];

    for (let i = 0; i < numericValues.length; i += 1) {
      const cell = row.getCell(summaryStartCol + i);
      cell.value = numericValues[i];
      const isFinalTotal = i === numericValues.length - 1;
      cell.font = {
        name: 'Cairo',
        size: 10.5,
        bold: isFinalTotal || numericValues[i] > 0,
        color: {
          argb: isFinalTotal && numericValues[i] > 0 ? 'FF991B1B' : 'FF0F172A',
        },
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: {
          argb: isFinalTotal
            ? numericValues[i] > 0
              ? 'FFFEF2F2'
              : 'FFF8FAFC'
            : rIdx % 2 === 0
              ? 'FFFFFFFF'
              : 'FFF8FAFC',
        },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = thinBorder;
    }

    const combinedNotesParts: string[] = [];
    if (st.auto_notes.length > 0) {
      combinedNotesParts.push(...st.auto_notes);
    }
    if (st.manual_note) {
      combinedNotesParts.push(`ملاحظة الإدارة: ${st.manual_note}`);
    }
    const notesCell = row.getCell(summaryStartCol + 7);
    notesCell.value = combinedNotesParts.length > 0 ? combinedNotesParts.join(' | ') : '—';
    notesCell.font = { name: 'Almarai', size: 9.5, color: { argb: 'FF334155' } };
    notesCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: rIdx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC' },
    };
    notesCell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true };
    notesCell.border = thinBorder;

    const lineCount = Math.max(1, Math.ceil((notesCell.value?.toString().length ?? 0) / 48));
    row.height = Math.max(22, Math.min(72, lineCount * 15 + 6));
    currentRowIdx += 1;
  }

  // Summary Totals Row
  const totalsRow = sheet.getRow(currentRowIdx);
  totalsRow.height = 26;
  const totalsTitleCell = totalsRow.getCell(1);
  totalsTitleCell.value = `المجموع العام (${data.stats.total_students} طالب)`;
  totalsTitleCell.font = { name: 'Cairo', size: 10.5, bold: true, color: { argb: 'FF0F172A' } };
  totalsTitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  totalsTitleCell.alignment = { vertical: 'middle', horizontal: 'right' };
  totalsTitleCell.border = thinBorder;

  for (let i = 0; i < data.days_in_month; i += 1) {
    const c = totalsRow.getCell(2 + i);
    c.value = '';
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    c.border = thinBorder;
  }

  const grandTotals = [
    data.stats.total_direct_full_days,
    data.stats.total_converted_lesson_days,
    data.students.reduce((s, r) => s + r.missed_lessons_count, 0),
    data.stats.total_sick_leave_days,
    data.stats.total_daily_permission_days,
    data.stats.total_lesson_permission_records,
    data.stats.total_counted_absence_days,
  ];
  for (let i = 0; i < grandTotals.length; i += 1) {
    const c = totalsRow.getCell(summaryStartCol + i);
    c.value = grandTotals[i];
    c.font = { name: 'Cairo', size: 11, bold: true, color: { argb: 'FF0F172A' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
    c.border = thinBorder;
  }

  const totalsNotesCell = totalsRow.getCell(summaryStartCol + 7);
  totalsNotesCell.value = `طلاب لديهم غياب محتسب: ${data.stats.students_with_counted_absence}`;
  totalsNotesCell.font = { name: 'Cairo', size: 10, bold: true, color: { argb: 'FF0F172A' } };
  totalsNotesCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  totalsNotesCell.alignment = { vertical: 'middle', horizontal: 'right' };
  totalsNotesCell.border = thinBorder;

  // Signature Footer Row
  const sigRowIdx = currentRowIdx + 2;
  sheet.mergeCells(sigRowIdx, 1, sigRowIdx, Math.floor(totalCols / 3));
  sheet.getCell(sigRowIdx, 1).value = 'مسؤول سجل الغيابات: ............................';
  sheet.getCell(sigRowIdx, 1).font = { name: 'Cairo', size: 10.5, bold: true };
  sheet.getCell(sigRowIdx, 1).alignment = { horizontal: 'right', vertical: 'middle' };

  const midStart = Math.floor(totalCols / 3) + 1;
  const midEnd = Math.floor((totalCols * 2) / 3);
  sheet.mergeCells(sigRowIdx, midStart, sigRowIdx, midEnd);
  sheet.getCell(sigRowIdx, midStart).value = 'معاون المدير: ............................';
  sheet.getCell(sigRowIdx, midStart).font = { name: 'Cairo', size: 10.5, bold: true };
  sheet.getCell(sigRowIdx, midStart).alignment = { horizontal: 'center', vertical: 'middle' };

  sheet.mergeCells(sigRowIdx, midEnd + 1, sigRowIdx, totalCols);
  sheet.getCell(sigRowIdx, midEnd + 1).value = 'مدير المدرسة: ............................';
  sheet.getCell(sigRowIdx, midEnd + 1).font = { name: 'Cairo', size: 10.5, bold: true };
  sheet.getCell(sigRowIdx, midEnd + 1).alignment = { horizontal: 'left', vertical: 'middle' };
  sheet.getRow(sigRowIdx).height = 24;

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  const safeGrade = data.grade_name.replace(/\s+/g, '_');
  const safeSec = data.section_name.replace(/\s+/g, '_');
  const safeMonth = data.month_name.replace(/\s+/g, '_');
  const filename = `السجل_الشهري_${safeGrade}_${safeSec}_${safeMonth}_${data.year}.xlsx`;

  return {
    buffer: Buffer.from(arrayBuffer),
    filename,
    data,
  };
}
