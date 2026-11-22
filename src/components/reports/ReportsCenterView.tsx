import {
  ClipboardList,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Filter,
  Info,
  Printer,
  RefreshCw,
  Scale,
  Search,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { schoolService } from '../../services/schoolService';
import type {
  AbsenceAlertLevel,
  AbsenceReportsResponse,
  AbsenceReportTypeId,
  AcademicYear,
  GradeWithSections,
} from '../../types/school';
import { resolvePrintableImageDataUrl } from '../../utils/imageUpload';
import {
  ABSENCE_REPORT_TITLES,
  buildSimplifiedReportStandaloneHtml,
  LegalPrintSheet,
} from './LegalPrintSheet';

interface ReportsCenterViewProps {
  grades: GradeWithSections[];
  academicYears: AcademicYear[];
  selectedYearId: number | null;
  onSelectYear: (yearId: number) => void;
  onRefreshCore?: () => Promise<void>;
  onOpenLegalSettings: () => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

const REPORT_TABS: Array<{
  id: AbsenceReportTypeId;
  label: string;
  shortDesc: string;
}> = [
  {
    id: 'warning',
    label: 'تقرير التحذير',
    shortDesc: 'الطلاب الذين بلغوا عتبة التحذير',
  },
  {
    id: 'preliminary_warning',
    label: 'تقرير الإنذار الأولي',
    shortDesc: 'الطلاب الذين بلغوا عتبة الإنذار الأولي',
  },
  {
    id: 'final_warning',
    label: 'تقرير الإنذار النهائي',
    shortDesc: 'الطلاب الذين بلغوا عتبة الإنذار النهائي',
  },
  {
    id: 'exceeded_limit',
    label: 'المتجاوزون لحد الغياب المؤثر',
    shortDesc: 'الطلاب الذين بلغوا أو تجاوزوا حد الغياب المؤثر',
  },
];

function getAlertBadgeClasses(level: AbsenceAlertLevel): string {
  switch (level) {
    case 'exceeded_limit':
      return 'text-red-800 dark:text-red-300 font-extrabold';
    case 'final_warning':
      return 'text-rose-700 dark:text-rose-400 font-bold';
    case 'preliminary_warning':
      return 'text-orange-700 dark:text-orange-400 font-bold';
    case 'warning':
      return 'text-amber-700 dark:text-amber-400 font-bold';
    default:
      return 'text-slate-600 dark:text-slate-300 font-medium';
  }
}

export function ReportsCenterView({
  grades,
  academicYears,
  selectedYearId,
  onSelectYear,
  onOpenLegalSettings,
  onNotify,
}: ReportsCenterViewProps) {
  const [reportType, setReportType] = useState<AbsenceReportTypeId>('warning');
  const [gradeId, setGradeId] = useState<number | ''>('');
  const [sectionId, setSectionId] = useState<number | ''>('');
  const [search, setSearch] = useState('');

  const [data, setData] = useState<AbsenceReportsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [printBlockedNotice, setPrintBlockedNotice] = useState(false);
  const [standaloneHtmlUrl, setStandaloneHtmlUrl] = useState<string | null>(null);
  const printTimerRef = useRef<number | null>(null);

  const availableSections = useMemo(() => {
    if (!gradeId) return [];
    return grades.find((g) => g.id === Number(gradeId))?.sections ?? [];
  }, [grades, gradeId]);

  useEffect(() => {
    if (sectionId && !availableSections.some((s) => s.id === Number(sectionId))) {
      setSectionId('');
    }
  }, [availableSections, sectionId]);

  const loadReports = useCallback(async () => {
    if (!selectedYearId) {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const res = await schoolService.getAbsenceReports({
        academic_year_id: selectedYearId,
        report_type: reportType,
        grade_id: gradeId ? Number(gradeId) : undefined,
        section_id: sectionId ? Number(sectionId) : undefined,
        search: search.trim() || undefined,
      });
      setData(res);
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر تحميل تقارير الغياب والإنذارات.'
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedYearId, reportType, gradeId, sectionId, search, onNotify]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (gradeId) {
      const g = grades.find((x) => x.id === Number(gradeId));
      if (g) parts.push(g.name);
    }
    if (sectionId) {
      const s = availableSections.find((x) => x.id === Number(sectionId));
      if (s) parts.push(`شعبة ${s.name}`);
    }
    return parts.join(' — ');
  }, [grades, availableSections, gradeId, sectionId]);

  async function handleExportExcel() {
    if (!selectedYearId) return;
    setExporting(true);
    try {
      await schoolService.exportAbsenceReportsExcel({
        academic_year_id: selectedYearId,
        report_type: reportType,
        grade_id: gradeId ? Number(gradeId) : undefined,
        section_id: sectionId ? Number(sectionId) : undefined,
        search: search.trim() || undefined,
      });
      onNotify('success', 'تم تصدير التقرير إلى ملف Excel بنجاح.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر تصدير التقرير.');
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    if ((!printPreviewOpen && !printBlockedNotice) || !data) {
      setStandaloneHtmlUrl(null);
      return;
    }
    let cancelled = false;
    let activeBlobUrl: string | null = null;

    void (async () => {
      const resolvedLogo = await resolvePrintableImageDataUrl(data.school_settings.school_logo_data);
      if (cancelled) return;
      const html = buildSimplifiedReportStandaloneHtml(
        data,
        filterSummary || undefined,
        resolvedLogo
      );
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      activeBlobUrl = URL.createObjectURL(blob);
      setStandaloneHtmlUrl(activeBlobUrl);
    })();

    return () => {
      cancelled = true;
      if (activeBlobUrl) {
        URL.revokeObjectURL(activeBlobUrl);
      }
    };
  }, [printPreviewOpen, printBlockedNotice, data, filterSummary]);

  useEffect(() => {
    return () => {
      if (printTimerRef.current !== null) {
        window.clearTimeout(printTimerRef.current);
      }
    };
  }, []);

  function triggerDirectPrint() {
    if (!data) return;
    if (printTimerRef.current !== null) {
      window.clearTimeout(printTimerRef.current);
      printTimerRef.current = null;
    }
    setPrintBlockedNotice(false);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        let didTrigger = false;
        const onBeforePrint = () => {
          didTrigger = true;
        };
        window.addEventListener('beforeprint', onBeforePrint, { once: true });

        try {
          window.print();
        } catch {
          // Handled below
        }

        printTimerRef.current = window.setTimeout(() => {
          window.removeEventListener('beforeprint', onBeforePrint);
          printTimerRef.current = null;
          if (!didTrigger) {
            setPrintBlockedNotice(true);
            onNotify(
              'info',
              'بيئة المعاينة الحالية تمنع نافذة الطباعة المباشرة؛ استخدم زر «فتح نسخة الطباعة في تبويب جديد» أو «تحميل ملف HTML».'
            );
          }
        }, 300);
      });
    });
  }

  const reportTabCounts = useMemo<Record<AbsenceReportTypeId, number>>(() => {
    if (!data) {
      return {
        warning: 0,
        preliminary_warning: 0,
        final_warning: 0,
        exceeded_limit: 0,
      };
    }
    return {
      warning: data.summary.warning_count,
      preliminary_warning: data.summary.preliminary_warning_count,
      final_warning: data.summary.final_warning_count,
      exceeded_limit: data.summary.exceeded_limit_count,
    };
  }, [data]);

  const tabThresholds = useMemo<Record<AbsenceReportTypeId, number | null>>(() => {
    if (!data) {
      return {
        warning: null,
        preliminary_warning: null,
        final_warning: null,
        exceeded_limit: null,
      };
    }
    return {
      warning: data.thresholds.warning_days,
      preliminary_warning: data.thresholds.preliminary_warning_days,
      final_warning: data.thresholds.final_warning_days,
      exceeded_limit: data.thresholds.effective_absence_limit,
    };
  }, [data]);

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 font-display">
            تقارير التحذيرات والإنذارات وحد الغياب المؤثر
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
            تعتمد التقارير مباشرة على عدد أيام الغياب المحتسبة في قسم الغيابات وتعرض القوائم
            الجاهزة للطباعة ولوحة إعلانات المدرسة.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenLegalSettings}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <Scale className="w-4 h-4 text-teal-700 dark:text-teal-400" />
            <span>إعداد حدود الغياب والإنذارات</span>
          </button>

          <button
            type="button"
            onClick={() => void loadReports()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            disabled={exporting || !data}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-700/30 bg-emerald-50 dark:bg-emerald-950/40 text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors disabled:opacity-50"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>{exporting ? 'جاري التصدير...' : 'تصدير Excel'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setPrintBlockedNotice(false);
              setPrintPreviewOpen(true);
            }}
            disabled={!data}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold transition-colors disabled:opacity-50"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة التقرير للوحة الإعلانات</span>
          </button>
        </div>
      </div>

      {/* 4 Reports Selector Tabs */}
      <div
        role="tablist"
        aria-label="تقارير التحذير والإنذارات"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
      >
        {REPORT_TABS.map((tab) => {
          const active = reportType === tab.id;
          const threshold = tabThresholds[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setReportType(tab.id)}
              className={`text-right p-3.5 rounded-xl border transition-colors ${
                active
                  ? 'border-teal-700 bg-teal-50/75 dark:bg-teal-950/35 dark:border-teal-500'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 font-display">
                  {tab.label}
                </span>
                <span
                  className={`text-base font-extrabold tabular-nums ${
                    active
                      ? 'text-teal-700 dark:text-teal-300'
                      : 'text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {reportTabCounts[tab.id]}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                <span className="truncate">{tab.shortDesc}</span>
                {threshold !== null && (
                  <span className="font-semibold text-slate-700 dark:text-slate-300 shrink-0">
                    ({threshold} يوم)
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Filters Toolbar */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
              السنة الدراسية
            </label>
            <select
              value={selectedYearId ?? ''}
              onChange={(e) => {
                if (e.target.value) onSelectYear(Number(e.target.value));
              }}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 tabular-nums"
            >
              {academicYears.map((yr) => (
                <option key={yr.id} value={yr.id}>
                  {yr.name} {yr.is_active === 1 ? '(الفعالة)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
              الصف
            </label>
            <select
              value={gradeId}
              onChange={(e) => setGradeId(e.target.value ? Number(e.target.value) : '')}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            >
              <option value="">جميع الصفوف</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
              الشعبة
            </label>
            <select
              value={sectionId}
              disabled={!gradeId}
              onChange={(e) => setSectionId(e.target.value ? Number(e.target.value) : '')}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-50"
            >
              <option value="">جميع الشعب</option>
              {availableSections.map((sec) => (
                <option key={sec.id} value={sec.id}>
                  {sec.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
              بحث باسم الطالب أو رقم القيد
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="اسم الطالب أو رقم القيد..."
                className="w-full pr-8 pl-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
          <span className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
            <span>
              العتبة الحالية للتقرير:{' '}
              <strong className="text-slate-900 dark:text-slate-100">
                {tabThresholds[reportType] ?? '—'} يوم فأكثر
              </strong>
            </span>
          </span>
          <span>
            عدد الطلاب الظاهرين في التقرير:{' '}
            <strong className="text-slate-900 dark:text-slate-100">
              {data?.rows.length ?? 0}
            </strong>
          </span>
        </div>
      </section>

      {/* Main Report Table */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-teal-700 dark:text-teal-400" />
            {ABSENCE_REPORT_TITLES[reportType]}
          </h3>
          {data && (
            <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              السنة الدراسية: {data.academic_year.name}
            </span>
          )}
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm text-slate-500 dark:text-slate-400">
            جاري قراءة أيام الغياب المحتسبة من قسم الغيابات...
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Users className="w-9 h-9 text-slate-400 mx-auto" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
              لا توجد حالات مطابقة في «{ABSENCE_REPORT_TITLES[reportType]}» حالياً.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              يُحدّث التقرير تلقائياً عند تعديل سجلات الغياب في قسم الغيابات أو عند تغيير العتبات.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right tabular-nums">
              <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-3 font-semibold text-center w-12">ت</th>
                  <th className="py-2.5 px-3 font-semibold">اسم الطالب</th>
                  <th className="py-2.5 px-3 font-semibold">الصف</th>
                  <th className="py-2.5 px-3 font-semibold text-center">الشعبة</th>
                  <th className="py-2.5 px-3 font-semibold text-center">
                    عدد أيام الغياب المحتسبة
                  </th>
                  <th className="py-2.5 px-3 font-semibold text-center">
                    نوع التحذير أو الإنذار
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.rows.map((row, idx) => (
                  <tr
                    key={row.student_id}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 align-middle"
                  >
                    <td className="py-3 px-3 text-center text-slate-500 dark:text-slate-400">
                      {idx + 1}
                    </td>

                    <td className="py-3 px-3">
                      <p className="font-bold text-slate-900 dark:text-slate-100">
                        {row.full_name}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {row.registry_number ? `قيد: ${row.registry_number}` : row.student_uid}
                      </p>
                    </td>

                    <td className="py-3 px-3 font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                      {row.grade_name}
                    </td>

                    <td className="py-3 px-3 text-center font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                      {row.section_name}
                    </td>

                    <td className="py-3 px-3 text-center whitespace-nowrap">
                      <span className="text-sm font-extrabold text-red-700 dark:text-red-400">
                        {row.counted_absence_days} يوم
                      </span>
                      <p className="text-[10.5px] text-slate-500 dark:text-slate-400 mt-0.5">
                        مباشر: {row.direct_full_days} · متراكم دروس: {row.converted_lesson_days}
                        {row.counted_daily_permission_days > 0
                          ? ` · رخص يومية محتسبة: ${row.counted_daily_permission_days}`
                          : ''}
                      </p>
                    </td>

                    <td className="py-3 px-3 text-center whitespace-nowrap">
                      <span className={getAlertBadgeClasses(row.alert_level)}>
                        {row.alert_label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
            تُجلب أيام الغياب المحتسبة مباشرة من قسم الغيابات دون إعادة احتساب منفصلة.
          </span>
          <span>اضغط «طباعة التقرير للوحة الإعلانات» لمعاينة وطباعة الكشف الرسمي.</span>
        </div>
      </section>

      {/* Print Preview Modal */}
      {printPreviewOpen && data && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-5 no-print"
          role="dialog"
          aria-modal="true"
          aria-label="معاينة طباعة التقرير للوحة إعلانات المدرسة"
        >
          <div className="w-full max-w-5xl max-h-[92vh] rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 shadow-2xl flex flex-col overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                  معاينة التقرير الرسمي للوحة إعلانات المدرسة
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {ABSENCE_REPORT_TITLES[data.report_type]}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {standaloneHtmlUrl && (
                  <>
                    <a
                      href={standaloneHtmlUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      فتح نسخة الطباعة في تبويب جديد
                    </a>
                    <a
                      href={standaloneHtmlUrl}
                      download={`${ABSENCE_REPORT_TITLES[data.report_type].replace(/\s+/g, '_')}.html`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Download className="w-3.5 h-3.5" />
                      تحميل HTML للطباعة
                    </a>
                  </>
                )}

                <button
                  type="button"
                  onClick={triggerDirectPrint}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold"
                >
                  <Printer className="w-3.5 h-3.5" />
                  طباعة مباشرة
                </button>

                <button
                  type="button"
                  onClick={() => setPrintPreviewOpen(false)}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="إغلاق المعاينة"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {printBlockedNotice && (
              <div className="px-4 py-2.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200">
                بيئة المعاينة الحالية تمنع نافذة الطباعة المباشرة؛ استخدم زر «فتح نسخة الطباعة في
                تبويب جديد» أو «تحميل HTML للطباعة» أعلاه.
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              <LegalPrintSheet
                data={data}
                filterSummary={filterSummary || undefined}
                mode="preview"
              />
            </div>
          </div>
        </div>
      )}

      {data &&
        createPortal(
          <LegalPrintSheet
            data={data}
            filterSummary={filterSummary || undefined}
            mode="print"
          />,
          document.body
        )}
    </div>
  );
}
