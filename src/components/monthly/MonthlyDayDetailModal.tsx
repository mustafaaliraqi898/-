import { CalendarOff, CheckCircle2, Clock, FileText, Info, Layers, X } from 'lucide-react';
import { useEffect } from 'react';
import type { HolidayCategory, MonthlyDayCellData, MonthlyStudentRow } from '../../types/school';

interface MonthlyDayDetailModalProps {
  open: boolean;
  student: MonthlyStudentRow | null;
  cell: MonthlyDayCellData | null;
  gradeName: string;
  sectionName: string;
  onClose: () => void;
}

const LESSON_ORDINALS: readonly string[] = [
  'الدرس الأول',
  'الدرس الثاني',
  'الدرس الثالث',
  'الدرس الرابع',
  'الدرس الخامس',
  'الدرس السادس',
  'الدرس السابع',
  'الدرس الثامن',
  'الدرس التاسع',
  'الدرس العاشر',
  'الدرس الحادي عشر',
  'الدرس الثاني عشر',
];

function getLessonName(n: number): string {
  return LESSON_ORDINALS[n - 1] ?? `الدرس ${n}`;
}

const HOLIDAY_CATEGORY_LABELS: Record<Exclude<HolidayCategory, 'workday'>, string> = {
  weekly: 'عطلة أسبوعية',
  official: 'عطلة رسمية',
  exceptional: 'عطلة استثنائية',
  school_specific: 'عطلة خاصة بالمدرسة',
};

const LESSON_STATUS_LABELS: Record<string, { label: string; chipClass: string }> = {
  lesson_absence: {
    label: 'غائب عن درس',
    chipClass:
      'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200',
  },
  lesson_escape: {
    label: 'هروب من درس',
    chipClass:
      'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/40 text-orange-800 dark:text-orange-200',
  },
  lesson_permission: {
    label: 'رخصة عن درس',
    chipClass:
      'border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-200',
  },
};

function getStatusDisplayInfo(cell: MonthlyDayCellData): {
  title: string;
  subtitle: string;
  boxClass: string;
} {
  switch (cell.status_kind) {
    case 'full_day':
      return {
        title: 'غائب يوم كامل (غياب مباشر)',
        subtitle: 'سُجل الطالب غائباً طوال اليوم الدراسي.',
        boxClass:
          'border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 text-red-900 dark:text-red-200',
      };
    case 'lesson_converted':
      return {
        title: 'يوم غياب كامل ناتج عن تراكم الدروس',
        subtitle: cell.raw_status === 'lesson_escape'
          ? 'اكتمل نصاب الغياب في هذا اليوم من تراكم الدروس (يشمل هروب من درس).'
          : cell.raw_status === 'lesson_permission'
            ? 'اكتمل نصاب الغياب في هذا اليوم بسبب رخصة عن درس محسوبة في العداد الموحد.'
            : 'اكتمل نصاب الغياب في هذا اليوم بسبب تراكم الدروس في العداد الموحد.',
        boxClass:
          'border-purple-200 dark:border-purple-900/60 bg-purple-50/70 dark:bg-purple-950/30 text-purple-900 dark:text-purple-200',
      };
    case 'lesson_absence':
      return {
        title: 'حاضر للدوام · غائب عن درس (✓ + د،غ)',
        subtitle: 'حضر الطالب إلى المدرسة وسُجل عليه غياب عن دروس محددة أُضيفت إلى العداد الموحد.',
        boxClass:
          'border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200',
      };
    case 'lesson_escape':
      return {
        title: 'حاضر للدوام · هروب من درس (✓ + د،هـ)',
        subtitle: 'حضر الطالب إلى المدرسة وسُجل عليه هروب من دروس محددة أُضيفت جميعها تلقائياً إلى العداد الموحد.',
        boxClass:
          'border-orange-200 dark:border-orange-900/60 bg-orange-50/70 dark:bg-orange-950/30 text-orange-900 dark:text-orange-200',
      };
    case 'lesson_mixed':
      return {
        title: 'حاضر للدوام · حالات دروس متعددة',
        subtitle: 'حضر الطالب إلى المدرسة وسُجلت له أسباب مستقلة لدروس مختلفة في هذا اليوم دون تعارض.',
        boxClass:
          'border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 text-rose-900 dark:text-rose-200',
      };
    case 'sick_leave':
      return {
        title: 'إجازة مرضية (م)',
        subtitle: 'يوم مجاز بإجازة مرضية معتمدة ولا يُحتسب غياباً.',
        boxClass:
          'border-teal-200 dark:border-teal-900/60 bg-teal-50/70 dark:bg-teal-950/30 text-teal-900 dark:text-teal-200',
      };
    case 'daily_permission':
      return {
        title: 'رخصة يومية (ر)',
        subtitle: cell.counted_as_absence
          ? 'رخصة خروج ليوم كامل، واحتُسبت يوم غياب كامل وفق إعدادات المدرسة وقت التسجيل.'
          : 'رخصة خروج ليوم كامل، ولم تُحتسب غياباً وفق إعدادات المدرسة وقت التسجيل.',
        boxClass:
          'border-sky-200 dark:border-sky-900/60 bg-sky-50/70 dark:bg-sky-950/30 text-sky-900 dark:text-sky-200',
      };
    case 'lesson_permission':
      return {
        title: 'حاضر للدوام · رخصة عن درس (✓ + رخ)',
        subtitle: cell.contributed_to_counter
          ? 'حضر الطالب إلى المدرسة وسُجلت له رخصة عن درس محددة أُضيفت دروسها إلى العداد الموحد.'
          : 'حضر الطالب إلى المدرسة وسُجلت له رخصة عن درس محددة ولم تُضف إلى العداد الموحد.',
        boxClass:
          'border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/70 dark:bg-indigo-950/30 text-indigo-900 dark:text-indigo-200',
      };
    case 'holiday':
      return {
        title: 'يوم عطلة (ع)',
        subtitle: 'لا يوجد دوام مدرسي رسمي في هذا التاريخ.',
        boxClass:
          'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/70 text-slate-900 dark:text-slate-100',
      };
    case 'present':
      return {
        title: 'حاضر (✓)',
        subtitle: 'حضر الطالب الدوام المدرسي في هذا اليوم وفق سجل الحضور المعتمد.',
        boxClass:
          'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200',
      };
    case 'unrecorded':
    default:
      return {
        title: cell.outside_section_membership
          ? 'خارج فترة انتماء الطالب للشعبة'
          : 'لم يُسجل دوام هذا اليوم بعد',
        subtitle: cell.outside_section_membership
          ? 'لم يكن الطالب مسجلاً ضمن هذه الشعبة في هذا التاريخ.'
          : 'لم يتم تسجيل ورقة الحضور والغياب لهذه الشعبة في هذا التاريخ.',
        boxClass:
          'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-800 dark:text-slate-200',
      };
  }
}

export function MonthlyDayDetailModal({
  open,
  student,
  cell,
  gradeName,
  sectionName,
  onClose,
}: MonthlyDayDetailModalProps) {
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open || !student || !cell) return null;

  const statusMeta = getStatusDisplayInfo(cell);
  const holidayInfo = cell.holiday_info;

  const countedLessonsToday = cell.counted_lessons_today ?? (cell.contributed_to_counter ? cell.lessons_count : 0);

  const countedLabel =
    cell.status_kind === 'holiday' ||
    cell.status_kind === 'present' ||
    cell.status_kind === 'unrecorded' ||
    cell.status_kind === 'sick_leave'
      ? 'لا'
      : cell.status_kind === 'lesson_absence' || cell.status_kind === 'lesson_escape'
        ? 'نعم (تُجمع ضمن العداد الموحد لتراكم الدروس)'
        : cell.status_kind === 'lesson_mixed'
          ? countedLessonsToday > 0
            ? `نعم (${countedLessonsToday} درس مضاف للعداد الموحد)`
            : 'لا'
          : cell.status_kind === 'lesson_permission'
            ? cell.counted_as_absence
              ? 'نعم (أُضيفت إلى العداد الموحد)'
              : 'لا'
            : cell.counted_as_absence
              ? 'نعم (تُحتسب يوم غياب كامل)'
              : 'لا';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-[1px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="تفاصيل اليوم في السجل الشهري"
    >
      <div
        className="w-full max-w-xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-900">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display truncate">
              تفاصيل سجل اليوم — عرض إداري
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {student.full_name} • {gradeName} / {sectionName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق النافذة"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Date & Symbol Summary */}
          <div className={`rounded-lg border p-3.5 flex items-start justify-between gap-3 ${statusMeta.boxClass}`}>
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold opacity-90">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {cell.day_name} — <span className="font-mono-tabular">{cell.date}</span>
                </span>
              </div>
              <p className="text-sm font-bold font-display">{statusMeta.title}</p>
              <p className="text-xs opacity-90 leading-relaxed">{statusMeta.subtitle}</p>
            </div>
            <div className="min-w-[52px] min-h-[46px] px-2 py-1 rounded-lg border border-current/25 bg-white/80 dark:bg-slate-950/60 flex flex-col items-center justify-center shrink-0">
              {cell.symbol_top && cell.symbol_bottom ? (
                <>
                  <span className="text-sm font-extrabold text-emerald-700 dark:text-emerald-300 leading-none">
                    {cell.symbol_top}
                  </span>
                  <span className="text-[11px] font-bold font-display tabular-nums leading-tight mt-0.5 whitespace-nowrap">
                    {cell.symbol_bottom}
                  </span>
                </>
              ) : (
                <span className="text-base font-extrabold font-display tabular-nums whitespace-nowrap">
                  {cell.symbol || '—'}
                </span>
              )}
            </div>
          </div>

          {/* Holiday Info Section */}
          {cell.status_kind === 'holiday' && holidayInfo && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3.5 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
                <CalendarOff className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                <span>بيانات العطلة المسجلة</span>
              </div>

              {holidayInfo.matching_holidays.length > 0 && (
                <div className="space-y-2">
                  {holidayInfo.matching_holidays.map((h) => (
                    <div
                      key={h.id}
                      className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {h.name}
                        </span>
                        <span className="text-[11px] font-semibold text-teal-700 dark:text-teal-400 border border-teal-200 dark:border-teal-800 px-1.5 py-0.5 rounded">
                          {HOLIDAY_CATEGORY_LABELS[h.holiday_type]}
                        </span>
                      </div>
                      <p className="text-slate-500 dark:text-slate-400 tabular-nums">
                        من {h.start_date} إلى {h.end_date}
                      </p>
                      {h.notes && (
                        <p className="text-slate-600 dark:text-slate-300">السبب/الملاحظة: {h.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {holidayInfo.is_weekly_holiday && (
                <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5 text-xs flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {holidayInfo.weekly_reason || 'عطلة أسبوعية رسمية'}
                  </span>
                  <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 rounded">
                    عطلة أسبوعية
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Structured Absence / Leave / Permission / Escape Details */}
          {cell.status_kind !== 'holiday' && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x sm:divide-x-reverse divide-slate-200 dark:divide-slate-800">
                <div className="p-3">
                  <p className="text-slate-500 dark:text-slate-400">اسم الطالب</p>
                  <p className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                    {student.full_name}
                  </p>
                </div>
                <div className="p-3">
                  <p className="text-slate-500 dark:text-slate-400">التاريخ واليوم</p>
                  <p className="font-bold text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                    {cell.day_name} — {cell.date}
                  </p>
                </div>
              </div>

              {cell.symbol_top === '✓' && cell.symbol_bottom && (
                <div className="p-3 flex items-center justify-between gap-3 bg-emerald-50/40 dark:bg-emerald-950/15">
                  <span className="text-slate-600 dark:text-slate-300">حالة الدوام اليومي</span>
                  <span className="font-bold text-emerald-700 dark:text-emerald-300">
                    حاضر للدوام (مع تسجيل استثناءات دروس)
                  </span>
                </div>
              )}

              {(cell.lessons_count > 0 || cell.lesson_numbers.length > 0 || cell.lesson_details.length > 0) && (
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5" />
                      إجمالي الدروس المسجلة في هذا اليوم
                    </span>
                    <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                      {cell.lessons_count}
                    </span>
                  </div>

                  {cell.lesson_details.length > 0 ? (
                    <div className="pt-1">
                      <p className="text-slate-500 dark:text-slate-400 mb-1.5">
                        تفاصيل الدروس المحددة حسب نوع الحالة:
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {cell.lesson_details.map((d) => {
                          const meta =
                            LESSON_STATUS_LABELS[d.lesson_status] ?? LESSON_STATUS_LABELS.lesson_absence;
                          return (
                            <span
                              key={d.lesson_number}
                              className={`px-2 py-1 rounded border font-semibold text-[11px] ${meta.chipClass}`}
                            >
                              {getLessonName(d.lesson_number)} · {meta.label}
                              {d.lesson_status === 'lesson_permission'
                                ? d.counted_as_absence === 1
                                  ? ' (محتسبة في العداد)'
                                  : ' (غير محتسبة غياباً)'
                                : ''}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    cell.lesson_numbers.length > 0 && (
                      <div className="pt-1">
                        <p className="text-slate-500 dark:text-slate-400 mb-1.5">
                          أرقام الدروس المحددة:
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {cell.lesson_numbers.map((num) => (
                            <span
                              key={num}
                              className="px-2 py-1 rounded border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-200 font-semibold text-[11px]"
                            >
                              {getLessonName(num)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}

              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500 dark:text-slate-400">
                    هل الحالة محسوبة ضمن الغياب؟
                  </span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">{countedLabel}</span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500 dark:text-slate-400">
                    هل ساهمت في العداد الموحد لتراكم الدروس؟
                  </span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {cell.contributed_to_counter ? `نعم (+${countedLessonsToday} درس)` : 'لا'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500 dark:text-slate-400">
                    هل نتج عنها احتساب يوم غياب كامل؟
                  </span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {cell.generated_converted_day
                      ? `نعم (${cell.converted_days_count} يوم من تراكم ${cell.threshold_used ?? ''} دروس)`
                      : cell.status_kind === 'full_day' ||
                          (cell.status_kind === 'daily_permission' && cell.counted_as_absence)
                        ? 'نعم (يوم غياب كامل مباشر)'
                        : 'لا'}
                  </span>
                </div>
              </div>

              {cell.generated_converted_day && cell.contributing_lessons.length > 0 && (
                <div className="p-3 space-y-1.5 bg-purple-50/40 dark:bg-purple-950/15">
                  <p className="text-purple-900 dark:text-purple-200 font-bold">
                    الدروس التي كوّنت يوم الغياب المتراكم:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {cell.contributing_lessons.map((item, idx) => {
                      const meta =
                        LESSON_STATUS_LABELS[item.lesson_status] ?? LESSON_STATUS_LABELS.lesson_absence;
                      return (
                        <span
                          key={`${item.absence_id}-${item.lesson_number ?? idx}-${idx}`}
                          className={`px-2 py-1 rounded border text-[11px] font-semibold tabular-nums ${meta.chipClass}`}
                        >
                          {item.absence_date} ·{' '}
                          {item.lesson_number ? getLessonName(item.lesson_number) : 'درس'} ({meta.label})
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="p-3 space-y-1">
                <p className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  الملاحظات أو سبب الإجازة / الرخصة / الهروب
                </p>
                <p className="font-medium text-slate-900 dark:text-slate-100 leading-relaxed">
                  {cell.notes ? cell.notes : 'لا توجد ملاحظة مسجلة لهذا اليوم.'}
                </p>
              </div>
            </div>
          )}

          {/* Read-only notice */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 px-3.5 py-2.5 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <Info className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
            <span>
              السجل الشهري للعرض والمراجعة الإدارية فقط. لتعديل الحضور أو الغياب يُرجى استخدام قسم
              «تسجيل الغيابات».
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors"
          >
            <CheckCircle2 className="w-4 h-4" />
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
