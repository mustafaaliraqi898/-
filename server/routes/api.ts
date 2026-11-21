import express, { type NextFunction, type Request, type Response } from 'express';
import { getDb, type SqliteDb } from '../db/connection';
import {
  createSingleAbsenceRecord,
  deleteAbsenceRecord,
  getSectionAttendanceSheet,
  getStudentAbsenceDetails,
  saveSectionAttendance,
} from '../services/absenceService';
import { getDashboardStats } from '../services/dashboardService';
import {
  commitExcelStudents,
  generateUnifiedExcelTemplate,
  parseExcelBufferToRows,
  validateExcelRows,
} from '../services/excelService';
import {
  createGrade,
  createSections,
  deleteGrade,
  deleteSection,
  listGradesWithSections,
  updateGrade,
  updateSection,
} from '../services/gradeService';
import {
  createAcademicYear,
  getSchoolSettings,
  listAcademicYears,
  setActiveAcademicYear,
  updateSchoolSettings,
} from '../services/settingsService';
import {
  createStudent,
  deleteStudent,
  getStudentById,
  getStudentEnrollmentHistory,
  listStudents,
  transferStudent,
  updateStudent,
} from '../services/studentService';
import { ServiceError } from '../utils/validation';

function parsePositiveInt(raw: string | undefined, label: string): number {
  const num = Number(raw);
  if (!Number.isInteger(num) || num <= 0) {
    throw new ServiceError(`معرف ${label} غير صالح.`, 400);
  }
  return num;
}

function parseOptionalInt(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = Number(raw);
  if (!Number.isInteger(num) || num <= 0) return undefined;
  return num;
}

export function createApiRouter(dbProvider: () => SqliteDb = getDb) {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Settings & Academic Years
  router.get('/settings', (_req, res) => {
    const db = dbProvider();
    res.json(getSchoolSettings(db));
  });

  router.put('/settings', (req, res) => {
    const db = dbProvider();
    const updated = updateSchoolSettings(db, {
      school_name: String(req.body?.school_name ?? ''),
      directorate_name: String(req.body?.directorate_name ?? ''),
      lessons_per_absence_day:
        req.body?.lessons_per_absence_day !== undefined
          ? Number(req.body.lessons_per_absence_day)
          : undefined,
    });
    res.json(updated);
  });

  router.get('/academic-years', (_req, res) => {
    const db = dbProvider();
    res.json(listAcademicYears(db));
  });

  router.post('/academic-years', (req, res) => {
    const db = dbProvider();
    const created = createAcademicYear(db, {
      name: String(req.body?.name ?? ''),
      set_active: Boolean(req.body?.set_active),
    });
    res.status(201).json(created);
  });

  router.post('/academic-years/:id/activate', (req, res) => {
    const db = dbProvider();
    const id = parsePositiveInt(req.params.id, 'السنة الدراسية');
    res.json(setActiveAcademicYear(db, id));
  });

  // Dashboard
  router.get('/dashboard', (req, res) => {
    const db = dbProvider();
    const yearId = parseOptionalInt(req.query.academic_year_id);
    res.json(getDashboardStats(db, yearId));
  });

  // Grades & Sections
  router.get('/grades', (req, res) => {
    const db = dbProvider();
    const yearId = parseOptionalInt(req.query.academic_year_id);
    res.json(listGradesWithSections(db, yearId));
  });

  router.post('/grades', (req, res) => {
    const db = dbProvider();
    const initialSections = Array.isArray(req.body?.initial_sections)
      ? req.body.initial_sections.map(String)
      : [];
    const created = createGrade(db, {
      name: String(req.body?.name ?? ''),
      initial_sections: initialSections,
    });
    res.status(201).json(created);
  });

  router.put('/grades/:id', (req, res) => {
    const db = dbProvider();
    const id = parsePositiveInt(req.params.id, 'الصف');
    const updated = updateGrade(db, id, { name: String(req.body?.name ?? '') });
    res.json(updated);
  });

  router.delete('/grades/:id', (req, res) => {
    const db = dbProvider();
    const id = parsePositiveInt(req.params.id, 'الصف');
    deleteGrade(db, id);
    res.json({ deleted: true });
  });

  router.post('/grades/:id/sections', (req, res) => {
    const db = dbProvider();
    const gradeId = parsePositiveInt(req.params.id, 'الصف');
    const names = Array.isArray(req.body?.names)
      ? req.body.names.map(String)
      : req.body?.name
        ? [String(req.body.name)]
        : [];
    const created = createSections(db, gradeId, {
      names,
      capacity: req.body?.capacity ?? null,
    });
    res.status(201).json(created);
  });

  router.put('/sections/:id', (req, res) => {
    const db = dbProvider();
    const sectionId = parsePositiveInt(req.params.id, 'الشعبة');
    const updated = updateSection(db, sectionId, {
      name: String(req.body?.name ?? ''),
      capacity: req.body?.capacity ?? null,
    });
    res.json(updated);
  });

  router.delete('/sections/:id', (req, res) => {
    const db = dbProvider();
    const sectionId = parsePositiveInt(req.params.id, 'الشعبة');
    deleteSection(db, sectionId);
    res.json({ deleted: true });
  });

  // Excel Unified Template & Bulk Import (must come before /students/:id)
  router.get('/students/excel-template', async (req, res, next) => {
    try {
      const db = dbProvider();
      const yearId = parseOptionalInt(req.query.academic_year_id);
      const buffer = await generateUnifiedExcelTemplate(db, yearId);
      const encodedName = encodeURIComponent('قالب_استيراد_الطلاب_الموحد.xlsx');
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  });

  router.post('/students/excel-upload', async (req, res, next) => {
    try {
      const db = dbProvider();
      const fileBase64 = String(req.body?.fileBase64 ?? '');
      if (!fileBase64) {
        throw new ServiceError('يرجى إرفاق ملف Excel صالح.', 400);
      }
      const cleanBase64 = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64;
      const buffer = Buffer.from(cleanBase64, 'base64');
      if (buffer.length === 0 || buffer.length > 15 * 1024 * 1024) {
        throw new ServiceError('حجم ملف Excel غير صالح أو يتجاوز الحد المسموح (15 ميغابايت).', 400);
      }
      const parsedRows = await parseExcelBufferToRows(buffer);
      const yearId = parseOptionalInt(req.body?.academic_year_id);
      const result = validateExcelRows(db, parsedRows, yearId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/students/excel-validate', (req, res) => {
    const db = dbProvider();
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const yearId = parseOptionalInt(req.body?.academic_year_id);
    const result = validateExcelRows(db, rows, yearId);
    res.json(result);
  });

  router.post('/students/excel-commit', (req, res) => {
    const db = dbProvider();
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const yearId = parseOptionalInt(req.body?.academic_year_id);
    const result = commitExcelStudents(db, rows, yearId);
    res.status(201).json(result);
  });

  // Students CRUD & Transfer
  router.get('/students', (req, res) => {
    const db = dbProvider();
    const sortBy = req.query.sort_by as
      | 'full_name'
      | 'registry_number'
      | 'grade_name'
      | 'enrollment_date'
      | 'created_at'
      | undefined;
    const sortDir = req.query.sort_dir === 'desc' ? 'desc' : 'asc';
    const status = req.query.status as
      | 'active'
      | 'transferred_out'
      | 'graduated'
      | 'archived'
      | 'all'
      | undefined;

    const students = listStudents(db, {
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      grade_id: parseOptionalInt(req.query.grade_id) ?? null,
      section_id: parseOptionalInt(req.query.section_id) ?? null,
      academic_year_id: parseOptionalInt(req.query.academic_year_id) ?? null,
      status: status ?? 'active',
      sort_by: sortBy,
      sort_dir: sortDir,
    });
    res.json(students);
  });

  router.get('/students/:id', (req, res) => {
    const db = dbProvider();
    const id = parsePositiveInt(req.params.id, 'الطالب');
    const yearId = parseOptionalInt(req.query.academic_year_id);
    res.json(getStudentById(db, id, yearId));
  });

  router.post('/students', (req, res) => {
    const db = dbProvider();
    const created = createStudent(db, {
      full_name: String(req.body?.full_name ?? ''),
      grade_id: parsePositiveInt(String(req.body?.grade_id ?? ''), 'الصف'),
      section_id: parsePositiveInt(String(req.body?.section_id ?? ''), 'الشعبة'),
      registry_number: req.body?.registry_number ?? null,
      birth_date: req.body?.birth_date ?? null,
      phone: req.body?.phone ?? null,
      photo_data: req.body?.photo_data ?? null,
      academic_year_id: parseOptionalInt(req.body?.academic_year_id),
      enrollment_date: req.body?.enrollment_date ?? null,
    });
    res.status(201).json(created);
  });

  router.put('/students/:id', (req, res) => {
    const db = dbProvider();
    const id = parsePositiveInt(req.params.id, 'الطالب');
    const updated = updateStudent(db, id, {
      full_name: String(req.body?.full_name ?? ''),
      registry_number: req.body?.registry_number ?? null,
      birth_date: req.body?.birth_date ?? null,
      phone: req.body?.phone ?? null,
      photo_data: req.body?.photo_data ?? null,
      status: req.body?.status,
    });
    res.json(updated);
  });

  router.post('/students/:id/transfer', (req, res) => {
    const db = dbProvider();
    const id = parsePositiveInt(req.params.id, 'الطالب');
    const transferred = transferStudent(db, id, {
      grade_id: parsePositiveInt(String(req.body?.grade_id ?? ''), 'الصف'),
      section_id: parsePositiveInt(String(req.body?.section_id ?? ''), 'الشعبة'),
      academic_year_id: parseOptionalInt(req.body?.academic_year_id),
      transfer_reason: req.body?.transfer_reason ?? null,
      enrollment_date: req.body?.enrollment_date ?? null,
    });
    res.json(transferred);
  });

  router.get('/students/:id/history', (req, res) => {
    const db = dbProvider();
    const id = parsePositiveInt(req.params.id, 'الطالب');
    res.json(getStudentEnrollmentHistory(db, id));
  });

  router.delete('/students/:id', (req, res) => {
    const db = dbProvider();
    const id = parsePositiveInt(req.params.id, 'الطالب');
    deleteStudent(db, id);
    res.json({ deleted: true });
  });

  // Absences & Attendance Recording
  router.get('/absences/sheet', (req, res) => {
    const db = dbProvider();
    const yearId = parseOptionalInt(req.query.academic_year_id);
    const gradeId = parsePositiveInt(String(req.query.grade_id ?? ''), 'الصف');
    const sectionId = parsePositiveInt(String(req.query.section_id ?? ''), 'الشعبة');
    const attendanceDate = String(req.query.attendance_date ?? '');
    res.json(
      getSectionAttendanceSheet(db, {
        academic_year_id: yearId,
        grade_id: gradeId,
        section_id: sectionId,
        attendance_date: attendanceDate,
      })
    );
  });

  router.post('/absences/sheet', (req, res) => {
    const db = dbProvider();
    const yearId = parsePositiveInt(String(req.body?.academic_year_id ?? ''), 'السنة الدراسية');
    const gradeId = parsePositiveInt(String(req.body?.grade_id ?? ''), 'الصف');
    const sectionId = parsePositiveInt(String(req.body?.section_id ?? ''), 'الشعبة');
    const attendanceDate = String(req.body?.attendance_date ?? '');
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    const result = saveSectionAttendance(db, {
      academic_year_id: yearId,
      grade_id: gradeId,
      section_id: sectionId,
      attendance_date: attendanceDate,
      entries,
    });
    res.json(result);
  });

  router.post('/absences/record', (req, res) => {
    const db = dbProvider();
    const studentId = parsePositiveInt(String(req.body?.student_id ?? ''), 'الطالب');
    const created = createSingleAbsenceRecord(db, {
      student_id: studentId,
      academic_year_id: parseOptionalInt(req.body?.academic_year_id),
      absence_date: String(req.body?.absence_date ?? ''),
      status: req.body?.status,
      lessons_count:
        req.body?.lessons_count !== undefined ? Number(req.body.lessons_count) : undefined,
      notes: req.body?.notes ?? null,
    });
    res.status(201).json(created);
  });

  router.delete('/absences/record/:id', (req, res) => {
    const db = dbProvider();
    const id = parsePositiveInt(req.params.id, 'سجل الغياب');
    deleteAbsenceRecord(db, id);
    res.json({ deleted: true });
  });

  router.get('/absences/student/:id', (req, res) => {
    const db = dbProvider();
    const id = parsePositiveInt(req.params.id, 'الطالب');
    const yearId = parseOptionalInt(req.query.academic_year_id);
    res.json(getStudentAbsenceDetails(db, id, yearId));
  });

  // Error handler
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ServiceError) {
      res.status(err.statusCode).json({ error: err.message, code: err.code });
      return;
    }

    const sqliteErr = err as { code?: string; message?: string };
    if (sqliteErr?.code?.startsWith('SQLITE_CONSTRAINT')) {
      res.status(409).json({
        error: 'تعذر تنفيذ العملية بسبب تعارض في قيود البيانات أو تكرار قيمة فريدة.',
        code: sqliteErr.code,
      });
      return;
    }

    console.error('Unhandled API Error:', err);
    res.status(500).json({
      error: 'حدث خطأ داخلي في الخادم أثناء معالجة الطلب.',
      code: 'INTERNAL_ERROR',
    });
  });

  return router;
}
