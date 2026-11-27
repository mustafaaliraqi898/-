import crypto from 'crypto';
import ExcelJS from 'exceljs';
import type {
  ExcelCommitResult,
  ExcelImportRowInput,
  ExcelValidatedRow,
  ExcelValidationResult,
} from '../../src/types/school';
import type { SqliteDb } from '../db/connection';
import {
  ServiceError,
  isValidStudentFullName,
  normalizeArabicLookup,
  normalizeNullableString,
  normalizeWhitespace,
  validateBirthDate,
} from '../utils/validation';
import { recordAuditLog } from './auditLogService';
import { listGradesWithSections } from './gradeService';
import { getActiveAcademicYear } from './settingsService';

const SAMPLE_PREFIX = '(مثال توضيحي)';

function extractCellString(cellValue: ExcelJS.CellValue): string {
  if (cellValue === null || cellValue === undefined) return '';
  if (cellValue instanceof Date) {
    return cellValue.toISOString().slice(0, 10);
  }
  if (typeof cellValue === 'object') {
    if ('text' in cellValue && typeof cellValue.text === 'string') {
      return cellValue.text;
    }
    if ('result' in cellValue && cellValue.result !== undefined && cellValue.result !== null) {
      return String(cellValue.result);
    }
    if ('richText' in cellValue && Array.isArray(cellValue.richText)) {
      return cellValue.richText.map((part) => part.text ?? '').join('');
    }
  }
  return String(cellValue);
}

function isSampleRowName(name: string): boolean {
  const clean = normalizeWhitespace(name);
  return clean.startsWith(SAMPLE_PREFIX) || clean.includes('مثال توضيحي');
}

export async function generateUnifiedExcelTemplate(
  db: SqliteDb,
  academicYearId?: number
): Promise<Buffer> {
  const activeYear = academicYearId
    ? (db
        .prepare('SELECT id, name, is_active, created_at FROM academic_years WHERE id = ?')
        .get(academicYearId) as ReturnType<typeof getActiveAcademicYear> | undefined) ??
      getActiveAcademicYear(db)
    : getActiveAcademicYear(db);

  const grades = listGradesWithSections(db, activeYear.id);
  const gradesWithSections = grades.filter((g) => g.sections.length > 0);

  if (gradesWithSections.length === 0) {
    throw new ServiceError(
      'يجب تعريف صف دراسي واحد وشعبة واحدة على الأقل في قسم "إدارة الصفوف والشعب" قبل تنزيل قالب Excel الموحد.',
      400,
      'NO_GRADES_OR_SECTIONS'
    );
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'نظام إدارة الغيابات المدرسية الإلكتروني';
  workbook.created = new Date();

  // 1. Primary sheet: بيانات الطلاب
  const studentsSheet = workbook.addWorksheet('بيانات الطلاب', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });

  studentsSheet.columns = [
    { header: 'اسم الطالب', key: 'full_name', width: 34 },
    { header: 'الصف', key: 'grade_name', width: 22 },
    { header: 'الشعبة', key: 'section_name', width: 14 },
    { header: 'رقم القيد', key: 'registry_number', width: 18 },
    { header: 'تاريخ الميلاد', key: 'birth_date', width: 18 },
    { header: 'رقم الهاتف', key: 'phone', width: 18 },
  ];

  const headerRow = studentsSheet.getRow(1);
  headerRow.height = 30;
  headerRow.eachCell((cell, colNumber) => {
    cell.font = { name: 'Cairo', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: colNumber <= 3 ? 'FF0F766E' : 'FF334155' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
  });

  // Pre-populate illustrative sample rows using real dynamic grades & sections
  const sampleNames = [
    `${SAMPLE_PREFIX} محمد علي حسن كاظم`,
    `${SAMPLE_PREFIX} زينب حسين جاسم محمد`,
    `${SAMPLE_PREFIX} مصطفى كريم عبد الله`,
  ];

  const samplePairs: Array<{ gradeName: string; sectionName: string }> = [];
  for (const g of gradesWithSections) {
    for (const s of g.sections) {
      samplePairs.push({ gradeName: g.name, sectionName: s.name });
      if (samplePairs.length >= 3) break;
    }
    if (samplePairs.length >= 3) break;
  }

  samplePairs.forEach((pair, idx) => {
    const row = studentsSheet.addRow({
      full_name: sampleNames[idx] ?? `${SAMPLE_PREFIX} طالب افتراضي ${idx + 1}`,
      grade_name: pair.gradeName,
      section_name: pair.sectionName,
      registry_number: '',
      birth_date: '',
      phone: '',
    });
    row.height = 24;
    row.eachCell((cell) => {
      cell.font = { name: 'Almarai', size: 11, italic: true, color: { argb: 'FF92400E' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFEF3C7' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
    });
  });

  // 2. Reference sheet: الصفوف والشعب المعتمدة
  const refSheet = workbook.addWorksheet('الصفوف والشعب المعتمدة', {
    views: [{ rightToLeft: true }],
  });
  refSheet.columns = [
    { header: 'الصف الدراسي', key: 'grade_name', width: 28 },
    { header: 'الشعبة', key: 'section_name', width: 18 },
    { header: 'عدد الطلاب الحالي', key: 'student_count', width: 20 },
  ];
  const refHeader = refSheet.getRow(1);
  refHeader.height = 28;
  refHeader.eachCell((cell) => {
    cell.font = { name: 'Cairo', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  const uniqueSectionNames = Array.from(
    new Set(gradesWithSections.flatMap((g) => g.sections.map((s) => s.name)))
  );

  for (const grade of gradesWithSections) {
    for (const sec of grade.sections) {
      const r = refSheet.addRow({
        grade_name: grade.name,
        section_name: sec.name,
        student_count: sec.student_count,
      });
      r.alignment = { vertical: 'middle', horizontal: 'center' };
    }
  }

  // Add Excel dropdown data validations for Grade (B) and Section (C) on rows 2..500
  const gradeFormulaList = `"${gradesWithSections.map((g) => g.name.replace(/"/g, '')).join(',')}"`;
  const sectionFormulaList = `"${uniqueSectionNames.map((s) => s.replace(/"/g, '')).join(',')}"`;

  for (let rowNum = 2; rowNum <= 500; rowNum++) {
    if (gradeFormulaList.length <= 255) {
      studentsSheet.getCell(`B${rowNum}`).dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: [gradeFormulaList],
        showErrorMessage: true,
        errorTitle: 'صف غير معتمد',
        error: 'يرجى اختيار اسم الصف من القائمة المعتمدة في النظام.',
      };
    }
    if (sectionFormulaList.length <= 255) {
      studentsSheet.getCell(`C${rowNum}`).dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: [sectionFormulaList],
        showErrorMessage: true,
        errorTitle: 'شعبة غير معتمدة',
        error: 'يرجى اختيار اسم الشعبة من الشعب المعتمدة.',
      };
    }
  }

  // 3. Instructions sheet: تعليمات التعبئة
  const guideSheet = workbook.addWorksheet('تعليمات التعبئة', {
    views: [{ rightToLeft: true }],
  });
  guideSheet.columns = [
    { header: 'البند / العمود', key: 'item', width: 28 },
    { header: 'التعليمات والضوابط', key: 'details', width: 78 },
  ];
  const guideHeader = guideSheet.getRow(1);
  guideHeader.height = 28;
  guideHeader.eachCell((cell) => {
    cell.font = { name: 'Cairo', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    cell.alignment = { vertical: 'middle', horizontal: 'right' };
  });

  const instructions: Array<[string, string]> = [
    [
      'السنة الدراسية المستهدفة',
      `سيتم تسجيل الطلاب المستوردين ضمن السنة الدراسية الفعالة: ${activeYear.name}`,
    ],
    [
      'قالب موحد لجميع الصفوف',
      'يمكن كتابة جميع طلاب المدرسة بمختلف الصفوف والشعب في ورقة "بيانات الطلاب" نفسها، وسيقوم النظام بتوزيعهم تلقائياً.',
    ],
    [
      'الصفوف الإرشادية (الصفراء)',
      `الصفوف المظللة باللون الأصفر والتي تبدأ بعبارة "${SAMPLE_PREFIX}" هي أمثلة توضيحية فقط وليست بيانات حقيقية. يرجى استبدالها أو حذفها قبل الحفظ.`,
    ],
    [
      'اسم الطالب (إجباري)',
      'يرجى إدخال اسم الطالب الثلاثي أو الرباعي كاملاً (كلمتان على الأقل).',
    ],
    [
      'الصف والشعبة (إجباري)',
      'يجب أن يطابق اسم الصف والشعبة الأسماء المعرفة في ورقة "الصفوف والشعب المعتمدة" الموجودة في هذا الملف.',
    ],
    [
      'رقم القيد (اختياري)',
      'رقم القيد المدرسي اختياري ويمكن تركه فارغاً، لكن في حال إدخاله يمنع تكراره داخل الملف أو مع طالب مسجل مسبقاً.',
    ],
    [
      'تاريخ الميلاد (اختياري)',
      'يفضل كتابته بصيغة YYYY-MM-DD (مثال: 2012-05-14).',
    ],
    [
      'رقم الهاتف (اختياري)',
      'رقم هاتف الطالب إن وجد (اختياري).',
    ],
  ];

  for (const [item, details] of instructions) {
    const r = guideSheet.addRow({ item, details });
    r.height = 26;
    r.getCell(1).font = { name: 'Cairo', size: 11, bold: true };
    r.getCell(2).font = { name: 'Almarai', size: 11 };
    r.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true };
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export async function parseExcelBufferToRows(buffer: Buffer): Promise<ExcelImportRowInput[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ServiceError(
      'تعذر قراءة ملف Excel. يرجى التأكد من أن الملف بصيغة .xlsx صالحة وغير تالف.',
      400,
      'INVALID_EXCEL_FILE'
    );
  }

  const sheet = workbook.getWorksheet('بيانات الطلاب') ?? workbook.worksheets[0];
  if (!sheet) {
    throw new ServiceError('ملف Excel لا يحتوي على أي ورقة عمل صالحة.', 400);
  }

  // Map column indexes from row 1 headers
  const headerRow = sheet.getRow(1);
  let colName = 1;
  let colGrade = 2;
  let colSection = 3;
  let colRegistry = 4;
  let colBirth = 5;
  let colPhone = 6;

  headerRow.eachCell((cell, colNumber) => {
    const text = normalizeArabicLookup(extractCellString(cell.value));
    if (text.includes('اسم الطالب') || text === 'الاسم') colName = colNumber;
    else if (text === 'الصف' || text.includes('الصف الدراسي')) colGrade = colNumber;
    else if (text === 'الشعبه' || text.includes('الشعبه')) colSection = colNumber;
    else if (text.includes('رقم القيد') || text === 'القيد') colRegistry = colNumber;
    else if (text.includes('الميلاد')) colBirth = colNumber;
    else if (text.includes('الهاتف') || text.includes('الموبايل')) colPhone = colNumber;
  });

  const rows: ExcelImportRowInput[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const fullName = normalizeWhitespace(extractCellString(row.getCell(colName).value));
    const gradeName = normalizeWhitespace(extractCellString(row.getCell(colGrade).value));
    const sectionName = normalizeWhitespace(extractCellString(row.getCell(colSection).value));
    const registryNumber = normalizeWhitespace(extractCellString(row.getCell(colRegistry).value));
    const birthDate = normalizeWhitespace(extractCellString(row.getCell(colBirth).value));
    const phone = normalizeWhitespace(extractCellString(row.getCell(colPhone).value));

    if (!fullName && !gradeName && !sectionName && !registryNumber && !birthDate && !phone) {
      return;
    }

    rows.push({
      rowNumber,
      full_name: fullName,
      grade_name: gradeName,
      section_name: sectionName,
      registry_number: registryNumber,
      birth_date: birthDate,
      phone,
    });
  });

  if (rows.length === 0) {
    throw new ServiceError('لم يتم العثور على أي صفوف بيانات داخل ملف Excel.', 400, 'EMPTY_EXCEL');
  }

  return rows;
}

export function validateExcelRows(
  db: SqliteDb,
  inputRows: ExcelImportRowInput[],
  academicYearId?: number
): ExcelValidationResult {
  const activeYear = academicYearId
    ? (db
        .prepare('SELECT id, name, is_active, created_at FROM academic_years WHERE id = ?')
        .get(academicYearId) as ReturnType<typeof getActiveAcademicYear> | undefined) ??
      getActiveAcademicYear(db)
    : getActiveAcademicYear(db);

  const grades = listGradesWithSections(db, activeYear.id);

  // Build normalized lookup maps
  const gradeMap = new Map<
    string,
    {
      id: number;
      name: string;
      sections: Map<string, { id: number; name: string }>;
    }
  >();

  for (const g of grades) {
    const secMap = new Map<string, { id: number; name: string }>();
    for (const s of g.sections) {
      secMap.set(normalizeArabicLookup(s.name), { id: s.id, name: s.name });
    }
    gradeMap.set(normalizeArabicLookup(g.name), {
      id: g.id,
      name: g.name,
      sections: secMap,
    });
  }

  // Existing registry numbers in DB
  const existingRegistries = new Map<string, string>();
  const dbRegs = db
    .prepare('SELECT registry_number, full_name FROM students WHERE registry_number IS NOT NULL')
    .all() as Array<{ registry_number: string; full_name: string }>;
  for (const item of dbRegs) {
    existingRegistries.set(normalizeWhitespace(item.registry_number), item.full_name);
  }

  // Track duplicates inside the Excel batch itself
  const batchRegistryOccurrences = new Map<string, number[]>();
  for (const row of inputRows) {
    if (isSampleRowName(row.full_name)) continue;
    const reg = normalizeWhitespace(row.registry_number);
    if (reg) {
      const list = batchRegistryOccurrences.get(reg) ?? [];
      list.push(row.rowNumber);
      batchRegistryOccurrences.set(reg, list);
    }
  }

  let validCount = 0;
  let errorCount = 0;
  let sampleSkippedCount = 0;

  const validatedRows: ExcelValidatedRow[] = inputRows.map((row) => {
    const fullName = normalizeWhitespace(row.full_name);
    const gradeName = normalizeWhitespace(row.grade_name);
    const sectionName = normalizeWhitespace(row.section_name);
    const registryNumber = normalizeWhitespace(row.registry_number);
    const birthDate = normalizeWhitespace(row.birth_date);
    const phone = normalizeWhitespace(row.phone);

    const isSample = isSampleRowName(fullName);
    if (isSample) {
      sampleSkippedCount += 1;
      return {
        rowNumber: row.rowNumber,
        full_name: fullName,
        grade_name: gradeName,
        section_name: sectionName,
        registry_number: registryNumber,
        birth_date: birthDate,
        phone,
        grade_id: null,
        section_id: null,
        errors: [],
        is_valid: true,
        is_sample: true,
      };
    }

    const errors: string[] = [];

    if (!fullName) {
      errors.push('اسم الطالب مفقود.');
    } else if (!isValidStudentFullName(fullName)) {
      errors.push('يجب كتابة اسم الطالب ثلاثياً أو رباعياً (كلمتين على الأقل).');
    }

    let resolvedGradeId: number | null = null;
    let resolvedSectionId: number | null = null;
    let canonicalGradeName = gradeName;
    let canonicalSectionName = sectionName;

    if (!gradeName) {
      errors.push('اسم الصف مفقود.');
    } else {
      const matchedGrade = gradeMap.get(normalizeArabicLookup(gradeName));
      if (!matchedGrade) {
        errors.push(`الصف "${gradeName}" غير معرف في النظام.`);
      } else {
        resolvedGradeId = matchedGrade.id;
        canonicalGradeName = matchedGrade.name;

        if (!sectionName) {
          errors.push('اسم الشعبة مفقود.');
        } else {
          const matchedSection = matchedGrade.sections.get(normalizeArabicLookup(sectionName));
          if (!matchedSection) {
            errors.push(`الشعبة "${sectionName}" غير معرفة ضمن صف "${matchedGrade.name}".`);
          } else {
            resolvedSectionId = matchedSection.id;
            canonicalSectionName = matchedSection.name;
          }
        }
      }
    }

    if (!gradeName && !sectionName) {
      // already pushed grade missing; ensure section missing is clear too
      if (!errors.includes('اسم الشعبة مفقود.')) {
        errors.push('اسم الشعبة مفقود.');
      }
    } else if (!gradeName && sectionName) {
      errors.push('تعذر التحقق من الشعبة لعدم تحديد الصف.');
    }

    if (registryNumber) {
      const dbOwner = existingRegistries.get(registryNumber);
      if (dbOwner) {
        errors.push(`رقم القيد "${registryNumber}" مسجل مسبقاً للطالب (${dbOwner}).`);
      }
      const dupRows = batchRegistryOccurrences.get(registryNumber) ?? [];
      if (dupRows.length > 1) {
        const otherRows = dupRows.filter((n) => n !== row.rowNumber);
        errors.push(
          `رقم القيد "${registryNumber}" مكرر داخل الملف في الصفوف: ${otherRows.join('، ')}.`
        );
      }
    }

    if (birthDate) {
      try {
        validateBirthDate(birthDate);
      } catch {
        errors.push('صيغة تاريخ الميلاد غير صالحة (المطلوب YYYY-MM-DD).');
      }
    }

    const isValid = errors.length === 0;
    if (isValid) validCount += 1;
    else errorCount += 1;

    return {
      rowNumber: row.rowNumber,
      full_name: fullName,
      grade_name: canonicalGradeName,
      section_name: canonicalSectionName,
      registry_number: registryNumber,
      birth_date: birthDate,
      phone,
      grade_id: resolvedGradeId,
      section_id: resolvedSectionId,
      errors,
      is_valid: isValid,
      is_sample: false,
    };
  });

  return {
    rows: validatedRows,
    summary: {
      total_rows: inputRows.length,
      valid_count: validCount,
      error_count: errorCount,
      sample_skipped_count: sampleSkippedCount,
    },
    academic_year: activeYear,
  };
}

export function commitExcelStudents(
  db: SqliteDb,
  inputRows: ExcelImportRowInput[],
  academicYearId?: number
): ExcelCommitResult {
  const nonSampleInput = inputRows.filter((r) => !isSampleRowName(r.full_name));
  if (nonSampleInput.length === 0) {
    throw new ServiceError(
      'لا توجد صفوف طلاب فعلية للاستيراد. يرجى استبدال الصفوف الإرشادية أو إضافة بيانات الطلاب.',
      400,
      'NO_ACTUAL_ROWS'
    );
  }

  const validation = validateExcelRows(db, nonSampleInput, academicYearId);
  if (validation.summary.error_count > 0) {
    throw new ServiceError(
      `لا يمكن إتمام الاستيراد لوجود أخطاء في ${validation.summary.error_count} صف. يرجى تصحيح الأخطاء أو إزالة الصفوف غير الصالحة ثم إعادة الفحص.`,
      400,
      'EXCEL_VALIDATION_FAILED'
    );
  }

  const yearId = validation.academic_year.id;
  const today = new Date().toISOString().slice(0, 10);

  const distributionMap = new Map<
    string,
    { grade_name: string; section_name: string; count: number }
  >();

  db.transaction(() => {
    const insertStudent = db.prepare(
      `INSERT INTO students (student_uid, registry_number, full_name, birth_date, phone, status)
       VALUES (?, ?, ?, ?, ?, 'active')`
    );
    const updateUid = db.prepare('UPDATE students SET student_uid = ? WHERE id = ?');
    const insertEnrollment = db.prepare(
      `INSERT INTO student_enrollments
         (student_id, academic_year_id, grade_id, section_id, enrollment_date, is_current)
       VALUES (?, ?, ?, ?, ?, 1)`
    );

    for (const row of validation.rows) {
      if (!row.is_valid || !row.grade_id || !row.section_id) {
        throw new ServiceError(`خطأ غير متوقع في الصف رقم ${row.rowNumber}.`, 400);
      }

      const tempUid = `TMP-${crypto.randomUUID()}`;
      const registry = normalizeNullableString(row.registry_number);
      const birthDate = row.birth_date ? validateBirthDate(row.birth_date) : null;
      const phone = normalizeNullableString(row.phone);

      const info = insertStudent.run(tempUid, registry, row.full_name, birthDate, phone);
      const studentId = Number(info.lastInsertRowid);
      const permanentUid = `STD-${String(studentId).padStart(5, '0')}`;
      updateUid.run(permanentUid, studentId);

      insertEnrollment.run(studentId, yearId, row.grade_id, row.section_id, today);

      const key = `${row.grade_id}:${row.section_id}`;
      const bucket = distributionMap.get(key) ?? {
        grade_name: row.grade_name,
        section_name: row.section_name,
        count: 0,
      };
      bucket.count += 1;
      distributionMap.set(key, bucket);
    }

    recordAuditLog(db, {
      operation_type: 'import',
      section: 'students',
      description: `استيراد ${validation.rows.length} طالب عبر ملف Excel للسنة الدراسية ${validation.academic_year.name}`,
      target_id: yearId,
      target_label: validation.academic_year.name,
      new_value: {
        imported_count: validation.rows.length,
        academic_year_name: validation.academic_year.name,
        distribution: Array.from(distributionMap.values()),
      },
    });
  })();

  return {
    imported_count: validation.rows.length,
    academic_year_name: validation.academic_year.name,
    distribution: Array.from(distributionMap.values()),
  };
}
