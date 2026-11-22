import { AlertTriangle, CheckCircle2, Lock, Save, Scale } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { schoolService } from '../../services/schoolService';
import type {
  AbsenceThresholdsSettings,
  AcademicYear,
  GradeWithSections,
} from '../../types/school';

interface LegalRegulationsViewProps {
  grades?: GradeWithSections[];
  academicYears: AcademicYear[];
  selectedYearId: number | null;
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

interface ThresholdFormState {
  warning_days: string;
  preliminary_warning_days: string;
  final_warning_days: string;
  effective_absence_limit: string;
}

export function LegalRegulationsView({
  academicYears,
  selectedYearId,
  onRefresh,
  onNotify,
}: LegalRegulationsViewProps) {
  const [thresholds, setThresholds] = useState<AbsenceThresholdsSettings | null>(null);
  const [form, setForm] = useState<ThresholdFormState>({
    warning_days: '15',
    preliminary_warning_days: '25',
    final_warning_days: '35',
    effective_absence_limit: '45',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const activeYear = useMemo(
    () => academicYears.find((y) => y.is_active === 1) ?? null,
    [academicYears]
  );
  const targetYearId = selectedYearId ?? activeYear?.id ?? undefined;
  const viewingYear = useMemo(
    () => academicYears.find((y) => y.id === targetYearId) ?? activeYear,
    [academicYears, targetYearId, activeYear]
  );

  const isHistoricalReadOnly = Boolean(
    activeYear && viewingYear && viewingYear.id !== activeYear.id
  );

  const loadThresholds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await schoolService.getAbsenceThresholds(targetYearId);
      setThresholds(res);
      setForm({
        warning_days: String(res.warning_days),
        preliminary_warning_days: String(res.preliminary_warning_days),
        final_warning_days: String(res.final_warning_days),
        effective_absence_limit: String(res.effective_absence_limit),
      });
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر تحميل إعدادات حدود الغياب والإنذارات.'
      );
    } finally {
      setLoading(false);
    }
  }, [targetYearId, onNotify]);

  useEffect(() => {
    void loadThresholds();
  }, [loadThresholds]);

  const validationError = useMemo(() => {
    const w = Number(form.warning_days);
    const p = Number(form.preliminary_warning_days);
    const f = Number(form.final_warning_days);
    const e = Number(form.effective_absence_limit);

    if (
      !Number.isInteger(w) ||
      !Number.isInteger(p) ||
      !Number.isInteger(f) ||
      !Number.isInteger(e) ||
      w < 1 ||
      p < 1 ||
      f < 1 ||
      e < 1 ||
      w > 365 ||
      p > 365 ||
      f > 365 ||
      e > 365
    ) {
      return 'يجب أن تكون جميع القيم أعداداً صحيحة موجبة بين 1 و 365 يوماً.';
    }

    if (!(w < p && p < f && f < e)) {
      return 'تسلسل العتبات غير صحيح: يجب أن يكون (عتبة التحذير < عتبة الإنذار الأولي < عتبة الإنذار النهائي < حد الغياب المؤثر).';
    }

    return null;
  }, [form]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isHistoricalReadOnly) return;

    if (validationError) {
      onNotify('error', validationError);
      return;
    }

    setSaving(true);
    try {
      const updated = await schoolService.updateAbsenceThresholds({
        warning_days: Number(form.warning_days),
        preliminary_warning_days: Number(form.preliminary_warning_days),
        final_warning_days: Number(form.final_warning_days),
        effective_absence_limit: Number(form.effective_absence_limit),
        academic_year_id: targetYearId,
      });
      setThresholds(updated);
      setForm({
        warning_days: String(updated.warning_days),
        preliminary_warning_days: String(updated.preliminary_warning_days),
        final_warning_days: String(updated.final_warning_days),
        effective_absence_limit: String(updated.effective_absence_limit),
      });
      onNotify('success', 'تم حفظ حد الغياب المؤثر وعتبات التحذيرات والإنذارات بنجاح.');
      await onRefresh();
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر حفظ حدود الغياب والإنذارات.'
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading && !thresholds) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
        جاري تحميل حدود الغياب والإنذارات...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isHistoricalReadOnly && (
        <div
          role="status"
          className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/60 p-4 flex items-start gap-3 text-xs text-slate-800 dark:text-slate-200 leading-relaxed"
        >
          <Lock className="w-4 h-4 text-slate-600 dark:text-slate-300 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold">
              عرض حدود الغياب للسنة الدراسية ({viewingYear?.name}) — للقراءة فقط
            </p>
            <p>
              لتعديل حد الغياب المؤثر وعتبات التحذير والإنذارات، اختر السنة الدراسية الفعالة من
              الشريط العلوي.
            </p>
          </div>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Scale className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 font-display">
              حد الغياب المؤثر وعتبات التحذيرات والإنذارات — المرحلة الإعدادية
            </h3>
          </div>
          {viewingYear && (
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
              السنة الدراسية: {viewingYear.name}
            </span>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-5">
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            حدد عدد أيام الغياب المحتسبة (كما تُحسب في قسم الغيابات) التي تُبنى عليها تقارير
            التحذير والإنذار الأولي والإنذار النهائي وتجاوز حد الغياب المؤثر.
          </p>

          <fieldset disabled={isHistoricalReadOnly || saving} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/40 dark:bg-amber-950/15 p-3.5">
                <label
                  htmlFor="threshold-warning-days"
                  className="block text-xs font-bold text-slate-800 dark:text-slate-100 mb-1.5"
                >
                  عتبة التحذير (يوم) <span className="text-red-500">*</span>
                </label>
                <input
                  id="threshold-warning-days"
                  type="number"
                  min={1}
                  max={365}
                  required
                  value={form.warning_days}
                  onChange={(e) => setForm({ ...form, warning_days: e.target.value })}
                  className="w-full px-3 py-2 text-sm font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                  يظهر الطالب في تقرير عتبة التحذير عند بلوغ هذا العدد.
                </p>
              </div>

              <div className="rounded-xl border border-orange-200 dark:border-orange-800/60 bg-orange-50/40 dark:bg-orange-950/15 p-3.5">
                <label
                  htmlFor="threshold-preliminary-days"
                  className="block text-xs font-bold text-slate-800 dark:text-slate-100 mb-1.5"
                >
                  عتبة الإنذار الأولي (يوم) <span className="text-red-500">*</span>
                </label>
                <input
                  id="threshold-preliminary-days"
                  type="number"
                  min={1}
                  max={365}
                  required
                  value={form.preliminary_warning_days}
                  onChange={(e) =>
                    setForm({ ...form, preliminary_warning_days: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                  يظهر الطالب في تقرير الإنذار الأولي عند بلوغ هذا العدد.
                </p>
              </div>

              <div className="rounded-xl border border-rose-200 dark:border-rose-800/60 bg-rose-50/40 dark:bg-rose-950/15 p-3.5">
                <label
                  htmlFor="threshold-final-days"
                  className="block text-xs font-bold text-slate-800 dark:text-slate-100 mb-1.5"
                >
                  عتبة الإنذار النهائي (يوم) <span className="text-red-500">*</span>
                </label>
                <input
                  id="threshold-final-days"
                  type="number"
                  min={1}
                  max={365}
                  required
                  value={form.final_warning_days}
                  onChange={(e) => setForm({ ...form, final_warning_days: e.target.value })}
                  className="w-full px-3 py-2 text-sm font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                  يظهر الطالب في تقرير الإنذار النهائي عند بلوغ هذا العدد.
                </p>
              </div>

              <div className="rounded-xl border border-red-200 dark:border-red-800/60 bg-red-50/40 dark:bg-red-950/15 p-3.5">
                <label
                  htmlFor="threshold-effective-limit"
                  className="block text-xs font-bold text-slate-800 dark:text-slate-100 mb-1.5"
                >
                  حد الغياب المؤثر (يوم) <span className="text-red-500">*</span>
                </label>
                <input
                  id="threshold-effective-limit"
                  type="number"
                  min={1}
                  max={365}
                  required
                  value={form.effective_absence_limit}
                  onChange={(e) =>
                    setForm({ ...form, effective_absence_limit: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                  يظهر الطالب في تقرير المتجاوزين لحد الغياب المؤثر عند بلوغ هذا العدد.
                </p>
              </div>
            </div>

            {validationError ? (
              <div
                role="alert"
                className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3 flex items-start gap-2 text-xs text-red-800 dark:text-red-200 font-semibold"
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
                <span>{validationError}</span>
              </div>
            ) : (
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/60 dark:bg-emerald-950/20 p-3 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-900 dark:text-emerald-200 tabular-nums">
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                  التدرج المعتمد:
                </span>
                <span className="font-bold">
                  تحذير ({form.warning_days} يوم) ← إنذار أولي ({form.preliminary_warning_days}{' '}
                  يوم) ← إنذار نهائي ({form.final_warning_days} يوم) ← حد الغياب المؤثر (
                  {form.effective_absence_limit} يوم)
                </span>
              </div>
            )}
          </fieldset>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              يعتمد مركز التقارير مباشرة على أيام الغياب المحتسبة في قسم الغيابات ويقارنها بهذه
              القيم تلقائياً.
            </p>

            {!isHistoricalReadOnly && (
              <button
                type="submit"
                disabled={saving || Boolean(validationError)}
                className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? 'جاري الحفظ...' : 'حفظ الحدود والعتبات'}</span>
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
