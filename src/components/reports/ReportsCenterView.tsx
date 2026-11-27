import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FileText,
  Printer,
  Search,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  X,
  FileCheck,
  Layers,
  Send,
  History,
  Download,
  Loader2,
} from 'lucide-react';
import { useNumberDisplay } from '../../contexts/NumberDisplayContext';
import { schoolService } from '../../services/schoolService';
import {
  UNIFIED_OFFICIAL_LETTER_TEMPLATE,
  resolveOfficialLetterTemplate,
  splitLetterBodyParagraphs,
} from '../../utils/officialDocumentHtml';
import { BidiText, LtrSpan } from '../common/BidirectionalText';
import type {
  AcademicYear,
  DynamicStageReportResponse,
  GradeWithSections,
  IssuedOfficialLetter,
  SchoolSettings,
} from '../../types/school';

interface ReportsCenterViewProps {
  settings?: SchoolSettings | null;
  activeAcademicYear?: AcademicYear | null;
  academicYears?: AcademicYear[];
  selectedYearId?: number | null;
  onSelectYear?: (yearId: number) => void;
  grades: GradeWithSections[];
  onRefreshCore?: () => Promise<void>;
  onOpenLegalSettings?: () => void;
  onNotify?: (type: 'error' | 'info' | 'success', message: string) => void;
  isHistoricalReadOnly?: boolean;
}

export function ReportsCenterView({
  settings,
  activeAcademicYear,
  academicYears = [],
  selectedYearId,
  grades,
  onOpenLegalSettings,
  onNotify,
}: ReportsCenterViewProps) {
  const { plain, dateDMY, academicYear, convert } = useNumberDisplay();
  const yearId = selectedYearId ?? activeAcademicYear?.id ?? academicYears[0]?.id;

  const [reportData, setReportData] = useState<DynamicStageReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedStageId, setSelectedStageId] = useState<number | undefined>(undefined);
  const [selectedGradeId, setSelectedGradeId] = useState<number | undefined>(undefined);
  const [selectedSectionId, setSelectedSectionId] = useState<number | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');

  // Issue Letter Modal & Draft State
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [docNumber, setDocNumber] = useState('');
  const [letterDate, setLetterDate] = useState(new Date().toISOString().slice(0, 10));
  const [subjectDraft, setSubjectDraft] = useState('');
  const [bodyDraft, setBodyDraft] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [issuedSuccess, setIssuedSuccess] = useState<string | null>(null);

  // Issued Letters History Modal
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [issuedLetters, setIssuedLetters] = useState<IssuedOfficialLetter[]>([]);

  // Print Preview for Issued Letter
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [selectedLetter, setSelectedLetter] = useState<IssuedOfficialLetter | null>(null);

  // Print Portal & PDF Export states
  const [printTarget, setPrintTarget] = useState<'report' | 'letter' | null>(null);
  const [exportingReportPdf, setExportingReportPdf] = useState(false);
  const [exportingLetterPdf, setExportingLetterPdf] = useState(false);

  const requestSeqRef = useRef(0);

  const effectiveSettings = useMemo(() => {
    return {
      ...(reportData?.school_settings ?? {}),
      ...(settings ?? {}),
    } as Partial<SchoolSettings>;
  }, [reportData?.school_settings, settings]);

  const effectiveLogoUrl = effectiveSettings.school_logo_data || null;
  const effectivePrincipalName = (effectiveSettings.principal_name ?? '').trim();
  const effectiveDirectorateName =
    effectiveSettings.directorate_name || 'المديرية العامة للتربية';
  const effectiveSchoolName = effectiveSettings.school_name || 'المدرسة النموذجية';
  const effectiveAcademicYearName =
    (selectedLetter
      ? academicYears.find((y) => y.id === selectedLetter.academic_year_id)?.name
      : undefined) ??
    reportData?.academic_year.name ??
    activeAcademicYear?.name ??
    'العام الدراسي';

  useEffect(() => {
    if (!printTarget) return;
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-reports-print-page', 'true');
    styleEl.textContent =
      printTarget === 'letter'
        ? `@page { size: A4 portrait; margin: 14mm 16mm; }`
        : `@page { size: A4 portrait; margin: 13mm 14mm; }`;
    document.head.appendChild(styleEl);

    const handleAfterPrint = () => {
      setPrintTarget(null);
    };
    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      window.removeEventListener('afterprint', handleAfterPrint);
      if (styleEl.parentNode) {
        styleEl.parentNode.removeChild(styleEl);
      }
    };
  }, [printTarget]);

  const fetchReport = async (stageIdOverride?: number) => {
    if (!yearId) return;
    const reqSeq = ++requestSeqRef.current;
    try {
      setLoading(true);
      setError(null);
      const targetStageId = stageIdOverride !== undefined ? stageIdOverride : selectedStageId;
      const res = await schoolService.getDynamicStageReport({
        academic_year_id: yearId,
        stage_id: targetStageId,
        grade_id: selectedGradeId,
        section_id: selectedSectionId,
        search: searchQuery.trim() || undefined,
      });

      if (reqSeq !== requestSeqRef.current) return;

      setReportData(res);
      if (selectedStageId === undefined && res.current_stage) {
        setSelectedStageId(res.current_stage.id);
      }
    } catch (err: any) {
      if (reqSeq !== requestSeqRef.current) return;
      setError(err.message || 'تعذر جلب تقرير الغياب الديناميكي.');
    } finally {
      if (reqSeq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchReport();
  }, [yearId, selectedStageId, selectedGradeId, selectedSectionId]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchReport();
  };

  const handleOpenIssueModal = () => {
    if (!reportData || !reportData.current_stage) return;
    const stage = reportData.current_stage;
    setError(null);
    setSubjectDraft(`الإعلان عن أسماء الطلبة المشمولين بمرحلة ${stage.name}`);
    const savedUnifiedTemplate =
      effectiveSettings.unified_letter_template ??
      reportData.school_settings?.unified_letter_template ??
      UNIFIED_OFFICIAL_LETTER_TEMPLATE;
    const rendered = resolveOfficialLetterTemplate(savedUnifiedTemplate, {
      absence_days: stage.days_threshold,
      stage_name: stage.name,
      academic_year: reportData.academic_year.name,
      school_name: effectiveSchoolName,
      date: letterDate,
      document_number: docNumber || '...',
      student_count: reportData.rows.length,
    });
    setBodyDraft(rendered);
    setIssueModalOpen(true);
  };

  const triggerPrintMode = (target: 'report' | 'letter') => {
    setPrintTarget(target);
    requestAnimationFrame(() => {
      setTimeout(() => {
        window.print();
      }, 50);
    });
  };

  const handleExportReportPdf = async () => {
    if (!yearId || !reportData?.current_stage) return;
    try {
      setExportingReportPdf(true);
      setError(null);
      await schoolService.exportStageReportPdf({
        academic_year_id: yearId,
        stage_id: reportData.current_stage.id,
        grade_id: selectedGradeId,
        section_id: selectedSectionId,
        search: searchQuery.trim() || undefined,
      });
      onNotify?.('success', 'تم إنشاء وتنزيل ملف PDF للتقرير بنجاح.');
    } catch (err: any) {
      const msg = err?.message || 'تعذر تصدير التقرير بصيغة PDF.';
      setError(msg);
      onNotify?.('error', msg);
    } finally {
      setExportingReportPdf(false);
    }
  };

  const handleExportLetterPdf = async () => {
    if (!selectedLetter) return;
    try {
      setExportingLetterPdf(true);
      setError(null);
      await schoolService.exportIssuedLetterPdf(
        selectedLetter.id,
        selectedLetter.document_number
      );
      onNotify?.('success', 'تم إنشاء وتنزيل ملف PDF للكتاب الرسمي بنجاح.');
    } catch (err: any) {
      const msg = err?.message || 'تعذر تصدير الكتاب الرسمي بصيغة PDF.';
      setError(msg);
      onNotify?.('error', msg);
    } finally {
      setExportingLetterPdf(false);
    }
  };

  const handleIssueLetterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!yearId || !reportData || !reportData.current_stage) {
      setError('يرجى اختيار المرحلة الدراسية والسنة النشطة أولاً.');
      return;
    }
    if (!docNumber.trim() || !letterDate) {
      setError('يرجى إدخال رقم الكتاب وتاريخ الإصدار.');
      return;
    }
    if (!bodyDraft.trim()) {
      setError('نص الكتاب لا يمكن أن يكون فارغاً.');
      return;
    }
    try {
      setIssuing(true);
      setError(null);
      const letter = await schoolService.issueOfficialLetter({
        academic_year_id: yearId,
        stage_id: reportData.current_stage.id,
        document_number: docNumber.trim(),
        letter_date: letterDate,
        subject: subjectDraft.trim(),
        custom_body: bodyDraft,
        grade_id: selectedGradeId,
        section_id: selectedSectionId,
        search: searchQuery.trim() || undefined,
      });
      setIssuing(false);
      setIssueModalOpen(false);
      setIssuedSuccess(
        `تم إصدار وتثبيت الكتاب الرسمي برقم (${convert(letter.document_number)}) بنجاح.`
      );
      setDocNumber('');
      setSelectedLetter(letter);
      setPrintPreviewOpen(true);
      setTimeout(() => setIssuedSuccess(null), 5000);
    } catch (err: any) {
      setIssuing(false);
      setError(err.message || 'تعذر إصدار الكتاب الرسمي.');
    }
  };

  const loadHistory = async () => {
    if (!yearId) return;
    try {
      const letters = await schoolService.listIssuedLetters(yearId);
      setIssuedLetters(letters);
      setHistoryModalOpen(true);
    } catch (err: any) {
      setError(err.message || 'تعذر جلب سجل الكتب الرسمية الصادرة.');
    }
  };

  const currentGradeObj = grades.find((g) => g.id === selectedGradeId);
  const currentSections = currentGradeObj ? currentGradeObj.sections : [];

  const activeFilterSummary = useMemo(() => {
    const parts: string[] = [];
    if (selectedGradeId && currentGradeObj) parts.push(`الصف: ${currentGradeObj.name}`);
    if (selectedSectionId) {
      const sec = currentSections.find((s) => s.id === selectedSectionId);
      if (sec) parts.push(`الشعبة: ${sec.name}`);
    }
    if (searchQuery.trim()) parts.push(`بحث: ${searchQuery.trim()}`);
    return parts.join(' · ');
  }, [selectedGradeId, currentGradeObj, selectedSectionId, currentSections, searchQuery]);

  const letterStudents = useMemo(() => {
    if (!selectedLetter) return [];
    try {
      const parsed = JSON.parse(selectedLetter.students_json || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [selectedLetter]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header Banner */}
      <div className="rounded-2xl border border-teal-200 dark:border-teal-800/60 bg-gradient-to-br from-teal-50/80 via-white to-teal-50/30 dark:from-teal-950/30 dark:via-slate-900 dark:to-teal-950/10 p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-600 to-teal-700 text-white flex items-center justify-center shrink-0 shadow-md">
              <FileCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 dark:text-slate-100 font-display">
                مركز تقارير الغياب ومتابعة المراحل والكتب الرسمية
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                إصدار الكتب الإدارية الرسمية الموحدة للإعلان عن أسماء الطلبة على لوحة الإعلانات المدرسية بناءً على مراحل الغياب المعرفة.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadHistory}
              className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs sm:text-sm font-semibold shadow-xs hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <History className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>سجل الكتب الصادرة</span>
            </button>
            <button
              type="button"
              onClick={() => fetchReport()}
              className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[40px] rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs sm:text-sm font-semibold shadow-xs transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span>تحديث البيانات</span>
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-4 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm text-rose-900 dark:text-rose-200 shadow-xs">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          {error.includes('قالب') && onOpenLegalSettings && (
            <button
              type="button"
              onClick={onOpenLegalSettings}
              className="px-3.5 py-1.5 min-h-[36px] rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold"
            >
              الذهاب لإعدادات القوالب
            </button>
          )}
        </div>
      )}

      {issuedSuccess && (
        <div className="rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-4 flex items-center gap-3 text-xs sm:text-sm text-emerald-900 dark:text-emerald-200 shadow-xs">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{issuedSuccess}</span>
        </div>
      )}

      {/* Stage Tabs */}
      {reportData && reportData.stages.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
          {reportData.stages.map((stage) => {
            const count = reportData.summary.stage_counts[stage.id] ?? 0;
            const isSelected = reportData.current_stage?.id === stage.id;
            return (
              <button
                key={stage.id}
                type="button"
                onClick={() => setSelectedStageId(stage.id)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 min-h-[40px] rounded-xl text-xs sm:text-sm font-bold transition-all ${
                  isSelected
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70'
                }`}
              >
                <Layers className="w-4 h-4 opacity-80" />
                <span><BidiText text={stage.name} /></span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] tabular-nums font-extrabold ${isSelected ? 'bg-white/20 text-white' : 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300'}`}>
                  {plain(count)} طالب
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Filters Bar */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
        <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث باسم الطالب أو رقم القيد..."
              className="w-full px-3 py-2 min-h-[40px] text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 dark:focus:ring-emerald-500/30"
            />
          </div>
          <div className="w-full sm:w-auto">
            <select
              value={selectedGradeId || ''}
              onChange={(e) => {
                const gId = e.target.value ? Number(e.target.value) : undefined;
                setSelectedGradeId(gId);
                setSelectedSectionId(undefined);
              }}
              className="w-full sm:w-44 px-3 py-2 min-h-[40px] text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 dark:focus:ring-emerald-500/30"
            >
              <option value="">جميع الصفوف</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-auto">
            <select
              value={selectedSectionId || ''}
              onChange={(e) => setSelectedSectionId(e.target.value ? Number(e.target.value) : undefined)}
              disabled={!selectedGradeId}
              className="w-full sm:w-40 px-3 py-2 min-h-[40px] text-xs sm:text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 dark:focus:ring-emerald-500/30 disabled:opacity-50"
            >
              <option value="">جميع الشعب</option>
              {currentSections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="px-4 py-2 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs sm:text-sm font-semibold transition-colors"
            >
              تصفية
            </button>
            {reportData && reportData.current_stage && reportData.rows.length > 0 && (
              <button
                type="button"
                onClick={handleOpenIssueModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs sm:text-sm font-bold shadow-xs transition-colors"
              >
                <Send className="w-4 h-4" />
                <span>إصدار كتاب رسمي للمرحلة</span>
              </button>
            )}
          </div>
        </form>
      </section>

      {/* Main Table */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden relative">
        {loading && (
          <div className="absolute top-0 inset-x-0 h-1 bg-emerald-600 animate-pulse z-10" />
        )}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-900/90">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 font-display">
              {reportData?.current_stage ? <BidiText text={reportData.current_stage.name} /> : 'تقرير الغياب'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              عتبة الغياب: {plain(reportData?.current_stage?.days_threshold || 0)} يوم فأكثر · إجمالي الطلاب المعنيين: {plain(reportData?.rows.length || 0)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-100/70 dark:bg-emerald-950/60 px-3 py-1.5 rounded-xl border border-emerald-200/60 dark:border-emerald-800/60">
              السنة الدراسية: <LtrSpan>{academicYear(reportData?.academic_year.name)}</LtrSpan>
            </span>
            {reportData && reportData.current_stage && (
              <>
                <button
                  type="button"
                  onClick={() => triggerPrintMode('report')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold shadow-xs transition-colors"
                >
                  <Printer className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>طباعة</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportReportPdf}
                  disabled={exportingReportPdf}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors disabled:opacity-60"
                >
                  {exportingReportPdf ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>{exportingReportPdf ? 'جاري إنشاء PDF...' : 'تصدير PDF'}</span>
                </button>
              </>
            )}
          </div>
        </div>

        {!reportData && loading ? (
          <div className="p-16 text-center text-xs text-slate-500">جاري احتساب البيانات وجلب الطلاب...</div>
        ) : !reportData || reportData.rows.length === 0 ? (
          <div className="p-16 text-center">
            <FileText className="w-10 h-10 text-slate-400 mx-auto mb-3 opacity-60" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
              لا يوجد طلاب في هذه المرحلة وفقاً لمعايير البحث الحالية.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right tabular-nums">
              <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-3 font-semibold text-center w-12">ت</th>
                  <th className="py-2.5 px-3 font-semibold">اسم الطالب</th>
                  <th className="py-2.5 px-3 font-semibold">الصف والشعبة</th>
                  <th className="py-2.5 px-3 font-semibold text-center">أيام الغياب المحتسبة</th>
                  <th className="py-2.5 px-3 font-semibold text-center">المرحلة الحالية</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {reportData.rows.map((row, idx) => (
                  <tr key={row.student_id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 align-middle">
                    <td className="py-3 px-3 text-center text-slate-500">{plain(idx + 1)}</td>
                    <td className="py-3 px-3">
                      <p className="font-bold text-slate-900 dark:text-slate-100">{row.full_name}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {row.registry_number ? (
                          <>
                            قيد: <BidiText text={row.registry_number} />
                          </>
                        ) : (
                          <LtrSpan>{row.student_uid}</LtrSpan>
                        )}
                      </p>
                    </td>
                    <td className="py-3 px-3 font-semibold text-slate-800 dark:text-slate-200">
                      <BidiText text={`${row.grade_name} - ${row.section_name}`} />
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="text-sm font-extrabold text-red-700 dark:text-red-400">
                        {plain(row.counted_absence_days)} يوم
                      </span>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        مباشر: {plain(row.direct_full_days)} · دروس: {plain(row.converted_lesson_days)}
                      </p>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="px-2.5 py-1 rounded-full bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-300 text-xs font-bold">
                        <BidiText text={row.stage_name || reportData.current_stage?.name} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Issue Official Letter Modal & Draft Editor */}
      {issueModalOpen && reportData && reportData.current_stage && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-5" role="dialog" aria-modal="true">
          <div className="w-full max-w-3xl max-h-[92vh] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-900">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                إصدار كتاب إداري رسمي موحد لـ ({reportData.current_stage.name})
              </h3>
              <button type="button" onClick={() => setIssueModalOpen(false)} className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleIssueLetterSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs sm:text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1">
                    رقم الكتاب الرسمي <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={docNumber}
                    onChange={(e) => setDocNumber(e.target.value)}
                    placeholder="مثال: ق/421"
                    className="w-full px-3 py-2 min-h-[40px] text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 dark:focus:ring-emerald-500/30"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1">
                    تاريخ الكتاب <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={letterDate}
                    onChange={(e) => setLetterDate(e.target.value)}
                    className="w-full px-3 py-2 min-h-[40px] text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 dark:focus:ring-emerald-500/30"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-800 dark:text-slate-200 mb-1">
                  موضوع الكتاب (م/) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={subjectDraft}
                  onChange={(e) => setSubjectDraft(e.target.value)}
                  placeholder="م/ الإعلان عن أسماء الطلبة..."
                  className="w-full px-3 py-2 min-h-[40px] text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 dark:focus:ring-emerald-500/30"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block font-bold text-slate-800 dark:text-slate-200">
                    نص الكتاب الرسمي (مستمد من النص الموحد المعتمد لجميع المراحل) <span className="text-rose-500">*</span>
                  </label>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    عدد الطلاب المشمولين: {plain(reportData.rows.length)} طالب
                  </span>
                </div>
                <textarea
                  rows={6}
                  required
                  value={bodyDraft}
                  onChange={(e) => setBodyDraft(e.target.value)}
                  className="w-full px-3 py-2 text-xs sm:text-sm font-sans rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 dark:focus:ring-emerald-500/30 leading-relaxed"
                />
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-950/50 rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
                <span className="font-bold text-emerald-700 dark:text-emerald-400">معاينة الجدول:</span> سيتم إدراج جدول أسماء الطلبة تلقائياً في الأسفل (ت، اسم الطالب، الصف والشعبة، عدد أيام الغياب).
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIssueModalOpen(false)}
                  className="px-4 py-2 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={issuing}
                  className="inline-flex items-center gap-1.5 px-5 py-2 min-h-[40px] rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold shadow-xs disabled:opacity-50 transition-colors"
                >
                  <Send className="w-4 h-4" />
                  <span>{issuing ? 'جاري الإصدار والتثبيت...' : 'اعتماد وإصدار الكتاب الرسمي'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Issued Letters History Modal */}
      {historyModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-5" role="dialog" aria-modal="true">
          <div className="w-full max-w-4xl max-h-[90vh] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-900">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                سجل الكتب الرسمية الصادرة ({plain(issuedLetters.length)})
              </h3>
              <button type="button" onClick={() => setHistoryModalOpen(false)} className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {issuedLetters.length === 0 ? (
                <div className="p-12 text-center text-xs text-slate-500">لا توجد كتب رسمية صادرة بعد.</div>
              ) : (
                <div className="space-y-3">
                  {issuedLetters.map((letter) => {
                    const studentsCount = (() => {
                      try {
                        return JSON.parse(letter.students_json || '[]').length;
                      } catch {
                        return 0;
                      }
                    })();
                    return (
                      <div key={letter.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 dark:text-slate-100 text-sm font-display">
                              <BidiText text={letter.stage_name} />
                            </span>
                            <span className="px-2 py-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-xs font-bold border border-emerald-200/60 dark:border-emerald-800/60">
                              رقم الكتاب: <BidiText text={letter.document_number} />
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              التاريخ: <LtrSpan>{dateDMY(letter.letter_date)}</LtrSpan>
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400">
                            الموضوع: <BidiText text={letter.subject} /> · عدد الطلاب: {plain(studentsCount)} طالب · عتبة الغياب: {plain(letter.days_threshold)} يوم
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedLetter(letter);
                            setHistoryModalOpen(false);
                            setPrintPreviewOpen(true);
                          }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-semibold shrink-0 shadow-xs transition-colors"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>عرض ومعاينة الطباعة</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Print Preview Modal for Issued Letter */}
      {printPreviewOpen && selectedLetter && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-5 no-print" role="dialog" aria-modal="true">
          <div className="w-full max-w-4xl max-h-[92vh] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between no-print bg-slate-50/70 dark:bg-slate-900">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">
                معاينة طباعة الكتاب الرسمي رقم (<BidiText text={selectedLetter.document_number} />)
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => triggerPrintMode('letter')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 min-h-[36px] rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-semibold shadow-xs transition-colors"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>طباعة</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportLetterPdf}
                  disabled={exportingLetterPdf}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 min-h-[36px] rounded-xl bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-semibold disabled:opacity-60 shadow-xs transition-colors"
                >
                  {exportingLetterPdf ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>{exportingLetterPdf ? 'جاري التصدير...' : 'تصدير PDF'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPrintPreviewOpen(false)}
                  className="p-1.5 rounded-xl text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Official A4 Preview Container */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-100 dark:bg-slate-950">
              <div
                dir="rtl"
                className="font-official-letter max-w-[210mm] min-h-[263mm] mx-auto bg-white text-slate-900 px-8 py-7 sm:px-10 sm:py-9 shadow-sm border border-slate-200 flex flex-col"
              >
                {/* 3-column official header */}
                <div className="grid grid-cols-3 gap-4 items-center text-center text-[13px] font-bold border-b-[1.5px] border-slate-400 pb-3 mb-3.5">
                  <div className="text-right leading-[1.7] text-slate-800">
                    <p>جمهورية العراق</p>
                    <p>وزارة التربية</p>
                    <p><BidiText text={effectiveDirectorateName} /></p>
                    <p className="mt-1 font-bold text-slate-900 text-[13.5px]">إدارة / <BidiText text={effectiveSchoolName} /></p>
                  </div>
                  <div className="flex flex-col items-center justify-center">
                    {effectiveLogoUrl && (
                      <img
                        src={effectiveLogoUrl}
                        alt="شعار المدرسة"
                        className="max-h-16 max-w-[115px] w-auto h-auto object-contain mb-1.5"
                      />
                    )}
                    <p className="text-[13px] font-bold text-slate-900">
                      <LtrSpan>{academicYear(effectiveAcademicYearName)}</LtrSpan>
                    </p>
                  </div>
                  <div className="text-left leading-[1.75] text-slate-800 tabular-nums">
                    <p>الرقم: <BidiText text={selectedLetter.document_number} /></p>
                    <p>التاريخ: <LtrSpan>{dateDMY(selectedLetter.letter_date)}</LtrSpan></p>
                  </div>
                </div>

                {/* Centered Bold Subject (م/) */}
                <div className="text-center my-3">
                  <div className="inline-block px-5 pb-1 border-b-[1.5px] border-slate-600 font-bold text-[17px] leading-[1.75] text-slate-900">
                    <span>م/ </span>
                    <span><BidiText text={selectedLetter.subject} /></span>
                  </div>
                </div>

                {/* Letter Body Text */}
                <div dir="rtl" className="text-right text-[15.5px] leading-[1.95] text-slate-900 py-1 mb-3 break-words">
                  {splitLetterBodyParagraphs(
                    resolveOfficialLetterTemplate(selectedLetter.rendered_content, {
                      absence_days: selectedLetter.days_threshold,
                      stage_name: selectedLetter.stage_name,
                      academic_year: effectiveAcademicYearName,
                      school_name: effectiveSchoolName,
                      date: dateDMY(selectedLetter.letter_date),
                      document_number: selectedLetter.document_number,
                    })
                  ).map((line, idx) =>
                    line.trim().length === 0 ? (
                      <div key={idx} className="h-2" />
                    ) : (
                      <p key={idx} className="mb-2 last:mb-0 text-right">
                        <BidiText text={line} />
                      </p>
                    )
                  )}
                </div>

                {/* Students Table */}
                <div className="pt-1">
                  <h4 className="text-[15px] font-bold text-slate-900 mb-2">
                    أسماء الطلبة
                  </h4>
                  <table className="w-full text-[13.5px] leading-[1.65] text-right border-collapse border border-slate-500 table-fixed tabular-nums">
                    <thead className="bg-slate-100 text-slate-900">
                      <tr>
                        <th className="border border-slate-500 px-2.5 py-1.5 text-center w-12 font-bold">ت</th>
                        <th className="border border-slate-500 px-2.5 py-1.5 font-bold w-[44%]">اسم الطالب</th>
                        <th className="border border-slate-500 px-2.5 py-1.5 font-bold w-[30%]">الصف والشعبة</th>
                        <th className="border border-slate-500 px-2.5 py-1.5 text-center font-bold w-[120px]">عدد أيام الغياب</th>
                      </tr>
                    </thead>
                    <tbody>
                      {letterStudents.map((st: any, i: number) => (
                        <tr key={i}>
                          <td className="border border-slate-500 px-2.5 py-1.5 text-center font-bold">{plain(i + 1)}</td>
                          <td className="border border-slate-500 px-2.5 py-1.5 font-bold break-words">{st.full_name}</td>
                          <td className="border border-slate-500 px-2.5 py-1.5 break-words">
                            <BidiText text={`${st.grade_name} - ${st.section_name}`} />
                          </td>
                          <td className="border border-slate-500 px-2.5 py-1.5 text-center font-bold text-slate-900 tabular-nums">
                            {plain(st.counted_absence_days)} يوم
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Balanced Footer: Principal on Left + Copy-To on Right */}
                <div className="mt-auto pt-6">
                  <div className="flex justify-end pb-6">
                    <div className="text-center min-w-[190px]">
                      {effectivePrincipalName ? (
                        <p className="text-[17px] font-bold text-slate-900 leading-[1.45]">
                          {effectivePrincipalName}
                        </p>
                      ) : null}
                      <p className="text-[14.5px] font-bold text-slate-800 mt-0.5">
                        مدير المدرسة
                      </p>
                    </div>
                  </div>

                  <div className="text-right border-t border-slate-400 pt-2 text-[13px] font-bold text-slate-900 leading-[1.75]">
                    <p>نسخة منه إلى /</p>
                    <p className="pr-4 font-normal text-slate-800">معاون شؤون الطلبة</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Print-Only Portal outside .no-print root so window.print() renders cleanly */}
      {typeof document !== 'undefined' &&
        printTarget &&
        createPortal(
          <div dir="rtl" className="print-only bg-white text-slate-900 font-sans text-xs">
            {printTarget === 'letter' && selectedLetter ? (
              <div className="font-official-letter official-letter-print-sheet text-slate-900">
                <div className="grid grid-cols-3 gap-4 items-center text-center text-[13px] font-bold border-b-[1.5px] border-slate-400 pb-3 mb-3.5">
                  <div className="text-right leading-[1.7] text-slate-800">
                    <p>جمهورية العراق</p>
                    <p>وزارة التربية</p>
                    <p><BidiText text={effectiveDirectorateName} /></p>
                    <p className="mt-1 font-bold text-slate-900 text-[13.5px]">إدارة / <BidiText text={effectiveSchoolName} /></p>
                  </div>
                  <div className="flex flex-col items-center justify-center">
                    {effectiveLogoUrl && (
                      <img
                        src={effectiveLogoUrl}
                        alt="شعار المدرسة"
                        className="max-h-16 max-w-[115px] w-auto h-auto object-contain mb-1.5"
                      />
                    )}
                    <p className="text-[13px] font-bold text-slate-900">
                      <LtrSpan>{academicYear(effectiveAcademicYearName)}</LtrSpan>
                    </p>
                  </div>
                  <div className="text-left leading-[1.75] text-slate-800 tabular-nums">
                    <p>الرقم: <BidiText text={selectedLetter.document_number} /></p>
                    <p>التاريخ: <LtrSpan>{dateDMY(selectedLetter.letter_date)}</LtrSpan></p>
                  </div>
                </div>

                <div className="text-center my-3" style={{ breakAfter: 'avoid' }}>
                  <div className="inline-block px-5 pb-1 border-b-[1.5px] border-slate-600 font-bold text-[17px] leading-[1.75] text-slate-900">
                    <span>م/ </span>
                    <span><BidiText text={selectedLetter.subject} /></span>
                  </div>
                </div>

                <div dir="rtl" className="text-right text-[15.5px] leading-[1.95] text-slate-900 py-1 mb-3 break-words">
                  {splitLetterBodyParagraphs(
                    resolveOfficialLetterTemplate(selectedLetter.rendered_content, {
                      absence_days: selectedLetter.days_threshold,
                      stage_name: selectedLetter.stage_name,
                      academic_year: effectiveAcademicYearName,
                      school_name: effectiveSchoolName,
                      date: dateDMY(selectedLetter.letter_date),
                      document_number: selectedLetter.document_number,
                    })
                  ).map((line, idx) =>
                    line.trim().length === 0 ? (
                      <div key={idx} className="h-2" />
                    ) : (
                      <p key={idx} className="mb-2 last:mb-0 text-right">
                        <BidiText text={line} />
                      </p>
                    )
                  )}
                </div>

                <div className="pt-1">
                  <h4 className="text-[15px] font-bold text-slate-900 mb-2" style={{ breakAfter: 'avoid' }}>
                    أسماء الطلبة
                  </h4>
                  <table className="w-full text-[13.5px] leading-[1.65] text-right border-collapse border border-slate-500 table-fixed print-table tabular-nums">
                    <thead className="bg-slate-100 text-slate-900">
                      <tr>
                        <th className="border border-slate-500 px-2.5 py-1.5 text-center w-12 font-bold">ت</th>
                        <th className="border border-slate-500 px-2.5 py-1.5 font-bold w-[44%]">اسم الطالب</th>
                        <th className="border border-slate-500 px-2.5 py-1.5 font-bold w-[30%]">الصف والشعبة</th>
                        <th className="border border-slate-500 px-2.5 py-1.5 text-center font-bold w-[120px]">عدد أيام الغياب</th>
                      </tr>
                    </thead>
                    <tbody>
                      {letterStudents.map((st: any, i: number) => (
                        <tr key={i}>
                          <td className="border border-slate-500 px-2.5 py-1.5 text-center font-bold">{plain(i + 1)}</td>
                          <td className="border border-slate-500 px-2.5 py-1.5 font-bold break-words">{st.full_name}</td>
                          <td className="border border-slate-500 px-2.5 py-1.5 break-words">
                            <BidiText text={`${st.grade_name} - ${st.section_name}`} />
                          </td>
                          <td className="border border-slate-500 px-2.5 py-1.5 text-center font-bold text-slate-900 tabular-nums">
                            {plain(st.counted_absence_days)} يوم
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="official-letter-print-footer">
                  <div className="flex justify-end pb-6">
                    <div className="text-center min-w-[190px]">
                      {effectivePrincipalName ? (
                        <p className="text-[17px] font-bold text-slate-900 leading-[1.45]">
                          {effectivePrincipalName}
                        </p>
                      ) : null}
                      <p className="text-[14.5px] font-bold text-slate-800 mt-0.5">مدير المدرسة</p>
                    </div>
                  </div>

                  <div className="text-right border-t border-slate-400 pt-2 text-[13px] font-bold text-slate-900 leading-[1.75]">
                    <p>نسخة منه إلى /</p>
                    <p className="pr-4 font-normal text-slate-800">معاون شؤون الطلبة</p>
                  </div>
                </div>
              </div>
            ) : printTarget === 'report' && reportData ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4 items-center text-center text-xs font-bold border-b border-slate-300 pb-4">
                  <div className="text-right">
                    <p>جمهورية العراق</p>
                    <p>وزارة التربية</p>
                    <p><BidiText text={effectiveDirectorateName} /></p>
                    <p className="mt-2 font-black text-slate-900">إدارة / <BidiText text={effectiveSchoolName} /></p>
                  </div>
                  <div className="flex flex-col items-center justify-center">
                    {effectiveLogoUrl && (
                      <img
                        src={effectiveLogoUrl}
                        alt="شعار المدرسة"
                        className="max-h-16 max-w-[115px] w-auto h-auto object-contain mb-1.5"
                      />
                    )}
                    <p className="text-xs font-extrabold">
                      <LtrSpan>{academicYear(reportData.academic_year.name)}</LtrSpan>
                    </p>
                  </div>
                  <div className="text-left tabular-nums">
                    <p>التاريخ: <LtrSpan>{dateDMY(new Date().toISOString().slice(0, 10))}</LtrSpan></p>
                    <p>عدد الطلاب: {plain(reportData.rows.length)}</p>
                  </div>
                </div>

                <div className="py-2 px-3 bg-slate-50 rounded-lg font-extrabold text-sm border border-slate-200">
                  تقرير مرحلة الغياب: <BidiText text={reportData.current_stage?.name || 'تقرير الغياب'} />
                </div>

                <div className="flex flex-wrap gap-x-5 gap-y-1 px-3 py-2 bg-slate-50 border border-slate-300 rounded text-[11px] tabular-nums">
                  <span><strong>عتبة الغياب:</strong> {plain(reportData.current_stage?.days_threshold || 0)} يوم فأكثر</span>
                  <span><strong>إجمالي الطلاب:</strong> {plain(reportData.rows.length)} طالب</span>
                  {activeFilterSummary && <span><strong>التصفية المطبقة:</strong> <BidiText text={activeFilterSummary} /></span>}
                </div>

                <table className="w-full text-xs text-right border-collapse border border-slate-300 print-table tabular-nums">
                  <thead className="bg-slate-100 text-slate-800">
                    <tr>
                      <th className="border border-slate-300 p-2 text-center w-11 font-bold">ت</th>
                      <th className="border border-slate-300 p-2 font-bold">اسم الطالب</th>
                      <th className="border border-slate-300 p-2 font-bold">الصف والشعبة</th>
                      <th className="border border-slate-300 p-2 text-center font-bold w-32">أيام الغياب المحتسبة</th>
                      <th className="border border-slate-300 p-2 text-center font-bold w-32">المرحلة الحالية</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.rows.map((row, idx) => (
                      <tr key={row.student_id}>
                        <td className="border border-slate-300 p-2 text-center">{plain(idx + 1)}</td>
                        <td className="border border-slate-300 p-2">
                          <p className="font-bold text-slate-900">{row.full_name}</p>
                          <p className="text-[10px] text-slate-500">
                            {row.registry_number ? (
                              <>
                                قيد: <BidiText text={row.registry_number} />
                              </>
                            ) : (
                              <LtrSpan>{row.student_uid}</LtrSpan>
                            )}
                          </p>
                        </td>
                        <td className="border border-slate-300 p-2 font-semibold">
                          <BidiText text={`${row.grade_name} - ${row.section_name}`} />
                        </td>
                        <td className="border border-slate-300 p-2 text-center">
                          <p className="font-bold text-red-700">{plain(row.counted_absence_days)} يوم</p>
                          <p className="text-[10px] text-slate-500">
                            مباشر: {plain(row.direct_full_days)} · دروس: {plain(row.converted_lesson_days)}
                          </p>
                        </td>
                        <td className="border border-slate-300 p-2 text-center font-bold">
                          <BidiText text={row.stage_name || reportData.current_stage?.name} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="flex justify-end pt-8 pb-12" style={{ breakInside: 'avoid' }}>
                  <div className="text-center min-w-[190px]">
                    {effectivePrincipalName ? (
                      <p className="text-base font-extrabold text-slate-900 leading-snug">
                        {effectivePrincipalName}
                      </p>
                    ) : null}
                    <p className="text-xs font-bold text-slate-800 mt-1">مدير المدرسة</p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>,
          document.body
        )}
    </div>
  );
}
