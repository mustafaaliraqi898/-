import crypto from 'crypto';
import type {
  CreateStudentInput,
  StudentEnrollmentHistoryItem,
  StudentListQuery,
  StudentRecord,
  TransferStudentInput,
  UpdateStudentInput,
} from '../../src/types/school';
import type { SqliteDb } from '../db/connection';
import {
  ServiceError,
  isValidStudentFullName,
  normalizeNullableString,
  normalizeWhitespace,
  validateBirthDate,
  validateEnrollmentDate,
  validatePhotoDataUrl,
} from '../utils/validation';
import { resolveAssetIdFromImageRef } from './imageService';
import { getActiveAcademicYear } from './settingsService';

function resolveLinkedPhotoAssetId(
  db: SqliteDb,
  photoData: string | null,
  explicitAssetId?: number | null
): number | null {
  if (!photoData && !explicitAssetId) return null;
  const candidateId = explicitAssetId ?? resolveAssetIdFromImageRef(photoData);
  if (!candidateId) return null;
  const exists = db.prepare('SELECT id FROM media_assets WHERE id = ?').get(candidateId) as
    | { id: number }
    | undefined;
  if (!exists) {
    throw new ServiceError('الصورة المرفقة غير موجودة في وحدة تخزين الصور.', 400, 'MEDIA_NOT_FOUND');
  }
  return exists.id;
}

const SORT_COLUMNS: Record<NonNullable<StudentListQuery['sort_by']>, string> = {
  full_name: 'st.full_name',
  registry_number: 'COALESCE(st.registry_number, \'\')',
  grade_name: 'g.sort_order, g.name, s.name',
  enrollment_date: 'se.enrollment_date',
  created_at: 'st.created_at',
};

function verifyGradeAndSection(
  db: SqliteDb,
  gradeId: number,
  sectionId: number
): { grade_id: number; section_id: number; grade_name: string; section_name: string } {
  const row = db
    .prepare(
      `SELECT g.id as grade_id, g.name as grade_name, s.id as section_id, s.name as section_name
       FROM sections s
       JOIN grades g ON g.id = s.grade_id
       WHERE s.id = ? AND g.id = ?`
    )
    .get(sectionId, gradeId) as
    | { grade_id: number; section_id: number; grade_name: string; section_name: string }
    | undefined;

  if (!row) {
    throw new ServiceError('الصف أو الشعبة المحددة غير صالحة أو لا تتبع الشعبة للصف المختار.', 400);
  }
  return row;
}

export function getStudentById(
  db: SqliteDb,
  studentId: number,
  academicYearId?: number
): StudentRecord {
  const yearId = academicYearId ?? getActiveAcademicYear(db).id;

  const row = db
    .prepare(
      `SELECT st.id, st.student_uid, st.registry_number, st.full_name, st.birth_date,
              st.phone, st.photo_data, st.photo_asset_id, st.status, st.created_at, st.updated_at,
              se.id as enrollment_id, se.academic_year_id, ay.name as academic_year_name,
              se.grade_id, g.name as grade_name, se.section_id, s.name as section_name,
              se.enrollment_date
       FROM students st
       LEFT JOIN student_enrollments se
         ON se.student_id = st.id AND se.academic_year_id = ? AND se.is_current = 1
       LEFT JOIN academic_years ay ON ay.id = se.academic_year_id
       LEFT JOIN grades g ON g.id = se.grade_id
       LEFT JOIN sections s ON s.id = se.section_id
       WHERE st.id = ?`
    )
    .get(yearId, studentId) as StudentRecord | undefined;

  if (!row) {
    throw new ServiceError('الطالب غير موجود في قاعدة البيانات.', 404, 'STUDENT_NOT_FOUND');
  }
  return row;
}

export function listStudents(db: SqliteDb, query: StudentListQuery = {}): StudentRecord[] {
  const yearId = query.academic_year_id ?? getActiveAcademicYear(db).id;

  const conditions: string[] = ['se.academic_year_id = ?', 'se.is_current = 1'];
  const params: Array<string | number> = [yearId];

  if (query.status && query.status !== 'all') {
    conditions.push('st.status = ?');
    params.push(query.status);
  } else if (!query.status) {
    conditions.push("st.status = 'active'");
  }

  if (query.grade_id) {
    conditions.push('se.grade_id = ?');
    params.push(query.grade_id);
  }

  if (query.section_id) {
    conditions.push('se.section_id = ?');
    params.push(query.section_id);
  }

  const search = normalizeWhitespace(query.search);
  if (search) {
    conditions.push(
      '(st.full_name LIKE ? OR st.registry_number LIKE ? OR st.student_uid LIKE ? OR st.phone LIKE ?)'
    );
    const likePattern = `%${search}%`;
    params.push(likePattern, likePattern, likePattern, likePattern);
  }

  const sortCol = SORT_COLUMNS[query.sort_by ?? 'full_name'] ?? 'st.full_name';
  const sortDir = query.sort_dir === 'desc' ? 'DESC' : 'ASC';

  const sql = `
    SELECT st.id, st.student_uid, st.registry_number, st.full_name, st.birth_date,
           st.phone, st.photo_data, st.photo_asset_id, st.status, st.created_at, st.updated_at,
           se.id as enrollment_id, se.academic_year_id, ay.name as academic_year_name,
           se.grade_id, g.name as grade_name, se.section_id, s.name as section_name,
           se.enrollment_date
    FROM students st
    JOIN student_enrollments se ON se.student_id = st.id
    JOIN academic_years ay ON ay.id = se.academic_year_id
    JOIN grades g ON g.id = se.grade_id
    JOIN sections s ON s.id = se.section_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${sortCol} ${sortDir}, st.id DESC
  `;

  return db.prepare(sql).all(...params) as StudentRecord[];
}

export function createStudent(db: SqliteDb, input: CreateStudentInput): StudentRecord {
  const fullName = normalizeWhitespace(input.full_name);
  if (!isValidStudentFullName(fullName)) {
    throw new ServiceError('اسم الطالب حقل إجباري ويجب أن يكون ثلاثياً أو رباعياً (كلمتين على الأقل).');
  }

  const registryNumber = normalizeNullableString(input.registry_number);
  const birthDate = validateBirthDate(input.birth_date);
  const phone = normalizeNullableString(input.phone);
  const photoData = validatePhotoDataUrl(input.photo_data);
  const photoAssetId = resolveLinkedPhotoAssetId(db, photoData, input.photo_asset_id);
  const effectivePhotoData =
    photoData ?? (photoAssetId ? `/api/media/${photoAssetId}/optimized` : null);
  const enrollmentDate = validateEnrollmentDate(input.enrollment_date);

  const yearId = input.academic_year_id ?? getActiveAcademicYear(db).id;
  const yearExists = db.prepare('SELECT id FROM academic_years WHERE id = ?').get(yearId) as
    | { id: number }
    | undefined;
  if (!yearExists) {
    throw new ServiceError('السنة الدراسية غير موجودة.', 404);
  }

  verifyGradeAndSection(db, Number(input.grade_id), Number(input.section_id));

  if (registryNumber) {
    const existingReg = db
      .prepare('SELECT id, full_name FROM students WHERE registry_number = ?')
      .get(registryNumber) as { id: number; full_name: string } | undefined;
    if (existingReg) {
      throw new ServiceError(
        `رقم القيد "${registryNumber}" مسجل مسبقاً للطالب (${existingReg.full_name}).`,
        409,
        'DUPLICATE_REGISTRY_NUMBER'
      );
    }
  }

  const createdStudentId = db.transaction(() => {
    const tempUid = `TMP-${crypto.randomUUID()}`;
    const info = db
      .prepare(
        `INSERT INTO students (student_uid, registry_number, full_name, birth_date, phone, photo_data, photo_asset_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`
      )
      .run(
        tempUid,
        registryNumber,
        fullName,
        birthDate,
        phone,
        effectivePhotoData,
        photoAssetId
      );

    const newId = Number(info.lastInsertRowid);
    const permanentUid = `STD-${String(newId).padStart(5, '0')}`;
    db.prepare('UPDATE students SET student_uid = ? WHERE id = ?').run(permanentUid, newId);

    db.prepare(
      `INSERT INTO student_enrollments
         (student_id, academic_year_id, grade_id, section_id, enrollment_date, is_current)
       VALUES (?, ?, ?, ?, ?, 1)`
    ).run(newId, yearId, Number(input.grade_id), Number(input.section_id), enrollmentDate);

    return newId;
  })();

  return getStudentById(db, createdStudentId, yearId);
}

export function updateStudent(
  db: SqliteDb,
  studentId: number,
  input: UpdateStudentInput
): StudentRecord {
  const existing = db
    .prepare('SELECT id, registry_number, status FROM students WHERE id = ?')
    .get(studentId) as { id: number; registry_number: string | null; status: string } | undefined;

  if (!existing) {
    throw new ServiceError('الطالب غير موجود.', 404, 'STUDENT_NOT_FOUND');
  }

  const fullName = normalizeWhitespace(input.full_name);
  if (!isValidStudentFullName(fullName)) {
    throw new ServiceError('اسم الطالب حقل إجباري ويجب أن يكون ثلاثياً أو رباعياً.');
  }

  const registryNumber = normalizeNullableString(input.registry_number);
  const birthDate = validateBirthDate(input.birth_date);
  const phone = normalizeNullableString(input.phone);
  const photoData = validatePhotoDataUrl(input.photo_data);
  const photoAssetId = resolveLinkedPhotoAssetId(db, photoData, input.photo_asset_id);
  const effectivePhotoData =
    photoData ?? (photoAssetId ? `/api/media/${photoAssetId}/optimized` : null);
  const status = input.status ?? existing.status;

  if (!['active', 'transferred_out', 'graduated', 'archived'].includes(status)) {
    throw new ServiceError('حالة الطالب غير صالحة.', 400);
  }

  if (registryNumber) {
    const dup = db
      .prepare('SELECT id, full_name FROM students WHERE registry_number = ? AND id != ?')
      .get(registryNumber, studentId) as { id: number; full_name: string } | undefined;
    if (dup) {
      throw new ServiceError(
        `رقم القيد "${registryNumber}" مسجل مسبقاً للطالب (${dup.full_name}).`,
        409,
        'DUPLICATE_REGISTRY_NUMBER'
      );
    }
  }

  db.prepare(
    `UPDATE students
     SET full_name = ?, registry_number = ?, birth_date = ?, phone = ?, photo_data = ?,
         photo_asset_id = ?, status = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    fullName,
    registryNumber,
    birthDate,
    phone,
    effectivePhotoData,
    photoAssetId,
    status,
    studentId
  );

  return getStudentById(db, studentId);
}

export function transferStudent(
  db: SqliteDb,
  studentId: number,
  input: TransferStudentInput
): StudentRecord {
  const student = db.prepare('SELECT id, full_name FROM students WHERE id = ?').get(studentId) as
    | { id: number; full_name: string }
    | undefined;
  if (!student) {
    throw new ServiceError('الطالب غير موجود.', 404, 'STUDENT_NOT_FOUND');
  }

  const yearId = input.academic_year_id ?? getActiveAcademicYear(db).id;
  const target = verifyGradeAndSection(db, Number(input.grade_id), Number(input.section_id));
  const enrollmentDate = validateEnrollmentDate(input.enrollment_date);
  const reason = normalizeNullableString(input.transfer_reason);

  const currentPlacement = db
    .prepare(
      `SELECT id, grade_id, section_id
       FROM student_enrollments
       WHERE student_id = ? AND academic_year_id = ? AND is_current = 1
       LIMIT 1`
    )
    .get(studentId, yearId) as { id: number; grade_id: number; section_id: number } | undefined;

  if (
    currentPlacement &&
    currentPlacement.grade_id === target.grade_id &&
    currentPlacement.section_id === target.section_id
  ) {
    throw new ServiceError('الطالب مسجل بالفعل في نفس الصف والشعبة المحددين.');
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE student_enrollments
       SET is_current = 0, ended_at = datetime('now')
       WHERE student_id = ? AND academic_year_id = ? AND is_current = 1`
    ).run(studentId, yearId);

    db.prepare(
      `INSERT INTO student_enrollments
         (student_id, academic_year_id, grade_id, section_id, enrollment_date, is_current, transfer_reason)
       VALUES (?, ?, ?, ?, ?, 1, ?)`
    ).run(studentId, yearId, target.grade_id, target.section_id, enrollmentDate, reason);

    db.prepare(`UPDATE students SET status = 'active', updated_at = datetime('now') WHERE id = ?`).run(
      studentId
    );
  })();

  return getStudentById(db, studentId, yearId);
}

export function getStudentEnrollmentHistory(
  db: SqliteDb,
  studentId: number
): StudentEnrollmentHistoryItem[] {
  const exists = db.prepare('SELECT id FROM students WHERE id = ?').get(studentId);
  if (!exists) {
    throw new ServiceError('الطالب غير موجود.', 404, 'STUDENT_NOT_FOUND');
  }

  return db
    .prepare(
      `SELECT se.id, se.student_id, se.academic_year_id, ay.name as academic_year_name,
              se.grade_id, g.name as grade_name, se.section_id, s.name as section_name,
              se.enrollment_date, se.is_current, se.transfer_reason, se.created_at, se.ended_at
       FROM student_enrollments se
       JOIN academic_years ay ON ay.id = se.academic_year_id
       JOIN grades g ON g.id = se.grade_id
       JOIN sections s ON s.id = se.section_id
       WHERE se.student_id = ?
       ORDER BY se.id DESC`
    )
    .all(studentId) as StudentEnrollmentHistoryItem[];
}

export function deleteStudent(db: SqliteDb, studentId: number): void {
  const student = db.prepare('SELECT id, full_name FROM students WHERE id = ?').get(studentId) as
    | { id: number; full_name: string }
    | undefined;
  if (!student) {
    throw new ServiceError('الطالب غير موجود.', 404, 'STUDENT_NOT_FOUND');
  }

  const absenceCount = db
    .prepare('SELECT COUNT(*) as count FROM absences WHERE student_id = ?')
    .get(studentId) as { count: number };

  if (absenceCount.count > 0) {
    throw new ServiceError(
      `لا يمكن حذف الطالب "${student.full_name}" لوجود ${absenceCount.count} سجل غياب مرتبط به. يمكنك تغيير حالته إلى "منقول خارج المدرسة" أو "مؤرشف" للحفاظ على السجلات التاريخية.`,
      409,
      'STUDENT_HAS_ABSENCES'
    );
  }

  db.transaction(() => {
    db.prepare('DELETE FROM student_enrollments WHERE student_id = ?').run(studentId);
    db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
  })();
}
