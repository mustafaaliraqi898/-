import { useEffect } from 'react';
import { useNumberDisplay } from '../../contexts/NumberDisplayContext';
import type {
  AbsenceReportsResponse,
  AbsenceReportTypeId,
  AbsenceThresholdsSettings,
  NumberDisplayMode,
} from '../../types/school';
import {
  formatAcademicYearDisplay,
  formatBidiHtmlText,
  formatDateDMY,
  formatIsolatedLtrHtml,
  formatPlainNumber,
} from '../../utils/numberFormat';
import { BidiText, LtrSpan } from '../common/BidirectionalText';

export const ABSENCE_REPORT_TITLES: Record<AbsenceReportTypeId, string> = {
  warning: 'تقرير الطلاب الذين بلغوا عتبة التحذير',
  preliminary_warning: 'تقرير الطلاب الذين بلغوا عتبة الإنذار الأولي',
  final_warning: 'تقرير الطلاب الذين بلغوا عتبة الإنذار النهائي',
  exceeded_limit: 'تقرير الطلاب المتجاوزين لحد الغياب المؤثر',
};

function formatThresholdRangeLabel(
  reportType: AbsenceReportTypeId,
  thresholds: AbsenceThresholdsSettings
): string {
  switch (reportType) {
    case 'warning': {
      const upper = thresholds.preliminary_warning_days - 1;
      return upper > thresholds.warning_days
        ? `من ${thresholds.warning_days} إلى ${upper} يوم`
        : `${thresholds.warning_days} يوم`;
    }
    case 'preliminary_warning': {
      const upper = thresholds.final_warning_days - 1;
      return upper > thresholds.preliminary_warning_days
        ? `من ${thresholds.preliminary_warning_days} إلى ${upper} يوم`
        : `${thresholds.preliminary_warning_days} يوم`;
    }
    case 'final_warning':
      return `${thresholds.final_warning_days} يوم فأكثر`;
    case 'exceeded_limit':
      return `${thresholds.effective_absence_limit} يوم فأكثر`;
  }
}

function escapeHtml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const DEFAULT_CREST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="54" height="54" fill="none">
  <circle cx="32" cy="32" r="29" stroke="#0f766e" stroke-width="2.5" fill="#f0fdfa"/>
  <path d="M18 22h11c2 0 3 1.2 3 3v19c0-1.5-1.5-2.5-3.5-2.5H18V22zm28 0H35c-2 0-3 1.2-3 3v19c0-1.5 1.5-2.5 3.5-2.5H46V22z" stroke="#0f766e" stroke-width="2.2" stroke-linejoin="round" fill="#ffffff"/>
  <path d="M32 14l2.2 4.4 4.8.7-3.5 3.4.8 4.8-4.3-2.3-4.3 2.3.8-4.8-3.5-3.4 4.8-.7L32 14z" fill="#b45309"/>
</svg>`;

export function buildSimplifiedReportStandaloneHtml(
  data: AbsenceReportsResponse,
  filterSummary?: string,
  resolvedLogoSrc?: string | null,
  modeOverride?: NumberDisplayMode
): string {
  const school = data.school_settings;
  const mode: NumberDisplayMode = modeOverride ?? school.number_display_mode ?? 'english';
  const documentTitle = ABSENCE_REPORT_TITLES[data.report_type];
  const thresholdRangeLabel = formatThresholdRangeLabel(data.report_type, data.thresholds);
  const todayIso = new Date().toISOString().slice(0, 10);
  const formattedToday = formatDateDMY(todayIso, mode);
  const formattedYear = formatAcademicYearDisplay(data.academic_year.name, mode);
  const effectiveLogo = resolvedLogoSrc !== undefined ? resolvedLogoSrc : school.school_logo_data;

  const logoHtml = effectiveLogo
    ? `<img src="${escapeHtml(effectiveLogo)}" alt="شعار المدرسة" class="school-logo" />`
    : DEFAULT_CREST_SVG;

  const rowsHtml =
    data.rows.length === 0
      ? `<tr><td colspan="6" class="empty-cell">لا توجد حالات مسجلة مطابقة لهذا التقرير حالياً.</td></tr>`
      : data.rows
          .map(
            (r, idx) => `<tr>
              <td class="c-center">${escapeHtml(formatPlainNumber(idx + 1, mode))}</td>
              <td class="c-bold">${escapeHtml(r.full_name)}</td>
              <td class="c-center">${formatBidiHtmlText(r.grade_name, mode)}</td>
              <td class="c-center">${formatBidiHtmlText(r.section_name, mode)}</td>
              <td class="c-center c-days">${escapeHtml(formatPlainNumber(r.counted_absence_days, mode))} يوم</td>
              <td class="c-center c-alert">${formatBidiHtmlText(r.alert_label, mode)}</td>
            </tr>`
          )
          .join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(documentTitle)} — ${escapeHtml(school.school_name)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Cairo', 'Almarai', 'Segoe UI', Tahoma, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 14px;
      direction: rtl;
      font-size: 13px;
      line-height: 1.6;
    }
    .doc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 2.5px solid #0f766e;
      padding-bottom: 10px;
      margin-bottom: 14px;
    }
    .header-col {
      font-size: 12px;
      font-weight: 700;
      color: #1e293b;
      line-height: 1.7;
    }
    .header-center {
      text-align: center;
      padding: 0 12px;
    }
    .header-center h1 {
      margin: 0;
      font-size: 17px;
      font-weight: 800;
      color: #0f172a;
    }
    .header-center .subtitle {
      margin: 4px 0 0;
      font-size: 12.5px;
      font-weight: 700;
      color: #0f766e;
    }
    .school-logo {
      width: 58px;
      height: 58px;
      object-fit: contain;
    }
    .meta-bar {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 8px 18px;
      padding: 8px 12px;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      margin-bottom: 14px;
      font-size: 12px;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5px;
    }
    .data-table th, .data-table td {
      border: 1.5px solid #334155;
      padding: 7px 10px;
      vertical-align: middle;
    }
    .data-table th {
      background: #e2e8f0;
      font-weight: 800;
      color: #0f172a;
      text-align: center;
      font-size: 13px;
    }
    .data-table th.t-right, .data-table td {
      text-align: right;
    }
    .c-center { text-align: center !important; }
    .c-bold { font-weight: 700; }
    .c-days { font-weight: 800; font-size: 13.5px; }
    .c-alert { font-weight: 700; color: #991b1b; }
    .empty-cell { text-align: center !important; padding: 24px !important; color: #64748b; }
    .signatures-row {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
      margin-top: 32px;
      padding-top: 12px;
      border-top: 1px solid #cbd5e1;
      text-align: center;
      font-size: 12px;
    }
    .sig-title { font-weight: 800; color: #0f172a; margin-bottom: 26px; }
    .sig-line { color: #475569; font-size: 11px; }
    .doc-footer {
      margin-top: 18px;
      font-size: 10.5px;
      color: #64748b;
      display: flex;
      justify-content: space-between;
      border-top: 1px solid #e2e8f0;
      padding-top: 6px;
    }
    .ltr-isolate {
      direction: ltr;
      unicode-bidi: isolate;
    }
  </style>
</head>
<body>
  <header class="doc-header">
    <div class="header-col">
      <div>جمهورية العراق — وزارة التربية</div>
      <div>${formatBidiHtmlText(school.directorate_name, mode)}</div>
      <div>${formatBidiHtmlText(school.school_name, mode)}</div>
    </div>
    <div class="header-center">
      <h1>${escapeHtml(documentTitle)}</h1>
      <div class="subtitle">إعلان رسمي للوحة إعلانات المدرسة — العام الدراسي ${formatIsolatedLtrHtml(formattedYear)}</div>
    </div>
    <div>${logoHtml}</div>
  </header>

  <div class="meta-bar">
    <div><strong>النطاق المعتمد:</strong> ${formatBidiHtmlText(thresholdRangeLabel, mode)}</div>
    <div><strong>حد الغياب المؤثر:</strong> ${escapeHtml(formatPlainNumber(data.thresholds.effective_absence_limit, mode))} يوم</div>
    <div><strong>عدد الطلاب المشمولين:</strong> ${escapeHtml(formatPlainNumber(data.rows.length, mode))} طالب</div>
    <div><strong>تاريخ الإصدار:</strong> ${formatIsolatedLtrHtml(formattedToday)}</div>
    ${filterSummary ? `<div><strong>النطاق:</strong> ${formatBidiHtmlText(filterSummary, mode)}</div>` : ''}
  </div>

  <table class="data-table">
    <thead>
      <tr>
        <th style="width: 44px;">ت</th>
        <th class="t-right">اسم الطالب</th>
        <th style="width: 110px;">الصف</th>
        <th style="width: 90px;">الشعبة</th>
        <th style="width: 135px;">عدد أيام الغياب المحتسبة</th>
        <th style="width: 165px;">نوع التحذير أو الإنذار</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>

  <div class="signatures-row">
    <div>
      <div class="sig-title">مسؤول الغيابات</div>
      <div class="sig-line">الاسم والتوقيع: ............................</div>
    </div>
    <div>
      <div class="sig-title">معاون المدير</div>
      <div class="sig-line">الاسم والتوقيع: ............................</div>
    </div>
    <div>
      <div class="sig-title">مدير المدرسة (الختم الرسمي)</div>
      <div class="sig-line">التوقيع والختم: ............................</div>
    </div>
  </div>

  <footer class="doc-footer">
    <span>تاريخ الطباعة: ${formatIsolatedLtrHtml(formattedToday)}</span>
    <span>${formatBidiHtmlText(school.school_name, mode)} — تقارير الغياب والإنذارات</span>
  </footer>
</body>
</html>`;
}

interface LegalPrintSheetProps {
  data: AbsenceReportsResponse;
  filterSummary?: string;
  mode: 'preview' | 'print';
}

export function LegalPrintSheet({ data, filterSummary, mode }: LegalPrintSheetProps) {
  const { plain, dateDMY, academicYear } = useNumberDisplay();

  useEffect(() => {
    if (mode !== 'print') return;
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-legal-print-page', 'true');
    styleEl.textContent = `@page { size: A4 portrait; margin: 12mm; }`;
    document.head.appendChild(styleEl);
    return () => {
      document.head.removeChild(styleEl);
    };
  }, [mode]);

  const school = data.school_settings;
  const documentTitle = ABSENCE_REPORT_TITLES[data.report_type];
  const thresholdRangeLabel = formatThresholdRangeLabel(data.report_type, data.thresholds);
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div
      id={mode === 'print' ? 'legal-print-sheet' : undefined}
      dir="rtl"
      className={
        mode === 'print'
          ? 'print-only bg-white text-slate-900 text-xs'
          : 'bg-white text-slate-900 rounded-xl border border-slate-200 p-5 sm:p-7 shadow-sm text-xs max-w-4xl mx-auto'
      }
    >
      {/* Official Header */}
      <header className="flex items-center justify-between border-b-2 border-teal-700 pb-3 mb-4">
        <div className="space-y-0.5 font-bold text-slate-800 text-[11px]">
          <p>جمهورية العراق — وزارة التربية</p>
          <p><BidiText text={school.directorate_name} /></p>
          <p><BidiText text={school.school_name} /></p>
        </div>

        <div className="text-center px-3">
          <h2 className="text-base font-extrabold text-slate-900 font-display">
            {documentTitle}
          </h2>
          <p className="text-xs font-bold text-teal-800 mt-0.5 tabular-nums">
            إعلان رسمي للوحة إعلانات المدرسة — العام الدراسي{' '}
            <LtrSpan>{academicYear(data.academic_year.name)}</LtrSpan>
          </p>
        </div>

        <div className="shrink-0">
          {school.school_logo_data ? (
            <img
              src={school.school_logo_data}
              alt="شعار المدرسة"
              className="w-14 h-14 object-contain"
            />
          ) : (
            <div
              className="w-14 h-14 flex items-center justify-center"
              dangerouslySetInnerHTML={{ __html: DEFAULT_CREST_SVG }}
            />
          )}
        </div>
      </header>

      {/* Report Metadata Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-50 border border-slate-300 rounded mb-4 text-[11.5px] tabular-nums">
        <span>
          <strong>النطاق المعتمد:</strong> <BidiText text={thresholdRangeLabel} />
        </span>
        <span>
          <strong>حد الغياب المؤثر:</strong> {plain(data.thresholds.effective_absence_limit)} يوم
        </span>
        <span>
          <strong>عدد الطلاب:</strong> {plain(data.rows.length)} طالب
        </span>
        <span>
          <strong>تاريخ الإصدار:</strong> <LtrSpan>{dateDMY(todayIso)}</LtrSpan>
        </span>
        {filterSummary && (
          <span>
            <strong>النطاق:</strong> <BidiText text={filterSummary} />
          </span>
        )}
      </div>

      {/* Bulletin-Board Formal Table */}
      <table className="w-full border-collapse text-xs tabular-nums print-table">
        <thead>
          <tr className="bg-slate-200 text-slate-900">
            <th className="border border-slate-700 px-2 py-2 text-center w-10">ت</th>
            <th className="border border-slate-700 px-3 py-2 text-right">اسم الطالب</th>
            <th className="border border-slate-700 px-2.5 py-2 text-center w-28">الصف</th>
            <th className="border border-slate-700 px-2.5 py-2 text-center w-24">الشعبة</th>
            <th className="border border-slate-700 px-2.5 py-2 text-center w-36">
              عدد أيام الغياب المحتسبة
            </th>
            <th className="border border-slate-700 px-3 py-2 text-center w-40">
              نوع التحذير أو الإنذار
            </th>
          </tr>
        </thead>
        <tbody>
          {data.rows.length === 0 ? (
            <tr>
              <td
                colSpan={6}
                className="border border-slate-700 px-4 py-6 text-center text-slate-500"
              >
                لا توجد حالات مسجلة مطابقة لهذا التقرير حالياً.
              </td>
            </tr>
          ) : (
            data.rows.map((r, idx) => (
              <tr key={r.student_id}>
                <td className="border border-slate-700 px-2 py-2 text-center">{plain(idx + 1)}</td>
                <td className="border border-slate-700 px-3 py-2 font-bold text-slate-900">
                  {r.full_name}
                </td>
                <td className="border border-slate-700 px-2.5 py-2 text-center">
                  <BidiText text={r.grade_name} />
                </td>
                <td className="border border-slate-700 px-2.5 py-2 text-center">
                  <BidiText text={r.section_name} />
                </td>
                <td className="border border-slate-700 px-2.5 py-2 text-center font-extrabold text-slate-900">
                  {plain(r.counted_absence_days)} يوم
                </td>
                <td className="border border-slate-700 px-3 py-2 text-center font-bold text-red-900">
                  <BidiText text={r.alert_label} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Formal Signatures Block */}
      <div className="grid grid-cols-3 gap-4 pt-6 mt-6 border-t border-slate-300 text-center text-[11px]">
        <div>
          <p className="font-extrabold mb-6">مسؤول الغيابات</p>
          <p className="text-slate-500">الاسم والتوقيع: ......................</p>
        </div>
        <div>
          <p className="font-extrabold mb-6">معاون المدير</p>
          <p className="text-slate-500">الاسم والتوقيع: ......................</p>
        </div>
        <div>
          <p className="font-extrabold mb-6">مدير المدرسة (الختم الرسمي)</p>
          <p className="text-slate-500">التوقيع والختم: ......................</p>
        </div>
      </div>

      <footer className="mt-5 pt-2 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-500 tabular-nums">
        <span>
          تاريخ الطباعة: <LtrSpan>{dateDMY(todayIso)}</LtrSpan>
        </span>
        <span>
          <BidiText text={school.school_name} /> — تقارير الغياب والإنذارات
        </span>
      </footer>
    </div>
  );
}
