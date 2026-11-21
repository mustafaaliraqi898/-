import {
  ArrowUpDown,
  BookOpen,
  Calendar,
  CalendarDays,
  CalendarOff,
  CheckCircle2,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Info,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { schoolService } from '../../services/schoolService';
import type {
  AcademicYear,
  GradeWithSections,
  MonthlyCellStatusKind,
  MonthlyDayCellData,
  MonthlyRegisterData,
  MonthlyStudentRow,
} from '../../types/school';
import { MonthlyDayDetailModal } from './MonthlyDayDetailModal';
import { MonthlyManualNoteModal } from './MonthlyManualNoteModal';
import {
  MonthlyPrintSheet,
  type PrintPaperPreset,
  resolveEffectivePrintSpec,
} from './MonthlyPrintSheet';

interface MonthlyRegisterViewProps {
  grades: GradeWithSections[];
  academicYears: AcademicYear[];
  selectedYearId: number | null;
  onSelectYear: (yearId: number) => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

const ARABIC_MONTH_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: '1 — كانون الثاني' },
  { value: 2, label: '2 — شباط' },
  { value: 3, label: '3 — آذار' },
  { value: 4, label: '4 — نيسان' },
  { value: 5, label: '5 — أيار' },
  { value: 6, label: '6 — حزيران' },
  { value: 7, label: '7 — تموز' },
  { value: 8, label: '8 — آب' },
  { value: 9, label: '9 — أيلول' },
  { value: 10, label: '10 — تشرين الأول' },
  { value: 11, label: '11 — تشرين الثاني' },
  { value: 12, label: '12 — كانون الأول' },
];

function getCellStyleClasses(kind: MonthlyCellStatusKind): string {
  switch (kind) {
    case 'full_day':
      return 'bg-red-100/90 dark:bg-red-950/60 text-red-900 dark:text-red-200 font-extrabold hover:bg-red-200/80 dark:hover:bg-red-900/70';
    case 'lesson_converted':
      return 'bg-purple-100/90 dark:bg-purple-950/60 text-purple-900 dark:text-purple-200 font-extrabold hover:bg-purple-200/80 dark:hover:bg-purple-900/70';
    case 'lesson_absence':
      return 'bg-amber-100/90 dark:bg-amber-950/55 text-amber-900 dark:text-amber-200 font-bold hover:bg-amber-200/80 dark:hover:bg-amber-900/70';
    case 'sick_leave':
      return 'bg-teal-100/90 dark:bg-teal-950/55 text-teal-900 dark:text-teal-200 font-bold hover:bg-teal-200/80 dark:hover:bg-teal-900/70';
    case 'daily_permission':
      return 'bg-sky-100/90 dark:bg-sky-950/55 text-sky-900 dark:text-sky-200 font-bold hover:bg-sky-200/80 dark:hover:bg-sky-900/70';
    case 'lesson_permission':
      return 'bg-indigo-100/90 dark:bg-indigo-950/55 text-indigo-900 dark:text-indigo-200 font-bold hover:bg-indigo-200/80 dark:hover:bg-indigo-900/70';
    case 'holiday':
      return 'bg-slate-200/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-bold hover:bg-slate-300/70 dark:hover:bg-slate-700/80';
    default:
      return 'bg-white dark:bg-slate-900 text-slate-400 dark:text-slate-500 font-normal hover:bg-slate-100 dark:hover:bg-slate-800/70';
  }
}

function getLegendSwatchClasses(symbol: string): string {
  switch (symbol) {
    case 'غ':
      return 'bg-red-100 dark:bg-red-950/60 border-red-300 dark:border-red-800 text-red-900 dark:text-red-200';
    case 'ج':
      return 'bg-purple-100 dark:bg-purple-950/60 border-purple-300 dark:border-purple-800 text-purple-900 dark:text-purple-200';
    case 'د':
      return 'bg-amber-100 dark:bg-amber-950/55 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200';
    case 'م':
      return 'bg-teal-100 dark:bg-teal-950/55 border-teal-300 dark:border-teal-800 text-teal-900 dark:text-teal-200';
    case 'ر':
      return 'bg-sky-100 dark:bg-sky-950/55 border-sky-300 dark:border-sky-800 text-sky-900 dark:text-sky-200';
    case 'ح':
      return 'bg-indigo-100 dark:bg-indigo-950/55 border-indigo-300 dark:border-indigo-800 text-indigo-900 dark:text-indigo-200';
    case 'ع':
      return 'bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200';
    default:
      return 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400';
  }
}

export function MonthlyRegisterView({
  grades,
  academicYears,
  selectedYearId,
  onSelectYear,
  onNotify,
}: MonthlyRegisterViewProps) {
  const now = useMemo(() => new Date(), []);
  const [calendarYear, setCalendarYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [gradeId, setGradeId] = useState<number | ''>('');
  const [sectionId, setSectionId] = useState<number | ''>('');

  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<'original' | 'alphabetical'>('original');
  const [paperPreset, setPaperPreset] = useState<PrintPaperPreset>('auto');

  const [registerData, setRegisterData] = useState<MonthlyRegisterData | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Modals
  const [selectedCellInfo, setSelectedCellInfo] = useState<{
    student: MonthlyStudentRow;
    cell: MonthlyDayCellData;
  } | null>(null);

  const [noteModalStudent, setNoteModalStudent] = useState<MonthlyStudentRow | null>(null);
  const [savingNote, setSavingNote] = useState(false);

  // Sync grade & section selections cleanly
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

  const calendarYearOptions = useMemo(() => {
    const currentY = new Date().getFullYear();
    const list: number[] = [];
    for (let y = currentY - 3; y <= currentY + 3; y += 1) {
      list.push(y);
    }
    if (!list.includes(calendarYear)) list.push(calendarYear);
    return list.sort((a, b) => b - a);
  }, [calendarYear]);

  const loadRegister = useCallback(async () => {
    if (!selectedYearId || !gradeId || !sectionId) {
      setRegisterData(null);
      return;
    }
    setLoading(true);
    try {
      const data = await schoolService.getMonthlyRegister({
        academic_year_id: selectedYearId,
        year: calendarYear,
        month,
        grade_id: Number(gradeId),
        section_id: Number(sectionId),
        sort_mode: sortMode,
      });
      setRegisterData(data);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر تحميل السجل الشهري للغيابات.');
      setRegisterData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedYearId, calendarYear, month, gradeId, sectionId, sortMode, onNotify]);

  useEffect(() => {
    void loadRegister();
  }, [loadRegister]);

  // Fast client-side search on already-loaded section register
  const displayedStudents = useMemo(() => {
    if (!registerData) return [];
    const term = search.trim().toLowerCase();
    if (!term) return registerData.students;
    return registerData.students.filter(
      (st) =>
        st.full_name.toLowerCase().includes(term) ||
        (st.registry_number ?? '').toLowerCase().includes(term) ||
        st.student_uid.toLowerCase().includes(term)
    );
  }, [registerData, search]);

  async function handleExportExcel() {
    if (!selectedYearId || !gradeId || !sectionId) return;
    setExporting(true);
    try {
      await schoolService.exportMonthlyExcel({
        academic_year_id: selectedYearId,
        year: calendarYear,
        month,
        grade_id: Number(gradeId),
        section_id: Number(sectionId),
        sort_mode: sortMode,
      });
      onNotify('success', 'تم تصدير السجل الشهري للغيابات إلى ملف Excel بنجاح.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر تصدير السجل إلى ملف Excel.');
    } finally {
      setExporting(false);
    }
  }

  function handlePrint() {
    if (!registerData) return;
    window.print();
  }

  async function handleSaveManualNote(noteText: string) {
    if (!registerData || !noteModalStudent) return;
    setSavingNote(true);
    try {
      await schoolService.saveMonthlyNote({
        academic_year_id: registerData.academic_year.id,
        student_id: noteModalStudent.student_id,
        year: registerData.year,
        month: registerData.month,
        note_text: noteText,
      });
      onNotify('success', 'تم حفظ الملاحظة الإدارية للطالب بنجاح.');
      setNoteModalStudent(null);
      await loadRegister();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر حفظ الملاحظة اليدوية.');
    } finally {
      setSavingNote(false);
    }
  }

  async function handleDeleteManualNote() {
    if (!registerData || !noteModalStudent) return;
    setSavingNote(true);
    try {
      await schoolService.deleteMonthlyNote({
        academic_year_id: registerData.academic_year.id,
        student_id: noteModalStudent.student_id,
        year: registerData.year,
        month: registerData.month,
      });
      onNotify('success', 'تم حذف الملاحظة الإدارية اليدوية.');
      setNoteModalStudent(null);
      await loadRegister();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر حذف الملاحظة اليدوية.');
    } finally {
      setSavingNote(false);
    }
  }

  const printSpec = resolveEffectivePrintSpec(paperPreset);

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Control & Filters Panel */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 font-display flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0" />
              السجل الشهري للغيابات المدرسية
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              عرض دفتر الغيابات الشهري المتكامل المرتبط مباشرةً بسجل الحضور وتراكم الدروس والإجازات
              والعطل.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadRegister()}
              disabled={loading || !gradeId || !sectionId}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              تحديث السجل
            </button>

            <button
              type="button"
              onClick={() => void handleExportExcel()}
              disabled={exporting || loading || !registerData}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-emerald-700/20 dark:border-emerald-500/30 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {exporting ? (
                <Download className="w-3.5 h-3.5 animate-bounce" />
              ) : (
                <FileSpreadsheet className="w-3.5 h-3.5" />
              )}
              {exporting ? 'جاري التصدير...' : 'تصدير Excel'}
            </button>

            <button
              type="button"
              onClick={handlePrint}
              disabled={loading || !registerData}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold transition-colors disabled:opacity-50"
            >
              <Printer className="w-3.5 h-3.5" />
              طباعة السجل
            </button>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 pt-1">
          <div>
            <label
              htmlFor="monthly-academic-year"
              className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1"
            >
              السنة الدراسية
            </label>
            <select
              id="monthly-academic-year"
              value={selectedYearId ?? ''}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v) onSelectYear(v);
              }}
              className="w-full h-9.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
            >
              {academicYears.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name} {y.is_active ? '(الحالية)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="monthly-month"
              className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1"
            >
              الشهر
            </label>
            <select
              id="monthly-month"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="w-full h-9.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
            >
              {ARABIC_MONTH_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="monthly-cal-year"
              className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1"
            >
              السنة الميلادية
            </label>
            <select
              id="monthly-cal-year"
              value={calendarYear}
              onChange={(e) => setCalendarYear(Number(e.target.value))}
              className="w-full h-9.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 text-xs font-semibold text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-600/30"
            >
              {calendarYearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="monthly-grade"
              className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1"
            >
              الصف الدراسي
            </label>
            <select
              id="monthly-grade"
              value={gradeId}
              onChange={(e) => {
                const gId = Number(e.target.value);
                setGradeId(gId || '');
                const found = grades.find((g) => g.id === gId);
                setSectionId(found && found.sections.length > 0 ? found.sections[0].id : '');
              }}
              className="w-full h-9.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
            >
              {grades.length === 0 && <option value="">لا توجد صفوف</option>}
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="monthly-section"
              className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1"
            >
              الشعبة
            </label>
            <select
              id="monthly-section"
              value={sectionId}
              onChange={(e) => setSectionId(Number(e.target.value) || '')}
              className="w-full h-9.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
            >
              {availableSections.length === 0 && <option value="">لا توجد شعب</option>}
              {availableSections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="monthly-paper-preset"
              className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1"
            >
              ورق واتجاه الطباعة
            </label>
            <select
              id="monthly-paper-preset"
              value={paperPreset}
              onChange={(e) => setPaperPreset(e.target.value as PrintPaperPreset)}
              className="w-full h-9.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
            >
              <option value="auto">تلقائي (A3 أفقي — الأنسب)</option>
              <option value="a3-landscape">A3 أفقي (صفحة واحدة)</option>
              <option value="a4-landscape">A4 أفقي (مقسم تلقائياً)</option>
              <option value="a4-portrait">A4 عمودي (مقسم تلقائياً)</option>
              <option value="a3-portrait">A3 عمودي (مقسم تلقائياً)</option>
            </select>
          </div>
        </div>

        {/* Search & Sort Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث سريع عن طالب بالاسم أو رقم القيد..."
              className="w-full h-9 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 pr-9 pl-3 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() =>
                setSortMode((prev) => (prev === 'original' ? 'alphabetical' : 'original'))
              }
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
                sortMode === 'alphabetical'
                  ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300'
                  : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              {sortMode === 'original' ? 'الترتيب: الأصلي للشعبة' : 'الترتيب: أبجدي مؤقت'}
            </button>

            <span className="text-[11px] text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800/50">
              وضع الطباعة المحدد: <strong className="text-slate-700 dark:text-slate-200">{printSpec.label}</strong>
            </span>
          </div>
        </div>
      </section>

      {/* Top Statistics Summary (8 cards) */}
      {registerData && (
        <section
          aria-label="ملخص إحصائيات السجل الشهري"
          className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2.5 sm:gap-3"
        >
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-[11px] font-semibold">
              <span>طلاب الشعبة</span>
              <Users className="w-4 h-4 text-teal-700 dark:text-teal-400" />
            </div>
            <p className="text-xl font-extrabold text-slate-900 dark:text-slate-100 mt-1.5 font-display tabular-nums">
              {registerData.stats.total_students}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-[11px] font-semibold">
              <span>لديهم غياب</span>
              <UserX className="w-4 h-4 text-red-600 dark:text-red-400" />
            </div>
            <p className="text-xl font-extrabold text-red-700 dark:text-red-300 mt-1.5 font-display tabular-nums">
              {registerData.stats.students_with_counted_absence}
            </p>
          </div>

          <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/40 dark:bg-red-950/20 p-3.5">
            <div className="flex items-center justify-between text-red-700 dark:text-red-300 text-[11px] font-semibold">
              <span>الغياب المحتسب</span>
              <ClipboardList className="w-4 h-4 text-red-600 dark:text-red-400" />
            </div>
            <p className="text-xl font-extrabold text-red-800 dark:text-red-200 mt-1.5 font-display tabular-nums">
              {registerData.stats.total_counted_absence_days}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-[11px] font-semibold">
              <span>الغياب المباشر</span>
              <Calendar className="w-4 h-4 text-rose-600 dark:text-rose-400" />
            </div>
            <p className="text-xl font-extrabold text-slate-900 dark:text-slate-100 mt-1.5 font-display tabular-nums">
              {registerData.stats.total_direct_full_days}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-[11px] font-semibold">
              <span>تراكم الدروس</span>
              <BookOpen className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            </div>
            <p className="text-xl font-extrabold text-purple-800 dark:text-purple-300 mt-1.5 font-display tabular-nums">
              {registerData.stats.total_converted_lesson_days}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-[11px] font-semibold">
              <span>إجازات مرضية</span>
              <UserCheck className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            </div>
            <p className="text-xl font-extrabold text-teal-800 dark:text-teal-300 mt-1.5 font-display tabular-nums">
              {registerData.stats.total_sick_leave_days}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-[11px] font-semibold">
              <span>رخص يومية</span>
              <FileText className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            </div>
            <p className="text-xl font-extrabold text-sky-800 dark:text-sky-300 mt-1.5 font-display tabular-nums">
              {registerData.stats.total_daily_permission_days}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-[11px] font-semibold">
              <span>رخص الدروس</span>
              <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            </div>
            <p className="text-xl font-extrabold text-indigo-800 dark:text-indigo-300 mt-1.5 font-display tabular-nums">
              {registerData.stats.total_lesson_permission_records}
            </p>
          </div>
        </section>
      )}

      {/* Legend Card (دليل الرموز) */}
      {registerData && (
        <section
          aria-label="دليل رموز السجل الشهري"
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
              دليل الرموز المعتمدة في السجل الشهري
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              ملاحظة: الرقم بجانب (د) أو (ح) يمثل عدد الدروس، وعند النقر على أي خلية تُعرض التفاصيل
              الكاملة وأرقام الدروس أو سبب العطلة.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {registerData.legend.map((item) => (
              <div
                key={item.symbol}
                className="flex items-start gap-2.5 p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40"
              >
                <span
                  className={`w-8 h-8 rounded-md border flex items-center justify-center text-sm font-extrabold shrink-0 font-display ${getLegendSwatchClasses(
                    item.symbol
                  )}`}
                >
                  {item.symbol}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    {item.label}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Main Register Table Container (Isolated Horizontal Scroll, Sticky Right Student Name) */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {registerData && (
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/90 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <span>
                سجل شهر {registerData.month_name} {registerData.year} — {registerData.grade_name} /{' '}
                {registerData.section_name}
              </span>
              <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400 tabular-nums">
                ({registerData.days_in_month} يوماً)
              </span>
            </div>

            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-3 tabular-nums">
              <span>
                نصاب احتساب اليوم: <strong>{registerData.school_settings.lessons_per_absence_day}</strong>{' '}
                دروس
              </span>
              <span>
                عرض: <strong>{displayedStudents.length}</strong> من{' '}
                <strong>{registerData.students.length}</strong> طالب
              </span>
            </div>
          </div>
        )}

        {loading ? (
          <div className="p-12 text-center text-sm text-slate-500 dark:text-slate-400">
            جاري تحميل بيانات السجل الشهري من قاعدة البيانات...
          </div>
        ) : !gradeId || !sectionId ? (
          <div className="p-12 text-center space-y-2">
            <CalendarOff className="w-10 h-10 text-slate-400 mx-auto" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
              يرجى اختيار الصف والشعبة لعرض السجل الشهري للغيابات.
            </p>
          </div>
        ) : !registerData || registerData.students.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Users className="w-10 h-10 text-slate-400 mx-auto" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
              لا يوجد طلاب منتمون لهذه الشعبة خلال هذا الشهر.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              تأكد من إضافة طلاب إلى الشعبة أو التحقق من تواريخ الانتساب والنقل في السنة الدراسية.
            </p>
          </div>
        ) : displayedStudents.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <Search className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              لا توجد نتائج مطابقة لعبارة البحث «{search}».
            </p>
          </div>
        ) : (
          <div className="w-full max-w-full overflow-x-auto max-h-[72vh] overflow-y-auto">
            <table className="w-max min-w-full border-collapse text-xs tabular-nums">
              <thead className="sticky top-0 z-30">
                <tr className="bg-slate-800 dark:bg-slate-950 text-white">
                  {/* Sticky Right Student Name Column */}
                  <th className="sticky right-0 z-40 bg-teal-800 dark:bg-teal-900 border-b border-l-2 border-slate-600 dark:border-slate-700 px-3 py-2.5 text-right min-w-[205px] max-w-[240px]">
                    <div className="font-bold">اسم الطالب</div>
                    <div className="text-[10px] font-normal text-teal-100 mt-0.5">
                      الترتيب • رقم القيد
                    </div>
                  </th>

                  {/* Days 1..daysInMonth */}
                  {registerData.calendar_days.map((calDay) => (
                    <th
                      key={calDay.day_of_month}
                      title={`${calDay.day_name} — ${calDay.date}${
                        calDay.reason ? ` (${calDay.reason})` : ''
                      }`}
                      className={`border-b border-l border-slate-700 px-1 py-2 text-center min-w-[36px] ${
                        calDay.is_holiday
                          ? 'bg-slate-600 dark:bg-slate-800 text-slate-100'
                          : 'bg-slate-800 dark:bg-slate-950'
                      }`}
                    >
                      <div className="text-[11px] font-extrabold leading-tight">
                        {calDay.day_of_month}
                      </div>
                      <div className="text-[9.5px] font-normal opacity-85 leading-tight mt-0.5 whitespace-nowrap">
                        {calDay.day_name.replace('ال', '')}
                      </div>
                    </th>
                  ))}

                  {/* 7 Summary Columns */}
                  <th className="border-b border-l border-slate-700 bg-slate-800 dark:bg-slate-950 px-2 py-2 text-center min-w-[74px] leading-tight">
                    مجموع الغياب المباشر
                  </th>
                  <th className="border-b border-l border-slate-700 bg-slate-800 dark:bg-slate-950 px-2 py-2 text-center min-w-[88px] leading-tight">
                    أيام تراكم الدروس
                  </th>
                  <th className="border-b border-l border-slate-700 bg-slate-800 dark:bg-slate-950 px-2 py-2 text-center min-w-[74px] leading-tight">
                    مجموع الدروس الغائبة
                  </th>
                  <th className="border-b border-l border-slate-700 bg-slate-800 dark:bg-slate-950 px-2 py-2 text-center min-w-[74px] leading-tight">
                    الإجازات المرضية
                  </th>
                  <th className="border-b border-l border-slate-700 bg-slate-800 dark:bg-slate-950 px-2 py-2 text-center min-w-[70px] leading-tight">
                    الرخص اليومية
                  </th>
                  <th className="border-b border-l border-slate-700 bg-slate-800 dark:bg-slate-950 px-2 py-2 text-center min-w-[74px] leading-tight">
                    رخص الدروس
                  </th>
                  <th className="border-b border-l border-red-800 bg-red-900 dark:bg-red-950 px-2 py-2 text-center min-w-[82px] leading-tight font-extrabold">
                    مجموع الغياب المحتسب
                  </th>

                  {/* Notes Column */}
                  <th className="border-b border-slate-700 bg-slate-800 dark:bg-slate-950 px-3 py-2 text-right min-w-[290px]">
                    الملاحظات (التلقائية واليدوية)
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {displayedStudents.map((st, rowIdx) => {
                  const rowBg =
                    rowIdx % 2 === 1
                      ? 'bg-slate-50/70 dark:bg-slate-900/60'
                      : 'bg-white dark:bg-slate-900';

                  return (
                    <tr key={st.student_id} className={rowBg}>
                      {/* Sticky Right Name Cell */}
                      <td
                        className={`sticky right-0 z-20 border-l-2 border-slate-300 dark:border-slate-700 px-3 py-2 text-right min-w-[205px] max-w-[240px] ${
                          rowIdx % 2 === 1
                            ? 'bg-slate-50 dark:bg-slate-900'
                            : 'bg-white dark:bg-slate-900'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-bold text-slate-900 dark:text-slate-100 truncate">
                              <span className="text-teal-700 dark:text-teal-400 ml-1">
                                {st.original_order}.
                              </span>
                              {st.full_name}
                            </p>
                            <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-slate-500 dark:text-slate-400 mt-0.5">
                              <span>{st.registry_number ? `قيد: ${st.registry_number}` : st.student_uid}</span>
                              {st.year_pending_lessons > 0 && (
                                <span className="text-amber-700 dark:text-amber-400 font-semibold">
                                  رصيد معلق: {st.year_pending_lessons} درس
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Day Cells 1..days_in_month */}
                      {registerData.calendar_days.map((calDay) => {
                        const cell = st.days[calDay.day_of_month];
                        return (
                          <td
                            key={calDay.day_of_month}
                            className="border-l border-slate-200 dark:border-slate-800 p-0 text-center"
                          >
                            <button
                              type="button"
                              onClick={() => setSelectedCellInfo({ student: st, cell })}
                              title={`${st.full_name} • ${calDay.day_name} ${calDay.date}`}
                              className={`w-full h-10 min-w-[36px] flex items-center justify-center text-xs transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-teal-600 ${getCellStyleClasses(
                                cell.status_kind
                              )} ${
                                cell.outside_section_membership && cell.status_kind === 'present'
                                  ? 'opacity-45'
                                  : ''
                              }`}
                            >
                              {cell.symbol}
                            </button>
                          </td>
                        );
                      })}

                      {/* 7 Totals Cells */}
                      <td className="border-l border-slate-200 dark:border-slate-800 px-2 py-2 text-center font-bold text-slate-800 dark:text-slate-200">
                        {st.direct_full_days}
                      </td>
                      <td className="border-l border-slate-200 dark:border-slate-800 px-2 py-2 text-center font-bold text-purple-800 dark:text-purple-300">
                        {st.converted_lesson_days}
                      </td>
                      <td className="border-l border-slate-200 dark:border-slate-800 px-2 py-2 text-center font-semibold text-amber-800 dark:text-amber-300">
                        {st.missed_lessons_count}
                      </td>
                      <td className="border-l border-slate-200 dark:border-slate-800 px-2 py-2 text-center font-semibold text-teal-800 dark:text-teal-300">
                        {st.sick_leave_days}
                      </td>
                      <td className="border-l border-slate-200 dark:border-slate-800 px-2 py-2 text-center font-semibold text-sky-800 dark:text-sky-300">
                        {st.daily_permission_days}
                      </td>
                      <td className="border-l border-slate-200 dark:border-slate-800 px-2 py-2 text-center font-semibold text-indigo-800 dark:text-indigo-300">
                        {st.lesson_permission_records}
                      </td>
                      <td
                        className={`border-l border-slate-200 dark:border-slate-800 px-2 py-2 text-center font-extrabold ${
                          st.total_counted_absence_days > 0
                            ? 'bg-red-50/80 dark:bg-red-950/35 text-red-800 dark:text-red-200'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {st.total_counted_absence_days}
                      </td>

                      {/* Notes Cell (Auto + Manual + Edit Button) */}
                      <td className="px-3 py-2 text-right min-w-[290px] max-w-[380px] align-top">
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1 text-[11px] leading-snug min-w-0 flex-1">
                            {st.auto_notes.map((note, idx) => (
                              <p
                                key={idx}
                                className="text-slate-700 dark:text-slate-300 border-r-2 border-purple-500 pr-1.5"
                              >
                                {note}
                              </p>
                            ))}

                            {st.manual_note && (
                              <p className="text-teal-900 dark:text-teal-200 font-semibold border-r-2 border-teal-600 pr-1.5 bg-teal-50/60 dark:bg-teal-950/30 py-0.5 rounded-l">
                                ملاحظة الإدارة: {st.manual_note}
                              </p>
                            )}

                            {st.auto_notes.length === 0 && !st.manual_note && (
                              <span className="text-slate-400 dark:text-slate-500">—</span>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => setNoteModalStudent(st)}
                            title={
                              st.manual_note
                                ? 'تعديل أو حذف الملاحظة اليدوية'
                                : 'إضافة ملاحظة إدارية يدوية'
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-teal-600 hover:text-teal-700 dark:hover:text-teal-300 text-[10.5px] font-semibold shrink-0 transition-colors"
                          >
                            {st.manual_note ? (
                              <>
                                <Pencil className="w-3 h-3" />
                                تعديل
                              </>
                            ) : (
                              <>
                                <Plus className="w-3 h-3" />
                                ملاحظة
                              </>
                            )}
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

        {/* Bottom Helpful Read-Only Note */}
        {registerData && registerData.students.length > 0 && (
          <div className="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
              انقر على أي خلية يوم لعرض تفاصيل الحالة أو الدروس أو العطلة. السجل الشهري للقراءة
              والتوثيق الإداري فقط.
            </span>
            <span>
              التعديل على حالات الحضور والغياب يتم حصراً من قسم «تسجيل الغيابات».
            </span>
          </div>
        )}
      </section>

      {/* Modals */}
      <MonthlyDayDetailModal
        open={Boolean(selectedCellInfo)}
        student={selectedCellInfo?.student ?? null}
        cell={selectedCellInfo?.cell ?? null}
        gradeName={registerData?.grade_name ?? ''}
        sectionName={registerData?.section_name ?? ''}
        onClose={() => setSelectedCellInfo(null)}
      />

      <MonthlyManualNoteModal
        open={Boolean(noteModalStudent)}
        student={noteModalStudent}
        monthName={registerData?.month_name ?? ''}
        year={registerData?.year ?? calendarYear}
        saving={savingNote}
        onSave={handleSaveManualNote}
        onDelete={handleDeleteManualNote}
        onClose={() => setNoteModalStudent(null)}
      />

      {/* Portal Print Sheet directly to document.body outside .no-print wrapper */}
      {typeof document !== 'undefined' &&
        createPortal(
          <MonthlyPrintSheet data={registerData} paperPreset={paperPreset} />,
          document.body
        )}
    </div>
  );
}
