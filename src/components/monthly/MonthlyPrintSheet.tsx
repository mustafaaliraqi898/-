import type { MonthCalendarDay, MonthlyRegisterData } from '../../types/school';

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

interface MonthlyPrintSheetProps {
  data: MonthlyRegisterData | null;
  paperPreset: PrintPaperPreset;
}

export function MonthlyPrintSheet({ data, paperPreset }: MonthlyPrintSheetProps) {
  if (!data) return null;

  const spec = resolveEffectivePrintSpec(paperPreset);
  const chunks = computeMonthlyPrintPages(data.calendar_days, paperPreset);

  return (
    <div className="print-only" dir="rtl">
      <style>{`@page { size: ${spec.sizeCss}; margin: 9mm; }`}</style>

      {chunks.map((chunk) => (
        <section
          key={chunk.chunkIndex}
          className="print-page-break text-slate-900 bg-white py-2"
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
          <div className="mb-2 px-2 py-1 border border-slate-300 bg-slate-50 text-[10px] flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="font-bold text-slate-800">دليل الرموز:</span>
            <span>
              <strong>غ</strong> = غياب يوم كامل
            </span>
            <span>
              <strong>ج</strong> = يوم من تراكم الدروس ({data.school_settings.lessons_per_absence_day} دروس)
            </span>
            <span>
              <strong>د١..</strong> = عدد الدروس الغائبة
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
            <span>
              <strong>—</strong> = حاضر
            </span>
          </div>

          {/* Printable Table */}
          <table className="print-table w-full border-collapse text-[10px] tabular-nums">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="border border-slate-500 px-1.5 py-1 text-center w-7">#</th>
                <th className="border border-slate-500 px-2 py-1 text-right min-w-[145px]">
                  اسم الطالب
                </th>
                {chunk.days.map((d) => (
                  <th
                    key={d.day_of_month}
                    className={`border border-slate-500 px-0.5 py-1 text-center min-w-[20px] ${
                      d.is_holiday ? 'bg-slate-600' : ''
                    }`}
                  >
                    <div className="font-bold leading-tight">{d.day_of_month}</div>
                    <div className="text-[8px] font-normal opacity-90 leading-tight">
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
              {data.students.map((st, idx) => {
                const notesList = [
                  ...st.auto_notes,
                  ...(st.manual_note ? [`ملاحظة الإدارة: ${st.manual_note}`] : []),
                ];
                return (
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
                          className={`border border-slate-300 px-0.5 py-1 text-center font-bold ${
                            c.status_kind === 'holiday'
                              ? 'bg-slate-200 text-slate-600'
                              : c.status_kind === 'full_day'
                                ? 'bg-red-100 text-red-900'
                                : c.status_kind === 'lesson_converted'
                                  ? 'bg-purple-100 text-purple-900'
                                  : c.status_kind === 'lesson_absence'
                                    ? 'bg-amber-100 text-amber-900'
                                    : c.status_kind === 'sick_leave'
                                      ? 'bg-teal-100 text-teal-900'
                                      : c.status_kind === 'daily_permission'
                                        ? 'bg-sky-100 text-sky-900'
                                        : c.status_kind === 'lesson_permission'
                                          ? 'bg-indigo-100 text-indigo-900'
                                          : 'text-slate-400 font-normal'
                          }`}
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
                      <td className="border border-slate-300 px-2 py-1 text-right text-[9.5px] leading-snug">
                        {notesList.length > 0 ? notesList.join(' | ') : '—'}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

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
