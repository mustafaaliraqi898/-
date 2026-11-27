import {
  ArrowLeftRight,
  BookOpen,
  Calendar,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileText,
  Info,
  Pencil,
  Plus,
  ShieldAlert,
  UserCheck,
  X,
} from 'lucide-react';
import { useEffect } from 'react';
import type { MonthlyNoteCategory, MonthlyStudentRow } from '../../types/school';
import { useNumberDisplay } from '../../contexts/NumberDisplayContext';
import { BidiText, LtrSpan } from '../common/BidirectionalText';

interface MonthlyStudentNotesModalProps {
  open: boolean;
  student: MonthlyStudentRow | null;
  gradeName: string;
  sectionName: string;
  monthName: string;
  year: number;
  onEditManualNote: (student: MonthlyStudentRow) => void;
  onClose: () => void;
}

const CATEGORY_META: Record<
  MonthlyNoteCategory,
  {
    label: string;
    badgeClass: string;
    borderClass: string;
  }
> = {
  lesson_escape: {
    label: 'هروب من درس',
    badgeClass:
      'border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/50 text-orange-800 dark:text-orange-200',
    borderClass: 'border-r-orange-500',
  },
  lesson_absence: {
    label: 'غياب عن درس',
    badgeClass:
      'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200',
    borderClass: 'border-r-amber-500',
  },
  lesson_permission: {
    label: 'رخصة درس',
    badgeClass:
      'border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-200',
    borderClass: 'border-r-indigo-500',
  },
  lesson_converted: {
    label: 'يوم متراكم',
    badgeClass:
      'border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/50 text-purple-800 dark:text-purple-200',
    borderClass: 'border-r-purple-500',
  },
  full_day: {
    label: 'غياب يوم كامل',
    badgeClass:
      'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-200',
    borderClass: 'border-r-red-600',
  },
  daily_permission: {
    label: 'رخصة يومية',
    badgeClass:
      'border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-200',
    borderClass: 'border-r-sky-500',
  },
  sick_leave: {
    label: 'إجازة مرضية',
    badgeClass:
      'border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-200',
    borderClass: 'border-r-teal-500',
  },
  transfer: {
    label: 'نقل طالب',
    badgeClass:
      'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200',
    borderClass: 'border-r-slate-500',
  },
};

function renderCategoryIcon(category: MonthlyNoteCategory) {
  switch (category) {
    case 'lesson_escape':
      return <ShieldAlert className="w-3.5 h-3.5 shrink-0" />;
    case 'lesson_absence':
      return <BookOpen className="w-3.5 h-3.5 shrink-0" />;
    case 'lesson_permission':
    case 'daily_permission':
      return <CalendarCheck className="w-3.5 h-3.5 shrink-0" />;
    case 'lesson_converted':
      return <ClipboardList className="w-3.5 h-3.5 shrink-0" />;
    case 'full_day':
      return <Calendar className="w-3.5 h-3.5 shrink-0" />;
    case 'sick_leave':
      return <UserCheck className="w-3.5 h-3.5 shrink-0" />;
    case 'transfer':
      return <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" />;
  }
}

export function MonthlyStudentNotesModal({
  open,
  student,
  gradeName,
  sectionName,
  monthName,
  year,
  onEditManualNote,
  onClose,
}: MonthlyStudentNotesModalProps) {
  const { count, dateDMY, plain } = useNumberDisplay();

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open || !student) return null;

  const sortedItems = [...(student.auto_note_items ?? [])].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-[1px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="تفاصيل ملاحظات الطالب"
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-900 shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display truncate">
              تفاصيل ملاحظات وسجلات الطالب
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {plain(student.original_order)}. {student.full_name} •{' '}
              <BidiText text={`${gradeName} / ${sectionName}`} /> • شهر {monthName}{' '}
              <LtrSpan>{plain(year)}</LtrSpan>
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

        {/* Scrollable Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Numeric Summary Box (Actual Records Only) */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 p-3.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                الملخص العددي من السجلات الفعلية
              </span>
              <span className="text-[11px] font-semibold text-red-700 dark:text-red-300 tabular-nums">
                مجموع الغياب المحتسب: <LtrSpan>{count(student.total_counted_absence_days)}</LtrSpan> يوم
              </span>
            </div>

            <p className="text-xs font-bold text-slate-900 dark:text-slate-100 tabular-nums">
              {student.compact_notes_summary ? (
                <BidiText text={student.compact_notes_summary} />
              ) : (
                'لا توجد حالات غياب أو رخص أو هروب مسجلة لهذا الطالب في هذا الشهر.'
              )}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px] tabular-nums">
              <div className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5">
                <span className="text-slate-500 dark:text-slate-400">هروب من درس:</span>{' '}
                <strong className="text-orange-700 dark:text-orange-300">
                  {count(student.lesson_escape_lessons)}
                </strong>
              </div>
              <div className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5">
                <span className="text-slate-500 dark:text-slate-400">رخص الدروس:</span>{' '}
                <strong className="text-indigo-700 dark:text-indigo-300">
                  {count(
                    student.counted_lesson_permission_lessons +
                      student.uncounted_lesson_permission_lessons
                  )}
                </strong>
              </div>
              <div className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5">
                <span className="text-slate-500 dark:text-slate-400">غياب الدروس:</span>{' '}
                <strong className="text-amber-700 dark:text-amber-300">
                  {count(student.lesson_absence_lessons)}
                </strong>
              </div>
              <div className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5">
                <span className="text-slate-500 dark:text-slate-400">غياب مباشر:</span>{' '}
                <strong className="text-red-700 dark:text-red-300">
                  {count(student.direct_full_days)}
                </strong>
              </div>
            </div>
          </div>

          {/* Separate Manual Note Block with Action Button */}
          <div className="rounded-lg border border-teal-200 dark:border-teal-900/60 bg-teal-50/50 dark:bg-teal-950/25 p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-teal-900 dark:text-teal-200">
                <FileText className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                <span>الملاحظة الإدارية اليدوية (مستقلة عن أعداد الغياب)</span>
              </div>

              <button
                type="button"
                onClick={() => onEditManualNote(student)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold transition-colors"
              >
                {student.manual_note ? (
                  <>
                    <Pencil className="w-3.5 h-3.5" />
                    تعديل الملاحظة اليدوية
                  </>
                ) : (
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    إضافة ملاحظة يدوية
                  </>
                )}
              </button>
            </div>

            {student.manual_note ? (
              <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed bg-white/80 dark:bg-slate-900/80 border border-teal-200/80 dark:border-teal-800/60 rounded-md p-2.5">
                {student.manual_note}
              </p>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                لا توجد ملاحظة إدارية يدوية مسجلة لهذا الطالب في هذا الشهر.
              </p>
            )}
          </div>

          {/* Chronological Notes List Sorted by Date */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                جميع الملاحظات والسجلات مرتبة حسب التاريخ
              </h4>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                {count(sortedItems.length)} سجل
              </span>
            </div>

            {sortedItems.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                لا توجد ملاحظات تفصيلية مسجلة في هذا الشهر.
              </div>
            ) : (
              <div className="space-y-2">
                {sortedItems.map((item, idx) => {
                  const meta = CATEGORY_META[item.category] ?? CATEGORY_META.lesson_absence;
                  return (
                    <div
                      key={`${item.date}-${item.category}-${idx}`}
                      className={`rounded-lg border border-slate-200 dark:border-slate-800 border-r-4 ${meta.borderClass} bg-white dark:bg-slate-950/50 p-3 space-y-1.5`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-bold ${meta.badgeClass}`}
                          >
                            {renderCategoryIcon(item.category)}
                            {meta.label}
                          </span>
                          <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 font-mono-tabular">
                            <LtrSpan>{dateDMY(item.date)}</LtrSpan>
                          </span>
                        </div>

                        {typeof item.counted_as_absence === 'boolean' && (
                          <span
                            className={`text-[10.5px] font-semibold px-2 py-0.5 rounded ${
                              item.counted_as_absence
                                ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {item.counted_as_absence ? 'محتسب' : 'غير محتسب'}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed">
                        <BidiText text={item.text} />
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 px-3.5 py-2.5 flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
            <Info className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
            <span>
              الملاحظة اليدوية تُعرض بشكل منفصل ولا تؤثر على حساب أعداد الغياب أو الرخص أو الهروب.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 flex justify-end shrink-0">
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
