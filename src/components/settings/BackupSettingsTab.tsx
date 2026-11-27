import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  DatabaseBackup,
  Download,
  FolderOpen,
  HardDriveDownload,
  History,
  Info,
  Loader2,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNumberDisplay } from '../../contexts/NumberDisplayContext';
import type {
  BackupFrequency,
  BackupOverviewResponse,
  BackupRecordType,
  RestoreBackupResult,
} from '../../types/school';
import { schoolService } from '../../services/schoolService';
import { LtrSpan } from '../common/BidirectionalText';
import { ConfirmDialog } from '../common/ConfirmDialog';

interface BackupSettingsTabProps {
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

const BACKUP_TYPE_LABELS: Record<BackupRecordType, string> = {
  manual: 'يدوية',
  auto: 'تلقائية',
  pre_restore: 'سلامة قبل الاستعادة',
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function BackupSettingsTab({ onRefresh, onNotify }: BackupSettingsTabProps) {
  const { count } = useNumberDisplay();
  const isElectron = schoolService.isElectron();

  const [overview, setOverview] = useState<BackupOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [autoEnabled, setAutoEnabled] = useState(false);
  const [backupOnClose, setBackupOnClose] = useState(true);
  const [frequency, setFrequency] = useState<BackupFrequency>('daily');
  const [retentionCount, setRetentionCount] = useState('10');
  const [backupDir, setBackupDir] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  const [creatingManualDownload, setCreatingManualDownload] = useState(false);
  const [creatingManaged, setCreatingManaged] = useState(false);
  const [runningAutoNow, setRunningAutoNow] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const [selectedRestoreFile, setSelectedRestoreFile] = useState<File | null>(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [lastRestoreResult, setLastRestoreResult] = useState<RestoreBackupResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const data = await schoolService.getBackupOverview();
      setOverview(data);
      setAutoEnabled(data.settings.auto_enabled === 1);
      setBackupOnClose(data.settings.backup_on_close !== 0);
      setFrequency(data.settings.frequency);
      setRetentionCount(String(data.settings.retention_count));
      setBackupDir(data.settings.backup_dir ?? '');
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر تحميل بيانات النسخ الاحتياطي.'
      );
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  async function handleExportManualToLocation() {
    setCreatingManualDownload(true);
    try {
      const res = await schoolService.exportManualBackupToUserChoice();
      if (res.canceled) {
        onNotify('info', 'تم إلغاء حفظ النسخة الاحتياطية.');
        return;
      }
      onNotify(
        'success',
        res.file_path
          ? `تم إنشاء النسخة الاحتياطية والتحقق من سلامتها وحفظها في: ${res.file_path}`
          : `تم إنشاء النسخة الاحتياطية وتنزيلها بنجاح (${res.filename}).`
      );
      await loadOverview();
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر إنشاء النسخة الاحتياطية.'
      );
    } finally {
      setCreatingManualDownload(false);
    }
  }

  async function handleCreateManagedBackup() {
    setCreatingManaged(true);
    try {
      const res = await schoolService.createManagedBackup();
      onNotify(
        'success',
        `تم حفظ النسخة الاحتياطية داخل مجلد النظام بنجاح (${res.record.filename}) وتم التحقق من سلامتها (${res.integrity_status}).`
      );
      await loadOverview();
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر إنشاء النسخة الاحتياطية المدارة.'
      );
    } finally {
      setCreatingManaged(false);
    }
  }

  async function handleSaveAutoSettings(e: FormEvent) {
    e.preventDefault();
    const parsedRetention = Number(retentionCount);
    if (!Number.isInteger(parsedRetention) || parsedRetention < 1 || parsedRetention > 90) {
      onNotify('error', 'عدد النسخ المحتفظ بها يجب أن يكون رقماً صحيحاً بين 1 و 90.');
      return;
    }

    setSavingSettings(true);
    try {
      const updated = await schoolService.updateBackupSettings({
        auto_enabled: autoEnabled,
        backup_on_close: backupOnClose,
        frequency,
        retention_count: parsedRetention,
        backup_dir: backupDir.trim() || null,
      });
      setOverview((prev) => (prev ? { ...prev, settings: updated } : prev));
      onNotify('success', 'تم حفظ إعدادات النسخ الاحتياطي وسياسة الإغلاق بنجاح.');
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر حفظ إعدادات النسخ الاحتياطي.'
      );
    } finally {
      setSavingSettings(false);
    }
  }

  async function handlePickFolder() {
    try {
      const res = await schoolService.pickBackupDirectory(
        backupDir.trim() || overview?.settings.resolved_backup_dir
      );
      if (!res.supported) {
        onNotify('info', 'اختيار المجلد عبر نافذة النظام متاح في نسخة سطح المكتب (Electron)؛ في الويب يمكنك كتابة مسار المجلد مباشرة أو ترك المسار الافتراضي.');
        return;
      }
      if (!res.canceled && res.path) {
        setBackupDir(res.path);
      }
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر فتح نافذة اختيار المجلد.');
    }
  }

  async function handleRunAutoNow() {
    setRunningAutoNow(true);
    try {
      const res = await schoolService.runAutoBackup(true);
      setOverview(res.overview);
      if (res.executed && res.result) {
        onNotify(
          'success',
          `تم تنفيذ النسخة الاحتياطية التلقائية (${res.result.record.filename}) بنجاح.`
        );
      } else {
        onNotify('info', 'لم يتم تنفيذ نسخة إضافية لأن عملية نسخ أخرى قيد التنفيذ حالياً.');
      }
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر تنفيذ النسخ الاحتياطي التلقائي.'
      );
      await loadOverview();
    } finally {
      setRunningAutoNow(false);
    }
  }

  async function handleDownloadRecord(recordId: number, filename: string) {
    setDownloadingId(recordId);
    try {
      await schoolService.downloadBackupRecord(recordId, filename);
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر تنزيل النسخة الاحتياطية.'
      );
    } finally {
      setDownloadingId(null);
    }
  }

  function handleRestoreFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSelectedRestoreFile(file);
  }

  async function handleConfirmRestore() {
    if (!selectedRestoreFile) return;
    setRestoring(true);
    try {
      const result = await schoolService.restoreDatabaseBackup(selectedRestoreFile);
      setLastRestoreResult(result);
      setRestoreConfirmOpen(false);
      setSelectedRestoreFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      await onRefresh();
      await loadOverview();
      onNotify(
        'success',
        `تمت استعادة قاعدة البيانات بنجاح (${count(result.students_count)} طالب، ${count(result.media_assets_count)} ملف وسائط).`
      );
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error
          ? err.message
          : 'فشل استعادة النسخة الاحتياطية. تم الحفاظ على البيانات الحالية دون تغيير.'
      );
      setRestoreConfirmOpen(false);
    } finally {
      setRestoring(false);
    }
  }

  if (loading && !overview) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-36 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse"
          />
        ))}
      </div>
    );
  }

  const records = overview?.records ?? [];
  const settings = overview?.settings;

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Row 1: Manual Backup + Auto Backup Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-start">
        {/* Manual Backup Card */}
        <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2.5">
            <HardDriveDownload className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
              النسخ الاحتياطي اليدوي
            </h3>
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              إنشاء نسخة احتياطية كاملة ومفحوصة من قاعدة بيانات SQLite تضم جميع الطلاب، الغيابات،
              المراحل، العطل، الكتب الرسمية، الإعدادات، وصور الشعار والطلبة.
            </p>

            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-3.5 flex items-start gap-2.5 text-xs text-emerald-900 dark:text-emerald-200 leading-relaxed">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold">فحص السلامة وشمول الوسائط</p>
                <p>
                  {overview?.media_included_note ??
                    'تُحفظ الصور والشعارات داخل قاعدة البيانات نفسها، ويتم التحقق من سلامة النسخة عبر فحص PRAGMA integrity_check قبل اعتمادها.'}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={handleExportManualToLocation}
                disabled={creatingManualDownload}
                className="flex-1 inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-xs transition-colors disabled:opacity-60"
              >
                {creatingManualDownload ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <HardDriveDownload className="w-4 h-4" />
                )}
                <span>إنشاء وحفظ نسخة في مكان تختاره (.db)</span>
              </button>

              <button
                type="button"
                onClick={handleCreateManagedBackup}
                disabled={creatingManaged}
                className="inline-flex items-center justify-center gap-2 min-h-[40px] px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs sm:text-sm font-semibold transition-colors disabled:opacity-60"
              >
                {creatingManaged ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>حفظ بمجلد النظام</span>
              </button>
            </div>
          </div>
        </section>

        {/* Automatic Backup Settings Card */}
        <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <Clock className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                النسخ الاحتياطي التلقائي
              </h3>
            </div>
            <button
              type="button"
              onClick={handleRunAutoNow}
              disabled={runningAutoNow}
              className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-60"
            >
              {runningAutoNow ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              <span>تنفيذ الآن</span>
            </button>
          </div>

          <form onSubmit={handleSaveAutoSettings} className="p-4 sm:p-5 space-y-4">
            <label className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 cursor-pointer">
              <div>
                <span className="block text-sm font-bold text-slate-900 dark:text-slate-100">
                  تفعيل النسخ الاحتياطي التلقائي
                </span>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  إنشاء نسخ احتياطية مجدولة وتنظيف النسخ الأقدم بعد التحقق من سلامة الجديدة.
                </span>
              </div>
              <input
                type="checkbox"
                checked={autoEnabled}
                onChange={(e) => setAutoEnabled(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 shrink-0"
              />
            </label>

            <label className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 cursor-pointer">
              <div>
                <span className="block text-sm font-bold text-slate-900 dark:text-slate-100">
                  إنشاء نسخة احتياطية عند إغلاق البرنامج
                </span>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  التحقق من سلامة البيانات وحفظ نسخة احتياطية آمنة تلقائياً عند الضغط على إغلاق البرنامج.
                </span>
              </div>
              <input
                type="checkbox"
                checked={backupOnClose}
                onChange={(e) => setBackupOnClose(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 shrink-0"
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label
                  htmlFor="backup-frequency-select"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  دورية النسخ التلقائي
                </label>
                <select
                  id="backup-frequency-select"
                  value={frequency}
                  onChange={(e) =>
                    setFrequency(e.target.value === 'weekly' ? 'weekly' : 'daily')
                  }
                  className="w-full min-h-[40px] px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
                >
                  <option value="daily">يومي (كل 24 ساعة)</option>
                  <option value="weekly">أسبوعي (كل 7 أيام)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="backup-retention-input"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  عدد النسخ التلقائية المحتفظ بها
                </label>
                <input
                  id="backup-retention-input"
                  type="number"
                  min={1}
                  max={90}
                  step={1}
                  value={retentionCount}
                  onChange={(e) => setRetentionCount(e.target.value)}
                  className="w-full min-h-[40px] px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="backup-dir-input"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                مسار مجلد حفظ النسخ الاحتياطية (اتركه فارغاً للمسار الافتراضي)
              </label>
              <div className="flex gap-2">
                <input
                  id="backup-dir-input"
                  type="text"
                  dir="ltr"
                  value={backupDir}
                  onChange={(e) => setBackupDir(e.target.value)}
                  placeholder={settings?.resolved_backup_dir ?? ''}
                  className="flex-1 min-h-[40px] px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
                />
                {isElectron && (
                  <button
                    type="button"
                    onClick={handlePickFolder}
                    className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 shrink-0"
                  >
                    <FolderOpen className="w-4 h-4" />
                    <span>استعراض</span>
                  </button>
                )}
              </div>
              {settings?.resolved_backup_dir && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  المجلد الفعلي الحالي:{' '}
                  <LtrSpan className="font-mono text-[11px]">{settings.resolved_backup_dir}</LtrSpan>
                </p>
              )}
            </div>

            {settings?.last_backup_at && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-3 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">آخر عملية نسخ مسجلة:</span>
                  <LtrSpan className="font-semibold text-slate-800 dark:text-slate-200 tabular-nums">
                    {settings.last_backup_at}
                  </LtrSpan>
                </div>
                {settings.last_backup_message && (
                  <p
                    className={
                      settings.last_backup_status === 'error'
                        ? 'text-rose-600 dark:text-rose-400 font-medium'
                        : 'text-emerald-700 dark:text-emerald-400 font-medium'
                    }
                  >
                    {settings.last_backup_message}
                  </p>
                )}
              </div>
            )}

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3 flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
              <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
              <span>
                {overview?.runtime_note ??
                  'يعمل النسخ الاحتياطي التلقائي عند تشغيل البرنامج أو الخادم وبشكل دوري أثناء بقائه مفتوحاً، ولا يعمل عند إغلاق البرنامج بالكامل.'}
              </span>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingSettings}
                className="inline-flex items-center gap-2 min-h-[40px] px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-xs transition-colors disabled:opacity-60"
              >
                {savingSettings ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>حفظ إعدادات النسخ التلقائي</span>
              </button>
            </div>
          </form>
        </section>
      </div>

      {/* Row 2: Guarded Restore Card */}
      <section className="rounded-2xl border border-amber-200/90 dark:border-amber-800/70 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-amber-200 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/20 flex items-center gap-2.5">
          <DatabaseBackup className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
            استعادة نسخة احتياطية (استرجاع قاعدة البيانات)
          </h3>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <div className="rounded-xl border border-amber-300 dark:border-amber-700/70 bg-amber-50/70 dark:bg-amber-950/30 p-3.5 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
            <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold">تنبيه أمان مهم قبل الاستعادة:</p>
              <p>
                ستؤدي الاستعادة إلى استبدال قاعدة البيانات الحالية ببيانات النسخة المحددة. يقوم
                النظام أولاً بفحص سلامة الملف وتوافق جداوله، ثم ينشئ نسخة أمان تلقائية للبيانات
                الحالية قبل الاستبدال. إذا كان الملف تالفاً أو غير متوافق سيتم رفضه فوراً دون أي
                فقدان للبيانات الحالية.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".db,.sqlite,.sqlite3"
              onChange={handleRestoreFileSelect}
              className="flex-1 block w-full text-xs text-slate-600 dark:text-slate-300 file:ml-3 file:py-2 file:px-3.5 file:rounded-xl file:border file:border-slate-200 dark:file:border-slate-700 file:text-xs file:font-semibold file:bg-slate-50 dark:file:bg-slate-800 file:text-slate-700 dark:file:text-slate-200"
            />
            <button
              type="button"
              disabled={!selectedRestoreFile || restoring}
              onClick={() => setRestoreConfirmOpen(true)}
              className="inline-flex items-center justify-center gap-2 min-h-[40px] px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold shadow-xs transition-colors disabled:opacity-50 shrink-0"
            >
              {restoring ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              <span>استعادة النسخة المحددة</span>
            </button>
          </div>

          {lastRestoreResult && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/70 dark:bg-emerald-950/30 p-3.5 flex items-start gap-2.5 text-xs text-emerald-900 dark:text-emerald-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold">تمت الاستعادة وتحديث جميع الواجهات بنجاح</p>
                <p>
                  الطلاب المستعادون: {count(lastRestoreResult.students_count)} · ملفات الوسائط:{' '}
                  {count(lastRestoreResult.media_assets_count)} · حالة الفحص:{' '}
                  <LtrSpan className="font-mono">{lastRestoreResult.integrity_status}</LtrSpan>
                </p>
                {lastRestoreResult.pre_restore_backup_filename && (
                  <p>
                    تم حفظ نسخة أمان تلقائية لبياناتك السابقة باسم:{' '}
                    <LtrSpan className="font-mono">
                      {lastRestoreResult.pre_restore_backup_filename}
                    </LtrSpan>
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Row 3: Managed Backup History */}
      <section className="rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <History className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
              سجل النسخ الاحتياطية المحفوظة ({count(records.length)})
            </h3>
          </div>
          <button
            type="button"
            onClick={() => void loadOverview()}
            disabled={loading}
            className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>تحديث</span>
          </button>
        </div>

        {records.length === 0 ? (
          <div className="p-8 text-center text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            لا توجد نسخ احتياطية محفوظة في سجل النظام حتى الآن.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs sm:text-sm text-right">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-3.5 font-semibold">اسم الملف</th>
                  <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">النوع</th>
                  <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">الحجم</th>
                  <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">السلامة</th>
                  <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">تاريخ الإنشاء</th>
                  <th className="py-2.5 px-3.5 font-semibold text-left whitespace-nowrap">
                    تنزيل
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {records.map((rec) => (
                  <tr
                    key={rec.id}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
                  >
                    <td className="py-2.5 px-3.5 font-medium text-slate-800 dark:text-slate-200">
                      <LtrSpan className="font-mono text-xs">{rec.filename}</LtrSpan>
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap text-slate-600 dark:text-slate-300">
                      {BACKUP_TYPE_LABELS[rec.backup_type] ?? rec.backup_type}
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-300">
                      <LtrSpan>{formatBytes(rec.size_bytes)}</LtrSpan>
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap">
                      {rec.integrity_ok === 1 && rec.file_exists ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold text-xs">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          سليمة ومتوفرة
                        </span>
                      ) : (
                        <span className="text-amber-700 dark:text-amber-400 text-xs font-semibold">
                          الملف غير موجود على القرص
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3.5 whitespace-nowrap tabular-nums text-slate-500 dark:text-slate-400">
                      <LtrSpan>{rec.created_at}</LtrSpan>
                    </td>
                    <td className="py-2.5 px-3.5 text-left whitespace-nowrap">
                      <button
                        type="button"
                        disabled={!rec.file_exists || downloadingId === rec.id}
                        onClick={() => void handleDownloadRecord(rec.id, rec.filename)}
                        className="min-h-[32px] inline-flex items-center gap-1 px-3 py-1 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
                      >
                        {downloadingId === rec.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Download className="w-3.5 h-3.5" />
                        )}
                        <span>تنزيل</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={restoreConfirmOpen}
        title="تأكيد استعادة النسخة الاحتياطية"
        message={`هل أنت متأكد من استبدال قاعدة البيانات الحالية بالملف "${selectedRestoreFile?.name ?? ''}"؟ سيقوم النظام بإنشاء نسخة احتياطية تلقائية لبياناتك الحالية قبل تنفيذ الاستعادة، ولا يمكن التراجع المباشر إلا عبر استعادة نسخة الأمان.`}
        confirmLabel="نعم، استعد النسخة الآن"
        danger
        loading={restoring}
        onConfirm={handleConfirmRestore}
        onCancel={() => setRestoreConfirmOpen(false)}
      />
    </div>
  );
}
