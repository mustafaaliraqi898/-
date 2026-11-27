import express, { type NextFunction, type Request, type Response } from 'express';
import { getDb, type SqliteDb } from '../db/connection';
import {
  addStudentLessonRecords,
  createSingleAbsenceRecord,
  deleteAbsenceRecord,
  getSectionAttendanceSheet,
  getStudentAbsenceDetails,
  saveSectionAttendance,
} from '../services/absenceService';
import {
  listAbsenceStages,
  createAbsenceStage,
  updateAbsenceStage,
  deleteAbsenceStage,
  getDynamicStageReport,
  issueOfficialLetter,
  listIssuedLetters,
} from '../services/absenceStagesService';
import {
  generateIssuedLetterDocumentHtml,
  generateStageReportDocumentHtml,
  renderHtmlToPdfBuffer,
} from '../services/pdfService';
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
  updateGradeStage,
  updateSection,
} from '../services/gradeService';
import {
  createHoliday,
  deleteHoliday,
  getMonthHolidayCalendar,
  getWeeklyHolidaySettings,
  listHolidays,
  resolveDateHolidayStatus,
  updateHoliday,
  updateWeeklyHolidays,
} from '../services/holidayService';
import {
  getSimplifiedAbsenceThresholds,
  updateSimplifiedAbsenceThresholds,
} from '../services/legalRegulationsService';
import {
  deleteMonthlyStudentNote,
  generateMonthlyRegisterExcel,
  getMonthlyAbsenceRegister,
  saveMonthlyStudentNote,
} from '../services/monthlyRegisterService';
import {
  generateSimplifiedReportsExcel,
  getSimplifiedAbsenceReports,
} from '../services/reportsCenterService';
import {
  createAcademicYear,
  getActiveAcademicYear,
  getSchoolSettings,
  listAcademicYears,
  setActiveAcademicYear,
  updateSchoolSettings,
  updateUnifiedLetterTemplate,
} from '../services/settingsService';
import {
  createManagedBackup,
  createVerifiedBackupBuffer,
  getBackupOverview,
  getBackupRecordFile,
  restoreDatabaseBackupBuffer,
  runAutoBackupIfDue,
  updateBackupSettings,
} from '../services/backupService';
import {
  generateAuditLogsExcel,
  listAuditLogs,
  recordAuditLog,
} from '../services/auditLogService';
import type { AuditOperationType, AuditSectionType } from '../../src/types/school';
import {
  decodeBase64DataUrl,
  getMediaAssetBlob,
  getMediaAssetMetaById,
  processAndStoreImage,
  resolveMediaAssetDataUrl,
} from '../services/imageService';
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
      principal_name:
        req.body?.principal_name !== undefined ? req.body.principal_name : undefined,
      lessons_per_absence_day:
        req.body?.lessons_per_absence_day !== undefined
          ? Number(req.body.lessons_per_absence_day)
          : undefined,
      daily_lessons_count:
        req.body?.daily_lessons_count !== undefined
          ? Number(req.body.daily_lessons_count)
          : undefined,
      daily_permission_counts_as_absence:
        req.body?.daily_permission_counts_as_absence !== undefined
          ? req.body.daily_permission_counts_as_absence
          : undefined,
      lesson_permission_counts_as_absence:
        req.body?.lesson_permission_counts_as_absence !== undefined
          ? req.body.lesson_permission_counts_as_absence
          : undefined,
      number_display_mode:
        req.body?.number_display_mode !== undefined ? req.body.number_display_mode : undefined,
      unified_letter_template:
        req.body?.unified_letter_template !== undefined
          ? String(req.body.unified_letter_template)
          : undefined,
      school_logo_data:
        req.body?.school_logo_data !== undefined ? req.body.school_logo_data : undefined,
      school_logo_asset_id:
        req.body?.school_logo_asset_id !== undefined
          ? parseOptionalInt(req.body.school_logo_asset_id) ?? null
          : undefined,
    });
    res.json(updated);
  });

  router.put('/settings/unified-letter-template', (req, res) => {
    const db = dbProvider();
    const updated = updateUnifiedLetterTemplate(
      db,
      String(req.body?.unified_letter_template ?? '')
    );
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
    const gradeId = parseOptionalInt(req.query.grade_id);
    const stageId = parseOptionalInt(req.query.stage_id);
    res.json(getDashboardStats(db, yearId, { gradeId, stageId }));
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
      stage: req.body?.stage !== undefined ? req.body.stage : undefined,
      initial_sections: initialSections,
    });
    res.status(201).json(created);
  });

  router.put('/grades/:id', (req, res) => {
    const db = dbProvider();
    const id = parsePositiveInt(req.params.id, 'الصف');
    const updated = updateGrade(db, id, {
      name: String(req.body?.name ?? ''),
      stage: req.body?.stage !== undefined ? req.body.stage : undefined,
    });
    res.json(updated);
  });

  router.patch('/grades/:id/stage', (req, res) => {
    const db = dbProvider();
    const id = parsePositiveInt(req.params.id, 'الصف');
    const updated = updateGradeStage(db, id, req.body?.stage ?? null);
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
      photo_asset_id: parseOptionalInt(req.body?.photo_asset_id) ?? null,
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
      photo_asset_id: parseOptionalInt(req.body?.photo_asset_id) ?? null,
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
      leave_type: req.body?.leave_type ?? null,
      lesson_numbers: Array.isArray(req.body?.lesson_numbers) ? req.body.lesson_numbers : undefined,
      lesson_details: Array.isArray(req.body?.lesson_details) ? req.body.lesson_details : undefined,
      notes: req.body?.notes ?? null,
    });
    res.status(201).json(created);
  });

  router.post('/absences/lessons', (req, res) => {
    const db = dbProvider();
    const studentId = parsePositiveInt(String(req.body?.student_id ?? ''), 'الطالب');
    const saved = addStudentLessonRecords(db, {
      student_id: studentId,
      academic_year_id: parseOptionalInt(req.body?.academic_year_id),
      absence_date: String(req.body?.absence_date ?? ''),
      lesson_details: Array.isArray(req.body?.lesson_details) ? req.body.lesson_details : [],
      notes: req.body?.notes ?? null,
    });
    res.status(201).json(saved);
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

  // Holidays & Weekly Holidays
  router.get('/holidays/weekly', (_req, res) => {
    const db = dbProvider();
    res.json(getWeeklyHolidaySettings(db));
  });

  router.put('/holidays/weekly', (req, res) => {
    const db = dbProvider();
    const holidayDays = Array.isArray(req.body?.holiday_days)
      ? req.body.holiday_days.map(Number)
      : [];
    const result = updateWeeklyHolidays(db, {
      holiday_days: holidayDays,
      reason: req.body?.reason !== undefined ? String(req.body.reason) : undefined,
    });
    res.json(result);
  });

  router.get('/holidays/check', (req, res) => {
    const db = dbProvider();
    const dateStr = String(req.query.date ?? '');
    res.json(resolveDateHolidayStatus(db, dateStr));
  });

  router.get('/holidays/month', (req, res) => {
    const db = dbProvider();
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    res.json(getMonthHolidayCalendar(db, year, month));
  });

  router.get('/holidays', (req, res) => {
    const db = dbProvider();
    const yearId = parseOptionalInt(req.query.academic_year_id);
    res.json(listHolidays(db, yearId));
  });

  router.post('/holidays', (req, res) => {
    const db = dbProvider();
    const result = createHoliday(db, {
      academic_year_id: parseOptionalInt(req.body?.academic_year_id) ?? null,
      name: String(req.body?.name ?? ''),
      start_date: String(req.body?.start_date ?? ''),
      end_date: String(req.body?.end_date ?? ''),
      holiday_type: req.body?.holiday_type,
      notes: req.body?.notes ?? null,
    });
    res.status(201).json(result);
  });

  router.put('/holidays/:id', (req, res) => {
    const db = dbProvider();
    const id = parsePositiveInt(req.params.id, 'العطلة');
    const result = updateHoliday(db, id, {
      academic_year_id: parseOptionalInt(req.body?.academic_year_id) ?? null,
      name: String(req.body?.name ?? ''),
      start_date: String(req.body?.start_date ?? ''),
      end_date: String(req.body?.end_date ?? ''),
      holiday_type: req.body?.holiday_type,
      notes: req.body?.notes ?? null,
    });
    res.json(result);
  });

  router.delete('/holidays/:id', (req, res) => {
    const db = dbProvider();
    const id = parsePositiveInt(req.params.id, 'العطلة');
    deleteHoliday(db, id);
    res.json({ deleted: true });
  });

  // Monthly Absence Register
  router.get('/monthly/register', (req, res) => {
    const db = dbProvider();
    const academicYearId = parseOptionalInt(req.query.academic_year_id);
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const gradeId = parsePositiveInt(String(req.query.grade_id ?? ''), 'الصف');
    const sectionId = parsePositiveInt(String(req.query.section_id ?? ''), 'الشعبة');
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const sortMode = req.query.sort_mode === 'alphabetical' ? 'alphabetical' : 'original';

    res.json(
      getMonthlyAbsenceRegister(db, {
        academic_year_id: academicYearId,
        year,
        month,
        grade_id: gradeId,
        section_id: sectionId,
        search,
        sort_mode: sortMode,
      })
    );
  });

  router.put('/monthly/note', (req, res) => {
    const db = dbProvider();
    const academicYearId = parsePositiveInt(
      String(req.body?.academic_year_id ?? ''),
      'السنة الدراسية'
    );
    const studentId = parsePositiveInt(String(req.body?.student_id ?? ''), 'الطالب');
    const year = Number(req.body?.year);
    const month = Number(req.body?.month);
    const noteText = String(req.body?.note_text ?? '');

    const saved = saveMonthlyStudentNote(db, {
      academic_year_id: academicYearId,
      student_id: studentId,
      year,
      month,
      note_text: noteText,
    });
    res.json(saved);
  });

  router.delete('/monthly/note', (req, res) => {
    const db = dbProvider();
    const academicYearId = parsePositiveInt(
      String(req.query.academic_year_id ?? req.body?.academic_year_id ?? ''),
      'السنة الدراسية'
    );
    const studentId = parsePositiveInt(
      String(req.query.student_id ?? req.body?.student_id ?? ''),
      'الطالب'
    );
    const year = Number(req.query.year ?? req.body?.year);
    const month = Number(req.query.month ?? req.body?.month);

    deleteMonthlyStudentNote(db, {
      academic_year_id: academicYearId,
      student_id: studentId,
      year,
      month,
    });
    res.json({ deleted: true });
  });

  router.get('/monthly/export', async (req, res, next) => {
    try {
      const db = dbProvider();
      const academicYearId = parseOptionalInt(req.query.academic_year_id);
      const year = Number(req.query.year);
      const month = Number(req.query.month);
      const gradeId = parsePositiveInt(String(req.query.grade_id ?? ''), 'الصف');
      const sectionId = parsePositiveInt(String(req.query.section_id ?? ''), 'الشعبة');
      const sortMode = req.query.sort_mode === 'alphabetical' ? 'alphabetical' : 'original';

      const { buffer, filename } = await generateMonthlyRegisterExcel(db, {
        academic_year_id: academicYearId,
        year,
        month,
        grade_id: gradeId,
        section_id: sectionId,
        sort_mode: sortMode,
      });

      const encodedName = encodeURIComponent(filename);
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

  // Simplified Absence Thresholds & Effective Limit (Preparatory)
  router.get('/absence-thresholds', (req, res) => {
    const db = dbProvider();
    const yearId = parseOptionalInt(req.query.academic_year_id);
    res.json(getSimplifiedAbsenceThresholds(db, yearId));
  });

  router.put('/absence-thresholds', (req, res) => {
    const db = dbProvider();
    const updated = updateSimplifiedAbsenceThresholds(db, {
      warning_days: Number(req.body?.warning_days),
      preliminary_warning_days: Number(req.body?.preliminary_warning_days),
      final_warning_days: Number(req.body?.final_warning_days),
      effective_absence_limit: Number(req.body?.effective_absence_limit),
      academic_year_id: parseOptionalInt(req.body?.academic_year_id),
    });
    res.json(updated);
  });

  // Dynamic Absence Stages & Official Letters API
  router.get('/absence-stages', (req, res, next) => {
    try {
      const db = dbProvider();
      const yearId = parseOptionalInt(req.query.academic_year_id) ?? getActiveAcademicYear(db).id;
      res.json(listAbsenceStages(db, yearId));
    } catch (err) {
      next(err);
    }
  });

  router.post('/absence-stages', (req, res, next) => {
    try {
      const db = dbProvider();
      const stage = createAbsenceStage(db, {
        academic_year_id: parseOptionalInt(req.body?.academic_year_id),
        name: String(req.body?.name ?? ''),
        days_threshold: Number(req.body?.days_threshold ?? 0),
        letter_template: String(req.body?.letter_template ?? ''),
      });
      res.json(stage);
    } catch (err) {
      next(err);
    }
  });

  router.put('/absence-stages/:id', (req, res, next) => {
    try {
      const db = dbProvider();
      const stageId = Number(req.params.id);
      const stage = updateAbsenceStage(db, stageId, {
        name: String(req.body?.name ?? ''),
        days_threshold: Number(req.body?.days_threshold ?? 0),
        letter_template: String(req.body?.letter_template ?? ''),
      });
      res.json(stage);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/absence-stages/:id', (req, res, next) => {
    try {
      const db = dbProvider();
      const stageId = Number(req.params.id);
      res.json(deleteAbsenceStage(db, stageId));
    } catch (err) {
      next(err);
    }
  });

  router.get('/absence-stages/report', (req, res, next) => {
    try {
      const db = dbProvider();
      const report = getDynamicStageReport(db, {
        academic_year_id: parseOptionalInt(req.query.academic_year_id),
        stage_id: parseOptionalInt(req.query.stage_id),
        grade_id: parseOptionalInt(req.query.grade_id),
        section_id: parseOptionalInt(req.query.section_id),
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
      });
      res.json(report);
    } catch (err) {
      next(err);
    }
  });

  router.post('/absence-stages/issue-letter', (req, res, next) => {
    try {
      const db = dbProvider();
      const letter = issueOfficialLetter(db, {
        academic_year_id: Number(req.body?.academic_year_id),
        stage_id: Number(req.body?.stage_id),
        document_number: String(req.body?.document_number ?? ''),
        letter_date: String(req.body?.letter_date ?? ''),
        subject: typeof req.body?.subject === 'string' ? req.body.subject : undefined,
        custom_body: typeof req.body?.custom_body === 'string' ? req.body.custom_body : undefined,
        grade_id: parseOptionalInt(req.body?.grade_id),
        section_id: parseOptionalInt(req.body?.section_id),
        search: typeof req.body?.search === 'string' ? req.body?.search : undefined,
      });
      res.json(letter);
    } catch (err) {
      next(err);
    }
  });

  router.get('/absence-stages/issued-letters', (req, res, next) => {
    try {
      const db = dbProvider();
      const academicYearId = Number(req.query.academic_year_id);
      res.json(listIssuedLetters(db, academicYearId));
    } catch (err) {
      next(err);
    }
  });

  router.get('/absence-stages/report/pdf', async (req, res, next) => {
    try {
      const db = dbProvider();
      const { html, filename } = await generateStageReportDocumentHtml(db, {
        academic_year_id: parseOptionalInt(req.query.academic_year_id),
        stage_id: parseOptionalInt(req.query.stage_id),
        grade_id: parseOptionalInt(req.query.grade_id),
        section_id: parseOptionalInt(req.query.section_id),
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
      });
      const pdfBuffer = await renderHtmlToPdfBuffer(html);
      const encodedName = encodeURIComponent(filename);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
      res.setHeader('Content-Length', String(pdfBuffer.length));
      res.send(pdfBuffer);
    } catch (err) {
      next(err);
    }
  });

  router.get('/absence-stages/issued-letters/:id/pdf', async (req, res, next) => {
    try {
      const db = dbProvider();
      const letterId = parsePositiveInt(req.params.id, 'الكتاب الرسمي');
      const { html, filename } = await generateIssuedLetterDocumentHtml(db, letterId);
      const pdfBuffer = await renderHtmlToPdfBuffer(html);
      const encodedName = encodeURIComponent(filename);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
      res.setHeader('Content-Length', String(pdfBuffer.length));
      res.send(pdfBuffer);
    } catch (err) {
      next(err);
    }
  });

  // Simplified 4 Absence Warning & Limit Reports (Single Source of Truth from Absences)
  router.get('/reports/absences', (req, res) => {
    const db = dbProvider();
    const academicYearId = parseOptionalInt(req.query.academic_year_id);
    const reportType = String(req.query.report_type ?? 'warning') as Parameters<
      typeof getSimplifiedAbsenceReports
    >[1]['report_type'];
    const gradeId = parseOptionalInt(req.query.grade_id);
    const sectionId = parseOptionalInt(req.query.section_id);
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    res.json(
      getSimplifiedAbsenceReports(db, {
        academic_year_id: academicYearId,
        report_type: reportType,
        grade_id: gradeId,
        section_id: sectionId,
        search,
      })
    );
  });

  router.get('/reports/absences/export', async (req, res, next) => {
    try {
      const db = dbProvider();
      const academicYearId = parseOptionalInt(req.query.academic_year_id);
      const reportType = String(req.query.report_type ?? 'warning') as Parameters<
        typeof getSimplifiedAbsenceReports
      >[1]['report_type'];
      const gradeId = parseOptionalInt(req.query.grade_id);
      const sectionId = parseOptionalInt(req.query.section_id);
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;

      const { buffer, filename } = await generateSimplifiedReportsExcel(db, {
        academic_year_id: academicYearId,
        report_type: reportType,
        grade_id: gradeId,
        section_id: sectionId,
        search,
      });

      const encodedName = encodeURIComponent(filename);
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

  // Centralized Media Processing, Storage, Serving & Compatibility Routes
  router.post(
    '/media/upload',
    express.raw({
      type: ['image/*', 'application/octet-stream'],
      limit: '100mb',
    }),
    async (req, res, next) => {
      try {
        const db = dbProvider();
        let buffer: Buffer | null = null;
        let filename: string | null = null;
        let category: string | null = null;
        let mimeHint: string | null = null;

        if (Buffer.isBuffer(req.body)) {
          buffer = req.body;
          const rawHeaderName = req.header('x-image-filename');
          if (rawHeaderName) {
            try {
              filename = decodeURIComponent(rawHeaderName);
            } catch {
              filename = rawHeaderName;
            }
          }
          category = req.header('x-image-category') ?? null;
          mimeHint = req.header('x-image-mime') ?? req.header('content-type') ?? null;
        } else if (req.body && typeof req.body === 'object' && typeof req.body.dataUrl === 'string') {
          const decoded = decodeBase64DataUrl(req.body.dataUrl);
          if (!decoded) {
            throw new ServiceError('بيانات الصورة غير صالحة.', 400, 'INVALID_IMAGE');
          }
          buffer = decoded.buffer;
          mimeHint = decoded.mime;
          filename = typeof req.body.filename === 'string' ? req.body.filename : null;
          category = typeof req.body.category === 'string' ? req.body.category : null;
        }

        if (!buffer || buffer.length === 0) {
          throw new ServiceError('لم يتم استلام بيانات الصورة.', 400, 'EMPTY_IMAGE');
        }

        const asset = await processAndStoreImage(db, buffer, {
          filename,
          category,
          mimeHint,
        });
        res.status(asset.deduplicated ? 200 : 201).json(asset);
      } catch (err) {
        next(err);
      }
    }
  );

  router.get('/media/:id/meta', (req, res) => {
    const db = dbProvider();
    const id = parsePositiveInt(req.params.id, 'الصورة');
    res.json(getMediaAssetMetaById(db, id));
  });

  router.get('/media/:id/compat-data-url', async (req, res, next) => {
    try {
      const db = dbProvider();
      const id = parsePositiveInt(req.params.id, 'الصورة');
      const dataUrl = await resolveMediaAssetDataUrl(db, id, 'compat');
      res.json({ data_url: dataUrl });
    } catch (err) {
      next(err);
    }
  });

  router.get('/media/:id/:variant(optimized|original|compat)', async (req, res, next) => {
    try {
      const db = dbProvider();
      const id = parsePositiveInt(req.params.id, 'الصورة');
      let variant = req.params.variant as 'optimized' | 'original' | 'compat';

      // Automatic fallback to PNG/JPEG if client explicitly states it does not accept WebP
      const acceptHeader = String(req.header('accept') ?? '');
      const forceCompat = req.query.compat === '1' || req.query.compat === 'true';
      if (
        variant === 'optimized' &&
        (forceCompat ||
          (acceptHeader.includes('image/') &&
            !acceptHeader.includes('*/*') &&
            !acceptHeader.includes('image/webp')))
      ) {
        variant = 'compat';
      }

      const preferFormat =
        req.query.format === 'png' || req.query.format === 'jpeg'
          ? (req.query.format as 'png' | 'jpeg')
          : undefined;

      const asset = await getMediaAssetBlob(db, id, variant, preferFormat);
      res.setHeader('Content-Type', asset.mime);
      res.setHeader('Content-Length', String(asset.buffer.length));
      res.setHeader('ETag', `"${asset.sha256}"`);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (asset.mime === 'image/svg+xml') {
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
      }
      res.send(asset.buffer);
    } catch (err) {
      next(err);
    }
  });

  // SQLite Backup & Restore (Preserves all data + media originals and optimized versions)
  router.get('/backup/overview', (_req, res) => {
    const db = dbProvider();
    res.json(getBackupOverview(db));
  });

  router.put('/backup/settings', (req, res) => {
    const db = dbProvider();
    const updated = updateBackupSettings(db, {
      auto_enabled: req.body?.auto_enabled,
      frequency: req.body?.frequency === 'weekly' ? 'weekly' : 'daily',
      retention_count: Number(req.body?.retention_count ?? 7),
      backup_dir: req.body?.backup_dir !== undefined ? req.body.backup_dir : null,
    });
    res.json(updated);
  });

  router.post('/backup/create', async (_req, res, next) => {
    try {
      const db = dbProvider();
      const result = await createManagedBackup(db, 'manual');
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/backup/run-auto', async (req, res, next) => {
    try {
      const db = dbProvider();
      const result = await runAutoBackupIfDue(db, { force: Boolean(req.body?.force) });
      res.json({
        executed: Boolean(result),
        result,
        overview: getBackupOverview(db),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/backup/records/:id/download', (req, res, next) => {
    try {
      const db = dbProvider();
      const id = parsePositiveInt(req.params.id, 'النسخة الاحتياطية');
      const { filePath, filename } = getBackupRecordFile(db, id);
      const encodedName = encodeURIComponent(filename);
      res.setHeader('Content-Type', 'application/x-sqlite3');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
      res.sendFile(filePath);
    } catch (err) {
      next(err);
    }
  });

  router.get('/backup/export', async (_req, res, next) => {
    try {
      const db = dbProvider();
      const { buffer, integrity_status, filename } = await createVerifiedBackupBuffer(db);
      recordAuditLog(db, {
        operation_type: 'backup',
        section: 'backup',
        description: `تصدير نسخة احتياطية يدوية (${filename})`,
        target_label: filename,
        new_value: {
          filename,
          size_bytes: buffer.length,
          integrity_status,
        },
      });
      const encodedName = encodeURIComponent(filename);
      res.setHeader('Content-Type', 'application/x-sqlite3');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
      res.setHeader('Content-Length', String(buffer.length));
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/backup/restore',
    express.raw({
      type: ['application/octet-stream', 'application/x-sqlite3', '*/*'],
      limit: '250mb',
    }),
    async (req, res, next) => {
      try {
        const db = dbProvider();
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          throw new ServiceError('يرجى إرفاق ملف نسخة احتياطية صالح.', 400, 'INVALID_BACKUP');
        }
        const result = await restoreDatabaseBackupBuffer(db, req.body);
        res.json({
          restored: true,
          media_assets_count: result.media_assets_count,
          students_count: result.students_count,
          pre_restore_backup_filename: result.pre_restore_backup_filename,
          integrity_status: result.integrity_status,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Append-Only Audit Log (Read & Export ONLY — no update or delete endpoints)
  router.get('/audit-logs', (req, res) => {
    const db = dbProvider();
    const result = listAuditLogs(db, {
      operation_type:
        typeof req.query.operation_type === 'string'
          ? (req.query.operation_type as AuditOperationType | 'all')
          : undefined,
      section:
        typeof req.query.section === 'string'
          ? (req.query.section as AuditSectionType | 'all')
          : undefined,
      actor_name: typeof req.query.actor_name === 'string' ? req.query.actor_name : undefined,
      date_from: typeof req.query.date_from === 'string' ? req.query.date_from : undefined,
      date_to: typeof req.query.date_to === 'string' ? req.query.date_to : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      limit: parseOptionalInt(req.query.limit),
      offset:
        req.query.offset !== undefined && req.query.offset !== ''
          ? Math.max(0, Number(req.query.offset) || 0)
          : undefined,
    });
    res.json(result);
  });

  router.get('/audit-logs/export', async (req, res, next) => {
    try {
      const db = dbProvider();
      const { buffer, filename } = await generateAuditLogsExcel(db, {
        operation_type:
          typeof req.query.operation_type === 'string'
            ? (req.query.operation_type as AuditOperationType | 'all')
            : undefined,
        section:
          typeof req.query.section === 'string'
            ? (req.query.section as AuditSectionType | 'all')
            : undefined,
        actor_name: typeof req.query.actor_name === 'string' ? req.query.actor_name : undefined,
        date_from: typeof req.query.date_from === 'string' ? req.query.date_from : undefined,
        date_to: typeof req.query.date_to === 'string' ? req.query.date_to : undefined,
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
      });
      const encodedName = encodeURIComponent(filename);
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
