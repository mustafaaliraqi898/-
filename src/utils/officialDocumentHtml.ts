import type {
  DynamicStageReportResponse,
  IssuedOfficialLetter,
  NumberDisplayMode,
  SchoolSettings,
} from '../types/school';
import {
  formatAcademicYearDisplay,
  formatBidiHtmlText,
  formatDateDMY,
  formatIsolatedLtrHtml,
  formatPlainNumber,
} from './numberFormat';

export function escapeHtml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildSharedStyles(extraFontCss = ''): string {
  return `
    ${extraFontCss}
    @page {
      size: A4 portrait;
      margin: 13mm 14mm;
    }
    * {
      box-sizing: border-box;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #0f172a;
      direction: rtl;
      font-family: 'EmbeddedNotoArabic', 'Cairo', 'Almarai', 'Noto Sans Arabic', 'Noto Kufi Arabic', 'Segoe UI', Tahoma, sans-serif;
      font-size: 13px;
      line-height: 1.65;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .doc-wrap {
      width: 100%;
    }
    .official-header {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 14px;
      border-bottom: 1.5px solid #cbd5e1;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .header-right {
      text-align: right;
      font-size: 12px;
      font-weight: 700;
      color: #1e293b;
      line-height: 1.65;
    }
    .header-right .school-line {
      margin-top: 6px;
      font-weight: 800;
      color: #0f172a;
      font-size: 12.5px;
    }
    .header-center {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-width: 110px;
    }
    .school-logo {
      max-height: 62px;
      max-width: 115px;
      width: auto;
      height: auto;
      object-fit: contain;
      display: block;
      margin: 0 auto 6px;
    }
    .academic-year-label {
      font-size: 12px;
      font-weight: 800;
      color: #0f172a;
    }
    .header-left {
      text-align: left;
      font-size: 12px;
      font-weight: 700;
      color: #1e293b;
      line-height: 1.75;
      font-variant-numeric: tabular-nums;
    }
    .ltr-isolate {
      direction: ltr;
      unicode-bidi: isolate;
    }
    .subject-box {
      padding: 9px 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-weight: 800;
      font-size: 14px;
      color: #0f172a;
      margin-bottom: 14px;
    }
    .letter-body {
      padding: 6px 4px 12px;
      font-size: 13.5px;
      line-height: 1.85;
      color: #0f172a;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .meta-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 18px;
      padding: 8px 12px;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      font-size: 11.5px;
      color: #1e293b;
      margin-bottom: 14px;
      font-variant-numeric: tabular-nums;
    }
    .section-heading {
      font-size: 13.5px;
      font-weight: 800;
      color: #0f172a;
      border-right: 4px solid #0f766e;
      padding-right: 8px;
      margin: 8px 0 10px;
    }
    table.report-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }
    table.report-table thead {
      display: table-header-group;
    }
    table.report-table tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    table.report-table th,
    table.report-table td {
      border: 1px solid #cbd5e1;
      padding: 7px 8px;
      vertical-align: middle;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    table.report-table th {
      background: #f1f5f9;
      color: #0f172a;
      font-weight: 800;
      text-align: right;
    }
    table.report-table th.c-center,
    table.report-table td.c-center {
      text-align: center;
    }
    table.report-table td.c-bold {
      font-weight: 700;
    }
    table.report-table td.c-days {
      font-weight: 800;
      color: #b91c1c;
    }
    .sub-detail {
      font-size: 10.5px;
      color: #475569;
      font-weight: 400;
      margin-top: 2px;
    }
    .stage-pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      background: #fee2e2;
      color: #991b1b;
      font-weight: 700;
      font-size: 11px;
    }
    .principal-block-row {
      display: flex;
      justify-content: flex-end;
      padding-top: 30px;
      padding-bottom: 46px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .principal-box {
      text-align: center;
      min-width: 190px;
    }
    .principal-name {
      font-size: 15.5px;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.4;
    }
    .principal-title {
      font-size: 13px;
      font-weight: 700;
      color: #1e293b;
      margin-top: 3px;
    }
    .copy-to-block {
      border-top: 1px solid #cbd5e1;
      padding-top: 10px;
      font-size: 11.5px;
      font-weight: 700;
      color: #1e293b;
      line-height: 1.7;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .copy-to-indent {
      padding-right: 16px;
    }
  `;
}

function buildOfficialLetterStyles(extraFontCss = ''): string {
  return `
    ${extraFontCss}
    @page {
      size: A4 portrait;
      margin: 14mm 16mm;
    }
    * {
      box-sizing: border-box;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #0f172a;
      direction: rtl;
      font-family: 'EmbeddedOfficialNaskhArabic', 'Noto Naskh Arabic', 'Amiri', 'Traditional Arabic', serif;
      font-size: 15px;
      line-height: 1.85;
      font-feature-settings: "kern" 1, "liga" 1, "calt" 1;
      font-kerning: normal;
      font-variant-ligatures: normal;
      letter-spacing: 0;
      word-spacing: normal;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .letter-doc-wrap {
      width: 100%;
      display: flex;
      flex-direction: column;
      min-height: 263mm;
    }
    .official-header {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 14px;
      border-bottom: 1.5px solid #94a3b8;
      padding-bottom: 12px;
      margin-bottom: 14px;
    }
    .header-right {
      text-align: right;
      font-size: 13px;
      font-weight: 700;
      color: #1e293b;
      line-height: 1.7;
    }
    .header-right .school-line {
      margin-top: 4px;
      font-weight: 700;
      color: #0f172a;
      font-size: 13.5px;
    }
    .header-center {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-width: 110px;
    }
    .school-logo {
      max-height: 62px;
      max-width: 115px;
      width: auto;
      height: auto;
      object-fit: contain;
      display: block;
      margin: 0 auto 6px;
    }
    .academic-year-label {
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
    }
    .header-left {
      text-align: left;
      font-size: 13px;
      font-weight: 700;
      color: #1e293b;
      line-height: 1.75;
      font-variant-numeric: tabular-nums;
    }
    .ltr-isolate {
      direction: ltr;
      unicode-bidi: isolate;
    }
    .letter-subject-row {
      text-align: center;
      margin: 12px 0 14px;
      break-after: avoid;
      page-break-after: avoid;
    }
    .letter-subject-inner {
      display: inline-block;
      padding: 2px 20px 5px;
      border-bottom: 1.5px solid #475569;
      font-size: 17px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.75;
    }
    .letter-body {
      direction: rtl;
      unicode-bidi: isolate;
      text-align: right;
      padding: 2px 2px 12px;
      margin-bottom: 8px;
      font-size: 15.5px;
      line-height: 1.95;
      color: #0f172a;
      letter-spacing: 0;
      word-spacing: normal;
      word-break: normal;
      overflow-wrap: break-word;
    }
    .letter-para {
      margin: 0 0 8px 0;
      text-align: right;
    }
    .letter-para:last-child {
      margin-bottom: 0;
    }
    .letter-para-gap {
      height: 8px;
    }
    .letter-table-heading {
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
      margin: 6px 0 8px;
      break-after: avoid;
      page-break-after: avoid;
    }
    table.letter-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 13.5px;
      line-height: 1.65;
      font-variant-numeric: tabular-nums;
    }
    table.letter-table thead {
      display: table-header-group;
    }
    table.letter-table tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    table.letter-table th,
    table.letter-table td {
      border: 1px solid #64748b;
      padding: 6px 9px;
      vertical-align: middle;
      text-align: right;
      word-break: normal;
      overflow-wrap: break-word;
    }
    table.letter-table th {
      background: #f1f5f9;
      color: #0f172a;
      font-weight: 700;
    }
    table.letter-table th.c-center,
    table.letter-table td.c-center {
      text-align: center;
    }
    table.letter-table td.c-bold {
      font-weight: 700;
    }
    table.letter-table td.c-days {
      font-weight: 700;
      color: #0f172a;
    }
    .letter-footer {
      margin-top: auto;
      padding-top: 24px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .principal-block-row {
      display: flex;
      justify-content: flex-end;
      padding-bottom: 26px;
    }
    .principal-box {
      text-align: center;
      min-width: 190px;
    }
    .principal-name {
      font-size: 17px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.45;
    }
    .principal-title {
      font-size: 14.5px;
      font-weight: 700;
      color: #1e293b;
      margin-top: 2px;
    }
    .copy-to-block {
      text-align: right;
      border-top: 1px solid #94a3b8;
      padding-top: 8px;
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.75;
    }
    .copy-to-indent {
      padding-right: 18px;
      font-weight: 400;
      color: #1e293b;
    }
  `;
}

export interface OfficialLetterStudentItem {
  full_name: string;
  grade_name: string;
  section_name: string;
  counted_absence_days: number;
}

export const UNIFIED_OFFICIAL_LETTER_TEMPLATE =
  'اعــــــــــــــــلان\n\n' +
  'نظراً لتجاوز غيابات الطلبة المدرجة أسماؤهم في الجدول أدناه الحد المقرر للغيابات ({absence_days}) يوم، وحسب الصلاحيات المخولة لنا بموجب نظام المدارس الثانوية المعدل لسنة 1977، لذا تقرر توجيه ({stage_name}) لهم للعام الدراسي ({academic_year}).\n\n' +
  'آملين من طلبتنا الأعزاء الالتزام بالدوام والتعاون مع الإدارة.';

export function resolveOfficialLetterTemplate(
  template: string,
  vars: {
    absence_days: number | string;
    stage_name: string;
    academic_year: string;
    school_name?: string;
    date?: string;
    document_number?: string;
    student_count?: number | string;
  }
): string {
  const absenceDays = String(vars.absence_days ?? '');
  const stageName = String(vars.stage_name ?? '');
  const academicYear = String(vars.academic_year ?? '');

  let result = String(template ?? '');
  result = result
    .replace(/\{\{\s*absence_days\s*\}\}|\{\s*absence_days\s*\}/g, () => absenceDays)
    .replace(/\{\{\s*stage_name\s*\}\}|\{\s*stage_name\s*\}/g, () => stageName)
    .replace(/\{\{\s*academic_year\s*\}\}|\{\s*academic_year\s*\}/g, () => academicYear);

  if (vars.school_name !== undefined) {
    const val = String(vars.school_name);
    result = result.replace(/\{\{\s*school_name\s*\}\}|\{\s*school_name\s*\}/g, () => val);
  }
  if (vars.date !== undefined) {
    const val = String(vars.date);
    result = result.replace(/\{\{\s*date\s*\}\}|\{\s*date\s*\}/g, () => val);
  }
  if (vars.document_number !== undefined) {
    const val = String(vars.document_number);
    result = result.replace(/\{\{\s*document_number\s*\}\}|\{\s*document_number\s*\}/g, () => val);
  }
  if (vars.student_count !== undefined) {
    const val = String(vars.student_count);
    result = result.replace(/\{\{\s*student_count\s*\}\}|\{\s*student_count\s*\}/g, () => val);
  }

  return result;
}

export function splitLetterBodyParagraphs(content: string): string[] {
  return String(content ?? '').replace(/\r\n/g, '\n').split('\n');
}

export function buildOfficialLetterPdfHtml(params: {
  letter: IssuedOfficialLetter;
  schoolSettings: SchoolSettings;
  academicYearName: string;
  logoDataUri: string | null;
  extraFontCss?: string;
}): string {
  const { letter, schoolSettings, academicYearName, logoDataUri, extraFontCss = '' } = params;
  const mode: NumberDisplayMode = schoolSettings.number_display_mode ?? 'english';

  let students: OfficialLetterStudentItem[] = [];
  try {
    const parsed = JSON.parse(letter.students_json || '[]');
    if (Array.isArray(parsed)) students = parsed;
  } catch {
    students = [];
  }

  const principalName = (schoolSettings.principal_name ?? '').trim();
  const formattedYear = formatAcademicYearDisplay(academicYearName, mode);
  const formattedDate = formatDateDMY(letter.letter_date, mode);
  const resolvedBody = resolveOfficialLetterTemplate(letter.rendered_content, {
    absence_days: letter.days_threshold,
    stage_name: letter.stage_name,
    academic_year: academicYearName,
    school_name: schoolSettings.school_name,
    date: formattedDate,
    document_number: letter.document_number,
    student_count: students.length,
  });
  const bodyLines = splitLetterBodyParagraphs(resolvedBody);
  const bodyHtml = bodyLines
    .map((line) =>
      line.trim().length === 0
        ? `<div class="letter-para-gap"></div>`
        : `<p class="letter-para">${formatBidiHtmlText(line, mode)}</p>`
    )
    .join('');

  const rowsHtml =
    students.length === 0
      ? `<tr><td colspan="4" class="c-center" style="padding:18px;color:#475569;">لا توجد أسماء طلبة مدرجة في هذا الكتاب.</td></tr>`
      : students
          .map(
            (st, idx) => `
          <tr>
            <td class="c-center c-bold">${escapeHtml(formatPlainNumber(idx + 1, mode))}</td>
            <td class="c-bold">${escapeHtml(st.full_name)}</td>
            <td>${formatBidiHtmlText(st.grade_name, mode)} - ${formatBidiHtmlText(st.section_name, mode)}</td>
            <td class="c-center c-days">${escapeHtml(formatPlainNumber(st.counted_absence_days, mode))} يوم</td>
          </tr>`
          )
          .join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>كتاب رسمي رقم ${escapeHtml(letter.document_number)} — ${escapeHtml(schoolSettings.school_name)}</title>
  <style>${buildOfficialLetterStyles(extraFontCss)}</style>
</head>
<body>
  <div class="letter-doc-wrap">
    <header class="official-header">
      <div class="header-right">
        <div>جمهورية العراق</div>
        <div>وزارة التربية</div>
        <div>${formatBidiHtmlText(schoolSettings.directorate_name || 'المديرية العامة للتربية', mode)}</div>
        <div class="school-line">إدارة / ${formatBidiHtmlText(schoolSettings.school_name, mode)}</div>
      </div>
      <div class="header-center">
        ${logoDataUri ? `<img src="${escapeHtml(logoDataUri)}" alt="شعار المدرسة" class="school-logo" />` : ''}
        <div class="academic-year-label">${formatIsolatedLtrHtml(formattedYear)}</div>
      </div>
      <div class="header-left">
        <div>الرقم: ${formatBidiHtmlText(letter.document_number, mode)}</div>
        <div>التاريخ: ${formatIsolatedLtrHtml(formattedDate)}</div>
      </div>
    </header>

    <div class="letter-subject-row">
      <div class="letter-subject-inner">
        <span>م/ </span>
        <span>${formatBidiHtmlText(letter.subject, mode)}</span>
      </div>
    </div>

    <div class="letter-body">${bodyHtml}</div>

    <div class="letter-table-heading">أسماء الطلبة</div>
    <table class="letter-table">
      <thead>
        <tr>
          <th class="c-center" style="width:46px;">ت</th>
          <th style="width:44%;">اسم الطالب</th>
          <th style="width:30%;">الصف والشعبة</th>
          <th class="c-center" style="width:120px;">عدد أيام الغياب</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    <footer class="letter-footer">
      <div class="principal-block-row">
        <div class="principal-box">
          ${principalName ? `<div class="principal-name">${escapeHtml(principalName)}</div>` : ''}
          <div class="principal-title">مدير المدرسة</div>
        </div>
      </div>

      <div class="copy-to-block">
        <div>نسخة منه إلى /</div>
        <div class="copy-to-indent">معاون شؤون الطلبة</div>
      </div>
    </footer>
  </div>
</body>
</html>`;
}

export function buildStageReportPdfHtml(params: {
  report: DynamicStageReportResponse;
  logoDataUri: string | null;
  filterSummary?: string;
  extraFontCss?: string;
}): string {
  const { report, logoDataUri, filterSummary, extraFontCss = '' } = params;
  const school = report.school_settings;
  const mode: NumberDisplayMode = school.number_display_mode ?? 'english';
  const stageName = report.current_stage?.name || 'تقرير الغياب';
  const thresholdDays = report.current_stage?.days_threshold ?? 0;
  const todayIso = new Date().toISOString().slice(0, 10);
  const formattedToday = formatDateDMY(todayIso, mode);
  const formattedYear = formatAcademicYearDisplay(report.academic_year.name, mode);
  const principalName = (school.principal_name ?? '').trim();

  const rowsHtml =
    report.rows.length === 0
      ? `<tr><td colspan="5" class="c-center" style="padding:20px;color:#64748b;">لا يوجد طلاب في هذه المرحلة وفقاً لمعايير البحث والتصفية الحالية.</td></tr>`
      : report.rows
          .map(
            (row, idx) => `
          <tr>
            <td class="c-center">${escapeHtml(formatPlainNumber(idx + 1, mode))}</td>
            <td>
              <div class="c-bold">${escapeHtml(row.full_name)}</div>
              <div class="sub-detail">${row.registry_number ? `قيد: ${formatBidiHtmlText(row.registry_number, mode)}` : formatIsolatedLtrHtml(row.student_uid)}</div>
            </td>
            <td class="c-bold">${formatBidiHtmlText(row.grade_name, mode)} - ${formatBidiHtmlText(row.section_name, mode)}</td>
            <td class="c-center">
              <div class="c-days">${escapeHtml(formatPlainNumber(row.counted_absence_days, mode))} يوم</div>
              <div class="sub-detail">مباشر: ${escapeHtml(formatPlainNumber(row.direct_full_days, mode))} · دروس: ${escapeHtml(formatPlainNumber(row.converted_lesson_days, mode))}</div>
            </td>
            <td class="c-center">
              <span class="stage-pill">${formatBidiHtmlText(row.stage_name || stageName, mode)}</span>
            </td>
          </tr>`
          )
          .join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>تقرير الغياب — ${escapeHtml(stageName)} — ${escapeHtml(school.school_name)}</title>
  <style>${buildSharedStyles(extraFontCss)}</style>
</head>
<body>
  <div class="doc-wrap">
    <header class="official-header">
      <div class="header-right">
        <div>جمهورية العراق</div>
        <div>وزارة التربية</div>
        <div>${formatBidiHtmlText(school.directorate_name || 'المديرية العامة للتربية', mode)}</div>
        <div class="school-line">إدارة / ${formatBidiHtmlText(school.school_name, mode)}</div>
      </div>
      <div class="header-center">
        ${logoDataUri ? `<img src="${escapeHtml(logoDataUri)}" alt="شعار المدرسة" class="school-logo" />` : ''}
        <div class="academic-year-label">${formatIsolatedLtrHtml(formattedYear)}</div>
      </div>
      <div class="header-left">
        <div>التاريخ: ${formatIsolatedLtrHtml(formattedToday)}</div>
        <div>عدد الطلاب: ${escapeHtml(formatPlainNumber(report.rows.length, mode))}</div>
      </div>
    </header>

    <div class="subject-box">
      <span>تقرير مرحلة الغياب: </span>
      <span>${formatBidiHtmlText(stageName, mode)}</span>
    </div>

    <div class="meta-strip">
      <div><strong>عتبة الغياب:</strong> ${escapeHtml(formatPlainNumber(thresholdDays, mode))} يوم فأكثر</div>
      <div><strong>إجمالي الطلاب المعنيين:</strong> ${escapeHtml(formatPlainNumber(report.rows.length, mode))} طالب</div>
      <div><strong>السنة الدراسية:</strong> ${formatIsolatedLtrHtml(formattedYear)}</div>
      ${filterSummary ? `<div><strong>التصفية المطبقة:</strong> ${formatBidiHtmlText(filterSummary, mode)}</div>` : ''}
    </div>

    <table class="report-table">
      <thead>
        <tr>
          <th class="c-center" style="width:42px;">ت</th>
          <th style="width:34%;">اسم الطالب</th>
          <th style="width:24%;">الصف والشعبة</th>
          <th class="c-center" style="width:125px;">أيام الغياب المحتسبة</th>
          <th class="c-center" style="width:120px;">المرحلة الحالية</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    <div class="principal-block-row">
      <div class="principal-box">
        ${principalName ? `<div class="principal-name">${escapeHtml(principalName)}</div>` : ''}
        <div class="principal-title">مدير المدرسة</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
