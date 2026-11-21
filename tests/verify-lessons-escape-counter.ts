import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import express from 'express';
import { createDatabaseConnection } from '../server/db/connection';
import { createApiRouter } from '../server/routes/api';
import {
  addStudentLessonRecords,
  createSingleAbsenceRecord,
  deleteAbsenceRecord,
  getSectionAttendanceSheet,
  getStudentAbsenceDetails,
  saveSectionAttendance,
} from '../server/services/absenceService';
import { createGrade } from '../server/services/gradeService';
import {
  generateMonthlyRegisterExcel,
  getMonthlyAbsenceRegister,
} from '../server/services/monthlyRegisterService';
import { getActiveAcademicYear, updateSchoolSettings } from '../server/services/settingsService';
import { createStudent } from '../server/services/studentService';
import { buildStandalonePrintableHtml } from '../src/components/monthly/MonthlyPrintSheet';

async function runLessonsEscapeCounterTests() {
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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iraqi-school-escape-'));
  const dbFilePath = path.join(tmpDir, 'test_escape.db');

  let db = createDatabaseConnection(dbFilePath);
  const grade = createGrade(db, { name: 'الرابع العلمي', initial_sections: ['أ'] });
  const secA = grade.sections[0];
  const activeYear = getActiveAcademicYear(db);

  updateSchoolSettings(db, {
    school_name: 'ثانوية الرافدين',
    directorate_name: 'تربية الكرخ الأولى',
    lessons_per_absence_day: 5,
    daily_lessons_count: 7,
    daily_permission_counts_as_absence: 0,
    lesson_permission_counts_as_absence: 0,
  });

  const s1 = createStudent(db, {
    full_name: 'علي حسن كاظم',
    grade_id: grade.id,
    section_id: secA.id,
    registry_number: '1101',
  });
  const s2 = createStudent(db, {
    full_name: 'مصطفى عادل حسين',
    grade_id: grade.id,
    section_id: secA.id,
    registry_number: '1102',
  });
  const s3 = createStudent(db, {
    full_name: 'حيدر علاء جاسم',
    grade_id: grade.id,
    section_id: secA.id,
    registry_number: '1103',
  });

  // Scenario 1: lesson_absence with specific lesson numbers stored in absence_lesson_details
  await test('1. تسجيل غياب عن درس بأرقام دروس محددة وحفظها في absence_lesson_details', () => {
    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-10-04',
      entries: [
        {
          student_id: s1.id,
          status: 'lesson_absence',
          lesson_details: [
            { lesson_number: 2, lesson_status: 'lesson_absence' },
            { lesson_number: 5, lesson_status: 'lesson_absence' },
          ],
          notes: 'غياب عن الدرسين الثاني والخامس',
        },
        { student_id: s2.id, status: 'present' },
        { student_id: s3.id, status: 'present' },
      ],
    });

    const details = getStudentAbsenceDetails(db, s1.id, activeYear.id);
    assert.equal(details.lesson_absence_lessons, 2);
    assert.equal(details.pending_lessons, 2);
    assert.equal(details.converted_lesson_days, 0);
    assert.deepEqual(details.records[0].lesson_numbers, [2, 5]);
    assert.equal(details.records[0].lesson_details.length, 2);
    assert.equal(details.records[0].lesson_details[0].lesson_status, 'lesson_absence');
    assert.equal(details.records[0].lesson_details[0].counted_as_absence, 1);
  });

  // Scenario 2: lesson_permission with specific lessons when OFF vs ON
  await test('2. تسجيل رخصة عن درس بأرقام دروس محددة في حالتي التفعيل والتعطيل', () => {
    // Setting is currently OFF (0)
    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-10-05',
      entries: [
        {
          student_id: s1.id,
          status: 'lesson_permission',
          lesson_details: [{ lesson_number: 3, lesson_status: 'lesson_permission' }],
        },
        { student_id: s2.id, status: 'present' },
        { student_id: s3.id, status: 'present' },
      ],
    });

    let d1 = getStudentAbsenceDetails(db, s1.id, activeYear.id);
    assert.equal(d1.counted_lesson_permission_lessons, 0);
    assert.equal(d1.pending_lessons, 2); // unchanged by uncounted permission

    // Now enable lesson_permission_counts_as_absence
    updateSchoolSettings(db, {
      school_name: 'ثانوية الرافدين',
      directorate_name: 'تربية الكرخ الأولى',
      lessons_per_absence_day: 5,
      daily_lessons_count: 7,
      daily_permission_counts_as_absence: 0,
      lesson_permission_counts_as_absence: 1,
    });

    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-10-06',
      entries: [
        {
          student_id: s1.id,
          status: 'lesson_permission',
          lesson_details: [
            { lesson_number: 1, lesson_status: 'lesson_permission' },
            { lesson_number: 4, lesson_status: 'lesson_permission' },
          ],
        },
        { student_id: s2.id, status: 'present' },
        { student_id: s3.id, status: 'present' },
      ],
    });

    d1 = getStudentAbsenceDetails(db, s1.id, activeYear.id);
    assert.equal(d1.counted_lesson_permission_lessons, 2);
    assert.equal(d1.pending_lessons, 4); // 2 lesson_absence + 2 counted lesson_permission
  });

  // Scenario 3 & 4: lesson_escape ALWAYS counted + unified counter mixing (permission ON + absence + escape)
  await test('3 & 4. تسجيل هروب من درس واحتسابه دائماً + العداد الموحد (رخصة + غياب + هروب = 2+2+2 = 6 => يوم كامل + 1 متبقٍ)', () => {
    // s1 currently has:
    //   2026-10-04: 2 lesson_absence (lessons 2, 5)
    //   2026-10-06: 2 counted lesson_permission (lessons 1, 4)
    // Now add 2 lesson_escape lessons on 2026-10-07 (lessons 6, 7) => total = 6, threshold = 5 => 1 converted day + 1 remaining!
    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-10-07',
      entries: [
        {
          student_id: s1.id,
          status: 'lesson_escape',
          lesson_details: [
            { lesson_number: 6, lesson_status: 'lesson_escape' },
            { lesson_number: 7, lesson_status: 'lesson_escape' },
          ],
          notes: 'هروب من الحصتين الأخيرتين',
        },
        { student_id: s2.id, status: 'present' },
        { student_id: s3.id, status: 'present' },
      ],
    });

    const d1 = getStudentAbsenceDetails(db, s1.id, activeYear.id);
    assert.equal(d1.lesson_absence_lessons, 2);
    assert.equal(d1.counted_lesson_permission_lessons, 2);
    assert.equal(d1.lesson_escape_lessons, 2);
    assert.equal(d1.total_lessons_missed, 6);
    assert.equal(d1.converted_lesson_days, 1);
    assert.equal(d1.pending_lessons, 1);
    assert.equal(d1.total_full_days, 1);

    // Check conversion metadata + contributing_lessons audit trail
    assert.equal(d1.conversions.length, 1);
    const conv = d1.conversions[0];
    assert.equal(conv.converted_date, '2026-10-07');
    assert.equal(conv.lessons_consumed, 5);
    assert.equal(conv.threshold_used, 5);
    assert.equal(conv.contributing_lessons?.length, 5);
    // Must contain: 2 absence (Oct 4), 2 permission (Oct 6), and 1 escape (lesson 6 of Oct 7), while lesson 7 carries forward!
    assert.equal(
      conv.contributing_lessons!.filter((x) => x.lesson_status === 'lesson_absence').length,
      2
    );
    assert.equal(
      conv.contributing_lessons!.filter((x) => x.lesson_status === 'lesson_permission').length,
      2
    );
    assert.equal(
      conv.contributing_lessons!.filter((x) => x.lesson_status === 'lesson_escape').length,
      1
    );
  });

  // Scenario 5: Mixing all 3 statuses with lesson_permission_counts_as_absence = OFF (exclude permissions cleanly)
  await test('5. مزج الأنواع الثلاثة مع تعطيل احتساب رخص الدروس (استبعاد الرخص من العداد الموحد)', () => {
    updateSchoolSettings(db, {
      school_name: 'ثانوية الرافدين',
      directorate_name: 'تربية الكرخ الأولى',
      lessons_per_absence_day: 5,
      daily_lessons_count: 7,
      daily_permission_counts_as_absence: 0,
      lesson_permission_counts_as_absence: 0,
    });

    // For s2: 3 uncounted lesson_permission + 2 lesson_absence + 1 lesson_escape = only 3 counted (< 5) -> 0 converted days
    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-10-08',
      entries: [
        { student_id: s1.id, status: 'present' },
        {
          student_id: s2.id,
          status: 'lesson_permission',
          lesson_details: [
            { lesson_number: 1, lesson_status: 'lesson_permission' },
            { lesson_number: 2, lesson_status: 'lesson_permission' },
            { lesson_number: 3, lesson_status: 'lesson_permission' },
          ],
        },
        { student_id: s3.id, status: 'present' },
      ],
    });

    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-10-11',
      entries: [
        { student_id: s1.id, status: 'present' },
        {
          student_id: s2.id,
          status: 'lesson_absence',
          lesson_details: [
            { lesson_number: 4, lesson_status: 'lesson_absence' },
            { lesson_number: 5, lesson_status: 'lesson_absence' },
          ],
        },
        { student_id: s3.id, status: 'present' },
      ],
    });

    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-10-12',
      entries: [
        { student_id: s1.id, status: 'present' },
        {
          student_id: s2.id,
          status: 'lesson_escape',
          lesson_details: [{ lesson_number: 7, lesson_status: 'lesson_escape' }],
        },
        { student_id: s3.id, status: 'present' },
      ],
    });

    const d2 = getStudentAbsenceDetails(db, s2.id, activeYear.id);
    assert.equal(d2.lesson_absence_lessons, 2);
    assert.equal(d2.lesson_escape_lessons, 1);
    assert.equal(d2.counted_lesson_permission_lessons, 0);
    assert.equal(d2.total_lessons_missed, 3);
    assert.equal(d2.converted_lesson_days, 0);
    assert.equal(d2.pending_lessons, 3);
  });

  // Scenario 6: Multiple different reasons on DIFFERENT lessons of the SAME student & SAME date
  await test('6. تسجيل أكثر من سبب لدروس مختلفة في التاريخ نفسه مع بقاء نوع كل درس مستقلاً', () => {
    // Turn permission ON temporarily to test all 3 distinct lessons on s3 on 2026-10-13
    updateSchoolSettings(db, {
      school_name: 'ثانوية الرافدين',
      directorate_name: 'تربية الكرخ الأولى',
      lessons_per_absence_day: 5,
      daily_lessons_count: 7,
      daily_permission_counts_as_absence: 0,
      lesson_permission_counts_as_absence: 1,
    });

    // Step 6a: Save Lesson 2 (lesson_absence) + Lesson 4 (lesson_permission)
    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-10-13',
      entries: [
        { student_id: s1.id, status: 'present' },
        { student_id: s2.id, status: 'present' },
        {
          student_id: s3.id,
          status: 'lesson_absence',
          lesson_details: [
            { lesson_number: 2, lesson_status: 'lesson_absence' },
            { lesson_number: 4, lesson_status: 'lesson_permission' },
          ],
        },
      ],
    });

    // Step 6b: Add Lesson 6 (lesson_escape) via addStudentLessonRecords on SAME date!
    const appended = addStudentLessonRecords(db, {
      student_id: s3.id,
      academic_year_id: activeYear.id,
      absence_date: '2026-10-13',
      lesson_details: [{ lesson_number: 6, lesson_status: 'lesson_escape' }],
      notes: 'هروب الحصة السادسة',
    });

    const appendedDetails = appended.lesson_details as Array<{
      lesson_number: number;
      lesson_status: string;
    }>;
    assert.equal(appendedDetails.length, 3);
    assert.equal(appendedDetails.find((d) => d.lesson_number === 2)?.lesson_status, 'lesson_absence');
    assert.equal(
      appendedDetails.find((d) => d.lesson_number === 4)?.lesson_status,
      'lesson_permission'
    );
    assert.equal(appendedDetails.find((d) => d.lesson_number === 6)?.lesson_status, 'lesson_escape');

    const regOct = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
    });
    const rowS3 = regOct.students.find((r) => r.student_id === s3.id)!;
    assert.equal(rowS3.days[13].status_kind, 'lesson_mixed');
    assert.equal(rowS3.days[13].symbol, 'د١+هـ١+ح١');
    assert.equal(rowS3.days[13].counted_lessons_today, 3);
    assert.equal(rowS3.lesson_absence_lessons, 1);
    assert.equal(rowS3.lesson_escape_lessons, 1);
    assert.equal(rowS3.counted_lesson_permission_lessons, 1);
  });

  // Scenario 7: Prevent duplicate/conflicting reason for the SAME lesson on the SAME date (service + DB constraint)
  await test('7. منع تسجيل أكثر من سبب لنفس الدرس في التاريخ نفسه (في الخدمة وقاعدة البيانات)', () => {
    // 7a. Same payload duplicate lesson_number
    assert.throws(
      () =>
        saveSectionAttendance(db, {
          academic_year_id: activeYear.id,
          grade_id: grade.id,
          section_id: secA.id,
          attendance_date: '2026-10-14',
          entries: [
            {
              student_id: s3.id,
              status: 'lesson_absence',
              lesson_details: [
                { lesson_number: 3, lesson_status: 'lesson_absence' },
                { lesson_number: 3, lesson_status: 'lesson_escape' },
              ],
            },
          ],
        }),
      /لا يجوز تسجيل أكثر من سبب/
    );

    // 7b. Adding conflicting lesson onto an already recorded lesson (Lesson 2 of s3 on 2026-10-13)
    assert.throws(
      () =>
        addStudentLessonRecords(db, {
          student_id: s3.id,
          academic_year_id: activeYear.id,
          absence_date: '2026-10-13',
          lesson_details: [{ lesson_number: 2, lesson_status: 'lesson_escape' }],
        }),
      /لا يجوز تسجيل أكثر من سبب/
    );

    // 7c. Direct SQLite UNIQUE constraint enforcement
    const s3Abs = db
      .prepare('SELECT id FROM absences WHERE student_id = ? AND absence_date = ?')
      .get(s3.id, '2026-10-13') as { id: number };
    assert.throws(() => {
      db.prepare(
        `INSERT INTO absence_lesson_details
         (absence_id, student_id, absence_date, lesson_number, lesson_status, counted_as_absence, threshold_snapshot)
         VALUES (?, ?, ?, ?, 'lesson_escape', 1, 5)`
      ).run(s3Abs.id, s3.id, '2026-10-13', 2);
    }, /UNIQUE constraint failed/);
  });

  // Scenario 8: Cross-month accumulation (October + November) without monthly reset
  await test('8. تراكم الدروس عبر الأشهر (تشرين الأول + تشرين الثاني) دون تصفير وبقاء السجل القديم سليماً', () => {
    // s1 currently has:
    //   October: 1 converted day (Oct 7) + 1 pending lesson (Oct 7 lesson 7)
    // Add 4 counted lessons for s1 across November 2 & November 4 (2 absence + 2 escape) => 1 + 4 = 5 => conversion on Nov 4!
    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-02',
      entries: [
        {
          student_id: s1.id,
          status: 'lesson_absence',
          lesson_details: [
            { lesson_number: 1, lesson_status: 'lesson_absence' },
            { lesson_number: 2, lesson_status: 'lesson_absence' },
          ],
        },
        { student_id: s2.id, status: 'present' },
        { student_id: s3.id, status: 'present' },
      ],
    });

    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-04',
      entries: [
        {
          student_id: s1.id,
          status: 'lesson_escape',
          lesson_details: [
            { lesson_number: 3, lesson_status: 'lesson_escape' },
            { lesson_number: 4, lesson_status: 'lesson_escape' },
          ],
        },
        { student_id: s2.id, status: 'present' },
        { student_id: s3.id, status: 'present' },
      ],
    });

    const regOct = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
    });
    const octS1 = regOct.students.find((r) => r.student_id === s1.id)!;
    assert.equal(octS1.converted_lesson_days, 1);
    assert.equal(octS1.days[7].symbol, 'ج');
    assert.equal(octS1.days[4].symbol, 'د٢');
    assert.equal(octS1.days[6].symbol, 'ح٢');

    const regNov = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 11,
      grade_id: grade.id,
      section_id: secA.id,
    });
    const novS1 = regNov.students.find((r) => r.student_id === s1.id)!;
    assert.equal(novS1.converted_lesson_days, 1);
    assert.equal(novS1.days[2].symbol, 'د٢');
    assert.equal(novS1.days[4].symbol, 'ج');
    assert.equal(novS1.year_pending_lessons, 0);
    // Contributing lessons on Nov 4 must include Oct 7 (lesson 7 escape) + Nov 2 (lessons 1,2 absence) + Nov 4 (lessons 3,4 escape)!
    assert.equal(novS1.days[4].contributing_lessons.length, 5);
    assert.equal(novS1.days[4].contributing_lessons[0].absence_date, '2026-10-07');
    assert.equal(novS1.days[4].contributing_lessons[0].lesson_number, 7);
    assert.equal(novS1.days[4].contributing_lessons[0].lesson_status, 'lesson_escape');
  });

  // Scenario 9: Editing & deleting a record recalculates conversions cleanly without touching other students
  await test('9. تعديل أو حذف سجل يعيد احتساب العداد والأيام المحولة بدقة دون التأثير على الطلاب الآخرين', () => {
    const s3Before = getStudentAbsenceDetails(db, s3.id, activeYear.id);

    // Edit Nov 4 record for s1 from 2 escape lessons down to 1 escape lesson -> Nov conversion disappears!
    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-04',
      entries: [
        {
          student_id: s1.id,
          status: 'lesson_escape',
          lesson_details: [{ lesson_number: 3, lesson_status: 'lesson_escape' }],
        },
        { student_id: s2.id, status: 'present' },
        { student_id: s3.id, status: 'present' },
      ],
    });

    let d1 = getStudentAbsenceDetails(db, s1.id, activeYear.id);
    assert.equal(d1.converted_lesson_days, 1); // Only Oct 7 conversion remains
    assert.equal(d1.pending_lessons, 4); // Oct 7 L7 + Nov 2 (2) + Nov 4 L3 (1) = 4

    // Delete Oct 7 record for s1 -> remaining = Oct 4 (2) + Oct 6 (2) + Nov 2 (2) + Nov 4 (1) = 7
    // 7 >= threshold 5 -> 1 conversion shifts to Nov 2, with 2 remaining pending!
    const oct7Rec = d1.records.find((r) => r.absence_date === '2026-10-07')!;
    deleteAbsenceRecord(db, oct7Rec.id);

    d1 = getStudentAbsenceDetails(db, s1.id, activeYear.id);
    assert.equal(d1.total_lessons_missed, 7);
    assert.equal(d1.converted_lesson_days, 1);
    assert.equal(d1.conversions[0].converted_date, '2026-11-02');
    assert.equal(d1.pending_lessons, 2);

    // Delete Nov 2 record -> remaining = Oct 4 (2) + Oct 6 (2) + Nov 4 (1) = 5 -> 1 conversion on Nov 4, 0 pending
    const nov2Rec = d1.records.find((r) => r.absence_date === '2026-11-02')!;
    deleteAbsenceRecord(db, nov2Rec.id);

    d1 = getStudentAbsenceDetails(db, s1.id, activeYear.id);
    assert.equal(d1.total_lessons_missed, 5);
    assert.equal(d1.converted_lesson_days, 1);
    assert.equal(d1.conversions[0].converted_date, '2026-11-04');
    assert.equal(d1.pending_lessons, 0);

    // Delete Nov 4 record -> remaining = Oct 4 (2) + Oct 6 (2) = 4 < 5 -> 0 conversions, 4 pending
    const nov4Rec = d1.records.find((r) => r.absence_date === '2026-11-04')!;
    deleteAbsenceRecord(db, nov4Rec.id);

    d1 = getStudentAbsenceDetails(db, s1.id, activeYear.id);
    assert.equal(d1.total_lessons_missed, 4);
    assert.equal(d1.converted_lesson_days, 0);
    assert.equal(d1.pending_lessons, 4);

    // Check s3 untouched
    const s3After = getStudentAbsenceDetails(db, s3.id, activeYear.id);
    assert.equal(s3After.pending_lessons, s3Before.pending_lessons);
    assert.equal(s3After.total_lessons_missed, s3Before.total_lessons_missed);
  });

  // Scenario 10: Historical permission/threshold snapshot preservation on settings change
  await test('10. الحفاظ على اللقطة التاريخية عند تغيير إعدادات الرخص أو النصاب لاحقاً', () => {
    const s3Before = getStudentAbsenceDetails(db, s3.id, activeYear.id);
    const oct13Before = s3Before.records.find((r) => r.absence_date === '2026-10-13')!;
    assert.equal(
      oct13Before.lesson_details.find((d) => d.lesson_number === 4)?.counted_as_absence,
      1
    );

    // Disable lesson_permission_counts_as_absence & raise threshold to 8
    updateSchoolSettings(db, {
      school_name: 'ثانوية الرافدين',
      directorate_name: 'تربية الكرخ الأولى',
      lessons_per_absence_day: 8,
      daily_lessons_count: 7,
      daily_permission_counts_as_absence: 0,
      lesson_permission_counts_as_absence: 0,
    });

    // Save an untouched date sheet or verify s3 old record did not flip
    const s3After = getStudentAbsenceDetails(db, s3.id, activeYear.id);
    const oct13After = s3After.records.find((r) => r.absence_date === '2026-10-13')!;
    assert.equal(
      oct13After.lesson_details.find((d) => d.lesson_number === 4)?.counted_as_absence,
      1
    );
    assert.equal(oct13After.threshold_snapshot, 5);
  });

  // Scenario 11: Safe SQLite Migration from Pre-Escape Schema + Excel/Print HTML + Reopen & HTTP API
  await test('11. ترقية آمنة لقاعدة SQLite أقدم + التصدير والطباعة برمز (هـ) + API وإعادة الفتح', async () => {
    // 11a. Build a simulated legacy SQLite DB with old CHECK constraint (no lesson_escape) and old absence_lesson_details
    const legacyPath = path.join(tmpDir, 'legacy_upgrade.db');
    const rawLegacy = new Database(legacyPath);
    rawLegacy.exec(`
      CREATE TABLE school_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        school_name TEXT NOT NULL,
        directorate_name TEXT NOT NULL,
        lessons_per_absence_day INTEGER NOT NULL DEFAULT 5,
        daily_lessons_count INTEGER NOT NULL DEFAULT 7,
        daily_permission_counts_as_absence INTEGER NOT NULL DEFAULT 0,
        lesson_permission_counts_as_absence INTEGER NOT NULL DEFAULT 0,
        weekly_holiday_days TEXT NOT NULL DEFAULT '[5,6]',
        weekly_holiday_reason TEXT NOT NULL DEFAULT 'عطلة نهاية الأسبوع',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO school_settings (id, school_name, directorate_name) VALUES (1, 'مدرسة قديمة', 'تربية بغداد');
      CREATE TABLE academic_years (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, is_active INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO academic_years (id, name, is_active) VALUES (1, '2026-2027', 1);
      CREATE TABLE grades (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO grades (id, name) VALUES (1, 'الأول المتوسط');
      CREATE TABLE sections (id INTEGER PRIMARY KEY AUTOINCREMENT, grade_id INTEGER NOT NULL, name TEXT NOT NULL, capacity INTEGER);
      INSERT INTO sections (id, grade_id, name) VALUES (1, 1, 'أ');
      CREATE TABLE students (id INTEGER PRIMARY KEY AUTOINCREMENT, student_uid TEXT NOT NULL UNIQUE, registry_number TEXT UNIQUE, full_name TEXT NOT NULL, birth_date TEXT, phone TEXT, photo_data TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO students (id, student_uid, full_name) VALUES (1, 'STU-0001', 'طالب قديم');
      CREATE TABLE student_enrollments (id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, academic_year_id INTEGER NOT NULL, grade_id INTEGER NOT NULL, section_id INTEGER NOT NULL, enrollment_date TEXT NOT NULL, is_current INTEGER NOT NULL DEFAULT 1, transfer_reason TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT);
      INSERT INTO student_enrollments (id, student_id, academic_year_id, grade_id, section_id, enrollment_date) VALUES (1, 1, 1, 1, 1, '2026-09-01');
      CREATE TABLE absences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        enrollment_id INTEGER NOT NULL DEFAULT 1,
        academic_year_id INTEGER NOT NULL,
        grade_id INTEGER NOT NULL,
        section_id INTEGER NOT NULL,
        absence_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('present','full_day','lesson_absence','full_day_leave','lesson_permission')),
        lessons_count INTEGER NOT NULL DEFAULT 0,
        leave_type TEXT CHECK (leave_type IN ('sick_leave','daily_permission')),
        permission_type TEXT,
        lesson_numbers_json TEXT,
        counted_as_absence INTEGER NOT NULL DEFAULT 0,
        permission_rule_snapshot INTEGER,
        applied_settings_at TEXT,
        threshold_snapshot INTEGER NOT NULL DEFAULT 5,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(student_id, absence_date)
      );
      INSERT INTO absences (id, student_id, academic_year_id, grade_id, section_id, absence_date, status, lessons_count, counted_as_absence, threshold_snapshot)
      VALUES (1, 1, 1, 1, 1, '2026-10-04', 'lesson_absence', 3, 1, 5);
      INSERT INTO absences (id, student_id, academic_year_id, grade_id, section_id, absence_date, status, lessons_count, permission_type, lesson_numbers_json, counted_as_absence, permission_rule_snapshot, threshold_snapshot)
      VALUES (2, 1, 1, 1, 1, '2026-10-05', 'lesson_permission', 2, 'lesson_permission', '[2,5]', 1, 1, 5);
      CREATE TABLE absence_lesson_details (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        absence_id INTEGER NOT NULL,
        lesson_number INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(absence_id, lesson_number)
      );
      INSERT INTO absence_lesson_details (absence_id, lesson_number) VALUES (2, 2), (2, 5);
      CREATE TABLE lesson_converted_days (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id INTEGER NOT NULL,
        academic_year_id INTEGER NOT NULL,
        grade_id INTEGER NOT NULL,
        section_id INTEGER NOT NULL,
        source_absence_id INTEGER NOT NULL,
        converted_date TEXT NOT NULL,
        lessons_consumed INTEGER NOT NULL,
        threshold_used INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO lesson_converted_days (student_id, academic_year_id, grade_id, section_id, source_absence_id, converted_date, lessons_consumed, threshold_used)
      VALUES (1, 1, 1, 1, 2, '2026-10-05', 5, 5);
    `);
    rawLegacy.close();

    // Open with connection.ts -> runs runSafeMigrations non-destructively!
    const migratedDb = createDatabaseConnection(legacyPath);
    try {
      const legacyDetails = getStudentAbsenceDetails(migratedDb, 1, 1);
      assert.equal(legacyDetails.records.length, 2);
      assert.equal(legacyDetails.converted_lesson_days, 1);
      assert.equal(legacyDetails.total_lessons_missed, 5);

      // Verify migrated DB now accepts lesson_escape!
      createSingleAbsenceRecord(migratedDb, {
        student_id: 1,
        academic_year_id: 1,
        absence_date: '2026-10-06',
        status: 'lesson_escape',
        lesson_numbers: [4],
      });
      const afterEscape = getStudentAbsenceDetails(migratedDb, 1, 1);
      assert.equal(afterEscape.lesson_escape_lessons, 1);
      assert.equal(afterEscape.pending_lessons, 1);
    } finally {
      migratedDb.close();
    }

    // 11b. Verify Excel & Printable HTML on primary DB + HTTP API 409 check on duplicate lesson
    const { buffer } = await generateMonthlyRegisterExcel(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = wb.worksheets[0];
    assert.ok(String(sheet.getCell(3, 1).value).includes('هـ١.. = هروب من دروس'));

    const reg = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
    });
    const html = buildStandalonePrintableHtml(reg, 'a3-landscape');
    assert.ok(html.includes('هـ١..'));
    assert.ok(html.includes('cell-lesson-mixed'));

    // Reopen primary DB + HTTP API test
    db.close();
    db = createDatabaseConnection(dbFilePath);

    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(() => db));
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    try {
      // Conflict 409 via API
      const conflictRes = await fetch(`http://127.0.0.1:${port}/api/absences/lessons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: s3.id,
          academic_year_id: activeYear.id,
          absence_date: '2026-10-13',
          lesson_details: [{ lesson_number: 2, lesson_status: 'lesson_escape' }],
        }),
      });
      assert.equal(conflictRes.status, 409);

      // Valid non-overlapping lesson addition via API (Lesson 7 of s3 on 2026-10-13)
      const okRes = await fetch(`http://127.0.0.1:${port}/api/absences/lessons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: s3.id,
          academic_year_id: activeYear.id,
          absence_date: '2026-10-13',
          lesson_details: [{ lesson_number: 7, lesson_status: 'lesson_escape' }],
        }),
      });
      assert.equal(okRes.status, 201);

      const sheetCheck = getSectionAttendanceSheet(db, {
        academic_year_id: activeYear.id,
        grade_id: grade.id,
        section_id: secA.id,
        attendance_date: '2026-10-13',
      });
      const s3Sheet = sheetCheck.students.find((r) => r.student_id === s3.id)!;
      assert.equal(s3Sheet.lesson_details.length, 4);
    } finally {
      server.close();
    }
  });

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nLessons / Escape / Unified Counter Tests: ${passed}/${results.length} passed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runLessonsEscapeCounterTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
