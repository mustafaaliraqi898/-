import type {
  DashboardActivityItem,
  DashboardApproachingStudent,
  DashboardExceededStudent,
  DashboardGradeSummary,
  DashboardMonthlyAbsencePoint,
  DashboardStageCountItem,
  DashboardStats,
} from '../../src/types/school';
import type { SqliteDb } from '../db/connection';
import { getAcademicYearAbsenceTotalsMap } from './absenceService';
import { listAbsenceStages } from './absenceStagesService';
import { listGradesWithSections } from './gradeService';
import { ARABIC_MONTH_NAMES } from './monthlyRegisterService';
import { getActiveAcademicYear } from './settingsService';

export interface DashboardFilterOptions {
  gradeId?: number;
  stageId?: number;
}

export function getDashboardStats(
  db: SqliteDb,
  academicYearId?: number,
  filters?: DashboardFilterOptions
): DashboardStats {
  const activeYear = academicYearId
    ? ((db
        .prepare('SELECT id, name, is_active, created_at FROM academic_years WHERE id = ?')
        .get(academicYearId) as ReturnType<typeof getActiveAcademicYear> | undefined) ??
      getActiveAcademicYear(db))
    : getActiveAcademicYear(db);

  const gradeIdFilter =
    filters?.gradeId && Number.isInteger(filters.gradeId) && filters.gradeId > 0
      ? filters.gradeId
      : null;
  const stageIdFilter =
    filters?.stageId && Number.isInteger(filters.stageId) && filters.stageId > 0
      ? filters.stageId
      : null;

  const grades = listGradesWithSections(db, activeYear.id);
  const totalGrades = grades.length;
  const totalSections = grades.reduce((acc, g) => acc + g.sections.length, 0);
  const gradesWithoutSections = grades.filter((g) => g.sections.length === 0).length;
  const sectionsWithoutStudents = grades.reduce(
    (acc, g) => acc + g.sections.filter((s) => s.student_count === 0).length,
    0
  );

  const gradeDistribution: DashboardGradeSummary[] = grades.map((g) => ({
    grade_id: g.id,
    grade_name: g.name,
    sections_count: g.sections.length,
    students_count: g.student_count,
    sections: g.sections.map((s) => ({
      section_id: s.id,
      section_name: s.name,
      students_count: s.student_count,
    })),
  }));

  const enrolledStudents = db
    .prepare(
      `SELECT DISTINCT st.id as student_id, st.full_name, st.registry_number,
              g.id as grade_id, g.name as grade_name,
              sec.id as section_id, sec.name as section_name
       FROM students st
       JOIN student_enrollments se ON se.student_id = st.id
       JOIN grades g ON g.id = se.grade_id
       JOIN sections sec ON sec.id = se.section_id
       WHERE se.academic_year_id = ? AND se.is_current = 1 AND st.status = 'active'`
    )
    .all(activeYear.id) as Array<{
    student_id: number;
    full_name: string;
    registry_number: string | null;
    grade_id: number;
    grade_name: string;
    section_id: number;
    section_name: string;
  }>;

  const scopedByGrade = gradeIdFilter
    ? enrolledStudents.filter((s) => s.grade_id === gradeIdFilter)
    : enrolledStudents;

  const stages = listAbsenceStages(db, activeYear.id);
  const totalsMap = getAcademicYearAbsenceTotalsMap(db, activeYear.id);

  const stageCountsMap = new Map<number, number>();
  stages.forEach((s) => stageCountsMap.set(s.id, 0));

  let withinLimitCount = 0;
  let studentsWithAbsences = 0;
  let studentsWithRegistry = 0;

  const approachingStudents: DashboardApproachingStudent[] = [];
  const exceededStudents: DashboardExceededStudent[] = [];
  const stageMatchedStudentIds = new Set<number>();

  for (const st of scopedByGrade) {
    if (st.registry_number && st.registry_number.trim() !== '') {
      studentsWithRegistry += 1;
    }

    const totals = totalsMap.get(st.student_id);
    const countedDays = totals?.total_full_days ?? 0;
    const totalLessonsMissed = totals?.total_lessons_missed ?? 0;

    let matchedStage: (typeof stages)[number] | null = null;
    for (const s of stages) {
      if (countedDays >= s.days_threshold) {
        matchedStage = s;
      }
    }

    if (matchedStage) {
      stageCountsMap.set(matchedStage.id, (stageCountsMap.get(matchedStage.id) ?? 0) + 1);
    } else {
      withinLimitCount += 1;
    }

    const matchesStageFilter =
      !stageIdFilter || (matchedStage !== null && matchedStage.id === stageIdFilter);

    if (matchesStageFilter) {
      stageMatchedStudentIds.add(st.student_id);
      if (countedDays > 0 || totalLessonsMissed > 0) {
        studentsWithAbsences += 1;
      }

      if (matchedStage) {
        exceededStudents.push({
          student_id: st.student_id,
          full_name: st.full_name,
          grade_name: st.grade_name,
          section_name: st.section_name,
          counted_days: countedDays,
          stage_id: matchedStage.id,
          stage_name: matchedStage.name,
          days_threshold: matchedStage.days_threshold,
        });
      }

      const nextStage = stages.find((s) => s.days_threshold > countedDays);
      if (nextStage && countedDays > 0) {
        const remainingDays = nextStage.days_threshold - countedDays;
        if (remainingDays >= 1 && remainingDays <= 3) {
          approachingStudents.push({
            student_id: st.student_id,
            full_name: st.full_name,
            grade_name: st.grade_name,
            section_name: st.section_name,
            counted_days: countedDays,
            next_stage_id: nextStage.id,
            next_stage_name: nextStage.name,
            next_stage_threshold: nextStage.days_threshold,
            remaining_days: remainingDays,
          });
        }
      }
    }
  }

  approachingStudents.sort(
    (a, b) => a.remaining_days - b.remaining_days || b.counted_days - a.counted_days
  );
  exceededStudents.sort((a, b) => b.counted_days - a.counted_days);

  const stageCounts: DashboardStageCountItem[] = stages.map((s) => ({
    stage_id: s.id,
    stage_name: s.name,
    days_threshold: s.days_threshold,
    students_count: stageCountsMap.get(s.id) ?? 0,
  }));

  const todayIso = new Date().toLocaleDateString('en-CA');
  const absenceSummaryParams: unknown[] = [todayIso, activeYear.id];
  let absenceFilterSql = '';
  if (gradeIdFilter) {
    absenceFilterSql += ' AND grade_id = ?';
    absenceSummaryParams.push(gradeIdFilter);
  }

  const absenceSummary = db
    .prepare(
      `SELECT
         COUNT(DISTINCT absence_date) as absence_days_count,
         MAX(absence_date) as last_absence_date,
         COUNT(DISTINCT CASE WHEN absence_date = ? THEN section_id END) as today_sections_recorded
       FROM absences
       WHERE academic_year_id = ?${absenceFilterSql}`
    )
    .get(...absenceSummaryParams) as {
    absence_days_count: number;
    last_absence_date: string | null;
    today_sections_recorded: number;
  };

  // Real monthly absence breakdown across the academic year
  const rawMonthlyAbsenceRows = db
    .prepare(
      `SELECT
         substr(absence_date, 1, 7) as month_key,
         student_id,
         grade_id,
         status,
         leave_type,
         counted_as_absence
       FROM absences
       WHERE academic_year_id = ?`
    )
    .all(activeYear.id) as Array<{
    month_key: string;
    student_id: number;
    grade_id: number;
    status: string;
    leave_type: string | null;
    counted_as_absence: number;
  }>;

  const rawConvertedRows = db
    .prepare(
      `SELECT
         substr(converted_date, 1, 7) as month_key,
         student_id,
         grade_id
       FROM lesson_converted_days
       WHERE academic_year_id = ?`
    )
    .all(activeYear.id) as Array<{
    month_key: string;
    student_id: number;
    grade_id: number;
  }>;

  const monthlyMap = new Map<
    string,
    {
      full_day_count: number;
      converted_day_count: number;
      leave_count: number;
      affected_students: Set<number>;
    }
  >();

  const shouldIncludeRecord = (studentId: number, recordGradeId: number): boolean => {
    if (gradeIdFilter && recordGradeId !== gradeIdFilter) return false;
    if (stageIdFilter && !stageMatchedStudentIds.has(studentId)) return false;
    return true;
  };

  for (const row of rawMonthlyAbsenceRows) {
    if (!row.month_key || row.month_key.length < 7) continue;
    if (!shouldIncludeRecord(row.student_id, row.grade_id)) continue;

    const isCountedDay =
      row.status === 'full_day' ||
      (row.status === 'full_day_leave' &&
        row.leave_type === 'daily_permission' &&
        row.counted_as_absence === 1);
    const isLeaveDay =
      row.status === 'full_day_leave' &&
      (row.leave_type === 'sick_leave' || row.counted_as_absence === 0);

    if (!isCountedDay && !isLeaveDay) continue;

    let bucket = monthlyMap.get(row.month_key);
    if (!bucket) {
      bucket = {
        full_day_count: 0,
        converted_day_count: 0,
        leave_count: 0,
        affected_students: new Set<number>(),
      };
      monthlyMap.set(row.month_key, bucket);
    }

    if (isCountedDay) {
      bucket.full_day_count += 1;
      bucket.affected_students.add(row.student_id);
    } else if (isLeaveDay) {
      bucket.leave_count += 1;
    }
  }

  for (const conv of rawConvertedRows) {
    if (!conv.month_key || conv.month_key.length < 7) continue;
    if (!shouldIncludeRecord(conv.student_id, conv.grade_id)) continue;

    let bucket = monthlyMap.get(conv.month_key);
    if (!bucket) {
      bucket = {
        full_day_count: 0,
        converted_day_count: 0,
        leave_count: 0,
        affected_students: new Set<number>(),
      };
      monthlyMap.set(conv.month_key, bucket);
    }
    bucket.converted_day_count += 1;
    bucket.affected_students.add(conv.student_id);
  }

  const monthlyAbsences: DashboardMonthlyAbsencePoint[] = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, val]) => {
      const [yStr, mStr] = monthKey.split('-');
      const yearNum = Number(yStr) || 0;
      const monthNum = Number(mStr) || 1;
      const monthName = ARABIC_MONTH_NAMES[monthNum - 1] ?? monthKey;
      return {
        month_key: monthKey,
        month_number: monthNum,
        year_number: yearNum,
        label: `${monthName} ${yearNum}`,
        full_day_count: val.full_day_count,
        converted_day_count: val.converted_day_count,
        leave_count: val.leave_count,
        total_absence_days: val.full_day_count + val.converted_day_count,
        affected_students_count: val.affected_students.size,
      };
    });

  const recentRows = db
    .prepare(
      `SELECT se.id as enrollment_id, st.id as student_id, st.student_uid, st.full_name,
              st.registry_number, g.name as grade_name, s.name as section_name,
              se.enrollment_date, se.transfer_reason, se.created_at,
              (SELECT COUNT(*) FROM student_enrollments prev WHERE prev.student_id = st.id AND prev.id < se.id) as prev_count
       FROM student_enrollments se
       JOIN students st ON st.id = se.student_id
       JOIN grades g ON g.id = se.grade_id
       JOIN sections s ON s.id = se.section_id
       WHERE se.academic_year_id = ?
       ORDER BY se.id DESC
       LIMIT 8`
    )
    .all(activeYear.id) as Array<{
    enrollment_id: number;
    student_id: number;
    student_uid: string;
    full_name: string;
    registry_number: string | null;
    grade_name: string;
    section_name: string;
    enrollment_date: string;
    transfer_reason: string | null;
    created_at: string;
    prev_count: number;
  }>;

  const recentActivities: DashboardActivityItem[] = recentRows.map((r) => ({
    enrollment_id: r.enrollment_id,
    student_id: r.student_id,
    student_uid: r.student_uid,
    full_name: r.full_name,
    registry_number: r.registry_number,
    grade_name: r.grade_name,
    section_name: r.section_name,
    enrollment_date: r.enrollment_date,
    transfer_reason: r.transfer_reason,
    created_at: r.created_at,
    is_transfer: r.prev_count > 0,
  }));

  const effectiveTotalStudents = stageIdFilter
    ? stageMatchedStudentIds.size
    : scopedByGrade.length;

  return {
    active_academic_year: activeYear,
    total_students: effectiveTotalStudents,
    students_with_registry: studentsWithRegistry,
    students_without_registry: Math.max(0, scopedByGrade.length - studentsWithRegistry),
    total_grades: totalGrades,
    total_sections: totalSections,
    absence_days_count: absenceSummary.absence_days_count ?? 0,
    students_with_absences: studentsWithAbsences,
    last_absence_date: absenceSummary.last_absence_date ?? null,
    today_sections_recorded: absenceSummary.today_sections_recorded ?? 0,
    grades_without_sections: gradesWithoutSections,
    sections_without_students: sectionsWithoutStudents,
    within_limit_students_count: withinLimitCount,
    stage_counts: stageCounts,
    monthly_absences: monthlyAbsences,
    approaching_stage_students: approachingStudents.slice(0, 20),
    exceeded_stage_students: exceededStudents.slice(0, 20),
    filters_applied: {
      grade_id: gradeIdFilter,
      stage_id: stageIdFilter,
    },
    grade_distribution: gradeDistribution,
    recent_activities: recentActivities,
  };
}
