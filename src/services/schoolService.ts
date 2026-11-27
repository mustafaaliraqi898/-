import type {
  AbsenceReportsQuery,
  AbsenceReportsResponse,
  AbsenceStage,
  AbsenceThresholdsSettings,
  AcademicYear,
  AuditLogListResponse,
  AuditLogQuery,
  BackupOverviewResponse,
  BackupSettings,
  CreateBackupResult,
  CreateHolidayInput,
  CreateStudentInput,
  DashboardStats,
  DynamicStageReportResponse,
  EducationalStage,
  ExcelCommitResult,
  ExcelImportRowInput,
  ExcelValidationResult,
  GradeWithSections,
  HolidayCheckResult,
  HolidayRecord,
  ImageCategory,
  IssuedOfficialLetter,
  LessonDetailInput,
  MediaAssetInfo,
  MonthCalendarDay,
  MonthlyRegisterData,
  MonthlyRegisterQuery,
  NumberDisplayMode,
  RestoreBackupResult,
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
  UpdateAbsenceThresholdsInput,
  UpdateBackupSettingsInput,
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
    principal_name?: string | null;
    lessons_per_absence_day?: number;
    daily_lessons_count?: number;
    daily_permission_counts_as_absence?: number;
    lesson_permission_counts_as_absence?: number;
    number_display_mode?: NumberDisplayMode;
    unified_letter_template?: string;
    school_logo_data?: string | null;
    school_logo_asset_id?: number | null;
  }): Promise<SchoolSettings> {
    if (isElectronMode()) return ipcCall<SchoolSettings>('settings:update', payload);
    return httpJson<SchoolSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async updateUnifiedLetterTemplate(
    unified_letter_template: string
  ): Promise<{ unified_letter_template: string }> {
    if (isElectronMode()) {
      return ipcCall<{ unified_letter_template: string }>(
        'settings:update-unified-letter-template',
        { unified_letter_template }
      );
    }
    return httpJson<{ unified_letter_template: string }>(
      '/api/settings/unified-letter-template',
      {
        method: 'PUT',
        body: JSON.stringify({ unified_letter_template }),
      }
    );
  },

  // Centralized Image Processing & Storage Service
  async uploadImage(file: File, category: ImageCategory = 'general'): Promise<MediaAssetInfo> {
    if (isElectronMode()) {
      const arrayBuf = await file.arrayBuffer();
      return ipcCall<MediaAssetInfo>('media:upload', {
        bytes: new Uint8Array(arrayBuf),
        filename: file.name,
        category,
        mimeHint: file.type || null,
      });
    }

    const res = await fetch('/api/media/upload', {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Image-Filename': encodeURIComponent(file.name || 'image'),
        'X-Image-Category': category,
        'X-Image-Mime': file.type || '',
      },
      body: file,
    });

    const text = await res.text();
    let parsed: { error?: string } | MediaAssetInfo | null = null;
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
        'تعذر معالجة الصورة أو رفعها إلى الخادم.';
      throw new Error(String(errMsg));
    }

    return parsed as MediaAssetInfo;
  },

  async getMediaMeta(assetId: number): Promise<MediaAssetInfo> {
    if (isElectronMode()) {
      return ipcCall<MediaAssetInfo>('media:meta', { id: assetId });
    }
    return httpJson<MediaAssetInfo>(`/api/media/${assetId}/meta`);
  },

  async getMediaCompatDataUrl(assetId: number): Promise<string> {
    if (isElectronMode()) {
      return ipcCall<string>('media:compat-data-url', { id: assetId });
    }
    const res = await httpJson<{ data_url: string }>(`/api/media/${assetId}/compat-data-url`);
    return res.data_url;
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
  async getDashboardStats(
    academicYearId?: number,
    filters?: { grade_id?: number; stage_id?: number }
  ): Promise<DashboardStats> {
    if (isElectronMode()) {
      return ipcCall<DashboardStats>('dashboard:stats', {
        academic_year_id: academicYearId,
        grade_id: filters?.grade_id,
        stage_id: filters?.stage_id,
      });
    }
    const qs = new URLSearchParams();
    if (academicYearId) qs.set('academic_year_id', String(academicYearId));
    if (filters?.grade_id) qs.set('grade_id', String(filters.grade_id));
    if (filters?.stage_id) qs.set('stage_id', String(filters.stage_id));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return httpJson<DashboardStats>(`/api/dashboard${suffix}`);
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
    stage?: EducationalStage | null;
    initial_sections?: string[];
  }): Promise<GradeWithSections> {
    if (isElectronMode()) return ipcCall<GradeWithSections>('grades:create', payload);
    return httpJson<GradeWithSections>('/api/grades', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateGrade(
    id: number,
    name: string,
    stage?: EducationalStage | null
  ): Promise<GradeWithSections> {
    if (isElectronMode()) return ipcCall<GradeWithSections>('grades:update', { id, name, stage });
    return httpJson<GradeWithSections>(`/api/grades/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, stage }),
    });
  },

  async updateGradeStage(
    id: number,
    stage: EducationalStage | null
  ): Promise<GradeWithSections> {
    if (isElectronMode()) {
      return ipcCall<GradeWithSections>('grades:update-stage', { id, stage });
    }
    return httpJson<GradeWithSections>(`/api/grades/${id}/stage`, {
      method: 'PATCH',
      body: JSON.stringify({ stage }),
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

  async addStudentLessonRecords(input: {
    student_id: number;
    academic_year_id?: number;
    absence_date: string;
    lesson_details: LessonDetailInput[];
    notes?: string | null;
  }): Promise<Record<string, unknown>> {
    if (isElectronMode()) {
      return ipcCall<Record<string, unknown>>('absences:add-lessons', input);
    }
    return httpJson<Record<string, unknown>>('/api/absences/lessons', {
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

  // Simplified Absence Thresholds & Effective Limit (Preparatory)
  async getAbsenceThresholds(academicYearId?: number): Promise<AbsenceThresholdsSettings> {
    if (isElectronMode()) {
      return ipcCall<AbsenceThresholdsSettings>('thresholds:get', {
        academic_year_id: academicYearId,
      });
    }
    const qs = academicYearId ? `?academic_year_id=${academicYearId}` : '';
    return httpJson<AbsenceThresholdsSettings>(`/api/absence-thresholds${qs}`);
  },

  async updateAbsenceThresholds(
    payload: UpdateAbsenceThresholdsInput
  ): Promise<AbsenceThresholdsSettings> {
    if (isElectronMode()) {
      return ipcCall<AbsenceThresholdsSettings>('thresholds:update', payload);
    }
    return httpJson<AbsenceThresholdsSettings>('/api/absence-thresholds', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  // Simplified 4 Absence Warning & Limit Reports
  async getAbsenceReports(
    query: AbsenceReportsQuery,
    options?: { signal?: AbortSignal }
  ): Promise<AbsenceReportsResponse> {
    if (isElectronMode()) {
      return ipcCall<AbsenceReportsResponse>('reports:absences', query);
    }
    const qs = new URLSearchParams({
      report_type: query.report_type,
    });
    if (query.academic_year_id) qs.set('academic_year_id', String(query.academic_year_id));
    if (query.grade_id) qs.set('grade_id', String(query.grade_id));
    if (query.section_id) qs.set('section_id', String(query.section_id));
    if (query.search) qs.set('search', query.search);
    return httpJson<AbsenceReportsResponse>(`/api/reports/absences?${qs.toString()}`, {
      signal: options?.signal,
    });
  },

  async exportAbsenceReportsExcel(query: AbsenceReportsQuery): Promise<void> {
    if (isElectronMode()) {
      const result = await ipcCall<{ base64: string; filename: string }>(
        'reports:absences-export',
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
      report_type: query.report_type,
    });
    if (query.academic_year_id) qs.set('academic_year_id', String(query.academic_year_id));
    if (query.grade_id) qs.set('grade_id', String(query.grade_id));
    if (query.section_id) qs.set('section_id', String(query.section_id));
    if (query.search) qs.set('search', query.search);

    const res = await fetch(`/api/reports/absences/export?${qs.toString()}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'تعذر تصدير التقرير إلى ملف Excel.');
    }
    const blob = await res.blob();
    triggerBlobDownload(blob, `تقرير_${query.report_type}.xlsx`);
  },

  async listAbsenceStages(academicYearId?: number): Promise<AbsenceStage[]> {
    if (isElectronMode()) {
      return ipcCall<AbsenceStage[]>('absence-stages:list', { academic_year_id: academicYearId });
    }
    const qs = academicYearId ? `?academic_year_id=${academicYearId}` : '';
    return httpJson<AbsenceStage[]>(`/api/absence-stages${qs}`);
  },

  async createAbsenceStage(input: {
    academic_year_id: number;
    name: string;
    days_threshold: number;
    letter_template?: string;
    sort_order?: number;
  }): Promise<AbsenceStage> {
    if (isElectronMode()) {
      return ipcCall<AbsenceStage>('absence-stages:create', input);
    }
    return httpJson<AbsenceStage>('/api/absence-stages', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async updateAbsenceStage(
    id: number,
    input: { name: string; days_threshold: number; letter_template?: string }
  ): Promise<AbsenceStage> {
    if (isElectronMode()) {
      return ipcCall<AbsenceStage>('absence-stages:update', { id, ...input });
    }
    return httpJson<AbsenceStage>(`/api/absence-stages/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },

  async deleteAbsenceStage(id: number): Promise<{ deleted: true }> {
    if (isElectronMode()) {
      return ipcCall<{ deleted: true }>('absence-stages:delete', { id });
    }
    return httpJson<{ deleted: true }>(`/api/absence-stages/${id}`, {
      method: 'DELETE',
    });
  },

  async getDynamicStageReport(query: {
    academic_year_id?: number;
    stage_id?: number;
    grade_id?: number;
    section_id?: number;
    search?: string;
  }): Promise<DynamicStageReportResponse> {
    if (isElectronMode()) {
      return ipcCall<DynamicStageReportResponse>('absence-stages:report', query);
    }
    const qs = new URLSearchParams();
    if (query.academic_year_id) qs.set('academic_year_id', String(query.academic_year_id));
    if (query.stage_id) qs.set('stage_id', String(query.stage_id));
    if (query.grade_id) qs.set('grade_id', String(query.grade_id));
    if (query.section_id) qs.set('section_id', String(query.section_id));
    if (query.search) qs.set('search', query.search);
    return httpJson<DynamicStageReportResponse>(`/api/absence-stages/report?${qs.toString()}`);
  },

  async issueOfficialLetter(input: {
    academic_year_id: number;
    stage_id: number;
    document_number: string;
    letter_date: string;
    subject?: string;
    custom_body?: string;
    grade_id?: number;
    section_id?: number;
    search?: string;
  }): Promise<IssuedOfficialLetter> {
    if (isElectronMode()) {
      return ipcCall<IssuedOfficialLetter>('absence-stages:issue-letter', input);
    }
    return httpJson<IssuedOfficialLetter>('/api/absence-stages/issue-letter', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async listIssuedLetters(academicYearId: number): Promise<IssuedOfficialLetter[]> {
    if (isElectronMode()) {
      return ipcCall<IssuedOfficialLetter[]>('absence-stages:issued-letters', { academic_year_id: academicYearId });
    }
    return httpJson<IssuedOfficialLetter[]>(`/api/absence-stages/issued-letters?academic_year_id=${academicYearId}`);
  },

  async exportStageReportPdf(query: {
    academic_year_id?: number;
    stage_id?: number;
    grade_id?: number;
    section_id?: number;
    search?: string;
  }): Promise<void> {
    if (isElectronMode()) {
      const result = await ipcCall<{ base64: string; filename: string }>(
        'absence-stages:report-pdf',
        query
      );
      const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/pdf' });
      triggerBlobDownload(blob, result.filename);
      return;
    }

    const qs = new URLSearchParams();
    if (query.academic_year_id) qs.set('academic_year_id', String(query.academic_year_id));
    if (query.stage_id) qs.set('stage_id', String(query.stage_id));
    if (query.grade_id) qs.set('grade_id', String(query.grade_id));
    if (query.section_id) qs.set('section_id', String(query.section_id));
    if (query.search) qs.set('search', query.search);

    const res = await fetch(`/api/absence-stages/report/pdf?${qs.toString()}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'تعذر تصدير التقرير إلى ملف PDF.');
    }
    const blob = await res.blob();
    triggerBlobDownload(blob, 'تقرير_الغياب.pdf');
  },

  async exportIssuedLetterPdf(letterId: number, documentNumber?: string): Promise<void> {
    if (isElectronMode()) {
      const result = await ipcCall<{ base64: string; filename: string }>(
        'absence-stages:letter-pdf',
        { letter_id: letterId }
      );
      const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/pdf' });
      triggerBlobDownload(blob, result.filename);
      return;
    }

    const res = await fetch(`/api/absence-stages/issued-letters/${letterId}/pdf`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'تعذر تصدير الكتاب الرسمي إلى ملف PDF.');
    }
    const blob = await res.blob();
    const safeDoc = (documentNumber || String(letterId)).replace(/[/\\:*?"<>|]+/g, '_');
    triggerBlobDownload(blob, `كتاب_رسمي_${safeDoc}.pdf`);
  },

  // Backup & Restore
  isElectron(): boolean {
    return isElectronMode();
  },

  async getBackupOverview(): Promise<BackupOverviewResponse> {
    if (isElectronMode()) {
      return ipcCall<BackupOverviewResponse>('backup:overview');
    }
    return httpJson<BackupOverviewResponse>('/api/backup/overview');
  },

  async updateBackupSettings(payload: UpdateBackupSettingsInput): Promise<BackupSettings> {
    if (isElectronMode()) {
      return ipcCall<BackupSettings>('backup:update-settings', payload);
    }
    return httpJson<BackupSettings>('/api/backup/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async createManagedBackup(): Promise<CreateBackupResult> {
    if (isElectronMode()) {
      return ipcCall<CreateBackupResult>('backup:create');
    }
    return httpJson<CreateBackupResult>('/api/backup/create', {
      method: 'POST',
    });
  },

  async runAutoBackup(force = false): Promise<{
    executed: boolean;
    result: CreateBackupResult | null;
    overview: BackupOverviewResponse;
  }> {
    if (isElectronMode()) {
      return ipcCall('backup:run-auto', { force });
    }
    return httpJson('/api/backup/run-auto', {
      method: 'POST',
      body: JSON.stringify({ force }),
    });
  },

  async downloadBackupRecord(recordId: number, fallbackFilename: string): Promise<void> {
    if (isElectronMode()) {
      const result = await ipcCall<{ base64: string; filename: string }>(
        'backup:download-record',
        { id: recordId }
      );
      const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
      triggerBlobDownload(blob, result.filename || fallbackFilename);
      return;
    }

    const res = await fetch(`/api/backup/records/${recordId}/download`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'تعذر تنزيل ملف النسخة الاحتياطية.');
    }
    const blob = await res.blob();
    triggerBlobDownload(blob, fallbackFilename);
  },

  async pickBackupDirectory(defaultPath?: string): Promise<{
    supported: boolean;
    canceled: boolean;
    path: string | null;
  }> {
    if (!isElectronMode()) {
      return { supported: false, canceled: true, path: null };
    }
    const res = await ipcCall<{ canceled: boolean; path: string | null }>(
      'backup:pick-directory',
      { defaultPath }
    );
    return { supported: true, ...res };
  },

  async exportManualBackupToUserChoice(): Promise<{
    canceled: boolean;
    filename: string;
    file_path?: string;
    method: 'electron-dialog' | 'file-picker' | 'download';
  }> {
    if (isElectronMode()) {
      const res = await ipcCall<{
        canceled: boolean;
        file_path?: string;
        filename?: string;
      }>('backup:save-manual-dialog');
      if (res.canceled) {
        return { canceled: true, filename: '', method: 'electron-dialog' };
      }
      return {
        canceled: false,
        filename: res.filename || 'backup.db',
        file_path: res.file_path,
        method: 'electron-dialog',
      };
    }

    const res = await fetch('/api/backup/export');
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'تعذر تصدير النسخة الاحتياطية.');
    }

    const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
    let filename = `نسخة_احتياطية_نظام_الغيابات_${stamp}.db`;
    const disp = res.headers.get('content-disposition');
    const utf8Match = disp?.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      try {
        filename = decodeURIComponent(utf8Match[1]);
      } catch {
        // keep default filename
      }
    }

    const blob = await res.blob();

    const savePicker = (
      window as unknown as {
        showSaveFilePicker?: (opts: {
          suggestedName: string;
          types?: Array<{ description: string; accept: Record<string, string[]> }>;
        }) => Promise<{
          createWritable(): Promise<{
            write(data: Blob): Promise<void>;
            close(): Promise<void>;
          }>;
        }>;
      }
    ).showSaveFilePicker;

    if (typeof savePicker === 'function') {
      try {
        const handle = await savePicker({
          suggestedName: filename,
          types: [
            {
              description: 'SQLite Database Backup',
              accept: { 'application/x-sqlite3': ['.db'] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return { canceled: false, filename, method: 'file-picker' };
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return { canceled: true, filename, method: 'file-picker' };
        }
        // Cross-origin iframe or SecurityError falls back cleanly to standard download
      }
    }

    triggerBlobDownload(blob, filename);
    return { canceled: false, filename, method: 'download' };
  },

  async restoreDatabaseBackup(file: File): Promise<RestoreBackupResult> {
    if (isElectronMode()) {
      const arrayBuf = await file.arrayBuffer();
      return ipcCall<RestoreBackupResult>('backup:restore', {
        bytes: new Uint8Array(arrayBuf),
      });
    }

    const res = await fetch('/api/backup/restore', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: file,
    });

    const text = await res.text();
    let parsed: { error?: string } | RestoreBackupResult | null = null;
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
        'فشل استعادة النسخة الاحتياطية. لم تتأثر البيانات الحالية.';
      throw new Error(String(errMsg));
    }

    return parsed as RestoreBackupResult;
  },

  // Audit Log (Read-Only)
  async listAuditLogs(query: AuditLogQuery = {}): Promise<AuditLogListResponse> {
    if (isElectronMode()) {
      return ipcCall<AuditLogListResponse>('audit-logs:list', query);
    }
    const qs = new URLSearchParams();
    if (query.operation_type && query.operation_type !== 'all') {
      qs.set('operation_type', query.operation_type);
    }
    if (query.section && query.section !== 'all') {
      qs.set('section', query.section);
    }
    if (query.actor_name && query.actor_name !== 'all') {
      qs.set('actor_name', query.actor_name);
    }
    if (query.date_from) qs.set('date_from', query.date_from);
    if (query.date_to) qs.set('date_to', query.date_to);
    if (query.search) qs.set('search', query.search);
    if (query.limit) qs.set('limit', String(query.limit));
    if (query.offset !== undefined) qs.set('offset', String(query.offset));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return httpJson<AuditLogListResponse>(`/api/audit-logs${suffix}`);
  },

  async exportAuditLogsExcel(query: AuditLogQuery = {}): Promise<void> {
    if (isElectronMode()) {
      const result = await ipcCall<{ base64: string; filename: string }>(
        'audit-logs:export',
        query
      );
      const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      triggerBlobDownload(blob, result.filename);
      return;
    }

    const qs = new URLSearchParams();
    if (query.operation_type && query.operation_type !== 'all') {
      qs.set('operation_type', query.operation_type);
    }
    if (query.section && query.section !== 'all') {
      qs.set('section', query.section);
    }
    if (query.actor_name && query.actor_name !== 'all') {
      qs.set('actor_name', query.actor_name);
    }
    if (query.date_from) qs.set('date_from', query.date_from);
    if (query.date_to) qs.set('date_to', query.date_to);
    if (query.search) qs.set('search', query.search);

    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const res = await fetch(`/api/audit-logs/export${suffix}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'تعذر تصدير سجل العمليات إلى ملف Excel.');
    }
    const blob = await res.blob();
    const stamp = new Date().toISOString().slice(0, 10);
    triggerBlobDownload(blob, `سجل_العمليات_والتعديلات_${stamp}.xlsx`);
  },
};

