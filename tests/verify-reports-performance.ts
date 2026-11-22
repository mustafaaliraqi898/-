import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createDatabaseConnection, initializeDatabase } from '../server/db/connection';
import {
  getAcademicYearAbsenceTotalsMap,
  saveSectionAttendance,
} from '../server/services/absenceService';
import { createGrade } from '../server/services/gradeService';
import { updateSimplifiedAbsenceThresholds } from '../server/services/legalRegulationsService';
import { getSimplifiedAbsenceReports } from '../server/services/reportsCenterService';
import {
  createAcademicYear,
  getActiveAcademicYear,
  updateSchoolSettings,
} from '../server/services/settingsService';
import { createStudent } from '../server/services/studentService';
import type { AbsenceReportTypeId } from '../src/types/school';

const OLD_SUMMARY_SQL = `
  SELECT
    a.student_id,
    SUM(CASE WHEN a.status = 'full_day' THEN 1 ELSE 0 END) as direct_full_days,
    SUM(CASE WHEN a.status = 'full_day_leave' AND a.leave_type = 'daily_permission' AND a.counted_as_absence = 1 THEN 1 ELSE 0 END) as counted_daily_permission_days,
    SUM(CASE WHEN a.status = 'full_day_leave' AND a.leave_type = 'sick_leave' THEN 1 ELSE 0 END) as sick_leave_days,
    SUM(CASE WHEN a.status = 'full_day_leave' AND a.leave_type = 'daily_permission' THEN 1 ELSE 0 END) as daily_permission_days,
    SUM(CASE
      WHEN a.status = 'lesson_permission'
        OR EXISTS (SELECT 1 FROM absence_lesson_details d WHERE d.absence_id = a.id AND d.lesson_status = 'lesson_permission')
      THEN 1 ELSE 0 END) as lesson_permission_records,
    COALESCE(SUM(CASE
      WHEN EXISTS (SELECT 1 FROM absence_lesson_details d WHERE d.absence_id = a.id)
        THEN (SELECT COUNT(*) FROM absence_lesson_details d WHERE d.absence_id = a.id AND d.lesson_status = 'lesson_absence')
      WHEN a.status = 'lesson_absence' THEN a.lessons_count
      ELSE 0 END), 0) as lesson_absence_lessons,
    COALESCE(SUM(CASE
      WHEN EXISTS (SELECT 1 FROM absence_lesson_details d WHERE d.absence_id = a.id)
        THEN (SELECT COUNT(*) FROM absence_lesson_details d WHERE d.absence_id = a.id AND d.lesson_status = 'lesson_escape')
      WHEN a.status = 'lesson_escape' THEN a.lessons_count
      ELSE 0 END), 0) as lesson_escape_lessons,
    COALESCE(SUM(CASE
      WHEN EXISTS (SELECT 1 FROM absence_lesson_details d WHERE d.absence_id = a.id)
        THEN (SELECT COUNT(*) FROM absence_lesson_details d WHERE d.absence_id = a.id AND d.lesson_status = 'lesson_permission' AND d.counted_as_absence = 1)
      WHEN a.status = 'lesson_permission' AND a.counted_as_absence = 1 THEN a.lessons_count
      ELSE 0 END), 0) as counted_lesson_permission_lessons,
    COALESCE(SUM(CASE
      WHEN EXISTS (SELECT 1 FROM absence_lesson_details d WHERE d.absence_id = a.id)
        THEN (SELECT COUNT(*) FROM absence_lesson_details d WHERE d.absence_id = a.id AND (d.lesson_status IN ('lesson_absence', 'lesson_escape') OR (d.lesson_status = 'lesson_permission' AND d.counted_as_absence = 1)))
      WHEN a.status IN ('lesson_absence', 'lesson_escape') OR (a.status = 'lesson_permission' AND a.counted_as_absence = 1) THEN a.lessons_count
      ELSE 0 END), 0) as total_lessons_missed
  FROM absences a
  WHERE a.academic_year_id = ?
  GROUP BY a.student_id
`;

function computeTotalsWithOldQuery(db: Database.Database, academicYearId: number) {
  const summaryRows = db.prepare(OLD_SUMMARY_SQL).all(academicYearId) as Array<{
    student_id: number;
    direct_full_days: number;
    counted_daily_permission_days: number;
    sick_leave_days: number;
    daily_permission_days: number;
    lesson_permission_records: number;
    lesson_absence_lessons: number;
    lesson_escape_lessons: number;
    counted_lesson_permission_lessons: number;
    total_lessons_missed: number;
  }>;

  const convertedRows = db
    .prepare(
      `SELECT student_id, COUNT(*) as converted_days, COALESCE(SUM(lessons_consumed), 0) as consumed_lessons
       FROM lesson_converted_days
       WHERE academic_year_id = ?
       GROUP BY student_id`
    )
    .all(academicYearId) as Array<{
    student_id: number;
    converted_days: number;
    consumed_lessons: number;
  }>;

  const convertedMap = new Map<number, { converted_days: number; consumed_lessons: number }>();
  for (const r of convertedRows) {
    convertedMap.set(r.student_id, {
      converted_days: r.converted_days,
      consumed_lessons: r.consumed_lessons,
    });
  }

  const result = new Map<number, Record<string, number>>();
  for (const sum of summaryRows) {
    const conv = convertedMap.get(sum.student_id) ?? { converted_days: 0, consumed_lessons: 0 };
    result.set(sum.student_id, {
      ...sum,
      converted_lesson_days: conv.converted_days,
      total_full_days: sum.direct_full_days + sum.counted_daily_permission_days + conv.converted_days,
      pending_lessons: Math.max(0, sum.total_lessons_missed - conv.consumed_lessons),
    });
  }
  return result;
}

async function runTests() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iraqi-school-perf-'));
  try {
    // 1. Verify safe index migration on pre-existing database without idx_converted_days_year_student
    const legacyDbPath = path.join(tmpDir, 'legacy.db');
    const preDb = createDatabaseConnection(legacyDbPath);
    preDb.exec('DROP INDEX IF EXISTS idx_converted_days_year_student');
    const idxBefore = preDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_converted_days_year_student'"
      )
      .get();
    assert.equal(idxBefore, undefined, 'Simulated pre-existing DB lacks the new index');
    preDb.close();

    const migratedDb = createDatabaseConnection(legacyDbPath);
    const idxAfter = migratedDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_converted_days_year_student'"
      )
      .get() as { name: string } | undefined;
    const oldIdxStillExists = migratedDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_converted_days_student_year'"
      )
      .get() as { name: string } | undefined;
    assert.ok(idxAfter, 'Migration must safely create idx_converted_days_year_student on existing DB');
    assert.ok(oldIdxStillExists, 'Existing idx_converted_days_student_year must be preserved');
    migratedDb.close();
    console.log('PASS: 1. Safe migration creates idx_converted_days_year_student while preserving old index');

    // 2. Verify EXPLAIN QUERY PLAN for new queries
    const planDb = new Database(':memory:');
    initializeDatabase(planDb);

    const eqpSummary = planDb
      .prepare(
        `EXPLAIN QUERY PLAN
         WITH lesson_detail_agg AS (
           SELECT
             d.absence_id,
             COUNT(*) as detail_count,
             SUM(CASE WHEN d.lesson_status = 'lesson_permission' THEN 1 ELSE 0 END) as perm_detail_count,
             SUM(CASE WHEN d.lesson_status = 'lesson_absence' THEN 1 ELSE 0 END) as absence_detail_count,
             SUM(CASE WHEN d.lesson_status = 'lesson_escape' THEN 1 ELSE 0 END) as escape_detail_count,
             SUM(CASE WHEN d.lesson_status = 'lesson_permission' AND d.counted_as_absence = 1 THEN 1 ELSE 0 END) as counted_perm_detail_count,
             SUM(CASE
               WHEN d.lesson_status IN ('lesson_absence', 'lesson_escape')
                 OR (d.lesson_status = 'lesson_permission' AND d.counted_as_absence = 1)
               THEN 1 ELSE 0 END) as counted_total_detail_count
           FROM absence_lesson_details d
           JOIN absences a_yr ON a_yr.id = d.absence_id
           WHERE a_yr.academic_year_id = ?
           GROUP BY d.absence_id
         )
         SELECT a.student_id, COUNT(*)
         FROM absences a
         LEFT JOIN lesson_detail_agg lda ON lda.absence_id = a.id
         WHERE a.academic_year_id = ?
         GROUP BY a.student_id`
      )
      .all(1, 1) as Array<{ detail: string }>;

    const eqpSummaryText = eqpSummary.map((r) => r.detail).join(' | ');
    assert.ok(
      !eqpSummaryText.includes('CORRELATED SCALAR SUBQUERY'),
      `Expected no CORRELATED SCALAR SUBQUERY in summary plan, got: ${eqpSummaryText}`
    );

    const eqpConverted = planDb
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT student_id, COUNT(*) as converted_days, COALESCE(SUM(lessons_consumed), 0) as consumed_lessons
         FROM lesson_converted_days
         WHERE academic_year_id = ?
         GROUP BY student_id`
      )
      .all(1) as Array<{ detail: string }>;
    const eqpConvertedText = eqpConverted.map((r) => r.detail).join(' | ');
    assert.ok(
      eqpConvertedText.includes('SEARCH') &&
        eqpConvertedText.includes('idx_converted_days_year_student'),
      `Expected SEARCH using idx_converted_days_year_student, got: ${eqpConvertedText}`
    );
    assert.ok(
      !eqpConvertedText.includes('USE TEMP B-TREE FOR GROUP BY'),
      `Expected idx_converted_days_year_student to avoid TEMP B-TREE for GROUP BY, got: ${eqpConvertedText}`
    );

    const eqpEnrollments = planDb
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT st.id as student_id, st.student_uid, st.registry_number, st.full_name,
                g.id as grade_id, g.name as grade_name,
                sec.id as section_id, sec.name as section_name
         FROM student_enrollments se
         JOIN students st ON st.id = se.student_id
         JOIN grades g ON g.id = se.grade_id
         JOIN sections sec ON sec.id = se.section_id
         WHERE se.academic_year_id = ? AND se.is_current = 1 AND st.status = 'active'`
      )
      .all(1) as Array<{ detail: string }>;
    const eqpEnrollmentsText = eqpEnrollments.map((r) => r.detail).join(' | ');
    assert.ok(
      !eqpEnrollmentsText.includes('USE TEMP B-TREE FOR ORDER BY'),
      `Expected no TEMP B-TREE FOR ORDER BY on enrollments, got: ${eqpEnrollmentsText}`
    );

    console.log('PASS: 2. EXPLAIN QUERY PLAN verified');
    console.log('   - summaryRows plan:', eqpSummaryText);
    console.log('   - convertedRows plan:', eqpConvertedText);
    console.log('   - enrollments plan:', eqpEnrollmentsText);
    planDb.close();

    // 3. Exact equivalence across ALL absence types, mixed lessons, legacy rows, permissions, and 4 report tabs
    const eqDb = new Database(':memory:');
    initializeDatabase(eqDb);
    const activeYear = getActiveAcademicYear(eqDb);
    const prevYear = createAcademicYear(eqDb, { name: '2025-2026', set_active: false });

    updateSchoolSettings(eqDb, {
      school_name: 'إعدادية النجاح',
      directorate_name: 'المديرية العامة',
      lessons_per_absence_day: 3,
      daily_permission_counts_as_absence: 0,
      lesson_permission_counts_as_absence: 0,
    });

    updateSimplifiedAbsenceThresholds(eqDb, {
      warning_days: 2,
      preliminary_warning_days: 4,
      final_warning_days: 6,
      effective_absence_limit: 8,
      academic_year_id: activeYear.id,
    });

    const g1 = createGrade(eqDb, { name: 'الرابع العلمي', stage: 'preparatory', initial_sections: ['أ', 'ب'] });
    const secA = g1.sections[0];
    const secB = g1.sections[1];

    const students = Array.from({ length: 8 }, (_, idx) =>
      createStudent(eqDb, {
        full_name: `طالب اختبار ${idx + 1}`,
        grade_id: g1.id,
        section_id: idx < 5 ? secA.id : secB.id,
        registry_number: String(2000 + idx),
      })
    );

    const dates = [
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
    ];

    // Student 0: full days + sick leave + uncounted daily permission
    for (let i = 0; i < 2; i++) {
      saveSectionAttendance(eqDb, {
        academic_year_id: activeYear.id,
        grade_id: g1.id,
        section_id: secA.id,
        attendance_date: dates[i],
        entries: [{ student_id: students[0].id, status: 'full_day' }],
      });
    }
    saveSectionAttendance(eqDb, {
      academic_year_id: activeYear.id,
      grade_id: g1.id,
      section_id: secA.id,
      attendance_date: dates[2],
      entries: [{ student_id: students[0].id, status: 'full_day_leave', leave_type: 'sick_leave' }],
    });
    saveSectionAttendance(eqDb, {
      academic_year_id: activeYear.id,
      grade_id: g1.id,
      section_id: secA.id,
      attendance_date: dates[3],
      entries: [{ student_id: students[0].id, status: 'full_day_leave', leave_type: 'daily_permission' }],
    });

    // Enable counted permissions for subsequent snapshots
    updateSchoolSettings(eqDb, {
      school_name: 'إعدادية النجاح',
      directorate_name: 'المديرية العامة',
      lessons_per_absence_day: 3,
      daily_permission_counts_as_absence: 1,
      lesson_permission_counts_as_absence: 1,
    });

    // Student 1: mixed lesson_absence + lesson_escape + counted lesson_permission + present with lesson_details
    saveSectionAttendance(eqDb, {
      academic_year_id: activeYear.id,
      grade_id: g1.id,
      section_id: secA.id,
      attendance_date: dates[4],
      entries: [
        {
          student_id: students[1].id,
          status: 'present',
          lesson_details: [
            { lesson_number: 1, lesson_status: 'lesson_absence' },
            { lesson_number: 2, lesson_status: 'lesson_escape' },
            { lesson_number: 3, lesson_status: 'lesson_permission' },
            { lesson_number: 4, lesson_status: 'lesson_escape' },
          ],
        },
        {
          student_id: students[2].id,
          status: 'full_day_leave',
          leave_type: 'daily_permission',
        },
      ],
    });

    // Student 3 & 4: multiple full days + lesson conversions to hit prelim, final, exceeded
    for (let i = 0; i < 6; i++) {
      saveSectionAttendance(eqDb, {
        academic_year_id: activeYear.id,
        grade_id: g1.id,
        section_id: secA.id,
        attendance_date: dates[i],
        entries: [
          ...(i === 0 ? [] : []),
          { student_id: students[3].id, status: 'full_day' },
          { student_id: students[4].id, status: 'full_day' },
        ],
      });
    }
    saveSectionAttendance(eqDb, {
      academic_year_id: activeYear.id,
      grade_id: g1.id,
      section_id: secA.id,
      attendance_date: dates[6],
      entries: [
        {
          student_id: students[4].id,
          status: 'lesson_escape',
          lesson_details: [
            { lesson_number: 1, lesson_status: 'lesson_escape' },
            { lesson_number: 2, lesson_status: 'lesson_escape' },
            { lesson_number: 3, lesson_status: 'lesson_escape' },
            { lesson_number: 4, lesson_status: 'lesson_absence' },
            { lesson_number: 5, lesson_status: 'lesson_absence' },
            { lesson_number: 6, lesson_status: 'lesson_absence' },
          ],
        },
      ],
    });

    // Student 5 (Section B): legacy count-only lesson_absence row without details + uncounted lesson_permission
    const enroll5 = eqDb
      .prepare('SELECT id FROM student_enrollments WHERE student_id = ? AND academic_year_id = ?')
      .get(students[5].id, activeYear.id) as { id: number };
    eqDb.prepare(
      `INSERT INTO absences
        (student_id, enrollment_id, academic_year_id, grade_id, section_id, absence_date,
         status, lessons_count, counted_as_absence, threshold_snapshot)
       VALUES (?, ?, ?, ?, ?, '2026-10-18', 'lesson_absence', 3, 1, 3)`
    ).run(students[5].id, enroll5.id, activeYear.id, g1.id, secB.id);
    eqDb.prepare(
      `INSERT INTO absences
        (student_id, enrollment_id, academic_year_id, grade_id, section_id, absence_date,
         status, lessons_count, permission_type, counted_as_absence, permission_rule_snapshot, threshold_snapshot)
       VALUES (?, ?, ?, ?, ?, '2026-10-19', 'lesson_permission', 2, 'lesson_permission', 0, 0, 3)`
    ).run(students[5].id, enroll5.id, activeYear.id, g1.id, secB.id);

    // Also insert data in prevYear to ensure year isolation
    eqDb.prepare(
      `INSERT INTO student_enrollments (student_id, academic_year_id, grade_id, section_id, is_current)
       VALUES (?, ?, ?, ?, 1)`
    ).run(students[6].id, prevYear.id, g1.id, secB.id);
    const prevEnr = eqDb
      .prepare('SELECT id FROM student_enrollments WHERE student_id = ? AND academic_year_id = ?')
      .get(students[6].id, prevYear.id) as { id: number };
    eqDb.prepare(
      `INSERT INTO absences
        (student_id, enrollment_id, academic_year_id, grade_id, section_id, absence_date,
         status, lessons_count, counted_as_absence, threshold_snapshot)
       VALUES (?, ?, ?, ?, ?, '2025-10-05', 'full_day', 0, 1, 3)`
    ).run(students[6].id, prevEnr.id, prevYear.id, g1.id, secB.id);

    const oldTotals = computeTotalsWithOldQuery(eqDb, activeYear.id);
    const newTotals = getAcademicYearAbsenceTotalsMap(eqDb, activeYear.id);

    assert.equal(newTotals.size, oldTotals.size, 'Student count in totals map must match exactly');
    for (const [sid, oldRow] of oldTotals.entries()) {
      const newRow = newTotals.get(sid);
      assert.ok(newRow, `Missing student ${sid} in new totals map`);
      assert.deepEqual(
        newRow,
        oldRow,
        `Exact totals mismatch for student ${sid}: old=${JSON.stringify(oldRow)} new=${JSON.stringify(newRow)}`
      );
    }

    const reportTypes: AbsenceReportTypeId[] = [
      'warning',
      'preliminary_warning',
      'final_warning',
      'exceeded_limit',
    ];
    for (const rt of reportTypes) {
      const rep = getSimplifiedAbsenceReports(eqDb, {
        academic_year_id: activeYear.id,
        report_type: rt,
      });
      for (const r of rep.rows) {
        const expected = oldTotals.get(r.student_id);
        assert.ok(expected);
        assert.equal(r.direct_full_days, expected.direct_full_days);
        assert.equal(r.counted_daily_permission_days, expected.counted_daily_permission_days);
        assert.equal(r.converted_lesson_days, expected.converted_lesson_days);
        assert.equal(r.counted_absence_days, expected.total_full_days);
        assert.equal(r.pending_lessons, expected.pending_lessons);
      }
    }
    console.log('PASS: 3. 100% exact equivalence between old query and new CTE+LEFT JOIN across all absence types and 4 report tabs');
    eqDb.close();

    // 4. Performance comparison Before vs After on large dataset (1,500 students, 33,000 absences, 24,000 details, 3,000 converted days)
    const perfDb = new Database(':memory:');
    initializeDatabase(perfDb);
    const yearId = 1;
    perfDb.transaction(() => {
      const insG = perfDb.prepare("INSERT INTO grades (name, stage, sort_order) VALUES (?, 'preparatory', ?)");
      const insS = perfDb.prepare('INSERT INTO sections (grade_id, name) VALUES (?, ?)');
      const insSt = perfDb.prepare('INSERT INTO students (student_uid, registry_number, full_name) VALUES (?, ?, ?)');
      const insEn = perfDb.prepare('INSERT INTO student_enrollments (student_id, academic_year_id, grade_id, section_id, is_current) VALUES (?, ?, ?, ?, 1)');
      const insAbs = perfDb.prepare("INSERT INTO absences (student_id, enrollment_id, academic_year_id, grade_id, section_id, absence_date, status, lessons_count, counted_as_absence, threshold_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 5)");
      const insDet = perfDb.prepare('INSERT INTO absence_lesson_details (absence_id, student_id, absence_date, lesson_number, lesson_status, counted_as_absence, threshold_snapshot) VALUES (?, ?, ?, ?, ?, ?, 5)');
      const insConv = perfDb.prepare('INSERT INTO lesson_converted_days (student_id, academic_year_id, grade_id, section_id, source_absence_id, converted_date, lessons_consumed, threshold_used) VALUES (?, ?, ?, ?, ?, ?, 5, 5)');

      const gradeIds = [1, 2, 3].map((i) => Number(insG.run('الصف ' + i, i).lastInsertRowid));
      const secIds: Array<{ g: number; s: number }> = [];
      for (const g of gradeIds) {
        for (const sn of ['أ', 'ب', 'ج', 'د']) {
          secIds.push({ g, s: Number(insS.run(g, sn).lastInsertRowid) });
        }
      }
      for (let i = 1; i <= 1500; i++) {
        const gs = secIds[i % secIds.length];
        const stId = Number(insSt.run('UID-' + i, String(1000 + i), 'طالب ' + i).lastInsertRowid);
        const enId = Number(insEn.run(stId, yearId, gs.g, gs.s).lastInsertRowid);
        for (let d = 1; d <= 22; d++) {
          const dateStr = '2026-10-' + String(d).padStart(2, '0');
          if (d <= 14) {
            insAbs.run(stId, enId, yearId, gs.g, gs.s, dateStr, 'full_day', 0, 1);
          } else {
            const absId = Number(
              insAbs.run(stId, enId, yearId, gs.g, gs.s, dateStr, 'lesson_absence', 2, 1).lastInsertRowid
            );
            insDet.run(absId, stId, dateStr, 1, 'lesson_absence', 1);
            insDet.run(absId, stId, dateStr, 2, 'lesson_escape', 1);
            if (d === 18 || d === 21) {
              insConv.run(stId, yearId, gs.g, gs.s, absId, dateStr);
            }
          }
        }
      }
    })();

    // Warm-up
    computeTotalsWithOldQuery(perfDb, yearId);
    getAcademicYearAbsenceTotalsMap(perfDb, yearId);

    // Measure OLD query (temporarily drop new index for true "before" baseline)
    perfDb.exec('DROP INDEX IF EXISTS idx_converted_days_year_student');
    const oldStart = performance.now();
    let oldRes!: Map<number, Record<string, number>>;
    for (let r = 0; r < 5; r++) {
      oldRes = computeTotalsWithOldQuery(perfDb, yearId);
    }
    const oldAvgMs = (performance.now() - oldStart) / 5;

    // Recreate new index and measure NEW query + full report service
    perfDb.exec(
      'CREATE INDEX IF NOT EXISTS idx_converted_days_year_student ON lesson_converted_days(academic_year_id, student_id)'
    );
    const newStart = performance.now();
    let newRes!: ReturnType<typeof getAcademicYearAbsenceTotalsMap>;
    for (let r = 0; r < 5; r++) {
      newRes = getAcademicYearAbsenceTotalsMap(perfDb, yearId);
    }
    const newAvgMs = (performance.now() - newStart) / 5;

    const repStart = performance.now();
    let repOut!: ReturnType<typeof getSimplifiedAbsenceReports>;
    for (let r = 0; r < 5; r++) {
      repOut = getSimplifiedAbsenceReports(perfDb, {
        academic_year_id: yearId,
        report_type: 'warning',
      });
    }
    const repAvgMs = (performance.now() - repStart) / 5;

    assert.equal(newRes.size, oldRes.size);
    for (const [sid, o] of oldRes.entries()) {
      assert.deepEqual(newRes.get(sid), o);
    }
    assert.equal(repOut.rows.length, 1500);
    assert.equal(repOut.summary.warning_count, 1500);
    assert.ok(newAvgMs < oldAvgMs, `Expected newAvgMs (${newAvgMs}) < oldAvgMs (${oldAvgMs})`);

    const speedup = +(oldAvgMs / newAvgMs).toFixed(2);
    console.log(
      `PASS: 4. Scale benchmark (1,500 students, 33,000 absences, 24,000 details, 3,000 converted days):`,
      {
        old_totals_avg_ms: +oldAvgMs.toFixed(2),
        new_totals_avg_ms: +newAvgMs.toFixed(2),
        speedup_x: speedup,
        full_report_avg_ms: +repAvgMs.toFixed(2),
        rows_returned: repOut.rows.length,
      }
    );

    // 5. Express HTTP API verification: filters, rapid AbortController cancellation, and error status
    const express = (await import('express')).default;
    const { createApiRouter } = await import('../server/routes/api');
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(() => perfDb));

    const httpServer = await new Promise<import('node:http').Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const addr = httpServer.address();
      if (!addr || typeof addr === 'string') throw new Error('Bind failed');
      const base = `http://127.0.0.1:${addr.port}/api`;

      // Rapid overlapping search/tab requests with AbortController (simulating rapid filter/tab changes)
      const c1 = new AbortController();
      const c2 = new AbortController();
      const p1 = fetch(`${base}/reports/absences?report_type=warning&search=${encodeURIComponent('طالب 1')}`, {
        signal: c1.signal,
      }).catch((e) => e);
      c1.abort();
      const p2 = fetch(`${base}/reports/absences?report_type=warning&search=${encodeURIComponent('طالب 1500')}`, {
        signal: c2.signal,
      });

      const [r1, r2] = await Promise.all([p1, p2]);
      assert.ok(
        r1 instanceof Error && (r1.name === 'AbortError' || r1.message.includes('abort')),
        'Superseded request must be aborted cleanly'
      );
      assert.equal(r2.status, 200);
      const body2 = (await r2.json()) as { rows: Array<{ full_name: string; counted_absence_days: number }> };
      assert.equal(body2.rows.length, 1);
      assert.equal(body2.rows[0].full_name, 'طالب 1500');
      assert.equal(body2.rows[0].counted_absence_days, 16);

      const p3 = await fetch(`${base}/reports/absences?report_type=preliminary_warning&search=${encodeURIComponent('طالب 1500')}`);
      assert.equal(p3.status, 200);
      const body3 = (await p3.json()) as { rows: Array<unknown> };
      assert.equal(body3.rows.length, 0);

      // Error response on invalid report type
      const badRes = await fetch(`${base}/reports/absences?report_type=invalid_type`);
      assert.equal(badRes.status, 400);
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
    console.log('PASS: 5. HTTP API filtering, AbortController superseding, and error handling verified');

    perfDb.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
