import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Pencil,
  Printer,
  ShieldAlert,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { schoolService } from '../../services/schoolService';
import type {
  LegalProcedureType,
  LegalStageRegulation,
  ReportsCenterStudentRow,
  StudentLegalProcedureRecord,
} from '../../types/school';
import { canIssueOfficialLetter, PROCEDURE_LABELS_MAP } from './LegalPrintSheet';

interface StudentProcedureModalProps {
  open: boolean;
  student: ReportsCenterStudentRow | null;
  academicYearId: number;
  regulation: LegalStageRegulation | null;
  defaultProcedureType?: LegalProcedureType;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onOpenLetterPrint: (
    kind: 'warning_letter' | 'summons_letter',
    student: ReportsCenterStudentRow
  ) => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

const PROCEDURE_OPTIONS: Array<{ value: LegalProcedureType; label: string }> = [
  { value: 'preliminary_warning', label: 'تحذير أولي' },
  { value: 'first_warning', label: 'إنذار أول' },
  { value: 'final_warning', label: 'إنذار نهائي' },
  { value: 'effective_limit_notice', label: 'إشعار بلوغ حد الغياب المؤثر' },
  { value: 'guardian_notification', label: 'تبليغ ولي أمر' },
  { value: 'guardian_summons', label: 'استدعاء ولي أمر' },
];

const DELIVERY_OPTIONS = [
  'تسليم باليد لولي الأمر',
  'اتصال هاتفي / رسالة رسمية',
  'بواسطة الطالب مع توقيع ولي الأمر',
  'حضور مباشر في الإدارة',
];

export function StudentProcedureModal({
  open,
  student,
  academicYearId,
  regulation,
  defaultProcedureType = 'guardian_notification',
  onClose,
  onSaved,
  onOpenLetterPrint,
  onNotify,
}: StudentProcedureModalProps) {
  const [procedureType, setProcedureType] = useState<LegalProcedureType>(defaultProcedureType);
  const [procedureDate, setProcedureDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [deliveryMethod, setDeliveryMethod] = useState(DELIVERY_OPTIONS[0]);
  const [summonsResult, setSummonsResult] = useState('');
  const [recordedBy, setRecordedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [isOfficialIssue, setIsOfficialIssue] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Inline edit state for existing procedure
  const [editingProcId, setEditingProcId] = useState<number | null>(null);
  const [editSummonsResult, setEditSummonsResult] = useState('');
  const [editDeliveryMethod, setEditDeliveryMethod] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setProcedureType(defaultProcedureType);
      setProcedureDate(new Date().toISOString().slice(0, 10));
      setDeliveryMethod(DELIVERY_OPTIONS[0]);
      setSummonsResult('');
      setNotes('');
      setOverrideReason('');
      setIsOfficialIssue(false);
      setEditingProcId(null);
    }
  }, [open, defaultProcedureType, student?.student_id]);

  const officialAllowed = useMemo(() => canIssueOfficialLetter(regulation), [regulation]);

  const alreadyIssuedSameWarning = useMemo(() => {
    if (!student) return null;
    if (
      procedureType === 'guardian_notification' ||
      procedureType === 'guardian_summons'
    ) {
      return null;
    }
    return student.procedures.find((p) => p.procedure_type === procedureType) ?? null;
  }, [student, procedureType]);

  if (!open || !student) return null;

  async function handleCreateProcedure(e: FormEvent) {
    e.preventDefault();
    if (!student) return;

    if (alreadyIssuedSameWarning && !overrideReason.trim()) {
      onNotify(
        'error',
        `تم إصدار "${PROCEDURE_LABELS_MAP[procedureType]}" مسبقاً لهذا الطالب في نفس السنة الدراسية. يرجى توثيق سبب التجاوز الإداري أولاً.`
      );
      return;
    }

    if (isOfficialIssue && !officialAllowed) {
      onNotify(
        'error',
        'لا يمكن تسجيل إصدار رسمي نهائي قبل اعتماد الضابطة القانونية للمرحلة وتوثيق رقم القرار.'
      );
      return;
    }

    setSubmitting(true);
    try {
      await schoolService.createStudentLegalProcedure({
        student_id: student.student_id,
        academic_year_id: academicYearId,
        procedure_type: procedureType,
        procedure_date: procedureDate,
        delivery_method: deliveryMethod.trim() || null,
        summons_result: summonsResult.trim() || null,
        recorded_by: recordedBy.trim() || null,
        notes: notes.trim() || null,
        override_reason: overrideReason.trim() || null,
        is_official_legal_issue: isOfficialIssue,
      });
      onNotify('success', `تم تسجيل "${PROCEDURE_LABELS_MAP[procedureType]}" للطالب ${student.full_name}.`);
      setSummonsResult('');
      setNotes('');
      setOverrideReason('');
      await onSaved();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر تسجيل الإجراء الإداري.');
    } finally {
      setSubmitting(false);
    }
  }

  function startEditProcedure(proc: StudentLegalProcedureRecord) {
    setEditingProcId(proc.id);
    setEditSummonsResult(proc.summons_result ?? '');
    setEditDeliveryMethod(proc.delivery_method ?? '');
    setEditNotes(proc.notes ?? '');
  }

  async function handleUpdateProcedure(procId: number) {
    setUpdatingId(procId);
    try {
      await schoolService.updateStudentLegalProcedure(procId, {
        summons_result: editSummonsResult.trim() || null,
        delivery_method: editDeliveryMethod.trim() || null,
        notes: editNotes.trim() || null,
      });
      onNotify('success', 'تم تحديث بيانات الإجراء بنجاح.');
      setEditingProcId(null);
      await onSaved();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر تحديث الإجراء.');
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleDeleteProcedure(procId: number) {
    setUpdatingId(procId);
    try {
      await schoolService.deleteStudentLegalProcedure(procId);
      onNotify('success', 'تم حذف سجل الإجراء من تاريخ الطالب.');
      await onSaved();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر حذف سجل الإجراء.');
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label={`ملف الإجراءات القانونية — ${student.full_name}`}
    >
      <div className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
              ملف الغياب والإجراءات القانونية — {student.full_name}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
              {student.grade_name} / {student.section_name} · {student.stage_name ?? 'مرحلة غير محددة'}
              {student.registry_number ? ` · رقم القيد: ${student.registry_number}` : ''}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onOpenLetterPrint('warning_letter', student)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <Printer className="w-3.5 h-3.5 text-amber-600" />
              طباعة إنذار
            </button>

            <button
              type="button"
              onClick={() => onOpenLetterPrint('summons_letter', student)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <Printer className="w-3.5 h-3.5 text-sky-600" />
              طباعة استدعاء
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="إغلاق"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-200/70 dark:hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {/* Live Absence Breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs tabular-nums">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">الغياب المحتسب</span>
              <p className="text-lg font-extrabold text-red-700 dark:text-red-400 mt-0.5">
                {student.counted_legal_absence_days} يوم
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">غياب دون عذر</span>
              <p className="text-lg font-extrabold text-slate-900 dark:text-slate-100 mt-0.5">
                {student.unexcused_absence_days} يوم
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">أيام تراكم الدروس</span>
              <p className="text-lg font-extrabold text-purple-700 dark:text-purple-400 mt-0.5">
                {student.converted_lesson_days} ({student.pending_lessons} م)
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">غياب بعذر (مرضي/رخص)</span>
              <p className="text-lg font-extrabold text-teal-700 dark:text-teal-400 mt-0.5">
                {student.excused_absence_days} يوم
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">المتبقي للحد التالي</span>
              <p className="text-lg font-extrabold text-amber-700 dark:text-amber-400 mt-0.5">
                {student.remaining_days_to_next_threshold !== null
                  ? `${student.remaining_days_to_next_threshold} يوم`
                  : '—'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">خصم المواظبة</span>
              <p
                className={`text-lg font-extrabold mt-0.5 ${
                  student.conduct_failure_triggered
                    ? 'text-red-700 dark:text-red-400'
                    : 'text-slate-900 dark:text-slate-100'
                }`}
              >
                {student.attendance_score_deducted} درجة
              </p>
            </div>
          </div>

          {student.conduct_failure_triggered && (
            <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 flex items-center gap-2 text-xs text-red-900 dark:text-red-200 font-semibold">
              <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
              <span>
                تنبيه: بلغ خصم درجات المواظبة ({student.attendance_score_deducted} درجة) حد الرسوب
                المعتمد في ضوابط المرحلة ({regulation?.conduct_failure_threshold ?? 51} درجة).
              </span>
            </div>
          )}

          {/* Create Procedure Form */}
          <form
            onSubmit={handleCreateProcedure}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 p-4 space-y-4"
          >
            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-teal-700 dark:text-teal-400" />
              تسجيل إجراء / إنذار / تبليغ أو استدعاء ولي أمر
            </h4>

            {alreadyIssuedSameWarning && (
              <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-950 dark:text-amber-200 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p>
                    تم تسجيل «{PROCEDURE_LABELS_MAP[procedureType]}» مسبقاً لهذا الطالب بتاريخ{' '}
                    <span className="tabular-nums font-bold">
                      {alreadyIssuedSameWarning.procedure_date}
                    </span>
                    . يمنع النظام تكرار نفس الإنذار في نفس السنة الدراسية إلا عند توثيق سبب إداري صريح.
                  </p>
                </div>
                <input
                  type="text"
                  required
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="أدخل السبب الإداري المبرر لإعادة إصدار هذا الإنذار..."
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  نوع الإجراء <span className="text-red-500">*</span>
                </label>
                <select
                  value={procedureType}
                  onChange={(e) => setProcedureType(e.target.value as LegalProcedureType)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                >
                  {PROCEDURE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  تاريخ الإجراء <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={procedureDate}
                  onChange={(e) => setProcedureDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  وسيلة التبليغ / التسليم
                </label>
                <select
                  value={deliveryMethod}
                  onChange={(e) => setDeliveryMethod(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                >
                  {DELIVERY_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  اسم الموثق / المرشد / المعاون
                </label>
                <input
                  type="text"
                  value={recordedBy}
                  onChange={(e) => setRecordedBy(e.target.value)}
                  placeholder="اختياري"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  نتيجة الاستدعاء / استجابة ولي الأمر
                </label>
                <input
                  type="text"
                  value={summonsResult}
                  onChange={(e) => setSummonsResult(e.target.value)}
                  placeholder="مثال: حضر ولي الأمر ووقّع تعهداً خطياً / لم يحضر بعد"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  ملاحظات إضافية
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="أي تفاصيل أو تعهدات إضافية..."
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <label className="inline-flex items-start gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  disabled={!officialAllowed}
                  checked={isOfficialIssue}
                  onChange={(e) => setIsOfficialIssue(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-emerald-700 disabled:opacity-40"
                />
                <span className={!officialAllowed ? 'text-slate-400' : 'text-slate-800 dark:text-slate-200'}>
                  إصدار بصيغة قانونية رسمية معتمدة
                  {!officialAllowed && ' (معطل — الضابطة القانونية للمرحلة غير معتمدة بعد)'}
                </span>
              </label>

              <button
                type="submit"
                disabled={submitting || !student.stage}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{submitting ? 'جاري التسجيل...' : 'توثيق الإجراء في السجل'}</span>
              </button>
            </div>
          </form>

          {/* Historical Timeline */}
          <div className="space-y-2.5">
            <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-600 dark:text-slate-300" />
              سجل الإجراءات السابقة للطالب في هذه السنة ({student.procedures.length})
            </h4>

            {student.procedures.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                لم يتم تسجيل أي إنذارات أو تبليغات أو استدعاءات لهذا الطالب خلال هذه السنة الدراسية بعد.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                {student.procedures.map((proc) => (
                  <div key={proc.id} className="p-3.5 bg-white dark:bg-slate-900 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {PROCEDURE_LABELS_MAP[proc.procedure_type]}
                        </span>
                        <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 tabular-nums">
                          <Calendar className="w-3 h-3" />
                          {proc.procedure_date}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                          · الغياب وقتها: <strong>{proc.absence_days_at_action}</strong> يوم
                        </span>
                        {proc.is_official_legal_issue === 1 ? (
                          <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                            · إجراء قانوني معتمد
                          </span>
                        ) : (
                          <span className="text-amber-700 dark:text-amber-400 font-semibold">
                            · إجراء/مسودة إدارية
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => startEditProcedure(proc)}
                          className="p-1 rounded text-slate-500 hover:text-teal-700 hover:bg-teal-50 dark:hover:bg-teal-950/40"
                          title="تعديل النتيجة / الملاحظات"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={updatingId === proc.id}
                          onClick={() => handleDeleteProcedure(proc.id)}
                          className="p-1 rounded text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
                          title="حذف السجل"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {editingProcId === proc.id ? (
                      <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <input
                            type="text"
                            value={editDeliveryMethod}
                            onChange={(e) => setEditDeliveryMethod(e.target.value)}
                            placeholder="وسيلة التبليغ"
                            className="px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                          />
                          <input
                            type="text"
                            value={editSummonsResult}
                            onChange={(e) => setEditSummonsResult(e.target.value)}
                            placeholder="نتيجة الاستدعاء / الاستجابة"
                            className="px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                          />
                          <input
                            type="text"
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.target.value)}
                            placeholder="ملاحظات"
                            className="px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                          />
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingProcId(null)}
                            className="px-3 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs"
                          >
                            إلغاء
                          </button>
                          <button
                            type="button"
                            disabled={updatingId === proc.id}
                            onClick={() => handleUpdateProcedure(proc.id)}
                            className="px-3 py-1 rounded bg-teal-700 text-white text-xs font-semibold"
                          >
                            حفظ التحديث
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-600 dark:text-slate-300 space-y-0.5">
                        {proc.delivery_method && <p>وسيلة التبليغ: {proc.delivery_method}</p>}
                        {proc.summons_result && (
                          <p className="text-slate-800 dark:text-slate-100 font-semibold flex items-center gap-1">
                            <UserCheck className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                            نتيجة المتابعة/الاستدعاء: {proc.summons_result}
                          </p>
                        )}
                        {proc.notes && <p>ملاحظات: {proc.notes}</p>}
                        {proc.override_reason && (
                          <p className="text-amber-700 dark:text-amber-400">
                            سبب التكرار الموثق: {proc.override_reason}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
