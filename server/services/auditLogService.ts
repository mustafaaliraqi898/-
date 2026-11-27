import ExcelJS from 'exceljs';
import type {
  AuditLogListResponse,
  AuditLogQuery,
  AuditLogRecord,
  AuditOperationType,
  AuditSectionType,
} from '../../src/types/school';
import type { SqliteDb } from '../db/connection';
import { normalizeWhitespace } from '../utils/validation';

export interface RecordAuditLogInput {
  operation_type: AuditOperationType;
  section: AuditSectionType;
  actor_name?: string | null;
  description: string;
  target_id?: string | number | null;
  target_label?: string | null;
  old_value?: unknown;
  new_value?: unknown;
}

const SENSITIVE_KEY_RE = /(password|secret|token|api[_-]?key|credential|auth)/i;

const OPERATION_LABELS: Record<AuditOperationType, string> = {
  create: 'إضافة',
  update: 'تعديل',
  delete: 'حذف',
  transfer: 'نقل طالب',
  import: 'استيراد بيانات',
  issue_letter: 'إصدار كتاب رسمي',
  backup: 'نسخ احتياطي',
  restore: 'استعادة نسخة',
};

const SECTION_LABELS: Record<AuditSectionType, string> = {
  students: 'الطلاب',
  absences: 'الغيابات والسجل الشهري',
  holidays: 'العطل الرسمية والأسبوعية',
  grades: 'الصفوف والشعب',
  stages: 'مراحل الغياب',
  letters: 'الكتب الرسمية',
  settings: 'إعدادات المدرسة',
  backup: 'النسخ الاحتياطي والاستعادة',
};

function sanitizeAuditPayload(value: unknown, depth = 0): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (depth > 4) return '[بيانات متداخلة]';

  if (typeof value === 'string') {
    if (value.startsWith('data:image/') || value.startsWith('data:application/')) {
      return `[ملف مرفق - ${value.length} حرف]`;
    }
    if (value.length > 1500) {
      return `${value.slice(0, 1500)}... [مختصر]`;
    }
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    const sliced = value.slice(0, 50).map((item) => sanitizeAuditPayload(item, depth + 1));
    if (value.length > 50) {
      sliced.push(`... (+${value.length - 50} عنصر إضافي)`);
    }
    return sliced;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = '[محجوب]';
        continue;
      }
      if ((k === 'photo_data' || k === 'school_logo_data') && typeof v === 'string' && v.startsWith('data:')) {
        out[k] = '[صورة مرفقة]';
        continue;
      }
      out[k] = sanitizeAuditPayload(v, depth + 1);
    }
    return out;
  }

  return String(value);
}

function serializeAuditJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const sanitized = sanitizeAuditPayload(value);
  if (sanitized === undefined || sanitized === null) return null;
  return JSON.stringify(sanitized);
}

export function recordAuditLog(db: SqliteDb, entry: RecordAuditLogInput): number {
  const actorName = normalizeWhitespace(entry.actor_name ?? '') || 'إدارة المدرسة';
  const description = normalizeWhitespace(entry.description);
  const targetId =
    entry.target_id !== undefined && entry.target_id !== null ? String(entry.target_id) : null;
  const targetLabel =
    entry.target_label !== undefined && entry.target_label !== null
      ? normalizeWhitespace(String(entry.target_label))
      : null;

  const oldJson = serializeAuditJson(entry.old_value);
  const newJson = serializeAuditJson(entry.new_value);

  const info = db
    .prepare(
      `INSERT INTO audit_logs (
         operation_type, section, actor_name, description,
         target_id, target_label, old_value_json, new_value_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(
      entry.operation_type,
      entry.section,
      actorName,
      description,
      targetId,
      targetLabel,
      oldJson,
      newJson
    );

  return Number(info.lastInsertRowid);
}

export function listAuditLogs(db: SqliteDb, query: AuditLogQuery = {}): AuditLogListResponse {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (query.operation_type && query.operation_type !== 'all') {
    conditions.push('operation_type = ?');
    params.push(query.operation_type);
  }

  if (query.section && query.section !== 'all') {
    conditions.push('section = ?');
    params.push(query.section);
  }

  const actor = normalizeWhitespace(query.actor_name);
  if (actor && actor !== 'all') {
    conditions.push('actor_name = ?');
    params.push(actor);
  }

  const dateFrom = (query.date_from ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
    conditions.push('date(created_at) >= ?');
    params.push(dateFrom);
  }

  const dateTo = (query.date_to ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    conditions.push('date(created_at) <= ?');
    params.push(dateTo);
  }

  const search = normalizeWhitespace(query.search);
  if (search) {
    conditions.push(
      '(description LIKE ? OR COALESCE(target_label, \'\') LIKE ? OR COALESCE(target_id, \'\') LIKE ? OR actor_name LIKE ?)'
    );
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(500, Number(query.limit) || 100));
  const offset = Math.max(0, Number(query.offset) || 0);

  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM audit_logs ${whereClause}`)
    .get(...params) as { total: number };

  const items = db
    .prepare(
      `SELECT id, operation_type, section, actor_name, description,
              target_id, target_label, old_value_json, new_value_json, created_at
       FROM audit_logs
       ${whereClause}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as AuditLogRecord[];

  const actorRows = db
    .prepare('SELECT DISTINCT actor_name FROM audit_logs ORDER BY actor_name ASC')
    .all() as Array<{ actor_name: string }>;

  return {
    total: countRow.total,
    items,
    actors: actorRows.map((r) => r.actor_name),
  };
}

function formatJsonForExcel(rawJson: string | null): string {
  if (!rawJson) return '—';
  try {
    const parsed = JSON.parse(rawJson);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return rawJson;
  }
}

export async function generateAuditLogsExcel(
  db: SqliteDb,
  query: AuditLogQuery = {}
): Promise<{ buffer: Buffer; filename: string }> {
  const result = listAuditLogs(db, {
    ...query,
    limit: 5000,
    offset: 0,
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'نظام إدارة الغيابات المدرسية الإلكتروني';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('سجل العمليات والتعديلات', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = [
    { header: 'رقم العملية', key: 'id', width: 14 },
    { header: 'التاريخ والوقت', key: 'created_at', width: 22 },
    { header: 'نوع العملية', key: 'operation_type', width: 18 },
    { header: 'القسم', key: 'section', width: 24 },
    { header: 'المنفذ', key: 'actor_name', width: 20 },
    { header: 'العنصر المستهدف', key: 'target_label', width: 26 },
    { header: 'الوصف', key: 'description', width: 46 },
    { header: 'القيم القديمة', key: 'old_value', width: 38 },
    { header: 'القيم الجديدة', key: 'new_value', width: 38 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Cairo', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  for (const row of result.items) {
    const excelRow = sheet.addRow({
      id: row.id,
      created_at: row.created_at,
      operation_type: OPERATION_LABELS[row.operation_type] ?? row.operation_type,
      section: SECTION_LABELS[row.section] ?? row.section,
      actor_name: row.actor_name,
      target_label: row.target_label || row.target_id || '—',
      description: row.description,
      old_value: formatJsonForExcel(row.old_value_json),
      new_value: formatJsonForExcel(row.new_value_json),
    });
    excelRow.alignment = { vertical: 'top', horizontal: 'right', wrapText: true };
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const arrayBuf = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(arrayBuf),
    filename: `سجل_العمليات_والتعديلات_${stamp}.xlsx`,
  };
}
