import {
  AlertTriangle,
  Building2,
  CalendarCheck2,
  CalendarDays,
  CalendarOff,
  Check,
  Clock,
  FileCheck2,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  Scale,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import type {
  AcademicYear,
  ExistingRecordsWarning,
  GradeWithSections,
  HolidayRecord,
  HolidayType,
  SchoolSettings,
  WeeklyHolidayDay,
} from '../../types/school';
import { schoolService } from '../../services/schoolService';
import {
  ACCEPTED_IMAGE_INPUT,
  describeMediaProcessingResult,
  processAndUploadImageFile,
} from '../../utils/imageUpload';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { LegalRegulationsView } from './LegalRegulationsView';

export type SettingsTabId = 'general' | 'holidays' | 'legal';

interface SettingsViewProps {
  settings: SchoolSettings | null;
  academicYears: AcademicYear[];
  grades?: GradeWithSections[];
  selectedYearId?: number | null;
  initialTab?: SettingsTabId;
  onRefresh: () => Promise<void>;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

const DEFAULT_WEEKLY_DAYS: Array<{ day_of_week: number; day_name: string; default_holiday: boolean }> = [
  { day_of_week: 0, day_name: 'الأحد', default_holiday: false },
  { day_of_week: 1, day_name: 'الاثنين', default_holiday: false },
  { day_of_week: 2, day_name: 'الثلاثاء', default_holiday: false },
  { day_of_week: 3, day_name: 'الأربعاء', default_holiday: false },
  { day_of_week: 4, day_name: 'الخميس', default_holiday: false },
  { day_of_week: 5, day_name: 'الجمعة', default_holiday: true },
  { day_of_week: 6, day_name: 'السبت', default_holiday: true },
];

const HOLIDAY_TYPE_LABELS: Record<HolidayType, string> = {
  official: 'عطلة رسمية',
  exceptional: 'عطلة استثنائية',
  school_specific: 'عطلة خاصة بالمدرسة',
};

const HOLIDAY_TYPE_TEXT_CLASSES: Record<HolidayType, string> = {
  official: 'text-teal-700 dark:text-teal-400',
  exceptional: 'text-amber-700 dark:text-amber-400',
  school_specific: 'text-sky-700 dark:text-sky-400',
};

export function SettingsView({
  settings,
  academicYears,
  grades = [],
  selectedYearId = null,
  initialTab = 'general',
  onRefresh,
  onNotify,
}: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);
  const [schoolName, setSchoolName] = useState(settings?.school_name ?? '');
  const [directorateName, setDirectorateName] = useState(settings?.directorate_name ?? '');
  const [schoolLogoData, setSchoolLogoData] = useState<string | null>(
    settings?.school_logo_data ?? null
  );
  const [schoolLogoAssetId, setSchoolLogoAssetId] = useState<number | null>(
    settings?.school_logo_asset_id ?? null
  );
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoStatusText, setLogoStatusText] = useState<string | null>(null);
  const [lessonsPerDay, setLessonsPerDay] = useState(
    String(settings?.lessons_per_absence_day ?? 5)
  );
  const [dailyLessonsCount, setDailyLessonsCount] = useState(
    String(settings?.daily_lessons_count ?? 7)
  );
  const [dailyPermCountsAsAbsence, setDailyPermCountsAsAbsence] = useState<0 | 1>(
    settings?.daily_permission_counts_as_absence ? 1 : 0
  );
  const [lessonPermCountsAsAbsence, setLessonPermCountsAsAbsence] = useState<0 | 1>(
    settings?.lesson_permission_counts_as_absence ? 1 : 0
  );
  const [savingSettings, setSavingSettings] = useState(false);

  const [newYearName, setNewYearName] = useState('');
  const [setNewYearActive, setSetNewYearActive] = useState(true);
  const [creatingYear, setCreatingYear] = useState(false);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Weekly Holidays State
  const [weeklyDaysList, setWeeklyDaysList] = useState<WeeklyHolidayDay[]>(() =>
    DEFAULT_WEEKLY_DAYS.map((d) => ({
      day_of_week: d.day_of_week,
      day_name: d.day_name,
      is_holiday: d.default_holiday ? 1 : 0,
      updated_at: '',
    }))
  );
  const [selectedWeeklyHolidayDays, setSelectedWeeklyHolidayDays] = useState<number[]>([5, 6]);
  const [weeklyHolidayReason, setWeeklyHolidayReason] = useState('عطلة أسبوعية رسمية');
  const [loadingHolidays, setLoadingHolidays] = useState(true);
  const [savingWeeklyHolidays, setSavingWeeklyHolidays] = useState(false);
  const [weeklyWarning, setWeeklyWarning] = useState<ExistingRecordsWarning | null>(null);

  // Official & Exceptional Holidays State
  const [holidays, setHolidays] = useState<HolidayRecord[]>([]);
  const [editingHolidayId, setEditingHolidayId] = useState<number | null>(null);
  const [holidayName, setHolidayName] = useState('');
  const [holidayStartDate, setHolidayStartDate] = useState('');
  const [holidayEndDate, setHolidayEndDate] = useState('');
  const [holidayType, setHolidayType] = useState<HolidayType>('official');
  const [holidayNotes, setHolidayNotes] = useState('');
  const [savingHoliday, setSavingHoliday] = useState(false);
  const [holidayWarning, setHolidayWarning] = useState<ExistingRecordsWarning | null>(null);

  const [deleteHolidayTarget, setDeleteHolidayTarget] = useState<HolidayRecord | null>(null);
  const [deletingHoliday, setDeletingHoliday] = useState(false);

  useEffect(() => {
    if (settings) {
      setSchoolName(settings.school_name);
      setDirectorateName(settings.directorate_name);
      setSchoolLogoData(settings.school_logo_data ?? null);
      setSchoolLogoAssetId(settings.school_logo_asset_id ?? null);
      setLessonsPerDay(String(settings.lessons_per_absence_day ?? 5));
      setDailyLessonsCount(String(settings.daily_lessons_count ?? 7));
      setDailyPermCountsAsAbsence(settings.daily_permission_counts_as_absence ? 1 : 0);
      setLessonPermCountsAsAbsence(settings.lesson_permission_counts_as_absence ? 1 : 0);
    }
  }, [settings]);

  async function handleLogoFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploadingLogo(true);
    setLogoStatusText('جاري فحص ومعالجة الشعار تلقائياً...');
    try {
      const asset = await processAndUploadImageFile(file, 'school_logo');
      setSchoolLogoData(asset.optimized_url);
      setSchoolLogoAssetId(asset.id);
      setLogoStatusText(describeMediaProcessingResult(asset));
    } catch (err) {
      setLogoStatusText(null);
      onNotify('error', err instanceof Error ? err.message : 'تعذر معالجة صورة الشعار.');
    } finally {
      setUploadingLogo(false);
    }
  }

  const loadHolidaysData = useCallback(async () => {
    setLoadingHolidays(true);
    try {
      const [weeklyData, holidaysList] = await Promise.all([
        schoolService.getWeeklyHolidays(),
        schoolService.listHolidays(),
      ]);
      setWeeklyDaysList(weeklyData.days);
      setSelectedWeeklyHolidayDays(
        weeklyData.days.filter((d) => d.is_holiday === 1).map((d) => d.day_of_week)
      );
      setWeeklyHolidayReason(weeklyData.reason || 'عطلة أسبوعية رسمية');
      setHolidays(holidaysList);
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'تعذر تحميل بيانات العطل الأسبوعية والرسمية.'
      );
    } finally {
      setLoadingHolidays(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void loadHolidaysData();
  }, [loadHolidaysData]);

  const weeklySummary = useMemo(() => {
    const selectedSet = new Set(selectedWeeklyHolidayDays);
    const ordered = weeklyDaysList.length > 0 ? weeklyDaysList : DEFAULT_WEEKLY_DAYS;
    const holidayNames = ordered
      .filter((d) => selectedSet.has(d.day_of_week))
      .map((d) => d.day_name);
    const workNames = ordered
      .filter((d) => !selectedSet.has(d.day_of_week))
      .map((d) => d.day_name);
    return { holidayNames, workNames };
  }, [selectedWeeklyHolidayDays, weeklyDaysList]);

  async function persistAllSettings(successMessage: string) {
    const parsedThreshold = Number(lessonsPerDay);
    if (!Number.isInteger(parsedThreshold) || parsedThreshold < 1 || parsedThreshold > 20) {
      onNotify('error', 'يجب أن يكون حد الدروس رقماً صحيحاً بين 1 و 20.');
      return;
    }

    const parsedDailyLessons = Number(dailyLessonsCount);
    if (!Number.isInteger(parsedDailyLessons) || parsedDailyLessons < 1 || parsedDailyLessons > 12) {
      onNotify('error', 'يجب أن يكون عدد الدروس اليومية رقماً صحيحاً بين 1 و 12.');
      return;
    }

    if (uploadingLogo) {
      onNotify('info', 'يرجى الانتظار حتى تكتمل معالجة الشعار.');
      return;
    }

    setSavingSettings(true);
    try {
      await schoolService.updateSettings({
        school_name: schoolName,
        directorate_name: directorateName,
        lessons_per_absence_day: parsedThreshold,
        daily_lessons_count: parsedDailyLessons,
        daily_permission_counts_as_absence: dailyPermCountsAsAbsence,
        lesson_permission_counts_as_absence: lessonPermCountsAsAbsence,
        school_logo_data: schoolLogoData,
        school_logo_asset_id: schoolLogoAssetId,
      });
      onNotify('success', successMessage);
      await onRefresh();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر حفظ الإعدادات.');
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleSaveGeneralSettings(e: FormEvent) {
    e.preventDefault();
    await persistAllSettings('تم حفظ إعدادات المدرسة وقواعد الدروس بنجاح.');
  }

  async function handleSaveLeavesSettings(e: FormEvent) {
    e.preventDefault();
    await persistAllSettings('تم حفظ إعدادات الإجازات والرخص بنجاح.');
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

  function handleToggleWeeklyDay(dayOfWeek: number) {
    setSelectedWeeklyHolidayDays((prev) => {
      if (prev.includes(dayOfWeek)) {
        return prev.filter((d) => d !== dayOfWeek);
      }
      if (prev.length >= 6) {
        onNotify('error', 'لا يمكن تحديد جميع أيام الأسبوع السبعة كعطلة أسبوعية.');
        return prev;
      }
      return [...prev, dayOfWeek].sort((a, b) => a - b);
    });
  }

  async function handleSaveWeeklyHolidays(e: FormEvent) {
    e.preventDefault();
    if (selectedWeeklyHolidayDays.length === 7) {
      onNotify('error', 'لا يمكن تحديد جميع أيام الأسبوع السبعة كعطلة رسمية.');
      return;
    }
    setSavingWeeklyHolidays(true);
    try {
      const res = await schoolService.updateWeeklyHolidays({
        holiday_days: selectedWeeklyHolidayDays,
        reason: weeklyHolidayReason.trim() || 'عطلة أسبوعية رسمية',
      });
      setWeeklyDaysList(res.settings.days);
      setSelectedWeeklyHolidayDays(
        res.settings.days.filter((d) => d.is_holiday === 1).map((d) => d.day_of_week)
      );
      setWeeklyHolidayReason(res.settings.reason);
      setWeeklyWarning(res.existing_records_warning);
      onNotify('success', 'تم حفظ إعدادات العطل الأسبوعية في قاعدة البيانات بنجاح.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر حفظ إعدادات العطل الأسبوعية.');
    } finally {
      setSavingWeeklyHolidays(false);
    }
  }

  function handleHolidayStartDateChange(nextStart: string) {
    setHolidayStartDate(nextStart);
    if (nextStart && (!holidayEndDate || holidayEndDate < nextStart)) {
      setHolidayEndDate(nextStart);
    }
  }

  function resetHolidayForm() {
    setEditingHolidayId(null);
    setHolidayName('');
    setHolidayStartDate('');
    setHolidayEndDate('');
    setHolidayType('official');
    setHolidayNotes('');
  }

  function handleStartEditHoliday(record: HolidayRecord) {
    setEditingHolidayId(record.id);
    setHolidayName(record.name);
    setHolidayStartDate(record.start_date);
    setHolidayEndDate(record.end_date);
    setHolidayType(record.holiday_type);
    setHolidayNotes(record.notes ?? '');
    setHolidayWarning(null);
  }

  async function handleSaveHoliday(e: FormEvent) {
    e.preventDefault();
    const trimmedName = holidayName.trim();
    if (!trimmedName) {
      onNotify('error', 'يرجى إدخال اسم العطلة أو سببها.');
      return;
    }
    if (!holidayStartDate) {
      onNotify('error', 'يرجى تحديد تاريخ بداية العطلة.');
      return;
    }
    const effectiveEndDate = holidayEndDate || holidayStartDate;
    if (effectiveEndDate < holidayStartDate) {
      onNotify('error', 'تاريخ نهاية العطلة يجب أن يكون مساوياً لتاريخ البداية أو بعده.');
      return;
    }

    setSavingHoliday(true);
    try {
      const payload = {
        academic_year_id: settings?.academic_year_id ?? null,
        name: trimmedName,
        start_date: holidayStartDate,
        end_date: effectiveEndDate,
        holiday_type: holidayType,
        notes: holidayNotes.trim() || null,
      };

      const res = editingHolidayId
        ? await schoolService.updateHoliday(editingHolidayId, payload)
        : await schoolService.createHoliday(payload);

      setHolidayWarning(res.existing_records_warning);
      onNotify(
        'success',
        editingHolidayId
          ? `تم تحديث العطلة "${res.holiday.name}" بنجاح.`
          : `تمت إضافة العطلة "${res.holiday.name}" بنجاح.`
      );
      resetHolidayForm();
      await loadHolidaysData();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر حفظ العطلة.');
    } finally {
      setSavingHoliday(false);
    }
  }

  async function handleConfirmDeleteHoliday() {
    if (!deleteHolidayTarget) return;
    setDeletingHoliday(true);
    try {
      await schoolService.deleteHoliday(deleteHolidayTarget.id);
      onNotify('success', `تم حذف العطلة "${deleteHolidayTarget.name}" بنجاح.`);
      if (editingHolidayId === deleteHolidayTarget.id) {
        resetHolidayForm();
      }
      setDeleteHolidayTarget(null);
      await loadHolidaysData();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر حذف العطلة.');
      setDeleteHolidayTarget(null);
    } finally {
      setDeletingHoliday(false);
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6 max-w-5xl">
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 font-display">
          إعدادات المدرسة وحدود الغياب والإنذارات
        </h2>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
          ضبط المعلومات الرسمية للمدرسة وقواعد احتساب الغياب والعطل الأسبوعية والرسمية وحد الغياب
          المؤثر وعتبات التحذير والإنذارات
        </p>
      </div>

      {/* Settings Sub-Tabs Navigation */}
      <div
        role="tablist"
        aria-label="أقسام الإعدادات"
        className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800 pb-3"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'general'}
          onClick={() => setActiveTab('general')}
          className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
            activeTab === 'general'
              ? 'bg-teal-700 text-white'
              : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>الإعدادات العامة والسنوات والإجازات</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'holidays'}
          onClick={() => setActiveTab('holidays')}
          className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
            activeTab === 'holidays'
              ? 'bg-teal-700 text-white'
              : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <CalendarOff className="w-4 h-4" />
          <span>العطل الأسبوعية والرسمية</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'legal'}
          onClick={() => setActiveTab('legal')}
          className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
            activeTab === 'legal'
              ? 'bg-teal-700 text-white'
              : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          <Scale className="w-4 h-4" />
          <span>حدود الغياب والإنذارات</span>
        </button>
      </div>

      {activeTab === 'legal' && (
        <LegalRegulationsView
          grades={grades}
          academicYears={academicYears}
          selectedYearId={selectedYearId}
          onRefresh={onRefresh}
          onNotify={onNotify}
        />
      )}

      {activeTab === 'general' && (
      <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-start">
        {/* School Info & Lesson Threshold Form */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2.5">
            <Building2 className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
              بيانات المؤسسة وقواعد الغياب
            </h3>
          </div>
          <form onSubmit={handleSaveGeneralSettings} className="p-4 sm:p-5 space-y-4">
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

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                شعار المدرسة الرسمي (يظهر في الكتب والتقارير الرسمية)
              </label>
              <div className="flex items-center gap-3">
                {schoolLogoData ? (
                  <div className="relative w-14 h-14 rounded-lg border border-slate-200 dark:border-slate-700 bg-white p-1 shrink-0">
                    <img
                      src={schoolLogoData}
                      alt="شعار المدرسة"
                      className="w-full h-full object-contain"
                    />
                    <button
                      type="button"
                      disabled={uploadingLogo}
                      onClick={() => {
                        setSchoolLogoData(null);
                        setSchoolLogoAssetId(null);
                        setLogoStatusText(null);
                      }}
                      title="إزالة الشعار"
                      className="absolute -top-2 -left-2 w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center shadow disabled:opacity-50"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="w-14 h-14 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center text-slate-400 shrink-0">
                    {uploadingLogo ? (
                      <Loader2 className="w-5 h-5 animate-spin text-teal-700 dark:text-teal-400" />
                    ) : (
                      <ImagePlus className="w-5 h-5" />
                    )}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <input
                    type="file"
                    accept={ACCEPTED_IMAGE_INPUT}
                    disabled={uploadingLogo}
                    onChange={handleLogoFileChange}
                    className="block w-full text-xs text-slate-600 dark:text-slate-300 file:ml-2 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-slate-200 dark:file:border-slate-700 file:text-xs file:font-semibold file:bg-slate-50 dark:file:bg-slate-800 file:text-slate-700 dark:file:text-slate-200 disabled:opacity-60"
                  />
                  {logoStatusText ? (
                    <p className="text-[11px] text-teal-700 dark:text-teal-400 mt-1">
                      {logoStatusText}
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      يدعم PNG الشفاف وJPG وWebP وSVG بأي دقة، مع المعالجة الذكية وحفظ الأصل.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-4">
              <div>
                <label
                  htmlFor="lessons-per-day-input"
                  className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  <Clock className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
                  <span>عدد دروس الغياب التي تعادل يوماً كاملاً</span>
                  <span className="text-red-500">*</span>
                </label>
                <input
                  id="lessons-per-day-input"
                  type="number"
                  required
                  min={1}
                  max={20}
                  step={1}
                  value={lessonsPerDay}
                  onChange={(e) => setLessonsPerDay(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                  الحد الافتراضي هو 5 دروس. عند تغيير هذا الرقم يُطبق على عمليات الاحتساب المستقبلية
                  فقط، دون إعادة حساب السجلات التاريخية المحفوظة مسبقاً.
                </p>
              </div>

              <div>
                <label
                  htmlFor="daily-lessons-count-input"
                  className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  <Clock className="w-3.5 h-3.5 text-sky-700 dark:text-sky-400 shrink-0" />
                  <span>عدد الدروس اليومية في الجدول المدرسي</span>
                  <span className="text-red-500">*</span>
                </label>
                <input
                  id="daily-lessons-count-input"
                  type="number"
                  required
                  min={1}
                  max={12}
                  step={1}
                  value={dailyLessonsCount}
                  onChange={(e) => setDailyLessonsCount(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                  يحدد عدد الدروس المتاحة للاختيار عند تسجيل «رخصة عن درس معين» (مثلاً 7 دروس: من
                  الدرس الأول إلى الدرس السابع).
                </p>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={savingSettings}
                className="w-full sm:w-auto px-4 py-2 text-sm font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white transition-colors disabled:opacity-60"
              >
                {savingSettings ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
              </button>
            </div>
          </form>
        </section>

        {/* Academic Years Management */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2.5">
            <CalendarCheck2 className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
              السنوات الدراسية
            </h3>
          </div>

          <div className="p-4 sm:p-5 space-y-5">
            <form onSubmit={handleCreateYear} className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <input
                  type="text"
                  value={newYearName}
                  onChange={(e) => setNewYearName(e.target.value)}
                  placeholder="مثال: 2027-2028"
                  className="w-full min-w-0 sm:flex-1 px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                />
                <button
                  type="submit"
                  disabled={creatingYear}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 text-white text-sm font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة سنة</span>
                </button>
              </div>
              <label className="inline-flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer leading-relaxed">
                <input
                  type="checkbox"
                  checked={setNewYearActive}
                  onChange={(e) => setSetNewYearActive(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-teal-700 focus:ring-teal-600 shrink-0"
                />
                <span>تعيينها كسنة دراسية فعالة مباشرة بعد الإضافة</span>
              </label>
            </form>

            <div className="border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
              {academicYears.map((yr) => (
                <div
                  key={yr.id}
                  className="px-3.5 sm:px-4 py-3 flex flex-wrap items-center justify-between gap-2.5 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
                    <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                      {yr.name}
                    </span>
                    {yr.is_active === 1 && (
                      <span className="text-xs font-semibold text-teal-700 dark:text-teal-400">
                        · السنة الفعالة حالياً
                      </span>
                    )}
                  </div>
                  {yr.is_active !== 1 ? (
                    <button
                      type="button"
                      onClick={() => handleActivateYear(yr.id)}
                      className="px-3 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                    >
                      تفعيل
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-teal-700 dark:text-teal-400 font-medium shrink-0">
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

      {/* Leaves & Permissions Settings Section */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2.5">
          <FileCheck2 className="w-4 h-4 text-sky-700 dark:text-sky-400 shrink-0" />
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
            إعدادات الإجازات والرخص
          </h3>
        </div>

        <form onSubmit={handleSaveLeavesSettings} className="p-4 sm:p-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
            {/* Daily Permission Setting */}
            <fieldset className="space-y-2.5">
              <legend className="text-sm font-bold text-slate-900 dark:text-slate-100">
                إعداد الرخصة اليومية
              </legend>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                هل تُحتسب الرخصة اليومية غياباً؟
              </p>

              <div className="space-y-2 pt-1">
                <label
                  className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                    dailyPermCountsAsAbsence === 1
                      ? 'border-teal-600 bg-teal-50/60 dark:bg-teal-950/30 dark:border-teal-500'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="daily_permission_rule"
                    checked={dailyPermCountsAsAbsence === 1}
                    onChange={() => setDailyPermCountsAsAbsence(1)}
                    className="mt-0.5 text-teal-700 focus:ring-teal-600 shrink-0"
                  />
                  <span className="text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-100">
                    نعم، يوم غياب كامل.
                  </span>
                </label>

                <label
                  className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                    dailyPermCountsAsAbsence === 0
                      ? 'border-teal-600 bg-teal-50/60 dark:bg-teal-950/30 dark:border-teal-500'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="daily_permission_rule"
                    checked={dailyPermCountsAsAbsence === 0}
                    onChange={() => setDailyPermCountsAsAbsence(0)}
                    className="mt-0.5 text-teal-700 focus:ring-teal-600 shrink-0"
                  />
                  <span className="text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-100">
                    لا، لا تُحتسب غياباً.
                  </span>
                </label>
              </div>
            </fieldset>

            {/* Lesson Permission Setting */}
            <fieldset className="space-y-2.5">
              <legend className="text-sm font-bold text-slate-900 dark:text-slate-100">
                إعداد رخصة الدرس
              </legend>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                هل تُحتسب الرخصة عن الدرس غياباً؟
              </p>

              <div className="space-y-2 pt-1">
                <label
                  className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                    lessonPermCountsAsAbsence === 1
                      ? 'border-teal-600 bg-teal-50/60 dark:bg-teal-950/30 dark:border-teal-500'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="lesson_permission_rule"
                    checked={lessonPermCountsAsAbsence === 1}
                    onChange={() => setLessonPermCountsAsAbsence(1)}
                    className="mt-0.5 text-teal-700 focus:ring-teal-600 shrink-0"
                  />
                  <span className="text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-100">
                    نعم، تُحتسب غياب درس وتدخل في عداد الدروس المتراكم.
                  </span>
                </label>

                <label
                  className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                    lessonPermCountsAsAbsence === 0
                      ? 'border-teal-600 bg-teal-50/60 dark:bg-teal-950/30 dark:border-teal-500'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="lesson_permission_rule"
                    checked={lessonPermCountsAsAbsence === 0}
                    onChange={() => setLessonPermCountsAsAbsence(0)}
                    className="mt-0.5 text-teal-700 focus:ring-teal-600 shrink-0"
                  />
                  <span className="text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-100">
                    لا، لا تُحتسب غياب درس.
                  </span>
                </label>
              </div>
            </fieldset>
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              <ShieldCheck className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0 mt-0.5" />
              <span>
                الإجازة المرضية لا تُحتسب غياباً مطلقاً في جميع الأحوال. تُطبق إعدادات الرخص على
                التسجيلات الجديدة والمعدّلة من تاريخ تطبيقها، ولا تُعدّل السجلات التاريخية السابقة
                تلقائياً.
              </span>
            </div>

            <button
              type="submit"
              disabled={savingSettings}
              className="w-full sm:w-auto px-4 py-2 text-sm font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              {savingSettings ? 'جاري الحفظ...' : 'حفظ إعدادات الإجازات والرخص'}
            </button>
          </div>
        </form>
      </section>
      </>
      )}

      {activeTab === 'holidays' && (
      <>
      {/* Weekly Holidays Settings Section */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2.5">
          <CalendarOff className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
            إعدادات العطل الأسبوعية
          </h3>
        </div>

        <form onSubmit={handleSaveWeeklyHolidays} className="p-4 sm:p-5 space-y-5">
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            حدد أيام العطلة الأسبوعية المعتمدة في المدرسة (الافتراضي في المدارس العراقية: الجمعة
            والسبت). يتم منع تسجيل الغيابات تلقائياً في أيام العطل الأسبوعية.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
            {(weeklyDaysList.length > 0 ? weeklyDaysList : DEFAULT_WEEKLY_DAYS).map((day) => {
              const checked = selectedWeeklyHolidayDays.includes(day.day_of_week);
              return (
                <label
                  key={day.day_of_week}
                  className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                    checked
                      ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-950/30 dark:border-amber-500/80'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/30 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={loadingHolidays || savingWeeklyHolidays}
                    onChange={() => handleToggleWeeklyDay(day.day_of_week)}
                    className="mt-0.5 rounded border-slate-300 text-amber-600 focus:ring-amber-500 shrink-0"
                  />
                  <div className="min-w-0">
                    <span className="block text-sm font-bold text-slate-900 dark:text-slate-100">
                      {day.day_name}
                    </span>
                    <span
                      className={`block text-[11px] mt-0.5 font-medium ${
                        checked
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {checked ? 'عطلة أسبوعية' : 'يوم دوام'}
                    </span>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div>
              <label
                htmlFor="weekly-holiday-reason-input"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                سبب / وصف العطلة الأسبوعية
              </label>
              <input
                id="weekly-holiday-reason-input"
                type="text"
                value={weeklyHolidayReason}
                onChange={(e) => setWeeklyHolidayReason(e.target.value)}
                placeholder="عطلة أسبوعية رسمية"
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
              />
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 px-3.5 py-2.5 text-xs space-y-1">
              <p className="text-slate-700 dark:text-slate-200">
                <span className="font-semibold text-amber-700 dark:text-amber-400">
                  أيام العطلة:
                </span>{' '}
                {weeklySummary.holidayNames.length > 0
                  ? weeklySummary.holidayNames.join('، ')
                  : 'لا توجد'}
              </p>
              <p className="text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                  أيام الدوام:
                </span>{' '}
                {weeklySummary.workNames.join('، ')}
              </p>
            </div>
          </div>

          {weeklyWarning && (
            <div
              role="alert"
              className="rounded-lg border border-amber-300 dark:border-amber-700/70 bg-amber-50 dark:bg-amber-950/30 p-3.5 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200 leading-relaxed"
            >
              <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold">تنبيه حول السجلات التاريخية السابقة</p>
                <p>{weeklyWarning.message}</p>
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-end">
            <button
              type="submit"
              disabled={loadingHolidays || savingWeeklyHolidays}
              className="w-full sm:w-auto px-4 py-2 text-sm font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              {savingWeeklyHolidays ? 'جاري الحفظ...' : 'حفظ العطل الأسبوعية'}
            </button>
          </div>
        </form>
      </section>

      {/* Official & Exceptional Holidays Management Section */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <CalendarDays className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
              إدارة العطل الرسمية والاستثنائية
            </h3>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {holidays.length.toLocaleString('ar-IQ')} عطلة مسجلة
          </span>
        </div>

        <div className="p-4 sm:p-5 space-y-6">
          {/* Add / Edit Holiday Form */}
          <form
            onSubmit={handleSaveHoliday}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 p-4 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {editingHolidayId ? 'تعديل بيانات العطلة' : 'إضافة عطلة رسمية أو استثنائية جديدة'}
              </h4>
              {editingHolidayId && (
                <button
                  type="button"
                  onClick={resetHolidayForm}
                  className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white underline"
                >
                  إلغاء التعديل
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div className="sm:col-span-2">
                <label
                  htmlFor="holiday-name-input"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  اسم العطلة أو سببها <span className="text-red-500">*</span>
                </label>
                <input
                  id="holiday-name-input"
                  type="text"
                  required
                  value={holidayName}
                  onChange={(e) => setHolidayName(e.target.value)}
                  placeholder="مثال: عطلة عيد الفطر المبارك أو عطلة أمطار"
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                />
              </div>

              <div>
                <label
                  htmlFor="holiday-start-date-input"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  تاريخ بداية العطلة <span className="text-red-500">*</span>
                </label>
                <input
                  id="holiday-start-date-input"
                  type="date"
                  required
                  value={holidayStartDate}
                  onChange={(e) => handleHolidayStartDateChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                />
              </div>

              <div>
                <label
                  htmlFor="holiday-end-date-input"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  تاريخ نهاية العطلة <span className="text-red-500">*</span>
                </label>
                <input
                  id="holiday-end-date-input"
                  type="date"
                  required
                  min={holidayStartDate || undefined}
                  value={holidayEndDate}
                  onChange={(e) => setHolidayEndDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                />
              </div>

              <div>
                <label
                  htmlFor="holiday-type-select"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  نوع العطلة <span className="text-red-500">*</span>
                </label>
                <select
                  id="holiday-type-select"
                  value={holidayType}
                  onChange={(e) => setHolidayType(e.target.value as HolidayType)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                >
                  <option value="official">عطلة رسمية</option>
                  <option value="exceptional">عطلة استثنائية</option>
                  <option value="school_specific">عطلة خاصة بالمدرسة</option>
                </select>
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <label
                  htmlFor="holiday-notes-input"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  ملاحظات إضافية (اختياري)
                </label>
                <input
                  id="holiday-notes-input"
                  type="text"
                  value={holidayNotes}
                  onChange={(e) => setHolidayNotes(e.target.value)}
                  placeholder="تفاصيل إضافية أو رقم الكتاب الوزاري / القرار الإداري..."
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                لعطلة يوم واحد، اختر نفس التاريخ في البداية والنهاية. يمنع النظام تداخل فترات العطل
                المسجلة.
              </p>

              <button
                type="submit"
                disabled={savingHoliday}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 text-white transition-colors whitespace-nowrap shrink-0 w-full sm:w-auto disabled:opacity-60"
              >
                <Plus className="w-4 h-4" />
                <span>
                  {savingHoliday
                    ? 'جاري الحفظ...'
                    : editingHolidayId
                      ? 'حفظ تعديلات العطلة'
                      : 'إضافة العطلة'}
                </span>
              </button>
            </div>
          </form>

          {holidayWarning && (
            <div
              role="alert"
              className="rounded-lg border border-amber-300 dark:border-amber-700/70 bg-amber-50 dark:bg-amber-950/30 p-3.5 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200 leading-relaxed"
            >
              <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold">تنبيه: توجد سجلات غياب سابقة ضمن فترة العطلة</p>
                <p>{holidayWarning.message}</p>
              </div>
            </div>
          )}

          {/* Registered Holidays List */}
          {loadingHolidays ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-12 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse"
                />
              ))}
            </div>
          ) : holidays.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 p-8 text-center">
              <CalendarDays className="w-7 h-7 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                لا توجد عطل رسمية أو استثنائية مسجلة حتى الآن
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                استخدم النموذج أعلاه لإضافة العطل الرسمية أو الاستثنائية أو العطل الخاصة بالمدرسة.
              </p>
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3.5 font-semibold min-w-[180px]">
                      اسم العطلة / السبب
                    </th>
                    <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">
                      التاريخ / المدة
                    </th>
                    <th className="py-2.5 px-3.5 font-semibold whitespace-nowrap">نوع العطلة</th>
                    <th className="py-2.5 px-3.5 font-semibold text-left whitespace-nowrap">
                      الإجراءات
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {holidays.map((h) => (
                    <tr
                      key={h.id}
                      className={
                        editingHolidayId === h.id
                          ? 'bg-teal-50/50 dark:bg-teal-950/20'
                          : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30'
                      }
                    >
                      <td className="py-3 px-3.5 align-top">
                        <p className="font-bold text-slate-900 dark:text-slate-100">{h.name}</p>
                        {h.notes && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                            {h.notes}
                          </p>
                        )}
                      </td>

                      <td className="py-3 px-3.5 tabular-nums whitespace-nowrap align-top">
                        <p className="font-medium text-slate-800 dark:text-slate-200">
                          {h.start_date === h.end_date
                            ? h.start_date
                            : `${h.start_date} ← ${h.end_date}`}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {h.days_count === 1
                            ? 'يوم واحد'
                            : `${h.days_count.toLocaleString('ar-IQ')} أيام`}
                        </p>
                      </td>

                      <td className="py-3 px-3.5 whitespace-nowrap align-top">
                        <span
                          className={`text-xs font-bold ${HOLIDAY_TYPE_TEXT_CLASSES[h.holiday_type]}`}
                        >
                          {HOLIDAY_TYPE_LABELS[h.holiday_type]}
                        </span>
                      </td>

                      <td className="py-3 px-3.5 text-left whitespace-nowrap align-top">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleStartEditHoliday(h)}
                            title="تعديل العطلة"
                            className="p-1.5 rounded-md text-slate-500 hover:text-teal-700 dark:hover:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/40 transition-colors"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteHolidayTarget(h)}
                            title="حذف العطلة"
                            className="p-1.5 rounded-md text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
      </>
      )}

      <ConfirmDialog
        open={Boolean(deleteHolidayTarget)}
        title={`حذف العطلة "${deleteHolidayTarget?.name ?? ''}"`}
        message={`هل أنت متأكد من حذف العطلة "${deleteHolidayTarget?.name ?? ''}" (${
          deleteHolidayTarget
            ? deleteHolidayTarget.start_date === deleteHolidayTarget.end_date
              ? deleteHolidayTarget.start_date
              : `من ${deleteHolidayTarget.start_date} إلى ${deleteHolidayTarget.end_date}`
            : ''
        })؟ لن تتأثر سجلات الغياب التاريخية السابقة، وسيعود التاريخ يوم دوام طبيعي ما لم يصادف عطلة أسبوعية.`}
        confirmLabel="نعم، احذف العطلة"
        danger
        loading={deletingHoliday}
        onConfirm={handleConfirmDeleteHoliday}
        onCancel={() => setDeleteHolidayTarget(null)}
      />
    </div>
  );
}

