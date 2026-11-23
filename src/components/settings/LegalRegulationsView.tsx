import React, { useEffect, useState } from 'react';
import {
  ShieldAlert,
  Plus,
  Trash2,
  Edit2,
  Save,
  X,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Layers,
} from 'lucide-react';
import { schoolService } from '../../services/schoolService';
import type { AbsenceStage, AcademicYear } from '../../types/school';

interface LegalRegulationsViewProps {
  activeAcademicYear?: AcademicYear | null;
  academicYears?: AcademicYear[];
  selectedYearId?: number | null;
  grades?: any[];
  onRefresh?: () => Promise<void>;
  onNotify?: (type: 'error' | 'info' | 'success', message: string) => void;
  isHistoricalReadOnly?: boolean;
}

export function LegalRegulationsView({
  activeAcademicYear,
  academicYears = [],
  selectedYearId,
  isHistoricalReadOnly = false,
}: LegalRegulationsViewProps) {
  const targetYearId = selectedYearId ?? activeAcademicYear?.id ?? academicYears[0]?.id;
  const targetYear = academicYears.find((y) => y.id === targetYearId) ?? activeAcademicYear;

  const [stages, setStages] = useState<AbsenceStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<AbsenceStage | null>(null);
  const [formName, setFormName] = useState('');
  const [formDays, setFormDays] = useState('3');
  const [formTemplate, setFormTemplate] = useState('');
  const [saving, setSaving] = useState(false);

  const loadStages = async () => {
    if (!targetYearId) {
      setStages([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const data = await schoolService.listAbsenceStages(targetYearId);
      setStages(data);
    } catch (err: any) {
      setError(err.message || 'تعذر جلب مراحل الغياب.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStages();
  }, [targetYearId]);

  const handleOpenAdd = () => {
    if (!targetYearId) {
      setError('يرجى تحديد السنة الدراسية أولاً.');
      return;
    }
    setEditingStage(null);
    setFormName('');
    setFormDays('3');
    setFormTemplate(
      `إلى ولي الأمر الكريم،\nنظراً لبلوغ الطالب/ة عتبة الغياب ({absence_days} يوم) ضمن مرحلة ({stage_name}) للعام الدراسي ({academic_year}) في مدرسة ({school_name})، نرجو مراجعة الإدارة.\nرقم الكتاب: {document_number}\nالتاريخ: {date}`
    );
    setModalOpen(true);
  };

  const handleOpenEdit = (stage: AbsenceStage) => {
    setEditingStage(stage);
    setFormName(stage.name);
    setFormDays(String(stage.days_threshold));
    setFormTemplate(stage.letter_template);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetYearId) {
      setError('يرجى تحديد السنة الدراسية أولاً قبل الحفظ.');
      return;
    }
    const days = parseInt(formDays, 10);
    if (!formName.trim() || isNaN(days) || days < 1) {
      setError('يرجى إدخال اسم صحيح للمرحلة وعدد أيام غياب صالح (أكبر من صفر).');
      return;
    }
    try {
      setSaving(true);
      setError(null);
      if (editingStage) {
        await schoolService.updateAbsenceStage(editingStage.id, {
          name: formName.trim(),
          days_threshold: days,
          letter_template: formTemplate,
        });
        setSuccessMessage('تم تحديث مرحلة الغياب وقالب الكتاب بنجاح.');
      } else {
        await schoolService.createAbsenceStage({
          academic_year_id: targetYearId,
          name: formName.trim(),
          days_threshold: days,
          letter_template: formTemplate,
        });
        setSuccessMessage('تم إنشاء مرحلة الغياب الجديدة بنجاح.');
      }
      setModalOpen(false);
      await loadStages();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      setError(err.message || 'تعذر حفظ مرحلة الغياب.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`هل أنت متأكد من حذف مرحلة الغياب "${name}"؟ سيتم إعادة تصنيف الطلاب تلقائياً وفقاً للمراحل المتبقية.`)) {
      return;
    }
    try {
      setError(null);
      await schoolService.deleteAbsenceStage(id);
      setSuccessMessage('تم حذف المرحلة وإعادة تصنيف الطلاب بنجاح.');
      await loadStages();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      setError(err.message || 'تعذر حذف المرحلة.');
    }
  };

  if (!targetYearId) {
    return (
      <div className="p-8 text-center rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200">
        <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-amber-600" />
        <p className="font-bold text-base">يرجى تحديد السنة الدراسية لعرض وإدارة ضوابط ومراحل الغياب.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Header Banner */}
      <div className="rounded-2xl border border-teal-200 dark:border-teal-800/60 bg-gradient-to-br from-teal-50/80 via-white to-teal-50/30 dark:from-teal-950/30 dark:via-slate-900 dark:to-teal-950/10 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-teal-700 text-white flex items-center justify-center shrink-0 shadow-md">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 dark:text-slate-100 font-display">
                الضوابط القانونية للغياب والإنذارات (مراحل الغياب الديناميكية)
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                إدارة مراحل الغياب وعتبات الأيام وقوالب الكتب الرسمية للسنة الدراسية المحددة ({targetYear?.name || targetYearId}).
              </p>
            </div>
          </div>
          {!isHistoricalReadOnly && (
            <button
              type="button"
              onClick={handleOpenAdd}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs sm:text-sm font-bold shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة مرحلة غياب جديدة</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4 flex items-center gap-3 text-xs sm:text-sm text-red-900 dark:text-red-200">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-4 flex items-center gap-3 text-xs sm:text-sm text-emerald-900 dark:text-emerald-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Stages List */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-teal-700 dark:text-teal-400" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              مراحل الغياب المعرفة ({stages.length})
            </h3>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            مرتب تصاعدياً حسب عتبة الأيام
          </span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-slate-500">جاري التحميل...</div>
        ) : stages.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="w-10 h-10 text-slate-400 mx-auto mb-3 opacity-60" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
              لا توجد مراحل غياب معرّفة لهذه السنة الدراسية.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              أضف مرحلة غياب جديدة (مثل: تحذير، إنذار أول، إنذار نهائي، تجاوز الحد) لبدء تقارير الغياب.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {stages.map((stage, idx) => (
              <div key={stage.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="w-7 h-7 rounded-lg bg-teal-100 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 text-xs font-extrabold flex items-center justify-center">
                      {idx + 1}
                    </span>
                    <h4 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
                      {stage.name}
                    </h4>
                    <span className="px-2.5 py-0.5 rounded-full bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-300 text-xs font-extrabold tabular-nums">
                      عند بلوغ {stage.days_threshold} يوم غياب
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 max-w-2xl bg-slate-50 dark:bg-slate-950/50 p-2.5 rounded-lg border border-slate-200/70 dark:border-slate-800/70">
                    <span className="font-bold text-slate-700 dark:text-slate-300 ml-1">قالب الكتاب:</span>
                    {stage.letter_template}
                  </p>
                </div>
                {!isHistoricalReadOnly && (
                  <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(stage)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>تعديل</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(stage.id, stage.name)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف</span>
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Modal Add / Edit Stage */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-5" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl max-h-[92vh] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                {editingStage ? 'تعديل مرحلة الغياب' : 'إضافة مرحلة غياب جديدة'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                    اسم المرحلة أو الإنذار <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="مثال: إنذار أول، إنذار نهائي، فصل مؤقت..."
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                    عتبة أيام الغياب (يوم) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    required
                    value={formDays}
                    onChange={(e) => setFormDays(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                    قالب الكتاب الرسمي المرفق
                  </label>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    يمكنك استخدام المتغيرات: {'{full_name}, {absence_days}, {academic_year}, {school_name}, {date}, {document_number}, {stage_name}'}
                  </span>
                </div>
                <textarea
                  rows={6}
                  value={formTemplate}
                  onChange={(e) => setFormTemplate(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30 leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold shadow-sm disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>{saving ? 'جاري الحفظ...' : 'حفظ المرحلة'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
