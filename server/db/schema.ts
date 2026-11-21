export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS academic_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS school_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  school_name TEXT NOT NULL DEFAULT 'المدرسة النموذجية',
  directorate_name TEXT NOT NULL DEFAULT 'المديرية العامة للتربية',
  academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL,
  lessons_per_absence_day INTEGER NOT NULL DEFAULT 5 CHECK (lessons_per_absence_day >= 1 AND lessons_per_absence_day <= 20),
  daily_lessons_count INTEGER NOT NULL DEFAULT 7 CHECK (daily_lessons_count >= 1 AND daily_lessons_count <= 12),
  daily_permission_counts_as_absence INTEGER NOT NULL DEFAULT 0 CHECK (daily_permission_counts_as_absence IN (0, 1)),
  lesson_permission_counts_as_absence INTEGER NOT NULL DEFAULT 0 CHECK (lesson_permission_counts_as_absence IN (0, 1)),
  weekly_holiday_reason TEXT NOT NULL DEFAULT 'عطلة أسبوعية رسمية',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  capacity INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(grade_id, name)
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_uid TEXT NOT NULL UNIQUE,
  registry_number TEXT UNIQUE,
  full_name TEXT NOT NULL,
  birth_date TEXT,
  phone TEXT,
  photo_data TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'transferred_out', 'graduated', 'archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS student_enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE RESTRICT,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
  enrollment_date TEXT NOT NULL DEFAULT (date('now')),
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  transfer_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE RESTRICT,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
  attendance_date TEXT NOT NULL,
  recorded_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(academic_year_id, section_id, attendance_date)
);

CREATE TABLE IF NOT EXISTS absences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  enrollment_id INTEGER NOT NULL REFERENCES student_enrollments(id) ON DELETE RESTRICT,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE RESTRICT,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
  absence_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'full_day', 'lesson_absence', 'full_day_leave', 'lesson_permission', 'lesson_escape')),
  lessons_count INTEGER NOT NULL DEFAULT 0 CHECK (lessons_count >= 0),
  leave_type TEXT CHECK (leave_type IN ('sick_leave', 'daily_permission')),
  permission_type TEXT CHECK (permission_type IN ('daily_permission', 'lesson_permission')),
  lesson_numbers_json TEXT,
  counted_as_absence INTEGER NOT NULL DEFAULT 0 CHECK (counted_as_absence IN (0, 1)),
  permission_rule_snapshot INTEGER CHECK (permission_rule_snapshot IN (0, 1)),
  applied_settings_at TEXT,
  threshold_snapshot INTEGER NOT NULL DEFAULT 5 CHECK (threshold_snapshot >= 1),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id, absence_date)
);

CREATE TABLE IF NOT EXISTS absence_lesson_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  absence_id INTEGER NOT NULL REFERENCES absences(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  absence_date TEXT NOT NULL,
  lesson_number INTEGER NOT NULL CHECK (lesson_number >= 1 AND lesson_number <= 12),
  lesson_status TEXT NOT NULL DEFAULT 'lesson_absence' CHECK (lesson_status IN ('lesson_absence', 'lesson_permission', 'lesson_escape')),
  counted_as_absence INTEGER NOT NULL DEFAULT 1 CHECK (counted_as_absence IN (0, 1)),
  permission_rule_snapshot INTEGER CHECK (permission_rule_snapshot IN (0, 1)),
  threshold_snapshot INTEGER NOT NULL DEFAULT 5 CHECK (threshold_snapshot >= 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(absence_id, lesson_number),
  UNIQUE(student_id, absence_date, lesson_number)
);

CREATE TABLE IF NOT EXISTS lesson_converted_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE RESTRICT,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
  source_absence_id INTEGER NOT NULL REFERENCES absences(id) ON DELETE CASCADE,
  converted_date TEXT NOT NULL,
  lessons_consumed INTEGER NOT NULL CHECK (lessons_consumed >= 1),
  threshold_used INTEGER NOT NULL CHECK (threshold_used >= 1),
  contributing_lessons_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS weekly_holidays (
  day_of_week INTEGER PRIMARY KEY CHECK (day_of_week >= 0 AND day_of_week <= 6),
  day_name TEXT NOT NULL,
  is_holiday INTEGER NOT NULL DEFAULT 0 CHECK (is_holiday IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS holidays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  holiday_type TEXT NOT NULL CHECK (holiday_type IN ('official', 'exceptional', 'school_specific')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS monthly_student_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  year INTEGER NOT NULL CHECK (year >= 2000 AND year <= 2100),
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  note_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(academic_year_id, student_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_sections_grade_id ON sections(grade_id);
CREATE INDEX IF NOT EXISTS idx_students_full_name ON students(full_name);
CREATE INDEX IF NOT EXISTS idx_students_registry_number ON students(registry_number);
CREATE INDEX IF NOT EXISTS idx_enrollments_student_year ON student_enrollments(student_id, academic_year_id, is_current);
CREATE INDEX IF NOT EXISTS idx_enrollments_grade_section ON student_enrollments(academic_year_id, grade_id, section_id, is_current);
CREATE INDEX IF NOT EXISTS idx_sessions_year_section_date ON attendance_sessions(academic_year_id, section_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_absences_student_date ON absences(student_id, absence_date);
CREATE INDEX IF NOT EXISTS idx_absences_year_grade_section ON absences(academic_year_id, grade_id, section_id, absence_date);
CREATE INDEX IF NOT EXISTS idx_absences_student_year_status ON absences(student_id, academic_year_id, status);
CREATE INDEX IF NOT EXISTS idx_absence_lesson_details_absence_id ON absence_lesson_details(absence_id);
CREATE INDEX IF NOT EXISTS idx_converted_days_student_year ON lesson_converted_days(student_id, academic_year_id);
CREATE INDEX IF NOT EXISTS idx_holidays_date_range ON holidays(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_holidays_year ON holidays(academic_year_id, start_date);
CREATE INDEX IF NOT EXISTS idx_monthly_notes_lookup ON monthly_student_notes(academic_year_id, year, month, student_id);
`;
