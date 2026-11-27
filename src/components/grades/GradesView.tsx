import {
  AlertCircle,
  BookOpen,
  Edit3,
  FolderKanban,
  FolderPlus,
  Layers,
  Plus,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useNumberDisplay } from '../../contexts/NumberDisplayContext';
import { schoolService } from '../../services/schoolService';
import type { EducationalStage, GradeWithSections, SectionItem } from '../../types/school';
import { BidiText } from '../common/BidirectionalText';
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
  const { count } = useNumberDisplay();

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

  const summary = useMemo(() => {
    let totalSections = 0;
    let totalStudents = 0;
    let gradesWithoutSections = 0;
    for (const g of grades) {
      totalSections += g.sections.length;
      totalStudents += g.student_count;
      if (g.sections.length === 0) gradesWithoutSections += 1;
    }
    return {
      totalGrades: grades.length,
      totalSections,
      totalStudents,
      gradesWithoutSections,
    };
  }, [grades]);

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
      onNotify('success', `تمت إضافة ${count(names.length)} شعبة إلى ${addingSectionsGrade.name}.`);
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
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3.5">
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 font-display">
            إدارة الصفوف والشعب الدراسية
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
            تعريف هيكلية الصفوف والشعب وتحديد السعة الاستيعابية لكل شعبة مع حماية سلامة السجلات
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAddGrade(true)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white text-sm font-semibold shadow-sm transition-colors whitespace-nowrap shrink-0 w-full sm:w-auto min-h-[42px]"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة صف دراسي</span>
        </button>
      </div>

      {/* Quiet Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 sm:gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3.5 shadow-sm flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              إجمالي الصفوف الدراسية
            </p>
            <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums font-display">
              {count(summary.totalGrades)}
            </p>
          </div>
          <span className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-100 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Layers className="w-5 h-5" />
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3.5 shadow-sm flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              إجمالي الشعب المفتوحة
            </p>
            <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums font-display">
              {count(summary.totalSections)}
            </p>
          </div>
          <span className="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-950/50 border border-teal-100 dark:border-teal-900/60 text-teal-700 dark:text-teal-400 flex items-center justify-center shrink-0">
            <FolderKanban className="w-5 h-5" />
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3.5 shadow-sm flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              الطلبة المسجلون في الشعب
            </p>
            <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums font-display">
              {count(summary.totalStudents)}
            </p>
          </div>
          <span className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" />
          </span>
        </div>
      </div>

      {/* Inline Structural Notice (if any grade has no sections yet) */}
      {!loading && summary.gradesWithoutSections > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/75 dark:bg-amber-950/25 px-4 py-3 flex items-start gap-2.5 text-xs sm:text-sm text-amber-900 dark:text-amber-200">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            يوجد <span className="font-bold tabular-nums">{count(summary.gradesWithoutSections)}</span>{' '}
            صف دراسي لا يحتوي على شعب بعد؛ أضف شعبة واحدة على الأقل لتتمكن من تسجيل الطلاب فيه.
          </p>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && grades.length === 0 ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-44 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse"
            />
          ))}
        </div>
      ) : grades.length === 0 ? (
        /* Empty State */
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-8 sm:p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-100 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-400 mx-auto flex items-center justify-center mb-4">
            <Layers className="w-7 h-7" />
          </div>
          <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 font-display">
            لم يتم تعريف أي صفوف دراسية بعد
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">
            أضف صفوف المدرسة وشعبها (مثل: الأول المتوسط - شعب أ، ب، ج) لتتمكن من تسجيل الطلاب
            وتنزيل قالب Excel الموحد.
          </p>
          <button
            type="button"
            onClick={() => setShowAddGrade(true)}
            className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة أول صف دراسي</span>
          </button>
        </div>
      ) : (
        /* Grades List */
        <div className="space-y-4 sm:space-y-5">
          {grades.map((grade) => (
            <section
              key={grade.id}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
            >
              {/* Grade Header */}
              <div className="px-4 sm:px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center md:justify-between gap-3.5 bg-slate-50/70 dark:bg-slate-800/35">
                <div className="flex items-start sm:items-center gap-3 min-w-0">
                  <span className="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-950/50 border border-teal-200/70 dark:border-teal-800/60 text-teal-700 dark:text-teal-400 flex items-center justify-center shrink-0">
                    <BookOpen className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 font-display truncate">
                      <BidiText text={grade.name} />
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                      <span className="font-medium text-teal-700 dark:text-teal-400">
                        {grade.stage ? STAGE_LABEL_MAP[grade.stage] : 'مرحلة غير محددة'}
                      </span>
                      <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <span>{count(grade.sections.length)} شعب</span>
                      <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                        ·
                      </span>
                      <span>{count(grade.student_count)} طالب</span>
                    </div>
                  </div>
                </div>

                {/* Grade Actions */}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setAddingSectionsGrade(grade);
                      setNewSectionsInput('');
                      setNewSectionCapacity('');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100/80 dark:hover:bg-emerald-950/50 text-xs font-semibold transition-colors whitespace-nowrap min-h-[36px]"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                    <span>إضافة شعب</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEditingGrade(grade);
                      setEditGradeName(grade.name);
                      setEditGradeStage(grade.stage ?? '');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium transition-colors whitespace-nowrap min-h-[36px]"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
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
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-medium transition-colors whitespace-nowrap min-h-[36px]"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>حذف</span>
                  </button>
                </div>
              </div>

              {/* Sections Table or Empty Section Notice */}
              {grade.sections.length === 0 ? (
                <div className="px-4 sm:px-5 py-6 text-sm text-slate-500 dark:text-slate-400 flex flex-wrap items-center justify-between gap-3">
                  <span>لا توجد شعب معرفة لهذا الصف حتى الآن.</span>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingSectionsGrade(grade);
                      setNewSectionsInput('');
                      setNewSectionCapacity('');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 transition-colors whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>إضافة شعب لهذا الصف</span>
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-right">
                    <thead className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/60">
                      <tr>
                        <th className="py-3 px-4 sm:px-5 font-semibold whitespace-nowrap min-w-[140px]">
                          اسم الشعبة
                        </th>
                        <th className="py-3 px-4 font-semibold whitespace-nowrap">
                          عدد الطلاب الفعالين
                        </th>
                        <th className="py-3 px-4 font-semibold whitespace-nowrap">
                          السعة الاستيعابية
                        </th>
                        <th className="py-3 px-4 sm:px-5 font-semibold text-left whitespace-nowrap">
                          الإجراءات
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {grade.sections.map((sec) => {
                        const overCapacity =
                          sec.capacity !== null &&
                          sec.capacity > 0 &&
                          sec.student_count > sec.capacity;

                        return (
                          <tr
                            key={sec.id}
                            className="hover:bg-emerald-50/35 dark:hover:bg-emerald-950/20 transition-colors"
                          >
                            <td className="py-3.5 px-4 sm:px-5 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                              <span className="inline-flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-teal-500 shrink-0" />
                                <span>
                                  شعبة <BidiText text={sec.name} />
                                </span>
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 font-medium">
                                <Users className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                                <span>{count(sec.student_count)} طالب</span>
                              </span>
                            </td>
                            <td className="py-3.5 px-4 tabular-nums whitespace-nowrap">
                              {sec.capacity ? (
                                <span
                                  className={`font-medium ${
                                    overCapacity
                                      ? 'text-amber-700 dark:text-amber-400'
                                      : 'text-slate-600 dark:text-slate-300'
                                  }`}
                                >
                                  {count(sec.capacity)} طالب
                                  {overCapacity ? ' (تجاوز السعة)' : ''}
                                </span>
                              ) : (
                                <span className="text-slate-400 dark:text-slate-500">غير محددة</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 sm:px-5 text-left whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingSection(sec);
                                    setEditSectionName(sec.name);
                                    setEditSectionCapacity(sec.capacity ? String(sec.capacity) : '');
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                >
                                  <Edit3 className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                                  <span>تعديل</span>
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
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>حذف</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {/* Modal: Add Grade */}
      {showAddGrade && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/55 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-grade-modal-title"
        >
          <div className="w-full max-w-md max-h-[90dvh] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 shrink-0">
                  <Layers className="w-4 h-4" />
                </span>
                <h3
                  id="add-grade-modal-title"
                  className="text-base font-bold text-slate-900 dark:text-slate-100 font-display truncate"
                >
                  إضافة صف دراسي جديد
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddGrade(false)}
                aria-label="إغلاق"
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateGrade} className="flex flex-col flex-1 min-h-0">
              <div className="p-5 space-y-4 overflow-y-auto flex-1">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    اسم الصف الدراسي <span className="text-rose-500">*</span>
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
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 min-h-[42px]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    المرحلة الدراسية (لربط الضوابط القانونية)
                  </label>
                  <select
                    value={newGradeStage}
                    onChange={(e) => setNewGradeStage(e.target.value as EducationalStage | '')}
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 min-h-[42px]"
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
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 min-h-[42px]"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                    يمكنك إضافة شعب متعددة دفعة واحدة بفصلها بفاصلة أو إضافتها لاحقاً.
                  </p>
                </div>
              </div>

              <div className="px-5 py-3.5 bg-slate-50/80 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowAddGrade(false)}
                  className="px-4 py-2 text-sm font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors min-h-[40px]"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submittingGrade}
                  className="px-5 py-2 text-sm font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors disabled:opacity-60 min-h-[40px]"
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
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/55 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-grade-modal-title"
        >
          <div className="w-full max-w-md max-h-[90dvh] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="p-2 rounded-xl bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-400 shrink-0">
                  <Edit3 className="w-4 h-4" />
                </span>
                <h3
                  id="edit-grade-modal-title"
                  className="text-base font-bold text-slate-900 dark:text-slate-100 font-display truncate"
                >
                  تعديل بيانات الصف الدراسي
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingGrade(null)}
                aria-label="إغلاق"
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateGrade} className="flex flex-col flex-1 min-h-0">
              <div className="p-5 space-y-4 overflow-y-auto flex-1">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    اسم الصف الدراسي <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editGradeName}
                    onChange={(e) => setEditGradeName(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 min-h-[42px]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    المرحلة الدراسية
                  </label>
                  <select
                    value={editGradeStage}
                    onChange={(e) => setEditGradeStage(e.target.value as EducationalStage | '')}
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 min-h-[42px]"
                  >
                    <option value="">غير محددة</option>
                    <option value="primary">المرحلة الابتدائية</option>
                    <option value="intermediate">المرحلة المتوسطة</option>
                    <option value="preparatory">المرحلة الإعدادية</option>
                  </select>
                </div>
              </div>

              <div className="px-5 py-3.5 bg-slate-50/80 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditingGrade(null)}
                  className="px-4 py-2 text-sm font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors min-h-[40px]"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submittingGrade}
                  className="px-5 py-2 text-sm font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors disabled:opacity-60 min-h-[40px]"
                >
                  {submittingGrade ? 'جاري الحفظ...' : 'حفظ التعديل'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Multiple Sections */}
      {addingSectionsGrade && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/55 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-sections-modal-title"
        >
          <div className="w-full max-w-md max-h-[90dvh] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 shrink-0">
                  <FolderPlus className="w-4 h-4" />
                </span>
                <h3
                  id="add-sections-modal-title"
                  className="text-base font-bold text-slate-900 dark:text-slate-100 font-display truncate"
                >
                  إضافة شعب إلى {addingSectionsGrade.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setAddingSectionsGrade(null)}
                aria-label="إغلاق"
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddSections} className="flex flex-col flex-1 min-h-0">
              <div className="p-5 space-y-4 overflow-y-auto flex-1">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    أسماء الشعب <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={newSectionsInput}
                    onChange={(e) => setNewSectionsInput(e.target.value)}
                    placeholder="مثال: أ، ب، ج، د"
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 min-h-[42px]"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
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
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 tabular-nums min-h-[42px]"
                  />
                </div>
              </div>

              <div className="px-5 py-3.5 bg-slate-50/80 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setAddingSectionsGrade(null)}
                  className="px-4 py-2 text-sm font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors min-h-[40px]"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submittingGrade}
                  className="px-5 py-2 text-sm font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors disabled:opacity-60 min-h-[40px]"
                >
                  {submittingGrade ? 'جاري الإضافة...' : 'إضافة الشعب'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Section */}
      {editingSection && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/55 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-section-modal-title"
        >
          <div className="w-full max-w-md max-h-[90dvh] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="p-2 rounded-xl bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-400 shrink-0">
                  <Edit3 className="w-4 h-4" />
                </span>
                <h3
                  id="edit-section-modal-title"
                  className="text-base font-bold text-slate-900 dark:text-slate-100 font-display truncate"
                >
                  تعديل بيانات الشعبة
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingSection(null)}
                aria-label="إغلاق"
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateSection} className="flex flex-col flex-1 min-h-0">
              <div className="p-5 space-y-4 overflow-y-auto flex-1">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    اسم الشعبة <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editSectionName}
                    onChange={(e) => setEditSectionName(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 min-h-[42px]"
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
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 tabular-nums min-h-[42px]"
                  />
                </div>
              </div>

              <div className="px-5 py-3.5 bg-slate-50/80 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditingSection(null)}
                  className="px-4 py-2 text-sm font-medium rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors min-h-[40px]"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submittingGrade}
                  className="px-5 py-2 text-sm font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors disabled:opacity-60 min-h-[40px]"
                >
                  {submittingGrade ? 'جاري الحفظ...' : 'حفظ التعديل'}
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
