import { Moon, Sun } from 'lucide-react';
import type { AcademicYear, NavSectionId } from '../../types/school';

interface HeaderProps {
  activeSection: NavSectionId;
  schoolName: string;
  academicYears: AcademicYear[];
  selectedYearId: number | null;
  onSelectYear: (yearId: number) => void;
  isDark: boolean;
  onToggleTheme: () => void;
}

const SECTION_TITLES: Record<NavSectionId, string> = {
  dashboard: 'الصفحة الرئيسية',
  students: 'إدارة الطلاب',
  grades: 'إدارة الصفوف والشعب',
  absences: 'تسجيل الغيابات',
  monthly: 'السجل الشهري',
  reports: 'التقارير',
  settings: 'الإعدادات',
};

function formatArabicTodayDate(): string {
  try {
    return new Intl.DateTimeFormat('ar-IQ', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date());
  } catch {
    return new Date().toLocaleDateString('ar-EG');
  }
}

export function Header({
  activeSection,
  schoolName,
  academicYears,
  selectedYearId,
  onSelectYear,
  isDark,
  onToggleTheme,
}: HeaderProps) {
  const todayFormatted = formatArabicTodayDate();

  return (
    <header className="h-16 shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 flex items-center justify-between gap-6">
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap font-display">
          نظام إدارة الغيابات المدرسية
        </h1>
        <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
          /
        </span>
        <span className="text-sm font-medium text-teal-700 dark:text-teal-400 whitespace-nowrap truncate">
          {SECTION_TITLES[activeSection]}
        </span>
      </div>

      <div className="flex items-center gap-4 shrink-0">
        <span className="hidden lg:inline-block text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap tabular-nums">
          {todayFormatted}
        </span>

        {academicYears.length > 0 && (
          <div className="flex items-center gap-2">
            <label
              htmlFor="header-academic-year"
              className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap"
            >
              السنة الدراسية:
            </label>
            <select
              id="header-academic-year"
              value={selectedYearId ?? ''}
              onChange={(e) => onSelectYear(Number(e.target.value))}
              className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30 tabular-nums"
            >
              {academicYears.map((yr) => (
                <option key={yr.id} value={yr.id}>
                  {yr.name}
                  {yr.is_active ? ' (الفعالة)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={isDark ? 'التبديل إلى الوضع النهاري' : 'التبديل إلى الوضع الليلي'}
          title={isDark ? 'الوضع النهاري' : 'الوضع الليلي'}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
        >
          {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          <span>{isDark ? 'الوضع النهاري' : 'الوضع الليلي'}</span>
        </button>

        <span className="sr-only">{schoolName}</span>
      </div>
    </header>
  );
}
