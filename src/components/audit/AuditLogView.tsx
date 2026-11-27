import {
  ChevronLeft,
  ChevronRight,
  Eye,
  FileSpreadsheet,
  Filter,
  History,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNumberDisplay } from '../../contexts/NumberDisplayContext';
import { schoolService } from '../../services/schoolService';
import type {
  AuditLogListResponse,
  AuditLogRecord,
  AuditOperationType,
  AuditSectionType,
} from '../../types/school';
import { LtrSpan } from '../common/BidirectionalText';

interface AuditLogViewProps {
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

const OPERATION_LABELS: Record<AuditOperationType, string> = {
  create: 'إضافة',
  update: 'تعديل',
  delete: 'حذف',
  transfer: 'نقل طالب',
  import: 'استيراد بيانات',
  issue_letter: 'إصدار كتاب رسمي',
  backup: 'نسخ احتياطي',
  restore: 'استعادة نسخة',
};

const OPERATION_STYLES: Record<AuditOperationType, string> = {
  create: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60',
  update: 'text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800/60',
  delete: 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/60',
  transfer: 'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800/60',
  import: 'text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40 border-violet-200 dark:border-violet-800/60',
  issue_letter: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60',
  backup: 'text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800/60',
  restore: 'text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800/60',
};

const SECTION_LABELS: Record<AuditSectionType, string> = {
  students: 'الطلاب',
  absences: 'الغيابات والسجل الشهري',
  holidays: 'العطل الرسمية والأسبوعية',
  grades: 'الصفوف والشعب',
  stages: 'مراحل الغياب',
  letters: 'الكتب الرسمية',
  settings: 'إعدادات المدرسة',
  backup: 'النسخ الاحتياطي والاستعادة',
};

const PAGE_SIZE = 50;

function formatJsonPretty(raw: string | null): string {
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function AuditLogView({ onNotify }: AuditLogViewProps) {
  const { count } = useNumberDisplay();

  const [data, setData] = useState<AuditLogListResponse>({
    total: 0,
    items: [],
    actors: [],
  });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [search, setSearch] = useState('');
  const [operationType, setOperationType] = useState<AuditOperationType | 'all'>('all');
  const [section, setSection] = useState<AuditSectionType | 'all'>('all');
  const [actorName, setActorName] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(0);

  const [selectedLog, setSelectedLog] = useState<AuditLogRecord | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await schoolService.listAuditLogs({
        search: search.trim() || undefined,
        operation_type: operationType,
        section,
        actor_name: actorName,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setData(result);
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر تحميل سجل العمليات والتعديلات.'
      );
    } finally {
      setLoading(false);
    }
  }, [search, operationType, section, actorName, dateFrom, dateTo, page, onNotify]);

  useEffect(() => {
    const handle = setTimeout(() => {
      void loadLogs();
    }, 180);
    return () => clearTimeout(handle);
  }, [loadLogs]);

  async function handleExportExcel() {
    setExporting(true);
    try {
      await schoolService.exportAuditLogsExcel({
        search: search.trim() || undefined,
        operation_type: operationType,
        section,
        actor_name: actorName,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      onNotify('success', 'تم تصدير سجل العمليات والتعديلات إلى ملف Excel بنجاح.');
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر تصدير سجل العمليات.'
      );
    } finally {
      setExporting(false);
    }
  }

  function handleResetFilters() {
    setSearch('');
    setOperationType('all');
    setSection('all');
    setActorName('all');
    setDateFrom('');
    setDateTo('');
    setPage(0);
  }

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 font-display flex items-center gap-2">
            <History className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0" />
            <span>سجل العمليات والتعديلات</span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-2">
            <span>توثيق زمني دائم لجميع التعديلات والعمليات المنفذة في النظام</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 dark:text-teal-400">
              <Lock className="w-3 h-3" />
              سجل للقراءة فقط (غير قابل للتعديل أو الحذف)
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadLogs()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            disabled={exporting || data.total === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs sm:text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {exporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-4 h-4" />
            )}
            <span>تصدير Excel</span>
          </button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
            <Filter className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
            <span>البحث والتصفية</span>
          </span>
          <button
            type="button"
            onClick={handleResetFilters}
            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-teal-700 dark:hover:text-teal-400"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>إعادة ضبط الفلاتر</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
          <div className="lg:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="بحث في الوصف أو العنصر المستهدف..."
              className="w-full pr-9 pl-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
            />
          </div>

          <select
            aria-label="تصفية حسب نوع العملية"
            value={operationType}
            onChange={(e) => {
              setOperationType(e.target.value as AuditOperationType | 'all');
              setPage(0);
            }}
            className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
          >
            <option value="all">كل أنواع العمليات</option>
            {(Object.keys(OPERATION_LABELS) as AuditOperationType[]).map((op) => (
              <option key={op} value={op}>
                {OPERATION_LABELS[op]}
              </option>
            ))}
          </select>

          <select
            aria-label="تصفية حسب القسم"
            value={section}
            onChange={(e) => {
              setSection(e.target.value as AuditSectionType | 'all');
              setPage(0);
            }}
            className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
          >
            <option value="all">كل الأقسام</option>
            {(Object.keys(SECTION_LABELS) as AuditSectionType[]).map((sec) => (
              <option key={sec} value={sec}>
                {SECTION_LABELS[sec]}
              </option>
            ))}
          </select>

          <input
            type="date"
            aria-label="من تاريخ"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(0);
            }}
            className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
          />

          <input
            type="date"
            aria-label="إلى تاريخ"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(0);
            }}
            className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
          />
        </div>

        {data.actors.length > 1 && (
          <div className="flex items-center gap-2 pt-1">
            <label
              htmlFor="audit-actor-select"
              className="text-xs font-semibold text-slate-600 dark:text-slate-300"
            >
              المنفذ:
            </label>
            <select
              id="audit-actor-select"
              value={actorName}
              onChange={(e) => {
                setActorName(e.target.value);
                setPage(0);
              }}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            >
              <option value="all">جميع المنفذين</option>
              {data.actors.map((act) => (
                <option key={act} value={act}>
                  {act}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      {/* Audit Log Table */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>
            إجمالي السجلات المطابقة:{' '}
            <strong className="text-slate-900 dark:text-slate-100 tabular-nums">
              {count(data.total)}
            </strong>
          </span>
          <span className="tabular-nums">
            الصفحة {count(page + 1)} من {count(totalPages)}
          </span>
        </div>

        {loading && data.items.length === 0 ? (
          <div className="p-6 space-y-2.5">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-11 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse"
              />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <div className="p-10 text-center">
            <History className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              لا توجد عمليات مسجلة مطابقة لخيارات البحث
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              يتم توثيق كل عملية إضافة أو تعديل أو حذف أو نسخ احتياطي تلقائياً هنا.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm text-right">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">#</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">التاريخ والوقت</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">العملية</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">القسم</th>
                  <th className="py-2.5 px-3 font-semibold whitespace-nowrap">المنفذ</th>
                  <th className="py-2.5 px-3 font-semibold min-w-[240px]">تفاصيل العملية</th>
                  <th className="py-2.5 px-3 font-semibold text-left whitespace-nowrap">
                    المقارنة
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.items.map((item) => {
                  const hasDiff = Boolean(item.old_value_json || item.new_value_json);
                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
                    >
                      <td className="py-2.5 px-3 tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {count(item.id)}
                      </td>
                      <td className="py-2.5 px-3 tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        <LtrSpan className="text-xs">{item.created_at}</LtrSpan>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-bold ${
                            OPERATION_STYLES[item.operation_type] ?? ''
                          }`}
                        >
                          {OPERATION_LABELS[item.operation_type] ?? item.operation_type}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap font-medium text-slate-700 dark:text-slate-200">
                        {SECTION_LABELS[item.section] ?? item.section}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 dark:text-slate-300">
                        {item.actor_name}
                      </td>
                      <td className="py-2.5 px-3">
                        <p className="font-medium text-slate-900 dark:text-slate-100 leading-relaxed">
                          {item.description}
                        </p>
                        {(item.target_label || item.target_id) && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            العنصر: {item.target_label || item.target_id}
                          </p>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-left whitespace-nowrap">
                        <button
                          type="button"
                          disabled={!hasDiff}
                          onClick={() => setSelectedLog(item)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>{hasDiff ? 'التفاصيل' : '—'}</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data.total > PAGE_SIZE && (
          <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
              <span>السابق</span>
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              عرض {count(page * PAGE_SIZE + 1)} -{' '}
              {count(Math.min(data.total, (page + 1) * PAGE_SIZE))} من أصل {count(data.total)}
            </span>
            <button
              type="button"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
            >
              <span>التالي</span>
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        )}
      </section>

      {/* Old vs New Values Inspection Modal */}
      {selectedLog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="audit-detail-title"
        >
          <div className="w-full max-w-3xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div>
                <h3
                  id="audit-detail-title"
                  className="text-base font-bold text-slate-900 dark:text-slate-100 font-display"
                >
                  تفاصيل العملية رقم #{count(selectedLog.id)}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {selectedLog.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                aria-label="إغلاق"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-3">
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block">نوع العملية</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {OPERATION_LABELS[selectedLog.operation_type] ?? selectedLog.operation_type}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block">القسم</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {SECTION_LABELS[selectedLog.section] ?? selectedLog.section}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block">المنفذ</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {selectedLog.actor_name}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block">الوقت</span>
                  <LtrSpan className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                    {selectedLog.created_at}
                  </LtrSpan>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-rose-200 dark:border-rose-800/60 bg-rose-50/40 dark:bg-rose-950/20 overflow-hidden">
                  <div className="px-3.5 py-2 border-b border-rose-200 dark:border-rose-800/60 text-xs font-bold text-rose-800 dark:text-rose-300">
                    القيم القديمة (قبل التعديل)
                  </div>
                  <pre
                    dir="ltr"
                    className="p-3.5 text-[11px] leading-relaxed text-slate-800 dark:text-slate-200 overflow-x-auto max-h-72 font-mono whitespace-pre-wrap break-words"
                  >
                    {selectedLog.old_value_json
                      ? formatJsonPretty(selectedLog.old_value_json)
                      : 'لا توجد قيم سابقة (عملية إنشاء جديدة)'}
                  </pre>
                </div>

                <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/40 dark:bg-emerald-950/20 overflow-hidden">
                  <div className="px-3.5 py-2 border-b border-emerald-200 dark:border-emerald-800/60 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                    القيم الجديدة (بعد العملية)
                  </div>
                  <pre
                    dir="ltr"
                    className="p-3.5 text-[11px] leading-relaxed text-slate-800 dark:text-slate-200 overflow-x-auto max-h-72 font-mono whitespace-pre-wrap break-words"
                  >
                    {selectedLog.new_value_json
                      ? formatJsonPretty(selectedLog.new_value_json)
                      : 'لا توجد قيم جديدة (عملية حذف)'}
                  </pre>
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-xs font-semibold hover:bg-slate-800 dark:hover:bg-slate-600"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
