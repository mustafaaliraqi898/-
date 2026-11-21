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
  saveSectionAttendance,
} from '../server/services/absenceService';
import { createGrade } from '../server/services/gradeService';
import { createHoliday } from '../server/services/holidayService';
import {
  deleteMonthlyStudentNote,
  generateMonthlyRegisterExcel,
  getMonthlyAbsenceRegister,
  saveMonthlyStudentNote,
} from '../server/services/monthlyRegisterService';
import {
  getActiveAcademicYear,
  updateSchoolSettings,
} from '../server/services/settingsService';
import {
  createStudent,
  transferStudent,
} from '../server/services/studentService';
import { computeMonthlyPrintPages } from '../src/components/monthly/MonthlyPrintSheet';

async function runMonthlyRegisterTests() {
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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iraqi-school-monthly-'));
  const dbFilePath = path.join(tmpDir, 'test_monthly.db');

  let db = createDatabaseConnection(dbFilePath);

  updateSchoolSettings(db, {
    school_name: 'ثانوية بغداد المركزية',
    directorate_name: 'المديرية العامة لتربية الكرخ الأولى',
    lessons_per_absence_day: 5,
    daily_lessons_count: 7,
    daily_permission_counts_as_absence: 0,
    lesson_permission_counts_as_absence: 0,
  });

  const activeYear = getActiveAcademicYear(db);
  const grade = createGrade(db, { name: 'الرابع العلمي', initial_sections: ['أ', 'ب'] });
  const secA = grade.sections[0];
  const secB = grade.sections[1];

  const s1 = createStudent(db, {
    full_name: 'زيدون طارق محمود',
    grade_id: grade.id,
    section_id: secA.id,
    registry_number: '1001',
    enrollment_date: '2026-09-15',
  });
  const s2 = createStudent(db, {
    full_name: 'أحمد قاسم جبار',
    grade_id: grade.id,
    section_id: secA.id,
    registry_number: '1002',
    enrollment_date: '2026-09-15',
  });
  const s3 = createStudent(db, {
    full_name: 'بان علي حسن',
    grade_id: grade.id,
    section_id: secA.id,
    registry_number: '1003',
    enrollment_date: '2026-09-15',
  });

  // Scenario 1: Display all enrolled students even with zero absences
  await test('1. عرض جميع طلاب الشعبة في السجل الشهري حتى لمن ليس لديهم غياب', () => {
    const reg = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
    });
    assert.equal(reg.students.length, 3);
    assert.equal(reg.stats.total_students, 3);
    assert.equal(reg.stats.students_with_counted_absence, 0);
    assert.equal(reg.students[0].full_name, s1.full_name); // original enrollment order
    assert.equal(reg.students[0].days[1].symbol, '—');
  });

  // Scenario 2: Correct month lengths & leap-year February (28 vs 29)
  await test('2. توليد عدد أيام الشهر الصحيح بما فيها سنة كبيسة (29) وغير كبيسة (28)', () => {
    const feb2024 = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2024,
      month: 2,
      grade_id: grade.id,
      section_id: secA.id,
    });
    assert.equal(feb2024.days_in_month, 29);
    assert.equal(feb2024.calendar_days.length, 29);

    const feb2026 = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 2,
      grade_id: grade.id,
      section_id: secA.id,
    });
    assert.equal(feb2026.days_in_month, 28);

    const nov2026 = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 11,
      grade_id: grade.id,
      section_id: secA.id,
    });
    assert.equal(nov2026.days_in_month, 30);
    assert.equal(nov2026.month_name, 'تشرين الثاني');
  });

  // Scenario 3: Exact weekday name matching date
  await test('3. عرض اليوم واسم اليوم بالعربية مطابقين تماماً للتاريخ الفعلي', () => {
    const oct2026 = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
    });
    // 2026-10-01 is Thursday (الخميس), 2026-10-02 is Friday (الجمعة), 2026-10-03 is Saturday (السبت)
    assert.equal(oct2026.calendar_days[0].day_name, 'الخميس');
    assert.equal(oct2026.calendar_days[1].day_name, 'الجمعة');
    assert.equal(oct2026.calendar_days[2].day_name, 'السبت');
    assert.equal(oct2026.students[0].days[2].symbol, 'ع');
    assert.equal(oct2026.students[0].days[3].symbol, 'ع');
  });

  // Scenario 4 & 5: Direct full_day ('غ') and lesson_absence ('د١'..'د٤')
  await test('4 & 5. تسجيل غياب يوم كامل (غ) وغياب عن دروس (د) وعرضها بالرموز والمجاميع الصحيحة', () => {
    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-10-04', // Sunday
      entries: [
        { student_id: s1.id, status: 'full_day', notes: 'تغيب بدون عذر' },
        { student_id: s2.id, status: 'lesson_absence', lessons_count: 2, notes: 'غائب درسين' },
        { student_id: s3.id, status: 'present' },
      ],
    });

    const reg = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
    });
    const row1 = reg.students.find((r) => r.student_id === s1.id)!;
    const row2 = reg.students.find((r) => r.student_id === s2.id)!;

    assert.equal(row1.days[4].symbol, 'غ');
    assert.equal(row1.days[4].counted_as_absence, true);
    assert.equal(row1.direct_full_days, 1);
    assert.equal(row1.total_counted_absence_days, 1);

    assert.equal(row2.days[4].symbol, 'د٢');
    assert.equal(row2.days[4].lessons_count, 2);
    assert.equal(row2.days[4].contributed_to_counter, true);
    assert.equal(row2.missed_lessons_count, 2);
    assert.equal(row2.converted_lesson_days, 0);
  });

  // Scenario 6: Sick leave ('م') never counted as absence
  await test('6. تسجيل إجازة مرضية (م) وعدم احتسابها ضمن الغياب مع ظهورها في العمود والملاحظات', () => {
    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-10-05', // Monday
      entries: [
        { student_id: s1.id, status: 'full_day_leave', leave_type: 'sick_leave', notes: 'تقرير طبي' },
        { student_id: s2.id, status: 'present' },
        { student_id: s3.id, status: 'present' },
      ],
    });

    const reg = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
    });
    const row1 = reg.students.find((r) => r.student_id === s1.id)!;
    assert.equal(row1.days[5].symbol, 'م');
    assert.equal(row1.days[5].counted_as_absence, false);
    assert.equal(row1.sick_leave_days, 1);
    assert.equal(row1.total_counted_absence_days, 1); // still only 1 from Oct 4
    assert.ok(row1.auto_notes.some((n) => n.includes('إجازة مرضية بتاريخ 2026-10-05')));
  });

  // Scenario 7: Daily permission ('ر') counted vs not counted
  await test('7. تسجيل رخصة يومية (ر) في حالتي احتسابها وعدم احتسابها كغياب', () => {
    // Setting currently OFF (0)
    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-10-06',
      entries: [
        {
          student_id: s1.id,
          status: 'full_day_leave',
          leave_type: 'daily_permission',
          notes: 'ظرف عائلي',
        },
        { student_id: s2.id, status: 'present' },
        { student_id: s3.id, status: 'present' },
      ],
    });

    // Enable daily permission counting for next date
    updateSchoolSettings(db, {
      school_name: 'ثانوية بغداد المركزية',
      directorate_name: 'المديرية العامة لتربية الكرخ الأولى',
      daily_permission_counts_as_absence: 1,
    });

    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-10-07',
      entries: [
        {
          student_id: s1.id,
          status: 'full_day_leave',
          leave_type: 'daily_permission',
          notes: 'مراجعة رسمية',
        },
        { student_id: s2.id, status: 'present' },
        { student_id: s3.id, status: 'present' },
      ],
    });

    const reg = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
    });
    const row1 = reg.students.find((r) => r.student_id === s1.id)!;

    assert.equal(row1.days[6].symbol, 'ر');
    assert.equal(row1.days[6].counted_as_absence, false);
    assert.equal(row1.days[7].symbol, 'ر');
    assert.equal(row1.days[7].counted_as_absence, true);

    assert.equal(row1.daily_permission_days, 2);
    assert.equal(row1.counted_daily_permission_days, 1);
    assert.equal(row1.direct_full_days, 1); // full_day kept separate from daily_permission
    assert.equal(row1.total_counted_absence_days, 2); // 1 full_day + 1 counted daily_permission
  });

  // Scenario 8: Lesson permission ('ح') counted vs not counted + exact lesson numbers in modal data
  await test('8. تسجيل رخصة عن درس (ح) في حالتي احتسابها وعدم احتسابها وعرض أرقام الدروس بالتفاصيل', () => {
    // Currently lesson_permission_counts_as_absence = 0
    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-10-08',
      entries: [
        { student_id: s1.id, status: 'present' },
        { student_id: s2.id, status: 'present' },
        {
          student_id: s3.id,
          status: 'lesson_permission',
          lesson_numbers: [2, 5],
          notes: 'مراجعة طبية قصيرة',
        },
      ],
    });

    // Enable lesson permission counting
    updateSchoolSettings(db, {
      school_name: 'ثانوية بغداد المركزية',
      directorate_name: 'المديرية العامة لتربية الكرخ الأولى',
      lesson_permission_counts_as_absence: 1,
    });

    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-10-11',
      entries: [
        { student_id: s1.id, status: 'present' },
        { student_id: s2.id, status: 'present' },
        {
          student_id: s3.id,
          status: 'lesson_permission',
          lesson_numbers: [1, 3, 4],
          notes: 'خروج مبكر بعذر',
        },
      ],
    });

    const reg = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
    });
    const row3 = reg.students.find((r) => r.student_id === s3.id)!;

    assert.equal(row3.days[8].symbol, 'ح٢');
    assert.deepEqual(row3.days[8].lesson_numbers, [2, 5]);
    assert.equal(row3.days[8].contributed_to_counter, false);

    assert.equal(row3.days[11].symbol, 'ح٣');
    assert.deepEqual(row3.days[11].lesson_numbers, [1, 3, 4]);
    assert.equal(row3.days[11].contributed_to_counter, true);

    assert.equal(row3.lesson_permission_records, 2);
    assert.equal(row3.missed_lessons_count, 3); // only counted lesson_permission
  });

  // Scenario 9, 10, 11, 12: Cross-month lesson accumulation (4 in Oct + 1 in Nov = conversion in Nov!), no double counting, original rows preserved
  await test('9-12. تراكم الدروس عبر الأشهر (4 في تشرين1 + 1 في تشرين2 = ج في تشرين2 دون حذف سجل تشرين1 أو احتساب مزدوج)', () => {
    // Student s2 currently has 2 lessons in Oct (Oct 4). Add 2 more in Oct -> 4 total in Oct (no conversion yet!)
    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-10-12',
      entries: [
        { student_id: s1.id, status: 'present' },
        { student_id: s2.id, status: 'lesson_absence', lessons_count: 2 },
        { student_id: s3.id, status: 'present' },
      ],
    });

    const octBeforeNov = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
    });
    const s2Oct = octBeforeNov.students.find((r) => r.student_id === s2.id)!;
    assert.equal(s2Oct.missed_lessons_count, 4);
    assert.equal(s2Oct.converted_lesson_days, 0);
    assert.equal(s2Oct.total_counted_absence_days, 0);
    assert.equal(s2Oct.days[4].symbol, 'د٢');
    assert.equal(s2Oct.days[12].symbol, 'د٢');

    // Now in November 2026 (2026-11-02), record 1 lesson absence -> reaches 5 -> converts on Nov 2!
    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secA.id,
      attendance_date: '2026-11-02',
      entries: [
        { student_id: s1.id, status: 'present' },
        { student_id: s2.id, status: 'lesson_absence', lessons_count: 1 },
        { student_id: s3.id, status: 'present' },
      ],
    });

    const octAfterNov = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
    });
    const s2OctCheck = octAfterNov.students.find((r) => r.student_id === s2.id)!;
    // Original Oct records preserved, NO conversion added to Oct
    assert.equal(s2OctCheck.days[4].symbol, 'د٢');
    assert.equal(s2OctCheck.days[12].symbol, 'د٢');
    assert.equal(s2OctCheck.converted_lesson_days, 0);
    assert.equal(s2OctCheck.total_counted_absence_days, 0);

    const nov = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 11,
      grade_id: grade.id,
      section_id: secA.id,
    });
    const s2Nov = nov.students.find((r) => r.student_id === s2.id)!;
    assert.equal(s2Nov.days[2].symbol, 'ج');
    assert.equal(s2Nov.days[2].generated_converted_day, true);
    assert.equal(s2Nov.days[2].lessons_count, 1);
    assert.equal(s2Nov.converted_lesson_days, 1);
    assert.equal(s2Nov.total_counted_absence_days, 1);
    assert.equal(s2Nov.year_pending_lessons, 0);
    assert.ok(s2Nov.auto_notes.some((n) => n.includes('2026-11-02') && n.includes('5 دروس')));
  });

  // Scenario 13: Editing/Deleting old Oct record automatically cancels Nov conversion!
  await test('13. تعديل أو حذف سجل غياب في شهر سابق يعيد حساب تراكم الدروس في الشهر التالي تلقائياً', () => {
    const oct = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
    });
    const oct12RecordId = oct.students.find((r) => r.student_id === s2.id)!.days[12].record_id!;
    assert.ok(oct12RecordId > 0);

    // Delete Oct 12 record -> s2 now has 2 (Oct 4) + 1 (Nov 2) = 3 lessons -> Nov 2 reverts from 'ج' to 'د١'!
    deleteAbsenceRecord(db, oct12RecordId);

    const novAfterDelete = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 11,
      grade_id: grade.id,
      section_id: secA.id,
    });
    const s2Nov = novAfterDelete.students.find((r) => r.student_id === s2.id)!;
    assert.equal(s2Nov.days[2].symbol, 'د١');
    assert.equal(s2Nov.converted_lesson_days, 0);
    assert.equal(s2Nov.total_counted_absence_days, 0);
    assert.equal(s2Nov.year_pending_lessons, 3);
  });

  // Scenario 14: Mid-month transfer across sections reflects cleanly
  await test('14. نقل طالب بين شعبتين خلال الشهر يعرضه في الفترتين دون خلط الغيابات', () => {
    // Re-add Oct 12 2 lessons back to s2 so we have clean test state, and transfer s3 to Section B on 2026-10-15
    transferStudent(db, s3.id, {
      grade_id: grade.id,
      section_id: secB.id,
      academic_year_id: activeYear.id,
      enrollment_date: '2026-10-15',
      transfer_reason: 'توزيع الشعب',
    });

    // Record absence for s3 in Section B on 2026-10-18
    saveSectionAttendance(db, {
      academic_year_id: activeYear.id,
      grade_id: grade.id,
      section_id: secB.id,
      attendance_date: '2026-10-18',
      entries: [{ student_id: s3.id, status: 'full_day', notes: 'غياب بعد النقل' }],
    });

    const octSecA = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
    });
    const s3InA = octSecA.students.find((r) => r.student_id === s3.id)!;
    assert.ok(s3InA);
    assert.equal(s3InA.days[8].symbol, 'ح٢');
    assert.equal(s3InA.days[11].symbol, 'ح٣');
    // Oct 18 belongs to secB, NOT secA
    assert.equal(s3InA.direct_full_days, 0);
    assert.ok(s3InA.auto_notes.some((n) => n.includes('نُقل الطالب من هذه الشعبة بتاريخ 2026-10-15')));

    const octSecB = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secB.id,
    });
    const s3InB = octSecB.students.find((r) => r.student_id === s3.id)!;
    assert.ok(s3InB);
    assert.equal(s3InB.days[18].symbol, 'غ');
    assert.equal(s3InB.direct_full_days, 1);
    assert.ok(s3InB.auto_notes.some((n) => n.includes('نُقل الطالب إلى هذه الشعبة بتاريخ 2026-10-15')));

    // In December 2026 (no records in Sec A and transferred on Oct 15), s3 belongs ONLY to Section B and NOT Section A!
    const decSecA = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 12,
      grade_id: grade.id,
      section_id: secA.id,
    });
    assert.equal(
      decSecA.students.some((r) => r.student_id === s3.id),
      false
    );

    const decSecB = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 12,
      grade_id: grade.id,
      section_id: secB.id,
    });
    assert.equal(
      decSecB.students.some((r) => r.student_id === s3.id),
      true
    );
  });

  // Scenario 15 & 16: Holidays (weekly, official, exceptional) appear as 'ع' with full metadata
  await test('15 & 16. عرض العطل الأسبوعية والرسمية والاستثنائية برمز (ع) وتفاصيل العطلة كاملة', () => {
    createHoliday(db, {
      academic_year_id: activeYear.id,
      name: 'العيد الوطني العراقي',
      start_date: '2026-10-03',
      end_date: '2026-10-03',
      holiday_type: 'official',
      notes: 'عطلة رسمية عامة',
    });
    createHoliday(db, {
      academic_year_id: activeYear.id,
      name: 'تعطيل بسبب الظروف الجوية',
      start_date: '2026-10-14',
      end_date: '2026-10-14',
      holiday_type: 'exceptional',
      notes: 'قرار المحافظة',
    });

    const reg = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
    });

    // Oct 3 coincides with Saturday weekly holiday + official holiday -> both preserved
    const day3Cell = reg.students[0].days[3];
    assert.equal(day3Cell.symbol, 'ع');
    assert.equal(day3Cell.holiday_info?.is_weekly_holiday, true);
    assert.equal(day3Cell.holiday_info?.is_official_or_special_holiday, true);
    assert.equal(day3Cell.holiday_info?.matching_holidays[0].name, 'العيد الوطني العراقي');

    // Oct 14 Wednesday -> exceptional holiday
    const day14Cell = reg.students[0].days[14];
    assert.equal(day14Cell.symbol, 'ع');
    assert.equal(day14Cell.holiday_info?.holiday_category, 'exceptional');
    assert.equal(day14Cell.holiday_info?.primary_reason, 'تعطيل بسبب الظروف الجوية');
  });

  // Scenario 17: Manual note add/edit/delete without affecting auto notes
  await test('17. إضافة وتعديل وحذف الملاحظة اليدوية دون المساس بالملاحظات التلقائية', () => {
    saveMonthlyStudentNote(db, {
      academic_year_id: activeYear.id,
      student_id: s1.id,
      year: 2026,
      month: 10,
      note_text: 'استدعاء ولي الأمر',
    });

    let reg = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
    });
    let row1 = reg.students.find((r) => r.student_id === s1.id)!;
    assert.equal(row1.manual_note, 'استدعاء ولي الأمر');
    assert.ok(row1.auto_notes.length >= 2); // sick_leave + daily_permissions preserved

    // Edit note
    saveMonthlyStudentNote(db, {
      academic_year_id: activeYear.id,
      student_id: s1.id,
      year: 2026,
      month: 10,
      note_text: 'تم توقيع التعهد من قبل ولي الأمر',
    });
    reg = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
    });
    row1 = reg.students.find((r) => r.student_id === s1.id)!;
    assert.equal(row1.manual_note, 'تم توقيع التعهد من قبل ولي الأمر');
    assert.ok(row1.auto_notes.length >= 2);

    // Delete manual note -> auto notes intact
    deleteMonthlyStudentNote(db, {
      academic_year_id: activeYear.id,
      student_id: s1.id,
      year: 2026,
      month: 10,
    });
    reg = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
    });
    row1 = reg.students.find((r) => r.student_id === s1.id)!;
    assert.equal(row1.manual_note, null);
    assert.ok(row1.auto_notes.length >= 2);

    // Re-save a manual note for persistence & Excel export verification
    saveMonthlyStudentNote(db, {
      academic_year_id: activeYear.id,
      student_id: s1.id,
      year: 2026,
      month: 10,
      note_text: 'متابعة مستمرة مع المرشد',
    });
  });

  // Scenario 18: Excel export verification (RTL, headers, legend, symbols, totals, notes)
  await test('18. تصدير السجل الشهري إلى ملف Excel والتحقق من البنية والمحتوى والاتجاه RTL', async () => {
    const { buffer, filename } = await generateMonthlyRegisterExcel(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
    });
    assert.ok(buffer.length > 5000);
    assert.ok(filename.endsWith('.xlsx'));

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = wb.worksheets[0];
    assert.ok(sheet);
    assert.equal(sheet.views[0]?.rightToLeft, true);
    assert.ok(String(sheet.getCell(1, 1).value).includes('ثانوية بغداد المركزية'));
    assert.ok(String(sheet.getCell(3, 1).value).includes('دليل الرموز'));

    // Find row for s1 (row 6)
    assert.ok(String(sheet.getCell(6, 1).value).includes(s1.full_name));
    // Oct 4 = column 2 + 3 = 5 -> 'غ'
    assert.equal(sheet.getCell(6, 5).value, 'غ');
    // Oct 5 = column 6 -> 'م'
    assert.equal(sheet.getCell(6, 6).value, 'م');
    // Notes column (last column) includes manual note
    const lastCol = 1 + 31 + 8;
    assert.ok(String(sheet.getCell(6, lastCol).value).includes('متابعة مستمرة مع المرشد'));
  });

  // Scenario 19: Print pagination & chunking for A3 Landscape vs A4 Portrait
  await test('19. اختبار تجهيز الطباعة وتقسيم الأعمدة التلقائي للورق الصغير A4 دون اقتصاص', () => {
    const reg = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
    });

    const a3Landscape = computeMonthlyPrintPages(reg.calendar_days, 'a3-landscape');
    assert.equal(a3Landscape.length, 1);
    assert.equal(a3Landscape[0].days.length, 31);
    assert.equal(a3Landscape[0].includeTotals, true);
    assert.equal(a3Landscape[0].includeNotes, true);

    const a4Portrait = computeMonthlyPrintPages(reg.calendar_days, 'a4-portrait');
    assert.equal(a4Portrait.length, 3); // days 1-16, days 17-31, totals+notes page
    assert.equal(a4Portrait[0].days.length, 16);
    assert.equal(a4Portrait[1].days.length, 15);
    assert.equal(a4Portrait[2].days.length, 0);
    assert.equal(a4Portrait[2].includeTotals, true);
    assert.equal(a4Portrait[2].includeNotes, true);
  });

  // Scenario 20: Quick search & alphabetical sort without modifying DB original order
  await test('20. البحث السريع والترتيب الأبجدي دون تغيير الترتيب الأصلي في قاعدة البيانات', () => {
    const original = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
      sort_mode: 'original',
    });
    assert.equal(original.students[0].full_name, 'زيدون طارق محمود');
    assert.equal(original.students[1].full_name, 'أحمد قاسم جبار');

    const alpha = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
      sort_mode: 'alphabetical',
    });
    assert.equal(alpha.students[0].full_name, 'أحمد قاسم جبار');
    assert.equal(alpha.students[0].original_order, 2); // preserves original order number

    const filtered = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
      search: 'زيدون',
    });
    assert.equal(filtered.students.length, 1);
    assert.equal(filtered.stats.total_students, 3); // section KPI remains intact
  });

  // Scenario 21: Persistence after closing & reopening SQLite DB + Live HTTP API test
  await test('21. ثبات جميع البيانات والملاحظات اليدوية بعد إغلاق SQLite وإعادة فتحه + فحص HTTP API', async () => {
    db.close();
    db = createDatabaseConnection(dbFilePath);

    const reopened = getMonthlyAbsenceRegister(db, {
      academic_year_id: activeYear.id,
      year: 2026,
      month: 10,
      grade_id: grade.id,
      section_id: secA.id,
    });
    const row1 = reopened.students.find((r) => r.student_id === s1.id)!;
    assert.equal(row1.manual_note, 'متابعة مستمرة مع المرشد');
    assert.equal(row1.total_counted_absence_days, 2);

    // Express API live check
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(() => db));
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    try {
      const getRes = await fetch(
        `http://127.0.0.1:${port}/api/monthly/register?academic_year_id=${activeYear.id}&year=2026&month=10&grade_id=${grade.id}&section_id=${secA.id}`
      );
      assert.equal(getRes.status, 200);
      const json = (await getRes.json()) as { students: Array<{ student_id: number }> };
      assert.equal(json.students.length, 3);

      const putNoteRes = await fetch(`http://127.0.0.1:${port}/api/monthly/note`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          academic_year_id: activeYear.id,
          student_id: s2.id,
          year: 2026,
          month: 10,
          note_text: 'ملاحظة عبر API',
        }),
      });
      assert.equal(putNoteRes.status, 200);

      const exportRes = await fetch(
        `http://127.0.0.1:${port}/api/monthly/export?academic_year_id=${activeYear.id}&year=2026&month=10&grade_id=${grade.id}&section_id=${secA.id}`
      );
      assert.equal(exportRes.status, 200);
      const buf = await exportRes.arrayBuffer();
      assert.ok(buf.byteLength > 5000);
    } finally {
      server.close();
    }
  });

  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nMonthly Register Tests Completed: ${results.length - failed.length}/${results.length} passed.`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

void runMonthlyRegisterTests();
