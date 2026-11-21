import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createDatabaseConnection } from '../server/db/connection';
import { createApiRouter } from '../server/routes/api';
import {
  createSingleAbsenceRecord,
  getSectionAttendanceSheet,
  getStudentAbsenceDetails,
  saveSectionAttendance,
} from '../server/services/absenceService';
import { getDashboardStats } from '../server/services/dashboardService';
import { createGrade } from '../server/services/gradeService';
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
import { getActiveAcademicYear } from '../server/services/settingsService';
import { createStudent } from '../server/services/studentService';

async function runHolidayTests() {
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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iraqi-school-holidays-'));
  const dbFilePath = path.join(tmpDir, 'test_holidays.db');

  let db = createDatabaseConnection(dbFilePath);

  const grade = createGrade(db, { name: 'الثالث المتوسط', initial_sections: ['أ'] });
  const secA = grade.sections[0];
  const activeYear = getActiveAcademicYear(db);

  const s1 = createStudent(db, {
    full_name: 'زين العابدين حيدر قاسم',
    grade_id: grade.id,
    section_id: secA.id,
    registry_number: '701',
  });
  const s2 = createStudent(db, {
    full_name: 'مصطفى عادل رحيم',
    grade_id: grade.id,
    section_id: secA.id,
    registry_number: '702',
  });

  // Test 1: Default Fri/Sat weekly holidays
  await test('1. التحقق من أن الجمعة والسبت عطلة افتراضياً وبقية الأيام دوام', () => {
    const weekly = getWeeklyHolidaySettings(db);
    assert.equal(weekly.reason, 'عطلة أسبوعية رسمية');
    assert.equal(weekly.days.length, 7);

    const holidayDays = weekly.days.filter((d) => d.is_holiday === 1).map((d) => d.day_of_week);
    assert.deepEqual(holidayDays, [5, 6]); // Friday (5) & Saturday (6)

    const friCheck = resolveDateHolidayStatus(db, '2026-11-06');
    assert.equal(friCheck.is_holiday, true);
    assert.equal(friCheck.is_weekly_holiday, true);
    assert.equal(friCheck.holiday_category, 'weekly');
    assert.equal(friCheck.day_name, 'الجمعة');
    assert.equal(friCheck.primary_reason, 'عطلة أسبوعية رسمية');

    const satCheck = resolveDateHolidayStatus(db, '2026-11-07');
    assert.equal(satCheck.is_holiday, true);
    assert.equal(satCheck.day_name, 'السبت');

    const sunCheck = resolveDateHolidayStatus(db, '2026-11-08');
    assert.equal(sunCheck.is_holiday, false);
    assert.equal(sunCheck.holiday_category, 'workday');
    assert.equal(sunCheck.day_name, 'الأحد');
  });

  // Test 2 & 3: Change weekly holidays to Thu/Fri & verify Saturday becomes workday and Sunday stays workday
  await test('2 و 3. تغيير العطلة الأسبوعية إلى الخميس والجمعة والتأكد من أن السبت والأحد أيام دوام', () => {
    const res = updateWeeklyHolidays(db, {
      holiday_days: [4, 5], // Thursday & Friday
      reason: 'عطلة نهاية الأسبوع (الخميس والجمعة)',
    });
    assert.equal(res.existing_records_warning, null);

    const thuCheck = resolveDateHolidayStatus(db, '2026-11-05'); // Thursday
    assert.equal(thuCheck.is_holiday, true);
    assert.equal(thuCheck.day_name, 'الخميس');
    assert.equal(thuCheck.primary_reason, 'عطلة نهاية الأسبوع (الخميس والجمعة)');

    const satCheck = resolveDateHolidayStatus(db, '2026-11-07'); // Saturday -> workday now!
    assert.equal(satCheck.is_holiday, false);
    assert.equal(satCheck.holiday_category, 'workday');

    const sunCheck = resolveDateHolidayStatus(db, '2026-11-08'); // Sunday -> workday!
    assert.equal(sunCheck.is_holiday, false);
    assert.equal(sunCheck.holiday_category, 'workday');

    // Restore Fri/Sat for remaining tests to stay clean on standard Iraqi calendar
    updateWeeklyHolidays(db, {
      holiday_days: [5, 6],
      reason: 'عطلة أسبوعية رسمية',
    });
  });

  // Test 4: Add a 1-day official holiday
  let officialHolidayId = 0;
  await test('4. إضافة عطلة رسمية ليوم واحد والتعرف عليها تلقائياً', () => {
    const res = createHoliday(db, {
      academic_year_id: activeYear.id,
      name: 'العيد الوطني العراقي',
      start_date: '2026-11-10', // Tuesday
      end_date: '2026-11-10',
      holiday_type: 'official',
      notes: 'عطلة رسمية وفق التقويم الرسمي',
    });
    officialHolidayId = res.holiday.id;
    assert.equal(res.holiday.days_count, 1);
    assert.equal(res.holiday.holiday_type, 'official');
    assert.equal(res.existing_records_warning, null);

    const check = resolveDateHolidayStatus(db, '2026-11-10');
    assert.equal(check.is_holiday, true);
    assert.equal(check.is_official_or_special_holiday, true);
    assert.equal(check.holiday_category, 'official');
    assert.equal(check.primary_reason, 'العيد الوطني العراقي');
  });

  // Test 5: Add multi-day holiday & reject overlapping holiday
  let multiHolidayId = 0;
  await test('5. إضافة عطلة متعددة الأيام ومنع تداخل العطل', () => {
    const res = createHoliday(db, {
      academic_year_id: activeYear.id,
      name: 'عطلة أمطار وظروف جوية استثنائية',
      start_date: '2026-11-15', // Sun
      end_date: '2026-11-17', // Tue
      holiday_type: 'exceptional',
      notes: 'قرار مديرية التربية',
    });
    multiHolidayId = res.holiday.id;
    assert.equal(res.holiday.days_count, 3);

    // Verify all 3 days are recognized
    for (const dt of ['2026-11-15', '2026-11-16', '2026-11-17']) {
      const c = resolveDateHolidayStatus(db, dt);
      assert.equal(c.is_holiday, true);
      assert.equal(c.holiday_category, 'exceptional');
      assert.equal(c.primary_reason, 'عطلة أمطار وظروف جوية استثنائية');
    }

    // Verify overlapping holiday fails cleanly with 409 conflict
    assert.throws(
      () =>
        createHoliday(db, {
          academic_year_id: activeYear.id,
          name: 'عطلة متداخلة',
          start_date: '2026-11-16',
          end_date: '2026-11-18',
          holiday_type: 'school_specific',
        }),
      /تتعارض فترة هذه العطلة مع عطلة مسجلة مسبقاً/
    );

    // Also test editing the multi-day holiday notes without self-overlap error
    const updated = updateHoliday(db, multiHolidayId, {
      academic_year_id: activeYear.id,
      name: 'عطلة أمطار وظروف جوية استثنائية',
      start_date: '2026-11-15',
      end_date: '2026-11-17',
      holiday_type: 'exceptional',
      notes: 'كتاب رسمي معدل',
    });
    assert.equal(updated.holiday.notes, 'كتاب رسمي معدل');
  });

  // Test 6 & 7: Block recording absence on holiday & ensure lesson counter unaffected
  await test('6 و 7. منع تسجيل الغياب في يوم العطلة وعدم تأثر عداد الدروس أو أيام الغياب', () => {
    // First record 2 missed lessons on a normal workday (2026-11-01 Sunday)
    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-01',
      entries: [
        { student_id: s1.id, status: 'lesson_absence', lessons_count: 2 },
        { student_id: s2.id, status: 'full_day' },
      ],
    });

    // Attempt batch attendance on weekly holiday (2026-11-06 Friday) -> MUST throw
    assert.throws(
      () =>
        saveSectionAttendance(db, {
          academic_year_id: activeYear.id,
          grade_id: grade.id,
          section_id: secA.id,
          attendance_date: '2026-11-06',
          entries: [
            { student_id: s1.id, status: 'full_day' },
            { student_id: s2.id, status: 'lesson_absence', lessons_count: 3 },
          ],
        }),
      /لا يمكن تسجيل الحضور أو الغياب.*يوم عطلة/
    );

    // Attempt batch attendance on official holiday (2026-11-10) -> MUST throw
    assert.throws(
      () =>
        saveSectionAttendance(db, {
          academic_year_id: activeYear.id,
          grade_id: grade.id,
          section_id: secA.id,
          attendance_date: '2026-11-10',
          entries: [
            { student_id: s1.id, status: 'lesson_absence', lessons_count: 4 },
            { student_id: s2.id, status: 'present' },
          ],
        }),
      /العيد الوطني العراقي/
    );

    // Attempt single absence record on exceptional holiday (2026-11-16) -> MUST throw
    assert.throws(
      () =>
        createSingleAbsenceRecord(db, {
          student_id: s1.id,
          academic_year_id: activeYear.id,
          absence_date: '2026-11-16',
          status: 'lesson_absence',
          lessons_count: 3,
        }),
      /عطلة أمطار وظروف جوية استثنائية/
    );

    // Verify lesson counters and full days stayed untouched!
    const s1Detail = getStudentAbsenceDetails(db, s1.id, activeYear.id);
    assert.equal(s1Detail.pending_lessons, 2);
    assert.equal(s1Detail.total_lessons_missed, 2);
    assert.equal(s1Detail.total_full_days, 0);

    const s2Detail = getStudentAbsenceDetails(db, s2.id, activeYear.id);
    assert.equal(s2Detail.direct_full_days, 1);
    assert.equal(s2Detail.total_full_days, 1);
    assert.equal(s2Detail.pending_lessons, 0);

    const dash = getDashboardStats(db, activeYear.id);
    assert.equal(dash.absence_days_count, 1);
  });

  // Test 8: Display accurate holiday reason inside attendance sheet
  await test('8. عرض سبب العطلة بدقة داخل ورقة تسجيل الغيابات', () => {
    const officialSheet = getSectionAttendanceSheet(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-10',
    });
    assert.equal(officialSheet.holiday_info.is_holiday, true);
    assert.equal(officialSheet.holiday_info.holiday_category, 'official');
    assert.equal(officialSheet.holiday_info.primary_reason, 'العيد الوطني العراقي');
    assert.equal(officialSheet.holiday_info.matching_holidays[0].notes, 'عطلة رسمية وفق التقويم الرسمي');

    const weeklySheet = getSectionAttendanceSheet(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-06',
    });
    assert.equal(weeklySheet.holiday_info.is_holiday, true);
    assert.equal(weeklySheet.holiday_info.holiday_category, 'weekly');
    assert.equal(weeklySheet.holiday_info.primary_reason, 'عطلة أسبوعية رسمية');
  });

  // Test 10 (before reopen, then reopen in Test 9): Old absence records remain untouched + warning shown
  await test('10. عدم تعديل أو حذف السجلات التاريخية القديمة عند إضافة عطلة على تاريخ مسجل مسبقاً مع إرجاع تنبيه واضح', () => {
    // 2026-11-01 already has attendance records for s1 (lesson_absence 2) and s2 (full_day 1)!
    const saveRes = createHoliday(db, {
      academic_year_id: activeYear.id,
      name: 'عطلة بأثر إداري لاحق',
      start_date: '2026-11-01',
      end_date: '2026-11-01',
      holiday_type: 'school_specific',
    });

    assert.ok(saveRes.existing_records_warning !== null);
    assert.equal(saveRes.existing_records_warning!.has_existing_records, true);
    assert.equal(saveRes.existing_records_warning!.records_count, 2);
    assert.deepEqual(saveRes.existing_records_warning!.dates, ['2026-11-01']);

    // Verify existing records were NOT deleted or modified
    const s1Detail = getStudentAbsenceDetails(db, s1.id, activeYear.id);
    assert.equal(s1Detail.records.length, 1);
    assert.equal(s1Detail.pending_lessons, 2);

    const s2Detail = getStudentAbsenceDetails(db, s2.id, activeYear.id);
    assert.equal(s2Detail.records.length, 1);
    assert.equal(s2Detail.total_full_days, 1);

    // Even when viewing the sheet on 2026-11-01 now, session and historical rows are preserved!
    const nov1Sheet = getSectionAttendanceSheet(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-01',
    });
    assert.ok(nov1Sheet.session !== null);
    assert.equal(nov1Sheet.holiday_info.is_holiday, true);
    assert.equal(nov1Sheet.students.find((r) => r.student_id === s1.id)!.lessons_count, 2);
  });

  // Test 9 + Monthly Calendar readiness + HTTP API roundtrip + DB Reopen
  await test('9. حفظ العطل وإعداداتها في SQLite وبقاؤها بعد إعادة الفتح وجاهزية بيانات السجل الشهري + API', async () => {
    db.close();
    db = createDatabaseConnection(dbFilePath);

    const reopenedWeekly = getWeeklyHolidaySettings(db);
    assert.equal(reopenedWeekly.reason, 'عطلة أسبوعية رسمية');
    assert.deepEqual(
      reopenedWeekly.days.filter((d) => d.is_holiday === 1).map((d) => d.day_of_week),
      [5, 6]
    );

    const reopenedHolidays = listHolidays(db, activeYear.id);
    assert.equal(reopenedHolidays.length, 3);
    assert.ok(reopenedHolidays.some((h) => h.id === officialHolidayId && h.name === 'العيد الوطني العراقي'));

    // Verify monthly calendar helper structure for future Monthly Register
    const novCal = getMonthHolidayCalendar(db, 2026, 11);
    assert.equal(novCal.length, 30);
    const day6 = novCal.find((d) => d.date === '2026-11-06')!;
    assert.equal(day6.holiday_category, 'weekly');
    assert.equal(day6.counts_as_school_day, false);

    const day10 = novCal.find((d) => d.date === '2026-11-10')!;
    assert.equal(day10.holiday_category, 'official');
    assert.equal(day10.reason, 'العيد الوطني العراقي');
    assert.equal(day10.counts_as_school_day, false);

    const day12 = novCal.find((d) => d.date === '2026-11-12')!;
    assert.equal(day12.holiday_category, 'workday');
    assert.equal(day12.counts_as_school_day, true);

    // HTTP API verification
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(() => db));
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const baseUrl = `http://127.0.0.1:${addr.port}/api`;

    try {
      const checkRes = await fetch(`${baseUrl}/holidays/check?date=2026-11-10`);
      assert.equal(checkRes.status, 200);
      const checkJson = (await checkRes.json()) as { is_holiday: boolean; primary_reason: string };
      assert.equal(checkJson.is_holiday, true);
      assert.equal(checkJson.primary_reason, 'العيد الوطني العراقي');

      const blockPost = await fetch(`${baseUrl}/absences/sheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          academic_year_id: activeYear.id,
          grade_id: grade.id,
          section_id: secA.id,
          attendance_date: '2026-11-10',
          entries: [
            { student_id: s1.id, status: 'full_day' },
            { student_id: s2.id, status: 'present' },
          ],
        }),
      });
      assert.equal(blockPost.status, 409);

      const monthRes = await fetch(`${baseUrl}/holidays/month?year=2026&month=11`);
      assert.equal(monthRes.status, 200);
      const monthJson = (await monthRes.json()) as Array<{ date: string }>;
      assert.equal(monthJson.length, 30);

      // Delete one holiday and confirm it restores as workday
      const delRes = await fetch(`${baseUrl}/holidays/${officialHolidayId}`, {
        method: 'DELETE',
      });
      assert.equal(delRes.status, 200);
      const afterDel = resolveDateHolidayStatus(db, '2026-11-10');
      assert.equal(afterDel.is_holiday, false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // Delete multi-day holiday via service too
    deleteHoliday(db, multiHolidayId);
    assert.equal(resolveDateHolidayStatus(db, '2026-11-16').is_holiday, false);
  });

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nHolidays Summary: ${results.length - failed.length}/${results.length} tests passed.`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

runHolidayTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
