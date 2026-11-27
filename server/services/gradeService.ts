import type { EducationalStage, GradeWithSections, SectionItem } from '../../src/types/school';
import { inferStageFromGradeName, type SqliteDb } from '../db/connection';
import { ServiceError, normalizeWhitespace } from '../utils/validation';
import { recordAuditLog } from './auditLogService';
import { getActiveAcademicYear } from './settingsService';

const VALID_STAGES = new Set<EducationalStage>(['primary', 'intermediate', 'preparatory']);

function normalizeStageInput(
  rawStage: unknown,
  fallbackName?: string
): EducationalStage | null {
  if (rawStage === null || rawStage === '') return null;
  if (rawStage === undefined) {
    return fallbackName ? inferStageFromGradeName(fallbackName) : null;
  }
  const s = String(rawStage).trim() as EducationalStage;
  if (!VALID_STAGES.has(s)) {
    throw new ServiceError('المرحلة الدراسية المحددة غير صالحة.', 400);
  }
  return s;
}

export function listGradesWithSections(
  db: SqliteDb,
  academicYearId?: number
): GradeWithSections[] {
  const yearId = academicYearId ?? getActiveAcademicYear(db).id;

  const grades = db
    .prepare(
      `SELECT g.id, g.name, g.stage, g.sort_order, g.created_at, g.updated_at,
              COUNT(DISTINCT CASE WHEN se.is_current = 1 AND se.academic_year_id = ? AND st.status = 'active' THEN se.student_id END) as student_count
       FROM grades g
       LEFT JOIN student_enrollments se ON se.grade_id = g.id
       LEFT JOIN students st ON st.id = se.student_id
       GROUP BY g.id
       ORDER BY g.sort_order ASC, g.id ASC`
    )
    .all(yearId) as Array<{
    id: number;
    name: string;
    stage: EducationalStage | null;
    sort_order: number;
    student_count: number;
    created_at: string;
    updated_at: string;
  }>;

  const sections = db
    .prepare(
      `SELECT s.id, s.grade_id, g.name as grade_name, s.name, s.capacity, s.created_at, s.updated_at,
              COUNT(DISTINCT CASE WHEN se.is_current = 1 AND se.academic_year_id = ? AND st.status = 'active' THEN se.student_id END) as student_count
       FROM sections s
       JOIN grades g ON g.id = s.grade_id
       LEFT JOIN student_enrollments se ON se.section_id = s.id
       LEFT JOIN students st ON st.id = se.student_id
       GROUP BY s.id
       ORDER BY s.name ASC, s.id ASC`
    )
    .all(yearId) as SectionItem[];

  const sectionsByGrade = new Map<number, SectionItem[]>();
  for (const section of sections) {
    const list = sectionsByGrade.get(section.grade_id) ?? [];
    list.push(section);
    sectionsByGrade.set(section.grade_id, list);
  }

  return grades.map((grade) => ({
    ...grade,
    sections: sectionsByGrade.get(grade.id) ?? [],
  }));
}

export function createGrade(
  db: SqliteDb,
  input: { name: string; stage?: EducationalStage | null; initial_sections?: string[] }
): GradeWithSections {
  const name = normalizeWhitespace(input.name);
  if (!name) {
    throw new ServiceError('اسم الصف الدراسي حقل إجباري.');
  }

  const stage = normalizeStageInput(input.stage, name);

  const duplicate = db.prepare('SELECT id FROM grades WHERE name = ?').get(name) as
    | { id: number }
    | undefined;
  if (duplicate) {
    throw new ServiceError(`الصف "${name}" موجود مسبقاً.`, 409, 'DUPLICATE_GRADE');
  }

  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) as max_order FROM grades').get() as {
    max_order: number;
  };

  const sectionNames = (input.initial_sections ?? [])
    .map((s) => normalizeWhitespace(s))
    .filter(Boolean);
  const uniqueSections = Array.from(new Set(sectionNames));

  const gradeId = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO grades (name, stage, sort_order) VALUES (?, ?, ?)')
      .run(name, stage, maxOrder.max_order + 1);
    const createdGradeId = Number(info.lastInsertRowid);

    const insertSection = db.prepare('INSERT INTO sections (grade_id, name) VALUES (?, ?)');
    for (const secName of uniqueSections) {
      insertSection.run(createdGradeId, secName);
    }

    recordAuditLog(db, {
      operation_type: 'create',
      section: 'grades',
      description: `إضافة صف دراسي جديد: ${name}`,
      target_id: createdGradeId,
      target_label: name,
      new_value: { name, stage, initial_sections: uniqueSections },
    });

    return createdGradeId;
  })();

  const allGrades = listGradesWithSections(db);
  const created = allGrades.find((g) => g.id === gradeId);
  if (!created) {
    throw new ServiceError('حدث خطأ أثناء استرجاع بيانات الصف المضاف.', 500);
  }
  return created;
}

export function updateGrade(
  db: SqliteDb,
  gradeId: number,
  input: { name: string; stage?: EducationalStage | null }
): GradeWithSections {
  const name = normalizeWhitespace(input.name);
  if (!name) {
    throw new ServiceError('اسم الصف الدراسي حقل إجباري.');
  }

  const existing = db.prepare('SELECT id, name, stage FROM grades WHERE id = ?').get(gradeId) as
    | { id: number; name: string; stage: EducationalStage | null }
    | undefined;
  if (!existing) {
    throw new ServiceError('الصف الدراسي غير موجود.', 404, 'GRADE_NOT_FOUND');
  }

  const duplicate = db
    .prepare('SELECT id FROM grades WHERE name = ? AND id != ?')
    .get(name, gradeId) as { id: number } | undefined;
  if (duplicate) {
    throw new ServiceError(`يوجد صف آخر بنفس الاسم "${name}".`, 409, 'DUPLICATE_GRADE');
  }

  const nextStage =
    input.stage !== undefined
      ? normalizeStageInput(input.stage)
      : existing.stage ?? inferStageFromGradeName(name);

  db.transaction(() => {
    db.prepare(`UPDATE grades SET name = ?, stage = ?, updated_at = datetime('now') WHERE id = ?`).run(
      name,
      nextStage,
      gradeId
    );
    recordAuditLog(db, {
      operation_type: 'update',
      section: 'grades',
      description: `تعديل بيانات الصف الدراسي: ${name}`,
      target_id: gradeId,
      target_label: name,
      old_value: { name: existing.name, stage: existing.stage },
      new_value: { name, stage: nextStage },
    });
  })();

  const updated = listGradesWithSections(db).find((g) => g.id === gradeId);
  if (!updated) {
    throw new ServiceError('تعذر العثور على الصف بعد التعديل.', 404);
  }
  return updated;
}

export function updateGradeStage(
  db: SqliteDb,
  gradeId: number,
  stage: EducationalStage | null
): GradeWithSections {
  const existing = db.prepare('SELECT id, name, stage FROM grades WHERE id = ?').get(gradeId) as
    | { id: number; name: string; stage: EducationalStage | null }
    | undefined;
  if (!existing) {
    throw new ServiceError('الصف الدراسي غير موجود.', 404, 'GRADE_NOT_FOUND');
  }
  const normalizedStage = normalizeStageInput(stage);
  db.transaction(() => {
    db.prepare(`UPDATE grades SET stage = ?, updated_at = datetime('now') WHERE id = ?`).run(
      normalizedStage,
      gradeId
    );
    recordAuditLog(db, {
      operation_type: 'update',
      section: 'grades',
      description: `تعديل المرحلة التعليمية للصف: ${existing.name}`,
      target_id: gradeId,
      target_label: existing.name,
      old_value: { stage: existing.stage },
      new_value: { stage: normalizedStage },
    });
  })();
  const updated = listGradesWithSections(db).find((g) => g.id === gradeId);
  if (!updated) {
    throw new ServiceError('تعذر العثور على الصف بعد تحديث المرحلة.', 404);
  }
  return updated;
}

export function deleteGrade(db: SqliteDb, gradeId: number): void {
  const grade = db.prepare('SELECT id, name FROM grades WHERE id = ?').get(gradeId) as
    | { id: number; name: string }
    | undefined;
  if (!grade) {
    throw new ServiceError('الصف الدراسي غير موجود.', 404, 'GRADE_NOT_FOUND');
  }

  const sectionsCount = db
    .prepare('SELECT COUNT(*) as count FROM sections WHERE grade_id = ?')
    .get(gradeId) as { count: number };
  if (sectionsCount.count > 0) {
    throw new ServiceError(
      `لا يمكن حذف الصف "${grade.name}" لأنه يحتوي على ${sectionsCount.count} شعبة مرتبطة به. يرجى حذف أو نقل الشعب الفارغة أولاً.`,
      409,
      'GRADE_HAS_SECTIONS'
    );
  }

  const enrollmentsCount = db
    .prepare('SELECT COUNT(*) as count FROM student_enrollments WHERE grade_id = ?')
    .get(gradeId) as { count: number };
  if (enrollmentsCount.count > 0) {
    throw new ServiceError(
      `لا يمكن حذف الصف "${grade.name}" لوجود ${enrollmentsCount.count} سجل تسجيل دراسي مرتبط به حفاظاً على سلامة البيانات.`,
      409,
      'GRADE_HAS_ENROLLMENTS'
    );
  }

  const absencesCount = db
    .prepare('SELECT COUNT(*) as count FROM absences WHERE grade_id = ?')
    .get(gradeId) as { count: number };
  if (absencesCount.count > 0) {
    throw new ServiceError(
      `لا يمكن حذف الصف "${grade.name}" لوجود سجلات غياب تاريخية مرتبطة به.`,
      409,
      'GRADE_HAS_ABSENCES'
    );
  }

  db.transaction(() => {
    db.prepare('DELETE FROM grades WHERE id = ?').run(gradeId);
    recordAuditLog(db, {
      operation_type: 'delete',
      section: 'grades',
      description: `حذف الصف الدراسي: ${grade.name}`,
      target_id: gradeId,
      target_label: grade.name,
      old_value: { id: grade.id, name: grade.name },
    });
  })();
}

export function createSections(
  db: SqliteDb,
  gradeId: number,
  input: { names: string[]; capacity?: number | null }
): SectionItem[] {
  const grade = db.prepare('SELECT id, name FROM grades WHERE id = ?').get(gradeId) as
    | { id: number; name: string }
    | undefined;
  if (!grade) {
    throw new ServiceError('الصف الدراسي المحدد غير موجود.', 404, 'GRADE_NOT_FOUND');
  }

  const cleanedNames = Array.from(
    new Set(input.names.map((n) => normalizeWhitespace(n)).filter(Boolean))
  );
  if (cleanedNames.length === 0) {
    throw new ServiceError('يرجى إدخال اسم شعبة واحد على الأقل.');
  }

  const capacity =
    input.capacity !== undefined && input.capacity !== null && Number(input.capacity) > 0
      ? Math.floor(Number(input.capacity))
      : null;

  const createdIds = db.transaction(() => {
    const checkDup = db.prepare('SELECT id FROM sections WHERE grade_id = ? AND name = ?');
    const insertStmt = db.prepare(
      'INSERT INTO sections (grade_id, name, capacity) VALUES (?, ?, ?)'
    );

    const ids: number[] = [];
    for (const secName of cleanedNames) {
      const existing = checkDup.get(gradeId, secName) as { id: number } | undefined;
      if (existing) {
        throw new ServiceError(
          `الشعبة "${secName}" موجودة مسبقاً في الصف "${grade.name}".`,
          409,
          'DUPLICATE_SECTION'
        );
      }
      const info = insertStmt.run(gradeId, secName, capacity);
      ids.push(Number(info.lastInsertRowid));
    }

    recordAuditLog(db, {
      operation_type: 'create',
      section: 'grades',
      description: `إضافة شعب (${cleanedNames.join('، ')}) إلى صف ${grade.name}`,
      target_id: gradeId,
      target_label: grade.name,
      new_value: { grade_name: grade.name, sections: cleanedNames, capacity },
    });

    return ids;
  })();

  const gradeObj = listGradesWithSections(db).find((g) => g.id === gradeId);
  return (gradeObj?.sections ?? []).filter((s) => createdIds.includes(s.id));
}

export function updateSection(
  db: SqliteDb,
  sectionId: number,
  input: { name: string; capacity?: number | null }
): SectionItem {
  const section = db
    .prepare('SELECT id, grade_id, name, capacity FROM sections WHERE id = ?')
    .get(sectionId) as { id: number; grade_id: number; name: string; capacity: number | null } | undefined;
  if (!section) {
    throw new ServiceError('الشعبة الدراسية غير موجودة.', 404, 'SECTION_NOT_FOUND');
  }

  const name = normalizeWhitespace(input.name);
  if (!name) {
    throw new ServiceError('اسم الشعبة حقل إجباري.');
  }

  const duplicate = db
    .prepare('SELECT id FROM sections WHERE grade_id = ? AND name = ? AND id != ?')
    .get(section.grade_id, name, sectionId) as { id: number } | undefined;
  if (duplicate) {
    throw new ServiceError(`توجد شعبة أخرى بنفس الاسم "${name}" في هذا الصف.`, 409, 'DUPLICATE_SECTION');
  }

  const capacity =
    input.capacity !== undefined && input.capacity !== null && Number(input.capacity) > 0
      ? Math.floor(Number(input.capacity))
      : null;

  db.transaction(() => {
    db.prepare(
      `UPDATE sections SET name = ?, capacity = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(name, capacity, sectionId);
    recordAuditLog(db, {
      operation_type: 'update',
      section: 'grades',
      description: `تعديل الشعبة: ${name}`,
      target_id: sectionId,
      target_label: name,
      old_value: { name: section.name, capacity: section.capacity },
      new_value: { name, capacity },
    });
  })();

  const gradeObj = listGradesWithSections(db).find((g) => g.id === section.grade_id);
  const updated = gradeObj?.sections.find((s) => s.id === sectionId);
  if (!updated) {
    throw new ServiceError('تعذر العثور على الشعبة بعد التعديل.', 404);
  }
  return updated;
}

export function deleteSection(db: SqliteDb, sectionId: number): void {
  const section = db
    .prepare(
      `SELECT s.id, s.name, g.name as grade_name
       FROM sections s
       JOIN grades g ON g.id = s.grade_id
       WHERE s.id = ?`
    )
    .get(sectionId) as { id: number; name: string; grade_name: string } | undefined;

  if (!section) {
    throw new ServiceError('الشعبة الدراسية غير موجودة.', 404, 'SECTION_NOT_FOUND');
  }

  const activeEnrollments = db
    .prepare('SELECT COUNT(*) as count FROM student_enrollments WHERE section_id = ? AND is_current = 1')
    .get(sectionId) as { count: number };
  if (activeEnrollments.count > 0) {
    throw new ServiceError(
      `لا يمكن حذف شعبة "${section.name}" (${section.grade_name}) لأنها تضم ${activeEnrollments.count} طالب مسجل حالياً. يرجى نقل الطلاب أولاً.`,
      409,
      'SECTION_HAS_ACTIVE_STUDENTS'
    );
  }

  const historicalEnrollments = db
    .prepare('SELECT COUNT(*) as count FROM student_enrollments WHERE section_id = ?')
    .get(sectionId) as { count: number };
  if (historicalEnrollments.count > 0) {
    throw new ServiceError(
      `لا يمكن حذف شعبة "${section.name}" لوجود ${historicalEnrollments.count} سجل تسجيل تاريخي مرتبط بها حفاظاً على أرشيف الطلاب.`,
      409,
      'SECTION_HAS_HISTORY'
    );
  }

  const absencesCount = db
    .prepare('SELECT COUNT(*) as count FROM absences WHERE section_id = ?')
    .get(sectionId) as { count: number };
  if (absencesCount.count > 0) {
    throw new ServiceError(
      `لا يمكن حذف شعبة "${section.name}" لوجود سجلات غياب مرتبطة بها.`,
      409,
      'SECTION_HAS_ABSENCES'
    );
  }

  db.transaction(() => {
    db.prepare('DELETE FROM sections WHERE id = ?').run(sectionId);
    recordAuditLog(db, {
      operation_type: 'delete',
      section: 'grades',
      description: `حذف الشعبة "${section.name}" من صف ${section.grade_name}`,
      target_id: sectionId,
      target_label: `${section.grade_name} - ${section.name}`,
      old_value: { id: section.id, name: section.name, grade_name: section.grade_name },
    });
  })();
}
