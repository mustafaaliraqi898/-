import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { SCHEMA_SQL } from './schema';
import { UNIFIED_OFFICIAL_LETTER_TEMPLATE } from '../../src/utils/officialDocumentHtml';

export type SqliteDb = Database.Database;

let defaultDbInstance: SqliteDb | null = null;

function computeDefaultAcademicYearName(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 9) {
    return `${year}-${year + 1}`;
  }
  return `${year - 1}-${year}`;
}

export function inferStageFromGradeName(
  name: string
): 'primary' | 'intermediate' | 'preparatory' | null {
  const normalized = name.trim();
  if (!normalized) return null;
  if (/(ابتدائي|الابتدائي|الابتدائية)/i.test(normalized)) return 'primary';
  if (/(متوسط|المتوسط|المتوسطة)/i.test(normalized)) return 'intermediate';
  if (/(إعدادي|اعدادي|الإعدادي|الاعدادي|الإعدادية|علمي|أدبي|ادبي|تطبيقي|احيائي|أحيائي)/i.test(normalized)) {
    return 'preparatory';
  }
  return null;
}

function buildDefaultStageRegulations(todayIso: string) {
  const defaultWarningTemplate =
    'إلى ولي أمر الطالب/ة المحترم ({{student_name}}) — الصف: {{grade_name}} / الشعبة: {{section_name}}\n' +
    'تحية طيبة وبعد،\n' +
    'نود إعلامكم بأن مجموع أيام الغياب المحتسبة للطالب/ة قد بلغ ({{counted_days}}) يوماً في العام الدراسي {{academic_year}}، استناداً إلى الضوابط والتعليمات المدرسية المعتمدة ({{decision_ref}}).\n' +
    'يرجى مراجعة إدارة المدرسة ومتابعة دوام الطالب/ة بصورة منتظمة تلافياً للآثار القانونية والتربوية المترتبة على استمرار الغياب.';

  const defaultSummonsTemplate =
    'إلى ولي أمر الطالب/ة المحترم ({{student_name}}) — الصف: {{grade_name}} / الشعبة: {{section_name}}\n' +
    'م/ كتاب استدعاء ولي أمر\n' +
    'يرجى حضوركم إلى إدارة المدرسة في أقرب وقت ممكن للتداول بشأن حالة دوام الطالب/ة وغياباته البالغة ({{counted_days}}) يوماً، والتوقيع على التعهد والإجراءات التربوية والقانونية المقررة ({{decision_ref}}).';

  return [
    {
      stage: 'primary' as const,
      stage_name: 'المرحلة الابتدائية',
      effective_absence_limit: 50,
      absence_calculation_method: 'مجموع أيام الغياب الكامل + الأيام المحولة من الدروس المتراكمة وفق نصاب المدرسة',
      excused_absence_mode: 'include_all',
      unexcused_absence_handling: 'يُحتسب كل يوم غياب غير مجاز يوماً كاملاً ضمن حد الغياب المؤثر وتبليغات ولي الأمر.',
      dispersed_lessons_rule: 'تُجمع الدروس المتفرقة وتُحوّل إلى أيام عند بلوغ نصاب الدروس المعتمد في إعدادات المدرسة.',
      lesson_conversion_rule: 'كل بلوغ لنصاب الدروس المعتاد يُحوّل إلى يوم غياب واحد.',
      preliminary_warning_days: 20,
      first_warning_days: 30,
      final_warning_days: 40,
      final_effective_limit_days: 50,
      thresholds_are_provisional: 1,
      guardian_notify_frequency: 'weekly',
      guardian_summons_frequency: 'biweekly',
      guardian_notify_notes: 'يُفضّل التبليغ الأسبوعي في المرحلة الابتدائية بالتنسيق مع المرشد التربوي.',
      attendance_score_deduction_enabled: 0,
      attendance_score_deduction_per_unexcused_day: 0,
      attendance_score_article: 'غير مفعل افتراضياً للمرحلة الابتدائية لحين توثيق المادة النظامية.',
      conduct_failure_enabled: 0,
      conduct_failure_threshold: 51,
      conduct_failure_article: 'غير مفعل افتراضياً للمرحلة الابتدائية لحين توثيق المادة النظامية.',
      truancy_handling_enabled: 1,
      truancy_handling_notes: 'متابعة التغيب المتكرر وحالات التسرب وإشعار ولي الأمر فوراً.',
      truancy_article: 'بحاجة إلى توثيق رقم المادة القانونية والقرار الوزاري للمرحلة الابتدائية.',
      dispersed_lessons_counting_enabled: 1,
      dispersed_lessons_article: 'بحاجة إلى توثيق المادة القانونية الخاصة بالدروس المتفرقة.',
      warnings_article: 'قيم مبدئية تجريبية بانتظار اعتماد رقم القرار والمادة القانونية للمرحلة الابتدائية.',
      decision_name: null,
      decision_number: null,
      decision_issue_date: null,
      effective_from_date: todayIso,
      legal_notes: 'ضابطة ابتدائية مبدئية غير معتمدة قانونياً بعد؛ يُرجى إدخال رقم القرار والمادة القانونية ثم تفعيل الاعتماد.',
      is_legally_approved: 0,
      official_letter_approved: 0,
      warning_letter_template: defaultWarningTemplate,
      summons_letter_template: defaultSummonsTemplate,
    },
    {
      stage: 'intermediate' as const,
      stage_name: 'المرحلة المتوسطة',
      effective_absence_limit: 45,
      absence_calculation_method: 'مجموع أيام الغياب الكامل + الأيام المحولة من الدروس المتراكمة وفق نصاب المدرسة',
      excused_absence_mode: 'include_all',
      unexcused_absence_handling: 'يُحتسب الغياب دون عذر ضمن الحد الأعلى (45 يوماً) مع خصم درجتين من السلوك/المواظبة لكل يوم غياب غير مجاز.',
      dispersed_lessons_rule: 'تُجمع الدروس المتفرقة (غياب/هروب/رخصة محتسبة) وتُحوّل إلى يوم غياب كامل عند استكمال النصاب.',
      lesson_conversion_rule: 'تحويل تلقائي وفق نصاب الدروس السنوي التراكمي.',
      preliminary_warning_days: 15,
      first_warning_days: 25,
      final_warning_days: 35,
      final_effective_limit_days: 45,
      thresholds_are_provisional: 1,
      guardian_notify_frequency: 'biweekly',
      guardian_summons_frequency: 'biweekly',
      guardian_notify_notes: 'تبليغ ولي الأمر كل أسبوعين وتكثيف المتابعة عند اقتراب الطالب من حد الإنذار الأول.',
      attendance_score_deduction_enabled: 1,
      attendance_score_deduction_per_unexcused_day: 2,
      attendance_score_article: 'نظام المدارس الثانوية — خصم درجتين عن كل يوم غياب دون عذر (بانتظار التوثيق الرسمي لرقم التعميم).',
      conduct_failure_enabled: 1,
      conduct_failure_threshold: 51,
      conduct_failure_article: 'الرسوب بسبب السلوك/المواظبة عند بلوغ الخصم 51 درجة فأكثر (بانتظار التوثيق الرسمي).',
      truancy_handling_enabled: 1,
      truancy_handling_notes: 'رصد حالات الهروب من الدروس والتسرب واتخاذ إجراءات استدعاء ولي الأمر.',
      truancy_article: 'بحاجة إلى توثيق المادة القانونية المعتمدة لمعالجة التسرب.',
      dispersed_lessons_counting_enabled: 1,
      dispersed_lessons_article: 'بحاجة إلى توثيق المادة القانونية لاحتساب الدروس المتفرقة.',
      warnings_article: 'عتبات تحذير تجريبية بانتظار التوثيق والاعتماد القانوني للمرحلة المتوسطة.',
      decision_name: null,
      decision_number: null,
      decision_issue_date: null,
      effective_from_date: todayIso,
      legal_notes: 'الحد المبدئي (45 يوماً) وعتبات الإنذارات الحالية مبدئية لحين إقرارها وتوثيق رقم التعميم.',
      is_legally_approved: 0,
      official_letter_approved: 0,
      warning_letter_template: defaultWarningTemplate,
      summons_letter_template: defaultSummonsTemplate,
    },
    {
      stage: 'preparatory' as const,
      stage_name: 'المرحلة الإعدادية',
      effective_absence_limit: 45,
      absence_calculation_method: 'مجموع أيام الغياب الكامل + الأيام المحولة من الدروس المتراكمة وفق نصاب المدرسة',
      excused_absence_mode: 'include_all',
      unexcused_absence_handling: 'يُحتسب الغياب دون عذر ضمن الحد الأعلى (45 يوماً) مع خصم درجتين عن كل يوم غياب دون عذر.',
      dispersed_lessons_rule: 'تُجمع الدروس المتفرقة وتُحوّل إلى أيام غياب كاملة عند استكمال النصاب السنوي.',
      lesson_conversion_rule: 'تحويل تلقائي وفق نصاب الدروس المعتاد.',
      preliminary_warning_days: 15,
      first_warning_days: 25,
      final_warning_days: 35,
      final_effective_limit_days: 45,
      thresholds_are_provisional: 1,
      guardian_notify_frequency: 'biweekly',
      guardian_summons_frequency: 'biweekly',
      guardian_notify_notes: 'تبليغ ولي الأمر كل أسبوعين واستدعاء تحريري قبل بلوغ الإنذار النهائي.',
      attendance_score_deduction_enabled: 1,
      attendance_score_deduction_per_unexcused_day: 2,
      attendance_score_article: 'نظام المدارس الثانوية — خصم درجتين عن كل يوم غياب دون عذر (بانتظار التوثيق الرسمي لرقم التعميم).',
      conduct_failure_enabled: 1,
      conduct_failure_threshold: 51,
      conduct_failure_article: 'الرسوب بسبب السلوك/المواظبة عند بلوغ الخصم 51 درجة فأكثر (بانتظار التوثيق الرسمي).',
      truancy_handling_enabled: 1,
      truancy_handling_notes: 'رصد حالات الهروب من الدروس والتغيب المتكرر وإشعار ولي الأمر.',
      truancy_article: 'بحاجة إلى توثيق المادة القانونية المعتمدة لمعالجة التسرب.',
      dispersed_lessons_counting_enabled: 1,
      dispersed_lessons_article: 'بحاجة إلى توثيق المادة القانونية لاحتساب الدروس المتفرقة.',
      warnings_article: 'عتبات تحذير تجريبية بانتظار التوثيق والاعتماد القانوني للمرحلة الإعدادية.',
      decision_name: null,
      decision_number: null,
      decision_issue_date: null,
      effective_from_date: todayIso,
      legal_notes: 'الحد المبدئي (45 يوماً) وعتبات الإنذارات الحالية مبدئية لحين إقرارها وتوثيق رقم التعميم.',
      is_legally_approved: 0,
      official_letter_approved: 0,
      warning_letter_template: defaultWarningTemplate,
      summons_letter_template: defaultSummonsTemplate,
    },
  ];
}

function runSafeMigrations(db: SqliteDb): void {
  // 1. Ensure school_settings has all required absence & leave/permission columns
  const settingsCols = db.prepare('PRAGMA table_info(school_settings)').all() as Array<{
    name: string;
  }>;
  if (!settingsCols.some((c) => c.name === 'academic_year_id')) {
    db.exec(
      'ALTER TABLE school_settings ADD COLUMN academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL'
    );
  }
  if (!settingsCols.some((c) => c.name === 'lessons_per_absence_day')) {
    db.exec(
      'ALTER TABLE school_settings ADD COLUMN lessons_per_absence_day INTEGER NOT NULL DEFAULT 5'
    );
  }
  if (!settingsCols.some((c) => c.name === 'daily_lessons_count')) {
    db.exec(
      'ALTER TABLE school_settings ADD COLUMN daily_lessons_count INTEGER NOT NULL DEFAULT 7'
    );
  }
  if (!settingsCols.some((c) => c.name === 'daily_permission_counts_as_absence')) {
    db.exec(
      'ALTER TABLE school_settings ADD COLUMN daily_permission_counts_as_absence INTEGER NOT NULL DEFAULT 0'
    );
  }
  if (!settingsCols.some((c) => c.name === 'lesson_permission_counts_as_absence')) {
    db.exec(
      'ALTER TABLE school_settings ADD COLUMN lesson_permission_counts_as_absence INTEGER NOT NULL DEFAULT 0'
    );
  }
  if (!settingsCols.some((c) => c.name === 'weekly_holiday_reason')) {
    db.exec(
      "ALTER TABLE school_settings ADD COLUMN weekly_holiday_reason TEXT NOT NULL DEFAULT 'عطلة أسبوعية رسمية'"
    );
  }
  if (!settingsCols.some((c) => c.name === 'school_logo_data')) {
    db.exec('ALTER TABLE school_settings ADD COLUMN school_logo_data TEXT');
  }
  if (!settingsCols.some((c) => c.name === 'school_logo_asset_id')) {
    db.exec(
      'ALTER TABLE school_settings ADD COLUMN school_logo_asset_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL'
    );
  }
  if (!settingsCols.some((c) => c.name === 'principal_name')) {
    db.exec('ALTER TABLE school_settings ADD COLUMN principal_name TEXT');
  }
  if (!settingsCols.some((c) => c.name === 'number_display_mode')) {
    db.exec(
      "ALTER TABLE school_settings ADD COLUMN number_display_mode TEXT NOT NULL DEFAULT 'english' CHECK (number_display_mode IN ('arabic', 'english'))"
    );
  }
  if (!settingsCols.some((c) => c.name === 'unified_letter_template')) {
    db.exec('ALTER TABLE school_settings ADD COLUMN unified_letter_template TEXT');
    db.prepare(
      'UPDATE school_settings SET unified_letter_template = ? WHERE id = 1 AND unified_letter_template IS NULL'
    ).run(UNIFIED_OFFICIAL_LETTER_TEMPLATE);
  }

  // 1a. Ensure students has photo_asset_id column for centralized media storage
  const studentsCols = db.prepare('PRAGMA table_info(students)').all() as Array<{ name: string }>;
  if (!studentsCols.some((c) => c.name === 'photo_asset_id')) {
    db.exec(
      'ALTER TABLE students ADD COLUMN photo_asset_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL'
    );
  }

  // 1b. Ensure grades has stage column and infer stage safely for existing rows if NULL
  const gradesCols = db.prepare('PRAGMA table_info(grades)').all() as Array<{ name: string }>;
  if (!gradesCols.some((c) => c.name === 'stage')) {
    db.exec(
      "ALTER TABLE grades ADD COLUMN stage TEXT CHECK (stage IN ('primary', 'intermediate', 'preparatory'))"
    );
  }
  const unmappedGrades = db
    .prepare('SELECT id, name FROM grades WHERE stage IS NULL')
    .all() as Array<{ id: number; name: string }>;
  if (unmappedGrades.length > 0) {
    const updateStageStmt = db.prepare('UPDATE grades SET stage = ? WHERE id = ?');
    for (const g of unmappedGrades) {
      const inferred = inferStageFromGradeName(g.name);
      if (inferred) {
        updateStageStmt.run(inferred, g.id);
      }
    }
  }

  // 2. Migrate absences table if it lacks Phase 2 statuses, leaves/permissions columns, or lesson_escape
  const absMeta = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'absences'")
    .get() as { sql: string } | undefined;

  if (
    absMeta &&
    (!absMeta.sql.includes('lesson_absence') ||
      !absMeta.sql.includes('full_day_leave') ||
      !absMeta.sql.includes('lesson_escape'))
  ) {
    const absCols = db.prepare('PRAGMA table_info(absences)').all() as Array<{ name: string }>;
    const hasPhase2Cols = absCols.some((c) => c.name === 'lessons_count');
    const hasLeaveCols = absCols.some((c) => c.name === 'leave_type');

    db.pragma('foreign_keys = OFF');
    const migrateTx = db.transaction(() => {
      db.exec(`
        CREATE TABLE absences_new (
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
      `);

      if (hasLeaveCols) {
        db.exec(`
          INSERT INTO absences_new (
            id, student_id, enrollment_id, academic_year_id, grade_id, section_id,
            absence_date, status, lessons_count, leave_type, permission_type, lesson_numbers_json,
            counted_as_absence, permission_rule_snapshot, applied_settings_at,
            threshold_snapshot, notes, created_at, updated_at
          )
          SELECT
            id, student_id, enrollment_id, academic_year_id, grade_id, section_id,
            absence_date, status, lessons_count, leave_type, permission_type, lesson_numbers_json,
            counted_as_absence, permission_rule_snapshot, applied_settings_at,
            threshold_snapshot, notes, created_at, updated_at
          FROM absences;
        `);
      } else if (hasPhase2Cols) {
        db.exec(`
          INSERT INTO absences_new (
            id, student_id, enrollment_id, academic_year_id, grade_id, section_id,
            absence_date, status, lessons_count, leave_type, permission_type, lesson_numbers_json,
            counted_as_absence, permission_rule_snapshot, applied_settings_at,
            threshold_snapshot, notes, created_at, updated_at
          )
          SELECT
            id, student_id, enrollment_id, academic_year_id, grade_id, section_id,
            absence_date, status, lessons_count, NULL, NULL, NULL,
            CASE WHEN status IN ('full_day', 'lesson_absence') THEN 1 ELSE 0 END,
            NULL,
            COALESCE(updated_at, created_at),
            threshold_snapshot,
            notes,
            created_at,
            updated_at
          FROM absences;
        `);
      } else {
        db.exec(`
          INSERT INTO absences_new (
            id, student_id, enrollment_id, academic_year_id, grade_id, section_id,
            absence_date, status, lessons_count, leave_type, permission_type, lesson_numbers_json,
            counted_as_absence, permission_rule_snapshot, applied_settings_at,
            threshold_snapshot, notes, created_at, updated_at
          )
          SELECT
            id, student_id, enrollment_id, academic_year_id, grade_id, section_id,
            absence_date,
            CASE WHEN status = 'late' THEN 'lesson_absence' ELSE 'full_day' END,
            CASE WHEN status = 'late' THEN 1 ELSE 0 END,
            NULL, NULL, NULL,
            1,
            NULL,
            created_at,
            5,
            notes,
            created_at,
            created_at
          FROM absences;
        `);
      }

      db.exec(`
        DROP TABLE absences;
        ALTER TABLE absences_new RENAME TO absences;

        CREATE INDEX IF NOT EXISTS idx_absences_student_date ON absences(student_id, absence_date);
        CREATE INDEX IF NOT EXISTS idx_absences_year_grade_section ON absences(academic_year_id, grade_id, section_id, absence_date);
        CREATE INDEX IF NOT EXISTS idx_absences_student_year_status ON absences(student_id, academic_year_id, status);
        CREATE INDEX IF NOT EXISTS idx_absences_year_status_counted ON absences(academic_year_id, status, counted_as_absence);
      `);
    });
    migrateTx();
    db.pragma('foreign_keys = ON');
  }

  // 3. Migrate absence_lesson_details to store per-lesson status, snapshots, and enforce UNIQUE(student_id, absence_date, lesson_number)
  const detailMeta = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'absence_lesson_details'")
    .get() as { sql: string } | undefined;

  if (
    detailMeta &&
    (!detailMeta.sql.includes('lesson_status') ||
      !detailMeta.sql.includes('lesson_escape') ||
      !detailMeta.sql.includes('student_id, absence_date, lesson_number'))
  ) {
    db.pragma('foreign_keys = OFF');
    const migrateDetailsTx = db.transaction(() => {
      db.exec(`
        CREATE TABLE absence_lesson_details_new (
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

        INSERT OR IGNORE INTO absence_lesson_details_new (
          id, absence_id, student_id, absence_date, lesson_number,
          lesson_status, counted_as_absence, permission_rule_snapshot, threshold_snapshot, created_at
        )
        SELECT
          d.id,
          d.absence_id,
          a.student_id,
          a.absence_date,
          d.lesson_number,
          CASE
            WHEN a.status = 'lesson_permission' THEN 'lesson_permission'
            WHEN a.status = 'lesson_escape' THEN 'lesson_escape'
            ELSE 'lesson_absence'
          END,
          CASE
            WHEN a.status = 'lesson_permission' THEN a.counted_as_absence
            ELSE 1
          END,
          CASE
            WHEN a.status = 'lesson_permission' THEN a.permission_rule_snapshot
            ELSE NULL
          END,
          a.threshold_snapshot,
          d.created_at
        FROM absence_lesson_details d
        JOIN absences a ON a.id = d.absence_id;

        DROP TABLE absence_lesson_details;
        ALTER TABLE absence_lesson_details_new RENAME TO absence_lesson_details;

        CREATE INDEX IF NOT EXISTS idx_absence_lesson_details_absence_id ON absence_lesson_details(absence_id);
        CREATE INDEX IF NOT EXISTS idx_absence_lesson_details_student_date ON absence_lesson_details(student_id, absence_date);
      `);
    });
    migrateDetailsTx();
    db.pragma('foreign_keys = ON');
  }

  // 4. Ensure lesson_converted_days has contributing_lessons_json
  const convCols = db.prepare('PRAGMA table_info(lesson_converted_days)').all() as Array<{
    name: string;
  }>;
  if (!convCols.some((c) => c.name === 'contributing_lessons_json')) {
    db.exec('ALTER TABLE lesson_converted_days ADD COLUMN contributing_lessons_json TEXT');
  }

  // 5. Ensure issued_official_letters has subject column
  const issuedCols = db.prepare('PRAGMA table_info(issued_official_letters)').all() as Array<{ name: string }>;
  if (!issuedCols.some((c) => c.name === 'subject')) {
    db.exec('ALTER TABLE issued_official_letters ADD COLUMN subject TEXT NOT NULL DEFAULT ""');
  }

  // 6. Safely unify absence_stages.letter_template while backing up any prior per-stage template in legacy_letter_template
  const absenceStageCols = db.prepare('PRAGMA table_info(absence_stages)').all() as Array<{ name: string }>;
  if (!absenceStageCols.some((c) => c.name === 'legacy_letter_template')) {
    db.exec('ALTER TABLE absence_stages ADD COLUMN legacy_letter_template TEXT');
  }

  const existingStages = db
    .prepare('SELECT id, letter_template, legacy_letter_template FROM absence_stages')
    .all() as Array<{ id: number; letter_template: string; legacy_letter_template: string | null }>;

  const savedUnifiedRow = db
    .prepare('SELECT unified_letter_template FROM school_settings WHERE id = 1')
    .get() as { unified_letter_template?: string | null } | undefined;
  const effectiveUnifiedTemplate =
    savedUnifiedRow?.unified_letter_template !== undefined &&
    savedUnifiedRow?.unified_letter_template !== null
      ? savedUnifiedRow.unified_letter_template
      : UNIFIED_OFFICIAL_LETTER_TEMPLATE;

  if (existingStages.length > 0) {
    const unifyStmt = db.prepare(
      `UPDATE absence_stages
       SET legacy_letter_template = COALESCE(legacy_letter_template, ?),
           letter_template = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    );
    const unifyTx = db.transaction(() => {
      for (const st of existingStages) {
        const current = (st.letter_template || '').trim();
        if (current !== effectiveUnifiedTemplate.trim()) {
          unifyStmt.run(
            current.length > 0 ? st.letter_template : null,
            effectiveUnifiedTemplate,
            st.id
          );
        }
      }
    });
    unifyTx();
  }

  // 7. Ensure backup_settings has backup_on_close column & update legacy retention default
  const backupSettingsCols = db.prepare('PRAGMA table_info(backup_settings)').all() as Array<{ name: string }>;
  if (backupSettingsCols.length > 0) {
    if (!backupSettingsCols.some((c) => c.name === 'backup_on_close')) {
      db.exec('ALTER TABLE backup_settings ADD COLUMN backup_on_close INTEGER NOT NULL DEFAULT 1');
    }
    try {
      db.prepare('UPDATE backup_settings SET retention_count = 10 WHERE id = 1 AND retention_count = 7').run();
    } catch {
      // ignore
    }
  }

  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_absences_year_status_counted ON absences(academic_year_id, status, counted_as_absence);'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_absence_lesson_details_student_date ON absence_lesson_details(student_id, absence_date);'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_converted_days_year_student ON lesson_converted_days(academic_year_id, student_id);'
  );
}

export function initializeDatabase(db: SqliteDb): void {
  db.pragma('foreign_keys = ON');
  if (!db.memory) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }

  db.exec(SCHEMA_SQL);
  runSafeMigrations(db);

  // Bootstrap default academic year and school settings ONLY (no fake students or classes)
  const bootstrapTx = db.transaction(() => {
    const existingYearsCount = db
      .prepare('SELECT COUNT(*) as count FROM academic_years')
      .get() as { count: number };

    let activeYearId: number | null = null;

    if (existingYearsCount.count === 0) {
      const defaultYearName = computeDefaultAcademicYearName();
      const insertYear = db
        .prepare('INSERT INTO academic_years (name, is_active) VALUES (?, 1)')
        .run(defaultYearName);
      activeYearId = Number(insertYear.lastInsertRowid);
    } else {
      const activeYear = db
        .prepare('SELECT id FROM academic_years WHERE is_active = 1 LIMIT 1')
        .get() as { id: number } | undefined;
      if (activeYear) {
        activeYearId = activeYear.id;
      } else {
        const firstYear = db
          .prepare('SELECT id FROM academic_years ORDER BY id DESC LIMIT 1')
          .get() as { id: number } | undefined;
        if (firstYear) {
          db.prepare('UPDATE academic_years SET is_active = 1 WHERE id = ?').run(firstYear.id);
          activeYearId = firstYear.id;
        }
      }
    }

    const existingSettings = db
      .prepare('SELECT id, academic_year_id FROM school_settings WHERE id = 1')
      .get() as { id: number; academic_year_id: number | null } | undefined;

    if (!existingSettings) {
      db.prepare(
        `INSERT INTO school_settings (
           id, school_name, directorate_name, academic_year_id,
           lessons_per_absence_day, daily_lessons_count,
           daily_permission_counts_as_absence, lesson_permission_counts_as_absence,
           weekly_holiday_reason, unified_letter_template
         )
         VALUES (1, ?, ?, ?, 5, 7, 0, 0, 'عطلة أسبوعية رسمية', ?)`
      ).run(
        'المدرسة النموذجية',
        'المديرية العامة للتربية',
        activeYearId,
        UNIFIED_OFFICIAL_LETTER_TEMPLATE
      );
    } else {
      if (!existingSettings.academic_year_id && activeYearId) {
        db.prepare('UPDATE school_settings SET academic_year_id = ? WHERE id = 1').run(activeYearId);
      }
      db.prepare(
        'UPDATE school_settings SET unified_letter_template = ? WHERE id = 1 AND unified_letter_template IS NULL'
      ).run(UNIFIED_OFFICIAL_LETTER_TEMPLATE);
    }

    // Seed default backup_settings row if empty
    const existingBackupSettings = db
      .prepare('SELECT id FROM backup_settings WHERE id = 1')
      .get() as { id: number } | undefined;

    if (!existingBackupSettings) {
      db.prepare(
        `INSERT INTO backup_settings (id, auto_enabled, backup_on_close, frequency, retention_count, backup_dir)
         VALUES (1, 0, 1, 'daily', 10, NULL)`
      ).run();
    }

    // Seed default 7 weekly_holidays rows if empty (Friday=5, Saturday=6 are holidays by default)
    const weeklyCount = db
      .prepare('SELECT COUNT(*) as count FROM weekly_holidays')
      .get() as { count: number };

    if (weeklyCount.count === 0) {
      const insertWeekly = db.prepare(
        'INSERT INTO weekly_holidays (day_of_week, day_name, is_holiday) VALUES (?, ?, ?)'
      );
      const defaultDays: Array<[number, string, number]> = [
        [0, 'الأحد', 0],
        [1, 'الاثنين', 0],
        [2, 'الثلاثاء', 0],
        [3, 'الأربعاء', 0],
        [4, 'الخميس', 0],
        [5, 'الجمعة', 1],
        [6, 'السبت', 1],
      ];
      for (const [dow, name, isHol] of defaultDays) {
        insertWeekly.run(dow, name, isHol);
      }
    }

    // Seed default legal_stage_regulations (primary, intermediate, preparatory) & version 1 snapshots
    const todayIso = new Date().toISOString().slice(0, 10);
    const defaultRegs = buildDefaultStageRegulations(todayIso);

    const existingRegCount = db
      .prepare('SELECT COUNT(*) as count FROM legal_stage_regulations')
      .get() as { count: number };

    if (existingRegCount.count === 0) {
      const insertReg = db.prepare(
        `INSERT INTO legal_stage_regulations (
          stage, stage_name, effective_absence_limit, absence_calculation_method,
          excused_absence_mode, unexcused_absence_handling, dispersed_lessons_rule,
          lesson_conversion_rule, preliminary_warning_days, first_warning_days,
          final_warning_days, final_effective_limit_days, thresholds_are_provisional,
          guardian_notify_frequency, guardian_summons_frequency, guardian_notify_notes,
          attendance_score_deduction_enabled, attendance_score_deduction_per_unexcused_day,
          attendance_score_article, conduct_failure_enabled, conduct_failure_threshold,
          conduct_failure_article, truancy_handling_enabled, truancy_handling_notes,
          truancy_article, dispersed_lessons_counting_enabled, dispersed_lessons_article,
          warnings_article, decision_name, decision_number, decision_issue_date,
          effective_from_date, legal_notes, is_legally_approved, official_letter_approved,
          warning_letter_template, summons_letter_template, current_version
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1
        )`
      );

      for (const reg of defaultRegs) {
        insertReg.run(
          reg.stage,
          reg.stage_name,
          reg.effective_absence_limit,
          reg.absence_calculation_method,
          reg.excused_absence_mode,
          reg.unexcused_absence_handling,
          reg.dispersed_lessons_rule,
          reg.lesson_conversion_rule,
          reg.preliminary_warning_days,
          reg.first_warning_days,
          reg.final_warning_days,
          reg.final_effective_limit_days,
          reg.thresholds_are_provisional,
          reg.guardian_notify_frequency,
          reg.guardian_summons_frequency,
          reg.guardian_notify_notes,
          reg.attendance_score_deduction_enabled,
          reg.attendance_score_deduction_per_unexcused_day,
          reg.attendance_score_article,
          reg.conduct_failure_enabled,
          reg.conduct_failure_threshold,
          reg.conduct_failure_article,
          reg.truancy_handling_enabled,
          reg.truancy_handling_notes,
          reg.truancy_article,
          reg.dispersed_lessons_counting_enabled,
          reg.dispersed_lessons_article,
          reg.warnings_article,
          reg.decision_name,
          reg.decision_number,
          reg.decision_issue_date,
          reg.effective_from_date,
          reg.legal_notes,
          reg.is_legally_approved,
          reg.official_letter_approved,
          reg.warning_letter_template,
          reg.summons_letter_template
        );
      }
    }

    // Ensure every stage in legal_stage_regulations has a version 1 snapshot & existing years are bound cleanly
    const currentRegs = db
      .prepare('SELECT * FROM legal_stage_regulations')
      .all() as Array<Record<string, unknown>>;
    const allYears = db.prepare('SELECT id FROM academic_years').all() as Array<{ id: number }>;

    for (const reg of currentRegs) {
      const stage = String(reg.stage);
      let v1 = db
        .prepare(
          'SELECT id FROM legal_regulation_versions WHERE stage = ? ORDER BY version_number DESC LIMIT 1'
        )
        .get(stage) as { id: number } | undefined;

      if (!v1) {
        const info = db
          .prepare(
            `INSERT INTO legal_regulation_versions (
              stage, version_number, academic_year_id, effective_from_date,
              decision_name, decision_number, decision_issue_date, is_legally_approved,
              change_summary, snapshot_json
            ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            stage,
            activeYearId,
            String(reg.effective_from_date || todayIso),
            reg.decision_name ?? null,
            reg.decision_number ?? null,
            reg.decision_issue_date ?? null,
            Number(reg.is_legally_approved ?? 0),
            'تهيئة الضابطة المبدئية الافتراضية للمرحلة',
            JSON.stringify(reg)
          );
        v1 = { id: Number(info.lastInsertRowid) };
      }

      for (const yr of allYears) {
        db.prepare(
          `INSERT OR IGNORE INTO legal_year_regulation_bindings (
            academic_year_id, stage, regulation_version_id, is_locked
          ) VALUES (?, ?, ?, ?)`
        ).run(yr.id, stage, v1.id, yr.id === activeYearId ? 0 : 1);
      }
    }
  });

  bootstrapTx();
}

export function createDatabaseConnection(dbPath?: string): SqliteDb {
  const resolvedPath =
    dbPath ||
    process.env.SQLITE_DB_PATH ||
    path.join(process.env.APPDATA || process.env.LOCALAPPDATA || process.env.HOME || process.cwd(), 'SchoolAbsenceManager', 'school_attendance.db');

  if (resolvedPath !== ':memory:') {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(resolvedPath);
  initializeDatabase(db);
  return db;
}

export function getDb(): SqliteDb {
  if (!defaultDbInstance) {
    defaultDbInstance = createDatabaseConnection();
  }
  return defaultDbInstance;
}

export function setDbInstance(db: SqliteDb): void {
  defaultDbInstance = db;
}

export function closeDb(): void {
  if (defaultDbInstance) {
    defaultDbInstance.close();
    defaultDbInstance = null;
  }
}
