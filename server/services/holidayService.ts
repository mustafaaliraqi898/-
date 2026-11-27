import type {
  CreateHolidayInput,
  ExistingRecordsWarning,
  HolidayCategory,
  HolidayCheckResult,
  HolidayRecord,
  HolidayType,
  MonthCalendarDay,
  SaveHolidayResult,
  UpdateWeeklyHolidaysInput,
  UpdateWeeklyHolidaysResult,
  WeeklyHolidayDay,
  WeeklyHolidaySettings,
} from '../../src/types/school';
import type { SqliteDb } from '../db/connection';
import { ServiceError, normalizeNullableString, normalizeWhitespace } from '../utils/validation';
import { recordAuditLog } from './auditLogService';

const ARABIC_DAY_NAMES = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;

const VALID_HOLIDAY_TYPES: ReadonlySet<string> = new Set([
  'official',
  'exceptional',
  'school_specific',
]);

export function validateIsoDateStrict(rawDate: string | undefined, label = 'التاريخ'): string {
  const dateStr = (rawDate ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    throw new ServiceError(`صيغة ${label} غير صالحة. يجب أن تكون بصيغة YYYY-MM-DD.`, 400);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() + 1 !== month ||
    d.getUTCDate() !== day
  ) {
    throw new ServiceError(`${label} المدخل غير صالح في التقويم.`, 400);
  }
  return dateStr;
}

export function getDayOfWeekUtc(dateIso: string): number {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sunday .. 6=Saturday
}

export function getArabicDayName(dayOfWeek: number): string {
  return ARABIC_DAY_NAMES[dayOfWeek] ?? '';
}

function calculateDaysCount(startDate: string, endDate: string): number {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

function formatHolidayRow(row: {
  id: number;
  academic_year_id: number | null;
  academic_year_name?: string | null;
  name: string;
  start_date: string;
  end_date: string;
  holiday_type: HolidayType;
  notes: string | null;
  created_at: string;
  updated_at: string;
}): HolidayRecord {
  return {
    ...row,
    days_count: calculateDaysCount(row.start_date, row.end_date),
  };
}

function buildRangeExistingRecordsWarning(
  db: SqliteDb,
  startDate: string,
  endDate: string
): ExistingRecordsWarning | null {
  const countRow = db
    .prepare(
      `SELECT COUNT(*) as records_count, COUNT(DISTINCT absence_date) as dates_count
       FROM absences
       WHERE absence_date >= ? AND absence_date <= ?`
    )
    .get(startDate, endDate) as { records_count: number; dates_count: number };

  if (!countRow || countRow.records_count === 0) {
    return null;
  }

  const dateRows = db
    .prepare(
      `SELECT DISTINCT absence_date
       FROM absences
       WHERE absence_date >= ? AND absence_date <= ?
       ORDER BY absence_date ASC
       LIMIT 10`
    )
    .all(startDate, endDate) as Array<{ absence_date: string }>;

  const dates = dateRows.map((r) => r.absence_date);
  return {
    has_existing_records: true,
    records_count: countRow.records_count,
    dates_count: countRow.dates_count,
    dates,
    message: `تنبيه: توجد ${countRow.records_count} سجلات حضور/غياب مسجلة مسبقاً في ${countRow.dates_count} يوم ضمن فترة هذه العطلة (${dates.join('، ')}). لم يتم تعديل أو حذف السجلات القديمة تلقائياً؛ يرجى مراجعتها من قسم تسجيل الغيابات عند الحاجة.`,
  };
}

function buildWeeklyExistingRecordsWarning(
  db: SqliteDb,
  newlyAddedWeekdays: number[]
): ExistingRecordsWarning | null {
  if (newlyAddedWeekdays.length === 0) return null;

  const placeholders = newlyAddedWeekdays.map(() => '?').join(',');
  const countRow = db
    .prepare(
      `SELECT COUNT(*) as records_count, COUNT(DISTINCT absence_date) as dates_count
       FROM absences
       WHERE CAST(strftime('%w', absence_date) AS INTEGER) IN (${placeholders})`
    )
    .get(...newlyAddedWeekdays) as { records_count: number; dates_count: number };

  if (!countRow || countRow.records_count === 0) {
    return null;
  }

  const dateRows = db
    .prepare(
      `SELECT DISTINCT absence_date
       FROM absences
       WHERE CAST(strftime('%w', absence_date) AS INTEGER) IN (${placeholders})
       ORDER BY absence_date DESC
       LIMIT 10`
    )
    .all(...newlyAddedWeekdays) as Array<{ absence_date: string }>;

  const dates = dateRows.map((r) => r.absence_date);
  return {
    has_existing_records: true,
    records_count: countRow.records_count,
    dates_count: countRow.dates_count,
    dates,
    message: `تنبيه: توجد ${countRow.records_count} سجلات حضور/غياب قديمة مسجلة في الأيام التي تم تحويلها إلى عطلة أسبوعية (${dates.join('، ')}). لم يتم تعديل السجلات السابقة تلقائياً حفاظاً على التاريخ الدراسي.`,
  };
}

export function getWeeklyHolidaySettings(db: SqliteDb): WeeklyHolidaySettings {
  const settingsRow = db
    .prepare('SELECT weekly_holiday_reason FROM school_settings WHERE id = 1')
    .get() as { weekly_holiday_reason?: string } | undefined;

  const days = db
    .prepare(
      'SELECT day_of_week, day_name, is_holiday, updated_at FROM weekly_holidays ORDER BY day_of_week ASC'
    )
    .all() as WeeklyHolidayDay[];

  return {
    reason: settingsRow?.weekly_holiday_reason || 'عطلة أسبوعية رسمية',
    days,
  };
}

export function updateWeeklyHolidays(
  db: SqliteDb,
  input: UpdateWeeklyHolidaysInput
): UpdateWeeklyHolidaysResult {
  if (!Array.isArray(input.holiday_days)) {
    throw new ServiceError('صيغة أيام العطلة الأسبوعية غير صالحة.', 400);
  }

  const daySet = new Set<number>();
  for (const raw of input.holiday_days) {
    const num = Number(raw);
    if (!Number.isInteger(num) || num < 0 || num > 6) {
      throw new ServiceError('رقم يوم الأسبوع يجب أن يكون بين 0 (الأحد) و 6 (السبت).', 400);
    }
    daySet.add(num);
  }

  if (daySet.size === 7) {
    throw new ServiceError('لا يمكن تحديد جميع أيام الأسبوع السبعة كعطلة رسمية.', 400);
  }

  const reason = normalizeWhitespace(input.reason ?? '') || 'عطلة أسبوعية رسمية';

  const currentWeekly = getWeeklyHolidaySettings(db);
  const previousHolidaySet = new Set(
    currentWeekly.days.filter((d) => d.is_holiday === 1).map((d) => d.day_of_week)
  );
  const newlyAddedWeekdays = Array.from(daySet).filter((d) => !previousHolidaySet.has(d));

  const warning = buildWeeklyExistingRecordsWarning(db, newlyAddedWeekdays);

  db.transaction(() => {
    const updateDay = db.prepare(
      "UPDATE weekly_holidays SET is_holiday = ?, updated_at = datetime('now') WHERE day_of_week = ?"
    );
    for (let dow = 0; dow <= 6; dow += 1) {
      updateDay.run(daySet.has(dow) ? 1 : 0, dow);
    }

    db.prepare(
      "UPDATE school_settings SET weekly_holiday_reason = ?, updated_at = datetime('now') WHERE id = 1"
    ).run(reason);

    const updatedWeekly = getWeeklyHolidaySettings(db);
    recordAuditLog(db, {
      operation_type: 'update',
      section: 'holidays',
      description: 'تحديث إعدادات العطل الأسبوعية',
      target_id: 'weekly_holidays',
      target_label: 'العطل الأسبوعية',
      old_value: {
        reason: currentWeekly.reason,
        days: currentWeekly.days.filter((d) => d.is_holiday === 1).map((d) => d.day_name),
      },
      new_value: {
        reason: updatedWeekly.reason,
        days: updatedWeekly.days.filter((d) => d.is_holiday === 1).map((d) => d.day_name),
      },
    });
  })();

  return {
    settings: getWeeklyHolidaySettings(db),
    existing_records_warning: warning,
  };
}

export function listHolidays(db: SqliteDb, academicYearId?: number): HolidayRecord[] {
  const baseQuery = `
    SELECT h.id, h.academic_year_id, ay.name as academic_year_name,
           h.name, h.start_date, h.end_date, h.holiday_type, h.notes,
           h.created_at, h.updated_at
    FROM holidays h
    LEFT JOIN academic_years ay ON ay.id = h.academic_year_id
  `;

  const rows = academicYearId
    ? (db
        .prepare(
          `${baseQuery}
           WHERE h.academic_year_id = ? OR h.academic_year_id IS NULL
           ORDER BY h.start_date DESC, h.id DESC`
        )
        .all(academicYearId) as Array<Omit<HolidayRecord, 'days_count'>>)
    : (db
        .prepare(`${baseQuery} ORDER BY h.start_date DESC, h.id DESC`)
        .all() as Array<Omit<HolidayRecord, 'days_count'>>);

  return rows.map(formatHolidayRow);
}

function validateAndCheckOverlap(
  db: SqliteDb,
  input: CreateHolidayInput,
  excludeId?: number
): {
  academic_year_id: number | null;
  name: string;
  start_date: string;
  end_date: string;
  holiday_type: HolidayType;
  notes: string | null;
} {
  const name = normalizeWhitespace(input.name ?? '');
  if (!name) {
    throw new ServiceError('اسم العطلة أو سببها حقل إلزامي.', 400);
  }

  const startDate = validateIsoDateStrict(input.start_date, 'تاريخ بداية العطلة');
  const endDate = validateIsoDateStrict(input.end_date, 'تاريخ نهاية العطلة');

  if (endDate < startDate) {
    throw new ServiceError('تاريخ نهاية العطلة يجب أن يكون مساوياً لتاريخ البداية أو بعده.', 400);
  }

  const holidayType = input.holiday_type;
  if (!VALID_HOLIDAY_TYPES.has(holidayType)) {
    throw new ServiceError('نوع العطلة المختار غير صالح.', 400);
  }

  let yearId: number | null = input.academic_year_id ?? null;
  if (yearId !== null && yearId !== undefined) {
    const yr = db.prepare('SELECT id FROM academic_years WHERE id = ?').get(yearId) as
      | { id: number }
      | undefined;
    if (!yr) {
      throw new ServiceError('السنة الدراسية المحددة غير موجودة.', 404, 'YEAR_NOT_FOUND');
    }
    yearId = yr.id;
  } else {
    const activeYr = db
      .prepare('SELECT academic_year_id FROM school_settings WHERE id = 1')
      .get() as { academic_year_id: number | null } | undefined;
    yearId = activeYr?.academic_year_id ?? null;
  }

  const overlapQuery = excludeId
    ? `SELECT id, name, start_date, end_date
       FROM holidays
       WHERE id != ? AND start_date <= ? AND end_date >= ?
       LIMIT 1`
    : `SELECT id, name, start_date, end_date
       FROM holidays
       WHERE start_date <= ? AND end_date >= ?
       LIMIT 1`;

  const conflict = (excludeId
    ? db.prepare(overlapQuery).get(excludeId, endDate, startDate)
    : db.prepare(overlapQuery).get(endDate, startDate)) as
    | { id: number; name: string; start_date: string; end_date: string }
    | undefined;

  if (conflict) {
    throw new ServiceError(
      `تتعارض فترة هذه العطلة مع عطلة مسجلة مسبقاً: "${conflict.name}" (${conflict.start_date} إلى ${conflict.end_date}). يرجى تعديل التواريخ أو تعديل العطلة القائمة.`,
      409,
      'HOLIDAY_OVERLAP'
    );
  }

  return {
    academic_year_id: yearId,
    name,
    start_date: startDate,
    end_date: endDate,
    holiday_type: holidayType,
    notes: normalizeNullableString(input.notes),
  };
}

function getHolidayById(db: SqliteDb, id: number): HolidayRecord {
  const row = db
    .prepare(
      `SELECT h.id, h.academic_year_id, ay.name as academic_year_name,
              h.name, h.start_date, h.end_date, h.holiday_type, h.notes,
              h.created_at, h.updated_at
       FROM holidays h
       LEFT JOIN academic_years ay ON ay.id = h.academic_year_id
       WHERE h.id = ?`
    )
    .get(id) as Omit<HolidayRecord, 'days_count'> | undefined;

  if (!row) {
    throw new ServiceError('العطلة المطلوبة غير موجودة.', 404, 'HOLIDAY_NOT_FOUND');
  }
  return formatHolidayRow(row);
}

export function createHoliday(db: SqliteDb, input: CreateHolidayInput): SaveHolidayResult {
  const clean = validateAndCheckOverlap(db, input);
  const warning = buildRangeExistingRecordsWarning(db, clean.start_date, clean.end_date);

  const holidayId = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO holidays
           (academic_year_id, name, start_date, end_date, holiday_type, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      )
      .run(
        clean.academic_year_id,
        clean.name,
        clean.start_date,
        clean.end_date,
        clean.holiday_type,
        clean.notes
      );
    const id = Number(info.lastInsertRowid);
    recordAuditLog(db, {
      operation_type: 'create',
      section: 'holidays',
      description: `إضافة عطلة: ${clean.name} (${clean.start_date} إلى ${clean.end_date})`,
      target_id: id,
      target_label: clean.name,
      new_value: clean,
    });
    return id;
  })();

  const holiday = getHolidayById(db, holidayId);
  return {
    holiday,
    existing_records_warning: warning,
  };
}

export function updateHoliday(
  db: SqliteDb,
  holidayId: number,
  input: CreateHolidayInput
): SaveHolidayResult {
  const before = getHolidayById(db, holidayId); // verify existence
  const clean = validateAndCheckOverlap(db, input, holidayId);
  const warning = buildRangeExistingRecordsWarning(db, clean.start_date, clean.end_date);

  db.transaction(() => {
    db.prepare(
      `UPDATE holidays
       SET academic_year_id = ?,
           name = ?,
           start_date = ?,
           end_date = ?,
           holiday_type = ?,
           notes = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      clean.academic_year_id,
      clean.name,
      clean.start_date,
      clean.end_date,
      clean.holiday_type,
      clean.notes,
      holidayId
    );
    recordAuditLog(db, {
      operation_type: 'update',
      section: 'holidays',
      description: `تعديل العطلة: ${clean.name} (${clean.start_date} إلى ${clean.end_date})`,
      target_id: holidayId,
      target_label: clean.name,
      old_value: {
        name: before.name,
        start_date: before.start_date,
        end_date: before.end_date,
        holiday_type: before.holiday_type,
        notes: before.notes,
      },
      new_value: clean,
    });
  })();

  const holiday = getHolidayById(db, holidayId);
  return {
    holiday,
    existing_records_warning: warning,
  };
}

export function deleteHoliday(db: SqliteDb, holidayId: number): void {
  const existing = db
    .prepare('SELECT id, name, start_date, end_date, holiday_type FROM holidays WHERE id = ?')
    .get(holidayId) as
    | { id: number; name: string; start_date: string; end_date: string; holiday_type: string }
    | undefined;
  if (!existing) {
    throw new ServiceError('العطلة المطلوبة غير موجودة.', 404, 'HOLIDAY_NOT_FOUND');
  }
  db.transaction(() => {
    db.prepare('DELETE FROM holidays WHERE id = ?').run(holidayId);
    recordAuditLog(db, {
      operation_type: 'delete',
      section: 'holidays',
      description: `حذف العطلة: ${existing.name} (${existing.start_date} إلى ${existing.end_date})`,
      target_id: holidayId,
      target_label: existing.name,
      old_value: existing,
    });
  })();
}

export function resolveDateHolidayStatus(db: SqliteDb, rawDate: string): HolidayCheckResult {
  const dateIso = validateIsoDateStrict(rawDate, 'التاريخ');
  const dayOfWeek = getDayOfWeekUtc(dateIso);
  const dayName = getArabicDayName(dayOfWeek);

  const weekly = getWeeklyHolidaySettings(db);
  const weeklyEntry = weekly.days.find((d) => d.day_of_week === dayOfWeek);
  const isWeeklyHoliday = weeklyEntry?.is_holiday === 1;

  const matchingRows = db
    .prepare(
      `SELECT h.id, h.academic_year_id, ay.name as academic_year_name,
              h.name, h.start_date, h.end_date, h.holiday_type, h.notes,
              h.created_at, h.updated_at
       FROM holidays h
       LEFT JOIN academic_years ay ON ay.id = h.academic_year_id
       WHERE h.start_date <= ? AND h.end_date >= ?
       ORDER BY h.id ASC`
    )
    .all(dateIso, dateIso) as Array<Omit<HolidayRecord, 'days_count'>>;

  const matchingHolidays = matchingRows.map(formatHolidayRow);
  const isSpecial = matchingHolidays.length > 0;
  const isHoliday = isWeeklyHoliday || isSpecial;

  let holidayCategory: HolidayCategory = 'workday';
  let primaryReason: string | null = null;

  if (isSpecial) {
    holidayCategory = matchingHolidays[0].holiday_type;
    primaryReason = matchingHolidays.map((h) => h.name).join(' / ');
  } else if (isWeeklyHoliday) {
    holidayCategory = 'weekly';
    primaryReason = weekly.reason;
  }

  return {
    date: dateIso,
    day_of_week: dayOfWeek,
    day_name: dayName,
    is_holiday: isHoliday,
    is_weekly_holiday: isWeeklyHoliday,
    is_official_or_special_holiday: isSpecial,
    holiday_category: holidayCategory,
    primary_reason: primaryReason,
    weekly_reason: isWeeklyHoliday ? weekly.reason : null,
    matching_holidays: matchingHolidays,
  };
}

/**
 * Future Monthly Register preparation API:
 * Returns every calendar day of (year, month) with explicit differentiation between
 * working days, weekly holidays, official holidays, exceptional holidays, and school-specific holidays.
 */
export function getMonthHolidayCalendar(
  db: SqliteDb,
  year: number,
  month: number
): MonthCalendarDay[] {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new ServiceError('السنة المطلوبة غير صالحة.', 400);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new ServiceError('الشهر المطلوب غير صالح (1-12).', 400);
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthPadded = String(month).padStart(2, '0');
  const monthStart = `${year}-${monthPadded}-01`;
  const monthEnd = `${year}-${monthPadded}-${String(daysInMonth).padStart(2, '0')}`;

  const weekly = getWeeklyHolidaySettings(db);
  const weeklyMap = new Map<number, boolean>();
  for (const d of weekly.days) {
    weeklyMap.set(d.day_of_week, d.is_holiday === 1);
  }

  const monthHolidayRows = db
    .prepare(
      `SELECT h.id, h.academic_year_id, ay.name as academic_year_name,
              h.name, h.start_date, h.end_date, h.holiday_type, h.notes,
              h.created_at, h.updated_at
       FROM holidays h
       LEFT JOIN academic_years ay ON ay.id = h.academic_year_id
       WHERE h.start_date <= ? AND h.end_date >= ?
       ORDER BY h.start_date ASC, h.id ASC`
    )
    .all(monthEnd, monthStart) as Array<Omit<HolidayRecord, 'days_count'>>;

  const formattedHolidays = monthHolidayRows.map(formatHolidayRow);
  const result: MonthCalendarDay[] = [];

  for (let dayNum = 1; dayNum <= daysInMonth; dayNum += 1) {
    const dayPadded = String(dayNum).padStart(2, '0');
    const dateIso = `${year}-${monthPadded}-${dayPadded}`;
    const dow = getDayOfWeekUtc(dateIso);
    const dayName = getArabicDayName(dow);
    const isWeekly = weeklyMap.get(dow) ?? false;
    const dayHolidays = formattedHolidays.filter(
      (h) => h.start_date <= dateIso && h.end_date >= dateIso
    );
    const isSpecial = dayHolidays.length > 0;
    const isHoliday = isWeekly || isSpecial;

    let category: HolidayCategory = 'workday';
    let reason: string | null = null;
    if (isSpecial) {
      category = dayHolidays[0].holiday_type;
      reason = dayHolidays.map((h) => h.name).join(' / ');
    } else if (isWeekly) {
      category = 'weekly';
      reason = weekly.reason;
    }

    result.push({
      date: dateIso,
      day_of_month: dayNum,
      day_of_week: dow,
      day_name: dayName,
      is_holiday: isHoliday,
      is_weekly_holiday: isWeekly,
      is_official_or_special_holiday: isSpecial,
      holiday_category: category,
      reason,
      weekly_reason: isWeekly ? weekly.reason : null,
      holidays: dayHolidays,
      counts_as_school_day: !isHoliday,
    });
  }

  return result;
}
