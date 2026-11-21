import { Calendar, History, User, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { StudentEnrollmentHistoryItem, StudentRecord } from '../../types/school';
import { schoolService } from '../../services/schoolService';

interface StudentHistoryModalProps {
  open: boolean;
  student: StudentRecord | null;
  onClose: () => void;
}

export function StudentHistoryModal({ open, student, onClose }: StudentHistoryModalProps) {
  const [history, setHistory] = useState<StudentEnrollmentHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !student) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    schoolService
      .getStudentHistory(student.id)
      .then((items) => {
        if (!cancelled) setHistory(items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'تعذر تحميل السجل.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, student]);

  if (!open || !student) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/50 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden max-h-[90dvh] flex flex-col">
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 overflow-hidden flex items-center justify-center shrink-0">
              {student.photo_data ? (
                <img
                  src={student.photo_data}
                  alt={student.full_name}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <User className="w-5 h-5 text-slate-400" />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 font-display truncate">
                {student.full_name}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2">
                <span className="font-mono-tabular">المعرف: {student.student_uid}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">
                  رقم القيد: {student.registry_number ?? 'غير مدخل'}
                </span>
                {student.birth_date && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">الميلاد: {student.birth_date}</span>
                  </>
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-200">
            <History className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
            <span>السجل التاريخي للتسجيل والتنقلات الدراسية</span>
          </div>

          {loading ? (
            <div className="py-8 text-center text-sm text-slate-500">جاري تحميل السجل...</div>
          ) : error ? (
            <div className="py-6 text-center text-sm text-red-600 dark:text-red-400">{error}</div>
          ) : history.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-500">
              لا توجد قيود تسجيل مسجلة لهذا الطالب.
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
              <table className="w-full text-sm text-right">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold whitespace-nowrap">السنة الدراسية</th>
                    <th className="py-2.5 px-4 font-semibold whitespace-nowrap">الصف والشعبة</th>
                    <th className="py-2.5 px-4 font-semibold whitespace-nowrap">تاريخ التسجيل</th>
                    <th className="py-2.5 px-4 font-semibold whitespace-nowrap">الحالة / الملاحظة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {history.map((item) => (
                    <tr key={item.id}>
                      <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                        {item.academic_year_name}
                      </td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {item.grade_name} · شعبة {item.section_name}
                      </td>
                      <td className="py-3 px-4 text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          {item.enrollment_date}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs whitespace-nowrap">
                        {item.is_current ? (
                          <span className="font-semibold text-teal-700 dark:text-teal-400">
                            التسجيل الحالي الفعال
                          </span>
                        ) : (
                          <span className="text-slate-500 dark:text-slate-400">
                            سجل سابق {item.ended_at ? `(انتهى في ${item.ended_at.slice(0, 10)})` : ''}
                          </span>
                        )}
                        {item.transfer_reason && (
                          <p className="text-slate-500 dark:text-slate-400 mt-0.5 whitespace-normal">
                            السبب: {item.transfer_reason}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="px-4 sm:px-6 py-3.5 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-800 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
