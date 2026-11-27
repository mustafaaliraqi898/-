import { ArrowLeftRight, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNumberDisplay } from '../../contexts/NumberDisplayContext';
import { schoolService } from '../../services/schoolService';
import type { AcademicYear, GradeWithSections, StudentRecord } from '../../types/school';
import { BidiText, LtrSpan } from '../common/BidirectionalText';

interface TransferStudentModalProps {
  open: boolean;
  student: StudentRecord | null;
  grades: GradeWithSections[];
  academicYears: AcademicYear[];
  selectedYearId: number | null;
  onClose: () => void;
  onSuccess: (message: string) => Promise<void>;
  onError: (message: string) => void;
}

export function TransferStudentModal({
  open,
  student,
  grades,
  academicYears,
  selectedYearId,
  onClose,
  onSuccess,
  onError,
}: TransferStudentModalProps) {
  const { academicYear } = useNumberDisplay();
  const [targetYearId, setTargetYearId] = useState<number | ''>('');
  const [targetGradeId, setTargetGradeId] = useState<number | ''>('');
  const [targetSectionId, setTargetSectionId] = useState<number | ''>('');
  const [transferReason, setTransferReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !student) return;

    setTargetYearId(selectedYearId ?? student.academic_year_id ?? '');
    const currentGrade = grades.find((g) => g.id === student.grade_id) ?? grades[0];
    setTargetGradeId(currentGrade ? currentGrade.id : '');
    if (currentGrade) {
      const otherSection =
        currentGrade.sections.find((s) => s.id !== student.section_id) ?? currentGrade.sections[0];
      setTargetSectionId(otherSection ? otherSection.id : '');
    } else {
      setTargetSectionId('');
    }
    setTransferReason('');
  }, [open, student, grades, selectedYearId]);

  if (!open || !student) return null;

  const selectedGradeObj = grades.find((g) => g.id === Number(targetGradeId));
  const availableSections = selectedGradeObj?.sections ?? [];

  function handleGradeChange(newGradeStr: string) {
    const gId = Number(newGradeStr);
    setTargetGradeId(gId || '');
    const gObj = grades.find((g) => g.id === gId);
    setTargetSectionId(gObj && gObj.sections.length > 0 ? gObj.sections[0].id : '');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!student) return;
    if (!targetGradeId || !targetSectionId) {
      onError('يرجى تحديد الصف والشعبة الهدف.');
      return;
    }

    setSubmitting(true);
    try {
      await schoolService.transferStudent(student.id, {
        grade_id: Number(targetGradeId),
        section_id: Number(targetSectionId),
        academic_year_id: targetYearId ? Number(targetYearId) : undefined,
        transfer_reason: transferReason.trim() || null,
      });
      await onSuccess(`تم نقل الطالب "${student.full_name}" بنجاح مع الاحتفاظ بسجلاته السابقة.`);
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'تعذر نقل الطالب.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/55 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="transfer-student-modal-title"
    >
      <div className="w-full max-w-lg max-h-[90dvh] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden flex flex-col">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="p-2 rounded-xl bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-400 shrink-0">
              <ArrowLeftRight className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h3
                id="transfer-student-modal-title"
                className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 font-display truncate"
              >
                نقل طالب بين الصفوف أو الشعب
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                {student.full_name} · <LtrSpan>{student.student_uid}</LtrSpan>
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

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
            <div className="rounded-xl border border-teal-200/80 dark:border-teal-800/60 bg-teal-50/60 dark:bg-teal-950/25 px-3.5 sm:px-4 py-3 text-xs text-slate-700 dark:text-slate-200 space-y-1 leading-relaxed">
              <p>
                <span className="font-bold text-teal-900 dark:text-teal-300">
                  الموضع الحالي:
                </span>{' '}
                <BidiText text={`${student.grade_name ?? '—'} · شعبة ${student.section_name ?? '—'}`} />{' '}
                (
                {student.academic_year_name ? (
                  <LtrSpan>{academicYear(student.academic_year_name)}</LtrSpan>
                ) : (
                  '—'
                )}
                )
              </p>
              <p className="text-slate-600 dark:text-slate-400">
                ملاحظة: يحفظ النظام ملف الطالب ومعرفه ورقم قيده وكافة سجلات غيابه السابقة دون حذف أو
                تكرار.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                السنة الدراسية
              </label>
              <select
                value={targetYearId}
                onChange={(e) => setTargetYearId(Number(e.target.value) || '')}
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 tabular-nums min-h-[42px]"
              >
                {academicYears.map((yr) => (
                  <option key={yr.id} value={yr.id}>
                    {academicYear(yr.name)}
                    {yr.is_active ? ' (الفعالة)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  الصف الجديد <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={targetGradeId}
                  onChange={(e) => handleGradeChange(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 min-h-[42px]"
                >
                  <option value="">اختر الصف...</option>
                  {grades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  الشعبة الجديدة <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={targetSectionId}
                  onChange={(e) => setTargetSectionId(Number(e.target.value) || '')}
                  disabled={availableSections.length === 0}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 disabled:opacity-50 min-h-[42px]"
                >
                  {availableSections.length === 0 ? (
                    <option value="">لا توجد شعب</option>
                  ) : (
                    availableSections.map((s) => (
                      <option key={s.id} value={s.id}>
                        شعبة {s.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                سبب النقل / ملاحظة إدارية (اختياري)
              </label>
              <input
                type="text"
                value={transferReason}
                onChange={(e) => setTransferReason(e.target.value)}
                placeholder="مثال: موازنة أعداد الشعب أو ترفيع للعام الجديد"
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 min-h-[42px]"
              />
            </div>
          </div>

          <div className="px-4 sm:px-6 py-3.5 bg-slate-50/80 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-end gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors min-h-[40px]"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-sm font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors disabled:opacity-60 min-h-[40px]"
            >
              {submitting ? 'جاري النقل...' : 'تأكيد النقل'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
