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
        title: 'يوم غياب كامل ناتج عن تراكم الدروس (ج)',
        subtitle: cell.raw_status === 'lesson_permission'
          ? 'اكتمل نصاب الغياب في هذا اليوم بسبب رخصة عن درس محسوبة في العداد.'
          : 'اكتمل نصاب الغياب في هذا اليوم بسبب غياب عن درس / دروس.',
        boxClass:
          'border-purple-200 dark:border-purple-900/60 bg-purple-50/70 dark:bg-purple-950/30 text-purple-900 dark:text-purple-200',
      };
    case 'lesson_absence':
      return {
        title: 'غائب عن درس / عدة دروس',
        subtitle: 'حضر الطالب إلى المدرسة وغاب عن دروس محددة أُضيفت إلى عداد الدروس.',
        boxClass:
          'border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200',
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
        title: 'رخصة عن درس / دروس (ح)',
        subtitle: cell.contributed_to_counter
          ? 'رخصة لدرس محدد وأُضيفت دروسها إلى عداد تراكم الدروس.'
          : 'رخصة لدرس محدد ولم تُضف إلى عداد تراكم الدروس.',
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
    default:
      return {
        title: cell.outside_section_membership
          ? 'خارج فترة انتماء الطالب للشعبة'
          : 'حاضر / لا يوجد غياب',
        subtitle: cell.outside_section_membership
          ? 'لم يكن الطالب مسجلاً ضمن هذه الشعبة في هذا التاريخ.'
          : 'لا توجد أي حالة غياب أو إجازة أو رخصة مسجلة للطالب في هذا التاريخ.',
        boxClass:
          'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-200',
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

  const countedLabel =
    cell.status_kind === 'holiday' || cell.status_kind === 'present' || cell.status_kind === 'sick_leave'
      ? 'لا'
      : cell.status_kind === 'lesson_absence'
        ? 'نعم (تُجمع ضمن عداد تراكم الدروس)'
        : cell.status_kind === 'lesson_permission'
          ? cell.counted_as_absence
            ? 'نعم (أُضيفت إلى عداد الدروس المتراكمة)'
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
            <div className="w-11 h-11 rounded-lg border border-current/25 bg-white/80 dark:bg-slate-950/60 flex items-center justify-center shrink-0">
              <span className="text-lg font-extrabold font-display tabular-nums">
                {cell.symbol}
              </span>
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

          {/* Structured Absence / Leave / Permission Details */}
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

              {(cell.lessons_count > 0 || cell.lesson_numbers.length > 0) && (
                <div className="p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5" />
                      عدد الدروس المسجلة
                    </span>
                    <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                      {cell.lessons_count}
                    </span>
                  </div>
                  {cell.lesson_numbers.length > 0 && (
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
                    هل ساهمت في عداد تراكم الدروس؟
                  </span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {cell.contributed_to_counter ? `نعم (+${cell.lessons_count} درس)` : 'لا'}
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

              <div className="p-3 space-y-1">
                <p className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  الملاحظات أو سبب الإجازة / الرخصة
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
