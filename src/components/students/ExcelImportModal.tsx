import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import type {
  ExcelCommitResult,
  ExcelImportRowInput,
  ExcelValidatedRow,
  ExcelValidationResult,
  GradeWithSections,
} from '../../types/school';
import { schoolService } from '../../services/schoolService';

interface ExcelImportModalProps {
  open: boolean;
  grades: GradeWithSections[];
  selectedYearId: number | null;
  onClose: () => void;
  onImported: (message: string) => Promise<void>;
  onError: (message: string) => void;
}

export function ExcelImportModal({
  open,
  grades,
  selectedYearId,
  onClose,
  onImported,
  onError,
}: ExcelImportModalProps) {
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [downloading, setDownloading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const [validationResult, setValidationResult] = useState<ExcelValidationResult | null>(null);
  const [editableRows, setEditableRows] = useState<ExcelValidatedRow[]>([]);
  const [commitResult, setCommitResult] = useState<ExcelCommitResult | null>(null);
  const [dirtySinceValidate, setDirtySinceValidate] = useState(false);

  if (!open) return null;

  function resetState() {
    setStep('upload');
    setValidationResult(null);
    setEditableRows([]);
    setCommitResult(null);
    setShowErrorsOnly(false);
    setDirtySinceValidate(false);
  }

  function handleClose() {
    if (validating || committing) return;
    resetState();
    onClose();
  }

  async function handleDownloadTemplate() {
    setDownloading(true);
    try {
      await schoolService.downloadExcelTemplate(selectedYearId ?? undefined);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'تعذر تنزيل قالب Excel.');
    } finally {
      setDownloading(false);
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      onError('يرجى اختيار ملف Excel بصيغة .xlsx فقط.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result !== 'string') return;
      setValidating(true);
      try {
        const res = await schoolService.uploadAndValidateExcel(
          reader.result,
          selectedYearId ?? undefined
        );
        setValidationResult(res);
        setEditableRows(res.rows);
        setDirtySinceValidate(false);
        setStep('preview');
      } catch (err) {
        onError(err instanceof Error ? err.message : 'تعذر قراءة أو فحص ملف Excel.');
      } finally {
        setValidating(false);
      }
    };
    reader.readAsDataURL(file);
  }

  function updateRowField(
    rowNumber: number,
    field: keyof ExcelImportRowInput,
    value: string
  ) {
    setDirtySinceValidate(true);
    setEditableRows((prev) =>
      prev.map((row) => {
        if (row.rowNumber !== rowNumber) return row;
        if (field === 'grade_name') {
          const matchedGrade = grades.find((g) => g.name === value);
          const firstSec = matchedGrade?.sections[0]?.name ?? '';
          return {
            ...row,
            grade_name: value,
            section_name: matchedGrade ? firstSec : row.section_name,
          };
        }
        return { ...row, [field]: value };
      })
    );
  }

  function removeRow(rowNumber: number) {
    setDirtySinceValidate(true);
    setEditableRows((prev) => prev.filter((r) => r.rowNumber !== rowNumber));
  }

  function toImportInputs(rows: ExcelValidatedRow[]): ExcelImportRowInput[] {
    return rows.map((r) => ({
      rowNumber: r.rowNumber,
      full_name: r.full_name,
      grade_name: r.grade_name,
      section_name: r.section_name,
      registry_number: r.registry_number,
      birth_date: r.birth_date,
      phone: r.phone,
    }));
  }

  async function handleRevalidate() {
    const nonSampleRows = editableRows.filter((r) => !r.is_sample);
    if (nonSampleRows.length === 0) {
      onError('لا توجد صفوف طلاب فعلية للفحص.');
      return;
    }
    setValidating(true);
    try {
      const res = await schoolService.revalidateExcelRows(
        toImportInputs(editableRows),
        selectedYearId ?? undefined
      );
      setValidationResult(res);
      setEditableRows(res.rows);
      setDirtySinceValidate(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'تعذر إعادة فحص البيانات.');
    } finally {
      setValidating(false);
    }
  }

  async function handleCommit() {
    if (dirtySinceValidate) {
      await handleRevalidate();
      return;
    }
    const activeRows = editableRows.filter((r) => !r.is_sample);
    if (activeRows.length === 0) {
      onError('لا توجد صفوف صالحة للاستيراد.');
      return;
    }

    setCommitting(true);
    try {
      const result = await schoolService.commitExcelImport(
        toImportInputs(activeRows),
        selectedYearId ?? undefined
      );
      setCommitResult(result);
      setStep('done');
      await onImported(
        `تم استيراد ${result.imported_count} طالب بنجاح وتوزيعهم على الصفوف والشعب.`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'تعذر حفظ الطلاب المستوردين.');
    } finally {
      setCommitting(false);
    }
  }

  const nonSampleRows = editableRows.filter((r) => !r.is_sample);
  const errorCount = nonSampleRows.filter((r) => !r.is_valid).length;
  const validCount = nonSampleRows.filter((r) => r.is_valid).length;
  const displayedRows = showErrorsOnly
    ? editableRows.filter((r) => !r.is_valid && !r.is_sample)
    : editableRows;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-5xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-lg bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-400">
              <FileSpreadsheet className="w-5 h-5" />
            </span>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                الاستيراد الجماعي للطلاب عبر قالب Excel الموحد
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                تنزيل القالب الموحد لجميع الصفوف والشعب · فحص الأخطاء وتصحيحها قبل الحفظ
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="إغلاق"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {step === 'upload' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Step A: Download Unified Template */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-6 flex flex-col justify-between space-y-5">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                    <span className="w-6 h-6 rounded-md bg-teal-700 text-white text-xs flex items-center justify-center tabular-nums">
                      1
                    </span>
                    <span>تنزيل قالب Excel الموحد</span>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    ينشئ النظام ملف Excel واحداً يضم جميع الصفوف والشعب المعرفة حالياً في مدرستك،
                    مع قوائم منسدلة وصفوف إرشادية توضيحية وورقة تعليمات مرفقة.
                  </p>
                  <ul className="text-xs text-slate-500 dark:text-slate-400 space-y-1.5 list-disc list-inside">
                    <li>الأعمدة الأساسية: اسم الطالب، الصف، الشعبة، رقم القيد.</li>
                    <li>يمكن كتابة طلاب جميع الصفوف والشعب داخل الملف نفسه.</li>
                    <li>رقم القيد اختياري ويمنع تكراره بين الطلاب.</li>
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  disabled={downloading}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-teal-700 dark:border-teal-500 text-teal-800 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/50 text-sm font-semibold transition-colors disabled:opacity-60"
                >
                  <Download className="w-4 h-4" />
                  <span>{downloading ? 'جاري تجهيز القالب...' : 'تنزيل القالب الموحد (.xlsx)'}</span>
                </button>
              </div>

              {/* Step B: Upload Filled File */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-6 flex flex-col justify-between space-y-5">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                    <span className="w-6 h-6 rounded-md bg-slate-800 dark:bg-slate-700 text-white text-xs flex items-center justify-center tabular-nums">
                      2
                    </span>
                    <span>رفع الملف ومعاينة البيانات</span>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    بعد تعبئة بيانات الطلاب في القالب، اختر الملف ليقوم النظام بقراءة جميع الصفوف
                    والتحقق من صحة الأسماء والصفوف والشعب وأرقام القيد قبل الحفظ.
                  </p>
                </div>

                <label className="cursor-pointer rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-teal-600 dark:hover:border-teal-500 bg-slate-50/70 dark:bg-slate-800/40 p-6 text-center transition-colors block">
                  <input
                    type="file"
                    accept=".xlsx"
                    onChange={handleFileChange}
                    disabled={validating}
                    className="hidden"
                  />
                  <Upload className="w-7 h-7 text-teal-700 dark:text-teal-400 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {validating ? 'جاري قراءة وفحص الملف...' : 'اضغط لاختيار ملف Excel (.xlsx)'}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    لن يتم حفظ أي بيانات إلا بعد معاينتها وموافقتك الصريحة
                  </p>
                </label>
              </div>
            </div>
          )}

          {step === 'preview' && validationResult && (
            <div className="space-y-4">
              {/* Summary & Filter Bar */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 px-4 py-3">
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                    السنة المستهدفة: {validationResult.academic_year.name}
                  </span>
                  <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                    صفوف صالحة: {validCount.toLocaleString('ar-IQ')}
                  </span>
                  <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                    ·
                  </span>
                  <span
                    className={`font-semibold tabular-nums ${
                      errorCount > 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    صفوف بها أخطاء: {errorCount.toLocaleString('ar-IQ')}
                  </span>
                  {validationResult.summary.sample_skipped_count > 0 && (
                    <>
                      <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                        صفوف إرشادية مستبعدة تلقائياً:{' '}
                        {validationResult.summary.sample_skipped_count.toLocaleString('ar-IQ')}
                      </span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowErrorsOnly((prev) => !prev)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      showErrorsOnly
                        ? 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {showErrorsOnly ? 'عرض كل الصفوف' : 'عرض الأخطاء فقط'}
                  </button>

                  <button
                    type="button"
                    onClick={handleRevalidate}
                    disabled={validating}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 dark:hover:bg-slate-600 text-white text-xs font-semibold transition-colors disabled:opacity-60"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${validating ? 'animate-spin' : ''}`} />
                    <span>إعادة الفحص</span>
                  </button>
                </div>
              </div>

              {dirtySinceValidate && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between gap-3">
                  <span>
                    تم تعديل بعض القيم في المعاينة. يرجى الضغط على «إعادة الفحص» للتحقق من البيانات
                    المعدلة قبل الحفظ.
                  </span>
                </div>
              )}

              {/* Editable Preview Table */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
                <table className="w-full text-xs text-right">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold w-16">صف Excel</th>
                      <th className="py-2.5 px-3 font-semibold min-w-[200px]">اسم الطالب</th>
                      <th className="py-2.5 px-3 font-semibold min-w-[150px]">الصف</th>
                      <th className="py-2.5 px-3 font-semibold min-w-[110px]">الشعبة</th>
                      <th className="py-2.5 px-3 font-semibold min-w-[120px]">رقم القيد</th>
                      <th className="py-2.5 px-3 font-semibold min-w-[230px]">نتيجة الفحص</th>
                      <th className="py-2.5 px-3 font-semibold w-12 text-center">إزالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {displayedRows.map((row) => {
                      const matchedGrade = grades.find((g) => g.name === row.grade_name);
                      const availableSections = matchedGrade?.sections ?? [];

                      if (row.is_sample) {
                        return (
                          <tr
                            key={row.rowNumber}
                            className="bg-amber-50/50 dark:bg-amber-950/20 text-slate-500 dark:text-slate-400"
                          >
                            <td className="py-2.5 px-3 font-mono-tabular">{row.rowNumber}</td>
                            <td className="py-2.5 px-3" colSpan={5}>
                              {row.full_name} —{' '}
                              <span className="font-semibold">
                                (صف إرشادي توضيحي — لن يتم استيراده)
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => removeRow(row.rowNumber)}
                                aria-label="إزالة الصف"
                                className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      }

                      return (
                        <tr
                          key={row.rowNumber}
                          className={
                            !row.is_valid
                              ? 'bg-red-50/40 dark:bg-red-950/20'
                              : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30'
                          }
                        >
                          <td className="py-2 px-3 font-mono-tabular text-slate-500 dark:text-slate-400">
                            {row.rowNumber}
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={row.full_name}
                              onChange={(e) =>
                                updateRowField(row.rowNumber, 'full_name', e.target.value)
                              }
                              className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-teal-600"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <select
                              value={matchedGrade ? matchedGrade.name : ''}
                              onChange={(e) =>
                                updateRowField(row.rowNumber, 'grade_name', e.target.value)
                              }
                              className="w-full px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-teal-600"
                            >
                              {!matchedGrade && (
                                <option value="">
                                  {row.grade_name ? `غير معرف: ${row.grade_name}` : 'اختر الصف...'}
                                </option>
                              )}
                              {grades.map((g) => (
                                <option key={g.id} value={g.name}>
                                  {g.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 px-3">
                            <select
                              value={
                                availableSections.some((s) => s.name === row.section_name)
                                  ? row.section_name
                                  : ''
                              }
                              onChange={(e) =>
                                updateRowField(row.rowNumber, 'section_name', e.target.value)
                              }
                              disabled={!matchedGrade}
                              className="w-full px-2 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-teal-600 disabled:opacity-50"
                            >
                              {!availableSections.some((s) => s.name === row.section_name) && (
                                <option value="">
                                  {row.section_name ? `غير معرفة: ${row.section_name}` : 'اختر...'}
                                </option>
                              )}
                              {availableSections.map((s) => (
                                <option key={s.id} value={s.name}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={row.registry_number}
                              onChange={(e) =>
                                updateRowField(row.rowNumber, 'registry_number', e.target.value)
                              }
                              placeholder="اختياري"
                              className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono-tabular focus:outline-none focus:ring-1 focus:ring-teal-600"
                            />
                          </td>
                          <td className="py-2 px-3">
                            {row.is_valid ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                <span>بيانات سليمة</span>
                              </span>
                            ) : (
                              <div className="space-y-0.5 text-red-700 dark:text-red-400">
                                {row.errors.map((errMsg, i) => (
                                  <p key={i} className="flex items-start gap-1 leading-snug">
                                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                    <span>{errMsg}</span>
                                  </p>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => removeRow(row.rowNumber)}
                              aria-label="حذف الصف من الدفعة"
                              className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 'done' && commitResult && (
            <div className="py-6 space-y-5 text-center max-w-xl mx-auto">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 mx-auto flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h4 className="text-lg font-bold text-slate-900 dark:text-slate-100 font-display">
                  اكتمل الاستيراد وتوزيع الطلاب بنجاح
                </h4>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 tabular-nums">
                  تم تسجيل{' '}
                  <span className="font-bold text-teal-700 dark:text-teal-400">
                    {commitResult.imported_count.toLocaleString('ar-IQ')}
                  </span>{' '}
                  طالب في السنة الدراسية {commitResult.academic_year_name}
                </p>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden text-right">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">الصف</th>
                      <th className="py-2.5 px-4 font-semibold">الشعبة</th>
                      <th className="py-2.5 px-4 font-semibold text-left">عدد الطلاب المضافين</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {commitResult.distribution.map((dist, idx) => (
                      <tr key={idx}>
                        <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100">
                          {dist.grade_name}
                        </td>
                        <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">
                          شعبة {dist.section_name}
                        </td>
                        <td className="py-2.5 px-4 text-left font-bold text-teal-700 dark:text-teal-400 tabular-nums">
                          {dist.count.toLocaleString('ar-IQ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          {step === 'preview' ? (
            <>
              <button
                type="button"
                onClick={resetState}
                disabled={validating || committing}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                اختيار ملف آخر
              </button>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={validating || committing}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={handleCommit}
                  disabled={
                    validating ||
                    committing ||
                    nonSampleRows.length === 0 ||
                    (!dirtySinceValidate && errorCount > 0)
                  }
                  className="px-5 py-2 text-sm font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 text-white transition-colors disabled:opacity-50"
                >
                  {committing
                    ? 'جاري الحفظ والتوزيع...'
                    : dirtySinceValidate
                      ? 'فحص البيانات المعدلة أولاً'
                      : `اعتماد وحفظ (${validCount.toLocaleString('ar-IQ')} طالب)`}
                </button>
              </div>
            </>
          ) : (
            <div className="w-full flex justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="px-5 py-2 text-sm font-semibold rounded-lg bg-slate-800 dark:bg-slate-700 text-white hover:bg-slate-900 dark:hover:bg-slate-600 transition-colors"
              >
                إغلاق
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
