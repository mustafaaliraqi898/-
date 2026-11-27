import { Menu, Moon, Sun } from 'lucide-react';
import { useNumberDisplay } from '../../contexts/NumberDisplayContext';
import type { AcademicYear, NavSectionId } from '../../types/school';

interface HeaderProps {
  activeSection: NavSectionId;
  schoolName: string;
  academicYears: AcademicYear[];
  selectedYearId: number | null;
  onSelectYear: (yearId: number) => void;
  isDark: boolean;
  onToggleTheme: () => void;
  mobileMenuOpen: boolean;
  onOpenMobileMenu: () => void;
}

const SECTION_TITLES: Record<NavSectionId, string> = {
  dashboard: 'الصفحة الرئيسية',
  students: 'إدارة الطلاب',
  grades: 'إدارة الصفوف والشعب',
  absences: 'تسجيل الغيابات',
  monthly: 'السجل الشهري',
  reports: 'التقارير',
  audit: 'سجل العمليات والتعديلات',
  settings: 'الإعدادات',
};

export function Header({
  activeSection,
  schoolName,
  academicYears,
  selectedYearId,
  onSelectYear,
  isDark,
  onToggleTheme,
  mobileMenuOpen,
  onOpenMobileMenu,
}: HeaderProps) {
  const { todayLongDate, academicYear } = useNumberDisplay();
  const todayFormatted = todayLongDate();

  return (
    <header className="sticky top-0 z-30 h-14 sm:h-16 shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm px-3 sm:px-5 lg:px-6 flex items-center justify-between gap-2 sm:gap-4">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="فتح القائمة الجانبية"
          aria-expanded={mobileMenuOpen}
          className="lg:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <h1 className="hidden md:block text-base lg:text-lg font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap truncate font-display">
            نظام إدارة الغيابات المدرسية
          </h1>
          <span className="hidden md:inline text-slate-300 dark:text-slate-700" aria-hidden="true">
            /
          </span>
          <span className="text-sm sm:text-base md:text-sm font-bold md:font-medium text-slate-900 md:text-teal-700 dark:text-slate-100 md:dark:text-teal-400 whitespace-nowrap truncate">
            {SECTION_TITLES[activeSection]}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 lg:gap-4 shrink-0">
        <span className="hidden xl:inline-block text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap tabular-nums">
          {todayFormatted}
        </span>

        {academicYears.length > 0 && (
          <div className="flex items-center gap-1.5 sm:gap-2">
            <label
              htmlFor="header-academic-year"
              className="hidden lg:inline text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap"
            >
              السنة الدراسية:
            </label>
            <select
              id="header-academic-year"
              aria-label="السنة الدراسية"
              value={selectedYearId ?? ''}
              onChange={(e) => onSelectYear(Number(e.target.value))}
              className="max-w-[122px] sm:max-w-none px-2 sm:px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30 tabular-nums min-h-[36px]"
            >
              {academicYears.map((yr) => (
                <option key={yr.id} value={yr.id}>
                  {academicYear(yr.name)}
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
          className="inline-flex items-center justify-center gap-2 w-9 h-9 sm:w-auto sm:h-auto sm:px-3 sm:py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
        >
          {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          <span className="hidden sm:inline">{isDark ? 'الوضع النهاري' : 'الوضع الليلي'}</span>
        </button>

        <span className="sr-only">{schoolName}</span>
      </div>
    </header>
  );
}
