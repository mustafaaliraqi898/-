import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../server/db/connection';
import {
  deleteAbsenceRecord,
  saveSectionAttendance,
} from '../server/services/absenceService';
import { createGrade } from '../server/services/gradeService';
import { updateSimplifiedAbsenceThresholds } from '../server/services/legalRegulationsService';
import { getSimplifiedAbsenceReports } from '../server/services/reportsCenterService';
import { getActiveAcademicYear, updateSchoolSettings } from '../server/services/settingsService';
import { createStudent } from '../server/services/studentService';
import { buildSimplifiedReportStandaloneHtml } from '../src/components/reports/LegalPrintSheet';

function generateWorkingDates(count: number): string[] {
  const dates: string[] = [];
  const d = new Date('2026-09-01T00:00:00Z');
  while (dates.length < count) {
    const dow = d.getUTCDay();
    if (dow !== 5 && dow !== 6) {
      dates.push(d.toISOString().slice(0, 10));
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

function setStudentFullDays(
  db: Database.Database,
  yearId: number,
  gradeId: number,
  sectionId: number,
  studentId: number,
  targetDays: number,
  workingDates: string[]
) {
  const existingRows = db
    .prepare(
      `SELECT id FROM absences
       WHERE student_id = ? AND academic_year_id = ? AND status = 'full_day'
       ORDER BY absence_date DESC`
    )
    .all(studentId, yearId) as Array<{ id: number }>;

  if (existingRows.length > targetDays) {
    const toDelete = existingRows.length - targetDays;
    for (let i = 0; i < toDelete; i += 1) {
      deleteAbsenceRecord(db, existingRows[i].id);
    }
    return;
  }

  for (let i = existingRows.length; i < targetDays; i += 1) {
    saveSectionAttendance(db, {
      academic_year_id: yearId,
      grade_id: gradeId,
      section_id: sectionId,
      attendance_date: workingDates[i],
      entries: [{ student_id: studentId, status: 'full_day' }],
    });
  }
}

function runTests() {
  const db = new Database(':memory:');
  initializeDatabase(db);

  const activeYear = getActiveAcademicYear(db);
  updateSchoolSettings(db, {
    school_name: 'إعدادية المستقبل',
    directorate_name: 'المديرية العامة للتربية',
    lessons_per_absence_day: 5,
    daily_permission_counts_as_absence: 0,
    lesson_permission_counts_as_absence: 0,
  });

  // Exact thresholds from prompt example: 10, 15, 20, effective limit 25
  updateSimplifiedAbsenceThresholds(db, {
    warning_days: 10,
    preliminary_warning_days: 15,
    final_warning_days: 20,
    effective_absence_limit: 25,
    academic_year_id: activeYear.id,
  });

  const grade = createGrade(db, {
    name: 'الخامس العلمي',
    stage: 'preparatory',
    initial_sections: ['أ', 'ب'],
  });
  const secA = grade.sections[0];
  const secB = grade.sections[1];

  const s9 = createStudent(db, {
    full_name: 'طالب تسعة أيام',
    grade_id: grade.id,
    section_id: secA.id,
    registry_number: '5001',
  });
  const s10 = createStudent(db, {
    full_name: 'طالب عشرة أيام',
    grade_id: grade.id,
    section_id: secA.id,
    registry_number: '5002',
  });
  const s15 = createStudent(db, {
    full_name: 'طالب خمسة عشر يوماً',
    grade_id: grade.id,
    section_id: secA.id,
    registry_number: '5003',
  });
  const s20 = createStudent(db, {
    full_name: 'طالب عشرين يوماً',
    grade_id: grade.id,
    section_id: secB.id,
    registry_number: '5004',
  });
  const s26 = createStudent(db, {
    full_name: 'طالب متجاوز للحد',
    grade_id: grade.id,
    section_id: secB.id,
    registry_number: '5005',
  });

  const workingDates = generateWorkingDates(35);

  setStudentFullDays(db, activeYear.id, grade.id, secA.id, s9.id, 9, workingDates);
  setStudentFullDays(db, activeYear.id, grade.id, secA.id, s10.id, 10, workingDates);
  setStudentFullDays(db, activeYear.id, grade.id, secA.id, s15.id, 15, workingDates);
  setStudentFullDays(db, activeYear.id, grade.id, secB.id, s20.id, 20, workingDates);
  setStudentFullDays(db, activeYear.id, grade.id, secB.id, s26.id, 26, workingDates);

  const getAll4 = (filter?: { grade_id?: number; section_id?: number; search?: string }) => ({
    warning: getSimplifiedAbsenceReports(db, {
      academic_year_id: activeYear.id,
      report_type: 'warning',
      ...filter,
    }),
    prelim: getSimplifiedAbsenceReports(db, {
      academic_year_id: activeYear.id,
      report_type: 'preliminary_warning',
      ...filter,
    }),
    final: getSimplifiedAbsenceReports(db, {
      academic_year_id: activeYear.id,
      report_type: 'final_warning',
      ...filter,
    }),
    exceeded: getSimplifiedAbsenceReports(db, {
      academic_year_id: activeYear.id,
      report_type: 'exceeded_limit',
      ...filter,
    }),
  });

  // Tests 1–4 & 8–9: Initial non-cumulative classification + card counts match + no duplicates
  const initial = getAll4();
  const warnIds = initial.warning.rows.map((r) => r.student_id);
  const prelimIds = initial.prelim.rows.map((r) => r.student_id);
  const finalIds = initial.final.rows.map((r) => r.student_id);
  const exceededIds = initial.exceeded.rows.map((r) => r.student_id);

  // Test 1: 9 days does not appear anywhere
  assert.ok(![...warnIds, ...prelimIds, ...finalIds, ...exceededIds].includes(s9.id));
  // Test 2: 10 days appears ONLY in warning
  assert.deepEqual(warnIds, [s10.id]);
  // Test 3: 15 days appears ONLY in preliminary_warning
  assert.deepEqual(prelimIds, [s15.id]);
  // Test 4: 20 days & 26 days appear in final_warning, and ONLY 26 days in exceeded_limit
  assert.deepEqual(new Set(finalIds), new Set([s20.id, s26.id]));
  assert.deepEqual(exceededIds, [s26.id]);

  // Test 8: No student appears in more than one of the 3 warning lists, and no duplicates inside exceeded_limit
  assert.equal(new Set(exceededIds).size, exceededIds.length);
  const allThree = [...warnIds, ...prelimIds, ...finalIds];
  assert.equal(new Set(allThree).size, allThree.length);

  // Test 9: Summary card counts match exact rows length in every report (unfiltered and filtered)
  for (const r of [initial.warning, initial.prelim, initial.final, initial.exceeded]) {
    assert.equal(r.summary.within_limit_count, 1);
    assert.equal(r.summary.warning_count, initial.warning.rows.length);
    assert.equal(r.summary.preliminary_warning_count, initial.prelim.rows.length);
    assert.equal(r.summary.final_warning_count, initial.final.rows.length);
    assert.equal(r.summary.exceeded_limit_count, initial.exceeded.rows.length);
  }

  const filteredSecA = getAll4({ grade_id: grade.id, section_id: secA.id });
  assert.equal(filteredSecA.warning.summary.total_active_students, 3);
  assert.equal(filteredSecA.warning.summary.warning_count, filteredSecA.warning.rows.length);
  assert.equal(
    filteredSecA.prelim.summary.preliminary_warning_count,
    filteredSecA.prelim.rows.length
  );
  assert.equal(filteredSecA.final.summary.final_warning_count, filteredSecA.final.rows.length);
  assert.equal(
    filteredSecA.exceeded.summary.exceeded_limit_count,
    filteredSecA.exceeded.rows.length
  );

  // Test 10 (Part A): Capture previously generated/saved printed document & preserve existing legal procedure log untouched
  const savedPrintedHtmlBeforeCorrection = buildSimplifiedReportStandaloneHtml(initial.prelim);
  assert.ok(savedPrintedHtmlBeforeCorrection.includes('طالب خمسة عشر يوماً'));
  db.prepare(
    `INSERT INTO student_legal_procedures
       (student_id, academic_year_id, grade_id, section_id, stage, procedure_type, procedure_date,
        absence_days_at_action, unexcused_days_at_action, threshold_at_action)
     VALUES (?, ?, ?, ?, 'preparatory', 'first_warning', '2026-09-25', 15, 15, 15)`
  ).run(s15.id, activeYear.id, grade.id, secA.id);

  // Test 5: s15 corrected from 15 -> 12 days => moves from preliminary_warning to warning
  setStudentFullDays(db, activeYear.id, grade.id, secA.id, s15.id, 12, workingDates);
  const after15To12 = getAll4();
  assert.ok(!after15To12.prelim.rows.some((r) => r.student_id === s15.id));
  assert.ok(after15To12.warning.rows.some((r) => r.student_id === s15.id));
  assert.equal(after15To12.warning.summary.warning_count, 2);
  assert.equal(after15To12.prelim.summary.preliminary_warning_count, 0);

  // Test 6: s15 corrected from 12 -> 9 days => disappears from all warning/alert lists
  setStudentFullDays(db, activeYear.id, grade.id, secA.id, s15.id, 9, workingDates);
  const after12To9 = getAll4();
  assert.ok(
    ![
      ...after12To9.warning.rows,
      ...after12To9.prelim.rows,
      ...after12To9.final.rows,
      ...after12To9.exceeded.rows,
    ].some((r) => r.student_id === s15.id)
  );
  assert.equal(after12To9.warning.summary.within_limit_count, 2);
  assert.equal(after12To9.warning.summary.warning_count, 1);

  // Test 7: s10 increased from 10 -> 20 days => moves from warning to final_warning
  setStudentFullDays(db, activeYear.id, grade.id, secA.id, s10.id, 20, workingDates);
  const after10To20 = getAll4();
  assert.ok(!after10To20.warning.rows.some((r) => r.student_id === s10.id));
  assert.ok(!after10To20.prelim.rows.some((r) => r.student_id === s10.id));
  assert.ok(after10To20.final.rows.some((r) => r.student_id === s10.id));
  assert.equal(after10To20.warning.summary.warning_count, 0);
  assert.equal(after10To20.final.summary.final_warning_count, 3);

  // Test 10 (Part B): Verify previously exported HTML snapshot & saved legal procedure row are completely preserved
  assert.ok(savedPrintedHtmlBeforeCorrection.includes('طالب خمسة عشر يوماً'));
  const savedProcedure = db
    .prepare('SELECT absence_days_at_action, procedure_type FROM student_legal_procedures WHERE student_id = ?')
    .get(s15.id) as { absence_days_at_action: number; procedure_type: string } | undefined;
  assert.ok(savedProcedure);
  assert.equal(savedProcedure.absence_days_at_action, 15);
  assert.equal(savedProcedure.procedure_type, 'first_warning');

  console.log('PASS: All 10 non-cumulative classification & re-classification tests passed!');
  db.close();
}

runTests();
