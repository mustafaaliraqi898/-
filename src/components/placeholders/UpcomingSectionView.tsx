import { BarChart3, CalendarDays } from 'lucide-react';
import type { NavSectionId } from '../../types/school';

interface UpcomingSectionViewProps {
  section: 'monthly' | 'reports';
  onNavigate: (target: NavSectionId) => void;
}

const SECTION_CONFIG: Record<
  'monthly' | 'reports',
  {
    title: string;
    description: string;
    plannedFeatures: string[];
    icon: typeof CalendarDays;
  }
> = {
  monthly: {
    title: 'السجل الشهري للغيابات',
    description:
      'شاشة عرض جدولي شهري تحاكي سجل الغيابات الورقي المركزي لكل شعبة، مع إظهار أيام الغياب الكامل والغيابات المحولة من الدروس لكل طالب.',
    plannedFeatures: [
      'مصفوفة أيام الشهر مقابل أسماء الطلبة لكل صف وشعبة.',
      'تمييز غياب اليوم الكامل عن غياب الدروس والرصيد المتراكم.',
      'احتساب تلقائي لمجموع أيام الغياب الشهرية والسنوية.',
    ],
    icon: CalendarDays,
  },
  reports: {
    title: 'التقارير والإحصائيات الرسمية',
    description:
      'تقارير قابلة للطباعة والتصدير لإدارة المدرسة والمديرية العامة للتربية استناداً إلى سجلات الدوام والغياب الفعلية.',
    plannedFeatures: [
      'كشف الغياب اليومي والشهري القابل للطباعة بصيغة رسمية.',
      'إشعارات وكتب الإنذار للطلبة المتجاوزين للحد المسموح.',
      'تصدير التقارير الإحصائية إلى Excel وPDF.',
    ],
    icon: BarChart3,
  },
};

export function UpcomingSectionView({ section, onNavigate }: UpcomingSectionViewProps) {
  const cfg = SECTION_CONFIG[section];
  const Icon = cfg.icon;

  return (
    <div className="max-w-3xl">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-8 space-y-5 sm:space-y-6">
        <div className="flex flex-col sm:flex-row items-start gap-3.5 sm:gap-4">
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-400 flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 font-display">
              {cfg.title}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1.5 sm:mt-2 leading-relaxed">
              {cfg.description}
            </p>
          </div>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 pt-4 sm:pt-5">
          <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-3">
            الوظائف التي سيوفرها هذا القسم:
          </h3>
          <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300 list-disc list-inside leading-relaxed">
            {cfg.plannedFeatures.map((feat, idx) => (
              <li key={idx}>{feat}</li>
            ))}
          </ul>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 pt-4 sm:pt-5 flex flex-wrap items-center gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={() => onNavigate('absences')}
            className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors whitespace-nowrap"
          >
            الانتقال إلى تسجيل الغيابات
          </button>
          <button
            type="button"
            onClick={() => onNavigate('students')}
            className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium transition-colors whitespace-nowrap"
          >
            إدارة الطلاب
          </button>
        </div>
      </div>
    </div>
  );
}
