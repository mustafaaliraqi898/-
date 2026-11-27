import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Filter,
  FolderKanban,
  Info,
  Layers,
  PieChart,
  RotateCcw,
  ShieldAlert,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { useNumberDisplay } from '../../contexts/NumberDisplayContext';
import type {
  DashboardMonthlyAbsencePoint,
  DashboardStats,
  GradeWithSections,
  NavSectionId,
} from '../../types/school';
import { LtrSpan } from '../common/BidirectionalText';

interface DashboardViewProps {
  stats: DashboardStats | null;
  grades: GradeWithSections[];
  loading: boolean;
  selectedGradeId: number | null;
  selectedStageId: number | null;
  onFilterChange: (filters: { gradeId: number | null; stageId: number | null }) => void;
  onNavigateSection?: (section: NavSectionId) => void;
}

const STAGE_ACCENT_STYLES = [
  {
    border: 'border-amber-200 dark:border-amber-800/70',
    bg: 'bg-amber-50/70 dark:bg-amber-950/30',
    activeBg: 'ring-2 ring-amber-500 bg-amber-100/80 dark:bg-amber-900/50',
    dot: '#f59e0b',
    text: 'text-amber-800 dark:text-amber-300',
  },
  {
    border: 'border-orange-200 dark:border-orange-800/70',
    bg: 'bg-orange-50/70 dark:bg-orange-950/30',
    activeBg: 'ring-2 ring-orange-500 bg-orange-100/80 dark:bg-orange-900/50',
    dot: '#f97316',
    text: 'text-orange-800 dark:text-orange-300',
  },
  {
    border: 'border-rose-200 dark:border-rose-800/70',
    bg: 'bg-rose-50/70 dark:bg-rose-950/30',
    activeBg: 'ring-2 ring-rose-500 bg-rose-100/80 dark:bg-rose-900/50',
    dot: '#e11d48',
    text: 'text-rose-800 dark:text-rose-300',
  },
  {
    border: 'border-purple-200 dark:border-purple-800/70',
    bg: 'bg-purple-50/70 dark:bg-purple-950/30',
    activeBg: 'ring-2 ring-purple-500 bg-purple-100/80 dark:bg-purple-900/50',
    dot: '#9333ea',
    text: 'text-purple-800 dark:text-purple-300',
  },
  {
    border: 'border-indigo-200 dark:border-indigo-800/70',
    bg: 'bg-indigo-50/70 dark:bg-indigo-950/30',
    activeBg: 'ring-2 ring-indigo-500 bg-indigo-100/80 dark:bg-indigo-900/50',
    dot: '#4f46e5',
    text: 'text-indigo-800 dark:text-indigo-300',
  },
];

function getAbsenceCompletionLabel(
  stats: DashboardStats | null,
  countFmt: (v: number) => string
): {
  label: string;
  detail: string;
  percent: number;
} {
  if (!stats) {
    return { label: '—', detail: 'جاري قراءة البيانات من قاعدة البيانات', percent: 0 };
  }
  if (stats.total_sections === 0) {
    return {
      label: 'غير مهيأ بعد',
      detail: 'بانتظار تعريف الصفوف والشعب الدراسية',
      percent: 0,
    };
  }
  if (stats.absence_days_count === 0) {
    return {
      label: 'لم يبدأ التسجيل بعد',
      detail: 'لا توجد أي أيام غياب مسجلة في السنة الدراسية الحالية',
      percent: 0,
    };
  }
  const pct = Math.min(
    100,
    Math.round((stats.today_sections_recorded / Math.max(1, stats.total_sections)) * 100)
  );
  if (stats.today_sections_recorded === 0) {
    return {
      label: 'غير مسجل لليوم',
      detail: `لا توجد تسجيلات غياب بتاريخ اليوم عبر ${countFmt(stats.total_sections)} شعبة`,
      percent: 0,
    };
  }
  if (stats.today_sections_recorded < stats.total_sections) {
    return {
      label: 'مكتمل جزئياً لليوم',
      detail: `تم تسجيل ${countFmt(stats.today_sections_recorded)} من أصل ${countFmt(stats.total_sections)} شعبة اليوم`,
      percent: pct,
    };
  }
  return {
    label: 'مكتمل لجميع الشعب اليوم',
    detail: `تمت تغطية جميع الشعب (${countFmt(stats.total_sections)}) بتاريخ اليوم`,
    percent: 100,
  };
}

function buildAdministrativeAlerts(
  stats: DashboardStats | null,
  countFmt: (v: number) => string
): string[] {
  if (!stats) return [];

  const alerts: string[] = [];

  if (stats.total_grades === 0) {
    alerts.push('لا توجد صفوف دراسية معرفة حالياً في النظام.');
  } else if (stats.grades_without_sections > 0) {
    alerts.push(`يوجد ${countFmt(stats.grades_without_sections)} صف دراسي لا يحتوي على شعب معرفة.`);
  }

  if (stats.total_students === 0 && !stats.filters_applied?.grade_id && !stats.filters_applied?.stage_id) {
    alerts.push('لا يوجد طلاب مسجلون في السنة الدراسية الحالية حتى الآن.');
  } else if (stats.total_students > 0) {
    if (stats.students_without_registry > 0) {
      alerts.push(
        `يوجد ${countFmt(stats.students_without_registry)} طالب مسجل دون رقم قيد مدرسي.`
      );
    }
    if (stats.sections_without_students > 0) {
      alerts.push(
        `توجد ${countFmt(stats.sections_without_students)} شعبة دراسية فارغة لا تضم طلاباً مسجلين.`
      );
    }
    if (stats.absence_days_count === 0) {
      alerts.push('لم يتم تسجيل أي غيابات يومية حتى الآن في السنة الدراسية الحالية.');
    } else if (stats.total_sections > 0 && stats.today_sections_recorded === 0) {
      alerts.push('لم يتم تسجيل الحضور والغياب لأي شعبة بتاريخ اليوم حتى الآن.');
    }
  }

  return alerts;
}

export function DashboardView({
  stats,
  grades,
  loading,
  selectedGradeId,
  selectedStageId,
  onFilterChange,
  onNavigateSection,
}: DashboardViewProps) {
  const { count, dateDMY, academicYear } = useNumberDisplay();
  const [hoveredMonth, setHoveredMonth] = useState<DashboardMonthlyAbsencePoint | null>(null);
  const [hoveredSliceIndex, setHoveredSliceIndex] = useState<number | null>(null);

  if (loading && !stats) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-32 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 h-72 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />
          <div className="lg:col-span-5 h-72 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse" />
        </div>
      </div>
    );
  }

  const totalStudents = stats?.total_students ?? 0;
  const totalGrades = stats?.total_grades ?? 0;
  const totalSections = stats?.total_sections ?? 0;
  const absenceDaysCount = stats?.absence_days_count ?? 0;
  const studentsWithAbsences = stats?.students_with_absences ?? 0;
  const stageCounts = stats?.stage_counts ?? [];
  const withinLimitCount = stats?.within_limit_students_count ?? 0;
  const monthlyAbsences = stats?.monthly_absences ?? [];
  const approachingStudents = stats?.approaching_stage_students ?? [];
  const exceededStudents = stats?.exceeded_stage_students ?? [];

  const completion = getAbsenceCompletionLabel(stats, (v) => count(v));
  const structuralAlerts = buildAdministrativeAlerts(stats, (v) => count(v));

  const maxMonthlyValue = Math.max(
    1,
    ...monthlyAbsences.map((m) => Math.max(m.total_absence_days, m.full_day_count + m.converted_day_count))
  );

  // Build SVG Donut slices from real SQLite stage counts + within-limit students
  const distributionSegments = [
    {
      id: 'within_limit',
      label: 'ضمن الحد المسموح',
      count: withinLimitCount,
      color: '#10b981',
    },
    ...stageCounts.map((s, idx) => ({
      id: `stage_${s.stage_id}`,
      label: s.stage_name,
      count: s.students_count,
      color: STAGE_ACCENT_STYLES[idx % STAGE_ACCENT_STYLES.length].dot,
    })),
  ];

  const totalDistributedStudents = distributionSegments.reduce((acc, s) => acc + s.count, 0);
  const donutRadius = 64;
  const donutCircumference = 2 * Math.PI * donutRadius;

  let cumulativeFraction = 0;
  const donutArcs = distributionSegments.map((seg) => {
    const fraction = totalDistributedStudents > 0 ? seg.count / totalDistributedStudents : 0;
    const dashLength = fraction * donutCircumference;
    const dashOffset = -cumulativeFraction * donutCircumference;
    cumulativeFraction += fraction;
    return {
      ...seg,
      fraction,
      percent: totalDistributedStudents > 0 ? Math.round(fraction * 100) : 0,
      dashLength,
      dashOffset,
    };
  });

  const hasActiveFilter = selectedGradeId !== null || selectedStageId !== null;

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Header + Interactive Filter Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3.5">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 font-display">
            لوحة المتابعة والإحصائيات الرئيسية
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
            نظرة شاملة ومباشرة على الطلبة، تسجيل الغياب، المراحل التنبيهية للعام الدراسي{' '}
            {stats?.active_academic_year?.name ? (
              <LtrSpan className="font-semibold text-teal-700 dark:text-teal-400">
                {academicYear(stats.active_academic_year.name)}
              </LtrSpan>
            ) : (
              '—'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
            <Filter className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            <span>تصفية العرض:</span>
          </div>

          <select
            aria-label="تصفية الإحصائيات حسب الصف"
            value={selectedGradeId ?? ''}
            onChange={(e) =>
              onFilterChange({
                gradeId: e.target.value ? Number(e.target.value) : null,
                stageId: selectedStageId,
              })
            }
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30 min-h-[36px]"
          >
            <option value="">جميع الصفوف الدراسية</option>
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>

          <select
            aria-label="تصفية الإحصائيات حسب مرحلة الغياب"
            value={selectedStageId ?? ''}
            onChange={(e) =>
              onFilterChange({
                gradeId: selectedGradeId,
                stageId: e.target.value ? Number(e.target.value) : null,
              })
            }
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30 min-h-[36px]"
          >
            <option value="">جميع مراحل الغياب</option>
            {stageCounts.map((s) => (
              <option key={s.stage_id} value={s.stage_id}>
                {s.stage_name} ({count(s.days_threshold)} يوم)
              </option>
            ))}
          </select>

          {hasActiveFilter && (
            <button
              type="button"
              onClick={() => onFilterChange({ gradeId: null, stageId: null })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors min-h-[36px]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>إعادة ضبط</span>
            </button>
          )}
        </div>
      </div>

      {/* 5 Colorful Gradient Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3.5 sm:gap-4">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-700 text-white p-4 sm:p-5 shadow-sm">
          <div className="absolute -left-5 -bottom-5 w-24 h-24 rounded-full bg-white/10 pointer-events-none" />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-emerald-50">إجمالي الطلاب</span>
            <span className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4 text-white" />
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold mt-3 tabular-nums font-display">
            {count(totalStudents)}
          </p>
          <p className="text-[11px] text-emerald-100 mt-1.5">
            {selectedStageId
              ? 'الطلاب ضمن المرحلة المحددة'
              : selectedGradeId
                ? 'الطلبة الفعالون في الصف المحدد'
                : 'الطلبة الفعالون في السنة الحالية'}
          </p>
        </div>

        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-700 text-white p-4 sm:p-5 shadow-sm">
          <div className="absolute -left-5 -bottom-5 w-24 h-24 rounded-full bg-white/10 pointer-events-none" />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-blue-50">الصفوف الدراسية</span>
            <span className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <Layers className="w-4 h-4 text-white" />
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold mt-3 tabular-nums font-display">
            {count(totalGrades)}
          </p>
          <p className="text-[11px] text-blue-100 mt-1.5">الصفوف المعرفة في النظام</p>
        </div>

        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 via-orange-600 to-rose-600 text-white p-4 sm:p-5 shadow-sm">
          <div className="absolute -left-5 -bottom-5 w-24 h-24 rounded-full bg-white/10 pointer-events-none" />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-amber-50">الشعب الدراسية</span>
            <span className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <FolderKanban className="w-4 h-4 text-white" />
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold mt-3 tabular-nums font-display">
            {count(totalSections)}
          </p>
          <p className="text-[11px] text-amber-100 mt-1.5">موزعة على جميع الصفوف</p>
        </div>

        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-sky-600 via-cyan-600 to-teal-700 text-white p-4 sm:p-5 shadow-sm">
          <div className="absolute -left-5 -bottom-5 w-24 h-24 rounded-full bg-white/10 pointer-events-none" />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-sky-50">أيام تسجيل الغياب</span>
            <span className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <CalendarDays className="w-4 h-4 text-white" />
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold mt-3 tabular-nums font-display">
            {count(absenceDaysCount)}
          </p>
          <p className="text-[11px] text-sky-100 mt-1.5">
            {absenceDaysCount === 0 ? 'لم تسجل أيام غياب حتى الآن' : 'أيام دوام موثقة في السجل'}
          </p>
        </div>

        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-rose-600 via-pink-600 to-fuchsia-700 text-white p-4 sm:p-5 shadow-sm">
          <div className="absolute -left-5 -bottom-5 w-24 h-24 rounded-full bg-white/10 pointer-events-none" />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-rose-50">الطلبة ذوو الغياب</span>
            <span className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <UserCheck className="w-4 h-4 text-white" />
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold mt-3 tabular-nums font-display">
            {count(studentsWithAbsences)}
          </p>
          <p className="text-[11px] text-rose-100 mt-1.5">
            لديهم غياب يومي أو دروس مسجلة
          </p>
        </div>
      </div>

      {/* Dynamic Absence Stages Strip */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3.5">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 font-display">
              توزيع الطلبة على مراحل الغياب المعتمدة
            </h3>
          </div>
          {onNavigateSection && (
            <button
              type="button"
              onClick={() => onNavigateSection('reports')}
              className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline"
            >
              فتح مركز التقارير والكتب الرسمية ←
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <button
            type="button"
            onClick={() =>
              onFilterChange({ gradeId: selectedGradeId, stageId: null })
            }
            className={`text-right rounded-xl border p-3.5 transition-all ${
              selectedStageId === null
                ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/70 dark:bg-emerald-950/30'
                : 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/40 dark:bg-emerald-950/20 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 truncate">
                ضمن الحد المسموح
              </span>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
            </div>
            <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2 tabular-nums font-display">
              {count(withinLimitCount)}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">طالب</p>
          </button>

          {stageCounts.map((stage, idx) => {
            const style = STAGE_ACCENT_STYLES[idx % STAGE_ACCENT_STYLES.length];
            const isSelected = selectedStageId === stage.stage_id;
            return (
              <button
                key={stage.stage_id}
                type="button"
                onClick={() =>
                  onFilterChange({
                    gradeId: selectedGradeId,
                    stageId: isSelected ? null : stage.stage_id,
                  })
                }
                className={`text-right rounded-xl border p-3.5 transition-all ${style.border} ${
                  isSelected ? style.activeBg : `${style.bg} hover:opacity-90`
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-xs font-bold truncate ${style.text}`}>
                    {stage.stage_name}
                  </span>
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: style.dot }}
                  />
                </div>
                <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2 tabular-nums font-display">
                  {count(stage.students_count)}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                  من {count(stage.days_threshold)} يوم فأكثر
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Interactive Real-Data Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-stretch">
        {/* Monthly Absences Bar Chart */}
        <section className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                مؤشر الغيابات الشهري خلال السنة الدراسية
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600 dark:text-slate-300">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" />
                غياب يوم كامل
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-violet-500" />
                أيام محوّلة من الدروس
              </span>
            </div>
          </div>

          <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between">
            {monthlyAbsences.length === 0 ? (
              <div className="flex-1 min-h-[210px] flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6">
                <BarChart3 className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  لا توجد بيانات غياب شهرية لعرضها
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  سيظهر الرسم البياني تلقائياً فور تسجيل حالات الغياب في السجل اليومي.
                </p>
              </div>
            ) : (
              <>
                <div className="relative flex items-end gap-2 sm:gap-3 h-52 pt-7 pb-2 px-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
                  {monthlyAbsences.map((point) => {
                    const total = point.total_absence_days;
                    const fullPct = Math.round((point.full_day_count / maxMonthlyValue) * 100);
                    const convPct = Math.round((point.converted_day_count / maxMonthlyValue) * 100);
                    const totalPct = Math.max(total > 0 ? 6 : 0, Math.min(100, fullPct + convPct));

                    return (
                      <div
                        key={point.month_key}
                        onMouseEnter={() => setHoveredMonth(point)}
                        onMouseLeave={() => setHoveredMonth(null)}
                        className="flex-1 min-w-[54px] flex flex-col items-center h-full justify-end group cursor-default"
                      >
                        <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 tabular-nums mb-1">
                          {count(total)}
                        </span>
                        <div
                          className="w-full max-w-[44px] rounded-t-lg overflow-hidden flex flex-col justify-end bg-slate-100 dark:bg-slate-800 transition-transform group-hover:scale-[1.03]"
                          style={{ height: `${totalPct}%` }}
                          title={`${point.label}: ${total} يوم (${point.full_day_count} مباشر، ${point.converted_day_count} محوّل)`}
                        >
                          {point.converted_day_count > 0 && (
                            <div
                              className="w-full bg-violet-500 dark:bg-violet-400"
                              style={{
                                height: `${
                                  total > 0 ? (point.converted_day_count / total) * 100 : 0
                                }%`,
                              }}
                            />
                          )}
                          {point.full_day_count > 0 && (
                            <div
                              className="w-full bg-rose-500 dark:bg-rose-400"
                              style={{
                                height: `${
                                  total > 0 ? (point.full_day_count / total) * 100 : 0
                                }%`,
                              }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Month X-axis labels */}
                <div className="flex items-start gap-2 sm:gap-3 pt-2 px-1 overflow-x-auto">
                  {monthlyAbsences.map((point) => (
                    <div
                      key={point.month_key}
                      className="flex-1 min-w-[54px] text-center text-[11px] font-medium text-slate-600 dark:text-slate-400 leading-tight"
                    >
                      {point.label}
                    </div>
                  ))}
                </div>

                {/* Live Hover Detail Bar */}
                <div className="mt-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2">
                  {hoveredMonth ? (
                    <>
                      <span className="font-bold text-slate-800 dark:text-slate-100">
                        {hoveredMonth.label}:
                      </span>
                      <div className="flex flex-wrap items-center gap-3 text-slate-600 dark:text-slate-300 tabular-nums">
                        <span>إجمالي: {count(hoveredMonth.total_absence_days)} يوم</span>
                        <span>مباشر: {count(hoveredMonth.full_day_count)}</span>
                        <span>محوّل: {count(hoveredMonth.converted_day_count)}</span>
                        <span>إجازات: {count(hoveredMonth.leave_count)}</span>
                        <span>طلبة متأثرون: {count(hoveredMonth.affected_students_count)}</span>
                      </div>
                    </>
                  ) : (
                    <span className="text-slate-500 dark:text-slate-400">
                      مرر المؤشر فوق أي عمود شهري لعرض تفاصيل الغياب المباشر والمحوّل وعدد الطلبة.
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </section>

        {/* Stage Distribution Donut Chart */}
        <section className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
            <PieChart className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
              توزيع الطلبة حسب حالة الغياب
            </h3>
          </div>

          <div className="p-4 sm:p-5 flex-1 flex flex-col justify-center">
            {totalDistributedStudents === 0 ? (
              <div className="flex-1 min-h-[210px] flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6">
                <PieChart className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  لا يوجد طلاب في النطاق المحدد
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  أضف طلاباً أو عدّل الفلاتر لعرض نسب توزيع مراحل الغياب.
                </p>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row lg:flex-col xl:flex-row items-center gap-5">
                <div className="relative w-44 h-44 shrink-0">
                  <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
                    <circle
                      cx="80"
                      cy="80"
                      r={donutRadius}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="22"
                      className="text-slate-100 dark:text-slate-800"
                    />
                    {donutArcs.map(
                      (arc, idx) =>
                        arc.dashLength > 0 && (
                          <circle
                            key={arc.id}
                            cx="80"
                            cy="80"
                            r={donutRadius}
                            fill="none"
                            stroke={arc.color}
                            strokeWidth={hoveredSliceIndex === idx ? 26 : 22}
                            strokeDasharray={`${arc.dashLength} ${donutCircumference}`}
                            strokeDashoffset={arc.dashOffset}
                            onMouseEnter={() => setHoveredSliceIndex(idx)}
                            onMouseLeave={() => setHoveredSliceIndex(null)}
                            className="transition-all duration-200 cursor-pointer"
                          />
                        )
                    )}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-4">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {hoveredSliceIndex !== null
                        ? donutArcs[hoveredSliceIndex]?.label
                        : 'إجمالي الطلبة'}
                    </span>
                    <span className="text-xl font-bold text-slate-900 dark:text-slate-100 tabular-nums font-display mt-0.5">
                      {hoveredSliceIndex !== null
                        ? count(donutArcs[hoveredSliceIndex]?.count ?? 0)
                        : count(totalDistributedStudents)}
                    </span>
                    {hoveredSliceIndex !== null && (
                      <span className="text-[11px] font-bold text-teal-700 dark:text-teal-400 tabular-nums">
                        {count(donutArcs[hoveredSliceIndex]?.percent ?? 0)}%
                      </span>
                    )}
                  </div>
                </div>

                <ul className="flex-1 w-full space-y-2 text-xs">
                  {donutArcs.map((arc, idx) => (
                    <li
                      key={arc.id}
                      onMouseEnter={() => setHoveredSliceIndex(idx)}
                      onMouseLeave={() => setHoveredSliceIndex(null)}
                      className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg transition-colors ${
                        hoveredSliceIndex === idx
                          ? 'bg-slate-100 dark:bg-slate-800'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: arc.color }}
                        />
                        <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">
                          {arc.label}
                        </span>
                      </span>
                      <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums whitespace-nowrap">
                        {count(arc.count)} ({count(arc.percent)}%)
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Bottom Row: Summary Info & Categorized Administrative Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-start">
        {/* Summary Card */}
        <section className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2.5">
            <Info className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
              ملخص الدوام اليومي والمعلومات
            </h3>
          </div>

          <dl className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
            <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400 font-medium">
                السنة الدراسية الحالية
              </dt>
              <dd className="font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {stats?.active_academic_year?.name ? (
                  <LtrSpan>{academicYear(stats.active_academic_year.name)}</LtrSpan>
                ) : (
                  'غير محددة'
                )}
              </dd>
            </div>

            <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-4">
              <dt className="text-slate-500 dark:text-slate-400 font-medium">
                آخر تاريخ تسجيل غياب
              </dt>
              <dd className="font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                {stats?.last_absence_date ? (
                  <LtrSpan>{dateDMY(stats.last_absence_date)}</LtrSpan>
                ) : (
                  'لا توجد سجلات غياب بعد'
                )}
              </dd>
            </div>

            <div className="px-4 sm:px-5 py-3.5 space-y-2">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500 dark:text-slate-400 font-medium">
                  حالة اكتمال تسجيل الغياب اليوم
                </dt>
                <dd className="font-bold text-slate-900 dark:text-slate-100">{completion.label}</dd>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    completion.percent === 100
                      ? 'bg-emerald-500'
                      : completion.percent > 0
                        ? 'bg-amber-500'
                        : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                  style={{ width: `${completion.percent}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums leading-relaxed">
                {completion.detail}
              </p>
            </div>
          </dl>
        </section>

        {/* Administrative & Threshold Alerts */}
        <section className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              {structuralAlerts.length > 0 ||
              approachingStudents.length > 0 ||
              exceededStudents.length > 0 ? (
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              )}
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                التنبيهات الإدارية ومتابعة مراحل الغياب
              </h3>
            </div>
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            {structuralAlerts.length === 0 &&
            approachingStudents.length === 0 &&
            exceededStudents.length === 0 ? (
              <div className="flex items-start gap-3 text-sm text-emerald-800 dark:text-emerald-300">
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <p className="font-semibold">جميع المؤشرات مستقرة ولا توجد تنبيهات</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    البيانات الأساسية مكتملة ولا يوجد طلبة مقتربون أو متجاوزون لمراحل الغياب في
                    النطاق الحالي.
                  </p>
                </div>
              </div>
            ) : (
              <>
                {exceededStudents.length > 0 && (
                  <div className="rounded-xl border border-rose-200 dark:border-rose-800/70 bg-rose-50/70 dark:bg-rose-950/25 p-3.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-800 dark:text-rose-300">
                        <ShieldAlert className="w-4 h-4" />
                        طلبة وصلوا إلى مراحل الغياب ({count(exceededStudents.length)})
                      </span>
                      {onNavigateSection && (
                        <button
                          type="button"
                          onClick={() => onNavigateSection('reports')}
                          className="text-[11px] font-bold text-rose-700 dark:text-rose-300 hover:underline"
                        >
                          إصدار كتاب رسمي ←
                        </button>
                      )}
                    </div>
                    <div className="divide-y divide-rose-200/70 dark:divide-rose-800/50 max-h-40 overflow-y-auto">
                      {exceededStudents.slice(0, 6).map((st) => (
                        <div
                          key={st.student_id}
                          className="py-1.5 flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                            {st.full_name}{' '}
                            <span className="text-slate-500 dark:text-slate-400 font-normal">
                              ({st.grade_name} / {st.section_name})
                            </span>
                          </span>
                          <span className="font-bold text-rose-700 dark:text-rose-300 tabular-nums whitespace-nowrap">
                            {st.stage_name} · {count(st.counted_days)} يوم
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {approachingStudents.length > 0 && (
                  <div className="rounded-xl border border-amber-200 dark:border-amber-800/70 bg-amber-50/70 dark:bg-amber-950/25 p-3.5 space-y-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="w-4 h-4" />
                      طلبة قريبون من عتبة المرحلة التالية ({count(approachingStudents.length)})
                    </span>
                    <div className="divide-y divide-amber-200/70 dark:divide-amber-800/50 max-h-40 overflow-y-auto">
                      {approachingStudents.slice(0, 6).map((st) => (
                        <div
                          key={st.student_id}
                          className="py-1.5 flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                            {st.full_name}{' '}
                            <span className="text-slate-500 dark:text-slate-400 font-normal">
                              ({st.grade_name} / {st.section_name})
                            </span>
                          </span>
                          <span className="font-bold text-amber-800 dark:text-amber-300 tabular-nums whitespace-nowrap">
                            متبقي {count(st.remaining_days)} يوم لـ {st.next_stage_name}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {structuralAlerts.length > 0 && (
                  <ul className="space-y-2 text-xs sm:text-sm pt-1">
                    {structuralAlerts.map((alertMsg, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2.5 text-slate-700 dark:text-slate-200 leading-relaxed"
                      >
                        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <span>{alertMsg}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
