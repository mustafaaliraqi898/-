/// <reference path="./electron.d.ts" />
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { closeDb, createDatabaseConnection, setDbInstance, getDb } from '../server/db/connection';
import { getActiveAcademicYear } from '../server/services/settingsService';
import {
  addStudentLessonRecords,
  createSingleAbsenceRecord,
  deleteAbsenceRecord,
  getSectionAttendanceSheet,
  getStudentAbsenceDetails,
  saveSectionAttendance,
} from '../server/services/absenceService';
import {
  listAbsenceStages,
  createAbsenceStage,
  updateAbsenceStage,
  deleteAbsenceStage,
  getDynamicStageReport,
  issueOfficialLetter,
  listIssuedLetters,
} from '../server/services/absenceStagesService';
import {
  generateIssuedLetterDocumentHtml,
  generateStageReportDocumentHtml,
} from '../server/services/pdfService';
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
  updateGradeStage,
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
  getSimplifiedAbsenceThresholds,
  updateSimplifiedAbsenceThresholds,
} from '../server/services/legalRegulationsService';
import {
  deleteMonthlyStudentNote,
  generateMonthlyRegisterExcel,
  getMonthlyAbsenceRegister,
  saveMonthlyStudentNote,
} from '../server/services/monthlyRegisterService';
import {
  generateSimplifiedReportsExcel,
  getSimplifiedAbsenceReports,
} from '../server/services/reportsCenterService';
import {
  createAcademicYear,
  getSchoolSettings,
  listAcademicYears,
  setActiveAcademicYear,
  updateSchoolSettings,
  updateUnifiedLetterTemplate,
} from '../server/services/settingsService';
import {
  createManagedBackup,
  createVerifiedBackupBuffer,
  getBackupOverview,
  getBackupRecordFile,
  getBackupSettings,
  restoreDatabaseBackupBuffer,
  runAutoBackupIfDue,
  updateBackupSettings,
} from '../server/services/backupService';
import {
  generateAuditLogsExcel,
  listAuditLogs,
  recordAuditLog,
} from '../server/services/auditLogService';
import type { AuditLogQuery, UpdateBackupSettingsInput } from '../src/types/school';
import {
  getMediaAssetBlob,
  getMediaAssetMetaById,
  migrateLegacyDataUrlsToMediaAssets,
  processAndStoreImage,
  resolveMediaAssetDataUrl,
} from '../server/services/imageService';
import {
  createStudent,
  deleteStudent,
  getStudentById,
  getStudentEnrollmentHistory,
  listStudents,
  transferStudent,
  updateStudent,
} from '../server/services/studentService';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;

function registerIpcHandlers() {
  ipcMain.handle('print:html', async (_event: unknown, html: unknown) => {
    if (typeof html !== 'string' || !html.trim() || html.length > 15000000) {
      throw new Error('محتوى التقرير غير صالح أو يتجاوز الحجم المسموح.');
    }

    const timestamp = Date.now();
    const htmlPath = path.join(app.getPath('temp'), `school-absence-print-${timestamp}.html`);
    const pdfPath = path.join(app.getPath('temp'), `school-absence-print-${timestamp}.pdf`);
    const printWindow = new BrowserWindow({
      show: false, width: 1600, height: 1100,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    try {
      fs.writeFileSync(htmlPath, html, 'utf8');
      await printWindow.loadFile(htmlPath);
      const pdfData = await printWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
      fs.writeFileSync(pdfPath, Buffer.from(pdfData));
    } finally {
      if (!printWindow.isDestroyed()) printWindow.destroy();
      try { if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath); } catch { /* cleanup only */ }
    }
    const openError = await shell.openPath(pdfPath);
    if (openError) throw new Error(`تعذر فتح ملف PDF للطباعة: ${openError}`);
    return { opened: true, filename: path.basename(pdfPath) };
  });
  ipcMain.handle('print:current-page', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error('نافذة البرنامج غير متاحة للطباعة.');
    }

    const pdfData = await mainWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
    });
    const filename = `school-absence-print-${Date.now()}.pdf`;
    const pdfPath = path.join(app.getPath('temp'), filename);
    fs.writeFileSync(pdfPath, Buffer.from(pdfData));

    const openError = await shell.openPath(pdfPath);
    if (openError) {
      throw new Error(`تعذر فتح ملف الطباعة: ${openError}`);
    }

    return { opened: true, filename };
  });
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
        principal_name?: string | null;
        lessons_per_absence_day?: number;
        daily_lessons_count?: number;
        daily_permission_counts_as_absence?: number | boolean;
        lesson_permission_counts_as_absence?: number | boolean;
        number_display_mode?: 'arabic' | 'english';
        unified_letter_template?: string;
        school_logo_data?: string | null;
        school_logo_asset_id?: number | null;
      }) => updateSchoolSettings(getDb(), payload)
    )
  );
  ipcMain.handle(
    'settings:update-unified-letter-template',
    wrap((payload: { unified_letter_template: string }) =>
      updateUnifiedLetterTemplate(getDb(), payload.unified_letter_template)
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
    wrap((payload?: { academic_year_id?: number; grade_id?: number; stage_id?: number }) =>
      getDashboardStats(getDb(), payload?.academic_year_id, {
        gradeId: payload?.grade_id,
        stageId: payload?.stage_id,
      })
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
    wrap((payload: Parameters<typeof createGrade>[1]) => createGrade(getDb(), payload))
  );
  ipcMain.handle(
    'grades:update',
    wrap((payload: { id: number; name: string; stage?: Parameters<typeof updateGradeStage>[2] }) =>
      updateGrade(getDb(), payload.id, { name: payload.name, stage: payload.stage })
    )
  );
  ipcMain.handle(
    'grades:update-stage',
    wrap((payload: { id: number; stage: Parameters<typeof updateGradeStage>[2] }) =>
      updateGradeStage(getDb(), payload.id, payload.stage)
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

  ipcMain.handle(
    'thresholds:get',
    wrap((payload?: { academic_year_id?: number }) =>
      getSimplifiedAbsenceThresholds(getDb(), payload?.academic_year_id)
    )
  );
  ipcMain.handle(
    'thresholds:update',
    wrap((payload: Parameters<typeof updateSimplifiedAbsenceThresholds>[1]) =>
      updateSimplifiedAbsenceThresholds(getDb(), payload)
    )
  );
  ipcMain.handle(
    'absence-stages:list',
    wrap((payload?: { academic_year_id?: number }) =>
      listAbsenceStages(getDb(), payload?.academic_year_id ?? getActiveAcademicYear(getDb()).id)
    )
  );
  ipcMain.handle(
    'absence-stages:create',
    wrap((payload: Parameters<typeof createAbsenceStage>[1]) =>
      createAbsenceStage(getDb(), payload)
    )
  );
  ipcMain.handle(
    'absence-stages:update',
    wrap((payload: { id: number; name: string; days_threshold: number; letter_template?: string }) =>
      updateAbsenceStage(getDb(), payload.id, payload)
    )
  );
  ipcMain.handle(
    'absence-stages:delete',
    wrap((payload: { id: number }) => deleteAbsenceStage(getDb(), payload.id))
  );
  ipcMain.handle(
    'absence-stages:report',
    wrap((payload: Parameters<typeof getDynamicStageReport>[1]) =>
      getDynamicStageReport(getDb(), payload)
    )
  );
  ipcMain.handle(
    'absence-stages:issue-letter',
    wrap((payload: Parameters<typeof issueOfficialLetter>[1]) =>
      issueOfficialLetter(getDb(), payload)
    )
  );
  ipcMain.handle(
    'absence-stages:issued-letters',
    wrap((payload: { academic_year_id: number }) =>
      listIssuedLetters(getDb(), payload.academic_year_id)
    )
  );
  ipcMain.handle(
    'absence-stages:report-pdf',
    wrap(
      async (payload: {
        academic_year_id?: number;
        stage_id?: number;
        grade_id?: number;
        section_id?: number;
        search?: string;
      }) => {
        const { html, filename } = await generateStageReportDocumentHtml(getDb(), payload ?? {});
        const buffer = await renderHtmlToPdfElectron(html);
        return { base64: buffer.toString('base64'), filename };
      }
    )
  );
  ipcMain.handle(
    'absence-stages:letter-pdf',
    wrap(async (payload: { letter_id: number }) => {
      const { html, filename } = await generateIssuedLetterDocumentHtml(getDb(), payload.letter_id);
      const buffer = await renderHtmlToPdfElectron(html);
      return { base64: buffer.toString('base64'), filename };
    })
  );

  ipcMain.handle(
    'reports:absences',
    wrap((payload: Parameters<typeof getSimplifiedAbsenceReports>[1]) =>
      getSimplifiedAbsenceReports(getDb(), payload)
    )
  );
  ipcMain.handle(
    'reports:absences-export',
    wrap(async (payload: Parameters<typeof generateSimplifiedReportsExcel>[1]) => {
      const { buffer, filename } = await generateSimplifiedReportsExcel(getDb(), payload);
      return { base64: buffer.toString('base64'), filename };
    })
  );
  ipcMain.handle(
    'media:upload',
    wrap(
      async (payload: {
        bytes: Uint8Array | ArrayBuffer;
        filename?: string | null;
        category?: string | null;
        mimeHint?: string | null;
      }) => {
        const buffer = Buffer.from(
          payload.bytes instanceof ArrayBuffer ? new Uint8Array(payload.bytes) : payload.bytes
        );
        const asset = await processAndStoreImage(getDb(), buffer, {
          filename: payload.filename,
          category: payload.category,
          mimeHint: payload.mimeHint,
        });
        return {
          ...asset,
          optimized_url: `app-media://asset/${asset.id}/optimized`,
          original_url: `app-media://asset/${asset.id}/original`,
          compat_url: `app-media://asset/${asset.id}/compat`,
        };
      }
    )
  );
  ipcMain.handle(
    'media:meta',
    wrap((payload: { id: number }) => getMediaAssetMetaById(getDb(), payload.id))
  );
  ipcMain.handle(
    'media:compat-data-url',
    wrap((payload: { id: number }) => resolveMediaAssetDataUrl(getDb(), payload.id, 'compat'))
  );
  ipcMain.handle('backup:overview', wrap(() => getBackupOverview(getDb())));
  ipcMain.handle(
    'backup:update-settings',
    wrap((payload: UpdateBackupSettingsInput) => updateBackupSettings(getDb(), payload))
  );
  ipcMain.handle('backup:create', wrap(() => createManagedBackup(getDb(), 'manual')));
  ipcMain.handle(
    'backup:run-auto',
    wrap(async (payload?: { force?: boolean }) => {
      const db = getDb();
      const result = await runAutoBackupIfDue(db, { force: Boolean(payload?.force) });
      return {
        executed: Boolean(result),
        result,
        overview: getBackupOverview(db),
      };
    })
  );
  ipcMain.handle(
    'backup:download-record',
    wrap((payload: { id: number }) => {
      const { filePath, filename } = getBackupRecordFile(getDb(), payload.id);
      const buffer = fs.readFileSync(filePath);
      return { base64: buffer.toString('base64'), filename };
    })
  );
  ipcMain.handle(
    'backup:pick-directory',
    wrap(async (payload?: { defaultPath?: string }) => {
      if (!mainWindow) {
        return { canceled: true, path: null };
      }
      const res = await dialog.showOpenDialog(mainWindow, {
        title: 'اختر مجلد حفظ النسخ الاحتياطية',
        defaultPath: payload?.defaultPath,
        properties: ['openDirectory', 'createDirectory'],
      });
      if (res.canceled || res.filePaths.length === 0) {
        return { canceled: true, path: null };
      }
      return { canceled: false, path: res.filePaths[0] };
    })
  );
  ipcMain.handle(
    'backup:save-manual-dialog',
    wrap(async () => {
      const db = getDb();
      const { buffer, integrity_status, filename } = await createVerifiedBackupBuffer(db);
      if (!mainWindow) {
        return { canceled: true };
      }
      const res = await dialog.showSaveDialog(mainWindow, {
        title: 'حفظ النسخة الاحتياطية لقاعدة البيانات',
        defaultPath: filename,
        filters: [{ name: 'قاعدة بيانات SQLite', extensions: ['db'] }],
      });
      if (res.canceled || !res.filePath) {
        return { canceled: true };
      }
      fs.writeFileSync(res.filePath, buffer);
      recordAuditLog(db, {
        operation_type: 'backup',
        section: 'backup',
        description: `تصدير نسخة احتياطية يدوية إلى (${path.basename(res.filePath)})`,
        target_label: path.basename(res.filePath),
        new_value: {
          file_path: res.filePath,
          size_bytes: buffer.length,
          integrity_status,
        },
      });
      return {
        canceled: false,
        file_path: res.filePath,
        filename: path.basename(res.filePath),
        size_bytes: buffer.length,
        integrity_status,
      };
    })
  );
  ipcMain.handle(
    'backup:export',
    wrap(async () => {
      const db = getDb();
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
      return {
        base64: buffer.toString('base64'),
        filename,
        integrity_status,
      };
    })
  );
  ipcMain.handle(
    'backup:restore',
    wrap(async (payload: { bytes: Uint8Array | ArrayBuffer }) => {
      const buffer = Buffer.from(
        payload.bytes instanceof ArrayBuffer ? new Uint8Array(payload.bytes) : payload.bytes
      );
      const res = await restoreDatabaseBackupBuffer(getDb(), buffer);
      return {
        restored: true,
        media_assets_count: res.media_assets_count,
        students_count: res.students_count,
        pre_restore_backup_filename: res.pre_restore_backup_filename,
        integrity_status: res.integrity_status,
      };
    })
  );

  ipcMain.handle(
    'audit-logs:list',
    wrap((payload?: AuditLogQuery) => listAuditLogs(getDb(), payload ?? {}))
  );
  ipcMain.handle(
    'audit-logs:export',
    wrap(async (payload?: AuditLogQuery) => {
      const { buffer, filename } = await generateAuditLogsExcel(getDb(), payload ?? {});
      return { base64: buffer.toString('base64'), filename };
    })
  );
}

async function renderHtmlToPdfElectron(html: string): Promise<Buffer> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-pdf-'));
  const htmlPath = path.join(tmpDir, 'document.html');
  fs.writeFileSync(htmlPath, html, 'utf8');

  const pdfWin = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    await pdfWin.loadFile(htmlPath);
    const pdfData = await pdfWin.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    return Buffer.from(pdfData);
  } finally {
    if (!pdfWin.isDestroyed()) {
      pdfWin.destroy();
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup
    }
  }
}

let isQuitting = false;
let backupInProgressOnClose = false;

async function performCloseBackupAndQuit(win: BrowserWindow) {
  if (isQuitting) return;
  try {
    const db = getDb();
    const settings = getBackupSettings(db);
    if (settings.backup_on_close === 1 && !backupInProgressOnClose) {
      backupInProgressOnClose = true;
      try {
        await createManagedBackup(db, 'auto', { customFilename: `close_backup_${formatCloseTimestamp()}.db` });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'فشل إنشاء النسخة الاحتياطية عند الإغلاق.';
        const choice = await dialog.showMessageBox(win, {
          type: 'warning',
          title: 'تعذر إنشاء النسخة الاحتياطية عند الإغلاق',
          message: `${errorMsg}\n\nهل تريد إعادة المحاولة أم إغلاق البرنامج دون نسخة احتياطية؟`,
          buttons: ['إعادة المحاولة', 'إغلاق البرنامج دون نسخة', 'إلغاء الإغلاق'],
          defaultId: 0,
          cancelId: 2,
        });

        if (choice.response === 0) {
          backupInProgressOnClose = false;
          return performCloseBackupAndQuit(win);
        } else if (choice.response === 1) {
          // Proceed to quit without backup
        } else {
          // Cancel quit
          backupInProgressOnClose = false;
          return;
        }
      } finally {
        backupInProgressOnClose = false;
      }
    }
  } catch {
    // If settings check fails, proceed with quit safely
  }

  isQuitting = true;
  try {
    closeDb();
  } catch {
    // ignore
  }
  app.quit();
}

function formatCloseTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(
    d.getHours()
  )}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'نظام إدارة الغيابات المدرسية الإلكتروني',
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    void performCloseBackupAndQuit(mainWindow!);
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.setName('SchoolAbsenceManager');
app.setPath('userData', path.join(app.getPath('appData'), 'SchoolAbsenceManager'));

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'school_attendance.db');
  const db = createDatabaseConnection(dbPath);
  setDbInstance(db);
  void migrateLegacyDataUrlsToMediaAssets(db).catch(() => {});

  protocol.handle('app-media', async (request) => {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/?(\d+)\/(optimized|original|compat)$/);
    if (!match) {
      return new Response('Not Found', { status: 404 });
    }
    try {
      const asset = await getMediaAssetBlob(
        getDb(),
        Number(match[1]),
        match[2] as 'optimized' | 'original' | 'compat'
      );
      return new Response(new Uint8Array(asset.buffer), {
        status: 200,
        headers: {
          'Content-Type': asset.mime,
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  });

  registerIpcHandlers();
  createMainWindow();

  void runAutoBackupIfDue(getDb()).catch(() => {});
  const autoTimer = setInterval(() => {
    void runAutoBackupIfDue(getDb()).catch(() => {});
  }, 30 * 60 * 1000);
  autoTimer.unref?.();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
});
