import { BarChart3, CalendarDays, ClipboardCheck } from 'lucide-react';
import type { NavSectionId } from '../../types/school';

interface UpcomingSectionViewProps {
  section: 'absences' | 'monthly' | 'reports';
  onNavigate: (target: NavSectionId) => void;
}

const SECTION_CONFIG: Record<
  'absences' | 'monthly' | 'reports',
  {
    title: string;
    phase: string;
    description: string;
    plannedFeatures: string[];
    icon: typeof ClipboardCheck;
  }
> = {
  absences: {
    title: 'تسجيل الغيابات اليومية',
    phase: 'المرحلة القادمة (المرحلة الثانية)',
    description:
      'تم تأسيس جدول الغيابات وربطه بقاعدة البيانات مع قيود التكامل المرجعي للطلاب والصفوف والشعب. ستتيح هذه الواجهة للإدارة إدخال الغيابات اليومية المنقولة من دفاتر المراقبين بسرعة ودقة.',
    plannedFeatures: [
      'اختيار التاريخ والصف والشعبة لعرض قائمة الطلبة الفعالين.',
      'تسجيل حالات الغياب (غائب بعذر، غائب دون عذر، متأخر) مع الملاحظات.',
      'حفظ فوري ومنع تكرار تسجيل غياب الطالب مرتين في اليوم نفسه.',
    ],
    icon: ClipboardCheck,
  },
  monthly: {
    title: 'السجل الشهري للغيابات',
    phase: 'المرحلة الثالثة',
    description:
      'شاشة عرض جدولي شهري تحاكي سجل الغيابات الورقي المركزي لكل شعبة، مع مجاميع الغياب الشهرية والسنوية لكل طالب.',
    plannedFeatures: [
      'مصفوفة أيام الشهر مقابل أسماء الطلبة لكل صف وشعبة.',
      'احتساب تلقائي لمجموع أيام الغياب بعذر ودون عذر.',
      'إبراز الطلبة الذين يقتربون من حدود الإنذارات والفصل بالغياب.',
    ],
    icon: CalendarDays,
  },
  reports: {
    title: 'التقارير والإحصائيات الرسمية',
    phase: 'المرحلة الرابعة',
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
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 space-y-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-400 flex items-center justify-center shrink-0">
            <Icon className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-semibold text-teal-700 dark:text-teal-400">{cfg.phase}</p>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1 font-display">
              {cfg.title}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">
              {cfg.description}
            </p>
          </div>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 pt-5">
          <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-3">
            الوظائف المخطط تنفيذها في هذا القسم:
          </h3>
          <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300 list-disc list-inside">
            {cfg.plannedFeatures.map((feat, idx) => (
              <li key={idx}>{feat}</li>
            ))}
          </ul>
        </div>

        <div className="border-t border-slate-200 dark:border-slate-800 pt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate('students')}
            className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors"
          >
            إدارة الطلاب الحالية
          </button>
          <button
            type="button"
            onClick={() => onNavigate('grades')}
            className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium transition-colors"
          >
            إدارة الصفوف والشعب
          </button>
        </div>
      </div>
    </div>
  );
}
