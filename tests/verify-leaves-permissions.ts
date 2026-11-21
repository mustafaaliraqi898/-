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
import { createGrade } from '../server/services/gradeService';
import {
  getActiveAcademicYear,
  getSchoolSettings,
  updateSchoolSettings,
} from '../server/services/settingsService';
import { createStudent } from '../server/services/studentService';

async function runLeavesAndPermissionsTests() {
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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iraqi-school-leaves-'));
  const dbFilePath = path.join(tmpDir, 'test_leaves.db');

  let db = createDatabaseConnection(dbFilePath);

  const grade = createGrade(db, { name: 'الثاني المتوسط', initial_sections: ['أ'] });
  const secA = grade.sections[0];
  const activeYear = getActiveAcademicYear(db);

  // Ensure initial settings: 5 lessons = 1 absence day, 7 daily lessons
  updateSchoolSettings(db, {
    school_name: 'متوسطة النور',
    directorate_name: 'تربية الرصافة الأولى',
    lessons_per_absence_day: 5,
    daily_lessons_count: 7,
    daily_permission_counts_as_absence: 0,
    lesson_permission_counts_as_absence: 0,
  });

  const s1 = createStudent(db, {
    full_name: 'ياسين طارق مجيد',
    grade_id: grade.id,
    section_id: secA.id,
    registry_number: '901',
  });
  const s2 = createStudent(db, {
    full_name: 'مرتضى سعدون كريم',
    grade_id: grade.id,
    section_id: secA.id,
    registry_number: '902',
  });
  const s3 = createStudent(db, {
    full_name: 'عبد الرحمن فلاح حسن',
    grade_id: grade.id,
    section_id: secA.id,
    registry_number: '903',
  });

  // 1. Sick leave never counts as absence
  await test('1. تسجيل إجازة مرضية والتأكد من عدم احتسابها غياباً', () => {
    const res = saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-01',
      entries: [
        { student_id: s1.id, status: 'full_day_leave', leave_type: 'sick_leave' },
        { student_id: s2.id, status: 'present' },
        { student_id: s3.id, status: 'present' },
      ],
    });
    assert.equal(res.full_day_leave_count, 1);
    const s1Row = res.sheet.students.find((r) => r.student_id === s1.id)!;
    assert.equal(s1Row.status, 'full_day_leave');
    assert.equal(s1Row.leave_type, 'sick_leave');
    assert.equal(s1Row.counted_as_absence, 0);
    assert.equal(s1Row.sick_leave_days, 1);
    assert.equal(s1Row.direct_full_days, 0);
    assert.equal(s1Row.total_full_days, 0);
    assert.equal(s1Row.pending_lessons, 0);
  });

  // 2. Daily permission with setting = count as full day absence
  await test('2. تسجيل رخصة يومية مع إعداد احتساب الغياب', () => {
    updateSchoolSettings(db, {
      school_name: 'متوسطة النور',
      directorate_name: 'تربية الرصافة الأولى',
      daily_permission_counts_as_absence: 1,
    });

    const res = saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-02',
      entries: [
        { student_id: s1.id, status: 'full_day_leave', leave_type: 'daily_permission' },
        { student_id: s2.id, status: 'present' },
        { student_id: s3.id, status: 'present' },
      ],
    });

    const s1Row = res.sheet.students.find((r) => r.student_id === s1.id)!;
    assert.equal(s1Row.status, 'full_day_leave');
    assert.equal(s1Row.leave_type, 'daily_permission');
    assert.equal(s1Row.counted_as_absence, 1);
    assert.equal(s1Row.permission_rule_snapshot, 1);
    assert.equal(s1Row.daily_permission_days, 1);
    assert.equal(s1Row.counted_daily_permission_days, 1);
    assert.equal(s1Row.total_full_days, 1);
  });

  // 3. Daily permission with setting = do not count as absence (historical 11-02 stays counted!)
  await test('3. تسجيل رخصة يومية مع إعداد عدم احتساب الغياب وبقاء التاريخي محفوظاً', () => {
    updateSchoolSettings(db, {
      school_name: 'متوسطة النور',
      directorate_name: 'تربية الرصافة الأولى',
      daily_permission_counts_as_absence: 0,
    });

    const res = saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-03',
      entries: [
        { student_id: s1.id, status: 'full_day_leave', leave_type: 'daily_permission' },
        { student_id: s2.id, status: 'present' },
        { student_id: s3.id, status: 'present' },
      ],
    });

    const s1Row = res.sheet.students.find((r) => r.student_id === s1.id)!;
    assert.equal(s1Row.counted_as_absence, 0);
    assert.equal(s1Row.permission_rule_snapshot, 0);
    assert.equal(s1Row.daily_permission_days, 2);
    // Nov 2 remained counted (1), Nov 3 is uncounted (0) -> total stays 1
    assert.equal(s1Row.counted_daily_permission_days, 1);
    assert.equal(s1Row.total_full_days, 1);
  });

  // 4. Lesson permission (1 lesson) with setting = count as lesson absence
  await test('4. تسجيل رخصة عن درس واحد مع إعداد احتساب الغياب', () => {
    updateSchoolSettings(db, {
      school_name: 'متوسطة النور',
      directorate_name: 'تربية الرصافة الأولى',
      lesson_permission_counts_as_absence: 1,
    });

    const res = saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-04',
      entries: [
        { student_id: s1.id, status: 'present' },
        { student_id: s2.id, status: 'lesson_permission', lesson_numbers: [3] },
        { student_id: s3.id, status: 'present' },
      ],
    });

    assert.equal(res.lesson_permission_count, 1);
    const s2Row = res.sheet.students.find((r) => r.student_id === s2.id)!;
    assert.equal(s2Row.status, 'lesson_permission');
    assert.deepEqual(s2Row.lesson_numbers, [3]);
    assert.equal(s2Row.lessons_count, 1);
    assert.equal(s2Row.counted_as_absence, 1);
    assert.equal(s2Row.permission_rule_snapshot, 1);
    assert.equal(s2Row.pending_lessons, 1);
    assert.equal(s2Row.total_lessons_missed, 1);
  });

  // 5. Lesson permission across multiple lessons (e.g. lessons 1, 4, 7)
  await test('5. تسجيل رخصة عن عدة دروس (الدرس الأول، الرابع، السابع)', () => {
    const res = saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-05',
      entries: [
        { student_id: s1.id, status: 'present' },
        { student_id: s2.id, status: 'lesson_permission', lesson_numbers: [7, 1, 4] },
        { student_id: s3.id, status: 'present' },
      ],
    });

    const s2Row = res.sheet.students.find((r) => r.student_id === s2.id)!;
    assert.deepEqual(s2Row.lesson_numbers, [1, 4, 7]);
    assert.equal(s2Row.lessons_count, 3);
    assert.equal(s2Row.counted_as_absence, 1);
    // 1 (Nov 4) + 3 (Nov 5) = 4 pending lessons (< 5)
    assert.equal(s2Row.pending_lessons, 4);
    assert.equal(s2Row.converted_lesson_days, 0);
  });

  // 6. Lesson permission with setting = do not count as absence
  await test('6. تسجيل رخصة عن درس مع إعداد عدم الاحتساب وحفظ التفاصيل', () => {
    updateSchoolSettings(db, {
      school_name: 'متوسطة النور',
      directorate_name: 'تربية الرصافة الأولى',
      lesson_permission_counts_as_absence: 0,
    });

    const res = saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-08',
      entries: [
        { student_id: s1.id, status: 'present' },
        { student_id: s2.id, status: 'lesson_permission', lesson_numbers: [2, 5] },
        { student_id: s3.id, status: 'lesson_permission', lesson_numbers: [6] },
      ],
    });

    const s2Row = res.sheet.students.find((r) => r.student_id === s2.id)!;
    assert.deepEqual(s2Row.lesson_numbers, [2, 5]);
    assert.equal(s2Row.counted_as_absence, 0);
    assert.equal(s2Row.permission_rule_snapshot, 0);
    // Must stay at 4 (Nov 8 uncounted lessons must NOT enter counter!)
    assert.equal(s2Row.pending_lessons, 4);

    const s3Row = res.sheet.students.find((r) => r.student_id === s3.id)!;
    assert.deepEqual(s3Row.lesson_numbers, [6]);
    assert.equal(s3Row.counted_as_absence, 0);
    assert.equal(s3Row.pending_lessons, 0);
  });

  // 7. Counted lesson permissions + direct lesson absences accumulate & convert to full day without losing details
  await test('7. دخول الرخص المحتسبة في عداد الدروس والتحويل ليوم غياب مع بقاء التفاصيل', () => {
    // s2 currently has 4 counted pending lessons (1 from Nov 4 + 3 from Nov 5).
    // Add 1 direct lesson_absence -> reaches 5 -> converts to 1 full day, resets pending to 0!
    const res = saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-09',
      entries: [
        { student_id: s1.id, status: 'present' },
        { student_id: s2.id, status: 'lesson_absence', lessons_count: 1 },
        { student_id: s3.id, status: 'present' },
      ],
    });
    assert.equal(res.newly_converted_days, 1);

    const s2Details = getStudentAbsenceDetails(db, s2.id, activeYear.id);
    assert.equal(s2Details.converted_lesson_days, 1);
    assert.equal(s2Details.pending_lessons, 0);
    assert.equal(s2Details.total_lessons_missed, 5);
    assert.equal(s2Details.total_full_days, 1);

    // Verify original lesson numbers on Nov 5 [1, 4, 7] and Nov 8 [2, 5] are preserved
    const nov5 = s2Details.records.find((r) => r.absence_date === '2026-11-05')!;
    const nov8 = s2Details.records.find((r) => r.absence_date === '2026-11-08')!;
    assert.deepEqual(nov5.lesson_numbers, [1, 4, 7]);
    assert.equal(nov5.counted_as_absence, 1);
    assert.deepEqual(nov8.lesson_numbers, [2, 5]);
    assert.equal(nov8.counted_as_absence, 0);
  });

  // 8. Direct full day absence stays independent of leaves/permissions & lesson counter
  await test('8. الغياب اليومي المباشر لا يتأثر بعمليات الإجازات والرخص والعداد', () => {
    const res = saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-10',
      entries: [
        { student_id: s1.id, status: 'full_day' },
        { student_id: s2.id, status: 'full_day' },
        { student_id: s3.id, status: 'full_day_leave', leave_type: 'sick_leave' },
      ],
    });

    const s1Row = res.sheet.students.find((r) => r.student_id === s1.id)!;
    assert.equal(s1Row.direct_full_days, 1);
    assert.equal(s1Row.counted_daily_permission_days, 1);
    assert.equal(s1Row.total_full_days, 2);

    const s2Row = res.sheet.students.find((r) => r.student_id === s2.id)!;
    assert.equal(s2Row.direct_full_days, 1);
    assert.equal(s2Row.converted_lesson_days, 1);
    assert.equal(s2Row.total_full_days, 2);
    assert.equal(s2Row.pending_lessons, 0);

    // Reject conflicting duplicate or invalid combinations
    assert.throws(
      () =>
        createSingleAbsenceRecord(db, {
          student_id: s1.id,
          academic_year_id: activeYear.id,
          absence_date: '2026-11-10',
          status: 'full_day_leave',
          leave_type: 'sick_leave',
        }),
      /لا يمكن تكرار التسجيل في التاريخ نفسه/
    );
    assert.throws(
      () =>
        createSingleAbsenceRecord(db, {
          student_id: s1.id,
          academic_year_id: activeYear.id,
          absence_date: '2026-11-11',
          status: 'lesson_permission',
          lesson_numbers: [8], // max daily lessons is 7
        }),
      /غير صالح/
    );
  });

  // 9. Editing previous leave or permission recalculates balances & preserves unchanged historical rows
  await test('9. تعديل إجازة أو رخصة سابقة وإعادة احتساب الأرصدة بدقة', () => {
    // Re-save Nov 2 changing ONLY s2 from present -> full_day_leave (sick_leave),
    // while s1 remains untouched as daily_permission (historical counted_as_absence = 1 MUST stay 1 even though setting is now 0!)
    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-02',
      entries: [
        { student_id: s1.id, status: 'full_day_leave', leave_type: 'daily_permission' },
        { student_id: s2.id, status: 'full_day_leave', leave_type: 'sick_leave' },
        { student_id: s3.id, status: 'present' },
      ],
    });
    const s1Check = getStudentAbsenceDetails(db, s1.id, activeYear.id);
    assert.equal(s1Check.counted_daily_permission_days, 1);
    assert.equal(s1Check.total_full_days, 2); // 1 direct + 1 counted daily permission

    // Now explicitly edit s2 on Nov 5 (previously [1, 4, 7] counted) -> change to [1, 4] (setting lesson_permission is now 0)
    // Nov 4 (1 lesson) + Nov 9 (1 lesson) = 2 < 5, so converted day MUST be removed cleanly!
    const editRes = saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-05',
      entries: [
        { student_id: s1.id, status: 'present' },
        { student_id: s2.id, status: 'lesson_permission', lesson_numbers: [1, 4] },
        { student_id: s3.id, status: 'present' },
      ],
    });
    assert.equal(editRes.newly_converted_days, -1);

    const s2After = getStudentAbsenceDetails(db, s2.id, activeYear.id);
    assert.equal(s2After.converted_lesson_days, 0);
    assert.equal(s2After.pending_lessons, 2); // 1 from Nov 4 + 1 from Nov 9
    assert.equal(s2After.direct_full_days, 1);
    assert.equal(s2After.total_full_days, 1);
    const nov5Edited = s2After.records.find((r) => r.absence_date === '2026-11-05')!;
    assert.deepEqual(nov5Edited.lesson_numbers, [1, 4]);
    assert.equal(nov5Edited.counted_as_absence, 0); // reflects active setting (0) at time of edit

    // Also edit s1 on Nov 2 from daily_permission (counted) -> sick_leave (uncounted)
    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-02',
      entries: [
        { student_id: s1.id, status: 'full_day_leave', leave_type: 'sick_leave' },
        { student_id: s2.id, status: 'full_day_leave', leave_type: 'sick_leave' },
        { student_id: s3.id, status: 'present' },
      ],
    });
    const s1After = getStudentAbsenceDetails(db, s1.id, activeYear.id);
    assert.equal(s1After.counted_daily_permission_days, 0);
    assert.equal(s1After.sick_leave_days, 2); // Nov 1 + Nov 2
    assert.equal(s1After.total_full_days, 1); // Only Nov 10 direct full_day remains
  });

  // 10. Reopen DB + verify HTTP API roundtrip + persistence
  await test('10. إعادة فتح قاعدة البيانات والتحقق من بقاء جميع البيانات والإعدادات وواجهات API', async () => {
    db.close();
    db = createDatabaseConnection(dbFilePath);

    const reopenedSettings = getSchoolSettings(db);
    assert.equal(reopenedSettings.daily_lessons_count, 7);
    assert.equal(reopenedSettings.daily_permission_counts_as_absence, 0);
    assert.equal(reopenedSettings.lesson_permission_counts_as_absence, 0);

    const sheetNov8 = getSectionAttendanceSheet(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-08',
    });
    const s2Row = sheetNov8.students.find((r) => r.student_id === s2.id)!;
    assert.equal(s2Row.status, 'lesson_permission');
    assert.deepEqual(s2Row.lesson_numbers, [2, 5]);
    assert.equal(s2Row.counted_as_absence, 0);

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
      const putRes = await fetch(`${baseUrl}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          school_name: 'متوسطة النور',
          directorate_name: 'تربية الرصافة الأولى',
          lessons_per_absence_day: 5,
          daily_lessons_count: 6,
          daily_permission_counts_as_absence: 1,
          lesson_permission_counts_as_absence: 1,
        }),
      });
      assert.equal(putRes.status, 200);
      const updated = (await putRes.json()) as {
        daily_lessons_count: number;
        daily_permission_counts_as_absence: number;
        lesson_permission_counts_as_absence: number;
      };
      assert.equal(updated.daily_lessons_count, 6);
      assert.equal(updated.daily_permission_counts_as_absence, 1);
      assert.equal(updated.lesson_permission_counts_as_absence, 1);

      const postSheet = await fetch(`${baseUrl}/absences/sheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          academic_year_id: activeYear.id,
          grade_id: grade.id,
          section_id: secA.id,
          attendance_date: '2026-11-12',
          entries: [
            { student_id: s1.id, status: 'present' },
            { student_id: s2.id, status: 'lesson_permission', lesson_numbers: [1, 2, 3] },
            { student_id: s3.id, status: 'full_day_leave', leave_type: 'daily_permission' },
          ],
        }),
      });
      assert.equal(postSheet.status, 200);
      const savedData = (await postSheet.json()) as { newly_converted_days: number };
      // s2 had 2 pending + 3 new counted = 5 -> converts 1 day!
      assert.equal(savedData.newly_converted_days, 1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nLeaves & Permissions Summary: ${results.length - failed.length}/${results.length} tests passed.`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

runLeavesAndPermissionsTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
