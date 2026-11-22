import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  FileSignature,
  History,
  Lock,
  PlusCircle,
  Save,
  Scale,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { schoolService } from '../../services/schoolService';
import type {
  AcademicYear,
  EducationalStage,
  ExcusedAbsenceMode,
  GradeWithSections,
  GuardianFrequency,
  LegalRegulationVersion,
  LegalStageRegulation,
  UpdateLegalRegulationInput,
} from '../../types/school';

interface LegalRegulationsViewProps {
  grades: GradeWithSections[];
  academicYears: AcademicYear[];
  selectedYearId: number | null;
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

const STAGES: Array<{ id: EducationalStage; label: string; subtitle: string }> = [
  { id: 'primary', label: 'المرحلة الابتدائية', subtitle: 'الصفوف الأول حتى السادس الابتدائي' },
  { id: 'intermediate', label: 'المرحلة المتوسطة', subtitle: 'الصفوف الأول حتى الثالث المتوسط' },
  { id: 'preparatory', label: 'المرحلة الإعدادية', subtitle: 'الصفوف الرابع حتى السادس الإعدادي' },
];

const FREQUENCY_OPTIONS: Array<{ value: GuardianFrequency; label: string }> = [
  { value: 'weekly', label: 'أسبوعياً (كل 7 أيام)' },
  { value: 'biweekly', label: 'كل أسبوعين (كل 14 يوماً)' },
  { value: 'monthly', label: 'شهرياً' },
  { value: 'upon_threshold', label: 'عند بلوغ العتبة مباشرة' },
];

const EXCUSED_MODE_OPTIONS: Array<{
  value: ExcusedAbsenceMode;
  label: string;
  desc: string;
}> = [
  {
    value: 'include_all',
    label: 'عدم استثناء الغياب بعذر تلقائياً (الوضع الاحترازي الافتراضي)',
    desc: 'تُحتسب جميع أيام الغياب ضمن سقف المرحلة ما لم يصدر قرار قانوني موثق باستثناء الإجازات المرضية أو الرخص.',
  },
  {
    value: 'exclude_with_approved_rule',
    label: 'استثناء الغياب بعذر عند اعتماد الضابطة قانونياً فقط',
    desc: 'يستبعد الغياب بعذر (الإجازات المرضية والرخص غير المحتسبة) فقط بعد تفعيل الاعتماد القانوني الكامل للمرحلة.',
  },
  {
    value: 'exclude_all',
    label: 'احتساب الغياب دون عذر فقط واستبعاد الغياب بعذر',
    desc: 'يقتصر السقف والإنذارات على الغياب غير المشروع والدروس المتراكمة دون عذر.',
  },
];

const TEMPLATE_PLACEHOLDERS: Array<{ token: string; label: string }> = [
  { token: '{{student_name}}', label: 'اسم الطالب' },
  { token: '{{grade_name}}', label: 'الصف' },
  { token: '{{section_name}}', label: 'الشعبة' },
  { token: '{{stage_name}}', label: 'المرحلة' },
  { token: '{{counted_days}}', label: 'الأيام المحتسبة' },
  { token: '{{unexcused_days}}', label: 'الغياب دون عذر' },
  { token: '{{threshold_days}}', label: 'عتبة الإجراء' },
  { token: '{{remaining_days}}', label: 'المتبقي للحد' },
  { token: '{{decision_ref}}', label: 'مرجع القرار' },
  { token: '{{school_name}}', label: 'اسم المدرسة' },
  { token: '{{academic_year}}', label: 'السنة الدراسية' },
  { token: '{{today_date}}', label: 'تاريخ اليوم' },
];

interface RegulationFormState {
  effective_absence_limit: string;
  absence_calculation_method: string;
  excused_absence_mode: ExcusedAbsenceMode;
  unexcused_absence_handling: string;
  dispersed_lessons_rule: string;
  lesson_conversion_rule: string;
  preliminary_warning_days: string;
  first_warning_days: string;
  final_warning_days: string;
  final_effective_limit_days: string;
  thresholds_are_provisional: boolean;
  guardian_notify_frequency: GuardianFrequency;
  guardian_summons_frequency: GuardianFrequency;
  guardian_notify_notes: string;
  attendance_score_deduction_enabled: boolean;
  attendance_score_deduction_per_unexcused_day: string;
  attendance_score_article: string;
  conduct_failure_enabled: boolean;
  conduct_failure_threshold: string;
  conduct_failure_article: string;
  truancy_handling_enabled: boolean;
  truancy_handling_notes: string;
  truancy_article: string;
  dispersed_lessons_counting_enabled: boolean;
  dispersed_lessons_article: string;
  warnings_article: string;
  decision_name: string;
  decision_number: string;
  decision_issue_date: string;
  effective_from_date: string;
  legal_notes: string;
  is_legally_approved: boolean;
  official_letter_approved: boolean;
  warning_letter_template: string;
  summons_letter_template: string;
  change_summary: string;
}

function mapRegulationToForm(reg: LegalStageRegulation): RegulationFormState {
  return {
    effective_absence_limit: String(reg.effective_absence_limit),
    absence_calculation_method: reg.absence_calculation_method,
    excused_absence_mode: reg.excused_absence_mode,
    unexcused_absence_handling: reg.unexcused_absence_handling,
    dispersed_lessons_rule: reg.dispersed_lessons_rule,
    lesson_conversion_rule: reg.lesson_conversion_rule,
    preliminary_warning_days: String(reg.preliminary_warning_days),
    first_warning_days: String(reg.first_warning_days),
    final_warning_days: String(reg.final_warning_days),
    final_effective_limit_days: String(reg.final_effective_limit_days),
    thresholds_are_provisional: reg.thresholds_are_provisional === 1,
    guardian_notify_frequency: reg.guardian_notify_frequency,
    guardian_summons_frequency: reg.guardian_summons_frequency,
    guardian_notify_notes: reg.guardian_notify_notes ?? '',
    attendance_score_deduction_enabled: reg.attendance_score_deduction_enabled === 1,
    attendance_score_deduction_per_unexcused_day: String(
      reg.attendance_score_deduction_per_unexcused_day
    ),
    attendance_score_article: reg.attendance_score_article ?? '',
    conduct_failure_enabled: reg.conduct_failure_enabled === 1,
    conduct_failure_threshold: String(reg.conduct_failure_threshold),
    conduct_failure_article: reg.conduct_failure_article ?? '',
    truancy_handling_enabled: reg.truancy_handling_enabled === 1,
    truancy_handling_notes: reg.truancy_handling_notes ?? '',
    truancy_article: reg.truancy_article ?? '',
    dispersed_lessons_counting_enabled: reg.dispersed_lessons_counting_enabled === 1,
    dispersed_lessons_article: reg.dispersed_lessons_article ?? '',
    warnings_article: reg.warnings_article ?? '',
    decision_name: reg.decision_name ?? '',
    decision_number: reg.decision_number ?? '',
    decision_issue_date: reg.decision_issue_date ?? '',
    effective_from_date: reg.effective_from_date ?? new Date().toISOString().slice(0, 10),
    legal_notes: reg.legal_notes ?? '',
    is_legally_approved: reg.is_legally_approved === 1,
    official_letter_approved: reg.official_letter_approved === 1,
    warning_letter_template: reg.warning_letter_template,
    summons_letter_template: reg.summons_letter_template,
    change_summary: '',
  };
}

export function LegalRegulationsView({
  grades,
  academicYears,
  selectedYearId,
  onRefresh,
  onNotify,
}: LegalRegulationsViewProps) {
  const [activeStage, setActiveStage] = useState<EducationalStage>('primary');
  const [regulationsMap, setRegulationsMap] = useState<Record<
    EducationalStage,
    LegalStageRegulation
  > | null>(null);
  const [versions, setVersions] = useState<LegalRegulationVersion[]>([]);
  const [form, setForm] = useState<RegulationFormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assigningGradeId, setAssigningGradeId] = useState<number | null>(null);

  const activeYear = useMemo(
    () => academicYears.find((y) => y.is_active === 1) ?? null,
    [academicYears]
  );

  const targetYearId = selectedYearId ?? activeYear?.id ?? undefined;
  const viewingYear = useMemo(
    () => academicYears.find((y) => y.id === targetYearId) ?? activeYear,
    [academicYears, targetYearId, activeYear]
  );

  const loadLegalData = useCallback(async () => {
    setLoading(true);
    try {
      const [regs, vers] = await Promise.all([
        schoolService.getLegalRegulations(targetYearId),
        schoolService.listLegalRegulationVersions(),
      ]);
      setRegulationsMap(regs);
      setVersions(vers);
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر تحميل الضوابط القانونية للغياب والإنذارات.'
      );
    } finally {
      setLoading(false);
    }
  }, [targetYearId, onNotify]);

  useEffect(() => {
    void loadLegalData();
  }, [loadLegalData]);

  const currentReg = regulationsMap ? regulationsMap[activeStage] : null;

  useEffect(() => {
    if (currentReg) {
      setForm(mapRegulationToForm(currentReg));
    }
  }, [currentReg]);

  const stageGrades = useMemo(
    () => grades.filter((g) => g.stage === activeStage),
    [grades, activeStage]
  );

  const unmappedGrades = useMemo(() => grades.filter((g) => g.stage === null), [grades]);

  const stageVersions = useMemo(
    () => versions.filter((v) => v.stage === activeStage),
    [versions, activeStage]
  );

  const isHistoricalReadOnly = Boolean(
    currentReg?.is_historical_year_snapshot ||
      (activeYear && viewingYear && viewingYear.id !== activeYear.id)
  );

  const thresholdValidationError = useMemo(() => {
    if (!form) return null;
    const eff = Number(form.effective_absence_limit);
    const p = Number(form.preliminary_warning_days);
    const f1 = Number(form.first_warning_days);
    const fn = Number(form.final_warning_days);
    const fl = Number(form.final_effective_limit_days);

    if (
      !Number.isInteger(eff) ||
      !Number.isInteger(p) ||
      !Number.isInteger(f1) ||
      !Number.isInteger(fn) ||
      !Number.isInteger(fl) ||
      p <= 0
    ) {
      return 'يجب أن تكون جميع العتبات وحدود الغياب أعداداً صحيحة موجبة.';
    }
    if (!(p < f1 && f1 < fn && fn <= fl && fl <= eff)) {
      return 'ترتيب العتبات غير صحيح: يجب أن يتحقق (التحذير الأولي < الإنذار الأول < الإنذار النهائي <= الحد النهائي المؤثر <= حد الغياب المؤثر).';
    }
    return null;
  }, [form]);

  async function handleAssignGradeStage(gradeId: number, stage: EducationalStage | null) {
    setAssigningGradeId(gradeId);
    try {
      await schoolService.updateGradeStage(gradeId, stage);
      onNotify('success', 'تم ربط الصف بالمرحلة الدراسية بنجاح.');
      await onRefresh();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر تحديث مرحلة الصف.');
    } finally {
      setAssigningGradeId(null);
    }
  }

  function appendPlaceholder(field: 'warning_letter_template' | 'summons_letter_template', token: string) {
    setForm((prev) => {
      if (!prev) return prev;
      const current = prev[field];
      const spacer = current && !current.endsWith(' ') && !current.endsWith('\n') ? ' ' : '';
      return { ...prev, [field]: `${current}${spacer}${token}` };
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form || isHistoricalReadOnly) return;

    if (thresholdValidationError) {
      onNotify('error', thresholdValidationError);
      return;
    }

    if (form.is_legally_approved && form.thresholds_are_provisional) {
      onNotify(
        'error',
        'لا يمكن اعتماد الضابطة قانونياً مع بقاء العتبات موسومة كقيم تجريبية. يرجى مراجعة الأرقام وإلغاء وسم القيم التجريبية أولاً.'
      );
      return;
    }

    if (form.is_legally_approved && (!form.decision_number.trim() || !form.decision_issue_date.trim())) {
      onNotify(
        'error',
        'لاعتماد الضابطة قانونياً بشكل رسمي، يجب توثيق رقم القرار/التعميم وتاريخ صدوره.'
      );
      return;
    }

    if (form.official_letter_approved && !form.is_legally_approved) {
      onNotify(
        'error',
        'لا يمكن اعتماد صيغة الكتاب القانوني الرسمي قبل تفعيل الاعتماد القانوني للضابطة.'
      );
      return;
    }

    setSaving(true);
    try {
      const payload: UpdateLegalRegulationInput = {
        effective_absence_limit: Number(form.effective_absence_limit),
        absence_calculation_method: form.absence_calculation_method,
        excused_absence_mode: form.excused_absence_mode,
        unexcused_absence_handling: form.unexcused_absence_handling,
        dispersed_lessons_rule: form.dispersed_lessons_rule,
        lesson_conversion_rule: form.lesson_conversion_rule,
        preliminary_warning_days: Number(form.preliminary_warning_days),
        first_warning_days: Number(form.first_warning_days),
        final_warning_days: Number(form.final_warning_days),
        final_effective_limit_days: Number(form.final_effective_limit_days),
        thresholds_are_provisional: form.thresholds_are_provisional,
        guardian_notify_frequency: form.guardian_notify_frequency,
        guardian_summons_frequency: form.guardian_summons_frequency,
        guardian_notify_notes: form.guardian_notify_notes.trim() || null,
        attendance_score_deduction_enabled: form.attendance_score_deduction_enabled,
        attendance_score_deduction_per_unexcused_day: Number(
          form.attendance_score_deduction_per_unexcused_day || 0
        ),
        attendance_score_article: form.attendance_score_article.trim() || null,
        conduct_failure_enabled: form.conduct_failure_enabled,
        conduct_failure_threshold: Number(form.conduct_failure_threshold || 51),
        conduct_failure_article: form.conduct_failure_article.trim() || null,
        truancy_handling_enabled: form.truancy_handling_enabled,
        truancy_handling_notes: form.truancy_handling_notes.trim() || null,
        truancy_article: form.truancy_article.trim() || null,
        dispersed_lessons_counting_enabled: form.dispersed_lessons_counting_enabled,
        dispersed_lessons_article: form.dispersed_lessons_article.trim() || null,
        warnings_article: form.warnings_article.trim() || null,
        decision_name: form.decision_name.trim() || null,
        decision_number: form.decision_number.trim() || null,
        decision_issue_date: form.decision_issue_date.trim() || null,
        effective_from_date: form.effective_from_date.trim() || null,
        legal_notes: form.legal_notes.trim() || null,
        is_legally_approved: form.is_legally_approved,
        official_letter_approved: form.official_letter_approved,
        warning_letter_template: form.warning_letter_template,
        summons_letter_template: form.summons_letter_template,
        change_summary: form.change_summary.trim() || null,
        academic_year_id: targetYearId,
      };

      const res = await schoolService.updateStageLegalRegulation(activeStage, payload);
      setRegulationsMap((prev) => (prev ? { ...prev, [activeStage]: res.regulation } : prev));
      setVersions((prev) => [
        res.version,
        ...prev.filter((v) => v.id !== res.version.id),
      ]);
      onNotify(
        'success',
        `تم حفظ وتوثيق ضوابط «${res.regulation.stage_name}» (الإصدار v${res.version.version_number}) للسنة الدراسية الفعالة.`
      );
      await onRefresh();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر حفظ الضوابط القانونية.');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !regulationsMap || !form || !currentReg) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
        جاري تحميل الضوابط القانونية للغياب والإنذارات...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Stage Isolation Selector */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {STAGES.map((st) => {
          const reg = regulationsMap[st.id];
          const isSelected = activeStage === st.id;
          const approved = reg.is_legally_approved === 1;
          const mappedCount = grades.filter((g) => g.stage === st.id).length;

          return (
            <button
              key={st.id}
              type="button"
              onClick={() => setActiveStage(st.id)}
              className={`text-right p-4 rounded-xl border transition-colors ${
                isSelected
                  ? 'border-teal-700 bg-teal-50/70 dark:bg-teal-950/30 dark:border-teal-500'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">
                    {st.label}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {st.subtitle}
                  </p>
                </div>
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 tabular-nums">
                  v{reg.current_version}
                </span>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2 text-[11px] tabular-nums">
                <span
                  className={`font-semibold flex items-center gap-1 ${
                    approved
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-amber-700 dark:text-amber-400'
                  }`}
                >
                  {approved ? (
                    <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                  )}
                  {approved ? 'معتمدة قانونياً' : 'مسودة / قيم تجريبية'}
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  سقف الغياب: <strong>{reg.effective_absence_limit}</strong> يوم · {mappedCount} صفوف
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Historical Snapshot Read-Only Banner */}
      {isHistoricalReadOnly && (
        <div
          role="status"
          className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/60 p-4 flex items-start gap-3 text-xs text-slate-800 dark:text-slate-200 leading-relaxed"
        >
          <Lock className="w-4 h-4 text-slate-600 dark:text-slate-300 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold">
              أرشيف ضوابط السنة الدراسية ({viewingYear?.name}) — وضع القراءة فقط (عدم رجعية الأثر)
            </p>
            <p>
              لحفظ حقوق الطلاب واستقرار السجلات التاريخية، تعرض هذه الصفحة نسخة الضابطة القانونية
              المعتمدة لتلك السنة كما كانت وقتها دون السماح بتعديلها بأثر رجعي. لتعديل الضوابط، اختر
              السنة الدراسية الفعالة من الشريط العلوي.
            </p>
          </div>
        </div>
      )}

      {/* Legal Approval & Provisional Notice */}
      {!currentReg.is_legally_approved || currentReg.thresholds_are_provisional === 1 ? (
        <div
          role="alert"
          className="rounded-xl border border-amber-300 dark:border-amber-700/70 bg-amber-50 dark:bg-amber-950/30 p-4 flex items-start gap-3 text-xs text-amber-950 dark:text-amber-200 leading-relaxed"
        >
          <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold">
              تنبيه إداري وقانوني: عتبات هذه المرحلة مصنفة حالياً كـ «تجريبية / غير معتمدة قانونياً»
            </p>
            <p>
              يمكن استخدام هذه الضوابط للمتابعة الداخلية والمسودات، غير أن النظام يمنع إصدار أو طباعة
              كتب إنذار أو استدعاء بصيغة قانونية رسمية نهائية حتى يتم اعتماد الضابطة وتوثيق رقم
              القرار وتاريخ صدوره أدناه.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30 p-3.5 flex items-start gap-2.5 text-xs text-emerald-950 dark:text-emerald-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">ضابطة معتمدة قانونياً:</span>{' '}
            {currentReg.decision_name ? `${currentReg.decision_name} — ` : ''}
            قرار رقم ({currentReg.decision_number}) بتاريخ{' '}
            <span className="tabular-nums">{currentReg.decision_issue_date}</span>
            {currentReg.effective_from_date && (
              <>
                {' '}
                · ساري من <span className="tabular-nums">{currentReg.effective_from_date}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Grade Mapping Helper for Active Stage & Unmapped Grades */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
            <Scale className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
            ربط الصفوف بـ «{currentReg.stage_name}»
          </h4>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {stageGrades.length} صفوف مرتبطة بهذه المرحلة
          </span>
        </div>

        <div className="text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-2">
          {stageGrades.length > 0 ? (
            stageGrades.map((g, idx) => (
              <span key={g.id} className="font-semibold text-slate-800 dark:text-slate-100">
                {g.name}
                {idx < stageGrades.length - 1 ? ' ·' : ''}
              </span>
            ))
          ) : (
            <span className="text-amber-700 dark:text-amber-400">
              لا توجد صفوف مرتبطة بهذه المرحلة حالياً. يمكنك ربط الصفوف من قسم «الصفوف والشعب» أو من القائمة أدناه.
            </span>
          )}
        </div>

        {unmappedGrades.length > 0 && (
          <div className="pt-2.5 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400">
              صفوف غير مربوطة بأي مرحلة دراسية ({unmappedGrades.length}):
            </p>
            <div className="flex flex-wrap gap-2">
              {unmappedGrades.map((ug) => (
                <div
                  key={ug.id}
                  className="inline-flex items-center gap-2 rounded-lg border border-amber-300 dark:border-amber-700/70 bg-amber-50/70 dark:bg-amber-950/30 px-2.5 py-1.5 text-xs"
                >
                  <span className="font-bold text-slate-800 dark:text-slate-100">{ug.name}</span>
                  <select
                    aria-label={`تعيين مرحلة ${ug.name}`}
                    value=""
                    disabled={assigningGradeId === ug.id}
                    onChange={(e) => {
                      const val = e.target.value as EducationalStage;
                      if (val) void handleAssignGradeStage(ug.id, val);
                    }}
                    className="px-2 py-1 text-[11px] rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                  >
                    <option value="">اختر المرحلة لربطها...</option>
                    <option value="primary">المرحلة الابتدائية</option>
                    <option value="intermediate">المرحلة المتوسطة</option>
                    <option value="preparatory">المرحلة الإعدادية</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Main Stage Regulation Form */}
      <form onSubmit={handleSubmit} className="space-y-5">
        <fieldset disabled={isHistoricalReadOnly || saving} className="space-y-5">
          {/* 1. Absence Limits & Thresholds */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">
                حد الغياب المؤثر وعتبات التحذيرات والإنذارات — {currentReg.stage_name}
              </h4>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                تُطبق مستقلة على هذه المرحلة فقط
              </span>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    التحذير الأولي (يوم) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    required
                    value={form.preliminary_warning_days}
                    onChange={(e) =>
                      setForm({ ...form, preliminary_warning_days: e.target.value })
                    }
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    الإنذار الأول (يوم) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    required
                    value={form.first_warning_days}
                    onChange={(e) => setForm({ ...form, first_warning_days: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    الإنذار النهائي (يوم) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    required
                    value={form.final_warning_days}
                    onChange={(e) => setForm({ ...form, final_warning_days: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    الحد النهائي المؤثر (يوم) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    required
                    value={form.final_effective_limit_days}
                    onChange={(e) =>
                      setForm({ ...form, final_effective_limit_days: e.target.value })
                    }
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    سقف الغياب العام للمرحلة <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    required
                    value={form.effective_absence_limit}
                    onChange={(e) =>
                      setForm({ ...form, effective_absence_limit: e.target.value })
                    }
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums font-bold"
                  />
                </div>
              </div>

              {thresholdValidationError && (
                <p className="text-xs font-semibold text-red-600 dark:text-red-400">
                  {thresholdValidationError}
                </p>
              )}

              <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={form.thresholds_are_provisional}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      thresholds_are_provisional: e.target.checked,
                      is_legally_approved: e.target.checked ? false : form.is_legally_approved,
                      official_letter_approved: e.target.checked
                        ? false
                        : form.official_letter_approved,
                    })
                  }
                  className="mt-0.5 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                />
                <span>
                  <strong className="text-slate-900 dark:text-slate-100">
                    تصنيف العتبات كـ «تجريبية / غير معتمدة قانونياً»
                  </strong>
                  <span className="block text-slate-500 dark:text-slate-400 mt-0.5">
                    تبقى العتبات التجريبية للمتابعة الإدارية فقط حتى تراجعها الإدارة وتوثق رقم القرار الوزاري وتلغي هذا الوسم.
                  </span>
                </span>
              </label>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  نص المادة أو الفقرة القانونية المنظمة للإنذارات والحد الأعلى
                </label>
                <input
                  type="text"
                  value={form.warnings_article}
                  onChange={(e) => setForm({ ...form, warnings_article: e.target.value })}
                  placeholder="مثال: التعليمات التنظيمية للدوام والغيابات — مادة الإنذارات وتبليغ أولياء الأمور"
                  className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
          </section>

          {/* 2. Calculation & Excused Absence Rules */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-teal-700 dark:text-teal-400" />
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">
                آلية احتساب الغياب ومعاملة الغياب بعذر ودون عذر
              </h4>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
              <fieldset className="space-y-2">
                <legend className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  معاملة الغياب بعذر (الإجازات المرضية والرخص غير المحتسبة) ضمن سقف الغياب:
                </legend>
                <div className="grid grid-cols-1 gap-2">
                  {EXCUSED_MODE_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                        form.excused_absence_mode === opt.value
                          ? 'border-teal-600 bg-teal-50/60 dark:bg-teal-950/30 dark:border-teal-500'
                          : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`excused-mode-${activeStage}`}
                        checked={form.excused_absence_mode === opt.value}
                        onChange={() => setForm({ ...form, excused_absence_mode: opt.value })}
                        className="mt-0.5 text-teal-700 focus:ring-teal-600"
                      />
                      <div>
                        <span className="block text-xs font-bold text-slate-900 dark:text-slate-100">
                          {opt.label}
                        </span>
                        <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                          {opt.desc}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    طريقة احتساب الغياب المعتمدة <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={form.absence_calculation_method}
                    onChange={(e) =>
                      setForm({ ...form, absence_calculation_method: e.target.value })
                    }
                    className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 leading-relaxed"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    معاملة الغياب دون عذر <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={form.unexcused_absence_handling}
                    onChange={(e) =>
                      setForm({ ...form, unexcused_absence_handling: e.target.value })
                    }
                    className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 leading-relaxed"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    قاعدة احتساب الدروس المتفرقة <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={form.dispersed_lessons_rule}
                    onChange={(e) => setForm({ ...form, dispersed_lessons_rule: e.target.value })}
                    className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 leading-relaxed"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    قاعدة تحويل الدروس إلى أيام غياب <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={form.lesson_conversion_rule}
                    onChange={(e) => setForm({ ...form, lesson_conversion_rule: e.target.value })}
                    className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 leading-relaxed"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 3. Guardian Notification & Additional Stage Rules */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-sky-700 dark:text-sky-400" />
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">
                دورية تبليغ أولياء الأمور والضوابط الإضافية للمرحلة
              </h4>
            </div>

            <div className="p-4 sm:p-5 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    دورية تبليغ ولي الأمر
                  </label>
                  <select
                    value={form.guardian_notify_frequency}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        guardian_notify_frequency: e.target.value as GuardianFrequency,
                      })
                    }
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  >
                    {FREQUENCY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    دورية استدعاء ولي الأمر
                  </label>
                  <select
                    value={form.guardian_summons_frequency}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        guardian_summons_frequency: e.target.value as GuardianFrequency,
                      })
                    }
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  >
                    {FREQUENCY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    ملاحظات التبليغ والاستدعاء
                  </label>
                  <input
                    type="text"
                    value={form.guardian_notify_notes}
                    onChange={(e) => setForm({ ...form, guardian_notify_notes: e.target.value })}
                    className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
                {/* Attendance Score Deduction */}
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 space-y-2.5">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.attendance_score_deduction_enabled}
                      onChange={(e) =>
                        setForm({ ...form, attendance_score_deduction_enabled: e.target.checked })
                      }
                      className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    />
                    <span>تفعيل خصم درجات المواظبة/السلوك عن الغياب دون عذر</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        الدرجات المخصومة لكل يوم
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={50}
                        step={0.5}
                        disabled={!form.attendance_score_deduction_enabled}
                        value={form.attendance_score_deduction_per_unexcused_day}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            attendance_score_deduction_per_unexcused_day: e.target.value,
                          })
                        }
                        className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 tabular-nums disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        نص المادة القانونية
                      </label>
                      <input
                        type="text"
                        value={form.attendance_score_article}
                        onChange={(e) =>
                          setForm({ ...form, attendance_score_article: e.target.value })
                        }
                        placeholder="المادة / الفقرة"
                        className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                      />
                    </div>
                  </div>
                </div>

                {/* Conduct Failure */}
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 space-y-2.5">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.conduct_failure_enabled}
                      onChange={(e) =>
                        setForm({ ...form, conduct_failure_enabled: e.target.checked })
                      }
                      className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    />
                    <span>تفعيل مؤشر الرسوب بسبب السلوك والمواظبة</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        حد الخصم الموجب للرسوب (درجة)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={200}
                        disabled={!form.conduct_failure_enabled}
                        value={form.conduct_failure_threshold}
                        onChange={(e) =>
                          setForm({ ...form, conduct_failure_threshold: e.target.value })
                        }
                        className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 tabular-nums disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        نص المادة القانونية
                      </label>
                      <input
                        type="text"
                        value={form.conduct_failure_article}
                        onChange={(e) =>
                          setForm({ ...form, conduct_failure_article: e.target.value })
                        }
                        placeholder="المادة / الفقرة"
                        className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                      />
                    </div>
                  </div>
                </div>

                {/* Truancy */}
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 space-y-2.5">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.truancy_handling_enabled}
                      onChange={(e) =>
                        setForm({ ...form, truancy_handling_enabled: e.target.checked })
                      }
                      className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    />
                    <span>معالجة الهروب من الدروس والتسرب (د،هـ)</span>
                  </label>
                  <input
                    type="text"
                    value={form.truancy_handling_notes}
                    onChange={(e) => setForm({ ...form, truancy_handling_notes: e.target.value })}
                    placeholder="إجراء الإدارة عند رصد الهروب من الدروس..."
                    className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                  <input
                    type="text"
                    value={form.truancy_article}
                    onChange={(e) => setForm({ ...form, truancy_article: e.target.value })}
                    placeholder="نص المادة القانونية الخاصة بالهروب والتسرب"
                    className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>

                {/* Dispersed Lessons */}
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 space-y-2.5">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-slate-100 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.dispersed_lessons_counting_enabled}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          dispersed_lessons_counting_enabled: e.target.checked,
                        })
                      }
                      className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    />
                    <span>إدخال الأيام المحولة من الدروس المتفرقة في تقارير المرحلة</span>
                  </label>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    يربط عداد تحويل الدروس المتراكمة بسقف الغياب القانوني للمرحلة تلقائياً.
                  </p>
                  <input
                    type="text"
                    value={form.dispersed_lessons_article}
                    onChange={(e) =>
                      setForm({ ...form, dispersed_lessons_article: e.target.value })
                    }
                    placeholder="نص المادة القانونية لتراكم الدروس المتفرقة"
                    className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 4. Legal Decision Metadata & Official Approval */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
              <FileSignature className="w-4 h-4 text-teal-700 dark:text-teal-400" />
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">
                توثيق القرار / التعميم الوزاري وصيغ الكتب الرسمية
              </h4>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    اسم القرار / التعميم / النظام
                  </label>
                  <input
                    type="text"
                    value={form.decision_name}
                    onChange={(e) => setForm({ ...form, decision_name: e.target.value })}
                    placeholder="مثال: نظام المدارس الثانوية / كتاب المديرية"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    رقم القرار / الكتاب
                  </label>
                  <input
                    type="text"
                    value={form.decision_number}
                    onChange={(e) => setForm({ ...form, decision_number: e.target.value })}
                    placeholder="مثال: 142 / ت ع / 2026"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    تاريخ صدور القرار
                  </label>
                  <input
                    type="date"
                    value={form.decision_issue_date}
                    onChange={(e) => setForm({ ...form, decision_issue_date: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    تاريخ بدء السريان
                  </label>
                  <input
                    type="date"
                    value={form.effective_from_date}
                    onChange={(e) => setForm({ ...form, effective_from_date: e.target.value })}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  ملاحظات قانونية وإدارية مرجعية
                </label>
                <textarea
                  rows={2}
                  value={form.legal_notes}
                  onChange={(e) => setForm({ ...form, legal_notes: e.target.value })}
                  className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 leading-relaxed"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={form.is_legally_approved}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        is_legally_approved: e.target.checked,
                        thresholds_are_provisional: e.target.checked
                          ? false
                          : form.thresholds_are_provisional,
                        official_letter_approved: e.target.checked
                          ? form.official_letter_approved
                          : false,
                      })
                    }
                    className="mt-0.5 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                  />
                  <span>
                    <strong className="text-slate-900 dark:text-slate-100">
                      اعتماد الضابطة قانونياً بشكل رسمي
                    </strong>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      يتطلب إدخال رقم القرار وتاريخ صدوره وإلغاء وسم القيم التجريبية.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={form.official_letter_approved}
                    disabled={!form.is_legally_approved}
                    onChange={(e) =>
                      setForm({ ...form, official_letter_approved: e.target.checked })
                    }
                    className="mt-0.5 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600 disabled:opacity-50"
                  />
                  <span>
                    <strong className="text-slate-900 dark:text-slate-100">
                      السماح بإصدار وطباعة الكتب القانونية النهائية
                    </strong>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      عند التعطيل تقتصر الطباعة على صيغة مسودة إدارية غير معتمدة قانونياً.
                    </span>
                  </span>
                </label>
              </div>

              {/* Letter Templates */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-3 border-t border-slate-200 dark:border-slate-800">
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                    نموذج صيغة كتاب الإنذار الرسمي <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    rows={4}
                    required
                    value={form.warning_letter_template}
                    onChange={(e) => setForm({ ...form, warning_letter_template: e.target.value })}
                    className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 leading-relaxed"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {TEMPLATE_PLACEHOLDERS.map((p) => (
                      <button
                        key={`w-${p.token}`}
                        type="button"
                        onClick={() => appendPlaceholder('warning_letter_template', p.token)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-[10px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <PlusCircle className="w-2.5 h-2.5 text-teal-700 dark:text-teal-400" />
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                    نموذج صيغة كتاب استدعاء ولي الأمر <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    rows={4}
                    required
                    value={form.summons_letter_template}
                    onChange={(e) => setForm({ ...form, summons_letter_template: e.target.value })}
                    className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 leading-relaxed"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {TEMPLATE_PLACEHOLDERS.map((p) => (
                      <button
                        key={`s-${p.token}`}
                        type="button"
                        onClick={() => appendPlaceholder('summons_letter_template', p.token)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-[10px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <PlusCircle className="w-2.5 h-2.5 text-sky-700 dark:text-sky-400" />
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Save Footer */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    سبب التعديل / ملخص الإصدار الجديد (يوثق في السجل التاريخي)
                  </label>
                  <input
                    type="text"
                    value={form.change_summary}
                    onChange={(e) => setForm({ ...form, change_summary: e.target.value })}
                    placeholder="مثال: اعتماد عتبات المرحلة وفق كتاب المديرية العامة رقم..."
                    className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>

                <button
                  type="submit"
                  disabled={saving || isHistoricalReadOnly}
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
                >
                  <Save className="w-4 h-4" />
                  <span>
                    {saving
                      ? 'جاري الحفظ والتوثيق...'
                      : `حفظ ضوابط ${currentReg.stage_name}`}
                  </span>
                </button>
              </div>
            </div>
          </section>
        </fieldset>
      </form>

      {/* Immutable Version History */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 font-display">
            <History className="w-4 h-4 text-slate-600 dark:text-slate-300" />
            سجل إصدارات ضوابط «{currentReg.stage_name}»
          </h4>
          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {stageVersions.length} إصدار محفوظ
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-2.5 px-3.5 font-semibold">الإصدار</th>
                <th className="py-2.5 px-3.5 font-semibold">السنة الدراسية</th>
                <th className="py-2.5 px-3.5 font-semibold">تاريخ السريان</th>
                <th className="py-2.5 px-3.5 font-semibold">العتبات (أولي / أول / نهائي / سقف)</th>
                <th className="py-2.5 px-3.5 font-semibold">حالة الاعتماد والقرار</th>
                <th className="py-2.5 px-3.5 font-semibold">ملخص التغيير</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {stageVersions.map((ver) => (
                <tr key={ver.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                  <td className="py-2.5 px-3.5 font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    v{ver.version_number}
                  </td>
                  <td className="py-2.5 px-3.5 tabular-nums text-slate-700 dark:text-slate-300">
                    {ver.academic_year_name ?? '—'}
                  </td>
                  <td className="py-2.5 px-3.5 tabular-nums text-slate-700 dark:text-slate-300">
                    {ver.effective_from_date}
                  </td>
                  <td className="py-2.5 px-3.5 tabular-nums font-medium text-slate-800 dark:text-slate-200">
                    {ver.snapshot.preliminary_warning_days} / {ver.snapshot.first_warning_days} /{' '}
                    {ver.snapshot.final_warning_days} / {ver.snapshot.final_effective_limit_days}
                  </td>
                  <td className="py-2.5 px-3.5">
                    <span
                      className={`font-semibold ${
                        ver.is_legally_approved === 1
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {ver.is_legally_approved === 1 ? 'معتمد قانونياً' : 'مسودة / غير معتمد'}
                    </span>
                    {ver.decision_number && (
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                        قرار {ver.decision_number} ({ver.decision_issue_date ?? ''})
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3.5 text-slate-600 dark:text-slate-300">
                    {ver.change_summary ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
