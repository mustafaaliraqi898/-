/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { AbsencesView } from './components/absences/AbsencesView';
import { ToastContainer, type ToastItem, type ToastType } from './components/common/Toast';
import { DashboardView } from './components/dashboard/DashboardView';
import { GradesView } from './components/grades/GradesView';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { MonthlyRegisterView } from './components/monthly/MonthlyRegisterView';
import { ReportsCenterView } from './components/reports/ReportsCenterView';
import { SettingsView, type SettingsTabId } from './components/settings/SettingsView';
import { StudentsView } from './components/students/StudentsView';
import { schoolService } from './services/schoolService';
import type {
  AcademicYear,
  DashboardStats,
  GradeWithSections,
  NavSectionId,
  SchoolSettings,
  StudentRecord,
  StudentStatus,
} from './types/school';

const THEME_STORAGE_KEY = 'iraqi_school_absence_theme';

export default function App() {
  const [activeSection, setActiveSection] = useState<NavSectionId>('dashboard');
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('general');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY) === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
    } catch {
      // ignore storage errors
    }
  }, [isDark]);

  // Core data state
  const [settings, setSettings] = useState<SchoolSettings | null>(null);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [grades, setGrades] = useState<GradeWithSections[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [loadingCore, setLoadingCore] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);

  // Student filters & sorting
  const [search, setSearch] = useState('');
  const [filterGradeId, setFilterGradeId] = useState<number | null>(null);
  const [filterSectionId, setFilterSectionId] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<StudentStatus | 'all'>('active');
  const [sortBy, setSortBy] = useState<
    'full_name' | 'registry_number' | 'grade_name' | 'enrollment_date'
  >('full_name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Toasts
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const notify = useCallback((type: ToastType, message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const loadCoreMetadata = useCallback(async () => {
    try {
      const [settingsData, yearsData] = await Promise.all([
        schoolService.getSettings(),
        schoolService.listAcademicYears(),
      ]);
      setSettings(settingsData);
      setAcademicYears(yearsData);
      setSelectedYearId((prev) => {
        if (prev && yearsData.some((y) => y.id === prev)) return prev;
        return settingsData.academic_year_id ?? yearsData.find((y) => y.is_active === 1)?.id ?? null;
      });
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر تحميل إعدادات المدرسة.');
    }
  }, [notify]);

  const loadYearScopedData = useCallback(
    async (yearId: number | null) => {
      if (!yearId) return;
      setLoadingCore(true);
      try {
        const [statsData, gradesData] = await Promise.all([
          schoolService.getDashboardStats(yearId),
          schoolService.listGrades(yearId),
        ]);
        setDashboardStats(statsData);
        setGrades(gradesData);
      } catch (err) {
        notify('error', err instanceof Error ? err.message : 'تعذر تحميل البيانات الأساسية.');
      } finally {
        setLoadingCore(false);
      }
    },
    [notify]
  );

  const loadStudents = useCallback(async () => {
    if (!selectedYearId) return;
    setLoadingStudents(true);
    try {
      const list = await schoolService.listStudents({
        academic_year_id: selectedYearId,
        search: search || undefined,
        grade_id: filterGradeId,
        section_id: filterSectionId,
        status: filterStatus,
        sort_by: sortBy,
        sort_dir: sortDir,
      });
      setStudents(list);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر تحميل قائمة الطلاب.');
    } finally {
      setLoadingStudents(false);
    }
  }, [selectedYearId, search, filterGradeId, filterSectionId, filterStatus, sortBy, sortDir, notify]);

  useEffect(() => {
    void loadCoreMetadata();
  }, [loadCoreMetadata]);

  useEffect(() => {
    if (selectedYearId) {
      void loadYearScopedData(selectedYearId);
    }
  }, [selectedYearId, loadYearScopedData]);

  useEffect(() => {
    if (selectedYearId) {
      void loadStudents();
    }
  }, [selectedYearId, loadStudents]);

  const refreshAll = useCallback(async () => {
    await loadCoreMetadata();
    if (selectedYearId) {
      await Promise.all([loadYearScopedData(selectedYearId), loadStudents()]);
    }
  }, [loadCoreMetadata, loadYearScopedData, loadStudents, selectedYearId]);

  function handleSortChange(
    col: 'full_name' | 'registry_number' | 'grade_name' | 'enrollment_date'
  ) {
    if (sortBy === col) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  }

  return (
    <div className="no-print min-h-dvh flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <Sidebar
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        schoolName={settings?.school_name ?? 'المدرسة النموذجية'}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Header
          activeSection={activeSection}
          schoolName={settings?.school_name ?? 'المدرسة النموذجية'}
          academicYears={academicYears}
          selectedYearId={selectedYearId}
          onSelectYear={(yearId) => {
            setSelectedYearId(yearId);
            setFilterGradeId(null);
            setFilterSectionId(null);
          }}
          isDark={isDark}
          onToggleTheme={() => setIsDark((d) => !d)}
          mobileMenuOpen={mobileMenuOpen}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />

        <main className="flex-1 min-w-0 p-3.5 sm:p-5 lg:p-6 max-w-[1440px] w-full mx-auto">
          {activeSection === 'dashboard' && (
            <DashboardView stats={dashboardStats} loading={loadingCore} />
          )}

          {activeSection === 'grades' && (
            <GradesView
              grades={grades}
              loading={loadingCore}
              onRefresh={refreshAll}
              onNotify={notify}
            />
          )}

          {activeSection === 'students' && (
            <StudentsView
              students={students}
              grades={grades}
              academicYears={academicYears}
              selectedYearId={selectedYearId}
              loading={loadingStudents}
              search={search}
              filterGradeId={filterGradeId}
              filterSectionId={filterSectionId}
              filterStatus={filterStatus}
              sortBy={sortBy}
              sortDir={sortDir}
              onSearchChange={setSearch}
              onFilterGradeChange={setFilterGradeId}
              onFilterSectionChange={setFilterSectionId}
              onFilterStatusChange={setFilterStatus}
              onSortChange={handleSortChange}
              onRefresh={refreshAll}
              onNotify={notify}
            />
          )}

          {activeSection === 'absences' && (
            <AbsencesView
              grades={grades}
              academicYears={academicYears}
              selectedYearId={selectedYearId}
              onSelectYear={(yearId) => {
                setSelectedYearId(yearId);
                setFilterGradeId(null);
                setFilterSectionId(null);
              }}
              onRefreshGlobalStats={async () => {
                if (selectedYearId) {
                  await loadYearScopedData(selectedYearId);
                }
              }}
              onNotify={notify}
            />
          )}

          {activeSection === 'monthly' && (
            <MonthlyRegisterView
              grades={grades}
              academicYears={academicYears}
              selectedYearId={selectedYearId}
              onSelectYear={(yearId) => {
                setSelectedYearId(yearId);
                setFilterGradeId(null);
                setFilterSectionId(null);
              }}
              onNotify={notify}
            />
          )}

          {activeSection === 'reports' && (
            <ReportsCenterView
              grades={grades}
              academicYears={academicYears}
              selectedYearId={selectedYearId}
              onSelectYear={(yearId) => {
                setSelectedYearId(yearId);
                setFilterGradeId(null);
                setFilterSectionId(null);
              }}
              onRefreshCore={refreshAll}
              onOpenLegalSettings={() => {
                setSettingsTab('legal');
                setActiveSection('settings');
              }}
              onNotify={notify}
            />
          )}

          {activeSection === 'settings' && (
            <SettingsView
              settings={settings}
              academicYears={academicYears}
              grades={grades}
              selectedYearId={selectedYearId}
              initialTab={settingsTab}
              onRefresh={refreshAll}
              onNotify={notify}
            />
          )}
        </main>
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
