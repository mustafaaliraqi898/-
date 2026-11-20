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

CREATE TABLE IF NOT EXISTS absences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  enrollment_id INTEGER NOT NULL REFERENCES student_enrollments(id) ON DELETE RESTRICT,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
  grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE RESTRICT,
  section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
  absence_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('absent', 'excused', 'late')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id, absence_date)
);

CREATE INDEX IF NOT EXISTS idx_sections_grade_id ON sections(grade_id);
CREATE INDEX IF NOT EXISTS idx_students_full_name ON students(full_name);
CREATE INDEX IF NOT EXISTS idx_students_registry_number ON students(registry_number);
CREATE INDEX IF NOT EXISTS idx_enrollments_student_year ON student_enrollments(student_id, academic_year_id, is_current);
CREATE INDEX IF NOT EXISTS idx_enrollments_grade_section ON student_enrollments(academic_year_id, grade_id, section_id, is_current);
CREATE INDEX IF NOT EXISTS idx_absences_student_date ON absences(student_id, absence_date);
CREATE INDEX IF NOT EXISTS idx_absences_year_grade_section ON absences(academic_year_id, grade_id, section_id, absence_date);
`;
