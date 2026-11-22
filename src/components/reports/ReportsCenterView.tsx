import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Filter,
  History,
  Info,
  Printer,
  RefreshCw,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { schoolService } from '../../services/schoolService';
import type {
  AcademicYear,
  EducationalStage,
  GradeWithSections,
  LegalProcedureType,
  ReportCategoryId,
  ReportsCenterResponse,
  ReportsCenterStudentRow,
} from '../../types/school';
import {
  buildLegalStandaloneHtml,
  canIssueOfficialLetter,
  fillLetterTemplate,
  LegalPrintSheet,
  type LegalPrintKind,
  type LegalPrintPayload,
  type LetterIssueMode,
  PROCEDURE_LABELS_MAP,
  REPORT_TITLE_MAP,
} from './LegalPrintSheet';
import { StudentProcedureModal } from './StudentProcedureModal';

interface ReportsCenterViewProps {
  grades: GradeWithSections[];
  academicYears: AcademicYear[];
  selectedYearId: number | null;
  onSelectYear: (yearId: number) => void;
  onRefreshCore: () => Promise<void>;
  onOpenLegalSettings: () => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

const REPORT_TABS: Array<{
  id: ReportCategoryId;
  label: string;
  shortDesc: string;
  defaultProcType: LegalProcedureType;
}> = [
  {
    id: 'preliminary_warnings',
    label: 'التحذيرات الأولية',
    shortDesc: 'الطلاب البالغون عتبة التحذير الأولي حسب المرحلة',
    defaultProcType: 'preliminary_warning',
  },
  {
    id: 'first_warnings',
    label: 'الإنذار الأول',
    shortDesc: 'المستحقون أو الصادر بحقهم الإنذار الأول',
    defaultProcType: 'first_warning',
  },
  {
    id: 'final_warnings',
    label: 'الإنذار النهائي',
    shortDesc: 'الحالات الحرجة البالغة عتبة الإنذار النهائي',
    defaultProcType: 'final_warning',
  },
  {
    id: 'effective_limit_reached',
    label: 'بلوغ حد الغياب المؤثر',
    shortDesc: 'الطلاب الذين بلغوا أو تجاوزوا السقف القانوني',
    defaultProcType: 'effective_limit_notice',
  },
  {
    id: 'guardian_notifications',
    label: 'سجل تبليغات أولياء الأمور',
    shortDesc: 'متابعة التبليغات الدورية وسجل الإشعارات',
    defaultProcType: 'guardian_notification',
  },
  {
    id: 'guardian_summons',
    label: 'سجل استدعاءات أولياء الأمور',
    shortDesc: 'طلبات الحضور ونتائج مراجعة أولياء الأمور',
    defaultProcType: 'guardian_summons',
  },
];

function getDefaultProcForReport(reportType: ReportCategoryId): LegalProcedureType {
  return REPORT_TABS.find((t) => t.id === reportType)?.defaultProcType ?? 'guardian_notification';
}

function getStatusTextClass(status: ReportsCenterStudentRow['procedure_status']): string {
  switch (status) {
    case 'effective_limit_reached':
    case 'final_warning_due':
      return 'text-red-700 dark:text-red-400 font-bold';
    case 'first_warning_due':
    case 'preliminary_due':
      return 'text-amber-700 dark:text-amber-400 font-bold';
    case 'issued':
      return 'text-emerald-700 dark:text-emerald-400 font-semibold';
    case 'summoned':
    case 'notified':
      return 'text-sky-700 dark:text-sky-400 font-semibold';
    case 'unmapped_stage':
      return 'text-red-600 dark:text-red-400 font-semibold';
    default:
      return 'text-slate-600 dark:text-slate-300 font-medium';
  }
}

export function ReportsCenterView({
  grades,
  academicYears,
  selectedYearId,
  onSelectYear,
  onRefreshCore,
  onOpenLegalSettings,
  onNotify,
}: ReportsCenterViewProps) {
  const [reportType, setReportType] = useState<ReportCategoryId>('preliminary_warnings');
  const [stageFilter, setStageFilter] = useState<EducationalStage | 'all'>('all');
  const [gradeId, setGradeId] = useState<number | ''>('');
  const [sectionId, setSectionId] = useState<number | ''>('');
  const [search, setSearch] = useState('');
  const [includeApproaching, setIncludeApproaching] = useState(true);

  const [data, setData] = useState<ReportsCenterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [assigningGradeId, setAssigningGradeId] = useState<number | null>(null);

  // Student Procedures Modal
  const [modalStudentId, setModalStudentId] = useState<number | null>(null);

  // Print & Letter Preview State
  const [printPayload, setPrintPayload] = useState<LegalPrintPayload | null>(null);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [printBlockedNotice, setPrintBlockedNotice] = useState(false);
  const [standaloneHtmlUrl, setStandaloneHtmlUrl] = useState<string | null>(null);
  const printTimerRef = useRef<number | null>(null);

  const filteredGrades = useMemo(() => {
    if (stageFilter === 'all') return grades;
    return grades.filter((g) => g.stage === stageFilter);
  }, [grades, stageFilter]);

  const availableSections = useMemo(() => {
    if (!gradeId) return [];
    return grades.find((g) => g.id === Number(gradeId))?.sections ?? [];
  }, [grades, gradeId]);

  useEffect(() => {
    if (gradeId && !filteredGrades.some((g) => g.id === Number(gradeId))) {
      setGradeId('');
      setSectionId('');
    }
  }, [filteredGrades, gradeId]);

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
      const res = await schoolService.getReportsCenter({
        academic_year_id: selectedYearId,
        report_type: reportType,
        stage: stageFilter,
        grade_id: gradeId ? Number(gradeId) : undefined,
        section_id: sectionId ? Number(sectionId) : undefined,
        search: search.trim() || undefined,
        include_approaching: includeApproaching,
      });
      setData(res);
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر تحميل بيانات مركز التقارير والإحصائيات.'
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedYearId, reportType, stageFilter, gradeId, sectionId, search, includeApproaching, onNotify]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const modalStudent = useMemo(() => {
    if (!data || modalStudentId === null) return null;
    return data.rows.find((r) => r.student_id === modalStudentId) ?? null;
  }, [data, modalStudentId]);

  async function handleQuickAssignStage(targetGradeId: number, stage: EducationalStage) {
    setAssigningGradeId(targetGradeId);
    try {
      await schoolService.updateGradeStage(targetGradeId, stage);
      onNotify('success', 'تم ربط الصف بالمرحلة الدراسية وتحديث التقارير فوراً.');
      await onRefreshCore();
      await loadReports();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر تعيين مرحلة الصف.');
    } finally {
      setAssigningGradeId(null);
    }
  }

  async function handleExportExcel() {
    if (!selectedYearId) return;
    setExporting(true);
    try {
      await schoolService.exportReportsExcel({
        academic_year_id: selectedYearId,
        report_type: reportType,
        stage: stageFilter,
        grade_id: gradeId ? Number(gradeId) : undefined,
        section_id: sectionId ? Number(sectionId) : undefined,
        search: search.trim() || undefined,
        include_approaching: includeApproaching,
      });
      onNotify('success', 'تم تصدير التقرير إلى ملف Excel بنجاح.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر تصدير التقرير.');
    } finally {
      setExporting(false);
    }
  }

  // Standalone HTML Blob lifecycle for Print Preview Modal
  useEffect(() => {
    if ((!printPreviewOpen && !printBlockedNotice) || !printPayload) {
      setStandaloneHtmlUrl(null);
      return;
    }
    const html = buildLegalStandaloneHtml(printPayload);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    setStandaloneHtmlUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [printPreviewOpen, printBlockedNotice, printPayload]);

  useEffect(() => {
    return () => {
      if (printTimerRef.current !== null) {
        window.clearTimeout(printTimerRef.current);
      }
    };
  }, []);

  function openPrintPreview(
    kind: LegalPrintKind,
    student: ReportsCenterStudentRow | null = null
  ) {
    if (!data) return;
    const reg = student?.stage ? data.stage_regulations[student.stage] : null;
    const officialAllowed = canIssueOfficialLetter(reg);
    const defaultLetterMode: LetterIssueMode = officialAllowed ? 'official' : 'draft';

    let customBody = '';
    let letterTitle = '';
    if ((kind === 'warning_letter' || kind === 'summons_letter') && student) {
      const template =
        kind === 'warning_letter'
          ? (reg?.warning_letter_template ??
            'نود إعلامكم بأن الطالب {{student_name}} بلغ {{counted_days}} يوم غياب.')
          : (reg?.summons_letter_template ??
            'يرجى مراجعة إدارة المدرسة بشأن غياب الطالب {{student_name}} البالغ {{counted_days}} يوماً.');
      customBody = fillLetterTemplate({
        template,
        student,
        regulation: reg,
        schoolSettings: data.school_settings,
        academicYearName: data.academic_year.name,
      });
      letterTitle =
        kind === 'warning_letter' ? 'إشعار وإنذار غياب رسمي' : 'كتاب استدعاء ولي أمر الطالب';
    }

    setPrintPayload({
      kind,
      data,
      student,
      letterMode: defaultLetterMode,
      letterTitle,
      letterNumber: '',
      letterDate: new Date().toISOString().slice(0, 10),
      recipientLabel: student ? `ولي أمر الطالب (${student.full_name}) المحترم` : '',
      customBody,
    });
    setPrintBlockedNotice(false);
    setPrintPreviewOpen(true);
  }

  function triggerDirectPrint() {
    if (!printPayload) return;

    if (
      (printPayload.kind === 'warning_letter' || printPayload.kind === 'summons_letter') &&
      printPayload.letterMode === 'official'
    ) {
      const reg = printPayload.student?.stage
        ? printPayload.data.stage_regulations[printPayload.student.stage]
        : null;
      if (!canIssueOfficialLetter(reg)) {
        onNotify(
          'error',
          'لا يمكن طباعة الكتاب بصيغة قانونية رسمية قبل اعتماد الضابطة القانونية للمرحلة وتوثيق رقم القرار.'
        );
        return;
      }
    }

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

  const reportTabCounts = useMemo<Record<ReportCategoryId, number>>(() => {
    if (!data) {
      return {
        preliminary_warnings: 0,
        first_warnings: 0,
        final_warnings: 0,
        effective_limit_reached: 0,
        guardian_notifications: 0,
        guardian_summons: 0,
      };
    }
    return {
      preliminary_warnings: data.summary.preliminary_warnings_count,
      first_warnings: data.summary.first_warnings_count,
      final_warnings: data.summary.final_warnings_count,
      effective_limit_reached: data.summary.effective_limit_reached_count,
      guardian_notifications: data.summary.guardian_notifications_logged_count,
      guardian_summons: data.summary.guardian_summons_logged_count,
    };
  }, [data]);

  const unapprovedStagesList = useMemo(() => {
    if (!data) return [];
    return (['primary', 'intermediate', 'preparatory'] as EducationalStage[])
      .map((s) => data.stage_regulations[s])
      .filter((r) => r && (r.is_legally_approved !== 1 || r.thresholds_are_provisional === 1));
  }, [data]);

  const modalStudentRegulation = useMemo(() => {
    if (!data || !modalStudent?.stage) return null;
    return data.stage_regulations[modalStudent.stage] ?? null;
  }, [data, modalStudent]);

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 font-display">
            مركز التقارير والإنذارات القانونية للغياب
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
            متابعة حية ومباشرة لحالات الغياب والإنذارات وتبليغات واستدعاءات أولياء الأمور استناداً إلى
            الضوابط القانونية المعتمدة لكل مرحلة دراسية
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenLegalSettings}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <Scale className="w-4 h-4 text-teal-700 dark:text-teal-400" />
            <span>ضوابط الغياب والإنذارات</span>
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
            onClick={() => openPrintPreview('report_list')}
            disabled={!data}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold transition-colors disabled:opacity-50"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة التقرير</span>
          </button>
        </div>
      </div>

      {/* Unmapped Grades Warning + Inline Fix */}
      {data && data.unmapped_grades.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50/90 dark:bg-red-950/30 p-4 space-y-2.5 text-xs text-red-950 dark:text-red-200"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold">
                تنبيه: توجد صفوف غير مربوطة بمرحلة دراسية ({data.unmapped_grades.length})
              </p>
              <p className="leading-relaxed">
                لا يمكن تطبيق ضوابط الغياب أو حساب الإنذارات القانونية لطلاب هذه الصفوف قبل تحديد
                المرحلة الدراسية لكل صف (ابتدائية / متوسطة / إعدادية). اختر المرحلة مباشرة أدناه:
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {data.unmapped_grades.map((ug) => (
              <div
                key={ug.id}
                className="inline-flex items-center gap-2 rounded-lg border border-red-300 dark:border-red-700 bg-white dark:bg-slate-900 px-2.5 py-1.5"
              >
                <span className="font-bold text-slate-900 dark:text-slate-100">{ug.name}</span>
                <select
                  aria-label={`ربط مرحلة ${ug.name}`}
                  value=""
                  disabled={assigningGradeId === ug.id}
                  onChange={(e) => {
                    const val = e.target.value as EducationalStage;
                    if (val) void handleQuickAssignStage(ug.id, val);
                  }}
                  className="px-2 py-1 text-[11px] rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  <option value="">تعيين المرحلة...</option>
                  <option value="primary">المرحلة الابتدائية</option>
                  <option value="intermediate">المرحلة المتوسطة</option>
                  <option value="preparatory">المرحلة الإعدادية</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Provisional / Unapproved Legal Notice */}
      {unapprovedStagesList.length > 0 && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700/70 bg-amber-50/90 dark:bg-amber-950/30 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-950 dark:text-amber-200">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">عتبات تجريبية / غير معتمدة قانونياً في: </span>
              <span>
                {unapprovedStagesList.map((r) => r.stage_name).join('، ')}
              </span>
              <span className="block text-[11px] opacity-90 mt-0.5">
                تقتصر طباعة الكتب على صيغة «مسودة إدارية غير معتمدة قانونياً» حتى يتم اعتماد الضابطة
                برقم قرار وتاريخ رسمي.
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenLegalSettings}
            className="px-3 py-1.5 rounded-lg border border-amber-400 dark:border-amber-700 bg-white dark:bg-slate-900 text-amber-900 dark:text-amber-200 font-semibold hover:bg-amber-100/70 dark:hover:bg-amber-950/50 shrink-0"
          >
            مراجعة واعتماد الضوابط
          </button>
        </div>
      )}

      {/* Summary KPIs */}
      {data && (
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 tabular-nums">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              تحذير أولي مستحق
            </p>
            <p className="text-xl font-extrabold text-amber-700 dark:text-amber-400 mt-1 font-display">
              {data.summary.preliminary_warnings_count}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              إنذار أول مستحق
            </p>
            <p className="text-xl font-extrabold text-orange-700 dark:text-orange-400 mt-1 font-display">
              {data.summary.first_warnings_count}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              إنذار نهائي مستحق
            </p>
            <p className="text-xl font-extrabold text-red-700 dark:text-red-400 mt-1 font-display">
              {data.summary.final_warnings_count}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              بلغوا الحد المؤثر
            </p>
            <p className="text-xl font-extrabold text-red-800 dark:text-red-300 mt-1 font-display">
              {data.summary.effective_limit_reached_count}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              تبليغات أولياء الأمور
            </p>
            <p className="text-xl font-extrabold text-sky-700 dark:text-sky-400 mt-1 font-display">
              {data.summary.guardian_notifications_logged_count}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              استدعاءات مسجلة
            </p>
            <p className="text-xl font-extrabold text-teal-700 dark:text-teal-400 mt-1 font-display">
              {data.summary.guardian_summons_logged_count}
            </p>
          </div>
        </section>
      )}

      {/* 6 Reports Selector Tabs */}
      <div
        role="tablist"
        aria-label="أنواع التقارير القانونية"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5"
      >
        {REPORT_TABS.map((tab) => {
          const active = reportType === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setReportType(tab.id)}
              className={`text-right p-3 rounded-xl border transition-colors ${
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
                  className={`text-xs font-extrabold tabular-nums ${
                    active
                      ? 'text-teal-700 dark:text-teal-300'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {reportTabCounts[tab.id]}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                {tab.shortDesc}
              </p>
            </button>
          );
        })}
      </div>

      {/* Filters Toolbar */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
              المرحلة الدراسية
            </label>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value as EducationalStage | 'all')}
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            >
              <option value="all">جميع المراحل</option>
              <option value="primary">المرحلة الابتدائية</option>
              <option value="intermediate">المرحلة المتوسطة</option>
              <option value="preparatory">المرحلة الإعدادية</option>
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
              {filteredGrades.map((g) => (
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
              بحث باسم الطالب أو القيد
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

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
          <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={includeApproaching}
              onChange={(e) => setIncludeApproaching(e.target.checked)}
              className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
            />
            <span>
              تضمين الطلاب المقتربين من العتبة (متبقٍ 3 أيام فأقل أو لديهم غياب قيد المتابعة)
            </span>
          </label>

          <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            <Filter className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
            <span>
              عدد النتائج في {REPORT_TITLE_MAP[reportType]}:{' '}
              <strong className="text-slate-900 dark:text-slate-100">
                {data?.rows.length ?? 0}
              </strong>
            </span>
          </div>
        </div>
      </section>

      {/* Main Report Table */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-teal-700 dark:text-teal-400" />
            {REPORT_TITLE_MAP[reportType]}
          </h3>
          {data && (
            <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              السنة الدراسية: {data.academic_year.name}
            </span>
          )}
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm text-slate-500 dark:text-slate-400">
            جاري احتساب بيانات التقرير من سجلات الغياب والضوابط القانونية...
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Users className="w-9 h-9 text-slate-400 mx-auto" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
              لا توجد حالات مطابقة لمعايير «{REPORT_TITLE_MAP[reportType]}» حالياً.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              يُحدّث هذا التقرير تلقائياً عند تسجيل غيابات جديدة أو عند تغيير ضوابط المرحلة.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right tabular-nums">
              <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-3 font-semibold">الطالب</th>
                  <th className="py-2.5 px-3 font-semibold">الصف والشعبة · المرحلة</th>
                  <th className="py-2.5 px-3 font-semibold text-center">الغياب المحتسب</th>
                  <th className="py-2.5 px-3 font-semibold text-center">الحد المحدد</th>
                  <th className="py-2.5 px-3 font-semibold text-center">المتبقي للحد التالي</th>
                  <th className="py-2.5 px-3 font-semibold">حالة الإجراء</th>
                  <th className="py-2.5 px-3 font-semibold">آخر إجراء / تبليغ ونتيجته</th>
                  <th className="py-2.5 px-3 font-semibold text-left">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.rows.map((row) => (
                  <tr
                    key={row.student_id}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 align-top"
                  >
                    <td className="py-3 px-3 min-w-[175px]">
                      <p className="font-bold text-slate-900 dark:text-slate-100">
                        {row.full_name}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {row.registry_number ? `قيد: ${row.registry_number}` : row.student_uid}
                        {row.phone ? ` · ${row.phone}` : ''}
                      </p>
                    </td>

                    <td className="py-3 px-3 whitespace-nowrap">
                      <p className="font-semibold text-slate-800 dark:text-slate-200">
                        {row.grade_name} — {row.section_name}
                      </p>
                      <p
                        className={`text-[11px] mt-0.5 ${
                          row.stage_name
                            ? 'text-slate-500 dark:text-slate-400'
                            : 'text-red-600 dark:text-red-400 font-semibold'
                        }`}
                      >
                        {row.stage_name ?? 'مرحلة غير محددة'}
                      </p>
                    </td>

                    <td className="py-3 px-3 text-center whitespace-nowrap">
                      <span className="text-sm font-extrabold text-red-700 dark:text-red-400">
                        {row.counted_legal_absence_days} يوم
                      </span>
                      <p className="text-[10.5px] text-slate-500 dark:text-slate-400 mt-0.5">
                        دون عذر: {row.unexcused_absence_days} · تراكم: {row.converted_lesson_days}
                      </p>
                      {row.attendance_score_deducted > 0 && (
                        <p
                          className={`text-[10.5px] mt-0.5 ${
                            row.conduct_failure_triggered
                              ? 'text-red-600 dark:text-red-400 font-bold'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          خصم مواظبة: {row.attendance_score_deducted}
                        </p>
                      )}
                    </td>

                    <td className="py-3 px-3 text-center whitespace-nowrap font-bold text-slate-800 dark:text-slate-200">
                      {row.report_threshold_days !== null ? `${row.report_threshold_days} يوم` : '—'}
                    </td>

                    <td className="py-3 px-3 text-center whitespace-nowrap">
                      {row.remaining_days_to_next_threshold !== null ? (
                        <div>
                          <span
                            className={`font-extrabold ${
                              row.remaining_days_to_next_threshold === 0
                                ? 'text-red-700 dark:text-red-400'
                                : row.remaining_days_to_next_threshold <= 3
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-slate-800 dark:text-slate-200'
                            }`}
                          >
                            {row.remaining_days_to_next_threshold} يوم
                          </span>
                          <p className="text-[10.5px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {row.next_threshold_label}
                          </p>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>

                    <td className="py-3 px-3 min-w-[165px]">
                      <p className={getStatusTextClass(row.procedure_status)}>
                        {row.procedure_status_label}
                      </p>
                      {row.truancy_risk && (
                        <p className="text-[10.5px] text-orange-700 dark:text-orange-400 font-semibold mt-0.5">
                          رصد هروب/تسرب ({row.lesson_escape_lessons} درس)
                        </p>
                      )}
                      {row.conduct_failure_triggered && (
                        <p className="text-[10.5px] text-red-700 dark:text-red-400 font-bold mt-0.5">
                          مؤشر رسوب بالسلوك
                        </p>
                      )}
                    </td>

                    <td className="py-3 px-3 min-w-[165px]">
                      {row.last_action_date ? (
                        <div className="space-y-0.5">
                          <p className="font-semibold text-slate-800 dark:text-slate-200">
                            {row.last_action_label} · {row.last_action_date}
                          </p>
                          {row.last_summons_result && (
                            <p className="text-[11px] text-teal-700 dark:text-teal-400">
                              نتيجة الاستدعاء: {row.last_summons_result}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">لم يسجل إجراء بعد</span>
                      )}
                    </td>

                    <td className="py-3 px-3 text-left whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setModalStudentId(row.student_id)}
                          className="px-2.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-[11px] font-semibold transition-colors"
                        >
                          الإجراءات
                        </button>
                        <button
                          type="button"
                          onClick={() => openPrintPreview('warning_letter', row)}
                          title="معاينة وطباعة كتاب إنذار"
                          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <FileText className="w-3.5 h-3.5 text-amber-600" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openPrintPreview('summons_letter', row)}
                          title="معاينة وطباعة استدعاء ولي أمر"
                          className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Printer className="w-3.5 h-3.5 text-sky-600" />
                        </button>
                      </div>
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
            تُحتسب جميع الأرقام مباشرة من سجل الغيابات وأيام التراكم المحولة وتنطبق عليها الضوابط المعتمدة لكل مرحلة.
          </span>
          <span>يُحفظ تاريخ الإجراءات والإنذارات لكل طالب بشكل دائم حسب السنة الدراسية.</span>
        </div>
      </section>

      {/* Historical Procedures Log Section */}
      {data && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display flex items-center gap-2">
              <History className="w-4 h-4 text-slate-600 dark:text-slate-300" />
              السجل التاريخي للإنذارات وتبليغات واستدعاءات أولياء الأمور ({data.procedure_logs.length})
            </h3>
            <button
              type="button"
              onClick={() => openPrintPreview('procedures_log')}
              disabled={data.procedure_logs.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              <Printer className="w-3.5 h-3.5" />
              طباعة سجل الإجراءات
            </button>
          </div>

          {data.procedure_logs.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              لا توجد إجراءات مسجلة في هذا النطاق حتى الآن. اضغط «الإجراءات» بجانب أي طالب لتوثيق إنذار أو تبليغ أو استدعاء.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right tabular-nums">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold">الطالب</th>
                    <th className="py-2.5 px-3 font-semibold">الصف والشعبة</th>
                    <th className="py-2.5 px-3 font-semibold">نوع الإجراء</th>
                    <th className="py-2.5 px-3 font-semibold">التاريخ</th>
                    <th className="py-2.5 px-3 font-semibold text-center">الغياب وقتها</th>
                    <th className="py-2.5 px-3 font-semibold">وسيلة التبليغ</th>
                    <th className="py-2.5 px-3 font-semibold">النتيجة / الملاحظات</th>
                    <th className="py-2.5 px-3 font-semibold">التوثيق</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {data.procedure_logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                      <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-slate-100">
                        {log.student_name}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                        {log.grade_name} / {log.section_name}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-200">
                        {PROCEDURE_LABELS_MAP[log.procedure_type]}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                        {log.procedure_date}
                      </td>
                      <td className="py-2.5 px-3 text-center font-semibold">
                        {log.absence_days_at_action} يوم
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                        {log.delivery_method ?? '—'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 dark:text-slate-200">
                        {log.summons_result || log.notes || '—'}
                        {log.override_reason && (
                          <span className="block text-[10.5px] text-amber-700 dark:text-amber-400">
                            سبب التكرار: {log.override_reason}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                            log.is_official_legal_issue === 1
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {log.is_official_legal_issue === 1 ? (
                            <ShieldCheck className="w-3.5 h-3.5" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                          {log.is_official_legal_issue === 1 ? 'رسمي معتمد' : 'إداري / مسودة'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Student Procedures Modal */}
      {data && (
        <StudentProcedureModal
          open={Boolean(modalStudent)}
          student={modalStudent}
          academicYearId={data.academic_year.id}
          regulation={modalStudentRegulation}
          defaultProcedureType={getDefaultProcForReport(reportType)}
          onClose={() => setModalStudentId(null)}
          onSaved={loadReports}
          onOpenLetterPrint={(kind, student) => openPrintPreview(kind, student)}
          onNotify={onNotify}
        />
      )}

      {/* Print Preview & Editable Official Letter Modal */}
      {printPreviewOpen && printPayload && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label="معاينة الطباعة والكتب الرسمية"
        >
          <div className="w-full max-w-6xl max-h-[92vh] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display flex items-center gap-2">
                  <Printer className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                  معاينة الطباعة —{' '}
                  {printPayload.kind === 'report_list'
                    ? REPORT_TITLE_MAP[printPayload.data.report_type]
                    : printPayload.kind === 'procedures_log'
                      ? 'سجل الإجراءات القانونية'
                      : printPayload.letterTitle}
                </h3>
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
                      download={`مستند_قانوني_${printPayload.kind}_${printPayload.data.academic_year.name}.html`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      تحميل HTML للطباعة
                    </a>
                  </>
                )}

                <button
                  type="button"
                  onClick={triggerDirectPrint}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-teal-700/30 bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300 text-xs font-semibold hover:bg-teal-100 dark:hover:bg-teal-900/60"
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
                  aria-label="إغلاق المعاينة"
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-200/70 dark:hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {printBlockedNotice && (
              <div className="px-4 sm:px-5 py-3 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/70 flex items-start gap-2.5 text-xs text-amber-950 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p>
                  نافذة الطباعة التلقائية محجوبة داخل إطار المعاينة المدمج؛ استخدم زر «فتح نسخة
                  الطباعة في تبويب جديد» أو «تحميل HTML للطباعة».
                </p>
              </div>
            )}

            {/* Editable Official Letter Controls when printing warning_letter or summons_letter */}
            {(printPayload.kind === 'warning_letter' || printPayload.kind === 'summons_letter') &&
              printPayload.student && (
                <div className="px-4 sm:px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/90 space-y-3 text-xs">
                  {(() => {
                    const reg = printPayload.student.stage
                      ? printPayload.data.stage_regulations[printPayload.student.stage]
                      : null;
                    const officialOk = canIssueOfficialLetter(reg);
                    return (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-3">
                            <label className="inline-flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="radio"
                                name="letter_issue_mode"
                                checked={printPayload.letterMode === 'draft'}
                                onChange={() =>
                                  setPrintPayload({ ...printPayload, letterMode: 'draft' })
                                }
                              />
                              <span className="font-semibold">
                                مسودة إدارية (للمتابعة الداخلية)
                              </span>
                            </label>

                            <label
                              className={`inline-flex items-center gap-1.5 ${
                                officialOk ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'
                              }`}
                            >
                              <input
                                type="radio"
                                name="letter_issue_mode"
                                disabled={!officialOk}
                                checked={printPayload.letterMode === 'official'}
                                onChange={() =>
                                  setPrintPayload({ ...printPayload, letterMode: 'official' })
                                }
                              />
                              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                صيغة قانونية رسمية معتمدة
                              </span>
                            </label>
                          </div>

                          {!officialOk && (
                            <span className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold">
                              الإصدار الرسمي معطل لأن ضوابط المرحلة غير معتمدة قانونياً برقم قرار وتاريخ
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                          <input
                            type="text"
                            value={printPayload.letterTitle ?? ''}
                            onChange={(e) =>
                              setPrintPayload({ ...printPayload, letterTitle: e.target.value })
                            }
                            placeholder="عنوان الكتاب"
                            className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                          />
                          <input
                            type="text"
                            value={printPayload.letterNumber ?? ''}
                            onChange={(e) =>
                              setPrintPayload({ ...printPayload, letterNumber: e.target.value })
                            }
                            placeholder="رقم الصادر / العدد"
                            className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 tabular-nums"
                          />
                          <input
                            type="date"
                            value={printPayload.letterDate ?? ''}
                            onChange={(e) =>
                              setPrintPayload({ ...printPayload, letterDate: e.target.value })
                            }
                            className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 tabular-nums"
                          />
                          <input
                            type="text"
                            value={printPayload.recipientLabel ?? ''}
                            onChange={(e) =>
                              setPrintPayload({ ...printPayload, recipientLabel: e.target.value })
                            }
                            placeholder="الجهة المخاطبة (ولي الأمر)"
                            className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                          />
                        </div>

                        <textarea
                          rows={3}
                          value={printPayload.customBody ?? ''}
                          onChange={(e) =>
                            setPrintPayload({ ...printPayload, customBody: e.target.value })
                          }
                          className="w-full px-3 py-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 leading-relaxed"
                          placeholder="نص الكتاب الرسمي (قابل للتعديل قبل الطباعة)..."
                        />
                      </>
                    );
                  })()}
                </div>
              )}

            {/* Printable Sheet Preview */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-5 bg-slate-100 dark:bg-slate-950">
              <LegalPrintSheet payload={printPayload} mode="preview" />
            </div>
          </div>
        </div>
      )}

      {/* Portal Print Sheet for native browser window.print() */}
      {typeof document !== 'undefined' &&
        printPayload &&
        createPortal(<LegalPrintSheet payload={printPayload} mode="print" />, document.body)}
    </div>
  );
}
