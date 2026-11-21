import type {
  AcademicYear,
  CreateHolidayInput,
  CreateStudentInput,
  DashboardStats,
  ExcelCommitResult,
  ExcelImportRowInput,
  ExcelValidationResult,
  GradeWithSections,
  HolidayCheckResult,
  HolidayRecord,
  MonthCalendarDay,
  MonthlyRegisterData,
  MonthlyRegisterQuery,
  SaveHolidayResult,
  SaveMonthlyNoteInput,
  SaveSectionAttendanceInput,
  SaveSectionAttendanceResult,
  SchoolSettings,
  SectionAttendanceSheet,
  SectionItem,
  StudentAbsenceDetailResponse,
  StudentEnrollmentHistoryItem,
  StudentListQuery,
  StudentRecord,
  TransferStudentInput,
  UpdateStudentInput,
  UpdateWeeklyHolidaysInput,
  UpdateWeeklyHolidaysResult,
  WeeklyHolidaySettings,
} from '../types/school';

interface ElectronBridge {
  isElectron?: boolean;
  invoke: <T>(
    channel: string,
    payload?: unknown
  ) => Promise<{ ok: boolean; data?: T; error?: string }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronBridge;
  }
}

function isElectronMode(): boolean {
  return Boolean(typeof window !== 'undefined' && window.electronAPI?.isElectron);
}

async function ipcCall<T>(channel: string, payload?: unknown): Promise<T> {
  const api = window.electronAPI;
  if (!api) {
    throw new Error('واجهة Electron غير متوفرة.');
  }
  const result = await api.invoke<T>(channel, payload);
  if (!result.ok) {
    throw new Error(result.error || 'تعذر إتمام العملية.');
  }
  return result.data as T;
}

async function httpJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });

  const text = await res.text();
  let parsed: { error?: string } | T | null = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const errMsg =
      (parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error) ||
      'تعذر إتمام الطلب من الخادم.';
    throw new Error(String(errMsg));
  }

  return parsed as T;
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const schoolService = {
  // Settings & Academic Years
  async getSettings(): Promise<SchoolSettings> {
    if (isElectronMode()) return ipcCall<SchoolSettings>('settings:get');
    return httpJson<SchoolSettings>('/api/settings');
  },

  async updateSettings(payload: {
    school_name: string;
    directorate_name: string;
    lessons_per_absence_day?: number;
    daily_lessons_count?: number;
    daily_permission_counts_as_absence?: number;
    lesson_permission_counts_as_absence?: number;
  }): Promise<SchoolSettings> {
    if (isElectronMode()) return ipcCall<SchoolSettings>('settings:update', payload);
    return httpJson<SchoolSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async listAcademicYears(): Promise<AcademicYear[]> {
    if (isElectronMode()) return ipcCall<AcademicYear[]>('academic-years:list');
    return httpJson<AcademicYear[]>('/api/academic-years');
  },

  async createAcademicYear(payload: {
    name: string;
    set_active?: boolean;
  }): Promise<AcademicYear> {
    if (isElectronMode()) return ipcCall<AcademicYear>('academic-years:create', payload);
    return httpJson<AcademicYear>('/api/academic-years', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async activateAcademicYear(id: number): Promise<AcademicYear> {
    if (isElectronMode()) return ipcCall<AcademicYear>('academic-years:activate', { id });
    return httpJson<AcademicYear>(`/api/academic-years/${id}/activate`, {
      method: 'POST',
    });
  },

  // Dashboard
  async getDashboardStats(academicYearId?: number): Promise<DashboardStats> {
    if (isElectronMode()) {
      return ipcCall<DashboardStats>('dashboard:stats', { academic_year_id: academicYearId });
    }
    const qs = academicYearId ? `?academic_year_id=${academicYearId}` : '';
    return httpJson<DashboardStats>(`/api/dashboard${qs}`);
  },

  // Grades & Sections
  async listGrades(academicYearId?: number): Promise<GradeWithSections[]> {
    if (isElectronMode()) {
      return ipcCall<GradeWithSections[]>('grades:list', { academic_year_id: academicYearId });
    }
    const qs = academicYearId ? `?academic_year_id=${academicYearId}` : '';
    return httpJson<GradeWithSections[]>(`/api/grades${qs}`);
  },

  async createGrade(payload: {
    name: string;
    initial_sections?: string[];
  }): Promise<GradeWithSections> {
    if (isElectronMode()) return ipcCall<GradeWithSections>('grades:create', payload);
    return httpJson<GradeWithSections>('/api/grades', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateGrade(id: number, name: string): Promise<GradeWithSections> {
    if (isElectronMode()) return ipcCall<GradeWithSections>('grades:update', { id, name });
    return httpJson<GradeWithSections>(`/api/grades/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
  },

  async deleteGrade(id: number): Promise<void> {
    if (isElectronMode()) {
      await ipcCall('grades:delete', { id });
      return;
    }
    await httpJson(`/api/grades/${id}`, { method: 'DELETE' });
  },

  async createSections(
    gradeId: number,
    names: string[],
    capacity?: number | null
  ): Promise<SectionItem[]> {
    if (isElectronMode()) {
      return ipcCall<SectionItem[]>('sections:create', {
        grade_id: gradeId,
        names,
        capacity: capacity ?? null,
      });
    }
    return httpJson<SectionItem[]>(`/api/grades/${gradeId}/sections`, {
      method: 'POST',
      body: JSON.stringify({ names, capacity: capacity ?? null }),
    });
  },

  async updateSection(
    sectionId: number,
    name: string,
    capacity?: number | null
  ): Promise<SectionItem> {
    if (isElectronMode()) {
      return ipcCall<SectionItem>('sections:update', {
        id: sectionId,
        name,
        capacity: capacity ?? null,
      });
    }
    return httpJson<SectionItem>(`/api/sections/${sectionId}`, {
      method: 'PUT',
      body: JSON.stringify({ name, capacity: capacity ?? null }),
    });
  },

  async deleteSection(sectionId: number): Promise<void> {
    if (isElectronMode()) {
      await ipcCall('sections:delete', { id: sectionId });
      return;
    }
    await httpJson(`/api/sections/${sectionId}`, { method: 'DELETE' });
  },

  // Students
  async listStudents(query: StudentListQuery = {}): Promise<StudentRecord[]> {
    if (isElectronMode()) return ipcCall<StudentRecord[]>('students:list', query);

    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.grade_id) params.set('grade_id', String(query.grade_id));
    if (query.section_id) params.set('section_id', String(query.section_id));
    if (query.academic_year_id) params.set('academic_year_id', String(query.academic_year_id));
    if (query.status) params.set('status', query.status);
    if (query.sort_by) params.set('sort_by', query.sort_by);
    if (query.sort_dir) params.set('sort_dir', query.sort_dir);

    const qs = params.toString();
    return httpJson<StudentRecord[]>(`/api/students${qs ? `?${qs}` : ''}`);
  },

  async createStudent(input: CreateStudentInput): Promise<StudentRecord> {
    if (isElectronMode()) return ipcCall<StudentRecord>('students:create', input);
    return httpJson<StudentRecord>('/api/students', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async updateStudent(id: number, input: UpdateStudentInput): Promise<StudentRecord> {
    if (isElectronMode()) return ipcCall<StudentRecord>('students:update', { id, ...input });
    return httpJson<StudentRecord>(`/api/students/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  async transferStudent(id: number, input: TransferStudentInput): Promise<StudentRecord> {
    if (isElectronMode()) return ipcCall<StudentRecord>('students:transfer', { id, ...input });
    return httpJson<StudentRecord>(`/api/students/${id}/transfer`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async getStudentHistory(id: number): Promise<StudentEnrollmentHistoryItem[]> {
    if (isElectronMode()) {
      return ipcCall<StudentEnrollmentHistoryItem[]>('students:history', { id });
    }
    return httpJson<StudentEnrollmentHistoryItem[]>(`/api/students/${id}/history`);
  },

  async deleteStudent(id: number): Promise<void> {
    if (isElectronMode()) {
      await ipcCall('students:delete', { id });
      return;
    }
    await httpJson(`/api/students/${id}`, { method: 'DELETE' });
  },

  // Excel Unified Template & Bulk Import
  async downloadExcelTemplate(academicYearId?: number): Promise<void> {
    if (isElectronMode()) {
      const base64 = await ipcCall<string>('excel:template', {
        academic_year_id: academicYearId,
      });
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      triggerBlobDownload(blob, 'قالب_استيراد_الطلاب_الموحد.xlsx');
      return;
    }

    const qs = academicYearId ? `?academic_year_id=${academicYearId}` : '';
    const res = await fetch(`/api/students/excel-template${qs}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'تعذر تنزيل قالب Excel الموحد.');
    }
    const blob = await res.blob();
    triggerBlobDownload(blob, 'قالب_استيراد_الطلاب_الموحد.xlsx');
  },

  async uploadAndValidateExcel(
    fileBase64: string,
    academicYearId?: number
  ): Promise<ExcelValidationResult> {
    if (isElectronMode()) {
      return ipcCall<ExcelValidationResult>('excel:upload', {
        fileBase64,
        academic_year_id: academicYearId,
      });
    }
    return httpJson<ExcelValidationResult>('/api/students/excel-upload', {
      method: 'POST',
      body: JSON.stringify({ fileBase64, academic_year_id: academicYearId }),
    });
  },

  async revalidateExcelRows(
    rows: ExcelImportRowInput[],
    academicYearId?: number
  ): Promise<ExcelValidationResult> {
    if (isElectronMode()) {
      return ipcCall<ExcelValidationResult>('excel:validate', {
        rows,
        academic_year_id: academicYearId,
      });
    }
    return httpJson<ExcelValidationResult>('/api/students/excel-validate', {
      method: 'POST',
      body: JSON.stringify({ rows, academic_year_id: academicYearId }),
    });
  },

  async commitExcelImport(
    rows: ExcelImportRowInput[],
    academicYearId?: number
  ): Promise<ExcelCommitResult> {
    if (isElectronMode()) {
      return ipcCall<ExcelCommitResult>('excel:commit', {
        rows,
        academic_year_id: academicYearId,
      });
    }
    return httpJson<ExcelCommitResult>('/api/students/excel-commit', {
      method: 'POST',
      body: JSON.stringify({ rows, academic_year_id: academicYearId }),
    });
  },

  // Absences & Attendance Recording
  async getSectionAttendanceSheet(params: {
    academic_year_id?: number;
    grade_id: number;
    section_id: number;
    attendance_date: string;
  }): Promise<SectionAttendanceSheet> {
    if (isElectronMode()) {
      return ipcCall<SectionAttendanceSheet>('absences:sheet', params);
    }
    const qs = new URLSearchParams({
      grade_id: String(params.grade_id),
      section_id: String(params.section_id),
      attendance_date: params.attendance_date,
    });
    if (params.academic_year_id) {
      qs.set('academic_year_id', String(params.academic_year_id));
    }
    return httpJson<SectionAttendanceSheet>(`/api/absences/sheet?${qs.toString()}`);
  },

  async saveSectionAttendance(
    input: SaveSectionAttendanceInput
  ): Promise<SaveSectionAttendanceResult> {
    if (isElectronMode()) {
      return ipcCall<SaveSectionAttendanceResult>('absences:save-sheet', input);
    }
    return httpJson<SaveSectionAttendanceResult>('/api/absences/sheet', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async deleteAbsenceRecord(recordId: number): Promise<void> {
    if (isElectronMode()) {
      await ipcCall('absences:delete-record', { id: recordId });
      return;
    }
    await httpJson(`/api/absences/record/${recordId}`, { method: 'DELETE' });
  },

  async getStudentAbsenceDetails(
    studentId: number,
    academicYearId?: number
  ): Promise<StudentAbsenceDetailResponse> {
    if (isElectronMode()) {
      return ipcCall<StudentAbsenceDetailResponse>('absences:student-details', {
        id: studentId,
        academic_year_id: academicYearId,
      });
    }
    const qs = academicYearId ? `?academic_year_id=${academicYearId}` : '';
    return httpJson<StudentAbsenceDetailResponse>(`/api/absences/student/${studentId}${qs}`);
  },

  // Holidays & Weekly Holidays
  async getWeeklyHolidays(): Promise<WeeklyHolidaySettings> {
    if (isElectronMode()) return ipcCall<WeeklyHolidaySettings>('holidays:weekly-get');
    return httpJson<WeeklyHolidaySettings>('/api/holidays/weekly');
  },

  async updateWeeklyHolidays(
    payload: UpdateWeeklyHolidaysInput
  ): Promise<UpdateWeeklyHolidaysResult> {
    if (isElectronMode()) return ipcCall<UpdateWeeklyHolidaysResult>('holidays:weekly-update', payload);
    return httpJson<UpdateWeeklyHolidaysResult>('/api/holidays/weekly', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async checkDateHoliday(date: string): Promise<HolidayCheckResult> {
    if (isElectronMode()) return ipcCall<HolidayCheckResult>('holidays:check-date', { date });
    return httpJson<HolidayCheckResult>(`/api/holidays/check?date=${encodeURIComponent(date)}`);
  },

  async getMonthHolidayCalendar(year: number, month: number): Promise<MonthCalendarDay[]> {
    if (isElectronMode()) {
      return ipcCall<MonthCalendarDay[]>('holidays:month-calendar', { year, month });
    }
    return httpJson<MonthCalendarDay[]>(`/api/holidays/month?year=${year}&month=${month}`);
  },

  async listHolidays(academicYearId?: number): Promise<HolidayRecord[]> {
    if (isElectronMode()) {
      return ipcCall<HolidayRecord[]>('holidays:list', { academic_year_id: academicYearId });
    }
    const qs = academicYearId ? `?academic_year_id=${academicYearId}` : '';
    return httpJson<HolidayRecord[]>(`/api/holidays${qs}`);
  },

  async createHoliday(payload: CreateHolidayInput): Promise<SaveHolidayResult> {
    if (isElectronMode()) return ipcCall<SaveHolidayResult>('holidays:create', payload);
    return httpJson<SaveHolidayResult>('/api/holidays', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateHoliday(id: number, payload: CreateHolidayInput): Promise<SaveHolidayResult> {
    if (isElectronMode()) return ipcCall<SaveHolidayResult>('holidays:update', { id, ...payload });
    return httpJson<SaveHolidayResult>(`/api/holidays/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async deleteHoliday(id: number): Promise<void> {
    if (isElectronMode()) {
      await ipcCall('holidays:delete', { id });
      return;
    }
    await httpJson(`/api/holidays/${id}`, { method: 'DELETE' });
  },

  // Monthly Absence Register
  async getMonthlyRegister(query: MonthlyRegisterQuery): Promise<MonthlyRegisterData> {
    if (isElectronMode()) {
      return ipcCall<MonthlyRegisterData>('monthly:register', query);
    }
    const qs = new URLSearchParams({
      year: String(query.year),
      month: String(query.month),
      grade_id: String(query.grade_id),
      section_id: String(query.section_id),
    });
    if (query.academic_year_id) qs.set('academic_year_id', String(query.academic_year_id));
    if (query.search) qs.set('search', query.search);
    if (query.sort_mode) qs.set('sort_mode', query.sort_mode);
    return httpJson<MonthlyRegisterData>(`/api/monthly/register?${qs.toString()}`);
  },

  async saveMonthlyNote(
    input: SaveMonthlyNoteInput
  ): Promise<{ student_id: number; year: number; month: number; manual_note: string | null }> {
    if (isElectronMode()) {
      return ipcCall('monthly:save-note', input);
    }
    return httpJson('/api/monthly/note', {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  async deleteMonthlyNote(params: {
    academic_year_id: number;
    student_id: number;
    year: number;
    month: number;
  }): Promise<void> {
    if (isElectronMode()) {
      await ipcCall('monthly:delete-note', params);
      return;
    }
    const qs = new URLSearchParams({
      academic_year_id: String(params.academic_year_id),
      student_id: String(params.student_id),
      year: String(params.year),
      month: String(params.month),
    });
    await httpJson(`/api/monthly/note?${qs.toString()}`, { method: 'DELETE' });
  },

  async exportMonthlyExcel(query: MonthlyRegisterQuery): Promise<void> {
    if (isElectronMode()) {
      const result = await ipcCall<{ base64: string; filename: string }>(
        'monthly:export-excel',
        query
      );
      const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      triggerBlobDownload(blob, result.filename);
      return;
    }

    const qs = new URLSearchParams({
      year: String(query.year),
      month: String(query.month),
      grade_id: String(query.grade_id),
      section_id: String(query.section_id),
    });
    if (query.academic_year_id) qs.set('academic_year_id', String(query.academic_year_id));
    if (query.sort_mode) qs.set('sort_mode', query.sort_mode);

    const res = await fetch(`/api/monthly/export?${qs.toString()}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'تعذر تصدير السجل الشهري إلى ملف Excel.');
    }
    const blob = await res.blob();
    const fallbackName = `السجل_الشهري_${query.year}_${String(query.month).padStart(2, '0')}.xlsx`;
    triggerBlobDownload(blob, fallbackName);
  },
};
