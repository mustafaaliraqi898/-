export type NavSectionId =
  | 'dashboard'
  | 'students'
  | 'grades'
  | 'absences'
  | 'monthly'
  | 'reports'
  | 'audit'
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

export type EducationalStage = 'primary' | 'intermediate' | 'preparatory';

export type NumberDisplayMode = 'arabic' | 'english';

export interface SchoolSettings {
  id: number;
  school_name: string;
  directorate_name: string;
  principal_name?: string | null;
  academic_year_id: number | null;
  academic_year_name?: string | null;
  lessons_per_absence_day: number;
  daily_lessons_count: number;
  daily_permission_counts_as_absence: number;
  lesson_permission_counts_as_absence: number;
  number_display_mode: NumberDisplayMode;
  unified_letter_template?: string;
  school_logo_data?: string | null;
  school_logo_asset_id?: number | null;
  updated_at: string;
}

export type ImageCategory = 'school_logo' | 'student_photo' | 'general';

export interface MediaAssetInfo {
  id: number;
  original_sha256: string;
  optimized_sha256: string;
  original_filename: string | null;
  category: ImageCategory;
  original_mime: string;
  optimized_mime: string;
  original_size: number;
  optimized_size: number;
  saved_bytes: number;
  reduction_percent: number;
  width: number | null;
  height: number | null;
  has_alpha: boolean;
  strategy: 'webp-lossless' | 'webp-lossy' | 'original-kept' | 'fallback-original';
  is_processed: boolean;
  processing_note: string | null;
  deduplicated: boolean;
  skipped_recompression: boolean;
  optimized_url: string;
  original_url: string;
  compat_url: string;
  created_at: string;
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
  stage: EducationalStage | null;
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
  photo_asset_id?: number | null;
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
  photo_asset_id?: number | null;
  academic_year_id?: number;
  enrollment_date?: string | null;
}

export interface UpdateStudentInput {
  full_name: string;
  registry_number?: string | null;
  birth_date?: string | null;
  phone?: string | null;
  photo_data?: string | null;
  photo_asset_id?: number | null;
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

export interface DashboardStageCountItem {
  stage_id: number;
  stage_name: string;
  days_threshold: number;
  students_count: number;
}

export interface DashboardMonthlyAbsencePoint {
  month_key: string;
  month_number: number;
  year_number: number;
  label: string;
  full_day_count: number;
  converted_day_count: number;
  leave_count: number;
  total_absence_days: number;
  affected_students_count: number;
}

export interface DashboardApproachingStudent {
  student_id: number;
  full_name: string;
  grade_name: string;
  section_name: string;
  counted_days: number;
  next_stage_id: number;
  next_stage_name: string;
  next_stage_threshold: number;
  remaining_days: number;
}

export interface DashboardExceededStudent {
  student_id: number;
  full_name: string;
  grade_name: string;
  section_name: string;
  counted_days: number;
  stage_id: number;
  stage_name: string;
  days_threshold: number;
}

export interface DashboardStats {
  active_academic_year: AcademicYear | null;
  total_students: number;
  students_with_registry: number;
  students_without_registry: number;
  total_grades: number;
  total_sections: number;
  absence_days_count: number;
  students_with_absences: number;
  last_absence_date: string | null;
  today_sections_recorded: number;
  grades_without_sections: number;
  sections_without_students: number;
  within_limit_students_count: number;
  stage_counts: DashboardStageCountItem[];
  monthly_absences: DashboardMonthlyAbsencePoint[];
  approaching_stage_students: DashboardApproachingStudent[];
  exceeded_stage_students: DashboardExceededStudent[];
  filters_applied?: {
    grade_id: number | null;
    stage_id: number | null;
  };
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
  symbol: string; // '✓' | '✓\n١ د،غ' | 'غ' | 'م' | 'ر' | 'ع' | ''
  symbol_top?: string;
  symbol_bottom?: string;
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

// Legal Absence Regulations & Reports Center Types
export type ExcusedAbsenceMode = 'include_all' | 'exclude_all' | 'exclude_with_approved_rule';

export type GuardianFrequency = 'weekly' | 'biweekly' | 'monthly' | 'upon_threshold';

export type LegalProcedureType =
  | 'preliminary_warning'
  | 'first_warning'
  | 'final_warning'
  | 'effective_limit_notice'
  | 'guardian_notification'
  | 'guardian_summons';

export type ReportCategoryId =
  | 'preliminary_warnings'
  | 'first_warnings'
  | 'final_warnings'
  | 'effective_limit_reached'
  | 'guardian_notifications'
  | 'guardian_summons';

export interface LegalStageRegulation {
  stage: EducationalStage;
  stage_name: string;
  effective_absence_limit: number;
  absence_calculation_method: string;
  excused_absence_mode: ExcusedAbsenceMode;
  unexcused_absence_handling: string;
  dispersed_lessons_rule: string;
  lesson_conversion_rule: string;
  preliminary_warning_days: number;
  first_warning_days: number;
  final_warning_days: number;
  final_effective_limit_days: number;
  thresholds_are_provisional: number; // 0 | 1
  guardian_notify_frequency: GuardianFrequency;
  guardian_summons_frequency: GuardianFrequency;
  guardian_notify_notes: string | null;
  attendance_score_deduction_enabled: number; // 0 | 1
  attendance_score_deduction_per_unexcused_day: number;
  attendance_score_article: string | null;
  conduct_failure_enabled: number; // 0 | 1
  conduct_failure_threshold: number;
  conduct_failure_article: string | null;
  truancy_handling_enabled: number; // 0 | 1
  truancy_handling_notes: string | null;
  truancy_article: string | null;
  dispersed_lessons_counting_enabled: number; // 0 | 1
  dispersed_lessons_article: string | null;
  warnings_article: string | null;
  decision_name: string | null;
  decision_number: string | null;
  decision_issue_date: string | null;
  effective_from_date: string | null;
  legal_notes: string | null;
  is_legally_approved: number; // 0 | 1
  official_letter_approved: number; // 0 | 1
  warning_letter_template: string;
  summons_letter_template: string;
  current_version: number;
  updated_at: string;
  resolved_version_id?: number | null;
  is_historical_year_snapshot?: boolean;
}

export interface LegalRegulationVersion {
  id: number;
  stage: EducationalStage;
  version_number: number;
  academic_year_id: number | null;
  academic_year_name?: string | null;
  effective_from_date: string;
  decision_name: string | null;
  decision_number: string | null;
  decision_issue_date: string | null;
  is_legally_approved: number;
  change_summary: string | null;
  snapshot: LegalStageRegulation;
  created_at: string;
}

export interface UpdateLegalRegulationInput {
  effective_absence_limit: number;
  absence_calculation_method: string;
  excused_absence_mode: ExcusedAbsenceMode;
  unexcused_absence_handling: string;
  dispersed_lessons_rule: string;
  lesson_conversion_rule: string;
  preliminary_warning_days: number;
  first_warning_days: number;
  final_warning_days: number;
  final_effective_limit_days: number;
  thresholds_are_provisional: number | boolean;
  guardian_notify_frequency: GuardianFrequency;
  guardian_summons_frequency: GuardianFrequency;
  guardian_notify_notes?: string | null;
  attendance_score_deduction_enabled: number | boolean;
  attendance_score_deduction_per_unexcused_day: number;
  attendance_score_article?: string | null;
  conduct_failure_enabled: number | boolean;
  conduct_failure_threshold: number;
  conduct_failure_article?: string | null;
  truancy_handling_enabled: number | boolean;
  truancy_handling_notes?: string | null;
  truancy_article?: string | null;
  dispersed_lessons_counting_enabled: number | boolean;
  dispersed_lessons_article?: string | null;
  warnings_article?: string | null;
  decision_name?: string | null;
  decision_number?: string | null;
  decision_issue_date?: string | null;
  effective_from_date?: string | null;
  legal_notes?: string | null;
  is_legally_approved: number | boolean;
  official_letter_approved: number | boolean;
  warning_letter_template: string;
  summons_letter_template: string;
  change_summary?: string | null;
  academic_year_id?: number;
}

export interface StudentLegalProcedureRecord {
  id: number;
  student_id: number;
  student_name?: string;
  student_uid?: string;
  registry_number?: string | null;
  academic_year_id: number;
  academic_year_name?: string;
  grade_id: number;
  grade_name?: string;
  section_id: number;
  section_name?: string;
  stage: EducationalStage;
  regulation_version_id: number | null;
  procedure_type: LegalProcedureType;
  procedure_date: string;
  absence_days_at_action: number;
  unexcused_days_at_action: number;
  threshold_at_action: number;
  delivery_method: string | null;
  summons_result: string | null;
  recorded_by: string | null;
  notes: string | null;
  override_reason: string | null;
  is_official_legal_issue: number;
  created_at: string;
  updated_at: string;
}

export interface CreateStudentLegalProcedureInput {
  student_id: number;
  academic_year_id?: number;
  procedure_type: LegalProcedureType;
  procedure_date?: string;
  delivery_method?: string | null;
  summons_result?: string | null;
  recorded_by?: string | null;
  notes?: string | null;
  override_reason?: string | null;
  is_official_legal_issue?: boolean;
}

export interface UpdateStudentLegalProcedureInput {
  procedure_date?: string;
  delivery_method?: string | null;
  summons_result?: string | null;
  recorded_by?: string | null;
  notes?: string | null;
}

export interface ReportsCenterStudentRow {
  student_id: number;
  student_uid: string;
  registry_number: string | null;
  full_name: string;
  phone: string | null;
  grade_id: number;
  grade_name: string;
  section_id: number;
  section_name: string;
  stage: EducationalStage | null;
  stage_name: string | null;
  // Live SQLite absence breakdown
  direct_unexcused_full_days: number;
  converted_lesson_days: number;
  counted_daily_permission_days: number;
  uncounted_daily_permission_days: number;
  sick_leave_days: number;
  excused_absence_days: number;
  unexcused_absence_days: number;
  counted_legal_absence_days: number;
  pending_lessons: number;
  lesson_absence_lessons: number;
  lesson_escape_lessons: number;
  counted_lesson_permission_lessons: number;
  // Stage rule metrics
  attendance_score_deducted: number;
  conduct_failure_triggered: boolean;
  truancy_risk: boolean;
  // Threshold & remaining calculations
  report_threshold_days: number | null;
  next_threshold_label: string;
  next_threshold_days: number | null;
  remaining_days_to_next_threshold: number | null;
  days_over_limit: number;
  reached_preliminary: boolean;
  reached_first_warning: boolean;
  reached_final_warning: boolean;
  reached_effective_limit: boolean;
  // Procedure status & history
  procedure_status:
    | 'unmapped_stage'
    | 'effective_limit_reached'
    | 'final_warning_due'
    | 'first_warning_due'
    | 'preliminary_due'
    | 'approaching_threshold'
    | 'issued'
    | 'summoned'
    | 'notified'
    | 'monitoring';
  procedure_status_label: string;
  last_action_date: string | null;
  last_action_type: LegalProcedureType | null;
  last_action_label: string | null;
  last_notification_date: string | null;
  last_summons_date: string | null;
  last_summons_result: string | null;
  issued_warning_types: LegalProcedureType[];
  notifications_count: number;
  summons_count: number;
  is_legally_approved_stage: boolean;
  thresholds_are_provisional: boolean;
  procedures: StudentLegalProcedureRecord[];
}

export interface ReportsCenterSummaryStats {
  total_active_students: number;
  unmapped_stage_students: number;
  preliminary_warnings_count: number;
  first_warnings_count: number;
  final_warnings_count: number;
  effective_limit_reached_count: number;
  guardian_notifications_due_count: number;
  guardian_notifications_logged_count: number;
  guardian_summons_due_count: number;
  guardian_summons_logged_count: number;
  conduct_failure_risk_count: number;
}

export interface ReportsCenterResponse {
  academic_year: AcademicYear;
  school_settings: SchoolSettings;
  report_type: ReportCategoryId;
  stage_regulations: Record<EducationalStage, LegalStageRegulation>;
  unmapped_grades: Array<{ id: number; name: string }>;
  summary: ReportsCenterSummaryStats;
  rows: ReportsCenterStudentRow[];
  procedure_logs: StudentLegalProcedureRecord[];
}

export interface ReportsCenterQuery {
  academic_year_id?: number;
  report_type: ReportCategoryId;
  stage?: EducationalStage | 'all';
  grade_id?: number;
  section_id?: number;
  search?: string;
  include_approaching?: boolean;
}

// Simplified Absence Limits & 4-Report Types (Preparatory)
export interface AbsenceThresholdsSettings {
  effective_absence_limit: number;
  warning_days: number;
  preliminary_warning_days: number;
  final_warning_days: number;
  updated_at: string;
}

export interface UpdateAbsenceThresholdsInput {
  effective_absence_limit: number;
  warning_days: number;
  preliminary_warning_days: number;
  final_warning_days: number;
  academic_year_id?: number;
}

export type AbsenceReportTypeId =
  | 'warning'
  | 'preliminary_warning'
  | 'final_warning'
  | 'exceeded_limit';

export type AbsenceAlertLevel =
  | 'within_limit'
  | 'warning'
  | 'preliminary_warning'
  | 'final_warning'
  | 'exceeded_limit';

export interface AbsenceReportStudentRow {
  student_id: number;
  student_uid: string;
  registry_number: string | null;
  full_name: string;
  grade_id: number;
  grade_name: string;
  section_id: number;
  section_name: string;
  direct_full_days: number;
  counted_daily_permission_days: number;
  converted_lesson_days: number;
  counted_absence_days: number;
  pending_lessons: number;
  alert_level: AbsenceAlertLevel;
  alert_label: string;
  report_threshold_days: number;
  days_over_report_threshold: number;
  remaining_to_effective_limit: number;
  days_over_effective_limit: number;
}

export interface AbsenceReportsSummary {
  total_active_students: number;
  within_limit_count: number;
  warning_count: number;
  preliminary_warning_count: number;
  final_warning_count: number;
  exceeded_limit_count: number;
}

export interface AbsenceReportsResponse {
  academic_year: AcademicYear;
  school_settings: SchoolSettings;
  report_type: AbsenceReportTypeId;
  thresholds: AbsenceThresholdsSettings;
  summary: AbsenceReportsSummary;
  rows: AbsenceReportStudentRow[];
}

export interface AbsenceReportsQuery {
  academic_year_id?: number;
  report_type: AbsenceReportTypeId;
  grade_id?: number;
  section_id?: number;
  search?: string;
}

// Dynamic Absence Stages & Official Letters Types
export interface AbsenceStage {
  id: number;
  academic_year_id: number;
  name: string;
  days_threshold: number;
  letter_template: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface IssuedOfficialLetter {
  id: number;
  academic_year_id: number;
  stage_id: number | null;
  stage_name: string;
  days_threshold: number;
  document_number: string;
  letter_date: string;
  subject: string;
  rendered_content: string;
  students_json: string;
  created_at: string;
}

export interface DynamicStageStudentRow extends AbsenceReportStudentRow {
  stage_id: number | null;
  stage_name: string | null;
}

export interface DynamicStageReportResponse {
  academic_year: AcademicYear;
  school_settings: SchoolSettings;
  stages: AbsenceStage[];
  current_stage: AbsenceStage | null;
  summary: {
    total_active_students: number;
    within_limit_count: number;
    stage_counts: Record<number, number>;
  };
  rows: DynamicStageStudentRow[];
}

// Backup & Restore Types
export type BackupFrequency = 'daily' | 'weekly';
export type BackupRecordType = 'manual' | 'auto' | 'pre_restore';

export interface BackupSettings {
  id: number;
  auto_enabled: number;
  frequency: BackupFrequency;
  retention_count: number;
  backup_dir: string | null;
  resolved_backup_dir: string;
  last_backup_at: string | null;
  last_backup_status: string | null;
  last_backup_message: string | null;
  updated_at: string;
}

export interface BackupRecord {
  id: number;
  filename: string;
  file_path: string;
  backup_type: BackupRecordType;
  size_bytes: number;
  integrity_ok: number;
  file_exists: boolean;
  created_at: string;
}

export interface BackupOverviewResponse {
  settings: BackupSettings;
  records: BackupRecord[];
  runtime_note: string;
  media_included_note: string;
}

export interface UpdateBackupSettingsInput {
  auto_enabled: boolean | number;
  frequency: BackupFrequency;
  retention_count: number;
  backup_dir?: string | null;
}

export interface CreateBackupResult {
  record: BackupRecord;
  integrity_status: string;
  pruned_count: number;
}

export interface RestoreBackupResult {
  restored: boolean;
  media_assets_count: number;
  students_count: number;
  pre_restore_backup_filename: string | null;
  integrity_status: string;
}

// Audit Log Types (Append-only)
export type AuditOperationType =
  | 'create'
  | 'update'
  | 'delete'
  | 'transfer'
  | 'import'
  | 'issue_letter'
  | 'backup'
  | 'restore';

export type AuditSectionType =
  | 'students'
  | 'absences'
  | 'holidays'
  | 'grades'
  | 'stages'
  | 'letters'
  | 'settings'
  | 'backup';

export interface AuditLogRecord {
  id: number;
  operation_type: AuditOperationType;
  section: AuditSectionType;
  actor_name: string;
  description: string;
  target_id: string | null;
  target_label: string | null;
  old_value_json: string | null;
  new_value_json: string | null;
  created_at: string;
}

export interface AuditLogQuery {
  search?: string;
  operation_type?: AuditOperationType | 'all';
  section?: AuditSectionType | 'all';
  actor_name?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogListResponse {
  total: number;
  items: AuditLogRecord[];
  actors: string[];
}

