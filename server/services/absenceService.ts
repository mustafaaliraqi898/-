import type {
  AbsenceStatus,
  AcademicYear,
  AttendanceSessionInfo,
  SaveSectionAttendanceInput,
  SaveSectionAttendanceResult,
  SectionAttendanceSheet,
  StudentAbsenceDetailResponse,
  StudentAbsenceSheetRow,
} from '../../src/types/school';
import type { SqliteDb } from '../db/connection';
import { ServiceError, normalizeNullableString } from '../utils/validation';
import { getActiveAcademicYear, getSchoolSettings } from './settingsService';

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

/**
 * Deterministically reconciles converted absence days from preserved daily lesson_absence rows
 * for a single student within a single academic year.
 * - Uses each row's stored threshold_snapshot so changes to Settings affect new records only.
 * - Never deletes or modifies original daily absence records.
 * - Completely independent of direct full_day absences.
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
       WHERE student_id = ? AND academic_year_id = ? AND status = 'lesson_absence' AND lessons_count > 0
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
    saved_notes: string | null;
    record_created_at: string | null;
    record_updated_at: string | null;
  }>;

  const directCountsRows = db
    .prepare(
      `SELECT student_id, COUNT(*) as direct_full_days
       FROM absences
       WHERE academic_year_id = ? AND status = 'full_day'
       GROUP BY student_id`
    )
    .all(year.id) as Array<{ student_id: number; direct_full_days: number }>;

  const directMap = new Map<number, number>();
  for (const r of directCountsRows) directMap.set(r.student_id, r.direct_full_days);

  const lessonSumsRows = db
    .prepare(
      `SELECT student_id, COALESCE(SUM(lessons_count), 0) as total_lessons
       FROM absences
       WHERE academic_year_id = ? AND status = 'lesson_absence'
       GROUP BY student_id`
    )
    .all(year.id) as Array<{ student_id: number; total_lessons: number }>;

  const lessonTotalMap = new Map<number, number>();
  for (const r of lessonSumsRows) lessonTotalMap.set(r.student_id, r.total_lessons);

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
    const directFullDays = directMap.get(r.student_id) ?? 0;
    const conv = convertedMap.get(r.student_id) ?? { converted_days: 0, consumed_lessons: 0 };
    const totalLessonsMissed = lessonTotalMap.get(r.student_id) ?? 0;
    const pendingLessons = Math.max(0, totalLessonsMissed - conv.consumed_lessons);

    return {
      student_id: r.student_id,
      enrollment_id: r.enrollment_id,
      student_uid: r.student_uid,
      registry_number: r.registry_number,
      full_name: r.full_name,
      record_id: r.record_id,
      status: r.saved_status ?? 'present',
      lessons_count: r.saved_status === 'lesson_absence' ? (r.saved_lessons_count ?? 1) : 0,
      notes: r.saved_notes ?? null,
      record_created_at: r.record_created_at ?? null,
      record_updated_at: r.record_updated_at ?? null,
      has_saved_record: r.record_id !== null,
      direct_full_days: directFullDays,
      converted_lesson_days: conv.converted_days,
      total_full_days: directFullDays + conv.converted_days,
      pending_lessons: pendingLessons,
      total_lessons_missed: totalLessonsMissed,
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

  const seenStudentIds = new Set<number>();
  const normalizedEntries: Array<{
    student_id: number;
    status: AbsenceStatus;
    lessons_count: number;
    notes: string | null;
  }> = [];

  for (const entry of input.entries) {
    const studentId = Number(entry.student_id);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      throw new ServiceError('معرف الطالب غير صالح.', 400);
    }
    if (seenStudentIds.has(studentId)) {
      throw new ServiceError(
        'تم اكتشاف تكرار في بيانات الطالب داخل نفس الدفعة. لا يمكن تسجيل الطالب مرتين في التاريخ نفسه.',
        409,
        'DUPLICATE_STUDENT_IN_BATCH'
      );
    }
    seenStudentIds.add(studentId);

    const status = entry.status;
    if (status !== 'present' && status !== 'full_day' && status !== 'lesson_absence') {
      throw new ServiceError('حالة الحضور المدخلة غير صالحة.', 400);
    }

    let lessonsCount = 0;
    if (status === 'lesson_absence') {
      const parsedLessons = Number(entry.lessons_count);
      if (!Number.isInteger(parsedLessons) || parsedLessons < 1 || parsedLessons > 12) {
        throw new ServiceError(
          'عند اختيار "غياب دروس" يجب تحديد عدد الدروس كرقم صحيح بين 1 و 12.',
          400
        );
      }
      lessonsCount = parsedLessons;
    }

    normalizedEntries.push({
      student_id: studentId,
      status,
      lessons_count: lessonsCount,
      notes: normalizeNullableString(entry.notes),
    });
  }

  const currentThreshold = getSchoolSettings(db).lessons_per_absence_day;

  let presentCount = 0;
  let fullDayCount = 0;
  let lessonAbsenceCount = 0;
  let totalNewlyConvertedDays = 0;

  db.transaction(() => {
    const findExistingDayRecord = db.prepare(
      `SELECT id, enrollment_id, academic_year_id, grade_id, section_id, status, lessons_count, threshold_snapshot
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
          status, lessons_count, threshold_snapshot, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    );

    const updateAbsence = db.prepare(
      `UPDATE absences
       SET status = ?, lessons_count = ?, threshold_snapshot = ?, notes = ?, updated_at = datetime('now')
       WHERE id = ?`
    );

    for (const item of normalizedEntries) {
      if (item.status === 'present') presentCount += 1;
      else if (item.status === 'full_day') fullDayCount += 1;
      else lessonAbsenceCount += 1;

      const existing = findExistingDayRecord.get(item.student_id, attendanceDate) as
        | {
            id: number;
            enrollment_id: number;
            academic_year_id: number;
            grade_id: number;
            section_id: number;
            status: AbsenceStatus;
            lessons_count: number;
            threshold_snapshot: number;
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

        // Preserve historical threshold_snapshot if already a lesson_absence record,
        // otherwise stamp currentThreshold when transitioning to lesson_absence.
        const snapshotToSave =
          existing.status === 'lesson_absence' ? existing.threshold_snapshot : currentThreshold;

        updateAbsence.run(
          item.status,
          item.lessons_count,
          snapshotToSave,
          item.notes,
          existing.id
        );

        if (existing.status === 'lesson_absence' || item.status === 'lesson_absence') {
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

        insertAbsence.run(
          item.student_id,
          enrollment.id,
          year.id,
          grade_id,
          section_id,
          attendanceDate,
          item.status,
          item.lessons_count,
          currentThreshold,
          item.notes
        );

        if (item.status === 'lesson_absence') {
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

  if (input.status !== 'present' && input.status !== 'full_day' && input.status !== 'lesson_absence') {
    throw new ServiceError('حالة الغياب غير صالحة.', 400);
  }

  const lessonsCount = input.status === 'lesson_absence' ? Number(input.lessons_count ?? 0) : 0;
  if (input.status === 'lesson_absence' && (!Number.isInteger(lessonsCount) || lessonsCount < 1 || lessonsCount > 12)) {
    throw new ServiceError('عدد الدروس يجب أن يكون رقماً صحيحاً بين 1 و 12.', 400);
  }

  const currentThreshold = getSchoolSettings(db).lessons_per_absence_day;

  const newId = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO absences
           (student_id, enrollment_id, academic_year_id, grade_id, section_id, absence_date,
            status, lessons_count, threshold_snapshot, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      )
      .run(
        input.student_id,
        enrollment.id,
        year.id,
        enrollment.grade_id,
        enrollment.section_id,
        absenceDate,
        input.status,
        lessonsCount,
        currentThreshold,
        normalizeNullableString(input.notes)
      );

    if (input.status === 'lesson_absence') {
      reconcileStudentLessonCounter(db, input.student_id, year.id);
    }
    return Number(info.lastInsertRowid);
  })();

  return db.prepare('SELECT * FROM absences WHERE id = ?').get(newId);
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
    if (existing.status === 'lesson_absence') {
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

  const records = db
    .prepare(
      `SELECT a.id, a.absence_date, a.status, a.lessons_count, a.threshold_snapshot,
              a.notes, g.name as grade_name, s.name as section_name, a.created_at, a.updated_at
       FROM absences a
       JOIN grades g ON g.id = a.grade_id
       JOIN sections s ON s.id = a.section_id
       WHERE a.student_id = ? AND a.academic_year_id = ?
       ORDER BY a.absence_date DESC, a.id DESC`
    )
    .all(studentId, yearId) as StudentAbsenceDetailResponse['records'];

  const conversions = db
    .prepare(
      `SELECT id, converted_date, lessons_consumed, threshold_used, created_at
       FROM lesson_converted_days
       WHERE student_id = ? AND academic_year_id = ?
       ORDER BY converted_date DESC, id DESC`
    )
    .all(studentId, yearId) as StudentAbsenceDetailResponse['conversions'];

  const directFullDays = records.filter((r) => r.status === 'full_day').length;
  const convertedLessonDays = conversions.length;
  const totalLessonsMissed = records
    .filter((r) => r.status === 'lesson_absence')
    .reduce((acc, r) => acc + r.lessons_count, 0);
  const consumedLessons = conversions.reduce((acc, c) => acc + c.lessons_consumed, 0);

  return {
    student_id: student.id,
    full_name: student.full_name,
    student_uid: student.student_uid,
    registry_number: student.registry_number,
    lessons_per_absence_day: settings.lessons_per_absence_day,
    direct_full_days: directFullDays,
    converted_lesson_days: convertedLessonDays,
    total_full_days: directFullDays + convertedLessonDays,
    pending_lessons: Math.max(0, totalLessonsMissed - consumedLessons),
    total_lessons_missed: totalLessonsMissed,
    records,
    conversions,
  };
}
