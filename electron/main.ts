/// <reference path="./electron.d.ts" />
import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { closeDb, createDatabaseConnection, setDbInstance, getDb } from '../server/db/connection';
import {
  addStudentLessonRecords,
  createSingleAbsenceRecord,
  deleteAbsenceRecord,
  getSectionAttendanceSheet,
  getStudentAbsenceDetails,
  saveSectionAttendance,
} from '../server/services/absenceService';
import { getDashboardStats } from '../server/services/dashboardService';
import {
  commitExcelStudents,
  generateUnifiedExcelTemplate,
  parseExcelBufferToRows,
  validateExcelRows,
} from '../server/services/excelService';
import {
  createGrade,
  createSections,
  deleteGrade,
  deleteSection,
  listGradesWithSections,
  updateGrade,
  updateSection,
} from '../server/services/gradeService';
import {
  createHoliday,
  deleteHoliday,
  getMonthHolidayCalendar,
  getWeeklyHolidaySettings,
  listHolidays,
  resolveDateHolidayStatus,
  updateHoliday,
  updateWeeklyHolidays,
} from '../server/services/holidayService';
import {
  deleteMonthlyStudentNote,
  generateMonthlyRegisterExcel,
  getMonthlyAbsenceRegister,
  saveMonthlyStudentNote,
} from '../server/services/monthlyRegisterService';
import {
  createAcademicYear,
  getSchoolSettings,
  listAcademicYears,
  setActiveAcademicYear,
  updateSchoolSettings,
} from '../server/services/settingsService';
import {
  createStudent,
  deleteStudent,
  getStudentById,
  getStudentEnrollmentHistory,
  listStudents,
  transferStudent,
  updateStudent,
} from '../server/services/studentService';

let mainWindow: BrowserWindow | null = null;

function registerIpcHandlers() {
  const wrap =
    <TArgs, TResult>(handler: (args: TArgs) => TResult | Promise<TResult>) =>
    async (_event: unknown, args: unknown) => {
      try {
        return { ok: true, data: await handler(args as TArgs) };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'حدث خطأ غير متوقع.';
        return { ok: false, error: message };
      }
    };

  ipcMain.handle('settings:get', wrap(() => getSchoolSettings(getDb())));
  ipcMain.handle(
    'settings:update',
    wrap(
      (payload: {
        school_name: string;
        directorate_name: string;
        lessons_per_absence_day?: number;
        daily_lessons_count?: number;
        daily_permission_counts_as_absence?: number | boolean;
        lesson_permission_counts_as_absence?: number | boolean;
      }) => updateSchoolSettings(getDb(), payload)
    )
  );
  ipcMain.handle('academic-years:list', wrap(() => listAcademicYears(getDb())));
  ipcMain.handle(
    'academic-years:create',
    wrap((payload: { name: string; set_active?: boolean }) => createAcademicYear(getDb(), payload))
  );
  ipcMain.handle(
    'academic-years:activate',
    wrap((payload: { id: number }) => setActiveAcademicYear(getDb(), payload.id))
  );

  ipcMain.handle(
    'dashboard:stats',
    wrap((payload?: { academic_year_id?: number }) =>
      getDashboardStats(getDb(), payload?.academic_year_id)
    )
  );

  ipcMain.handle(
    'grades:list',
    wrap((payload?: { academic_year_id?: number }) =>
      listGradesWithSections(getDb(), payload?.academic_year_id)
    )
  );
  ipcMain.handle(
    'grades:create',
    wrap((payload: { name: string; initial_sections?: string[] }) =>
      createGrade(getDb(), payload)
    )
  );
  ipcMain.handle(
    'grades:update',
    wrap((payload: { id: number; name: string }) =>
      updateGrade(getDb(), payload.id, { name: payload.name })
    )
  );
  ipcMain.handle(
    'grades:delete',
    wrap((payload: { id: number }) => {
      deleteGrade(getDb(), payload.id);
      return { deleted: true };
    })
  );

  ipcMain.handle(
    'sections:create',
    wrap((payload: { grade_id: number; names: string[]; capacity?: number | null }) =>
      createSections(getDb(), payload.grade_id, {
        names: payload.names,
        capacity: payload.capacity,
      })
    )
  );
  ipcMain.handle(
    'sections:update',
    wrap((payload: { id: number; name: string; capacity?: number | null }) =>
      updateSection(getDb(), payload.id, { name: payload.name, capacity: payload.capacity })
    )
  );
  ipcMain.handle(
    'sections:delete',
    wrap((payload: { id: number }) => {
      deleteSection(getDb(), payload.id);
      return { deleted: true };
    })
  );

  ipcMain.handle(
    'students:list',
    wrap((query: Parameters<typeof listStudents>[1]) => listStudents(getDb(), query))
  );
  ipcMain.handle(
    'students:get',
    wrap((payload: { id: number; academic_year_id?: number }) =>
      getStudentById(getDb(), payload.id, payload.academic_year_id)
    )
  );
  ipcMain.handle(
    'students:create',
    wrap((payload: Parameters<typeof createStudent>[1]) => createStudent(getDb(), payload))
  );
  ipcMain.handle(
    'students:update',
    wrap((payload: { id: number } & Parameters<typeof updateStudent>[2]) =>
      updateStudent(getDb(), payload.id, payload)
    )
  );
  ipcMain.handle(
    'students:transfer',
    wrap((payload: { id: number } & Parameters<typeof transferStudent>[2]) =>
      transferStudent(getDb(), payload.id, payload)
    )
  );
  ipcMain.handle(
    'students:history',
    wrap((payload: { id: number }) => getStudentEnrollmentHistory(getDb(), payload.id))
  );
  ipcMain.handle(
    'students:delete',
    wrap((payload: { id: number }) => {
      deleteStudent(getDb(), payload.id);
      return { deleted: true };
    })
  );

  ipcMain.handle(
    'excel:template',
    wrap(async (payload?: { academic_year_id?: number }) => {
      const buffer = await generateUnifiedExcelTemplate(getDb(), payload?.academic_year_id);
      return buffer.toString('base64');
    })
  );
  ipcMain.handle(
    'excel:upload',
    wrap(async (payload: { fileBase64: string; academic_year_id?: number }) => {
      const cleanBase64 = payload.fileBase64.includes(',')
        ? payload.fileBase64.split(',')[1]
        : payload.fileBase64;
      const buffer = Buffer.from(cleanBase64, 'base64');
      const rows = await parseExcelBufferToRows(buffer);
      return validateExcelRows(getDb(), rows, payload.academic_year_id);
    })
  );
  ipcMain.handle(
    'excel:validate',
    wrap((payload: { rows: Parameters<typeof validateExcelRows>[1]; academic_year_id?: number }) =>
      validateExcelRows(getDb(), payload.rows, payload.academic_year_id)
    )
  );
  ipcMain.handle(
    'excel:commit',
    wrap((payload: { rows: Parameters<typeof commitExcelStudents>[1]; academic_year_id?: number }) =>
      commitExcelStudents(getDb(), payload.rows, payload.academic_year_id)
    )
  );

  ipcMain.handle(
    'absences:sheet',
    wrap((payload: Parameters<typeof getSectionAttendanceSheet>[1]) =>
      getSectionAttendanceSheet(getDb(), payload)
    )
  );
  ipcMain.handle(
    'absences:save-sheet',
    wrap((payload: Parameters<typeof saveSectionAttendance>[1]) =>
      saveSectionAttendance(getDb(), payload)
    )
  );
  ipcMain.handle(
    'absences:create-record',
    wrap((payload: Parameters<typeof createSingleAbsenceRecord>[1]) =>
      createSingleAbsenceRecord(getDb(), payload)
    )
  );
  ipcMain.handle(
    'absences:add-lessons',
    wrap((payload: Parameters<typeof addStudentLessonRecords>[1]) =>
      addStudentLessonRecords(getDb(), payload)
    )
  );
  ipcMain.handle(
    'absences:delete-record',
    wrap((payload: { id: number }) => {
      deleteAbsenceRecord(getDb(), payload.id);
      return { deleted: true };
    })
  );
  ipcMain.handle(
    'absences:student-details',
    wrap((payload: { id: number; academic_year_id?: number }) =>
      getStudentAbsenceDetails(getDb(), payload.id, payload.academic_year_id)
    )
  );

  ipcMain.handle('holidays:weekly-get', wrap(() => getWeeklyHolidaySettings(getDb())));
  ipcMain.handle(
    'holidays:weekly-update',
    wrap((payload: Parameters<typeof updateWeeklyHolidays>[1]) =>
      updateWeeklyHolidays(getDb(), payload)
    )
  );
  ipcMain.handle(
    'holidays:check-date',
    wrap((payload: { date: string }) => resolveDateHolidayStatus(getDb(), payload.date))
  );
  ipcMain.handle(
    'holidays:month-calendar',
    wrap((payload: { year: number; month: number }) =>
      getMonthHolidayCalendar(getDb(), payload.year, payload.month)
    )
  );
  ipcMain.handle(
    'holidays:list',
    wrap((payload?: { academic_year_id?: number }) =>
      listHolidays(getDb(), payload?.academic_year_id)
    )
  );
  ipcMain.handle(
    'holidays:create',
    wrap((payload: Parameters<typeof createHoliday>[1]) => createHoliday(getDb(), payload))
  );
  ipcMain.handle(
    'holidays:update',
    wrap((payload: { id: number } & Parameters<typeof updateHoliday>[2]) =>
      updateHoliday(getDb(), payload.id, payload)
    )
  );
  ipcMain.handle(
    'holidays:delete',
    wrap((payload: { id: number }) => {
      deleteHoliday(getDb(), payload.id);
      return { deleted: true };
    })
  );

  ipcMain.handle(
    'monthly:register',
    wrap((payload: Parameters<typeof getMonthlyAbsenceRegister>[1]) =>
      getMonthlyAbsenceRegister(getDb(), payload)
    )
  );
  ipcMain.handle(
    'monthly:save-note',
    wrap((payload: Parameters<typeof saveMonthlyStudentNote>[1]) =>
      saveMonthlyStudentNote(getDb(), payload)
    )
  );
  ipcMain.handle(
    'monthly:delete-note',
    wrap((payload: Parameters<typeof deleteMonthlyStudentNote>[1]) => {
      deleteMonthlyStudentNote(getDb(), payload);
      return { deleted: true };
    })
  );
  ipcMain.handle(
    'monthly:export-excel',
    wrap(async (payload: Parameters<typeof generateMonthlyRegisterExcel>[1]) => {
      const { buffer, filename } = await generateMonthlyRegisterExcel(getDb(), payload);
      return { base64: buffer.toString('base64'), filename };
    })
  );
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'نظام إدارة الغيابات المدرسية الإلكتروني',
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'school_attendance.db');
  const db = createDatabaseConnection(dbPath);
  setDbInstance(db);

  registerIpcHandlers();
  createMainWindow();
});

app.on('window-all-closed', () => {
  closeDb();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
