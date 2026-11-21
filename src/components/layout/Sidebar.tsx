import {
  BarChart3,
  BookOpenCheck,
  CalendarDays,
  ClipboardCheck,
  Home,
  Layers,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { useEffect } from 'react';
import type { NavSectionId } from '../../types/school';

interface SidebarProps {
  activeSection: NavSectionId;
  onSelectSection: (section: NavSectionId) => void;
  schoolName: string;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

interface NavItemConfig {
  id: NavSectionId;
  label: string;
  icon: typeof Home;
}

const NAV_ITEMS: NavItemConfig[] = [
  { id: 'dashboard', label: 'الصفحة الرئيسية', icon: Home },
  { id: 'students', label: 'إدارة الطلاب', icon: Users },
  { id: 'grades', label: 'إدارة الصفوف والشعب', icon: Layers },
  { id: 'absences', label: 'تسجيل الغيابات', icon: ClipboardCheck },
  { id: 'monthly', label: 'السجل الشهري', icon: CalendarDays },
  { id: 'reports', label: 'التقارير', icon: BarChart3 },
  { id: 'settings', label: 'الإعدادات', icon: Settings },
];

export function Sidebar({
  activeSection,
  onSelectSection,
  schoolName,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  useEffect(() => {
    if (!mobileOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onCloseMobile();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen, onCloseMobile]);

  function handleSelect(section: NavSectionId) {
    onSelectSection(section);
    onCloseMobile();
  }

  return (
    <>
      {/* Mobile / Tablet Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-[1px] lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        aria-label="الشريط الجانبي"
        className={`fixed inset-y-0 right-0 z-50 w-[268px] max-w-[82vw] lg:static lg:z-auto lg:w-[236px] xl:w-[260px] shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col h-dvh lg:sticky lg:top-0 transition-transform duration-200 ease-out lg:translate-x-0 lg:visible lg:pointer-events-auto ${
          mobileOpen
            ? 'translate-x-0 visible pointer-events-auto shadow-2xl lg:shadow-none'
            : 'translate-x-full invisible pointer-events-none'
        }`}
      >
        <div className="px-4 sm:px-5 py-4 lg:py-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2.5 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-xl bg-teal-700 dark:bg-teal-600 text-white flex items-center justify-center shrink-0">
              <BookOpenCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate font-display">
                سجل الغيابات المركزي
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                {schoolName}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="إغلاق القائمة الجانبية"
            className="lg:hidden p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav
          className="flex-1 px-3 py-3 lg:py-4 space-y-1 overflow-y-auto"
          aria-label="القائمة الرئيسية"
        >
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors text-right min-h-[42px] ${
                  isActive
                    ? 'bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300 font-semibold'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon
                  className={`w-[18px] h-[18px] shrink-0 ${
                    isActive
                      ? 'text-teal-700 dark:text-teal-400'
                      : 'text-slate-400 dark:text-slate-500'
                  }`}
                />
                <span className="truncate whitespace-nowrap">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="px-4 py-3.5 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 shrink-0">
          إدارة شؤون الطلبة والدوام المدرسي
        </div>
      </aside>
    </>
  );
}
