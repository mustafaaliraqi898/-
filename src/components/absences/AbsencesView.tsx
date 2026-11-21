import {
  AlertCircle,
  Calendar,
  Check,
  CheckCheck,
  Clock,
  History,
  Minus,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  UserX,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AbsenceStatus,
  AcademicYear,
  GradeWithSections,
  SectionAttendanceSheet,
  StudentAbsenceDetailResponse,
} from '../../types/school';
import { schoolService } from '../../services/schoolService';
import { ConfirmDialog } from '../common/ConfirmDialog';

interface AbsencesViewProps {
  grades: GradeWithSections[];
  academicYears: AcademicYear[];
  selectedYearId: number | null;
  onSelectYear: (yearId: number) => void;
  onRefreshGlobalStats: () => Promise<void>;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

interface DraftEntry {
  status: AbsenceStatus;
  lessons_count: number;
  notes: string;
}

function getTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function AbsencesView({
  grades,
  academicYears,
  selectedYearId,
  onSelectYear,
  onRefreshGlobalStats,
  onNotify,
}: AbsencesViewProps) {
  const [gradeId, setGradeId] = useState<number | ''>('');
  const [sectionId, setSectionId] = useState<number | ''>('');
  const [attendanceDate, setAttendanceDate] = useState<string>(getTodayIso);

  const [sheet, setSheet] = useState<SectionAttendanceSheet | null>(null);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [draft, setDraft] = useState<Record<number, DraftEntry>>({});
  const [isDirty, setIsDirty] = useState(false);

  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<{
    recordId: number;
    studentName: string;
  } | null>(null);
  const [deletingRecord, setDeletingRecord] = useState(false);

  const [detailStudent, setDetailStudent] = useState<StudentAbsenceDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Auto-select first grade & section when grades load
  useEffect(() => {
    if (grades.length === 0) {
      setGradeId('');
      setSectionId('');
      return;
    }
    const currentGrade = grades.find((g) => g.id === Number(gradeId));
    if (!currentGrade) {
      const firstWithSec = grades.find((g) => g.sections.length > 0) ?? grades[0];
      setGradeId(firstWithSec.id);
      setSectionId(firstWithSec.sections[0]?.id ?? '');
    } else if (!currentGrade.sections.some((s) => s.id === Number(sectionId))) {
      setSectionId(currentGrade.sections[0]?.id ?? '');
    }
  }, [grades, gradeId, sectionId]);

  const availableSections = useMemo(() => {
    if (!gradeId) return [];
    return grades.find((g) => g.id === Number(gradeId))?.sections ?? [];
  }, [grades, gradeId]);

  const initializeDraftFromSheet = useCallback((loaded: SectionAttendanceSheet) => {
    const nextDraft: Record<number, DraftEntry> = {};
    for (const st of loaded.students) {
      nextDraft[st.student_id] = {
        status: st.status,
        lessons_count: st.status === 'lesson_absence' ? Math.max(1, st.lessons_count) : 0,
        notes: st.notes ?? '',
      };
    }
    setDraft(nextDraft);
    setIsDirty(false);
  }, []);

  const loadSheet = useCallback(async () => {
    if (!selectedYearId || !gradeId || !sectionId || !attendanceDate) {
      setSheet(null);
      return;
    }
    setLoadingSheet(true);
    try {
      const data = await schoolService.getSectionAttendanceSheet({
        academic_year_id: selectedYearId,
        grade_id: Number(gradeId),
        section_id: Number(sectionId),
        attendance_date: attendanceDate,
      });
      setSheet(data);
      initializeDraftFromSheet(data);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر تحميل قائمة طلاب الشعبة.');
      setSheet(null);
    } finally {
      setLoadingSheet(false);
    }
  }, [selectedYearId, gradeId, sectionId, attendanceDate, initializeDraftFromSheet, onNotify]);

  useEffect(() => {
    void loadSheet();
  }, [loadSheet]);

  function handleGradeChange(newGradeStr: string) {
    const gId = Number(newGradeStr);
    setGradeId(gId || '');
    const gObj = grades.find((g) => g.id === gId);
    setSectionId(gObj && gObj.sections.length > 0 ? gObj.sections[0].id : '');
  }

  function updateStudentStatus(studentId: number, status: AbsenceStatus) {
    setIsDirty(true);
    setDraft((prev) => {
      const current = prev[studentId] ?? { status: 'present', lessons_count: 0, notes: '' };
      return {
        ...prev,
        [studentId]: {
          ...current,
          status,
          lessons_count:
            status === 'lesson_absence'
              ? current.lessons_count >= 1
                ? current.lessons_count
                : 1
              : 0,
        },
      };
    });
  }

  function updateStudentLessons(studentId: number, lessons: number) {
    const clamped = Math.max(1, Math.min(12, Math.floor(lessons || 1)));
    setIsDirty(true);
    setDraft((prev) => {
      const current = prev[studentId] ?? { status: 'lesson_absence', lessons_count: 1, notes: '' };
      return {
        ...prev,
        [studentId]: {
          ...current,
          status: 'lesson_absence',
          lessons_count: clamped,
        },
      };
    });
  }

  function handleMarkAllPresent() {
    if (!sheet || sheet.students.length === 0) return;
    const nextDraft: Record<number, DraftEntry> = {};
    for (const st of sheet.students) {
      nextDraft[st.student_id] = {
        status: 'present',
        lessons_count: 0,
        notes: draft[st.student_id]?.notes ?? '',
      };
    }
    setDraft(nextDraft);
    setIsDirty(true);
  }

  function handleResetDraft() {
    if (!sheet) return;
    initializeDraftFromSheet(sheet);
    onNotify('info', 'تمت إعادة تعيين التعديلات غير المحفوظة إلى الحالة السابقة.');
  }

  const draftSummary = useMemo(() => {
    if (!sheet) return { present: 0, full_day: 0, lesson_absence: 0, total: 0 };
    let present = 0;
    let full_day = 0;
    let lesson_absence = 0;
    for (const st of sheet.students) {
      const entry = draft[st.student_id];
      const status = entry?.status ?? 'present';
      if (status === 'present') present += 1;
      else if (status === 'full_day') full_day += 1;
      else lesson_absence += 1;
    }
    return { present, full_day, lesson_absence, total: sheet.students.length };
  }, [sheet, draft]);

  async function handleConfirmSave() {
    if (!sheet || !selectedYearId) return;
    setSaving(true);
    try {
      const entries = sheet.students.map((st) => {
        const entry = draft[st.student_id] ?? { status: 'present', lessons_count: 0, notes: '' };
        return {
          student_id: st.student_id,
          status: entry.status,
          lessons_count: entry.status === 'lesson_absence' ? entry.lessons_count : 0,
          notes: entry.notes || null,
        };
      });

      const result = await schoolService.saveSectionAttendance({
        academic_year_id: selectedYearId,
        grade_id: sheet.grade_id,
        section_id: sheet.section_id,
        attendance_date: sheet.attendance_date,
        entries,
      });

      setSheet(result.sheet);
      initializeDraftFromSheet(result.sheet);
      setConfirmSaveOpen(false);

      const convertedNote =
        result.newly_converted_days > 0
          ? ` (تم احتساب ${result.newly_converted_days.toLocaleString('ar-IQ')} يوم غياب كامل تلقائياً لبلوغ حد الدروس)`
          : result.newly_converted_days < 0
            ? ' (تم تحديث رصيد الأيام المحتسبة من الدروس بعد التعديل)'
            : '';

      onNotify(
        'success',
        `تم حفظ سجل الغياب لـ ${result.saved_count.toLocaleString('ar-IQ')} طالب بنجاح${convertedNote}.`
      );
      await onRefreshGlobalStats();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر حفظ سجل الغياب.');
      setConfirmSaveOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDeleteRecord() {
    if (!deleteTarget) return;
    setDeletingRecord(true);
    try {
      await schoolService.deleteAbsenceRecord(deleteTarget.recordId);
      onNotify('success', `تم حذف سجل الغياب للطالب "${deleteTarget.studentName}" وإعادة حساب الرصيد.`);
      setDeleteTarget(null);
      await loadSheet();
      await onRefreshGlobalStats();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر حذف السجل.');
      setDeleteTarget(null);
    } finally {
      setDeletingRecord(false);
    }
  }

  async function handleOpenStudentDetail(studentId: number) {
    setLoadingDetail(true);
    try {
      const detail = await schoolService.getStudentAbsenceDetails(
        studentId,
        selectedYearId ?? undefined
      );
      setDetailStudent(detail);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر تحميل تفاصيل غياب الطالب.');
    } finally {
      setLoadingDetail(false);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Page Title */}
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 font-display">
            تسجيل الغيابات اليومية
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
            اختر السنة والصف والشعبة والتاريخ، ثم استخدم زر «الكل حاضر» أو حدد حالات الغياب الكامل
            وغياب الدروس
          </p>
        </div>

        {sheet && (
          <div className="text-xs text-slate-600 dark:text-slate-300 tabular-nums">
            حد الاحتساب الحالي:{' '}
            <span className="font-bold text-teal-700 dark:text-teal-400">
              {sheet.lessons_per_absence_day.toLocaleString('ar-IQ')} دروس = يوم غياب كامل
            </span>
          </div>
        )}
      </div>

      {/* Filter Selection Bar */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div>
          <label
            htmlFor="abs-year-select"
            className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5"
          >
            السنة الدراسية
          </label>
          <select
            id="abs-year-select"
            value={selectedYearId ?? ''}
            onChange={(e) => onSelectYear(Number(e.target.value))}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30 tabular-nums"
          >
            {academicYears.map((yr) => (
              <option key={yr.id} value={yr.id}>
                {yr.name}
                {yr.is_active ? ' (الفعالة)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="abs-grade-select"
            className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5"
          >
            الصف الدراسي
          </label>
          <select
            id="abs-grade-select"
            value={gradeId}
            onChange={(e) => handleGradeChange(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
          >
            {grades.length === 0 ? (
              <option value="">لا توجد صفوف</option>
            ) : (
              grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))
            )}
          </select>
        </div>

        <div>
          <label
            htmlFor="abs-section-select"
            className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5"
          >
            الشعبة
          </label>
          <select
            id="abs-section-select"
            value={sectionId}
            onChange={(e) => setSectionId(Number(e.target.value) || '')}
            disabled={availableSections.length === 0}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30 disabled:opacity-50"
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

        <div>
          <label
            htmlFor="abs-date-input"
            className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5"
          >
            تاريخ الغياب
          </label>
          <div className="relative">
            <input
              id="abs-date-input"
              type="date"
              value={attendanceDate}
              onChange={(e) => setAttendanceDate(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30 tabular-nums"
            />
          </div>
        </div>
      </div>

      {/* Quick Control Bar */}
      {sheet && sheet.students.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 sm:px-5 py-3.5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 sm:gap-4">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs">
            <span className="font-bold text-slate-800 dark:text-slate-100">
              {sheet.session ? 'سجل محفوظ مسبقاً لهذا التاريخ' : 'تسجيل جديد لهذا التاريخ'}
            </span>
            {sheet.session && (
              <>
                <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                  ·
                </span>
                <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                  آخر تحديث: {sheet.session.updated_at}
                </span>
              </>
            )}
            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
              ·
            </span>
            <span className="text-emerald-700 dark:text-emerald-400 font-semibold tabular-nums">
              حاضر: {draftSummary.present.toLocaleString('ar-IQ')}
            </span>
            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
              ·
            </span>
            <span className="text-red-600 dark:text-red-400 font-semibold tabular-nums">
              غياب يوم كامل: {draftSummary.full_day.toLocaleString('ar-IQ')}
            </span>
            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
              ·
            </span>
            <span className="text-amber-700 dark:text-amber-400 font-semibold tabular-nums">
              غياب دروس: {draftSummary.lesson_absence.toLocaleString('ar-IQ')}
            </span>
            {isDirty && (
              <>
                <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                  ·
                </span>
                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300 font-semibold">
                  <AlertCircle className="w-3.5 h-3.5" />
                  تعديلات غير محفوظة
                </span>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 w-full lg:w-auto">
            <button
              type="button"
              onClick={handleMarkAllPresent}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/70 text-xs font-bold transition-colors whitespace-nowrap shrink-0 flex-1 sm:flex-initial"
            >
              <CheckCheck className="w-4 h-4" />
              <span>الكل حاضر</span>
            </button>

            <button
              type="button"
              onClick={handleResetDraft}
              disabled={!isDirty}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-medium transition-colors whitespace-nowrap shrink-0 flex-1 sm:flex-initial disabled:opacity-40"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>إعادة تعيين</span>
            </button>

            <button
              type="button"
              onClick={() => setConfirmSaveOpen(true)}
              disabled={saving}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 text-white text-xs font-bold transition-colors whitespace-nowrap shrink-0 w-full sm:w-auto disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              <span>{sheet.session ? 'تأكيد وحفظ التعديلات' : 'حفظ سجل الغياب'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Attendance Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {loadingSheet ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
            ))}
          </div>
        ) : !gradeId || !sectionId ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 mx-auto flex items-center justify-center mb-3">
              <Calendar className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              يرجى تعريف الصفوف والشعب أولاً
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              لا توجد صفوف أو شعب متاحة لاختيارها وتسجيل الغياب لها.
            </p>
          </div>
        ) : !sheet || sheet.students.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 mx-auto flex items-center justify-center mb-3">
              <Users className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              لا يوجد طلاب مسجلون في هذه الشعبة
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              اختر صفاً وشعبة أخرى، أو قم بإضافة الطلاب إلى هذه الشعبة من قسم إدارة الطلاب.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-2.5 sm:px-3 font-semibold w-11 text-center whitespace-nowrap">
                    ت
                  </th>
                  <th className="py-3 px-3 sm:px-4 font-semibold min-w-[175px]">اسم الطالب</th>
                  <th className="py-3 px-3 font-semibold min-w-[265px] whitespace-nowrap">
                    حالة الحضور
                  </th>
                  <th className="py-3 px-2.5 font-semibold w-28 text-center whitespace-nowrap">
                    دروس اليوم
                  </th>
                  <th className="py-3 px-3 font-semibold min-w-[125px] whitespace-nowrap">
                    الدروس المتراكمة
                  </th>
                  <th className="py-3 px-3 font-semibold min-w-[140px] whitespace-nowrap">
                    أيام الغياب الكامل
                  </th>
                  <th className="py-3 px-3 font-semibold w-20 text-left whitespace-nowrap">
                    التفاصيل
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {sheet.students.map((st, idx) => {
                  const entry = draft[st.student_id] ?? {
                    status: st.status,
                    lessons_count: st.lessons_count,
                    notes: st.notes ?? '',
                  };

                  const rowTint =
                    entry.status === 'full_day'
                      ? 'bg-red-50/40 dark:bg-red-950/15'
                      : entry.status === 'lesson_absence'
                        ? 'bg-amber-50/40 dark:bg-amber-950/15'
                        : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30';

                  return (
                    <tr key={st.student_id} className={`transition-colors ${rowTint}`}>
                      <td className="py-3 px-2.5 sm:px-3 text-center font-mono-tabular text-xs text-slate-500 dark:text-slate-400">
                        {(idx + 1).toLocaleString('ar-IQ')}
                      </td>

                      <td className="py-3 px-3 sm:px-4">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          {st.full_name}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular mt-0.5 whitespace-nowrap">
                          {st.student_uid}
                          {st.registry_number ? ` · قيد: ${st.registry_number}` : ''}
                        </p>
                      </td>

                      <td className="py-3 px-3">
                        <div
                          className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                          role="group"
                          aria-label={`حالة حضور ${st.full_name}`}
                        >
                          <button
                            type="button"
                            onClick={() => updateStudentStatus(st.student_id, 'present')}
                            className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                              entry.status === 'present'
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                            }`}
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>حاضر</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => updateStudentStatus(st.student_id, 'full_day')}
                            className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                              entry.status === 'full_day'
                                ? 'bg-red-600 text-white shadow-sm'
                                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                            }`}
                          >
                            <UserX className="w-3.5 h-3.5" />
                            <span>غياب يوم كامل</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => updateStudentStatus(st.student_id, 'lesson_absence')}
                            className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                              entry.status === 'lesson_absence'
                                ? 'bg-amber-600 text-white shadow-sm'
                                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                            }`}
                          >
                            <Clock className="w-3.5 h-3.5" />
                            <span>غياب دروس</span>
                          </button>
                        </div>
                      </td>

                      <td className="py-3 px-2.5 text-center whitespace-nowrap">
                        {entry.status === 'lesson_absence' ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                updateStudentLessons(st.student_id, entry.lessons_count - 1)
                              }
                              aria-label="إنقاص درس"
                              className="w-7 h-7 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                            <input
                              type="number"
                              min={1}
                              max={12}
                              value={entry.lessons_count}
                              onChange={(e) =>
                                updateStudentLessons(st.student_id, Number(e.target.value))
                              }
                              aria-label={`عدد دروس الغياب لـ ${st.full_name}`}
                              className="w-11 py-1 text-center text-sm font-bold rounded-md border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-1 focus:ring-amber-500"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                updateStudentLessons(st.student_id, entry.lessons_count + 1)
                              }
                              aria-label="زيادة درس"
                              className="w-7 h-7 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">—</span>
                        )}
                      </td>

                      <td className="py-3 px-3 tabular-nums whitespace-nowrap">
                        <p className="font-bold text-slate-900 dark:text-slate-100">
                          {st.pending_lessons.toLocaleString('ar-IQ')} /{' '}
                          {sheet.lessons_per_absence_day.toLocaleString('ar-IQ')}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          الكلي: {st.total_lessons_missed.toLocaleString('ar-IQ')} درس
                        </p>
                      </td>

                      <td className="py-3 px-3 tabular-nums whitespace-nowrap">
                        <p className="font-bold text-slate-900 dark:text-slate-100">
                          {st.total_full_days.toLocaleString('ar-IQ')} يوم
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          مباشر: {st.direct_full_days.toLocaleString('ar-IQ')} · دروس:{' '}
                          {st.converted_lesson_days.toLocaleString('ar-IQ')}
                        </p>
                      </td>

                      <td className="py-3 px-3 text-left whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenStudentDetail(st.student_id)}
                            title="سجل غيابات الطالب التفصيلي"
                            className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          >
                            <History className="w-4 h-4" />
                          </button>
                          {st.has_saved_record && st.record_id && (
                            <button
                              type="button"
                              onClick={() =>
                                setDeleteTarget({
                                  recordId: st.record_id!,
                                  studentName: st.full_name,
                                })
                              }
                              title="حذف سجل هذا اليوم للطالب"
                              className="p-1.5 rounded-md text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirm Save Modal */}
      <ConfirmDialog
        open={confirmSaveOpen}
        title={sheet?.session ? 'تأكيد تعديل سجل الغياب السابق' : 'تأكيد حفظ سجل الغياب'}
        message={
          sheet?.session
            ? `توجد بيانات محفوظة مسبقاً لشعبة "${sheet.section_name}" بتاريخ ${sheet.attendance_date}. هل تريد حفظ التعديلات (حاضر: ${draftSummary.present}، غياب يوم كامل: ${draftSummary.full_day}، غياب دروس: ${draftSummary.lesson_absence}) وإعادة احتساب الأرصدة؟`
            : `هل تريد تأكيد حفظ سجل الحضور والغياب لشعبة "${sheet?.section_name ?? ''}" بتاريخ ${sheet?.attendance_date ?? ''}؟ (حاضر: ${draftSummary.present}، غياب يوم كامل: ${draftSummary.full_day}، غياب دروس: ${draftSummary.lesson_absence})`
        }
        confirmLabel={sheet?.session ? 'نعم، حفظ التعديلات' : 'نعم، احفظ السجل'}
        danger={false}
        loading={saving}
        onConfirm={handleConfirmSave}
        onCancel={() => setConfirmSaveOpen(false)}
      />

      {/* Confirm Delete Single Absence Record */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`حذف سجل اليوم للطالب "${deleteTarget?.studentName ?? ''}"`}
        message="هل أنت متأكد من حذف سجل الحضور/الغياب المحفوظ لهذا الطالب في التاريخ المحدد؟ سيقوم النظام بإعادة احتساب رصيد الدروس والأيام المحتسبة تلقائياً."
        confirmLabel="نعم، احذف السجل"
        danger
        loading={deletingRecord}
        onConfirm={handleConfirmDeleteRecord}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Student Detailed Absence History Modal */}
      {(detailStudent || loadingDetail) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/50 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-3xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden max-h-[90dvh] flex flex-col">
            <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 font-display truncate">
                  {loadingDetail
                    ? 'جاري تحميل سجل الطالب...'
                    : `السجل التفصيلي للغياب: ${detailStudent?.full_name ?? ''}`}
                </h3>
                {detailStudent && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums truncate">
                    {detailStudent.student_uid}
                    {detailStudent.registry_number ? ` · رقم القيد: ${detailStudent.registry_number}` : ''}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDetailStudent(null)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                إغلاق
              </button>
            </div>

            {detailStudent && (
              <div className="p-4 sm:p-6 overflow-y-auto space-y-5 sm:space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      إجمالي أيام الغياب
                    </p>
                    <p className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
                      {detailStudent.total_full_days.toLocaleString('ar-IQ')}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      غياب يوم كامل مباشر
                    </p>
                    <p className="text-xl font-bold text-red-600 dark:text-red-400 mt-1 tabular-nums">
                      {detailStudent.direct_full_days.toLocaleString('ar-IQ')}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      أيام محولة من الدروس
                    </p>
                    <p className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-1 tabular-nums">
                      {detailStudent.converted_lesson_days.toLocaleString('ar-IQ')}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      العداد المتراكم الحالي
                    </p>
                    <p className="text-xl font-bold text-teal-700 dark:text-teal-400 mt-1 tabular-nums">
                      {detailStudent.pending_lessons.toLocaleString('ar-IQ')} /{' '}
                      {detailStudent.lessons_per_absence_day.toLocaleString('ar-IQ')}
                    </p>
                  </div>
                </div>

                {/* Converted Days Log */}
                <div>
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                    الأيام المحتسبة نتيجة بلوغ حد الدروس ({detailStudent.conversions.length})
                  </h4>
                  {detailStudent.conversions.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      لم يصل عداد الدروس إلى حد التحويل بعد.
                    </p>
                  ) : (
                    <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
                      <table className="w-full text-xs text-right">
                        <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                          <tr>
                            <th className="py-2 px-3 font-semibold whitespace-nowrap">
                              تاريخ الاحتساب
                            </th>
                            <th className="py-2 px-3 font-semibold whitespace-nowrap">
                              الدروس المستهلكة
                            </th>
                            <th className="py-2 px-3 font-semibold whitespace-nowrap">
                              الحد المطبق
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {detailStudent.conversions.map((c) => (
                            <tr key={c.id}>
                              <td className="py-2 px-3 font-medium tabular-nums whitespace-nowrap">
                                {c.converted_date}
                              </td>
                              <td className="py-2 px-3 tabular-nums whitespace-nowrap">
                                {c.lessons_consumed.toLocaleString('ar-IQ')} دروس
                              </td>
                              <td className="py-2 px-3 tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                {c.threshold_used.toLocaleString('ar-IQ')} دروس
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Daily Records Log */}
                <div>
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
                    السجل اليومي المفصل ({detailStudent.records.length})
                  </h4>
                  {detailStudent.records.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      لا توجد سجلات حضور أو غياب مسجلة لهذا الطالب بعد.
                    </p>
                  ) : (
                    <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
                      <table className="w-full text-xs text-right">
                        <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                          <tr>
                            <th className="py-2 px-3 font-semibold whitespace-nowrap">التاريخ</th>
                            <th className="py-2 px-3 font-semibold whitespace-nowrap">
                              الصف والشعبة
                            </th>
                            <th className="py-2 px-3 font-semibold whitespace-nowrap">الحالة</th>
                            <th className="py-2 px-3 font-semibold whitespace-nowrap">
                              عدد الدروس
                            </th>
                            <th className="py-2 px-3 font-semibold whitespace-nowrap">
                              تاريخ التعديل
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {detailStudent.records.map((rec) => (
                            <tr key={rec.id}>
                              <td className="py-2 px-3 font-medium tabular-nums whitespace-nowrap">
                                {rec.absence_date}
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                {rec.grade_name} · شعبة {rec.section_name}
                              </td>
                              <td className="py-2 px-3 font-semibold whitespace-nowrap">
                                {rec.status === 'present' ? (
                                  <span className="text-emerald-700 dark:text-emerald-400">
                                    حاضر
                                  </span>
                                ) : rec.status === 'full_day' ? (
                                  <span className="text-red-600 dark:text-red-400">
                                    غياب يوم كامل
                                  </span>
                                ) : (
                                  <span className="text-amber-700 dark:text-amber-400">
                                    غياب دروس
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3 tabular-nums whitespace-nowrap">
                                {rec.status === 'lesson_absence'
                                  ? `${rec.lessons_count.toLocaleString('ar-IQ')} درس`
                                  : '—'}
                              </td>
                              <td className="py-2 px-3 text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
                                {rec.updated_at}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
