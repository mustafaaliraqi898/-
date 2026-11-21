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
  deleteAbsenceRecord,
  getSectionAttendanceSheet,
  getStudentAbsenceDetails,
  saveSectionAttendance,
} from '../server/services/absenceService';
import { getDashboardStats } from '../server/services/dashboardService';
import { createGrade } from '../server/services/gradeService';
import { getActiveAcademicYear, getSchoolSettings, updateSchoolSettings } from '../server/services/settingsService';
import { createStudent } from '../server/services/studentService';

async function runPhase2Tests() {
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

  // Use a real temporary SQLite file on disk to test persistence across DB reopen (Test #9)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iraqi-school-phase2-'));
  const dbFilePath = path.join(tmpDir, 'test_attendance.db');

  let db = createDatabaseConnection(dbFilePath);

  const grade = createGrade(db, { name: 'الأول المتوسط', initial_sections: ['أ', 'ب'] });
  const secA = grade.sections[0];
  const activeYear = getActiveAcademicYear(db);

  const s1 = createStudent(db, {
    full_name: 'أحمد محمد علي كاظم',
    grade_id: grade.id,
    section_id: secA.id,
    registry_number: '501',
  });
  const s2 = createStudent(db, {
    full_name: 'علي حسين جاسم محمد',
    grade_id: grade.id,
    section_id: secA.id,
    registry_number: '502',
  });
  const s3 = createStudent(db, {
    full_name: 'حسن كريم عبد الله',
    grade_id: grade.id,
    section_id: secA.id,
    registry_number: '503',
  });

  await test('1. Mark all students present ("الكل حاضر") and save sheet', () => {
    const saveRes = saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-01',
      entries: [
        { student_id: s1.id, status: 'present' },
        { student_id: s2.id, status: 'present' },
        { student_id: s3.id, status: 'present' },
      ],
    });
    assert.equal(saveRes.saved_count, 3);
    assert.equal(saveRes.present_count, 3);
    assert.equal(saveRes.full_day_count, 0);
    assert.equal(saveRes.lesson_absence_count, 0);
    assert.ok(saveRes.sheet.session !== null);
    assert.equal(saveRes.sheet.students.every((st) => st.status === 'present' && st.has_saved_record), true);
  });

  await test('2. Record one student as Full Day absent ("غياب يوم كامل")', () => {
    const res = saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-02',
      entries: [
        { student_id: s1.id, status: 'full_day' },
        { student_id: s2.id, status: 'present' },
        { student_id: s3.id, status: 'present' },
      ],
    });
    assert.equal(res.full_day_count, 1);
    const s1Row = res.sheet.students.find((r) => r.student_id === s1.id)!;
    assert.equal(s1Row.direct_full_days, 1);
    assert.equal(s1Row.converted_lesson_days, 0);
    assert.equal(s1Row.total_full_days, 1);
    assert.equal(s1Row.pending_lessons, 0);
  });

  await test('3. Record 1 lesson absence for a student ("غياب درس واحد")', () => {
    const res = saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-03',
      entries: [
        { student_id: s1.id, status: 'present' },
        { student_id: s2.id, status: 'lesson_absence', lessons_count: 1 },
        { student_id: s3.id, status: 'present' },
      ],
    });
    const s2Row = res.sheet.students.find((r) => r.student_id === s2.id)!;
    assert.equal(s2Row.pending_lessons, 1);
    assert.equal(s2Row.total_lessons_missed, 1);
    assert.equal(s2Row.converted_lesson_days, 0);
    assert.equal(s2Row.total_full_days, 0);
  });

  await test('4. Accumulate multiple lessons over different days (1 + 2 = 3 < 5, no day conversion yet)', () => {
    const res = saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-04',
      entries: [
        { student_id: s1.id, status: 'present' },
        { student_id: s2.id, status: 'lesson_absence', lessons_count: 2 },
        { student_id: s3.id, status: 'lesson_absence', lessons_count: 4 },
      ],
    });
    const s2Row = res.sheet.students.find((r) => r.student_id === s2.id)!;
    const s3Row = res.sheet.students.find((r) => r.student_id === s3.id)!;
    assert.equal(s2Row.pending_lessons, 3);
    assert.equal(s2Row.converted_lesson_days, 0);
    // 4 lessons stays pending without converting to a full day
    assert.equal(s3Row.pending_lessons, 4);
    assert.equal(s3Row.converted_lesson_days, 0);
  });

  await test('5. Reaching 5 lessons converts to 1 full day, resets counter to 0, and preserves original records', () => {
    // s2 currently has 1 + 2 = 3 lessons -> add 2 more = 5 -> converts 1 day, pending = 0
    // s3 currently has 4 lessons -> add 2 more = 6 -> converts 1 day, pending = 1
    const res = saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-05',
      entries: [
        { student_id: s1.id, status: 'present' },
        { student_id: s2.id, status: 'lesson_absence', lessons_count: 2 },
        { student_id: s3.id, status: 'lesson_absence', lessons_count: 2 },
      ],
    });
    assert.equal(res.newly_converted_days, 2);

    const s2Detail = getStudentAbsenceDetails(db, s2.id, activeYear.id);
    assert.equal(s2Detail.converted_lesson_days, 1);
    assert.equal(s2Detail.pending_lessons, 0);
    assert.equal(s2Detail.total_lessons_missed, 5);
    assert.equal(s2Detail.conversions.length, 1);
    assert.equal(s2Detail.conversions[0].converted_date, '2026-11-05');
    assert.equal(s2Detail.conversions[0].lessons_consumed, 5);
    // All 3 original daily lesson records stay preserved
    assert.equal(
      s2Detail.records.filter((r) => r.status === 'lesson_absence').length,
      3
    );

    const s3Detail = getStudentAbsenceDetails(db, s3.id, activeYear.id);
    assert.equal(s3Detail.converted_lesson_days, 1);
    assert.equal(s3Detail.pending_lessons, 1);
    assert.equal(s3Detail.total_lessons_missed, 6);
  });

  await test('6. Direct Full Day absence stays completely independent of lesson counter', () => {
    // s3 has pending_lessons = 1, converted_lesson_days = 1, direct_full_days = 0
    // Record full_day on 2026-11-06 -> direct_full_days becomes 1, total = 2, pending stays 1
    const res = saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-06',
      entries: [
        { student_id: s1.id, status: 'present' },
        { student_id: s2.id, status: 'present' },
        { student_id: s3.id, status: 'full_day' },
      ],
    });
    const s3Row = res.sheet.students.find((r) => r.student_id === s3.id)!;
    assert.equal(s3Row.direct_full_days, 1);
    assert.equal(s3Row.converted_lesson_days, 1);
    assert.equal(s3Row.total_full_days, 2);
    assert.equal(s3Row.pending_lessons, 1);
  });

  await test('7. Editing a previous record recalculates balances accurately & threshold setting change affects future only', () => {
    // Edit 2026-11-05 for s2: reduce lessons_count from 2 to 1 -> total becomes 1+1+1 = 3 -> converted day removed, pending = 3
    const editRes = saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-05',
      entries: [
        { student_id: s1.id, status: 'present' },
        { student_id: s2.id, status: 'lesson_absence', lessons_count: 1 },
        { student_id: s3.id, status: 'lesson_absence', lessons_count: 2 },
      ],
    });
    assert.equal(editRes.newly_converted_days, -1);

    const s2AfterEdit = getStudentAbsenceDetails(db, s2.id, activeYear.id);
    assert.equal(s2AfterEdit.converted_lesson_days, 0);
    assert.equal(s2AfterEdit.pending_lessons, 4);

    // Also test changing s1 on 2026-11-02 from full_day -> present
    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-02',
      entries: [
        { student_id: s1.id, status: 'present' },
        { student_id: s2.id, status: 'present' },
        { student_id: s3.id, status: 'present' },
      ],
    });
    const s1AfterEdit = getStudentAbsenceDetails(db, s1.id, activeYear.id);
    assert.equal(s1AfterEdit.direct_full_days, 0);
    assert.equal(s1AfterEdit.total_full_days, 0);

    // Change Settings threshold from 5 to 3 -> must NOT retroactively convert s2's existing 4 historical lessons!
    const updatedSettings = updateSchoolSettings(db, {
      school_name: 'المدرسة النموذجية',
      directorate_name: 'المديرية العامة للتربية',
      lessons_per_absence_day: 3,
    });
    assert.equal(updatedSettings.lessons_per_absence_day, 3);

    const s2BeforeFuture = getStudentAbsenceDetails(db, s2.id, activeYear.id);
    assert.equal(s2BeforeFuture.converted_lesson_days, 0);
    assert.equal(s2BeforeFuture.pending_lessons, 4);

    // Historical conversion of s3 (threshold_used = 5) must ALSO remain 1 day with threshold_used = 5
    const s3Historical = getStudentAbsenceDetails(db, s3.id, activeYear.id);
    assert.equal(s3Historical.converted_lesson_days, 1);
    assert.equal(s3Historical.conversions[0].threshold_used, 5);
  });

  await test('8. Prevent duplicate absence registration for the same student and date', () => {
    assert.throws(
      () =>
        createSingleAbsenceRecord(db, {
          student_id: s2.id,
          academic_year_id: activeYear.id,
          absence_date: '2026-11-05',
          status: 'full_day',
        }),
      /لا يمكن تكرار التسجيل في التاريخ نفسه/
    );

    assert.throws(
      () =>
        saveSectionAttendance(db, {
          academic_year_id: activeYear.id,
          grade_id: grade.id,
          section_id: secA.id,
          attendance_date: '2026-11-07',
          entries: [
            { student_id: s1.id, status: 'present' },
            { student_id: s1.id, status: 'full_day' },
          ],
        }),
      /تكرار/
    );
  });

  await test('9. Reopen SQLite database from disk and verify all absence records, conversions, and settings persist', async () => {
    db.close();
    db = createDatabaseConnection(dbFilePath);

    const reopenedSettings = getSchoolSettings(db);
    assert.equal(reopenedSettings.lessons_per_absence_day, 3);

    const sheet = getSectionAttendanceSheet(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-06',
    });
    assert.ok(sheet.session !== null);
    const s3SheetRow = sheet.students.find((r) => r.student_id === s3.id)!;
    assert.equal(s3SheetRow.status, 'full_day');
    assert.equal(s3SheetRow.direct_full_days, 1);
    assert.equal(s3SheetRow.converted_lesson_days, 1);
    assert.equal(s3SheetRow.total_full_days, 2);
    assert.equal(s3SheetRow.pending_lessons, 1);

    const dash = getDashboardStats(db, activeYear.id);
    assert.equal(dash.absence_days_count, 6);
    assert.equal(dash.last_absence_date, '2026-11-06');

    // Test delete single record recalculation & HTTP API roundtrip
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(() => db));
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const baseUrl = `http://127.0.0.1:${addr.port}/api`;

    try {
      const httpSheet = await fetch(
        `${baseUrl}/absences/sheet?academic_year_id=${activeYear.id}&grade_id=${grade.id}&section_id=${secA.id}&attendance_date=2026-11-05`
      );
      assert.equal(httpSheet.status, 200);
      const httpDetail = await fetch(`${baseUrl}/absences/student/${s3.id}`);
      assert.equal(httpDetail.status, 200);

      // Delete one record and verify clean cleanup
      const s3Rec = s3SheetRow.record_id!;
      deleteAbsenceRecord(db, s3Rec);
      const afterDelete = getStudentAbsenceDetails(db, s3.id, activeYear.id);
      assert.equal(afterDelete.direct_full_days, 0);
      assert.equal(afterDelete.converted_lesson_days, 1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nPhase 2 Summary: ${results.length - failed.length}/${results.length} tests passed.`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

runPhase2Tests().catch((err) => {
  console.error(err);
  process.exit(1);
});
