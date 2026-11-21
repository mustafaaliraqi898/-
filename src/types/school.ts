export type NavSectionId =
  | 'dashboard'
  | 'students'
  | 'grades'
  | 'absences'
  | 'monthly'
  | 'reports'
  | 'settings';

export type StudentStatus = 'active' | 'transferred_out' | 'graduated' | 'archived';

export type LessonStatusType = 'lesson_absence' | 'lesson_permission' | 'lesson_escape';

export type AbsenceStatus =
  | 'present'
  | 'full_day'
  | 'lesson_absence'
  | 'full_day_leave'
  | 'lesson_permission'
  | 'lesson_escape';

export type LeaveType = 'sick_leave' | 'daily_permission';

export type PermissionType = 'daily_permission' | 'lesson_permission';

export interface LessonDetailInput {
  lesson_number: number;
  lesson_status: LessonStatusType;
}

export interface LessonDetailItem {
  lesson_number: number;
  lesson_status: LessonStatusType;
  counted_as_absence: number;
  permission_rule_snapshot: number | null;
  threshold_snapshot: number;
}

export interface ConversionContributingLesson {
  absence_id: number;
  absence_date: string;
  lesson_number: number | null;
  lesson_status: LessonStatusType;
}

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
  daily_lessons_count: number;
  daily_permission_counts_as_absence: number;
  lesson_permission_counts_as_absence: number;
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

// Phase 2 & Leaves/Permissions: Absence Recording & Accumulated Lesson Counter Types
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
  leave_type: LeaveType | null;
  permission_type: PermissionType | null;
  lesson_numbers: number[];
  lesson_details: LessonDetailItem[];
  counted_as_absence: number;
  permission_rule_snapshot: number | null;
  applied_settings_at: string | null;
  notes: string | null;
  record_created_at: string | null;
  record_updated_at: string | null;
  has_saved_record: boolean;
  // Cumulative year-to-date metrics from SQLite
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
  daily_lessons_count: number;
  daily_permission_counts_as_absence: number;
  lesson_permission_counts_as_absence: number;
  holiday_info: HolidayCheckResult;
  session: AttendanceSessionInfo | null;
  students: StudentAbsenceSheetRow[];
}

export interface AttendanceEntryInput {
  student_id: number;
  status: AbsenceStatus;
  lessons_count?: number;
  leave_type?: LeaveType | null;
  lesson_numbers?: number[];
  lesson_details?: LessonDetailInput[];
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
  full_day_leave_count: number;
  lesson_permission_count: number;
  lesson_escape_count: number;
  newly_converted_days: number;
  sheet: SectionAttendanceSheet;
}

export interface StudentAbsenceDetailResponse {
  student_id: number;
  full_name: string;
  student_uid: string;
  registry_number: string | null;
  lessons_per_absence_day: number;
  daily_lessons_count: number;
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
  records: Array<{
    id: number;
    absence_date: string;
    status: AbsenceStatus;
    lessons_count: number;
    leave_type: LeaveType | null;
    permission_type: PermissionType | null;
    lesson_numbers: number[];
    lesson_details: LessonDetailItem[];
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
  conversions: Array<{
    id: number;
    converted_date: string;
    lessons_consumed: number;
    threshold_used: number;
    contributing_lessons: ConversionContributingLesson[];
    created_at: string;
  }>;
}

// Weekly & Official/Exceptional Holidays Types
export type HolidayType = 'official' | 'exceptional' | 'school_specific';

export type HolidayCategory = 'workday' | 'weekly' | HolidayType;

export interface WeeklyHolidayDay {
  day_of_week: number; // 0 = Sunday .. 6 = Saturday
  day_name: string;
  is_holiday: number; // 0 or 1
  updated_at: string;
}

export interface WeeklyHolidaySettings {
  reason: string;
  days: WeeklyHolidayDay[];
}

export interface ExistingRecordsWarning {
  has_existing_records: boolean;
  records_count: number;
  dates_count: number;
  dates: string[];
  message: string;
}

export interface UpdateWeeklyHolidaysInput {
  holiday_days: number[];
  reason?: string;
}

export interface UpdateWeeklyHolidaysResult {
  settings: WeeklyHolidaySettings;
  existing_records_warning: ExistingRecordsWarning | null;
}

export interface HolidayRecord {
  id: number;
  academic_year_id: number | null;
  academic_year_name?: string | null;
  name: string;
  start_date: string;
  end_date: string;
  days_count: number;
  holiday_type: HolidayType;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateHolidayInput {
  academic_year_id?: number | null;
  name: string;
  start_date: string;
  end_date: string;
  holiday_type: HolidayType;
  notes?: string | null;
}

export interface SaveHolidayResult {
  holiday: HolidayRecord;
  existing_records_warning: ExistingRecordsWarning | null;
}

export interface HolidayCheckResult {
  date: string;
  day_of_week: number;
  day_name: string;
  is_holiday: boolean;
  is_weekly_holiday: boolean;
  is_official_or_special_holiday: boolean;
  holiday_category: HolidayCategory;
  primary_reason: string | null;
  weekly_reason: string | null;
  matching_holidays: HolidayRecord[];
}

export interface MonthCalendarDay {
  date: string;
  day_of_month: number;
  day_of_week: number;
  day_name: string;
  is_holiday: boolean;
  is_weekly_holiday: boolean;
  is_official_or_special_holiday: boolean;
  holiday_category: HolidayCategory;
  reason: string | null;
  weekly_reason: string | null;
  holidays: HolidayRecord[];
  counts_as_school_day: boolean;
}

// Monthly Absence Register Types
export type MonthlyCellStatusKind =
  | 'present'
  | 'unrecorded'
  | 'full_day'
  | 'lesson_absence'
  | 'lesson_escape'
  | 'lesson_converted'
  | 'lesson_mixed'
  | 'sick_leave'
  | 'daily_permission'
  | 'lesson_permission'
  | 'holiday';

export interface MonthlyDayCellData {
  date: string;
  day_of_month: number;
  day_name: string;
  symbol: string; // '✓' | 'غ' | 'ج' | 'د١'.. | 'هـ١'.. | 'م' | 'ر' | 'ح١'.. | 'ع' | ''
  status_kind: MonthlyCellStatusKind;
  has_record: boolean;
  record_id: number | null;
  raw_status: AbsenceStatus | null;
  lessons_count: number;
  lesson_numbers: number[];
  lesson_details: LessonDetailItem[];
  leave_type: LeaveType | null;
  counted_as_absence: boolean;
  contributed_to_counter: boolean;
  counted_lessons_today: number;
  generated_converted_day: boolean;
  converted_days_count: number;
  threshold_used: number | null;
  contributing_lessons: ConversionContributingLesson[];
  notes: string | null;
  holiday_info: HolidayCheckResult | null;
  outside_section_membership: boolean;
}

export type MonthlyNoteCategory =
  | 'transfer'
  | 'full_day'
  | 'sick_leave'
  | 'daily_permission'
  | 'lesson_absence'
  | 'lesson_escape'
  | 'lesson_permission'
  | 'lesson_converted';

export interface MonthlyNoteDetailItem {
  date: string;
  category: MonthlyNoteCategory;
  text: string;
  counted_as_absence?: boolean;
  count?: number;
}

export interface MonthlyStudentRow {
  student_id: number;
  student_uid: string;
  registry_number: string | null;
  full_name: string;
  original_order: number;
  enrollment_start_date: string | null;
  enrollment_end_date: string | null;
  transfer_in_date: string | null;
  transfer_out_date: string | null;
  transfer_in_from: string | null;
  transfer_out_to: string | null;
  days: Record<number, MonthlyDayCellData>;
  direct_full_days: number;
  converted_lesson_days: number;
  missed_lessons_count: number;
  lesson_absence_lessons: number;
  lesson_escape_lessons: number;
  counted_lesson_permission_lessons: number;
  uncounted_lesson_permission_lessons: number;
  sick_leave_days: number;
  daily_permission_days: number;
  counted_daily_permission_days: number;
  lesson_permission_records: number;
  total_counted_absence_days: number;
  year_pending_lessons: number;
  auto_notes: string[];
  auto_note_items: MonthlyNoteDetailItem[];
  compact_notes_summary: string;
  manual_note: string | null;
}

export interface MonthlyRegisterStats {
  total_students: number;
  students_with_counted_absence: number;
  total_counted_absence_days: number;
  total_direct_full_days: number;
  total_converted_lesson_days: number;
  total_sick_leave_days: number;
  total_daily_permission_days: number;
  total_lesson_permission_records: number;
  total_lesson_escape_lessons: number;
}

export interface MonthlyLegendItem {
  symbol: string;
  label: string;
  description: string;
}

export interface MonthlyRegisterData {
  academic_year: AcademicYear;
  year: number;
  month: number;
  month_name: string;
  days_in_month: number;
  calendar_days: MonthCalendarDay[];
  grade_id: number;
  grade_name: string;
  section_id: number;
  section_name: string;
  school_settings: SchoolSettings;
  stats: MonthlyRegisterStats;
  students: MonthlyStudentRow[];
  legend: MonthlyLegendItem[];
}

export interface MonthlyRegisterQuery {
  academic_year_id?: number;
  year: number;
  month: number;
  grade_id: number;
  section_id: number;
  search?: string;
  sort_mode?: 'original' | 'alphabetical';
}

export interface SaveMonthlyNoteInput {
  academic_year_id: number;
  student_id: number;
  year: number;
  month: number;
  note_text: string;
}


