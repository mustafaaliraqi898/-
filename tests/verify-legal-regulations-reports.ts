import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createDatabaseConnection } from '../server/db/connection';
import { createApiRouter } from '../server/routes/api';
import { deleteAbsenceRecord, saveSectionAttendance } from '../server/services/absenceService';
import { createGrade } from '../server/services/gradeService';
import { getWeeklyHolidaySettings } from '../server/services/holidayService';
import {
  listAllStageRegulations,
  listRegulationVersions,
  updateStageRegulation,
} from '../server/services/legalRegulationsService';
import { getMonthlyAbsenceRegister } from '../server/services/monthlyRegisterService';
import {
  createStudentLegalProcedure,
  generateReportsExcel,
  getReportsCenterData,
  updateStudentLegalProcedure,
} from '../server/services/reportsCenterService';
import {
  createAcademicYear,
  getActiveAcademicYear,
  updateSchoolSettings,
} from '../server/services/settingsService';
import { createStudent } from '../server/services/studentService';

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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iraqi-school-legal-'));
  const dbPath = path.join(tmpDir, 'test_legal.db');
  const db = createDatabaseConnection(dbPath);

  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter(() => db));

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Failed to bind test server');
  const baseUrl = `http://127.0.0.1:${addr.port}/api`;

  async function apiJson<T>(urlPath: string, init?: RequestInit): Promise<{ status: number; body: T }> {
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

  // Create grades across all 3 stages + 1 unmapped grade
  const primaryGrade = createGrade(db, {
    name: 'الخامس الابتدائي',
    stage: 'primary',
    initial_sections: ['أ'],
  });
  const intermediateGrade = createGrade(db, {
    name: 'الثاني المتوسط',
    stage: 'intermediate',
    initial_sections: ['أ'],
  });
  const prepGrade = createGrade(db, {
    name: 'الخامس العلمي',
    stage: 'preparatory',
    initial_sections: ['أ'],
  });
  const customGrade = createGrade(db, {
    name: 'شعبة خاصة تجريبية',
    initial_sections: ['أ'],
  });

  assert.equal(primaryGrade.stage, 'primary');
  assert.equal(intermediateGrade.stage, 'intermediate');
  assert.equal(prepGrade.stage, 'preparatory');
  assert.equal(customGrade.stage, null);

  const sPrimary = createStudent(db, {
    full_name: 'حسين علي محسن',
    grade_id: primaryGrade.id,
    section_id: primaryGrade.sections[0].id,
    registry_number: '101',
  });
  const sInterm = createStudent(db, {
    full_name: 'محمد جاسم كريم',
    grade_id: intermediateGrade.id,
    section_id: intermediateGrade.sections[0].id,
    registry_number: '201',
  });
  const sPrep = createStudent(db, {
    full_name: 'علي رضا طارق',
    grade_id: prepGrade.id,
    section_id: prepGrade.sections[0].id,
    registry_number: '301',
  });

  try {
    await test('1. التحقق من القيم الافتراضية والوسم التجريبي وعدم الاستثناء التلقائي للغياب بعذر', async () => {
      const regs = listAllStageRegulations(db);
      assert.equal(regs.primary.effective_absence_limit, 50);
      assert.equal(regs.intermediate.effective_absence_limit, 45);
      assert.equal(regs.preparatory.effective_absence_limit, 45);

      for (const stage of ['primary', 'intermediate', 'preparatory'] as const) {
        assert.equal(regs[stage].thresholds_are_provisional, 1);
        assert.equal(regs[stage].is_legally_approved, 0);
        assert.equal(regs[stage].official_letter_approved, 0);
        assert.equal(regs[stage].excused_absence_mode, 'include_all');
      }
      assert.equal(regs.primary.guardian_notify_frequency, 'weekly');
      assert.equal(regs.intermediate.guardian_notify_frequency, 'biweekly');
      assert.equal(regs.intermediate.attendance_score_deduction_enabled, 1);
      assert.equal(regs.intermediate.attendance_score_deduction_per_unexcused_day, 2);
      assert.equal(regs.preparatory.conduct_failure_threshold, 51);
    });

    await test('2. استقلالية المراحل الدراسية: تعديل الابتدائية لا يؤثر على المتوسطة والإعدادية والعكس', async () => {
      const before = listAllStageRegulations(db);
      const updatedPrimary = updateStageRegulation(db, 'primary', {
        ...before.primary,
        effective_absence_limit: 52,
        preliminary_warning_days: 6,
        first_warning_days: 14,
        final_warning_days: 28,
        final_effective_limit_days: 50,
        change_summary: 'تعديل خاص بالابتدائية',
      });

      assert.equal(updatedPrimary.regulation.effective_absence_limit, 52);
      assert.equal(updatedPrimary.regulation.preliminary_warning_days, 6);

      const afterPrimaryEdit = listAllStageRegulations(db);
      assert.equal(afterPrimaryEdit.intermediate.effective_absence_limit, 45);
      assert.equal(afterPrimaryEdit.intermediate.preliminary_warning_days, 15);
      assert.equal(afterPrimaryEdit.preparatory.effective_absence_limit, 45);

      const updatedInterm = updateStageRegulation(db, 'intermediate', {
        ...afterPrimaryEdit.intermediate,
        preliminary_warning_days: 4,
        first_warning_days: 12,
        final_warning_days: 24,
        final_effective_limit_days: 45,
        change_summary: 'تعديل خاص بالمتوسطة',
      });
      assert.equal(updatedInterm.regulation.preliminary_warning_days, 4);

      const afterIntermEdit = listAllStageRegulations(db);
      assert.equal(afterIntermEdit.primary.preliminary_warning_days, 6);
      assert.equal(afterIntermEdit.preparatory.preliminary_warning_days, 15);
    });

    await test('3. رفض العتبات المتناقضة أو المعكوسة والاعتماد بدون قرار أو مع القيم التجريبية', async () => {
      const regs = listAllStageRegulations(db);
      const badOrder = await apiJson<{ error: string; code: string }>(
        '/legal-regulations/preparatory',
        {
          method: 'PUT',
          body: JSON.stringify({
            ...regs.preparatory,
            preliminary_warning_days: 20,
            first_warning_days: 10,
          }),
        }
      );
      assert.equal(badOrder.status, 400);
      assert.equal(badOrder.body.code, 'THRESHOLD_ORDER_CONFLICT');

      const badApproveProvisional = await apiJson<{ error: string; code: string }>(
        '/legal-regulations/preparatory',
        {
          method: 'PUT',
          body: JSON.stringify({
            ...regs.preparatory,
            thresholds_are_provisional: true,
            is_legally_approved: true,
            decision_number: '100',
            decision_issue_date: '2026-10-01',
          }),
        }
      );
      assert.equal(badApproveProvisional.status, 400);
      assert.equal(badApproveProvisional.body.code, 'PROVISIONAL_CANNOT_BE_APPROVED');

      const missingDecision = await apiJson<{ error: string; code: string }>(
        '/legal-regulations/preparatory',
        {
          method: 'PUT',
          body: JSON.stringify({
            ...regs.preparatory,
            thresholds_are_provisional: false,
            is_legally_approved: true,
            decision_number: '',
            decision_issue_date: '',
          }),
        }
      );
      assert.equal(missingDecision.status, 400);
      assert.equal(missingDecision.body.code, 'DECISION_METADATA_REQUIRED');
    });

    await test('4. منع إصدار كتاب قانوني رسمي نهائي قبل اعتماد الضابطة قانونياً ثم السماح بعد الاعتماد', async () => {
      const blockedRes = await apiJson<{ error: string; code: string }>('/reports/procedures', {
        method: 'POST',
        body: JSON.stringify({
          student_id: sPrep.id,
          academic_year_id: activeYear.id,
          procedure_type: 'preliminary_warning',
          procedure_date: '2026-11-10',
          is_official_legal_issue: true,
        }),
      });
      assert.equal(blockedRes.status, 400);
      assert.equal(blockedRes.body.code, 'REGULATION_NOT_APPROVED');

      // Now legally approve Preparatory stage with decision metadata and clear thresholds (5/15/30/45)
      const regs = listAllStageRegulations(db);
      const approveRes = await apiJson('/legal-regulations/preparatory', {
        method: 'PUT',
        body: JSON.stringify({
          ...regs.preparatory,
          preliminary_warning_days: 5,
          first_warning_days: 15,
          final_warning_days: 30,
          final_effective_limit_days: 45,
          thresholds_are_provisional: false,
          is_legally_approved: true,
          official_letter_approved: true,
          decision_name: 'نظام المدارس الثانوية',
          decision_number: '99/ت/2026',
          decision_issue_date: '2026-09-15',
          change_summary: 'اعتماد رسمي للإعدادية',
        }),
      });
      assert.equal(approveRes.status, 200);
    });

    await test('5. التحديث التلقائي للتقارير الـ6 وخصم المواظبة ومؤشر السلوك فور تسجيل الغياب والدروس المتراكمة', async () => {
      // Update lessons_per_absence_day=5
      updateSchoolSettings(db, {
        school_name: 'ثانوية بغداد',
        directorate_name: 'تربية الرصافة الأولى',
        lessons_per_absence_day: 5,
      });

      // Record 5 full_day unexcused absences for sPrep -> reaches preliminary (5 days), deducts 10 pts
      const dates5 = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-08'];
      for (const dt of dates5) {
        saveSectionAttendance(db, {
          academic_year_id: activeYear.id,
          grade_id: prepGrade.id,
          section_id: prepGrade.sections[0].id,
          attendance_date: dt,
          entries: [{ student_id: sPrep.id, status: 'full_day' }],
        });
      }

      // Also record 5 lessons missed on 2026-11-09 -> converts to +1 day (total 6 days, deducts 12 pts)
      saveSectionAttendance(db, {
        academic_year_id: activeYear.id,
        grade_id: prepGrade.id,
        section_id: prepGrade.sections[0].id,
        attendance_date: '2026-11-09',
        entries: [
          {
            student_id: sPrep.id,
            status: 'lesson_absence',
            lesson_details: [
              { lesson_number: 1, lesson_status: 'lesson_absence' },
              { lesson_number: 2, lesson_status: 'lesson_absence' },
              { lesson_number: 3, lesson_status: 'lesson_escape' },
              { lesson_number: 4, lesson_status: 'lesson_escape' },
              { lesson_number: 5, lesson_status: 'lesson_absence' },
            ],
          },
        ],
      });

      const prelimReport = getReportsCenterData(db, {
        academic_year_id: activeYear.id,
        report_type: 'preliminary_warnings',
      });

      const prepRow = prelimReport.rows.find((r) => r.student_id === sPrep.id);
      assert.ok(prepRow, 'sPrep must appear in preliminary_warnings');
      assert.equal(prepRow.direct_unexcused_full_days, 5);
      assert.equal(prepRow.converted_lesson_days, 1);
      assert.equal(prepRow.counted_legal_absence_days, 6);
      assert.equal(prepRow.attendance_score_deducted, 12);
      assert.equal(prepRow.conduct_failure_triggered, false);
      assert.equal(prepRow.next_threshold_days, 15);
      assert.equal(prepRow.remaining_days_to_next_threshold, 9); // 15 - 6 = 9
      assert.equal(prepRow.truancy_risk, true);

      // Give sInterm 26 full_day absences -> 26 * 2 = 52 >= 51 conduct failure + reaches final warning (24)
      const intermDates: string[] = [];
      let dayNum = 1;
      for (let m = 9; m <= 10 && intermDates.length < 26; m++) {
        for (let d = 1; d <= 28 && intermDates.length < 26; d++) {
          const iso = `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
          if (dow === 5 || dow === 6) continue; // skip Fri/Sat holidays
          intermDates.push(iso);
        }
        dayNum++;
      }
      assert.equal(intermDates.length, 26);

      for (const dt of intermDates) {
        saveSectionAttendance(db, {
          academic_year_id: activeYear.id,
          grade_id: intermediateGrade.id,
          section_id: intermediateGrade.sections[0].id,
          attendance_date: dt,
          entries: [{ student_id: sInterm.id, status: 'full_day' }],
        });
      }

      const finalReport = getReportsCenterData(db, {
        academic_year_id: activeYear.id,
        report_type: 'final_warnings',
      });
      const intermRow = finalReport.rows.find((r) => r.student_id === sInterm.id);
      assert.ok(intermRow, 'sInterm must appear in final_warnings');
      assert.equal(intermRow.counted_legal_absence_days, 26);
      assert.equal(intermRow.attendance_score_deducted, 52);
      assert.equal(intermRow.conduct_failure_triggered, true);
      assert.equal(intermRow.reached_first_warning, true);
      assert.equal(intermRow.reached_final_warning, true);
      assert.equal(intermRow.remaining_days_to_next_threshold, 45 - 26); // 19
    });

    await test('6. تعديل أو حذف غياب ينعكس تلقائياً وفورياً على حالة الطالب في التقارير', async () => {
      // Find one absence record of sPrep and delete it (e.g. 2026-11-08 -> drops from 6 to 5, remaining becomes 10)
      const row = db
        .prepare("SELECT id FROM absences WHERE student_id = ? AND absence_date = '2026-11-08'")
        .get(sPrep.id) as { id: number };
      assert.ok(row);
      deleteAbsenceRecord(db, row.id);

      const afterDelete = getReportsCenterData(db, {
        academic_year_id: activeYear.id,
        report_type: 'preliminary_warnings',
      });
      const prepRow = afterDelete.rows.find((r) => r.student_id === sPrep.id);
      assert.ok(prepRow);
      assert.equal(prepRow.counted_legal_absence_days, 5);
      assert.equal(prepRow.remaining_days_to_next_threshold, 10);

      // Delete another day (2026-11-04) -> drops to 4 -> no longer reached preliminary (5)
      const row2 = db
        .prepare("SELECT id FROM absences WHERE student_id = ? AND absence_date = '2026-11-04'")
        .get(sPrep.id) as { id: number };
      deleteAbsenceRecord(db, row2.id);

      const afterSecondDelete = getReportsCenterData(db, {
        academic_year_id: activeYear.id,
        report_type: 'preliminary_warnings',
        include_approaching: false,
      });
      assert.equal(
        afterSecondDelete.rows.some((r) => r.student_id === sPrep.id),
        false
      );
    });

    await test('7. منع تكرار إصدار نفس الإنذار في نفس السنة إلا بتوثيق سبب إداري صريح', async () => {
      const firstIssue = await apiJson<{ id: number; procedure_type: string }>(
        '/reports/procedures',
        {
          method: 'POST',
          body: JSON.stringify({
            student_id: sPrep.id,
            academic_year_id: activeYear.id,
            procedure_type: 'preliminary_warning',
            procedure_date: '2026-11-12',
            delivery_method: 'تسليم باليد لولي الأمر',
            is_official_legal_issue: true,
          }),
        }
      );
      assert.equal(firstIssue.status, 201);

      const duplicateBlocked = await apiJson<{ error: string; code: string }>(
        '/reports/procedures',
        {
          method: 'POST',
          body: JSON.stringify({
            student_id: sPrep.id,
            academic_year_id: activeYear.id,
            procedure_type: 'preliminary_warning',
            procedure_date: '2026-11-15',
            is_official_legal_issue: true,
          }),
        }
      );
      assert.equal(duplicateBlocked.status, 409);
      assert.equal(duplicateBlocked.body.code, 'DUPLICATE_WARNING_PROCEDURE');

      const duplicateWithReason = await apiJson<{ id: number; override_reason: string }>(
        '/reports/procedures',
        {
          method: 'POST',
          body: JSON.stringify({
            student_id: sPrep.id,
            academic_year_id: activeYear.id,
            procedure_type: 'preliminary_warning',
            procedure_date: '2026-11-15',
            override_reason: 'فقدان النسخة الأولى وطلب نسخة بديلة لولي الأمر',
            is_official_legal_issue: true,
          }),
        }
      );
      assert.equal(duplicateWithReason.status, 201);
      assert.equal(
        duplicateWithReason.body.override_reason,
        'فقدان النسخة الأولى وطلب نسخة بديلة لولي الأمر'
      );
    });

    await test('8. تسجيل تبليغات واستدعاءات أولياء الأمور وتحديث نتيجة الاستدعاء وحفظ السجل التاريخي', async () => {
      const notif = createStudentLegalProcedure(db, {
        student_id: sInterm.id,
        academic_year_id: activeYear.id,
        procedure_type: 'guardian_notification',
        procedure_date: '2026-11-11',
        delivery_method: 'اتصال هاتفي',
      });
      assert.equal(notif.procedure_type, 'guardian_notification');

      const summons = createStudentLegalProcedure(db, {
        student_id: sInterm.id,
        academic_year_id: activeYear.id,
        procedure_type: 'guardian_summons',
        procedure_date: '2026-11-14',
        delivery_method: 'كتاب استدعاء رسمي',
        summons_result: 'قيد المتابعة',
      });

      const updatedSummons = updateStudentLegalProcedure(db, summons.id, {
        summons_result: 'حضر ولي الأمر ووقّع تعهداً خطياً بعدم تكرار الغياب',
      });
      assert.equal(
        updatedSummons.summons_result,
        'حضر ولي الأمر ووقّع تعهداً خطياً بعدم تكرار الغياب'
      );

      const summonsReport = getReportsCenterData(db, {
        academic_year_id: activeYear.id,
        report_type: 'guardian_summons',
      });
      const intermSummonsRow = summonsReport.rows.find((r) => r.student_id === sInterm.id);
      assert.ok(intermSummonsRow);
      assert.equal(intermSummonsRow.summons_count, 1);
      assert.equal(
        intermSummonsRow.last_summons_result,
        'حضر ولي الأمر ووقّع تعهداً خطياً بعدم تكرار الغياب'
      );
      assert.equal(intermSummonsRow.last_notification_date, '2026-11-11');
    });

    await test('9. عدم رجعية التعديلات عبر السنوات الدراسية + ربط الصفوف غير المعرّفة', async () => {
      // Map the unmapped grade via PATCH API
      const mapRes = await apiJson<{ stage: string }>(`/grades/${customGrade.id}/stage`, {
        method: 'PATCH',
        body: JSON.stringify({ stage: 'primary' }),
      });
      assert.equal(mapRes.status, 200);
      assert.equal(mapRes.body.stage, 'primary');

      // Create new academic year 2027-2028 and activate it (locks activeYear bindings)
      const nextYear = createAcademicYear(db, { name: '2027-2028', set_active: true });

      const regs2027 = listAllStageRegulations(db, nextYear.id);
      updateStageRegulation(db, 'preparatory', {
        ...regs2027.preparatory,
        effective_absence_limit: 60,
        final_effective_limit_days: 55,
        final_warning_days: 35,
        first_warning_days: 20,
        preliminary_warning_days: 8,
        academic_year_id: nextYear.id,
        change_summary: 'قواعد خاصة بسنة 2027-2028',
      });

      // Verify old year retains previous Preparatory thresholds (limit=45, prelim=5)
      const oldYearRegs = listAllStageRegulations(db, activeYear.id);
      assert.equal(oldYearRegs.preparatory.effective_absence_limit, 45);
      assert.equal(oldYearRegs.preparatory.preliminary_warning_days, 5);
      assert.equal(oldYearRegs.preparatory.is_historical_year_snapshot, true);

      // Verify new year uses updated Preparatory thresholds (limit=60, prelim=8)
      const newYearRegs = listAllStageRegulations(db, nextYear.id);
      assert.equal(newYearRegs.preparatory.effective_absence_limit, 60);
      assert.equal(newYearRegs.preparatory.preliminary_warning_days, 8);

      // Verify retroactive modification of locked old year fails with 409
      const retroAttempt = await apiJson<{ code: string }>('/legal-regulations/preparatory', {
        method: 'PUT',
        body: JSON.stringify({
          ...oldYearRegs.preparatory,
          effective_absence_limit: 99,
          academic_year_id: activeYear.id,
        }),
      });
      assert.equal(retroAttempt.status, 409);
      assert.equal(retroAttempt.body.code, 'HISTORICAL_YEAR_LOCKED');

      const versions = listRegulationVersions(db, 'preparatory');
      assert.ok(versions.length >= 3);
    });

    await test('10. تصدير ملف Excel وسلامة السجل الشهري والعطل الحالية', async () => {
      const excel = await generateReportsExcel(db, {
        academic_year_id: activeYear.id,
        report_type: 'final_warnings',
      });
      assert.ok(excel.buffer.byteLength > 2000, 'Excel workbook buffer must be valid and non-empty');
      assert.ok(excel.filename.endsWith('.xlsx'));

      const monthly = getMonthlyAbsenceRegister(db, {
        academic_year_id: activeYear.id,
        year: 2026,
        month: 11,
        grade_id: prepGrade.id,
        section_id: prepGrade.sections[0].id,
      });
      assert.equal(monthly.students.length, 1);

      const holidays = getWeeklyHolidaySettings(db);
      assert.equal(holidays.days.length, 7);

      // Verify GET /api/reports/export HTTP endpoint returns 200 xlsx
      const httpRes = await fetch(
        `${baseUrl}/reports/export?academic_year_id=${activeYear.id}&report_type=final_warnings`
      );
      assert.equal(httpRes.status, 200);
      assert.ok(
        (httpRes.headers.get('content-type') ?? '').includes('spreadsheetml.sheet'),
        'Must return Excel content type'
      );
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

void runTests();
