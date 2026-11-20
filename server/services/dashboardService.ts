import type {
  DashboardActivityItem,
  DashboardGradeSummary,
  DashboardStats,
} from '../../src/types/school';
import type { SqliteDb } from '../db/connection';
import { listGradesWithSections } from './gradeService';
import { getActiveAcademicYear } from './settingsService';

export function getDashboardStats(db: SqliteDb, academicYearId?: number): DashboardStats {
  const activeYear = academicYearId
    ? (db
        .prepare('SELECT id, name, is_active, created_at FROM academic_years WHERE id = ?')
        .get(academicYearId) as ReturnType<typeof getActiveAcademicYear> | undefined) ??
      getActiveAcademicYear(db)
    : getActiveAcademicYear(db);

  const studentCounts = db
    .prepare(
      `SELECT
         COUNT(DISTINCT st.id) as total_students,
         COUNT(DISTINCT CASE WHEN st.registry_number IS NOT NULL AND st.registry_number != '' THEN st.id END) as students_with_registry
       FROM students st
       JOIN student_enrollments se ON se.student_id = st.id
       WHERE se.academic_year_id = ? AND se.is_current = 1 AND st.status = 'active'`
    )
    .get(activeYear.id) as { total_students: number; students_with_registry: number };

  const todayIso = new Date().toISOString().slice(0, 10);

  const absenceSummary = db
    .prepare(
      `SELECT
         COUNT(DISTINCT absence_date) as absence_days_count,
         MAX(absence_date) as last_absence_date,
         COUNT(DISTINCT CASE WHEN absence_date = ? THEN section_id END) as today_sections_recorded
       FROM absences
       WHERE academic_year_id = ?`
    )
    .get(todayIso, activeYear.id) as {
    absence_days_count: number;
    last_absence_date: string | null;
    today_sections_recorded: number;
  };

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

  return {
    active_academic_year: activeYear,
    total_students: studentCounts.total_students,
    students_with_registry: studentCounts.students_with_registry,
    students_without_registry: Math.max(
      0,
      studentCounts.total_students - studentCounts.students_with_registry
    ),
    total_grades: totalGrades,
    total_sections: totalSections,
    absence_days_count: absenceSummary.absence_days_count ?? 0,
    last_absence_date: absenceSummary.last_absence_date ?? null,
    today_sections_recorded: absenceSummary.today_sections_recorded ?? 0,
    grades_without_sections: gradesWithoutSections,
    sections_without_students: sectionsWithoutStudents,
    grade_distribution: gradeDistribution,
    recent_activities: recentActivities,
  };
}
