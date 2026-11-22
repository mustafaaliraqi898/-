import { Edit3, FolderPlus, Layers, Plus, Trash2, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { EducationalStage, GradeWithSections, SectionItem } from '../../types/school';
import { schoolService } from '../../services/schoolService';
import { ConfirmDialog } from '../common/ConfirmDialog';

interface GradesViewProps {
  grades: GradeWithSections[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

const STAGE_LABEL_MAP: Record<EducationalStage, string> = {
  primary: 'المرحلة الابتدائية',
  intermediate: 'المرحلة المتوسطة',
  preparatory: 'المرحلة الإعدادية',
};

function inferClientStage(name: string): EducationalStage | '' {
  const s = name.trim();
  if (/(ابتدائي|الابتدائي|الابتدائية)/i.test(s)) return 'primary';
  if (/(متوسط|المتوسط|المتوسطة)/i.test(s)) return 'intermediate';
  if (/(إعدادي|اعدادي|الإعدادي|الاعدادي|الإعدادية|علمي|أدبي|ادبي)/i.test(s)) return 'preparatory';
  return '';
}

export function GradesView({ grades, loading, onRefresh, onNotify }: GradesViewProps) {
  // Add grade state
  const [showAddGrade, setShowAddGrade] = useState(false);
  const [newGradeName, setNewGradeName] = useState('');
  const [newGradeStage, setNewGradeStage] = useState<EducationalStage | ''>('');
  const [initialSectionsText, setInitialSectionsText] = useState('');
  const [submittingGrade, setSubmittingGrade] = useState(false);

  // Edit grade state
  const [editingGrade, setEditingGrade] = useState<GradeWithSections | null>(null);
  const [editGradeName, setEditGradeName] = useState('');
  const [editGradeStage, setEditGradeStage] = useState<EducationalStage | ''>('');

  // Add sections modal state
  const [addingSectionsGrade, setAddingSectionsGrade] = useState<GradeWithSections | null>(null);
  const [newSectionsInput, setNewSectionsInput] = useState('');
  const [newSectionCapacity, setNewSectionCapacity] = useState('');

  // Edit section modal state
  const [editingSection, setEditingSection] = useState<SectionItem | null>(null);
  const [editSectionName, setEditSectionName] = useState('');
  const [editSectionCapacity, setEditSectionCapacity] = useState('');

  // Delete confirmation state
  const [confirmState, setConfirmState] = useState<{
    type: 'grade' | 'section';
    id: number;
    title: string;
    message: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleCreateGrade(e: FormEvent) {
    e.preventDefault();
    if (!newGradeName.trim()) {
      onNotify('error', 'يرجى إدخال اسم الصف الدراسي.');
      return;
    }

    const initialSections = initialSectionsText
      .split(/[,،\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    setSubmittingGrade(true);
    try {
      await schoolService.createGrade({
        name: newGradeName.trim(),
        stage: newGradeStage || null,
        initial_sections: initialSections,
      });
      onNotify('success', `تمت إضافة الصف "${newGradeName.trim()}" بنجاح.`);
      setNewGradeName('');
      setNewGradeStage('');
      setInitialSectionsText('');
      setShowAddGrade(false);
      await onRefresh();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر إضافة الصف.');
    } finally {
      setSubmittingGrade(false);
    }
  }

  async function handleUpdateGrade(e: FormEvent) {
    e.preventDefault();
    if (!editingGrade) return;
    if (!editGradeName.trim()) {
      onNotify('error', 'يرجى إدخال اسم الصف الدراسي.');
      return;
    }

    setSubmittingGrade(true);
    try {
      await schoolService.updateGrade(
        editingGrade.id,
        editGradeName.trim(),
        editGradeStage || null
      );
      onNotify('success', 'تم تعديل بيانات الصف بنجاح.');
      setEditingGrade(null);
      await onRefresh();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر تعديل اسم الصف.');
    } finally {
      setSubmittingGrade(false);
    }
  }

  async function handleAddSections(e: FormEvent) {
    e.preventDefault();
    if (!addingSectionsGrade) return;

    const names = newSectionsInput
      .split(/[,،\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (names.length === 0) {
      onNotify('error', 'يرجى إدخال اسم شعبة واحد على الأقل.');
      return;
    }

    const cap = newSectionCapacity.trim() ? Number(newSectionCapacity.trim()) : null;

    setSubmittingGrade(true);
    try {
      await schoolService.createSections(addingSectionsGrade.id, names, cap);
      onNotify('success', `تمت إضافة ${names.length} شعبة إلى ${addingSectionsGrade.name}.`);
      setAddingSectionsGrade(null);
      setNewSectionsInput('');
      setNewSectionCapacity('');
      await onRefresh();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر إضافة الشعب.');
    } finally {
      setSubmittingGrade(false);
    }
  }

  async function handleUpdateSection(e: FormEvent) {
    e.preventDefault();
    if (!editingSection) return;
    if (!editSectionName.trim()) {
      onNotify('error', 'يرجى إدخال اسم الشعبة.');
      return;
    }

    const cap = editSectionCapacity.trim() ? Number(editSectionCapacity.trim()) : null;
    setSubmittingGrade(true);
    try {
      await schoolService.updateSection(editingSection.id, editSectionName.trim(), cap);
      onNotify('success', 'تم تعديل بيانات الشعبة بنجاح.');
      setEditingSection(null);
      await onRefresh();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر تعديل الشعبة.');
    } finally {
      setSubmittingGrade(false);
    }
  }

  async function handleConfirmDelete() {
    if (!confirmState) return;
    setDeleting(true);
    try {
      if (confirmState.type === 'grade') {
        await schoolService.deleteGrade(confirmState.id);
        onNotify('success', 'تم حذف الصف الدراسي بنجاح.');
      } else {
        await schoolService.deleteSection(confirmState.id);
        onNotify('success', 'تم حذف الشعبة بنجاح.');
      }
      setConfirmState(null);
      await onRefresh();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر تنفيذ الحذف.');
      setConfirmState(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 font-display">
            إدارة الصفوف والشعب الدراسية
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
            تعريف الصفوف والشعب بشكل ديناميكي حسب هيكلية المدرسة مع حماية سلامة البيانات عند الحذف
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAddGrade(true)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 w-full sm:w-auto"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة صف دراسي</span>
        </button>
      </div>

      {/* Empty State */}
      {!loading && grades.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 sm:p-12 text-center">
          <div className="w-14 h-14 rounded-xl bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-400 mx-auto flex items-center justify-center mb-4">
            <Layers className="w-7 h-7" />
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            لم يتم تعريف أي صفوف دراسية بعد
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">
            أضف صفوف المدرسة وشعبها (مثل: الأول المتوسط - شعب أ، ب، ج) لتتمكن من تسجيل الطلاب
            وتنزيل قالب Excel الموحد.
          </p>
          <button
            type="button"
            onClick={() => setShowAddGrade(true)}
            className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة أول صف دراسي</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {grades.map((grade) => (
            <div
              key={grade.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
            >
              {/* Grade Header */}
              <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 sm:gap-4 bg-slate-50/70 dark:bg-slate-800/30">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                    {grade.name}
                  </h3>
                  <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {grade.stage ? STAGE_LABEL_MAP[grade.stage] : 'مرحلة غير محددة'} ·{' '}
                    {grade.sections.length.toLocaleString('ar-IQ')} شعب ·{' '}
                    {grade.student_count.toLocaleString('ar-IQ')} طالب
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAddingSectionsGrade(grade);
                      setNewSectionsInput('');
                      setNewSectionCapacity('');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
                  >
                    <FolderPlus className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
                    <span>إضافة شعب</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEditingGrade(grade);
                      setEditGradeName(grade.name);
                      setEditGradeStage(grade.stage ?? '');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>تعديل</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setConfirmState({
                        type: 'grade',
                        id: grade.id,
                        title: `حذف الصف "${grade.name}"`,
                        message:
                          'هل أنت متأكد من حذف هذا الصف الدراسي؟ يمنع النظام حذف أي صف يحتوي على شعب أو سجلات طلاب تاريخية حفاظاً على سلامة البيانات.',
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-white dark:bg-slate-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>حذف</span>
                  </button>
                </div>
              </div>

              {/* Sections Table */}
              {grade.sections.length === 0 ? (
                <div className="px-4 sm:px-5 py-5 sm:py-6 text-sm text-slate-500 dark:text-slate-400 flex flex-wrap items-center justify-between gap-3">
                  <span>لا توجد شعب معرفة لهذا الصف حتى الآن.</span>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingSectionsGrade(grade);
                      setNewSectionsInput('');
                    }}
                    className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline whitespace-nowrap"
                  >
                    + إضافة شعب لهذا الصف
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-right">
                    <thead className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900">
                      <tr>
                        <th className="py-2.5 px-4 sm:px-5 font-semibold whitespace-nowrap min-w-[120px]">
                          اسم الشعبة
                        </th>
                        <th className="py-2.5 px-4 font-semibold whitespace-nowrap">
                          عدد الطلاب الفعالين
                        </th>
                        <th className="py-2.5 px-4 font-semibold whitespace-nowrap">
                          السعة الاستيعابية
                        </th>
                        <th className="py-2.5 px-4 sm:px-5 font-semibold text-left whitespace-nowrap">
                          الإجراءات
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {grade.sections.map((sec) => (
                        <tr
                          key={sec.id}
                          className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                        >
                          <td className="py-3 px-4 sm:px-5 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            شعبة {sec.name}
                          </td>
                          <td className="py-3 px-4 text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              <Users className="w-3.5 h-3.5 text-slate-400" />
                              {sec.student_count.toLocaleString('ar-IQ')} طالب
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                            {sec.capacity ? `${sec.capacity.toLocaleString('ar-IQ')} طالب` : 'غير محددة'}
                          </td>
                          <td className="py-3 px-4 sm:px-5 text-left whitespace-nowrap">
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingSection(sec);
                                  setEditSectionName(sec.name);
                                  setEditSectionCapacity(sec.capacity ? String(sec.capacity) : '');
                                }}
                                className="px-2.5 py-1 rounded-md text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                              >
                                تعديل
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmState({
                                    type: 'section',
                                    id: sec.id,
                                    title: `حذف شعبة "${sec.name}"`,
                                    message: `هل أنت متأكد من حذف شعبة "${sec.name}" من ${grade.name}؟ سيمنع النظام الحذف إذا كانت الشعبة تحتوي على طلاب حاليين أو سجلات تاريخية.`,
                                  })
                                }
                                className="px-2.5 py-1 rounded-md text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                              >
                                حذف
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal: Add Grade */}
      {showAddGrade && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/50 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md max-h-[90dvh] rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden flex flex-col">
            <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                إضافة صف دراسي جديد
              </h3>
            </div>
            <form onSubmit={handleCreateGrade} className="p-4 sm:p-5 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  اسم الصف الدراسي <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newGradeName}
                  onChange={(e) => {
                    const next = e.target.value;
                    setNewGradeName(next);
                    if (!newGradeStage) {
                      const inferred = inferClientStage(next);
                      if (inferred) setNewGradeStage(inferred);
                    }
                  }}
                  placeholder="مثال: الأول المتوسط، الرابع العلمي..."
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  المرحلة الدراسية (لربط الضوابط القانونية)
                </label>
                <select
                  value={newGradeStage}
                  onChange={(e) => setNewGradeStage(e.target.value as EducationalStage | '')}
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                >
                  <option value="">غير محددة حالياً</option>
                  <option value="primary">المرحلة الابتدائية</option>
                  <option value="intermediate">المرحلة المتوسطة</option>
                  <option value="preparatory">المرحلة الإعدادية</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  الشعب المبدئية (اختياري)
                </label>
                <input
                  type="text"
                  value={initialSectionsText}
                  onChange={(e) => setInitialSectionsText(e.target.value)}
                  placeholder="مثال: أ، ب، ج (افصل بينها بفاصلة)"
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                />
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                  يمكنك إضافة شعب متعددة دفعة واحدة بفصلها بفاصلة أو إضافتها لاحقاً.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddGrade(false)}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submittingGrade}
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white transition-colors disabled:opacity-60"
                >
                  {submittingGrade ? 'جاري الحفظ...' : 'حفظ الصف'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Grade */}
      {editingGrade && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/50 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md max-h-[90dvh] rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden flex flex-col">
            <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                تعديل بيانات الصف الدراسي
              </h3>
            </div>
            <form onSubmit={handleUpdateGrade} className="p-4 sm:p-5 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  اسم الصف الدراسي <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editGradeName}
                  onChange={(e) => setEditGradeName(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  المرحلة الدراسية
                </label>
                <select
                  value={editGradeStage}
                  onChange={(e) => setEditGradeStage(e.target.value as EducationalStage | '')}
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                >
                  <option value="">غير محددة</option>
                  <option value="primary">المرحلة الابتدائية</option>
                  <option value="intermediate">المرحلة المتوسطة</option>
                  <option value="preparatory">المرحلة الإعدادية</option>
                </select>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingGrade(null)}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submittingGrade}
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white transition-colors disabled:opacity-60"
                >
                  حفظ التعديل
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Multiple Sections */}
      {addingSectionsGrade && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/50 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md max-h-[90dvh] rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden flex flex-col">
            <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                إضافة شعب إلى {addingSectionsGrade.name}
              </h3>
            </div>
            <form onSubmit={handleAddSections} className="p-4 sm:p-5 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  أسماء الشعب <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newSectionsInput}
                  onChange={(e) => setNewSectionsInput(e.target.value)}
                  placeholder="مثال: أ، ب، ج، د"
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                />
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                  يمكنك إدخال شعبة واحدة أو عدة شعب مفصولة بفاصلة.
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  السعة الاستيعابية لكل شعبة (اختياري)
                </label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={newSectionCapacity}
                  onChange={(e) => setNewSectionCapacity(e.target.value)}
                  placeholder="مثال: 35"
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30 tabular-nums"
                />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setAddingSectionsGrade(null)}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submittingGrade}
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white transition-colors disabled:opacity-60"
                >
                  إضافة الشعب
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Section */}
      {editingSection && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/50 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md max-h-[90dvh] rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden flex flex-col">
            <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                تعديل بيانات الشعبة
              </h3>
            </div>
            <form onSubmit={handleUpdateSection} className="p-4 sm:p-5 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  اسم الشعبة <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editSectionName}
                  onChange={(e) => setEditSectionName(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  السعة الاستيعابية (اختياري)
                </label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={editSectionCapacity}
                  onChange={(e) => setEditSectionCapacity(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30 tabular-nums"
                />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingSection(null)}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submittingGrade}
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white transition-colors disabled:opacity-60"
                >
                  حفظ التعديل
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title ?? ''}
        message={confirmState?.message ?? ''}
        confirmLabel="نعم، احذف"
        danger
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}
