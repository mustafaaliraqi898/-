import type {
  AbsenceThresholdsSettings,
  EducationalStage,
  UpdateAbsenceThresholdsInput,
} from '../../src/types/school';
import type { SqliteDb } from '../db/connection';
import { ServiceError } from '../utils/validation';
import { getActiveAcademicYear } from './settingsService';

const PREPARATORY_STAGE: EducationalStage = 'preparatory';

export const STAGE_LABELS: Record<EducationalStage, string> = {
  primary: 'المرحلة الابتدائية',
  intermediate: 'المرحلة المتوسطة',
  preparatory: 'المرحلة الإعدادية',
};

export function validateStage(raw: string): EducationalStage {
  const s = raw.trim() as EducationalStage;
  if (s !== 'primary' && s !== 'intermediate' && s !== 'preparatory') {
    throw new ServiceError('المرحلة الدراسية المحددة غير صالحة.', 400, 'INVALID_STAGE');
  }
  return s;
}

function mapRowToThresholds(row: Record<string, unknown>): AbsenceThresholdsSettings {
  return {
    warning_days: Number(row.preliminary_warning_days ?? 15),
    preliminary_warning_days: Number(row.first_warning_days ?? 25),
    final_warning_days: Number(row.final_warning_days ?? 35),
    effective_absence_limit: Number(row.effective_absence_limit ?? 45),
    updated_at: String(row.updated_at ?? ''),
  };
}

export function getSimplifiedAbsenceThresholds(
  db: SqliteDb,
  academicYearId?: number,
  knownActiveYearId?: number | null
): AbsenceThresholdsSettings {
  const activeYearId = knownActiveYearId ?? getActiveAcademicYear(db).id;
  const targetYearId = academicYearId ?? activeYearId;

  if (targetYearId !== activeYearId) {
    const binding = db
      .prepare(
        `SELECT b.is_locked, v.snapshot_json
         FROM legal_year_regulation_bindings b
         JOIN legal_regulation_versions v ON v.id = b.regulation_version_id
         WHERE b.academic_year_id = ? AND b.stage = ?`
      )
      .get(targetYearId, PREPARATORY_STAGE) as
      | { is_locked: number; snapshot_json: string }
      | undefined;

    if (binding) {
      try {
        const parsed = JSON.parse(binding.snapshot_json) as Record<string, unknown>;
        return mapRowToThresholds(parsed);
      } catch {
        // Fallback to live preparatory row
      }
    }
  }

  const liveRow = db
    .prepare('SELECT * FROM legal_stage_regulations WHERE stage = ?')
    .get(PREPARATORY_STAGE) as Record<string, unknown> | undefined;

  if (!liveRow) {
    throw new ServiceError('تعذر العثور على إعدادات حدود الغياب والإنذارات.', 404);
  }

  return mapRowToThresholds(liveRow);
}

export function updateSimplifiedAbsenceThresholds(
  db: SqliteDb,
  input: UpdateAbsenceThresholdsInput
): AbsenceThresholdsSettings {
  const warningDays = Number(input.warning_days);
  const preliminaryWarningDays = Number(input.preliminary_warning_days);
  const finalWarningDays = Number(input.final_warning_days);
  const effectiveAbsenceLimit = Number(input.effective_absence_limit);

  const fields = [
    { name: 'عتبة التحذير', value: warningDays },
    { name: 'عتبة الإنذار الأولي', value: preliminaryWarningDays },
    { name: 'عتبة الإنذار النهائي', value: finalWarningDays },
    { name: 'حد الغياب المؤثر', value: effectiveAbsenceLimit },
  ];

  for (const field of fields) {
    if (!Number.isInteger(field.value) || field.value < 1 || field.value > 365) {
      throw new ServiceError(
        `قيمة "${field.name}" يجب أن تكون عدداً صحيحاً موجباً بين 1 و 365.`,
        400,
        'INVALID_THRESHOLD'
      );
    }
  }

  if (
    !(
      warningDays < preliminaryWarningDays &&
      preliminaryWarningDays < finalWarningDays &&
      finalWarningDays < effectiveAbsenceLimit
    )
  ) {
    throw new ServiceError(
      'تسلسل العتبات غير متوافق: يجب أن يكون (عتبة التحذير < عتبة الإنذار الأولي < عتبة الإنذار النهائي < حد الغياب المؤثر).',
      400,
      'THRESHOLD_ORDER_CONFLICT'
    );
  }

  const activeYear = getActiveAcademicYear(db);
  const targetYearId = input.academic_year_id ?? activeYear.id;
  const targetYearRow = db
    .prepare('SELECT id, name FROM academic_years WHERE id = ?')
    .get(targetYearId) as { id: number; name: string } | undefined;

  if (!targetYearRow) {
    throw new ServiceError('السنة الدراسية المحددة غير موجودة.', 404, 'YEAR_NOT_FOUND');
  }

  const targetBinding = db
    .prepare(
      'SELECT is_locked FROM legal_year_regulation_bindings WHERE academic_year_id = ? AND stage = ?'
    )
    .get(targetYearId, PREPARATORY_STAGE) as { is_locked: number } | undefined;

  if (targetYearId !== activeYear.id && targetBinding?.is_locked === 1) {
    throw new ServiceError(
      `لا يمكن تعديل حدود الغياب للسنة الدراسية السابقة (${targetYearRow.name}). يتم التعديل للسنة الدراسية الفعالة فقط.`,
      409,
      'HISTORICAL_YEAR_LOCKED'
    );
  }

  const runUpdate = db.transaction(() => {
    const existing = db
      .prepare('SELECT * FROM legal_stage_regulations WHERE stage = ?')
      .get(PREPARATORY_STAGE) as Record<string, unknown> | undefined;

    if (!existing) {
      throw new ServiceError('سجل إعدادات المرحلة الإعدادية غير موجود.', 404);
    }

    const priorVer = db
      .prepare(
        'SELECT id FROM legal_regulation_versions WHERE stage = ? ORDER BY version_number DESC LIMIT 1'
      )
      .get(PREPARATORY_STAGE) as { id: number } | undefined;

    if (priorVer) {
      const otherYears = db
        .prepare('SELECT id FROM academic_years WHERE id != ?')
        .all(targetYearId) as Array<{ id: number }>;
      for (const yr of otherYears) {
        db.prepare(
          `INSERT OR IGNORE INTO legal_year_regulation_bindings (
             academic_year_id, stage, regulation_version_id, is_locked
           ) VALUES (?, ?, ?, 1)`
        ).run(yr.id, PREPARATORY_STAGE, priorVer.id);
      }
    }

    const nextVersion = Number(existing.current_version ?? 1) + 1;

    db.prepare(
      `UPDATE legal_stage_regulations
       SET preliminary_warning_days = ?,
           first_warning_days = ?,
           final_warning_days = ?,
           final_effective_limit_days = ?,
           effective_absence_limit = ?,
           current_version = ?,
           updated_at = datetime('now')
       WHERE stage = ?`
    ).run(
      warningDays,
      preliminaryWarningDays,
      finalWarningDays,
      effectiveAbsenceLimit,
      effectiveAbsenceLimit,
      nextVersion,
      PREPARATORY_STAGE
    );

    const updatedLive = db
      .prepare('SELECT * FROM legal_stage_regulations WHERE stage = ?')
      .get(PREPARATORY_STAGE) as Record<string, unknown>;

    const todayIso = new Date().toISOString().slice(0, 10);
    const verInfo = db
      .prepare(
        `INSERT INTO legal_regulation_versions (
           stage, version_number, academic_year_id, effective_from_date,
           is_legally_approved, change_summary, snapshot_json
         ) VALUES (?, ?, ?, ?, 1, ?, ?)`
      )
      .run(
        PREPARATORY_STAGE,
        nextVersion,
        targetYearId,
        todayIso,
        'تحديث حد الغياب المؤثر وعتبات التحذير والإنذارات',
        JSON.stringify(updatedLive)
      );

    db.prepare(
      `INSERT INTO legal_year_regulation_bindings (
         academic_year_id, stage, regulation_version_id, is_locked, bound_at
       ) VALUES (?, ?, ?, 0, datetime('now'))
       ON CONFLICT(academic_year_id, stage)
       DO UPDATE SET regulation_version_id = excluded.regulation_version_id,
                     bound_at = datetime('now')`
    ).run(targetYearId, PREPARATORY_STAGE, Number(verInfo.lastInsertRowid));

    return mapRowToThresholds(updatedLive);
  });

  return runUpdate();
}
