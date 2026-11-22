import React, { useEffect, useState } from 'react';
import {
  FileText,
  Printer,
  Search,
  Filter,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Download,
  X,
  FileCheck,
  Building2,
  Calendar,
  Layers,
  Send,
  History,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { schoolService } from '../../services/schoolService';
import type {
  AcademicYear,
  DynamicStageReportResponse,
  AbsenceStage,
  GradeWithSections,
  IssuedOfficialLetter,
} from '../../types/school';

interface ReportsCenterViewProps {
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
  activeAcademicYear,
  grades,
}: ReportsCenterViewProps) {
  const [reportData, setReportData] = useState<DynamicStageReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedStageId, setSelectedStageId] = useState<number | undefined>(undefined);
  const [selectedGradeId, setSelectedGradeId] = useState<number | undefined>(undefined);
  const [selectedSectionId, setSelectedSectionId] = useState<number | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');

  // Issue Letter Modal
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [docNumber, setDocNumber] = useState('');
  const [letterDate, setLetterDate] = useState(new Date().toISOString().slice(0, 10));
  const [issuing, setIssuing] = useState(false);
  const [issuedSuccess, setIssuedSuccess] = useState<string | null>(null);

  // Issued Letters History Modal
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [issuedLetters, setIssuedLetters] = useState<IssuedOfficialLetter[]>([]);
  const [selectedLetter, setSelectedLetter] = useState<IssuedOfficialLetter | null>(null);

  // Print Preview
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [printLetterPreview, setPrintLetterPreview] = useState<IssuedOfficialLetter | null>(null);

  const fetchReport = async (stageId?: number) => {
    if (!activeAcademicYear) return;
    try {
      setLoading(true);
      setError(null);
      const res = await schoolService.getDynamicStageReport({
        academic_year_id: activeAcademicYear.id,
        stage_id: stageId ?? selectedStageId,
        grade_id: selectedGradeId,
        section_id: selectedSectionId,
        search: searchQuery.trim() || undefined,
      });
      setReportData(res);
      if (!selectedStageId && res.current_stage) {
        setSelectedStageId(res.current_stage.id);
      }
    } catch (err: any) {
      setError(err.message || 'تعذر جلب تقرير الغياب الديناميكي.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [activeAcademicYear?.id, selectedStageId, selectedGradeId, selectedSectionId]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchReport();
  };

  const handleIssueLetterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAcademicYear || !reportData || !reportData.current_stage) {
      setError('يرجى اختيار المرحلة الدراسية والسنة النشطة أولاً.');
      return;
    }
    if (!docNumber.trim() || !letterDate) {
      setError('يرجى إدخال رقم الكتاب وتاريخ الإصدار.');
      return;
    }
    try {
      setIssuing(true);
      setError(null);
      const letter = await schoolService.issueOfficialLetter({
        academic_year_id: activeAcademicYear.id,
        stage_id: reportData.current_stage.id,
        document_number: docNumber.trim(),
        letter_date: letterDate,
        grade_id: selectedGradeId,
        section_id: selectedSectionId,
        search: searchQuery.trim() || undefined,
      });
      setIssuing(false);
      setIssueModalOpen(false);
      setIssuedSuccess(`تم إصدار وتثبيت الكتاب الرسمي برقم (${letter.document_number}) بنجاح.`);
      setDocNumber('');
      setTimeout(() => setIssuedSuccess(null), 5000);
    } catch (err: any) {
      setIssuing(false);
      setError(err.message || 'تعذر إصدار الكتاب الرسمي.');
    }
  };

  const loadHistory = async () => {
    if (!activeAcademicYear) return;
    try {
      const letters = await schoolService.listIssuedLetters(activeAcademicYear.id);
      setIssuedLetters(letters);
      setHistoryModalOpen(true);
    } catch (err: any) {
      setError(err.message || 'تعذر جلب سجل الكتب الرسمية الصادرة.');
    }
  };

  const currentGradeObj = grades.find((g) => g.id === selectedGradeId);
  const currentSections = currentGradeObj ? currentGradeObj.sections : [];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header Banner */}
      <div className="rounded-2xl border border-teal-200 dark:border-teal-800/60 bg-gradient-to-br from-teal-50/80 via-white to-teal-50/30 dark:from-teal-950/30 dark:via-slate-900 dark:to-teal-950/10 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-teal-700 text-white flex items-center justify-center shrink-0 shadow-md">
              <FileCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 dark:text-slate-100 font-display">
                مركز تقارير الغياب ومتابعة المراحل والكتب الرسمية
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                تصنيف غير تراكمي مستقل للطلاب بناءً على عتبات الغياب المعتمدة، مع إمكانية إصدار الكتب الرسمية وتوثيقها بشكل دائم.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadHistory}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs sm:text-sm font-bold shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              <History className="w-4 h-4 text-teal-700 dark:text-teal-400" />
              <span>سجل الكتب الصادرة</span>
            </button>
            <button
              type="button"
              onClick={() => fetchReport()}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs sm:text-sm font-bold shadow-sm transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span>تحديث البيانات</span>
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4 flex items-center gap-3 text-xs sm:text-sm text-red-900 dark:text-red-200">
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {issuedSuccess && (
        <div className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 p-4 flex items-center gap-3 text-xs sm:text-sm text-emerald-900 dark:text-emerald-200">
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
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
                  isSelected
                    ? 'bg-teal-700 text-white shadow-md'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <Layers className="w-4 h-4 opacity-80" />
                <span>{stage.name}</span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] tabular-nums font-extrabold ${isSelected ? 'bg-white/20 text-white' : 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300'}`}>
                  {count} طالب
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Filters Bar */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
        <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث باسم الطالب أو رقم القيد..."
              className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
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
              className="w-full sm:w-44 px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
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
              className="w-full sm:w-40 px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30 disabled:opacity-50"
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
              className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs sm:text-sm font-semibold transition-colors"
            >
              تصفية
            </button>
            {reportData && reportData.current_stage && reportData.rows.length > 0 && (
              <button
                type="button"
                onClick={() => setIssueModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs sm:text-sm font-bold shadow-sm transition-colors"
              >
                <Send className="w-4 h-4" />
                <span>إصدار كتاب رسمي للمرحلة</span>
              </button>
            )}
          </div>
        </form>
      </section>

      {/* Main Table */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/50 dark:bg-slate-900">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
              {reportData?.current_stage ? reportData.current_stage.name : 'تقرير الغياب'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              عتبة الغياب: {reportData?.current_stage?.days_threshold || 0} يوم فأكثر · إجمالي الطلاب المعنيين: {reportData?.rows.length || 0}
            </p>
          </div>
          <span className="text-xs font-bold text-teal-800 dark:text-teal-300 bg-teal-100 dark:bg-teal-950/60 px-3 py-1 rounded-lg">
            السنة الدراسية: {reportData?.academic_year.name}
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-xs text-slate-500">جاري احتساب البيانات وجلب الطلاب...</div>
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
                    <td className="py-3 px-3 text-center text-slate-500">{idx + 1}</td>
                    <td className="py-3 px-3">
                      <p className="font-bold text-slate-900 dark:text-slate-100">{row.full_name}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {row.registry_number ? `قيد: ${row.registry_number}` : row.student_uid}
                      </p>
                    </td>
                    <td className="py-3 px-3 font-semibold text-slate-800 dark:text-slate-200">
                      {row.grade_name} - {row.section_name}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="text-sm font-extrabold text-red-700 dark:text-red-400">
                        {row.counted_absence_days} يوم
                      </span>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        مباشر: {row.direct_full_days} · دروس: {row.converted_lesson_days}
                      </p>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="px-2.5 py-1 rounded-full bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-300 text-xs font-bold">
                        {row.stage_name || reportData.current_stage?.name}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Issue Official Letter Modal */}
      {issueModalOpen && reportData && reportData.current_stage && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-5" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                إصدار كتاب رسمي لـ ({reportData.current_stage.name})
              </h3>
              <button type="button" onClick={() => setIssueModalOpen(false)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={IssueOfficialLetterSubmitHandler} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                    رقم الكتاب الرسمي <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={docNumber}
                    onChange={(e) => setDocNumber(e.target.value)}
                    placeholder="مثال: ق/421"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                    تاريخ الكتاب <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={letterDate}
                    onChange={(e) => setLetterDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                  معاينة قالب الكتاب والطلاب المشمولين ({reportData.rows.length} طالب)
                </label>
                <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-mono max-h-44 overflow-y-auto whitespace-pre-wrap leading-relaxed text-slate-700 dark:text-slate-300">
                  {reportData.current_stage.letter_template}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIssueModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={issuing}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold shadow-sm disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  <span>{issuing ? 'جاري الإصدار...' : 'تثبيت وإصدار الكتاب الرسمي'}</span>
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
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                سجل الكتب الرسمية الصادرة ({issuedLetters.length})
              </h3>
              <button type="button" onClick={() => setHistoryModalOpen(false)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
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
                            <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                              {letter.stage_name}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-teal-100 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 text-xs font-bold">
                              رقم الكتاب: {letter.document_number}
                            </span>
                            <span className="text-xs text-slate-500">التاريخ: {letter.letter_date}</span>
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400">
                            عدد الطلاب المشمولين: {studentsCount} طالب · عتبة الغياب: {letter.days_threshold} يوم
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedLetter(letter);
                            setHistoryModalOpen(false);
                            setPrintPreviewOpen(true);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold shrink-0"
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
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                معاينة طباعة الكتاب الرسمي رقم ({selectedLetter.document_number})
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>طباعة</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPrintPreviewOpen(false)}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-white text-slate-900 font-sans print:p-0">
              {/* 3-column official header */}
              <div className="grid grid-cols-3 gap-4 text-center text-xs font-bold border-b border-slate-300 pb-4">
                <div>
                  <p>جمهورية العراق</p>
                  <p>وزارة التربية</p>
                  <p>{reportData?.school_settings.directorate_name || 'المديرية العامة للتربية'}</p>
                </div>
                <div>
                  <p className="text-sm font-black mt-2">كتاب رسمي / {selectedLetter.stage_name}</p>
                  <p className="text-[11px] text-slate-600 mt-1">العام الدراسي: {reportData?.academic_year.name}</p>
                </div>
                <div className="text-left">
                  <p>الرقم: {selectedLetter.document_number}</p>
                  <p>التاريخ: {selectedLetter.letter_date}</p>
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs sm:text-sm font-mono whitespace-pre-wrap leading-relaxed">
                {selectedLetter.rendered_content}
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-800 mb-2">قائمة الطلاب المشمولين بالكتاب الرسمي:</h4>
                <table className="w-full text-xs text-right border-collapse border border-slate-300">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700">
                      <th className="border border-slate-300 p-2 text-center w-10">ت</th>
                      <th className="border border-slate-300 p-2">اسم الطالب</th>
                      <th className="border border-slate-300 p-2">الصف والشعبة</th>
                      <th className="border border-slate-300 p-2 text-center">أيام الغياب</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      try {
                        const students = JSON.parse(selectedLetter.students_json || '[]');
                        return students.map((st: any, i: number) => (
                          <tr key={i}>
                            <td className="border border-slate-300 p-2 text-center">{i + 1}</td>
                            <td className="border border-slate-300 p-2 font-bold">{st.full_name}</td>
                            <td className="border border-slate-300 p-2">{st.grade_name} - {st.section_name}</td>
                            <td className="border border-slate-300 p-2 text-center font-bold">{st.counted_absence_days} يوم</td>
                          </tr>
                        ));
                      } catch {
                        return null;
                      }
                    })()}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between items-end pt-12 text-xs font-bold">
                <div className="text-center">
                  <p>مسؤول الإحصاء والغيابات</p>
                  <p className="mt-8">التوقيع: ....................</p>
                </div>
                <div className="text-center">
                  <p>مدير المدرسة</p>
                  <p className="mt-8">التوقيع والختم: ....................</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IssueOfficialLetterSubmitHandler(e: React.FormEvent) {
  // helper form wrapper
}
