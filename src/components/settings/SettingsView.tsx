import { Building2, CalendarCheck2, Check, Plus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { AcademicYear, SchoolSettings } from '../../types/school';
import { schoolService } from '../../services/schoolService';

interface SettingsViewProps {
  settings: SchoolSettings | null;
  academicYears: AcademicYear[];
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

export function SettingsView({
  settings,
  academicYears,
  onRefresh,
  onNotify,
}: SettingsViewProps) {
  const [schoolName, setSchoolName] = useState(settings?.school_name ?? '');
  const [directorateName, setDirectorateName] = useState(settings?.directorate_name ?? '');
  const [savingSettings, setSavingSettings] = useState(false);

  const [newYearName, setNewYearName] = useState('');
  const [setNewYearActive, setSetNewYearActive] = useState(true);
  const [creatingYear, setCreatingYear] = useState(false);

  useEffect(() => {
    if (settings) {
      setSchoolName(settings.school_name);
      setDirectorateName(settings.directorate_name);
    }
  }, [settings]);

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await schoolService.updateSettings({
        school_name: schoolName,
        directorate_name: directorateName,
      });
      onNotify('success', 'تم حفظ بيانات المدرسة بنجاح.');
      await onRefresh();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر حفظ الإعدادات.');
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleCreateYear(e: FormEvent) {
    e.preventDefault();
    if (!newYearName.trim()) {
      onNotify('error', 'يرجى إدخال اسم السنة الدراسية.');
      return;
    }
    setCreatingYear(true);
    try {
      await schoolService.createAcademicYear({
        name: newYearName.trim(),
        set_active: setNewYearActive,
      });
      onNotify('success', `تمت إضافة السنة الدراسية "${newYearName.trim()}" بنجاح.`);
      setNewYearName('');
      await onRefresh();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر إضافة السنة الدراسية.');
    } finally {
      setCreatingYear(false);
    }
  }

  async function handleActivateYear(yearId: number) {
    try {
      const yr = await schoolService.activateAcademicYear(yearId);
      onNotify('success', `تم تعيين السنة الدراسية "${yr.name}" كسنة فعالة افتراضية.`);
      await onRefresh();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر تفعيل السنة الدراسية.');
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 font-display">
          إعدادات المدرسة والسنوات الدراسية
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          ضبط المعلومات الرسمية للمدرسة وإدارة السنوات الدراسية لفصل سجلات كل عام بدقة
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* School Info Form */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2.5">
            <Building2 className="w-4 h-4 text-teal-700 dark:text-teal-400" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
              بيانات المؤسسة التربوية
            </h3>
          </div>
          <form onSubmit={handleSaveSettings} className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                اسم المدرسة <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                المديرية العامة للتربية <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={directorateName}
                onChange={(e) => setDirectorateName(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
              />
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={savingSettings}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white transition-colors disabled:opacity-60"
              >
                {savingSettings ? 'جاري الحفظ...' : 'حفظ بيانات المدرسة'}
              </button>
            </div>
          </form>
        </section>

        {/* Academic Years Management */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2.5">
            <CalendarCheck2 className="w-4 h-4 text-teal-700 dark:text-teal-400" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
              السنوات الدراسية
            </h3>
          </div>

          <div className="p-5 space-y-5">
            <form onSubmit={handleCreateYear} className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newYearName}
                  onChange={(e) => setNewYearName(e.target.value)}
                  placeholder="مثال: 2027-2028"
                  className="flex-1 px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                />
                <button
                  type="submit"
                  disabled={creatingYear}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة سنة</span>
                </button>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={setNewYearActive}
                  onChange={(e) => setSetNewYearActive(e.target.checked)}
                  className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                <span>تعيينها كسنة دراسية فعالة مباشرة بعد الإضافة</span>
              </label>
            </form>

            <div className="border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
              {academicYears.map((yr) => (
                <div
                  key={yr.id}
                  className="px-4 py-3 flex items-center justify-between gap-3 text-sm"
                >
                  <div>
                    <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                      {yr.name}
                    </span>
                    {yr.is_active === 1 && (
                      <span className="mr-2 text-xs font-semibold text-teal-700 dark:text-teal-400">
                        · السنة الفعالة حالياً
                      </span>
                    )}
                  </div>
                  {yr.is_active !== 1 ? (
                    <button
                      type="button"
                      onClick={() => handleActivateYear(yr.id)}
                      className="px-3 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      تفعيل
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-teal-700 dark:text-teal-400 font-medium">
                      <Check className="w-3.5 h-3.5" />
                      <span>نشطة</span>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
