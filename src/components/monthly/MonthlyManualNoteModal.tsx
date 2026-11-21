import { Save, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { MonthlyStudentRow } from '../../types/school';

interface MonthlyManualNoteModalProps {
  open: boolean;
  student: MonthlyStudentRow | null;
  monthName: string;
  year: number;
  saving: boolean;
  onSave: (noteText: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}

export function MonthlyManualNoteModal({
  open,
  student,
  monthName,
  year,
  saving,
  onSave,
  onDelete,
  onClose,
}: MonthlyManualNoteModalProps) {
  const [noteText, setNoteText] = useState('');

  useEffect(() => {
    if (open && student) {
      setNoteText(student.manual_note ?? '');
    }
  }, [open, student]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, saving, onClose]);

  if (!open || !student) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSave(noteText);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-[1px]"
      onClick={() => !saving && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="الملاحظة الإدارية اليدوية للطالب"
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-900">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display truncate">
              ملاحظة الإدارة الشهرية للطالب
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {student.full_name} — {monthName} {year}
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            aria-label="إغلاق"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors shrink-0 disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {student.auto_notes.length > 0 && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3 space-y-1.5">
              <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                الملاحظات التلقائية المحفوظة (لا تتأثر بالتعديل اليدوي):
              </p>
              <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300 list-disc list-inside">
                {student.auto_notes.map((note, idx) => (
                  <li key={idx} className="leading-relaxed">
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <label
              htmlFor="manual-monthly-note"
              className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5"
            >
              نص الملاحظة الإدارية اليدوية (اختياري)
            </label>
            <textarea
              id="manual-monthly-note"
              rows={4}
              maxLength={500}
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="مثال: تم توجيه إنذار أول لولي الأمر بتاريخ 2026-03-18 / مراجعة المرشد التربوي..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-600"
            />
            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
              <span>تظهر هذه الملاحظة في السجل والطباعة وتصدير Excel.</span>
              <span>{noteText.length} / 500</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div>
              {student.manual_note && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void onDelete()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-xs font-semibold hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  حذف الملاحظة اليدوية
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={onClose}
                className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold transition-colors disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'جاري الحفظ...' : 'حفظ الملاحظة'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
