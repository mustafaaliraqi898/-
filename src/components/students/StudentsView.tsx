import {
  ArrowDownUp,
  ArrowLeftRight,
  Download,
  Edit3,
  FileSpreadsheet,
  History,
  Search,
  Trash2,
  User,
  UserPlus,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type {
  AcademicYear,
  GradeWithSections,
  StudentRecord,
  StudentStatus,
} from '../../types/school';
import { schoolService } from '../../services/schoolService';
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
    <div className="space-y-4 sm:space-y-5">
      {/* Page Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 font-display">
            سجل وإدارة الطلاب
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
            إجمالي النتائج المعروضة: {students.length.toLocaleString('ar-IQ')} طالب
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleDownloadTemplateDirect}
            disabled={downloadingTemplate}
            className="inline-flex items-center justify-center gap-2 px-3 sm:px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 flex-1 sm:flex-initial disabled:opacity-60"
          >
            <Download className="w-4 h-4 text-slate-500" />
            <span>{downloadingTemplate ? 'جاري التنزيل...' : 'تنزيل قالب Excel'}</span>
          </button>

          <button
            type="button"
            onClick={handleOpenExcelImport}
            className="inline-flex items-center justify-center gap-2 px-3 sm:px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 flex-1 sm:flex-initial"
          >
            <FileSpreadsheet className="w-4 h-4 text-teal-700 dark:text-teal-400" />
            <span>استيراد جماعي من Excel</span>
          </button>

          <button
            type="button"
            onClick={handleOpenCreate}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 w-full sm:w-auto"
          >
            <UserPlus className="w-4 h-4" />
            <span>إضافة طالب جديد</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-4 grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-12 gap-3">
        <div className="sm:col-span-3 lg:col-span-5 relative min-w-0">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="بحث باسم الطالب، رقم القيد، المعرف الداخلي، أو الهاتف..."
            className="w-full pr-9 pl-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
          />
        </div>

        <div className="lg:col-span-3 min-w-0">
          <select
            value={filterGradeId ?? ''}
            onChange={(e) => {
              const val = e.target.value ? Number(e.target.value) : null;
              onFilterGradeChange(val);
              onFilterSectionChange(null);
            }}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
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
            value={filterSectionId ?? ''}
            onChange={(e) => onFilterSectionChange(e.target.value ? Number(e.target.value) : null)}
            disabled={!filterGradeId || availableSectionsForFilter.length === 0}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30 disabled:opacity-50"
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
            value={filterStatus}
            onChange={(e) => onFilterStatusChange(e.target.value as StudentStatus | 'all')}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
          >
            <option value="active">الطلاب المستمرون</option>
            <option value="transferred_out">المنقولون للخارج</option>
            <option value="graduated">المتخرجون</option>
            <option value="archived">المؤرشفون</option>
            <option value="all">كل الحالات</option>
          </select>
        </div>
      </div>

      {/* Students Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {loading && students.length === 0 ? (
          <div className="p-6 sm:p-8 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
            ))}
          </div>
        ) : students.length === 0 ? (
          <div className="p-8 sm:p-12 text-center">
            <div className="w-14 h-14 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 mx-auto flex items-center justify-center mb-4">
              <Users className="w-7 h-7" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {search || filterGradeId ? 'لا توجد نتائج مطابقة للبحث' : 'لا يوجد طلاب مسجلون بعد'}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-md mx-auto leading-relaxed">
              {search || filterGradeId
                ? 'جرّب تغيير كلمات البحث أو إزالة فلاتر الصف والشعبة.'
                : 'يمكنك إضافة الطلاب بشكل فردي أو استيراد قوائم كاملة دفعة واحدة عبر قالب Excel الموحد.'}
            </p>
            {!search && !filterGradeId && (
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={handleOpenCreate}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors whitespace-nowrap"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>إضافة أول طالب</span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenExcelImport}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium transition-colors whitespace-nowrap"
                >
                  <FileSpreadsheet className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                  <span>استيراد من Excel</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-4 font-semibold min-w-[200px]">
                    <button
                      type="button"
                      onClick={() => onSortChange('full_name')}
                      className="inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap"
                    >
                      <span>اسم الطالب</span>
                      <ArrowDownUp
                        className={`w-3.5 h-3.5 ${sortBy === 'full_name' ? 'text-teal-600' : 'opacity-40'}`}
                      />
                    </button>
                  </th>
                  <th className="py-3 px-4 font-semibold whitespace-nowrap">المعرف الداخلي</th>
                  <th className="py-3 px-4 font-semibold whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onSortChange('registry_number')}
                      className="inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap"
                    >
                      <span>رقم القيد</span>
                      <ArrowDownUp
                        className={`w-3.5 h-3.5 ${sortBy === 'registry_number' ? 'text-teal-600' : 'opacity-40'}`}
                      />
                    </button>
                  </th>
                  <th className="py-3 px-4 font-semibold whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onSortChange('grade_name')}
                      className="inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap"
                    >
                      <span>الصف والشعبة</span>
                      <ArrowDownUp
                        className={`w-3.5 h-3.5 ${sortBy === 'grade_name' ? 'text-teal-600' : 'opacity-40'}`}
                      />
                    </button>
                  </th>
                  <th className="py-3 px-4 font-semibold whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onSortChange('enrollment_date')}
                      className="inline-flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap"
                    >
                      <span>تاريخ التسجيل</span>
                      <ArrowDownUp
                        className={`w-3.5 h-3.5 ${sortBy === 'enrollment_date' ? 'text-teal-600' : 'opacity-40'}`}
                      />
                    </button>
                  </th>
                  <th className="py-3 px-4 font-semibold whitespace-nowrap">الهاتف</th>
                  <th className="py-3 px-4 font-semibold text-left whitespace-nowrap">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {students.map((st) => (
                  <tr
                    key={st.id}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 overflow-hidden flex items-center justify-center shrink-0">
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
                            <p className="text-[11px] text-amber-700 dark:text-amber-400">
                              {STATUS_LABELS[st.status]}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono-tabular text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {st.student_uid}
                    </td>
                    <td className="py-3 px-4 font-mono-tabular text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {st.registry_number ?? (
                        <span className="text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-800 dark:text-slate-200 whitespace-nowrap">
                      {st.grade_name ?? '—'} · شعبة {st.section_name ?? '—'}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                      {st.enrollment_date ?? '—'}
                    </td>
                    <td className="py-3 px-4 font-mono-tabular text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {st.phone ?? <span className="text-slate-400 dark:text-slate-500">—</span>}
                    </td>
                    <td className="py-3 px-4 text-left whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setHistoryStudentTarget(st)}
                          title="سجل التسجيل والنقل"
                          className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                          <History className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setTransferStudentTarget(st)}
                          title="نقل إلى صف أو شعبة أخرى"
                          className="p-1.5 rounded-md text-slate-500 hover:text-teal-700 dark:hover:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/40 transition-colors"
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
                          className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(st)}
                          title="حذف ملف الطالب"
                          className="p-1.5 rounded-md text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
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

      {/* Hidden unused sortDir lint anchor */}
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
