import {
  BarChart3,
  BookOpenCheck,
  CalendarDays,
  ClipboardCheck,
  Home,
  Layers,
  Settings,
  Users,
} from 'lucide-react';
import type { NavSectionId } from '../../types/school';

interface SidebarProps {
  activeSection: NavSectionId;
  onSelectSection: (section: NavSectionId) => void;
  schoolName: string;
}

interface NavItemConfig {
  id: NavSectionId;
  label: string;
  icon: typeof Home;
  phaseNote?: string;
}

const NAV_ITEMS: NavItemConfig[] = [
  { id: 'dashboard', label: 'الصفحة الرئيسية', icon: Home },
  { id: 'students', label: 'إدارة الطلاب', icon: Users },
  { id: 'grades', label: 'إدارة الصفوف والشعب', icon: Layers },
  { id: 'absences', label: 'تسجيل الغيابات', icon: ClipboardCheck, phaseNote: 'المرحلة 2' },
  { id: 'monthly', label: 'السجل الشهري', icon: CalendarDays, phaseNote: 'المرحلة 3' },
  { id: 'reports', label: 'التقارير', icon: BarChart3, phaseNote: 'المرحلة 4' },
  { id: 'settings', label: 'الإعدادات', icon: Settings },
];

export function Sidebar({ activeSection, onSelectSection, schoolName }: SidebarProps) {
  return (
    <aside className="w-[260px] shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col min-h-screen">
      <div className="px-5 py-5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-teal-700 dark:bg-teal-600 text-white flex items-center justify-center shrink-0">
          <BookOpenCheck className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate font-display">
            سجل الغيابات المركزي
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{schoolName}</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1" aria-label="القائمة الرئيسية">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectSection(item.id)}
              className={`w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors text-right ${
                isActive
                  ? 'bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300 font-semibold'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <Icon
                  className={`w-[18px] h-[18px] shrink-0 ${
                    isActive
                      ? 'text-teal-700 dark:text-teal-400'
                      : 'text-slate-400 dark:text-slate-500'
                  }`}
                />
                <span className="truncate whitespace-nowrap">{item.label}</span>
              </span>
              {item.phaseNote && (
                <span className="text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap shrink-0">
                  {item.phaseNote}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="px-4 py-3.5 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
        إدارة شؤون الطلبة والدوام المدرسي
      </div>
    </aside>
  );
}
