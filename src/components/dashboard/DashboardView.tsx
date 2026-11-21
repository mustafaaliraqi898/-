import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  FolderKanban,
  Info,
  Layers,
  Users,
} from 'lucide-react';
import type { DashboardStats } from '../../types/school';

interface DashboardViewProps {
  stats: DashboardStats | null;
  loading: boolean;
}

function getAbsenceCompletionLabel(stats: DashboardStats | null): {
  label: string;
  detail: string;
} {
  if (!stats) {
    return { label: '—', detail: 'جاري قراءة البيانات من قاعدة البيانات' };
  }
  if (stats.total_sections === 0) {
    return {
      label: 'غير مهيأ بعد',
      detail: 'بانتظار تعريف الصفوف والشعب الدراسية',
    };
  }
  if (stats.absence_days_count === 0) {
    return {
      label: 'لم يبدأ التسجيل بعد',
      detail: 'لا توجد أي أيام غياب مسجلة في السنة الدراسية الحالية',
    };
  }
  if (stats.today_sections_recorded === 0) {
    return {
      label: 'غير مسجل لليوم',
      detail: `لا توجد تسجيلات غياب بتاريخ اليوم عبر ${stats.total_sections.toLocaleString('ar-IQ')} شعبة`,
    };
  }
  if (stats.today_sections_recorded < stats.total_sections) {
    return {
      label: 'مكتمل جزئياً لليوم',
      detail: `تم تسجيل ${stats.today_sections_recorded.toLocaleString('ar-IQ')} من أصل ${stats.total_sections.toLocaleString('ar-IQ')} شعبة اليوم`,
    };
  }
  return {
    label: 'مكتمل لجميع الشعب اليوم',
    detail: `تمت تغطية جميع الشعب (${stats.total_sections.toLocaleString('ar-IQ')}) بتاريخ اليوم`,
  };
}

function buildAdministrativeAlerts(stats: DashboardStats | null): string[] {
  if (!stats) return [];

  const alerts: string[] = [];

  if (stats.total_grades === 0) {
    alerts.push('لا توجد صفوف دراسية معرفة حالياً في النظام.');
  } else if (stats.grades_without_sections > 0) {
    alerts.push(
      `يوجد ${stats.grades_without_sections.toLocaleString('ar-IQ')} صف دراسي لا يحتوي على شعب معرفة.`
    );
  }

  if (stats.total_students === 0) {
    alerts.push('لا يوجد طلاب مسجلون في السنة الدراسية الحالية حتى الآن.');
  } else {
    if (stats.students_without_registry > 0) {
      alerts.push(
        `يوجد ${stats.students_without_registry.toLocaleString('ar-IQ')} طالب مسجل دون رقم قيد مدرسي.`
      );
    }
    if (stats.sections_without_students > 0) {
      alerts.push(
        `توجد ${stats.sections_without_students.toLocaleString('ar-IQ')} شعبة دراسية فارغة لا تضم طلاباً مسجلين.`
      );
    }
    if (stats.absence_days_count === 0) {
      alerts.push('لم يتم تسجيل أي غيابات يومية حتى الآن في السنة الدراسية الحالية.');
    }
  }

  return alerts;
}

export function DashboardView({ stats, loading }: DashboardViewProps) {
  if (loading && !stats) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-28 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse"
            />
          ))}
        </div>
        <div className="h-56 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />
      </div>
    );
  }

  const totalStudents = stats?.total_students ?? 0;
  const totalGrades = stats?.total_grades ?? 0;
  const totalSections = stats?.total_sections ?? 0;
  const absenceDaysCount = stats?.absence_days_count ?? 0;
  const completion = getAbsenceCompletionLabel(stats);
  const alerts = buildAdministrativeAlerts(stats);

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Page Title */}
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 font-display">
          الصفحة الرئيسية
        </h2>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
          ملخص إحصائي عام للمدرسة وسجلات الطلاب والغيابات للسنة الدراسية{' '}
          {stats?.active_academic_year?.name ?? '—'}
        </p>
      </div>

      {/* 4 Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5 sm:gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              إجمالي الطلاب المسجلين
            </span>
            <span className="p-2 rounded-lg bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-400 shrink-0">
              <Users className="w-4 h-4" />
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2.5 sm:mt-3 tabular-nums font-display">
            {totalStudents.toLocaleString('ar-IQ')}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
            الطلبة الفعالون في السنة الحالية
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              عدد الصفوف الدراسية
            </span>
            <span className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0">
              <Layers className="w-4 h-4" />
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2.5 sm:mt-3 tabular-nums font-display">
            {totalGrades.toLocaleString('ar-IQ')}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
            الصفوف المعرفة في النظام
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              عدد الشعب الدراسية
            </span>
            <span className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0">
              <FolderKanban className="w-4 h-4" />
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2.5 sm:mt-3 tabular-nums font-display">
            {totalSections.toLocaleString('ar-IQ')}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
            موزعة على جميع الصفوف
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              عدد أيام تسجيل الغياب
            </span>
            <span className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0">
              <CalendarDays className="w-4 h-4" />
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 mt-2.5 sm:mt-3 tabular-nums font-display">
            {absenceDaysCount.toLocaleString('ar-IQ')}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
            {absenceDaysCount === 0
              ? 'لم تسجل أيام غياب حتى الآن'
              : 'أيام دوام موثقة في السجل'}
          </p>
        </div>
      </div>

      {/* Summary & Administrative Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-start">
        {/* General Info Summary */}
        <section className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2.5">
            <Info className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
              ملخص المعلومات
            </h3>
          </div>

          <dl className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
            <div className="px-4 sm:px-5 py-3.5 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-4">
              <dt className="text-slate-500 dark:text-slate-400 font-medium">
                السنة الدراسية الحالية
              </dt>
              <dd className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {stats?.active_academic_year?.name ?? 'غير محددة'}
              </dd>
            </div>

            <div className="px-4 sm:px-5 py-3.5 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-4">
              <dt className="text-slate-500 dark:text-slate-400 font-medium">
                آخر تاريخ تم فيه تسجيل الغياب
              </dt>
              <dd className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                {stats?.last_absence_date ?? 'لا توجد سجلات غياب بعد'}
              </dd>
            </div>

            <div className="px-4 sm:px-5 py-3.5 sm:py-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1.5 sm:gap-4">
              <dt className="text-slate-500 dark:text-slate-400 font-medium shrink-0">
                حالة اكتمال تسجيل الغياب
              </dt>
              <dd className="sm:text-left">
                <p className="font-bold text-slate-900 dark:text-slate-100">{completion.label}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums leading-relaxed">
                  {completion.detail}
                </p>
              </dd>
            </div>
          </dl>
        </section>

        {/* Important Administrative Alerts */}
        <section className="lg:col-span-6 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2.5">
            {alerts.length > 0 ? (
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            )}
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
              تنبيهات إدارية مهمة
            </h3>
          </div>

          <div className="p-4 sm:p-5">
            {alerts.length === 0 ? (
              <div className="flex items-start gap-3 text-sm text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <p className="font-semibold">البيانات الأساسية مكتملة</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    جميع الصفوف والشعب والطلاب في السنة الدراسية الحالية مكتملة ولا توجد نواقص
                    إدارية حالياً.
                  </p>
                </div>
              </div>
            ) : (
              <ul className="space-y-3 text-sm">
                {alerts.map((alertMsg, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-2.5 text-slate-700 dark:text-slate-200 leading-relaxed"
                  >
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-1" />
                    <span>{alertMsg}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
