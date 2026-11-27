import {
  AlertTriangle,
  ArrowUpDown,
  BookOpen,
  Calendar,
  CalendarDays,
  CalendarOff,
  CheckCircle2,
  ClipboardList,
  Download,
  ExternalLink,
  Eye,
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
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { MonthlyStudentNotesModal } from './MonthlyStudentNotesModal';
import {
  buildStandalonePrintableHtml,
  MonthlyPrintSheet,
  type PrintPaperPreset,
  resolveEffectivePrintSpec,
} from './MonthlyPrintSheet';
import { useNumberDisplay } from '../../contexts/NumberDisplayContext';
import { BidiText, LtrSpan } from '../common/BidirectionalText';

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
    case 'present':
      return 'bg-emerald-50/85 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-extrabold hover:bg-emerald-100/80 dark:hover:bg-emerald-900/50';
    case 'unrecorded':
      return 'bg-slate-50/40 dark:bg-slate-900/40 text-slate-300 dark:text-slate-600 font-normal hover:bg-slate-100 dark:hover:bg-slate-800/70';
    case 'full_day':
      return 'bg-red-100/90 dark:bg-red-950/60 text-red-900 dark:text-red-200 font-extrabold hover:bg-red-200/80 dark:hover:bg-red-900/70';
    case 'lesson_converted':
      return 'bg-purple-100/90 dark:bg-purple-950/60 text-purple-900 dark:text-purple-200 font-extrabold hover:bg-purple-200/80 dark:hover:bg-purple-900/70';
    case 'lesson_absence':
      return 'bg-amber-100/90 dark:bg-amber-950/55 text-amber-900 dark:text-amber-200 font-bold hover:bg-amber-200/80 dark:hover:bg-amber-900/70';
    case 'lesson_escape':
      return 'bg-orange-100/90 dark:bg-orange-950/55 text-orange-900 dark:text-orange-200 font-bold hover:bg-orange-200/80 dark:hover:bg-orange-900/70';
    case 'lesson_mixed':
      return 'bg-rose-100/90 dark:bg-rose-950/55 text-rose-900 dark:text-rose-200 font-bold text-[10px] hover:bg-rose-200/80 dark:hover:bg-rose-900/70';
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
    case '✓':
      return 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-extrabold';
    case 'غ':
      return 'bg-red-100 dark:bg-red-950/60 border-red-300 dark:border-red-800 text-red-900 dark:text-red-200';
    case 'د،غ':
      return 'bg-amber-100 dark:bg-amber-950/55 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200';
    case 'د،هـ':
      return 'bg-orange-100 dark:bg-orange-950/55 border-orange-300 dark:border-orange-800 text-orange-900 dark:text-orange-200';
    case 'م':
      return 'bg-teal-100 dark:bg-teal-950/55 border-teal-300 dark:border-teal-800 text-teal-900 dark:text-teal-200';
    case 'ر':
      return 'bg-sky-100 dark:bg-sky-950/55 border-sky-300 dark:border-sky-800 text-sky-900 dark:text-sky-200';
    case 'رخ':
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
  const { mode, academicYear, convert, count, plain } = useNumberDisplay();
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

  const [noteModalStudentId, setNoteModalStudentId] = useState<number | null>(null);
  const [notesModalStudentId, setNotesModalStudentId] = useState<number | null>(null);
  const [savingNote, setSavingNote] = useState(false);

  const noteModalStudent = useMemo(
    () =>
      noteModalStudentId !== null
        ? (registerData?.students.find((s) => s.student_id === noteModalStudentId) ?? null)
        : null,
    [registerData, noteModalStudentId]
  );

  const notesModalStudent = useMemo(
    () =>
      notesModalStudentId !== null
        ? (registerData?.students.find((s) => s.student_id === notesModalStudentId) ?? null)
        : null,
    [registerData, notesModalStudentId]
  );

  // Print preview & sandbox handling
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [printBlockedNotice, setPrintBlockedNotice] = useState(false);
  const [standaloneHtmlUrl, setStandaloneHtmlUrl] = useState<string | null>(null);
  const printTimerRef = useRef<number | null>(null);

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

  // Create and clean up standalone printable HTML Blob URL when preview is open
  useEffect(() => {
    if ((!printPreviewOpen && !printBlockedNotice) || !registerData) {
      setStandaloneHtmlUrl(null);
      return;
    }

    const html = buildStandalonePrintableHtml(registerData, paperPreset, mode);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    setStandaloneHtmlUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [printPreviewOpen, printBlockedNotice, registerData, paperPreset, mode]);

  useEffect(() => {
    return () => {
      if (printTimerRef.current !== null) {
        window.clearTimeout(printTimerRef.current);
      }
    };
  }, []);

  function handlePrint() {
    if (!registerData || loading) return;

    if (printTimerRef.current !== null) {
      window.clearTimeout(printTimerRef.current);
      printTimerRef.current = null;
    }

    setPrintBlockedNotice(false);

    // Wait two animation frames so portal #monthly-print-sheet & @page style are committed
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        let didTriggerBeforePrint = false;
        const onBeforePrint = () => {
          didTriggerBeforePrint = true;
        };

        window.addEventListener('beforeprint', onBeforePrint, { once: true });

        try {
          window.print();
        } catch {
          // Handled cleanly below when beforeprint did not fire
        }

        printTimerRef.current = window.setTimeout(() => {
          window.removeEventListener('beforeprint', onBeforePrint);
          printTimerRef.current = null;
          if (!didTriggerBeforePrint) {
            setPrintBlockedNotice(true);
            setPrintPreviewOpen(true);
            onNotify(
              'info',
              'بيئة المعاينة الحالية تمنع نافذة الطباعة المباشرة؛ تم فتح معاينة الطباعة مع خيار الفتح في تبويب جديد أو تنزيل نسخة HTML للطباعة.'
            );
          }
        }, 300);
      });
    });
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
      setNoteModalStudentId(null);
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
      setNoteModalStudentId(null);
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
              onClick={() => {
                setPrintBlockedNotice(false);
                setPrintPreviewOpen(true);
              }}
              disabled={loading || !registerData}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              <Eye className="w-3.5 h-3.5" />
              معاينة الطباعة
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
                  {academicYear(y.name)} {y.is_active ? '(الحالية)' : ''}
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
                  {convert(m.label)}
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
                  {plain(y)}
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
              {count(registerData.stats.total_students)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-[11px] font-semibold">
              <span>لديهم غياب</span>
              <UserX className="w-4 h-4 text-red-600 dark:text-red-400" />
            </div>
            <p className="text-xl font-extrabold text-red-700 dark:text-red-300 mt-1.5 font-display tabular-nums">
              {count(registerData.stats.students_with_counted_absence)}
            </p>
          </div>

          <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/40 dark:bg-red-950/20 p-3.5">
            <div className="flex items-center justify-between text-red-700 dark:text-red-300 text-[11px] font-semibold">
              <span>الغياب المحتسب</span>
              <ClipboardList className="w-4 h-4 text-red-600 dark:text-red-400" />
            </div>
            <p className="text-xl font-extrabold text-red-800 dark:text-red-200 mt-1.5 font-display tabular-nums">
              {count(registerData.stats.total_counted_absence_days)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-[11px] font-semibold">
              <span>الغياب المباشر</span>
              <Calendar className="w-4 h-4 text-rose-600 dark:text-rose-400" />
            </div>
            <p className="text-xl font-extrabold text-slate-900 dark:text-slate-100 mt-1.5 font-display tabular-nums">
              {count(registerData.stats.total_direct_full_days)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-[11px] font-semibold">
              <span>تراكم الدروس</span>
              <BookOpen className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            </div>
            <p className="text-xl font-extrabold text-purple-800 dark:text-purple-300 mt-1.5 font-display tabular-nums">
              {count(registerData.stats.total_converted_lesson_days)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-[11px] font-semibold">
              <span>إجازات مرضية</span>
              <UserCheck className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            </div>
            <p className="text-xl font-extrabold text-teal-800 dark:text-teal-300 mt-1.5 font-display tabular-nums">
              {count(registerData.stats.total_sick_leave_days)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-[11px] font-semibold">
              <span>رخص يومية</span>
              <FileText className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            </div>
            <p className="text-xl font-extrabold text-sky-800 dark:text-sky-300 mt-1.5 font-display tabular-nums">
              {count(registerData.stats.total_daily_permission_days)}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-[11px] font-semibold">
              <span>رخص الدروس</span>
              <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            </div>
            <p className="text-xl font-extrabold text-indigo-800 dark:text-indigo-300 mt-1.5 font-display tabular-nums">
              {count(registerData.stats.total_lesson_permission_records)}
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
              يظهر رمز (✓) في أعلى الخلية للدلالة على الحضور للدوام مع اختصار حالات الدروس تحته
              (د،غ / د،هـ / رخ). انقر على أي خلية لعرض التفاصيل الكاملة وأرقام الدروس أو سبب العطلة.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {registerData.legend.map((item) => (
              <div
                key={item.symbol}
                className="flex items-start gap-2.5 p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40"
              >
                <span
                  className={`min-w-[38px] px-1 h-8 rounded-md border flex items-center justify-center text-xs font-extrabold shrink-0 font-display whitespace-nowrap ${getLegendSwatchClasses(
                    item.symbol
                  )}`}
                >
                  {convert(item.symbol)}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    <BidiText text={item.label} />
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5">
                    <BidiText text={item.description} />
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
                سجل شهر {registerData.month_name} <LtrSpan>{plain(registerData.year)}</LtrSpan> —{' '}
                <BidiText text={`${registerData.grade_name} / ${registerData.section_name}`} />
              </span>
              <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400 tabular-nums">
                (<LtrSpan>{plain(registerData.days_in_month)}</LtrSpan> يوماً)
              </span>
            </div>

            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-3 tabular-nums">
              <span>
                نصاب احتساب اليوم:{' '}
                <strong>{count(registerData.school_settings.lessons_per_absence_day)}</strong> دروس
              </span>
              <span>
                عرض: <strong>{count(displayedStudents.length)}</strong> من{' '}
                <strong>{count(registerData.students.length)}</strong> طالب
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
                      className={`border-b border-l border-slate-700 px-1 py-2 text-center min-w-[40px] ${
                        calDay.is_holiday
                          ? 'bg-slate-600 dark:bg-slate-800 text-slate-100'
                          : 'bg-slate-800 dark:bg-slate-950'
                      }`}
                    >
                      <div className="text-[11px] font-extrabold leading-tight">
                        {plain(calDay.day_of_month)}
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
                  <th className="border-b border-slate-700 bg-slate-800 dark:bg-slate-950 px-3 py-2 text-right min-w-[320px]">
                    الملاحظات (الملخص والتفاصيل)
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
                    <tr key={st.student_id} className={`${rowBg} h-12`}>
                      {/* Sticky Right Name Cell (Fixed Compact Height) */}
                      <td
                        className={`sticky right-0 z-20 h-12 border-l-2 border-slate-300 dark:border-slate-700 px-3 py-1 text-right min-w-[205px] max-w-[240px] align-middle ${
                          rowIdx % 2 === 1
                            ? 'bg-slate-50 dark:bg-slate-900'
                            : 'bg-white dark:bg-slate-900'
                        }`}
                      >
                        <div className="min-w-0 overflow-hidden">
                          <p className="font-bold text-slate-900 dark:text-slate-100 truncate leading-tight">
                            <span className="text-teal-700 dark:text-teal-400 ml-1">
                              {plain(st.original_order)}.
                            </span>
                            {st.full_name}
                          </p>
                          <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 whitespace-nowrap overflow-hidden leading-tight">
                            <span className="truncate">
                              {st.registry_number ? (
                                <>
                                  قيد: <BidiText text={st.registry_number} />
                                </>
                              ) : (
                                <LtrSpan>{st.student_uid}</LtrSpan>
                              )}
                            </span>
                            {st.year_pending_lessons > 0 && (
                              <span className="text-amber-700 dark:text-amber-400 font-semibold shrink-0">
                                رصيد معلق: {count(st.year_pending_lessons)}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Day Cells 1..days_in_month */}
                      {registerData.calendar_days.map((calDay) => {
                        const cell = st.days[calDay.day_of_month];
                        const hasStackedLessonSymbol = Boolean(cell.symbol_top && cell.symbol_bottom);
                        return (
                          <td
                            key={calDay.day_of_month}
                            className="h-12 border-l border-slate-200 dark:border-slate-800 p-0 text-center"
                          >
                            <button
                              type="button"
                              onClick={() => setSelectedCellInfo({ student: st, cell })}
                              title={`${st.full_name} • ${calDay.day_name} ${calDay.date}${
                                cell.symbol_bottom ? ` • ${convert(cell.symbol_bottom)}` : ''
                              }`}
                              className={`w-full h-12 min-w-[40px] flex items-center justify-center text-xs transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-teal-600 ${getCellStyleClasses(
                                cell.status_kind
                              )} ${
                                cell.outside_section_membership &&
                                (cell.status_kind === 'present' || cell.status_kind === 'unrecorded')
                                  ? 'opacity-45'
                                  : ''
                              }`}
                            >
                              {hasStackedLessonSymbol ? (
                                <div className="w-full h-12 flex flex-col items-center justify-center gap-0.5 px-0.5 overflow-hidden leading-none">
                                  <span className="text-[11px] font-extrabold text-emerald-700 dark:text-emerald-300 leading-none">
                                    {cell.symbol_top}
                                  </span>
                                  <span
                                    dir="rtl"
                                    className="text-[8.5px] font-bold leading-[1.08] text-center break-words line-clamp-2 max-w-[58px]"
                                  >
                                    <BidiText text={cell.symbol_bottom!} />
                                  </span>
                                </div>
                              ) : (
                                convert(cell.symbol)
                              )}
                            </button>
                          </td>
                        );
                      })}

                      {/* 7 Totals Cells */}
                      <td className="h-12 border-l border-slate-200 dark:border-slate-800 px-2 py-1 text-center font-bold text-slate-800 dark:text-slate-200 align-middle">
                        {count(st.direct_full_days)}
                      </td>
                      <td className="h-12 border-l border-slate-200 dark:border-slate-800 px-2 py-1 text-center font-bold text-purple-800 dark:text-purple-300 align-middle">
                        {count(st.converted_lesson_days)}
                      </td>
                      <td className="h-12 border-l border-slate-200 dark:border-slate-800 px-2 py-1 text-center font-semibold text-amber-800 dark:text-amber-300 align-middle leading-tight">
                        <div>{count(st.missed_lessons_count)}</div>
                        {st.lesson_escape_lessons > 0 && (
                          <div className="text-[9.5px] text-orange-700 dark:text-orange-400 font-bold whitespace-nowrap">
                            هروب: {count(st.lesson_escape_lessons)}
                          </div>
                        )}
                      </td>
                      <td className="h-12 border-l border-slate-200 dark:border-slate-800 px-2 py-1 text-center font-semibold text-teal-800 dark:text-teal-300 align-middle">
                        {count(st.sick_leave_days)}
                      </td>
                      <td className="h-12 border-l border-slate-200 dark:border-slate-800 px-2 py-1 text-center font-semibold text-sky-800 dark:text-sky-300 align-middle">
                        {count(st.daily_permission_days)}
                      </td>
                      <td className="h-12 border-l border-slate-200 dark:border-slate-800 px-2 py-1 text-center font-semibold text-indigo-800 dark:text-indigo-300 align-middle">
                        {count(st.lesson_permission_records)}
                      </td>
                      <td
                        className={`h-12 border-l border-slate-200 dark:border-slate-800 px-2 py-1 text-center font-extrabold align-middle ${
                          st.total_counted_absence_days > 0
                            ? 'bg-red-50/80 dark:bg-red-950/35 text-red-800 dark:text-red-200'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {count(st.total_counted_absence_days)}
                      </td>

                      {/* Compact Fixed-Height Notes Cell + View Details Button */}
                      <td className="h-12 px-2.5 py-1 text-right min-w-[320px] max-w-[360px] align-middle">
                        <div className="h-10 flex items-center justify-between gap-2 overflow-hidden">
                          <div className="min-w-0 flex-1 overflow-hidden">
                            {st.compact_notes_summary ? (
                              <>
                                <p
                                  title={convert(st.compact_notes_summary)}
                                  className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate leading-tight"
                                >
                                  <BidiText text={st.compact_notes_summary} />
                                </p>
                                {st.manual_note && (
                                  <p
                                    title={`ملاحظة يدوية: ${st.manual_note}`}
                                    className="text-[10px] font-semibold text-teal-700 dark:text-teal-300 truncate leading-tight mt-0.5"
                                  >
                                    ملاحظة يدوية: <BidiText text={st.manual_note} />
                                  </p>
                                )}
                              </>
                            ) : st.manual_note ? (
                              <p
                                title={`ملاحظة يدوية: ${st.manual_note}`}
                                className="text-[11px] font-semibold text-teal-700 dark:text-teal-300 truncate leading-tight"
                              >
                                ملاحظة يدوية: {st.manual_note}
                              </p>
                            ) : (
                              <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate block">
                                لا توجد ملاحظات
                              </span>
                            )}
                          </div>

                          <div className="shrink-0 flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setNotesModalStudentId(st.student_id)}
                              title="عرض جميع الملاحظات مرتبة حسب التاريخ"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-teal-200 dark:border-teal-800 bg-teal-50/80 dark:bg-teal-950/50 text-teal-800 dark:text-teal-200 hover:bg-teal-100 dark:hover:bg-teal-900/60 text-[10.5px] font-semibold whitespace-nowrap transition-colors"
                            >
                              <Eye className="w-3 h-3" />
                              عرض التفاصيل
                            </button>

                            <button
                              type="button"
                              onClick={() => setNoteModalStudentId(st.student_id)}
                              title={
                                st.manual_note
                                  ? 'تعديل أو حذف الملاحظة اليدوية'
                                  : 'إضافة ملاحظة إدارية يدوية'
                              }
                              aria-label={
                                st.manual_note ? 'تعديل الملاحظة اليدوية' : 'إضافة ملاحظة يدوية'
                              }
                              className="inline-flex items-center justify-center p-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-teal-600 hover:text-teal-700 dark:hover:text-teal-300 transition-colors"
                            >
                              {st.manual_note ? (
                                <Pencil className="w-3 h-3" />
                              ) : (
                                <Plus className="w-3 h-3" />
                              )}
                            </button>
                          </div>
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

      <MonthlyStudentNotesModal
        open={Boolean(notesModalStudent)}
        student={notesModalStudent}
        gradeName={registerData?.grade_name ?? ''}
        sectionName={registerData?.section_name ?? ''}
        monthName={registerData?.month_name ?? ''}
        year={registerData?.year ?? calendarYear}
        onEditManualNote={(student) => setNoteModalStudentId(student.student_id)}
        onClose={() => setNotesModalStudentId(null)}
      />

      <MonthlyManualNoteModal
        open={Boolean(noteModalStudent)}
        student={noteModalStudent}
        monthName={registerData?.month_name ?? ''}
        year={registerData?.year ?? calendarYear}
        saving={savingNote}
        onSave={handleSaveManualNote}
        onDelete={handleDeleteManualNote}
        onClose={() => setNoteModalStudentId(null)}
      />

      {/* In-App Print Preview & Sandbox Fallback Modal */}
      {printPreviewOpen && registerData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label="معاينة طباعة السجل الشهري"
        >
          <div className="w-full max-w-6xl max-h-[92vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display flex items-center gap-2">
                  <Printer className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                  معاينة الطباعة — شهر {registerData.month_name}{' '}
                  <LtrSpan>{plain(registerData.year)}</LtrSpan> (
                  <BidiText text={`${registerData.grade_name} / ${registerData.section_name}`} />)
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  إعداد الورق المختار: <strong>{printSpec.label}</strong>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {standaloneHtmlUrl && (
                  <>
                    <a
                      href={standaloneHtmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      فتح نسخة الطباعة في تبويب جديد
                    </a>

                    <a
                      href={standaloneHtmlUrl}
                      download={`السجل-الشهري-${registerData.grade_name}-${registerData.section_name}-${registerData.year}-${registerData.month}.html`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      تحميل ملف HTML للطباعة
                    </a>
                  </>
                )}

                <button
                  type="button"
                  onClick={handlePrint}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-teal-700/30 bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300 text-xs font-semibold hover:bg-teal-100 dark:hover:bg-teal-900/60 transition-colors"
                >
                  <Printer className="w-3.5 h-3.5" />
                  طباعة مباشرة
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPrintPreviewOpen(false);
                    setPrintBlockedNotice(false);
                  }}
                  aria-label="إغلاق معاينة الطباعة"
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Honest Notice when Iframe Sandbox Blocks window.print() */}
            {printBlockedNotice && (
              <div className="px-4 sm:px-5 py-3 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/70 flex items-start gap-2.5 text-xs text-amber-950 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">
                    نافذة الطباعة التلقائية محجوبة داخل إطار المعاينة المدمج (Preview Sandbox).
                  </p>
                  <p className="text-[11px] leading-relaxed">
                    للطباعة الفورية أو الحفظ بصيغة PDF، استخدم زر «فتح نسخة الطباعة في تبويب جديد» أعلاه ثم اضغط طباعة (أو Ctrl+P)، أو قم بتنزيل «ملف HTML للطباعة» وفتحه مباشرة في المتصفح. في تطبيق المتصفح المستقل أو نسخة سطح المكتب تعمل «طباعة مباشرة» بشكل طبيعي.
                  </p>
                </div>
              </div>
            )}

            {/* Preview Pages Body */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-5 bg-slate-100 dark:bg-slate-950">
              <MonthlyPrintSheet
                data={registerData}
                paperPreset={paperPreset}
                mode="preview"
              />
            </div>
          </div>
        </div>
      )}

      {/* Portal Print Sheet directly to document.body outside .no-print wrapper */}
      {typeof document !== 'undefined' &&
        createPortal(
          <MonthlyPrintSheet data={registerData} paperPreset={paperPreset} mode="print" />,
          document.body
        )}
    </div>
  );
}
