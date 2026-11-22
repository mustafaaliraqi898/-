import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import express from 'express';
import { createDatabaseConnection } from '../server/db/connection';
import { createApiRouter } from '../server/routes/api';
import {
  deleteAbsenceRecord,
  getSectionAttendanceSheet,
  saveSectionAttendance,
} from '../server/services/absenceService';
import { createGrade } from '../server/services/gradeService';
import {
  getSimplifiedAbsenceThresholds,
  updateSimplifiedAbsenceThresholds,
} from '../server/services/legalRegulationsService';
import { getMonthlyAbsenceRegister } from '../server/services/monthlyRegisterService';
import {
  generateSimplifiedReportsExcel,
  getSimplifiedAbsenceReports,
} from '../server/services/reportsCenterService';
import { getActiveAcademicYear, updateSchoolSettings } from '../server/services/settingsService';
import { createStudent } from '../server/services/studentService';
import { buildSimplifiedReportStandaloneHtml } from '../src/components/reports/LegalPrintSheet';

async function runTests() {
  const results: Array<{ name: string; ok: boolean; error?: string }> = [];

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`PASS: ${name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ name, ok: false, error: msg });
      console.error(`FAIL: ${name} -> ${msg}`);
    }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iraqi-school-simplified-reports-'));
  const dbPath = path.join(tmpDir, 'test_simplified.db');
  let db = createDatabaseConnection(dbPath);

  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter(() => db));

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Failed to bind test server');
  const baseUrl = `http://127.0.0.1:${addr.port}/api`;

  async function apiJson<T>(
    urlPath: string,
    init?: RequestInit
  ): Promise<{ status: number; body: T }> {
    const res = await fetch(`${baseUrl}${urlPath}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    const body = (await res.json()) as T;
    return { status: res.status, body };
  }

  const activeYear = getActiveAcademicYear(db);
  updateSchoolSettings(db, {
    school_name: 'إعدادية الرافدين للبنين',
    directorate_name: 'المديرية العامة للتربية في بغداد الرصافة الأولى',
    lessons_per_absence_day: 3,
    daily_permission_counts_as_absence: 0,
    lesson_permission_counts_as_absence: 0,
  });

  const grade4 = createGrade(db, {
    name: 'الرابع العلمي',
    stage: 'preparatory',
    initial_sections: ['أ', 'ب'],
  });
  const sectionA = grade4.sections[0];
  const sectionB = grade4.sections[1];

  const studentWithin = createStudent(db, {
    full_name: 'أحمد سالم كريم',
    grade_id: grade4.id,
    section_id: sectionA.id,
    registry_number: '1001',
  });
  const studentWarning = createStudent(db, {
    full_name: 'باقر حسن علي',
    grade_id: grade4.id,
    section_id: sectionA.id,
    registry_number: '1002',
  });
  const studentPrelim = createStudent(db, {
    full_name: 'جعفر صادق محمد',
    grade_id: grade4.id,
    section_id: sectionA.id,
    registry_number: '1003',
  });
  const studentFinal = createStudent(db, {
    full_name: 'حسين علاء جاسم',
    grade_id: grade4.id,
    section_id: sectionA.id,
    registry_number: '1004',
  });
  const studentExceeded = createStudent(db, {
    full_name: 'زيد طارق نوري',
    grade_id: grade4.id,
    section_id: sectionB.id,
    registry_number: '1005',
  });

  // Helper to mark N direct full_day absences on working dates (Sundays–Thursdays in Nov 2026)
  const workingDates = [
    '2026-11-01',
    '2026-11-02',
    '2026-11-03',
    '2026-11-04',
    '2026-11-05',
    '2026-11-08',
    '2026-11-09',
    '2026-11-10',
    '2026-11-11',
    '2026-11-12',
    '2026-11-15',
    '2026-11-16',
  ];

  try {
    await test('1. Save & reload the 4 simplified thresholds in SQLite across DB reopen', async () => {
      const initial = getSimplifiedAbsenceThresholds(db, activeYear.id);
      assert.ok(initial.warning_days > 0);

      const putRes = await apiJson<{
        warning_days: number;
        preliminary_warning_days: number;
        final_warning_days: number;
        effective_absence_limit: number;
      }>('/absence-thresholds', {
        method: 'PUT',
        body: JSON.stringify({
          warning_days: 3,
          preliminary_warning_days: 5,
          final_warning_days: 7,
          effective_absence_limit: 10,
          academic_year_id: activeYear.id,
        }),
      });
      assert.equal(putRes.status, 200);
      assert.equal(putRes.body.warning_days, 3);
      assert.equal(putRes.body.preliminary_warning_days, 5);
      assert.equal(putRes.body.final_warning_days, 7);
      assert.equal(putRes.body.effective_absence_limit, 10);

      // Close and reopen SQLite DB to prove durable persistence
      db.close();
      db = createDatabaseConnection(dbPath);

      const reloaded = await apiJson<{
        warning_days: number;
        preliminary_warning_days: number;
        final_warning_days: number;
        effective_absence_limit: number;
      }>('/absence-thresholds');
      assert.equal(reloaded.status, 200);
      assert.equal(reloaded.body.warning_days, 3);
      assert.equal(reloaded.body.preliminary_warning_days, 5);
      assert.equal(reloaded.body.final_warning_days, 7);
      assert.equal(reloaded.body.effective_absence_limit, 10);
    });

    await test('2. Reject conflicting or inverted threshold ordering in service & HTTP API', async () => {
      assert.throws(
        () =>
          updateSimplifiedAbsenceThresholds(db, {
            warning_days: 6,
            preliminary_warning_days: 5,
            final_warning_days: 7,
            effective_absence_limit: 10,
          }),
        /THRESHOLD_ORDER_CONFLICT|تسلسل العتبات غير متوافق/
      );

      const badApi = await apiJson<{ error: string; code: string }>('/absence-thresholds', {
        method: 'PUT',
        body: JSON.stringify({
          warning_days: 3,
          preliminary_warning_days: 5,
          final_warning_days: 10,
          effective_absence_limit: 10,
        }),
      });
      assert.equal(badApi.status, 400);
      assert.equal(badApi.body.code, 'THRESHOLD_ORDER_CONFLICT');
    });

    await test('3. Verify all 5 student states across the 4 reports and single-source linkage with Absences', async () => {
      // Seed exact absences via absenceService:
      // - studentWithin: 2 full days + 2 sick_leave days (sick leaves are NOT counted in absenceService!)
      // - studentWarning: 3 full days (reached warning=3)
      // - studentPrelim: 4 full days + 3 lessons missed (3 lessons / 3 per day = 1 converted day => 5 counted days)
      // - studentFinal: 7 full days (reached final=7)
      // - studentExceeded: 10 full days (reached effective_limit=10)
      for (let i = 0; i < 10; i++) {
        const d = workingDates[i];
        const entriesA: Parameters<typeof saveSectionAttendance>[1]['entries'] = [];
        if (i < 2) {
          entriesA.push({ student_id: studentWithin.id, status: 'full_day' });
        } else if (i < 4) {
          entriesA.push({
            student_id: studentWithin.id,
            status: 'full_day_leave',
            leave_type: 'sick_leave',
          });
        }
        if (i < 3) {
          entriesA.push({ student_id: studentWarning.id, status: 'full_day' });
        }
        if (i < 4) {
          entriesA.push({ student_id: studentPrelim.id, status: 'full_day' });
        } else if (i === 4) {
          entriesA.push({
            student_id: studentPrelim.id,
            status: 'lesson_absence',
            lesson_details: [
              { lesson_number: 1, lesson_status: 'lesson_absence' },
              { lesson_number: 2, lesson_status: 'lesson_escape' },
              { lesson_number: 3, lesson_status: 'lesson_absence' },
            ],
          });
        }
        if (i < 7) {
          entriesA.push({ student_id: studentFinal.id, status: 'full_day' });
        }
        if (entriesA.length > 0) {
          saveSectionAttendance(db, {
            academic_year_id: activeYear.id,
            grade_id: grade4.id,
            section_id: sectionA.id,
            attendance_date: d,
            entries: entriesA,
          });
        }

        saveSectionAttendance(db, {
          academic_year_id: activeYear.id,
          grade_id: grade4.id,
          section_id: sectionB.id,
          attendance_date: d,
          entries: [{ student_id: studentExceeded.id, status: 'full_day' }],
        });
      }

      // Cross-check directly against absenceService.getSectionAttendanceSheet
      const sheetA = getSectionAttendanceSheet(db, {
        academic_year_id: activeYear.id,
        grade_id: grade4.id,
        section_id: sectionA.id,
        attendance_date: '2026-11-15',
      });
      const sheetB = getSectionAttendanceSheet(db, {
        academic_year_id: activeYear.id,
        grade_id: grade4.id,
        section_id: sectionB.id,
        attendance_date: '2026-11-15',
      });
      const expectedTotals = new Map<number, number>();
      for (const s of [...sheetA.students, ...sheetB.students]) {
        expectedTotals.set(s.student_id, s.total_full_days);
      }

      assert.equal(expectedTotals.get(studentWithin.id), 2);
      assert.equal(expectedTotals.get(studentWarning.id), 3);
      assert.equal(expectedTotals.get(studentPrelim.id), 5);
      assert.equal(expectedTotals.get(studentFinal.id), 7);
      assert.equal(expectedTotals.get(studentExceeded.id), 10);

      // Report 1: Warning (3 <= days < 5) -> 1 student only (studentWarning=3)
      const rWarn = getSimplifiedAbsenceReports(db, {
        academic_year_id: activeYear.id,
        report_type: 'warning',
      });
      assert.equal(rWarn.summary.total_active_students, 5);
      assert.equal(rWarn.summary.within_limit_count, 1);
      assert.equal(rWarn.summary.warning_count, 1);
      assert.equal(rWarn.summary.preliminary_warning_count, 1);
      assert.equal(rWarn.summary.final_warning_count, 2);
      assert.equal(rWarn.summary.exceeded_limit_count, 1);
      assert.equal(rWarn.rows.length, 1);
      assert.equal(rWarn.rows[0].student_id, studentWarning.id);
      assert.equal(rWarn.rows[0].alert_label, 'تحذير');

      // Report 2: Preliminary Warning (5 <= days < 7) -> 1 student only (studentPrelim=5)
      const rPrelim = getSimplifiedAbsenceReports(db, {
        academic_year_id: activeYear.id,
        report_type: 'preliminary_warning',
      });
      assert.equal(rPrelim.rows.length, 1);
      assert.equal(rPrelim.rows[0].student_id, studentPrelim.id);
      assert.equal(rPrelim.rows[0].alert_label, 'إنذار أولي');

      // Report 3: Final Warning (>= 7) -> 2 students (studentFinal=7, studentExceeded=10)
      const rFinal = getSimplifiedAbsenceReports(db, {
        academic_year_id: activeYear.id,
        report_type: 'final_warning',
      });
      assert.equal(rFinal.rows.length, 2);
      assert.ok(rFinal.rows.some((r) => r.student_id === studentFinal.id && r.alert_label === 'إنذار نهائي'));
      assert.ok(rFinal.rows.some((r) => r.student_id === studentExceeded.id));

      for (const rep of [rWarn, rPrelim, rFinal]) {
        for (const row of rep.rows) {
          assert.equal(
            row.counted_absence_days,
            expectedTotals.get(row.student_id),
            `counted_absence_days must exactly match absenceService total_full_days for ${row.full_name}`
          );
        }
      }

      // Ensure no student appears in more than one of the 3 warning/alert lists
      const warnIds = new Set(rWarn.rows.map((r) => r.student_id));
      const prelimIds = new Set(rPrelim.rows.map((r) => r.student_id));
      const finalIds = new Set(rFinal.rows.map((r) => r.student_id));
      for (const id of warnIds) {
        assert.ok(!prelimIds.has(id) && !finalIds.has(id));
      }
      for (const id of prelimIds) {
        assert.ok(!finalIds.has(id));
      }

      // Report 4: Exceeded Limit (>= 10) -> 1 student (studentExceeded)
      const rExceeded = await apiJson<{ rows: Array<{ student_id: number; counted_absence_days: number; alert_label: string }> }>(
        `/reports/absences?report_type=exceeded_limit&academic_year_id=${activeYear.id}`
      );
      assert.equal(rExceeded.status, 200);
      assert.equal(rExceeded.body.rows.length, 1);
      assert.equal(rExceeded.body.rows[0].student_id, studentExceeded.id);
      assert.equal(rExceeded.body.rows[0].counted_absence_days, 10);
      assert.equal(rExceeded.body.rows[0].alert_label, 'متجاوز لحد الغياب المؤثر');
    });

    await test('4. Modifying/deleting an absence in absenceService reflects automatically in reports', () => {
      // Delete 1 full_day record of studentExceeded (10 -> 9, drops out of exceeded_limit, stays in final_warning)
      const rowToDelete = db
        .prepare(
          `SELECT id FROM absences
           WHERE student_id = ? AND academic_year_id = ? AND status = 'full_day'
           ORDER BY absence_date DESC LIMIT 1`
        )
        .get(studentExceeded.id, activeYear.id) as { id: number };
      deleteAbsenceRecord(db, rowToDelete.id);

      const rExceededAfter = getSimplifiedAbsenceReports(db, {
        academic_year_id: activeYear.id,
        report_type: 'exceeded_limit',
      });
      assert.equal(rExceededAfter.rows.length, 0);
      assert.equal(rExceededAfter.summary.exceeded_limit_count, 0);

      const rFinalAfter = getSimplifiedAbsenceReports(db, {
        academic_year_id: activeYear.id,
        report_type: 'final_warning',
      });
      const updatedExceededRow = rFinalAfter.rows.find((r) => r.student_id === studentExceeded.id);
      assert.ok(updatedExceededRow);
      assert.equal(updatedExceededRow.counted_absence_days, 9);
      assert.equal(updatedExceededRow.alert_level, 'final_warning');
      assert.equal(updatedExceededRow.alert_label, 'إنذار نهائي');
    });

    await test('5. Printable bulletin-board HTML & Excel export contain required student fields', async () => {
      const report = getSimplifiedAbsenceReports(db, {
        academic_year_id: activeYear.id,
        report_type: 'warning',
      });

      const html = buildSimplifiedReportStandaloneHtml(report);
      assert.ok(html.includes('إعدادية الرافدين للبنين'));
      assert.ok(html.includes('لوحة إعلانات المدرسة'));
      assert.ok(html.includes('باقر حسن علي'));
      assert.ok(html.includes('الرابع العلمي'));
      assert.ok(html.includes('3 يوم'));
      assert.ok(html.includes('تحذير'));

      const finalReport = getSimplifiedAbsenceReports(db, {
        academic_year_id: activeYear.id,
        report_type: 'final_warning',
      });
      const finalHtml = buildSimplifiedReportStandaloneHtml(finalReport);
      assert.ok(finalHtml.includes('إنذار نهائي'));

      const { buffer, filename } = await generateSimplifiedReportsExcel(db, {
        academic_year_id: activeYear.id,
        report_type: 'warning',
      });
      assert.ok(filename.endsWith('.xlsx'));
      assert.ok(buffer.length > 500);

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
      );
      const ws = wb.worksheets[0];
      assert.ok(ws);
      const headerRowValues = ws.getRow(3).values as Array<string | number | undefined>;
      assert.ok(headerRowValues.includes('اسم الطالب'));
      assert.ok(headerRowValues.includes('الصف'));
      assert.ok(headerRowValues.includes('الشعبة'));
      assert.ok(headerRowValues.includes('عدد أيام الغياب المحتسبة'));
      assert.ok(headerRowValues.includes('نوع التحذير أو الإنذار'));

      // Verify HTTP Excel export endpoint returns 200
      const httpExp = await fetch(
        `${baseUrl}/reports/absences/export?report_type=warning&academic_year_id=${activeYear.id}`
      );
      assert.equal(httpExp.status, 200);
      const expBuf = await httpExp.arrayBuffer();
      assert.ok(expBuf.byteLength > 500);
    });

    await test('6. Existing Monthly Register continues working normally alongside simplified reports', () => {
      const reg = getMonthlyAbsenceRegister(db, {
        academic_year_id: activeYear.id,
        year: 2026,
        month: 11,
        grade_id: grade4.id,
        section_id: sectionA.id,
      });
      assert.equal(reg.students.length, 4);
      const prelimStudent = reg.students.find((s) => s.student_id === studentPrelim.id);
      assert.ok(prelimStudent);
      assert.equal(prelimStudent.total_counted_absence_days, 5);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\nSummary: ${passed}/${results.length} tests passed.`);
  if (passed !== results.length) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
