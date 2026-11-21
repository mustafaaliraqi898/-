export type NavSectionId =
  | 'dashboard'
  | 'students'
  | 'grades'
  | 'absences'
  | 'monthly'
  | 'reports'
  | 'settings';

export type StudentStatus = 'active' | 'transferred_out' | 'graduated' | 'archived';

export type AbsenceStatus = 'present' | 'full_day' | 'lesson_absence';

export interface AcademicYear {
  id: number;
  name: string;
  is_active: number;
  created_at: string;
}

export interface SchoolSettings {
  id: number;
  school_name: string;
  directorate_name: string;
  academic_year_id: number | null;
  academic_year_name?: string | null;
  lessons_per_absence_day: number;
  updated_at: string;
}

export interface SectionItem {
  id: number;
  grade_id: number;
  grade_name?: string;
  name: string;
  capacity: number | null;
  student_count: number;
  created_at: string;
  updated_at: string;
}

export interface GradeWithSections {
  id: number;
  name: string;
  sort_order: number;
  student_count: number;
  sections: SectionItem[];
  created_at: string;
  updated_at: string;
}

export interface StudentRecord {
  id: number;
  student_uid: string;
  registry_number: string | null;
  full_name: string;
  birth_date: string | null;
  phone: string | null;
  photo_data: string | null;
  status: StudentStatus;
  created_at: string;
  updated_at: string;
  // Current active enrollment fields
  enrollment_id: number | null;
  academic_year_id: number | null;
  academic_year_name: string | null;
  grade_id: number | null;
  grade_name: string | null;
  section_id: number | null;
  section_name: string | null;
  enrollment_date: string | null;
}

export interface StudentEnrollmentHistoryItem {
  id: number;
  student_id: number;
  academic_year_id: number;
  academic_year_name: string;
  grade_id: number;
  grade_name: string;
  section_id: number;
  section_name: string;
  enrollment_date: string;
  is_current: number;
  transfer_reason: string | null;
  created_at: string;
  ended_at: string | null;
}

export interface CreateStudentInput {
  full_name: string;
  grade_id: number;
  section_id: number;
  registry_number?: string | null;
  birth_date?: string | null;
  phone?: string | null;
  photo_data?: string | null;
  academic_year_id?: number;
  enrollment_date?: string | null;
}

export interface UpdateStudentInput {
  full_name: string;
  registry_number?: string | null;
  birth_date?: string | null;
  phone?: string | null;
  photo_data?: string | null;
  status?: StudentStatus;
}

export interface TransferStudentInput {
  grade_id: number;
  section_id: number;
  academic_year_id?: number;
  transfer_reason?: string | null;
  enrollment_date?: string | null;
}

export interface StudentListQuery {
  search?: string;
  grade_id?: number | null;
  section_id?: number | null;
  academic_year_id?: number | null;
  status?: StudentStatus | 'all';
  sort_by?: 'full_name' | 'registry_number' | 'grade_name' | 'enrollment_date' | 'created_at';
  sort_dir?: 'asc' | 'desc';
}

export interface DashboardGradeSummary {
  grade_id: number;
  grade_name: string;
  sections_count: number;
  students_count: number;
  sections: {
    section_id: number;
    section_name: string;
    students_count: number;
  }[];
}

export interface DashboardActivityItem {
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
  is_transfer: boolean;
}

export interface DashboardStats {
  active_academic_year: AcademicYear | null;
  total_students: number;
  students_with_registry: number;
  students_without_registry: number;
  total_grades: number;
  total_sections: number;
  absence_days_count: number;
  last_absence_date: string | null;
  today_sections_recorded: number;
  grades_without_sections: number;
  sections_without_students: number;
  grade_distribution: DashboardGradeSummary[];
  recent_activities: DashboardActivityItem[];
}

export interface ExcelImportRowInput {
  rowNumber: number;
  full_name: string;
  grade_name: string;
  section_name: string;
  registry_number: string;
  birth_date?: string;
  phone?: string;
}

export interface ExcelValidatedRow extends ExcelImportRowInput {
  grade_id: number | null;
  section_id: number | null;
  errors: string[];
  is_valid: boolean;
  is_sample: boolean;
}

export interface ExcelValidationResult {
  rows: ExcelValidatedRow[];
  summary: {
    total_rows: number;
    valid_count: number;
    error_count: number;
    sample_skipped_count: number;
  };
  academic_year: AcademicYear;
}

export interface ExcelCommitResult {
  imported_count: number;
  academic_year_name: string;
  distribution: {
    grade_name: string;
    section_name: string;
    count: number;
  }[];
}

// Phase 2: Absence Recording & Accumulated Lesson Counter Types
export interface StudentAbsenceSheetRow {
  student_id: number;
  enrollment_id: number;
  student_uid: string;
  registry_number: string | null;
  full_name: string;
  // Saved state for the selected date (null if no record exists yet for this date)
  record_id: number | null;
  status: AbsenceStatus;
  lessons_count: number;
  notes: string | null;
  record_created_at: string | null;
  record_updated_at: string | null;
  has_saved_record: boolean;
  // Cumulative year-to-date metrics from SQLite
  direct_full_days: number;
  converted_lesson_days: number;
  total_full_days: number;
  pending_lessons: number;
  total_lessons_missed: number;
}

export interface AttendanceSessionInfo {
  id: number;
  academic_year_id: number;
  grade_id: number;
  section_id: number;
  attendance_date: string;
  recorded_count: number;
  created_at: string;
  updated_at: string;
}

export interface SectionAttendanceSheet {
  academic_year: AcademicYear;
  grade_id: number;
  grade_name: string;
  section_id: number;
  section_name: string;
  attendance_date: string;
  lessons_per_absence_day: number;
  session: AttendanceSessionInfo | null;
  students: StudentAbsenceSheetRow[];
}

export interface AttendanceEntryInput {
  student_id: number;
  status: AbsenceStatus;
  lessons_count?: number;
  notes?: string | null;
}

export interface SaveSectionAttendanceInput {
  academic_year_id: number;
  grade_id: number;
  section_id: number;
  attendance_date: string;
  entries: AttendanceEntryInput[];
}

export interface SaveSectionAttendanceResult {
  saved_count: number;
  present_count: number;
  full_day_count: number;
  lesson_absence_count: number;
  newly_converted_days: number;
  sheet: SectionAttendanceSheet;
}

export interface StudentAbsenceDetailResponse {
  student_id: number;
  full_name: string;
  student_uid: string;
  registry_number: string | null;
  lessons_per_absence_day: number;
  direct_full_days: number;
  converted_lesson_days: number;
  total_full_days: number;
  pending_lessons: number;
  total_lessons_missed: number;
  records: Array<{
    id: number;
    absence_date: string;
    status: AbsenceStatus;
    lessons_count: number;
    threshold_snapshot: number;
    notes: string | null;
    grade_name: string;
    section_name: string;
    created_at: string;
    updated_at: string;
  }>;
  conversions: Array<{
    id: number;
    converted_date: string;
    lessons_consumed: number;
    threshold_used: number;
    created_at: string;
  }>;
}
