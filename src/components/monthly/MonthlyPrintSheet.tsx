import { useEffect } from 'react';
import type {
  MonthCalendarDay,
  MonthlyCellStatusKind,
  MonthlyRegisterData,
} from '../../types/school';

export type PrintPaperPreset =
  | 'auto'
  | 'a3-landscape'
  | 'a4-landscape'
  | 'a4-portrait'
  | 'a3-portrait';

export interface PrintColumnPageChunk {
  chunkIndex: number;
  totalChunks: number;
  titleSuffix: string;
  days: MonthCalendarDay[];
  includeTotals: boolean;
  includeNotes: boolean;
}

export function resolveEffectivePrintSpec(preset: PrintPaperPreset): {
  sizeCss: string;
  label: string;
  maxDayColsPerPage: number;
  splitTotalsAndNotes: boolean;
} {
  switch (preset) {
    case 'a4-portrait':
      return {
        sizeCss: 'A4 portrait',
        label: 'A4 عمودي',
        maxDayColsPerPage: 16,
        splitTotalsAndNotes: true,
      };
    case 'a4-landscape':
      return {
        sizeCss: 'A4 landscape',
        label: 'A4 أفقي',
        maxDayColsPerPage: 22,
        splitTotalsAndNotes: true,
      };
    case 'a3-portrait':
      return {
        sizeCss: 'A3 portrait',
        label: 'A3 عمودي',
        maxDayColsPerPage: 24,
        splitTotalsAndNotes: true,
      };
    case 'a3-landscape':
    case 'auto':
    default:
      return {
        sizeCss: 'A3 landscape',
        label: 'A3 أفقي (الوضع القياسي للسجل الكامل)',
        maxDayColsPerPage: 31,
        splitTotalsAndNotes: false,
      };
  }
}

export function computeMonthlyPrintPages(
  calendarDays: MonthCalendarDay[],
  preset: PrintPaperPreset
): PrintColumnPageChunk[] {
  const spec = resolveEffectivePrintSpec(preset);

  // Full single horizontal page on A3 Landscape
  if (!spec.splitTotalsAndNotes && calendarDays.length <= spec.maxDayColsPerPage) {
    return [
      {
        chunkIndex: 1,
        totalChunks: 1,
        titleSuffix: 'الجدول الكامل',
        days: calendarDays,
        includeTotals: true,
        includeNotes: true,
      },
    ];
  }

  // Multi-part horizontal splitting with repeated student name column so cells remain large and readable
  const chunks: Array<{
    days: MonthCalendarDay[];
    includeTotals: boolean;
    includeNotes: boolean;
    titleSuffix: string;
  }> = [];

  for (let i = 0; i < calendarDays.length; i += spec.maxDayColsPerPage) {
    const slice = calendarDays.slice(i, i + spec.maxDayColsPerPage);
    const firstDay = slice[0].day_of_month;
    const lastDay = slice[slice.length - 1].day_of_month;
    chunks.push({
      days: slice,
      includeTotals: false,
      includeNotes: false,
      titleSuffix: `الأيام من ${firstDay} إلى ${lastDay}`,
    });
  }

  // Dedicated readable page for totals and notes when split is required
  chunks.push({
    days: [],
    includeTotals: true,
    includeNotes: true,
    titleSuffix: 'ملخص المجاميع والملاحظات',
  });

  return chunks.map((c, idx) => ({
    ...c,
    chunkIndex: idx + 1,
    totalChunks: chunks.length,
  }));
}

function getPrintCellClasses(kind: MonthlyCellStatusKind): string {
  switch (kind) {
    case 'present':
      return 'bg-emerald-50 text-emerald-700 font-extrabold';
    case 'unrecorded':
      return 'bg-white text-slate-300 font-normal';
    case 'holiday':
      return 'bg-slate-200 text-slate-600 font-bold';
    case 'full_day':
      return 'bg-red-100 text-red-900 font-extrabold';
    case 'lesson_converted':
      return 'bg-purple-100 text-purple-900 font-extrabold';
    case 'lesson_absence':
      return 'bg-amber-100 text-amber-900 font-bold';
    case 'lesson_escape':
      return 'bg-orange-100 text-orange-900 font-bold';
    case 'lesson_mixed':
      return 'bg-rose-100 text-rose-900 font-bold';
    case 'sick_leave':
      return 'bg-teal-100 text-teal-900 font-bold';
    case 'daily_permission':
      return 'bg-sky-100 text-sky-900 font-bold';
    case 'lesson_permission':
      return 'bg-indigo-100 text-indigo-900 font-bold';
    default:
      return 'bg-white text-slate-400 font-normal';
  }
}

function getStandaloneCellCssClass(kind: MonthlyCellStatusKind): string {
  switch (kind) {
    case 'present':
      return 'cell-present';
    case 'unrecorded':
      return 'cell-unrecorded';
    case 'holiday':
      return 'cell-holiday';
    case 'full_day':
      return 'cell-full-day';
    case 'lesson_converted':
      return 'cell-lesson-converted';
    case 'lesson_absence':
      return 'cell-lesson-absence';
    case 'lesson_escape':
      return 'cell-lesson-escape';
    case 'lesson_mixed':
      return 'cell-lesson-mixed';
    case 'sick_leave':
      return 'cell-sick-leave';
    case 'daily_permission':
      return 'cell-daily-permission';
    case 'lesson_permission':
      return 'cell-lesson-permission';
    default:
      return 'cell-unrecorded';
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

export function buildStandalonePrintableHtml(
  data: MonthlyRegisterData,
  paperPreset: PrintPaperPreset
): string {
  const spec = resolveEffectivePrintSpec(paperPreset);
  const chunks = computeMonthlyPrintPages(data.calendar_days, paperPreset);
  const pageTitle = `السجل الشهري للغيابات — ${data.month_name} ${data.year} — ${data.grade_name} (${data.section_name})`;

  const pagesHtml = chunks
    .map((chunk) => {
      const dayHeadersHtml = chunk.days
        .map(
          (d) => `
          <th class="day-col ${d.is_holiday ? 'holiday-th' : ''}">
            <div class="day-num">${escapeHtml(d.day_of_month)}</div>
            <div class="day-name">${escapeHtml(d.day_name.replace('ال', ''))}</div>
          </th>`
        )
        .join('');

      const totalsHeadersHtml = chunk.includeTotals
        ? `
          <th class="tot-th">مباشر</th>
          <th class="tot-th">تراكم</th>
          <th class="tot-th">دروس</th>
          <th class="tot-th">مرضية</th>
          <th class="tot-th">ر.يومية</th>
          <th class="tot-th">ر.دروس</th>
          <th class="tot-th tot-counted-th">المحتسب</th>`
        : '';

      const notesHeaderHtml = chunk.includeNotes
        ? `<th class="notes-th">الملاحظات</th>`
        : '';

      const studentsWithManualNotes = chunk.includeNotes
        ? data.students.filter((st) => Boolean(st.manual_note && st.manual_note.trim()))
        : [];

      const rowsHtml = data.students
        .map((st, idx) => {
          const dayCellsHtml = chunk.days
            .map((d) => {
              const c = st.days[d.day_of_month];
              const cssClass = getStandaloneCellCssClass(c.status_kind);
              return `<td class="day-cell ${cssClass}">${escapeHtml(c.symbol)}</td>`;
            })
            .join('');

          const totalsCellsHtml = chunk.includeTotals
            ? `
              <td class="num-cell">${escapeHtml(st.direct_full_days)}</td>
              <td class="num-cell">${escapeHtml(st.converted_lesson_days)}</td>
              <td class="num-cell">${escapeHtml(st.missed_lessons_count)}</td>
              <td class="num-cell">${escapeHtml(st.sick_leave_days)}</td>
              <td class="num-cell">${escapeHtml(st.daily_permission_days)}</td>
              <td class="num-cell">${escapeHtml(st.lesson_permission_records)}</td>
              <td class="num-cell tot-counted-cell">${escapeHtml(st.total_counted_absence_days)}</td>`
            : '';

          let notesInnerHtml = '';
          if (st.compact_notes_summary) {
            notesInnerHtml += `<div class="notes-numeric">${escapeHtml(st.compact_notes_summary)}</div>`;
          }
          if (st.manual_note) {
            notesInnerHtml += `<div class="notes-manual"><strong>ملاحظة يدوية:</strong> ${escapeHtml(st.manual_note)}</div>`;
          }
          if (!notesInnerHtml) {
            notesInnerHtml = '<span class="muted-note">لا توجد ملاحظات</span>';
          }

          const notesCellHtml = chunk.includeNotes
            ? `<td class="notes-cell">${notesInnerHtml}</td>`
            : '';

          return `
            <tr class="${idx % 2 === 1 ? 'alt-row' : ''}">
              <td class="ord-cell">${escapeHtml(st.original_order)}</td>
              <td class="name-cell">${escapeHtml(st.full_name)}</td>
              ${dayCellsHtml}
              ${totalsCellsHtml}
              ${notesCellHtml}
            </tr>`;
        })
        .join('');

      const manualSummarySectionHtml =
        chunk.includeNotes && studentsWithManualNotes.length > 0
          ? `
          <div class="manual-notes-summary-box">
            <div class="manual-notes-summary-title">
              ملخص الملاحظات الإدارية اليدوية (${escapeHtml(studentsWithManualNotes.length)}) — منفصلة عن أعداد الغياب والرخص والهروب
            </div>
            <div class="manual-notes-summary-list">
              ${studentsWithManualNotes
                .map(
                  (st) =>
                    `<div class="manual-notes-summary-item"><strong>${escapeHtml(st.original_order)}. ${escapeHtml(st.full_name)}:</strong> ${escapeHtml(st.manual_note)}</div>`
                )
                .join('')}
            </div>
          </div>`
          : '';

      const subtitleSuffix =
        chunk.totalChunks > 1 ? ` (جزء ${chunk.chunkIndex} من ${chunk.totalChunks})` : '';

      return `
        <section class="sheet-page">
          <header class="official-header">
            <div class="header-right">
              <div class="directorate">${escapeHtml(data.school_settings.directorate_name)}</div>
              <div class="school-name">${escapeHtml(data.school_settings.school_name)}</div>
            </div>
            <div class="header-center">
              <div class="title-badge">السجل الشهري للغيابات المدرسية</div>
              <div class="subtitle">شهر ${escapeHtml(data.month_name)} ${escapeHtml(data.year)} — ${escapeHtml(chunk.titleSuffix)}${escapeHtml(subtitleSuffix)}</div>
            </div>
            <div class="header-left">
              <div><strong>السنة الدراسية:</strong> ${escapeHtml(data.academic_year.name)}</div>
              <div><strong>الصف والشعبة:</strong> ${escapeHtml(data.grade_name)} — ${escapeHtml(data.section_name)}</div>
              <div><strong>عدد الطلاب:</strong> ${escapeHtml(data.stats.total_students)}</div>
            </div>
          </header>

          <div class="legend-bar">
            <span class="legend-title">دليل الرموز:</span>
            <span><strong class="legend-present">✓</strong> = حاضر</span>
            <span><strong>غ</strong> = غياب يوم كامل</span>
            <span><strong>ج</strong> = يوم من تراكم الدروس (${escapeHtml(data.school_settings.lessons_per_absence_day)} دروس)</span>
            <span><strong>د١..</strong> = غياب دروس</span>
            <span><strong>هـ١..</strong> = هروب من دروس</span>
            <span><strong>م</strong> = إجازة مرضية (لا تُحسب)</span>
            <span><strong>ر</strong> = رخصة يومية</span>
            <span><strong>ح١..</strong> = رخصة عن درس</span>
            <span><strong>ع</strong> = عطلة</span>
          </div>

          <table class="register-table">
            <thead>
              <tr>
                <th class="ord-th">#</th>
                <th class="name-th">اسم الطالب</th>
                ${dayHeadersHtml}
                ${totalsHeadersHtml}
                ${notesHeaderHtml}
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>

          ${manualSummarySectionHtml}

          <footer class="signature-footer">
            <div>مسؤول الغيابات: .................................</div>
            <div>معاون المدير: .................................</div>
            <div>مدير المدرسة: .................................</div>
          </footer>
        </section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(pageTitle)}</title>
    <style>
      @page {
        size: ${spec.sizeCss};
        margin: 9mm;
      }
      * {
        box-sizing: border-box;
      }
      html, body {
        margin: 0;
        padding: 0;
        direction: rtl;
        background: #f1f5f9;
        color: #0f172a;
        font-family: 'Cairo', 'Almarai', 'Segoe UI', Tahoma, Arial, sans-serif;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .no-print-toolbar {
        position: sticky;
        top: 0;
        z-index: 50;
        background: #0f172a;
        color: #f8fafc;
        padding: 10px 18px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border-bottom: 2px solid #0f766e;
      }
      .toolbar-info {
        font-size: 13px;
        font-weight: 700;
      }
      .toolbar-sub {
        font-size: 11px;
        color: #cbd5e1;
        margin-top: 2px;
      }
      .print-btn {
        background: #0f766e;
        color: #ffffff;
        border: none;
        border-radius: 8px;
        padding: 8px 18px;
        font-size: 13px;
        font-weight: 700;
        font-family: inherit;
        cursor: pointer;
      }
      .print-btn:hover {
        background: #115e59;
      }
      .pages-wrap {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .sheet-page {
        background: #ffffff;
        padding: 14px 16px;
        border: 1px solid #cbd5e1;
        box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
        page-break-after: always;
        break-after: page;
      }
      .sheet-page:last-child {
        page-break-after: auto;
        break-after: auto;
      }
      .official-header {
        border-bottom: 2px solid #1e293b;
        padding-bottom: 10px;
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
      }
      .header-right {
        text-align: right;
      }
      .directorate {
        font-size: 11.5px;
        font-weight: 700;
        color: #334155;
      }
      .school-name {
        font-size: 16px;
        font-weight: 800;
        color: #0f172a;
        margin-top: 2px;
      }
      .header-center {
        text-align: center;
      }
      .title-badge {
        display: inline-block;
        border: 2px solid #115e59;
        border-radius: 4px;
        padding: 4px 12px;
        font-size: 14px;
        font-weight: 800;
        color: #134e4a;
      }
      .subtitle {
        font-size: 12px;
        font-weight: 700;
        color: #334155;
        margin-top: 4px;
      }
      .header-left {
        text-align: left;
        font-size: 11.5px;
        line-height: 1.5;
        font-variant-numeric: tabular-nums;
      }
      .legend-bar {
        margin-bottom: 8px;
        padding: 5px 10px;
        border: 1px solid #cbd5e1;
        background: #f8fafc;
        font-size: 10.5px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 6px 12px;
      }
      .legend-title {
        font-weight: 800;
        color: #1e293b;
      }
      .legend-present {
        color: #15803d;
        font-weight: 800;
      }
      .register-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 10.5px;
        font-variant-numeric: tabular-nums;
      }
      .register-table thead {
        display: table-header-group;
      }
      .register-table tr {
        page-break-inside: avoid;
        break-inside: avoid;
      }
      .register-table th {
        background: #1e293b;
        color: #ffffff;
        border: 1px solid #64748b;
        padding: 4px 3px;
        text-align: center;
        font-weight: 700;
      }
      .register-table th.name-th {
        text-align: right;
        padding: 4px 8px;
        min-width: 150px;
      }
      .register-table th.ord-th {
        width: 28px;
      }
      .register-table th.day-col {
        min-width: 22px;
      }
      .register-table th.holiday-th {
        background: #475569;
      }
      .day-num {
        font-weight: 800;
        line-height: 1.1;
      }
      .day-name {
        font-size: 8.5px;
        font-weight: 400;
        opacity: 0.92;
        line-height: 1.1;
      }
      .register-table th.tot-th {
        background: #334155;
        padding: 4px 5px;
      }
      .register-table th.tot-counted-th {
        background: #7f1d1d;
      }
      .register-table th.notes-th {
        text-align: right;
        padding: 4px 8px;
        min-width: 185px;
      }
      .register-table td {
        border: 1px solid #cbd5e1;
        padding: 4px 3px;
        text-align: center;
      }
      .register-table tr.alt-row {
        background: #f8fafc;
      }
      .ord-cell {
        font-weight: 600;
      }
      .name-cell {
        text-align: right !important;
        padding: 4px 8px !important;
        font-weight: 700;
        color: #0f172a;
        white-space: nowrap;
      }
      .day-cell {
        font-weight: 700;
      }
      .cell-present {
        background: #ecfdf5 !important;
        color: #15803d !important;
        font-weight: 800 !important;
      }
      .cell-unrecorded {
        background: #ffffff !important;
        color: #cbd5e1 !important;
        font-weight: 400 !important;
      }
      .cell-holiday {
        background: #e2e8f0 !important;
        color: #475569 !important;
      }
      .cell-full-day {
        background: #fee2e2 !important;
        color: #7f1d1d !important;
        font-weight: 800 !important;
      }
      .cell-lesson-converted {
        background: #f3e8ff !important;
        color: #581c87 !important;
        font-weight: 800 !important;
      }
      .cell-lesson-absence {
        background: #fef3c7 !important;
        color: #78350f !important;
      }
      .cell-lesson-escape {
        background: #ffedd5 !important;
        color: #9a3412 !important;
      }
      .cell-lesson-mixed {
        background: #ffe4e6 !important;
        color: #9f1239 !important;
        font-size: 9px !important;
      }
      .cell-sick-leave {
        background: #ccfbf1 !important;
        color: #134e4a !important;
      }
      .cell-daily-permission {
        background: #e0f2fe !important;
        color: #0c4a6e !important;
      }
      .cell-lesson-permission {
        background: #e0e7ff !important;
        color: #312e81 !important;
      }
      .num-cell {
        font-weight: 600;
      }
      .tot-counted-cell {
        font-weight: 800;
        color: #7f1d1d;
        background: #fef2f2;
      }
      .notes-cell {
        text-align: right !important;
        padding: 4px 8px !important;
        font-size: 10px;
        line-height: 1.35;
      }
      .notes-numeric {
        font-weight: 700;
        color: #0f172a;
      }
      .notes-manual {
        margin-top: 2px;
        padding-top: 2px;
        border-top: 1px dashed #99f6e4;
        color: #115e59;
        font-size: 9.5px;
      }
      .manual-notes-summary-box {
        margin-top: 10px;
        padding: 7px 10px;
        border: 1px solid #99f6e4;
        background: #f0fdfa;
        border-radius: 4px;
        page-break-inside: avoid;
        break-inside: avoid;
      }
      .manual-notes-summary-title {
        font-size: 10.5px;
        font-weight: 800;
        color: #115e59;
        margin-bottom: 4px;
      }
      .manual-notes-summary-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 14px;
        font-size: 10px;
        color: #134e4a;
      }
      .muted-note {
        color: #94a3b8;
      }
      .signature-footer {
        margin-top: 14px;
        padding-top: 8px;
        border-top: 1px solid #cbd5e1;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11px;
        font-weight: 700;
        color: #1e293b;
      }
      @media print {
        html, body {
          background: #ffffff !important;
        }
        .no-print-toolbar {
          display: none !important;
        }
        .pages-wrap {
          padding: 0;
          gap: 0;
        }
        .sheet-page {
          border: none;
          box-shadow: none;
          padding: 0;
        }
      }
    </style>
  </head>
  <body>
    <div class="no-print-toolbar">
      <div>
        <div class="toolbar-info">${escapeHtml(pageTitle)}</div>
        <div class="toolbar-sub">إعداد الورق: ${escapeHtml(spec.label)} • اضغط زر الطباعة أو Ctrl+P للطباعة أو الحفظ كملف PDF</div>
      </div>
      <button type="button" class="print-btn" onclick="window.print()">طباعة التقرير</button>
    </div>
    <div class="pages-wrap">
      ${pagesHtml}
    </div>
  </body>
</html>`;
}

interface MonthlyPrintSheetProps {
  data: MonthlyRegisterData | null;
  paperPreset: PrintPaperPreset;
  mode?: 'print' | 'preview';
}

export function MonthlyPrintSheet({
  data,
  paperPreset,
  mode = 'print',
}: MonthlyPrintSheetProps) {
  const spec = resolveEffectivePrintSpec(paperPreset);

  useEffect(() => {
    if (mode !== 'print' || !data || typeof document === 'undefined') {
      return;
    }

    const styleId = 'monthly-print-page-style';
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `@page { size: ${spec.sizeCss}; margin: 9mm; }`;

    return () => {
      const existing = document.getElementById(styleId);
      if (existing) {
        existing.remove();
      }
    };
  }, [mode, data, spec.sizeCss]);

  if (!data) return null;

  const chunks = computeMonthlyPrintPages(data.calendar_days, paperPreset);
  const isPreview = mode === 'preview';

  return (
    <div
      id={isPreview ? undefined : 'monthly-print-sheet'}
      className={
        isPreview
          ? 'space-y-6 bg-slate-100 dark:bg-slate-950 p-3 sm:p-5 rounded-xl overflow-x-auto'
          : 'print-only bg-white text-slate-900'
      }
      dir="rtl"
    >
      {chunks.map((chunk) => (
        <section
          key={chunk.chunkIndex}
          className={
            isPreview
              ? 'bg-white text-slate-900 p-4 sm:p-6 shadow-md border border-slate-300 rounded-md mx-auto min-w-[760px]'
              : 'print-page-break text-slate-900 bg-white py-2'
          }
        >
          {/* Official Iraqi School Header */}
          <header className="border-b-2 border-slate-800 pb-2.5 mb-2.5 flex items-center justify-between gap-4">
            <div className="space-y-0.5 text-right">
              <p className="text-[11px] font-bold text-slate-700">
                {data.school_settings.directorate_name}
              </p>
              <h1 className="text-base font-extrabold text-slate-900 font-display">
                {data.school_settings.school_name}
              </h1>
            </div>

            <div className="text-center">
              <div className="inline-flex items-center gap-2 border-2 border-teal-800 px-3 py-1 rounded">
                <span className="text-sm font-extrabold text-teal-900 font-display">
                  السجل الشهري للغيابات المدرسية
                </span>
              </div>
              <p className="text-xs font-bold text-slate-700 mt-1">
                شهر {data.month_name} {data.year} — {chunk.titleSuffix}
                {chunk.totalChunks > 1 ? ` (جزء ${chunk.chunkIndex} من ${chunk.totalChunks})` : ''}
              </p>
            </div>

            <div className="text-left text-[11px] space-y-0.5 tabular-nums">
              <p>
                <span className="font-bold">السنة الدراسية:</span> {data.academic_year.name}
              </p>
              <p>
                <span className="font-bold">الصف والشعبة:</span> {data.grade_name} — {data.section_name}
              </p>
              <p>
                <span className="font-bold">عدد الطلاب:</span> {data.stats.total_students}
              </p>
            </div>
          </header>

          {/* Compact Legend */}
          <div className="mb-2 px-2.5 py-1.5 border border-slate-300 bg-slate-50 text-[10.5px] flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="font-bold text-slate-800">دليل الرموز:</span>
            <span>
              <strong className="text-emerald-700 font-extrabold">✓</strong> = حاضر
            </span>
            <span>
              <strong>غ</strong> = غياب يوم كامل
            </span>
            <span>
              <strong>ج</strong> = يوم من تراكم الدروس ({data.school_settings.lessons_per_absence_day} دروس)
            </span>
            <span>
              <strong>د١..</strong> = غياب دروس
            </span>
            <span>
              <strong>هـ١..</strong> = هروب من دروس
            </span>
            <span>
              <strong>م</strong> = إجازة مرضية (لا تُحسب)
            </span>
            <span>
              <strong>ر</strong> = رخصة يومية
            </span>
            <span>
              <strong>ح١..</strong> = رخصة عن درس
            </span>
            <span>
              <strong>ع</strong> = عطلة
            </span>
          </div>

          {/* Printable Table */}
          <table className="print-table w-full border-collapse text-[10.5px] tabular-nums">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="border border-slate-500 px-1.5 py-1 text-center w-7">#</th>
                <th className="border border-slate-500 px-2 py-1 text-right min-w-[150px]">
                  اسم الطالب
                </th>
                {chunk.days.map((d) => (
                  <th
                    key={d.day_of_month}
                    className={`border border-slate-500 px-0.5 py-1 text-center min-w-[22px] ${
                      d.is_holiday ? 'bg-slate-600' : ''
                    }`}
                  >
                    <div className="text-[10.5px] font-bold leading-tight">{d.day_of_month}</div>
                    <div className="text-[8.5px] font-normal opacity-90 leading-tight">
                      {d.day_name.replace('ال', '')}
                    </div>
                  </th>
                ))}

                {chunk.includeTotals && (
                  <>
                    <th className="border border-slate-500 px-1 py-1 text-center bg-slate-700">
                      مباشر
                    </th>
                    <th className="border border-slate-500 px-1 py-1 text-center bg-slate-700">
                      تراكم
                    </th>
                    <th className="border border-slate-500 px-1 py-1 text-center bg-slate-700">
                      دروس
                    </th>
                    <th className="border border-slate-500 px-1 py-1 text-center bg-slate-700">
                      مرضية
                    </th>
                    <th className="border border-slate-500 px-1 py-1 text-center bg-slate-700">
                      ر.يومية
                    </th>
                    <th className="border border-slate-500 px-1 py-1 text-center bg-slate-700">
                      ر.دروس
                    </th>
                    <th className="border border-slate-500 px-1 py-1 text-center bg-red-900">
                      المحتسب
                    </th>
                  </>
                )}

                {chunk.includeNotes && (
                  <th className="border border-slate-500 px-2 py-1 text-right min-w-[190px]">
                    الملاحظات
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.students.map((st, idx) => (
                <tr key={st.student_id} className={idx % 2 === 1 ? 'bg-slate-50/70' : 'bg-white'}>
                  <td className="border border-slate-300 px-1 py-1 text-center font-medium">
                    {st.original_order}
                  </td>
                  <td className="border border-slate-300 px-2 py-1 text-right font-bold text-slate-900 whitespace-nowrap">
                    {st.full_name}
                  </td>

                  {chunk.days.map((d) => {
                    const c = st.days[d.day_of_month];
                    return (
                      <td
                        key={d.day_of_month}
                        className={`border border-slate-300 px-0.5 py-1 text-center ${getPrintCellClasses(
                          c.status_kind
                        )}`}
                      >
                        {c.symbol}
                      </td>
                    );
                  })}

                  {chunk.includeTotals && (
                    <>
                      <td className="border border-slate-300 px-1 py-1 text-center font-semibold">
                        {st.direct_full_days}
                      </td>
                      <td className="border border-slate-300 px-1 py-1 text-center font-semibold">
                        {st.converted_lesson_days}
                      </td>
                      <td className="border border-slate-300 px-1 py-1 text-center">
                        {st.missed_lessons_count}
                      </td>
                      <td className="border border-slate-300 px-1 py-1 text-center">
                        {st.sick_leave_days}
                      </td>
                      <td className="border border-slate-300 px-1 py-1 text-center">
                        {st.daily_permission_days}
                      </td>
                      <td className="border border-slate-300 px-1 py-1 text-center">
                        {st.lesson_permission_records}
                      </td>
                      <td className="border border-slate-300 px-1 py-1 text-center font-extrabold text-red-900 bg-red-50">
                        {st.total_counted_absence_days}
                      </td>
                    </>
                  )}

                  {chunk.includeNotes && (
                    <td className="border border-slate-300 px-2 py-1 text-right text-[10px] leading-snug">
                      {st.compact_notes_summary || st.manual_note ? (
                        <div className="space-y-0.5">
                          {st.compact_notes_summary && (
                            <p className="font-bold text-slate-900">{st.compact_notes_summary}</p>
                          )}
                          {st.manual_note && (
                            <p className="text-[9.5px] text-teal-800 border-t border-dashed border-teal-200 pt-0.5">
                              <strong>ملاحظة يدوية:</strong> {st.manual_note}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">لا توجد ملاحظات</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {/* Separate Manual Notes Summary when present (excluded from absence/permission/escape counts) */}
          {chunk.includeNotes &&
            data.students.some((st) => Boolean(st.manual_note && st.manual_note.trim())) && (
              <div className="mt-2.5 px-2.5 py-2 rounded border border-teal-200 bg-teal-50/70 text-[10px] text-teal-950">
                <p className="font-extrabold text-teal-900 mb-1">
                  ملخص الملاحظات الإدارية اليدوية (
                  {data.students.filter((st) => Boolean(st.manual_note && st.manual_note.trim())).length}
                  ) — منفصلة عن أعداد الغياب والرخص والهروب
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {data.students
                    .filter((st) => Boolean(st.manual_note && st.manual_note.trim()))
                    .map((st) => (
                      <div key={st.student_id}>
                        <strong>
                          {st.original_order}. {st.full_name}:
                        </strong>{' '}
                        {st.manual_note}
                      </div>
                    ))}
                </div>
              </div>
            )}

          {/* Signature Footer */}
          <footer className="mt-4 pt-2 border-t border-slate-300 flex items-center justify-between text-[11px] font-bold text-slate-800">
            <div>مسؤول الغيابات: .................................</div>
            <div>معاون المدير: .................................</div>
            <div>مدير المدرسة: .................................</div>
          </footer>
        </section>
      ))}
    </div>
  );
}
