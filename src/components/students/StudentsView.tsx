import {
  ArrowDownUp,
  ArrowLeftRight,
  BookOpen,
  Download,
  Edit3,
  FileSpreadsheet,
  Filter,
  Hash,
  History,
  RotateCcw,
  Search,
  Trash2,
  User,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNumberDisplay } from '../../contexts/NumberDisplayContext';
import { schoolService } from '../../services/schoolService';
import type {
  AcademicYear,
  GradeWithSections,
  StudentRecord,
  StudentStatus,
} from '../../types/school';
import { BidiText, LtrSpan } from '../common/BidirectionalText';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { ExcelImportModal } from './ExcelImportModal';
import { StudentFormModal } from './StudentFormModal';
import { StudentHistoryModal } from './StudentHistoryModal';
import { TransferStudentModal } from './TransferStudentModal';

interface StudentsViewProps {
  students: StudentRecord[];
  grades: GradeWithSections[];
  academicYears: AcademicYear[];
  selectedYearId: number | null;
  loading: boolean;
  search: string;
  filterGradeId: number | null;
  filterSectionId: number | null;
  filterStatus: StudentStatus | 'all';
  sortBy: 'full_name' | 'registry_number' | 'grade_name' | 'enrollment_date';
  sortDir: 'asc' | 'desc';
  onSearchChange: (value: string) => void;
  onFilterGradeChange: (gradeId: number | null) => void;
  onFilterSectionChange: (sectionId: number | null) => void;
  onFilterStatusChange: (status: StudentStatus | 'all') => void;
  onSortChange: (col: 'full_name' | 'registry_number' | 'grade_name' | 'enrollment_date') => void;
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

const STATUS_LABELS: Record<StudentStatus, string> = {
  active: 'مستمر',
  transferred_out: 'منقول خارج المدرسة',
  graduated: 'متخرج',
  archived: 'مؤرشف',
};

const STATUS_STYLE_MAP: Record<StudentStatus, string> = {
  active:
    'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/70',
  transferred_out:
    'text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/70',
  graduated:
    'text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800/70',
  archived:
    'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700',
};

export function StudentsView({
  students,
  grades,
  academicYears,
  selectedYearId,
  loading,
  search,
  filterGradeId,
  filterSectionId,
  filterStatus,
  sortBy,
  sortDir,
  onSearchChange,
  onFilterGradeChange,
  onFilterSectionChange,
  onFilterStatusChange,
  onSortChange,
  onRefresh,
  onNotify,
}: StudentsViewProps) {
  const { count, dateDMY, plain } = useNumberDisplay();
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [selectedStudent, setSelectedStudent] = useState<StudentRecord | null>(null);
  const [transferStudentTarget, setTransferStudentTarget] = useState<StudentRecord | null>(null);
  const [historyStudentTarget, setHistoryStudentTarget] = useState<StudentRecord | null>(null);
  const [excelModalOpen, setExcelModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StudentRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);

  const availableSectionsForFilter = useMemo(() => {
    if (!filterGradeId) return [];
    return grades.find((g) => g.id === filterGradeId)?.sections ?? [];
  }, [grades, filterGradeId]);

  const hasAnySection = useMemo(
    () => grades.some((g) => g.sections.length > 0),
    [grades]
  );

  const summary = useMemo(() => {
    let withRegistry = 0;
    let activeCount = 0;
    const gradeSet = new Set<number>();
    for (const st of students) {
      if (st.registry_number && st.registry_number.trim()) withRegistry += 1;
      if (st.status === 'active') activeCount += 1;
      if (st.grade_id) gradeSet.add(st.grade_id);
    }
    return {
      displayed: students.length,
      activeCount,
      withRegistry,
      representedGrades: gradeSet.size,
    };
  }, [students]);

  const hasActiveFilter =
    Boolean(search.trim()) ||
    filterGradeId !== null ||
    filterSectionId !== null ||
    filterStatus !== 'active';

  function handleResetFilters() {
    onSearchChange('');
    onFilterGradeChange(null);
    onFilterSectionChange(null);
    onFilterStatusChange('active');
  }

  function handleOpenCreate() {
    if (!hasAnySection) {
      onNotify(
        'error',
        'يرجى إضافة صف دراسي وشعبة واحدة على الأقل في قسم "إدارة الصفوف والشعب" قبل إضافة الطلاب.'
      );
      return;
    }
    setFormMode('create');
    setSelectedStudent(null);
    setFormOpen(true);
  }

  function handleOpenExcelImport() {
    if (!hasAnySection) {
      onNotify(
        'error',
        'يرجى تعريف الصفوف والشعب أولاً قبل تنزيل قالب Excel أو استيراد الطلاب.'
      );
      return;
    }
    setExcelModalOpen(true);
  }

  async function handleDownloadTemplateDirect() {
    setDownloadingTemplate(true);
    try {
      await schoolService.downloadExcelTemplate(selectedYearId ?? undefined);
      onNotify('success', 'تم تنزيل قالب Excel الموحد لجميع الصفوف والشعب.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر تنزيل قالب Excel.');
    } finally {
      setDownloadingTemplate(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await schoolService.deleteStudent(deleteTarget.id);
      onNotify('success', `تم حذف ملف الطالب "${deleteTarget.full_name}" بنجاح.`);
      setDeleteTarget(null);
      await onRefresh();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر حذف الطالب.');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Page Header & Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3.5 sm:gap-4">
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 font-display">
            سجل وإدارة الطلاب
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
            إدارة ملفات الطلبة، أرقام القيد، النقل بين الصفوف والشعب، والاستيراد الجماعي عبر Excel
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 w-full lg:w-auto">
          <button
            type="button"
            onClick={handleDownloadTemplateDirect}
            disabled={downloadingTemplate}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs sm:text-sm font-medium shadow-sm transition-colors whitespace-nowrap shrink-0 flex-1 sm:flex-initial min-h-[40px] disabled:opacity-60"
          >
            <Download className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            <span>{downloadingTemplate ? 'جاري التنزيل...' : 'تنزيل قالب Excel'}</span>
          </button>

          <button
            type="button"
            onClick={handleOpenExcelImport}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl border border-teal-200 dark:border-teal-800/70 bg-teal-50/70 dark:bg-teal-950/35 text-teal-800 dark:text-teal-300 hover:bg-teal-100/80 dark:hover:bg-teal-950/60 text-xs sm:text-sm font-semibold shadow-sm transition-colors whitespace-nowrap shrink-0 flex-1 sm:flex-initial min-h-[40px]"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>استيراد من Excel</span>
          </button>

          <button
            type="button"
            onClick={handleOpenCreate}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white text-sm font-semibold shadow-sm transition-colors whitespace-nowrap shrink-0 w-full sm:w-auto min-h-[40px]"
          >
            <UserPlus className="w-4 h-4" />
            <span>إضافة طالب جديد</span>
          </button>
        </div>
      </div>

      {/* Quiet Summary Stats Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3.5 shadow-sm flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
              الطلبة المعروضون
            </p>
            <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums font-display">
              {count(summary.displayed)}
            </p>
          </div>
          <span className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-100 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Users className="w-4 h-4" />
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3.5 shadow-sm flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
              المستمرون بالدوام
            </p>
            <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums font-display">
              {count(summary.activeCount)}
            </p>
          </div>
          <span className="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950/50 border border-teal-100 dark:border-teal-900/60 text-teal-700 dark:text-teal-400 flex items-center justify-center shrink-0">
            <UserCheck className="w-4 h-4" />
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3.5 shadow-sm flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
              بأرقام قيد مسجلة
            </p>
            <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums font-display">
              {count(summary.withRegistry)}
            </p>
          </div>
          <span className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0">
            <Hash className="w-4 h-4" />
          </span>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3.5 shadow-sm flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
              الصفوف في النتائج
            </p>
            <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums font-display">
              {count(summary.representedGrades)}
            </p>
          </div>
          <span className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0">
            <BookOpen className="w-4 h-4" />
          </span>
        </div>
      </div>

      {/* Search & Filters Toolbar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
            <Filter className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            <span>البحث والتصفية السريعة</span>
          </div>
          {hasActiveFilter && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>إعادة ضبط الفلاتر</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-12 gap-3">
          <div className="sm:col-span-3 lg:col-span-5 relative min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="بحث باسم الطالب، رقم القيد، المعرف الداخلي، أو الهاتف..."
              className="w-full pr-10 pl-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 min-h-[42px]"
            />
          </div>

          <div className="lg:col-span-3 min-w-0">
            <select
              aria-label="تصفية حسب الصف"
              value={filterGradeId ?? ''}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : null;
                onFilterGradeChange(val);
                onFilterSectionChange(null);
              }}
              className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 min-h-[42px]"
            >
              <option value="">جميع الصفوف</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2 min-w-0">
            <select
              aria-label="تصفية حسب الشعبة"
              value={filterSectionId ?? ''}
              onChange={(e) => onFilterSectionChange(e.target.value ? Number(e.target.value) : null)}
              disabled={!filterGradeId || availableSectionsForFilter.length === 0}
              className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 disabled:opacity-50 min-h-[42px]"
            >
              <option value="">جميع الشعب</option>
              {availableSectionsForFilter.map((s) => (
                <option key={s.id} value={s.id}>
                  شعبة {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2 min-w-0">
            <select
              aria-label="تصفية حسب حالة الطالب"
              value={filterStatus}
              onChange={(e) => onFilterStatusChange(e.target.value as StudentStatus | 'all')}
              className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600 min-h-[42px]"
            >
              <option value="active">الطلاب المستمرون</option>
              <option value="transferred_out">المنقولون للخارج</option>
              <option value="graduated">المتخرجون</option>
              <option value="archived">المؤرشفون</option>
              <option value="all">كل الحالات</option>
            </select>
          </div>
        </div>
      </div>

      {/* Students Data Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        {loading && students.length === 0 ? (
          <div className="p-6 sm:p-8 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
            ))}
          </div>
        ) : students.length === 0 ? (
          <div className="p-8 sm:p-12 text-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-100 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-400 mx-auto flex items-center justify-center mb-4">
              <Users className="w-7 h-7" />
            </div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 font-display">
              {hasActiveFilter ? 'لا توجد نتائج مطابقة للتصفية الحالية' : 'لا يوجد طلاب مسجلون بعد'}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-md mx-auto leading-relaxed">
              {hasActiveFilter
                ? 'جرّب تعديل كلمات البحث أو إعادة ضبط فلاتر الصف والشعبة والحالة.'
                : 'يمكنك إضافة الطلاب بشكل فردي أو استيراد قوائم كاملة دفعة واحدة عبر قالب Excel الموحد.'}
            </p>
            {hasActiveFilter ? (
              <button
                type="button"
                onClick={handleResetFilters}
                className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-sm font-medium transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                <span>إعادة ضبط البحث والفلاتر</span>
              </button>
            ) : (
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={handleOpenCreate}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm transition-colors whitespace-nowrap"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>إضافة أول طالب</span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenExcelImport}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-teal-200 dark:border-teal-800 text-teal-800 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/40 text-sm font-semibold transition-colors whitespace-nowrap"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>استيراد من Excel</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50/90 dark:bg-slate-800/60 text-xs text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3.5 px-4 sm:px-5 font-semibold min-w-[210px]">
                    <button
                      type="button"
                      onClick={() => onSortChange('full_name')}
                      className="inline-flex items-center gap-1.5 hover:text-emerald-700 dark:hover:text-emerald-400 whitespace-nowrap transition-colors"
                    >
                      <span>اسم الطالب</span>
                      <ArrowDownUp
                        className={`w-3.5 h-3.5 ${sortBy === 'full_name' ? 'text-emerald-600 dark:text-emerald-400' : 'opacity-40'}`}
                      />
                    </button>
                  </th>
                  <th className="py-3.5 px-4 font-semibold whitespace-nowrap">المعرف الداخلي</th>
                  <th className="py-3.5 px-4 font-semibold whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onSortChange('registry_number')}
                      className="inline-flex items-center gap-1.5 hover:text-emerald-700 dark:hover:text-emerald-400 whitespace-nowrap transition-colors"
                    >
                      <span>رقم القيد</span>
                      <ArrowDownUp
                        className={`w-3.5 h-3.5 ${sortBy === 'registry_number' ? 'text-emerald-600 dark:text-emerald-400' : 'opacity-40'}`}
                      />
                    </button>
                  </th>
                  <th className="py-3.5 px-4 font-semibold whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onSortChange('grade_name')}
                      className="inline-flex items-center gap-1.5 hover:text-emerald-700 dark:hover:text-emerald-400 whitespace-nowrap transition-colors"
                    >
                      <span>الصف والشعبة</span>
                      <ArrowDownUp
                        className={`w-3.5 h-3.5 ${sortBy === 'grade_name' ? 'text-emerald-600 dark:text-emerald-400' : 'opacity-40'}`}
                      />
                    </button>
                  </th>
                  <th className="py-3.5 px-4 font-semibold whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onSortChange('enrollment_date')}
                      className="inline-flex items-center gap-1.5 hover:text-emerald-700 dark:hover:text-emerald-400 whitespace-nowrap transition-colors"
                    >
                      <span>تاريخ التسجيل</span>
                      <ArrowDownUp
                        className={`w-3.5 h-3.5 ${sortBy === 'enrollment_date' ? 'text-emerald-600 dark:text-emerald-400' : 'opacity-40'}`}
                      />
                    </button>
                  </th>
                  <th className="py-3.5 px-4 font-semibold whitespace-nowrap">الهاتف</th>
                  <th className="py-3.5 px-4 sm:px-5 font-semibold text-left whitespace-nowrap">
                    الإجراءات
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {students.map((st) => (
                  <tr
                    key={st.id}
                    className="hover:bg-emerald-50/35 dark:hover:bg-emerald-950/20 transition-colors"
                  >
                    <td className="py-3.5 px-4 sm:px-5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 overflow-hidden flex items-center justify-center shrink-0">
                          {st.photo_data ? (
                            <img
                              src={st.photo_data}
                              alt={st.full_name}
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <User className="w-4 h-4 text-slate-400" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {st.full_name}
                          </p>
                          {st.status !== 'active' && (
                            <span
                              className={`inline-block mt-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${STATUS_STYLE_MAP[st.status]}`}
                            >
                              {STATUS_LABELS[st.status]}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono-tabular text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      <LtrSpan>{st.student_uid}</LtrSpan>
                    </td>
                    <td className="py-3.5 px-4 font-mono-tabular text-xs text-slate-800 dark:text-slate-200 font-medium whitespace-nowrap">
                      {st.registry_number ? (
                        <BidiText text={st.registry_number} />
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-slate-800 dark:text-slate-200 font-medium whitespace-nowrap">
                      <BidiText text={`${st.grade_name ?? '—'} · شعبة ${st.section_name ?? '—'}`} />
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                      {st.enrollment_date ? <LtrSpan>{dateDMY(st.enrollment_date)}</LtrSpan> : '—'}
                    </td>
                    <td className="py-3.5 px-4 font-mono-tabular text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {st.phone ? (
                        <LtrSpan>{plain(st.phone)}</LtrSpan>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 sm:px-5 text-left whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setHistoryStudentTarget(st)}
                          title="سجل التسجيل والتنقلات"
                          aria-label={`عرض سجل ${st.full_name}`}
                          className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                          <History className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setTransferStudentTarget(st)}
                          title="نقل إلى صف أو شعبة أخرى"
                          aria-label={`نقل ${st.full_name}`}
                          className="p-2 rounded-lg text-teal-700 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/40 transition-colors"
                        >
                          <ArrowLeftRight className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setFormMode('edit');
                            setSelectedStudent(st);
                            setFormOpen(true);
                          }}
                          title="تعديل بيانات الطالب"
                          aria-label={`تعديل ${st.full_name}`}
                          className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(st)}
                          title="حذف ملف الطالب"
                          aria-label={`حذف ${st.full_name}`}
                          className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
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

      {/* Hidden sortDir tracking attribute */}
      <span className="sr-only" data-sort-dir={sortDir} />

      <StudentFormModal
        open={formOpen}
        mode={formMode}
        student={selectedStudent}
        grades={grades}
        selectedYearId={selectedYearId}
        onClose={() => setFormOpen(false)}
        onSuccess={async (msg) => {
          onNotify('success', msg);
          await onRefresh();
        }}
        onError={(msg) => onNotify('error', msg)}
      />

      <TransferStudentModal
        open={Boolean(transferStudentTarget)}
        student={transferStudentTarget}
        grades={grades}
        academicYears={academicYears}
        selectedYearId={selectedYearId}
        onClose={() => setTransferStudentTarget(null)}
        onSuccess={async (msg) => {
          onNotify('success', msg);
          await onRefresh();
        }}
        onError={(msg) => onNotify('error', msg)}
      />

      <StudentHistoryModal
        open={Boolean(historyStudentTarget)}
        student={historyStudentTarget}
        onClose={() => setHistoryStudentTarget(null)}
      />

      <ExcelImportModal
        open={excelModalOpen}
        grades={grades}
        selectedYearId={selectedYearId}
        onClose={() => setExcelModalOpen(false)}
        onImported={async (msg) => {
          onNotify('success', msg);
          await onRefresh();
        }}
        onError={(msg) => onNotify('error', msg)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`حذف ملف الطالب "${deleteTarget?.full_name ?? ''}"`}
        message="هل أنت متأكد من حذف ملف هذا الطالب؟ إذا كان للطالب سجلات غياب تاريخية فسيمنع النظام الحذف ويمكنك تغيير حالته إلى منقول أو مؤرشف بدلاً من ذلك."
        confirmLabel="نعم، احذف"
        danger
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
