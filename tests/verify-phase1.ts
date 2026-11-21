import assert from 'node:assert/strict';
import http from 'node:http';
import ExcelJS from 'exceljs';
import express from 'express';
import { createDatabaseConnection } from '../server/db/connection';
import { createApiRouter } from '../server/routes/api';
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
  updateSection,
} from '../server/services/gradeService';
import {
  createAcademicYear,
  getSchoolSettings,
  setActiveAcademicYear,
  updateSchoolSettings,
} from '../server/services/settingsService';
import {
  createStudent,
  deleteStudent,
  getStudentEnrollmentHistory,
  listStudents,
  transferStudent,
  updateStudent,
} from '../server/services/studentService';

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

  const db = createDatabaseConnection(':memory:');

  await test('1. Database bootstrap creates settings & active academic year with zero fake students', () => {
    const settings = getSchoolSettings(db);
    assert.ok(settings.school_name.length > 0);
    assert.ok(settings.academic_year_id !== null);
    const stats = getDashboardStats(db);
    assert.equal(stats.total_students, 0);
    assert.equal(stats.total_grades, 0);
    assert.equal(stats.total_sections, 0);
    assert.equal(stats.absence_days_count, 0);
    assert.equal(stats.last_absence_date, null);
  });

  await test('2. Dynamic Grades & Sections CRUD + Integrity Guards', () => {
    const g1 = createGrade(db, { name: 'الأول المتوسط', initial_sections: ['أ', 'ب'] });
    assert.equal(g1.sections.length, 2);

    const g2 = createGrade(db, { name: 'الثاني المتوسط' });
    assert.equal(g2.sections.length, 0);

    const addedSecs = createSections(db, g2.id, { names: ['أ', 'ج'], capacity: 35 });
    assert.equal(addedSecs.length, 2);

    const renamedGrade = updateGrade(db, g2.id, { name: 'الثاني المتوسط - معدل' });
    assert.equal(renamedGrade.name, 'الثاني المتوسط - معدل');

    const updatedSec = updateSection(db, addedSecs[1].id, { name: 'ب', capacity: 40 });
    assert.equal(updatedSec.name, 'ب');
    assert.equal(updatedSec.capacity, 40);

    // Deleting grade with sections must be blocked
    assert.throws(() => deleteGrade(db, g1.id), /شعبة مرتبطة/);

    // Deleting empty section works, then deleting empty grade works
    const g3 = createGrade(db, { name: 'صف تجريبي', initial_sections: ['و'] });
    deleteSection(db, g3.sections[0].id);
    deleteGrade(db, g3.id);

    const all = listGradesWithSections(db);
    assert.equal(all.length, 2);
  });

  await test('3. Individual Student CRUD, optional & unique registry_number, and no-guardian schema', () => {
    const grades = listGradesWithSections(db);
    const g1 = grades[0];
    const secA = g1.sections[0];

    // Create student WITH registry number
    const st1 = createStudent(db, {
      full_name: 'علي حسين محمد كاظم',
      grade_id: g1.id,
      section_id: secA.id,
      registry_number: '1001',
      birth_date: '2012-03-15',
      phone: '07701234567',
    });
    assert.match(st1.student_uid, /^STD-\d{5}$/);
    assert.equal(st1.registry_number, '1001');

    // Create two students WITHOUT registry number (multiple NULLs allowed!)
    const st2 = createStudent(db, {
      full_name: 'زهراء عباس علي حسن',
      grade_id: g1.id,
      section_id: secA.id,
      registry_number: '',
    });
    const st3 = createStudent(db, {
      full_name: 'مصطفى كريم جاسم محمد',
      grade_id: g1.id,
      section_id: secA.id,
    });
    assert.equal(st2.registry_number, null);
    assert.equal(st3.registry_number, null);
    assert.notEqual(st2.student_uid, st3.student_uid);

    // Duplicate registry number must be rejected
    assert.throws(
      () =>
        createStudent(db, {
          full_name: 'طالب مكرر القيد',
          grade_id: g1.id,
          section_id: secA.id,
          registry_number: '1001',
        }),
      /مسجل مسبقاً/
    );

    // Section with active students cannot be deleted
    assert.throws(() => deleteSection(db, secA.id), /طالب مسجل حالياً/);

    // Update student without altering student_uid
    const updated = updateStudent(db, st2.id, {
      full_name: 'زهراء عباس علي الحسيني',
      registry_number: '1002',
    });
    assert.equal(updated.student_uid, st2.student_uid);
    assert.equal(updated.registry_number, '1002');
  });

  await test('4. Student transfer preserves historical enrollment & absences without duplicate profile', () => {
    const grades = listGradesWithSections(db);
    const g1 = grades[0];
    const g2 = grades[1];
    const secB = g1.sections[1];

    const students = listStudents(db, { search: 'علي حسين' });
    assert.equal(students.length, 1);
    const st1 = students[0];

    // Simulate an existing absence record tied to first enrollment
    db.prepare(
      `INSERT INTO absences (student_id, enrollment_id, academic_year_id, grade_id, section_id, absence_date, status)
       VALUES (?, ?, ?, ?, ?, '2026-11-10', 'full_day')`
    ).run(st1.id, st1.enrollment_id, st1.academic_year_id, st1.grade_id, st1.section_id);

    // Transfer student to section B
    const transferred = transferStudent(db, st1.id, {
      grade_id: g1.id,
      section_id: secB.id,
      transfer_reason: 'موازنة أعداد الطلبة',
    });
    assert.equal(transferred.section_id, secB.id);
    assert.equal(transferred.student_uid, st1.student_uid);

    // Verify enrollment history has 2 records (1 historical, 1 current)
    const history = getStudentEnrollmentHistory(db, st1.id);
    assert.equal(history.length, 2);
    assert.equal(history[0].is_current, 1);
    assert.equal(history[1].is_current, 0);

    // Verify absence record remained intact!
    const absCount = db
      .prepare('SELECT COUNT(*) as count FROM absences WHERE student_id = ?')
      .get(st1.id) as { count: number };
    assert.equal(absCount.count, 1);

    // Student with absence record cannot be deleted
    assert.throws(() => deleteStudent(db, st1.id), /سجل غياب/);

    // Separate academic year isolation check
    const nextYear = createAcademicYear(db, { name: '2027-2028', set_active: false });
    transferStudent(db, st1.id, {
      grade_id: g2.id,
      section_id: g2.sections[0].id,
      academic_year_id: nextYear.id,
      transfer_reason: 'ترفيع للعام الجديد',
    });
    const year1Students = listStudents(db, { academic_year_id: st1.academic_year_id! });
    const year2Students = listStudents(db, { academic_year_id: nextYear.id });
    assert.equal(year1Students.length, 3);
    assert.equal(year2Students.length, 1);
    assert.equal(year2Students[0].grade_id, g2.id);
  });

  await test('5. Unified Excel template generation & multi-row validation + transactional commit', async () => {
    const buffer = await generateUnifiedExcelTemplate(db);
    assert.ok(buffer.length > 1000);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    assert.equal(wb.worksheets.length, 3);
    assert.equal(wb.worksheets[0].name, 'بيانات الطلاب');
    assert.equal(wb.worksheets[1].name, 'الصفوف والشعب المعتمدة');
    assert.equal(wb.worksheets[2].name, 'تعليمات التعبئة');

    // Parse template directly -> sample rows detected cleanly
    const templateRows = await parseExcelBufferToRows(buffer);
    const templateValidation = validateExcelRows(db, templateRows);
    assert.equal(templateValidation.summary.sample_skipped_count, templateRows.length);
    assert.equal(templateValidation.summary.error_count, 0);

    // Build custom Excel workbook containing valid + invalid rows
    const testWb = new ExcelJS.Workbook();
    const sheet = testWb.addWorksheet('بيانات الطلاب');
    sheet.addRow(['اسم الطالب', 'الصف', 'الشعبة', 'رقم القيد']);
    sheet.addRow(['أحمد كريم جاسم', 'الأول المتوسط', 'أ', '2001']);
    sheet.addRow(['طالب وحيد', 'صف غير موجود', 'أ', '1001']); // bad name, bad grade, duplicate DB registry 1001
    sheet.addRow(['سارة علي محمود', 'الأول المتوسط', 'ب', '2002']);
    sheet.addRow(['مريم حسن علي', 'الأول المتوسط', 'ب', '2002']); // duplicate inside batch 2002

    const testBuf = Buffer.from(await testWb.xlsx.writeBuffer());
    const parsed = await parseExcelBufferToRows(testBuf);
    const val = validateExcelRows(db, parsed);

    assert.equal(val.summary.valid_count, 1);
    assert.equal(val.summary.error_count, 3);
    assert.ok(val.rows[1].errors.some((e) => e.includes('غير معرف')));
    assert.ok(val.rows[1].errors.some((e) => e.includes('مسجل مسبقاً')));
    assert.ok(val.rows[2].errors.some((e) => e.includes('مكرر داخل الملف')));

    // Commit with errors must fail and rollback without partial inserts
    const countBefore = listStudents(db).length;
    assert.throws(() => commitExcelStudents(db, parsed), /لا يمكن إتمام الاستيراد/);
    assert.equal(listStudents(db).length, countBefore);

    // Fix errors inline and revalidate + commit transactionally
    const fixedRows = parsed.map((r) => {
      if (r.rowNumber === 3) {
        return {
          ...r,
          full_name: 'حيدر طارق محسن',
          grade_name: 'الأول المتوسط',
          section_name: 'أ',
          registry_number: '2003',
        };
      }
      if (r.rowNumber === 5) {
        return { ...r, registry_number: '2004' };
      }
      return r;
    });

    const reval = validateExcelRows(db, fixedRows);
    assert.equal(reval.summary.error_count, 0);
    assert.equal(reval.summary.valid_count, 4);

    const commitRes = commitExcelStudents(db, fixedRows);
    assert.equal(commitRes.imported_count, 4);
    assert.equal(listStudents(db).length, countBefore + 4);
  });

  await test('6. Express REST API endpoints integration over HTTP', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(() => db));

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const baseUrl = `http://127.0.0.1:${addr.port}/api`;

    try {
      const dashRes = await fetch(`${baseUrl}/dashboard`);
      assert.equal(dashRes.status, 200);
      const dashJson = (await dashRes.json()) as {
        total_students: number;
        total_grades: number;
        total_sections: number;
        absence_days_count: number;
        last_absence_date: string | null;
        students_without_registry: number;
        sections_without_students: number;
      };
      assert.equal(dashJson.total_students, 7);
      assert.equal(dashJson.total_grades, 2);
      assert.equal(dashJson.total_sections, 4);
      assert.equal(dashJson.absence_days_count, 1);
      assert.equal(dashJson.last_absence_date, '2026-11-10');
      assert.equal(dashJson.students_without_registry, 1);
      assert.equal(dashJson.sections_without_students, 2);

      const tplRes = await fetch(`${baseUrl}/students/excel-template`);
      assert.equal(tplRes.status, 200);
      assert.match(
        tplRes.headers.get('content-type') ?? '',
        /spreadsheetml\.sheet/
      );

      const setRes = await fetch(`${baseUrl}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          school_name: 'ثانوية بغداد النموذجية',
          directorate_name: 'تربية الرصافة الأولى',
        }),
      });
      assert.equal(setRes.status, 200);
      const setJson = (await setRes.json()) as { school_name: string };
      assert.equal(setJson.school_name, 'ثانوية بغداد النموذجية');

      const yearsRes = await fetch(`${baseUrl}/academic-years`);
      const years = (await yearsRes.json()) as Array<{ id: number; name: string }>;
      assert.ok(years.length >= 2);
      const actRes = await fetch(`${baseUrl}/academic-years/${years[0].id}/activate`, {
        method: 'POST',
      });
      assert.equal(actRes.status, 200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // Also test settings update directly
  updateSchoolSettings(db, { school_name: 'متوسطة النجاح', directorate_name: 'تربية الكرخ' });
  setActiveAcademicYear(db, 1);

  db.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} tests passed.`);
  if (failed.length > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
