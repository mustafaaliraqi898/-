import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type {
  BackupFrequency,
  BackupOverviewResponse,
  BackupRecord,
  BackupRecordType,
  BackupSettings,
  CreateBackupResult,
  RestoreBackupResult,
  UpdateBackupSettingsInput,
} from '../../src/types/school';
import {
  createDatabaseConnection,
  initializeDatabase,
  setDbInstance,
  type SqliteDb,
} from '../db/connection';
import { ServiceError, normalizeNullableString } from '../utils/validation';
import { recordAuditLog } from './auditLogService';
import { migrateLegacyDataUrlsToMediaAssets } from './imageService';

const SQLITE_MAGIC = 'SQLite format 3\0';
const REQUIRED_CORE_TABLES = [
  'school_settings',
  'students',
  'academic_years',
  'grades',
  'sections',
  'absences',
] as const;

let autoBackupInFlight = false;

function formatBackupTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(
    date.getHours()
  )}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

export function resolveDefaultBackupDir(db: SqliteDb): string {
  if (!db.memory && db.name) {
    return path.join(path.dirname(path.resolve(db.name)), 'backups');
  }
  return path.resolve(process.cwd(), 'data', 'backups');
}

function ensureWritableDirectory(dirPath: string): string {
  const resolved = path.resolve(dirPath);
  try {
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
    }
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error('NOT_A_DIRECTORY');
    }
    const probeFile = path.join(resolved, `.write-test-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probeFile, 'ok');
    fs.unlinkSync(probeFile);
    return resolved;
  } catch {
    throw new ServiceError(
      `مسار مجلد النسخ الاحتياطي غير صالح أو غير قابل للكتابة: ${resolved}`,
      400,
      'INVALID_BACKUP_DIR'
    );
  }
}

export function getBackupSettings(db: SqliteDb): BackupSettings {
  const row = db
    .prepare(
      `SELECT id, auto_enabled, frequency, retention_count, backup_dir,
              last_backup_at, last_backup_status, last_backup_message, updated_at
       FROM backup_settings
       WHERE id = 1`
    )
    .get() as
    | {
        id: number;
        auto_enabled: number;
        frequency: BackupFrequency;
        retention_count: number;
        backup_dir: string | null;
        last_backup_at: string | null;
        last_backup_status: string | null;
        last_backup_message: string | null;
        updated_at: string;
      }
    | undefined;

  const fallbackDir = resolveDefaultBackupDir(db);
  if (!row) {
    return {
      id: 1,
      auto_enabled: 0,
      frequency: 'daily',
      retention_count: 7,
      backup_dir: null,
      resolved_backup_dir: fallbackDir,
      last_backup_at: null,
      last_backup_status: null,
      last_backup_message: null,
      updated_at: new Date().toISOString(),
    };
  }

  const resolvedBackupDir = row.backup_dir
    ? path.resolve(row.backup_dir)
    : fallbackDir;

  return {
    ...row,
    frequency: row.frequency === 'weekly' ? 'weekly' : 'daily',
    resolved_backup_dir: resolvedBackupDir,
  };
}

export function verifySqliteFileIntegrity(filePath: string): {
  integrityStatus: string;
  sizeBytes: number;
} {
  if (!fs.existsSync(filePath)) {
    throw new ServiceError('ملف النسخة الاحتياطية غير موجود للتحقق منه.', 500, 'BACKUP_FILE_MISSING');
  }
  const stat = fs.statSync(filePath);
  if (stat.size < 100) {
    throw new ServiceError('ملف النسخة الاحتياطية فارغ أو تالف.', 400, 'INVALID_BACKUP');
  }

  const fd = fs.openSync(filePath, 'r');
  try {
    const magicBuf = Buffer.alloc(16);
    fs.readSync(fd, magicBuf, 0, 16, 0);
    if (magicBuf.toString('utf8') !== SQLITE_MAGIC) {
      throw new ServiceError(
        'الملف المحدد ليس قاعدة بيانات SQLite صالحة.',
        400,
        'INVALID_SQLITE_FILE'
      );
    }
  } finally {
    fs.closeSync(fd);
  }

  let probe: SqliteDb | null = null;
  try {
    probe = new Database(filePath, { readonly: true, fileMustExist: true });
    const checkRow = probe.prepare('PRAGMA integrity_check').get() as
      | { integrity_check?: string }
      | undefined;
    const integrityStatus = String(checkRow?.integrity_check ?? '').toLowerCase();
    if (integrityStatus !== 'ok') {
      throw new ServiceError(
        `فشل فحص سلامة قاعدة البيانات (PRAGMA integrity_check: ${integrityStatus || 'error'}).`,
        400,
        'INTEGRITY_CHECK_FAILED'
      );
    }

    const tables = probe
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const tableSet = new Set(tables.map((t) => t.name));

    for (const requiredTable of REQUIRED_CORE_TABLES) {
      if (!tableSet.has(requiredTable)) {
        throw new ServiceError(
          'النسخة الاحتياطية غير متوافقة وتفتقد جداول نظام الغيابات الأساسية.',
          400,
          'INCOMPATIBLE_BACKUP'
        );
      }
    }

    return {
      integrityStatus: 'ok',
      sizeBytes: stat.size,
    };
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    throw new ServiceError(
      'تعذر قراءة ملف النسخة الاحتياطية أو الملف تالف.',
      400,
      'CORRUPT_BACKUP_FILE'
    );
  } finally {
    if (probe) {
      try {
        probe.close();
      } catch {
        // ignore close failure
      }
    }
  }
}

export async function createVerifiedBackupBuffer(db: SqliteDb): Promise<{
  buffer: Buffer;
  integrity_status: string;
  filename: string;
}> {
  if (!db.memory) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // Ignore checkpoint error if busy
    }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-backup-export-'));
  const tmpFile = path.join(tmpDir, 'snapshot.db');
  try {
    await db.backup(tmpFile);
    const { integrityStatus } = verifySqliteFileIntegrity(tmpFile);
    const buffer = fs.readFileSync(tmpFile);
    const stamp = formatBackupTimestamp();
    return {
      buffer,
      integrity_status: integrityStatus,
      filename: `نسخة_احتياطية_نظام_الغيابات_${stamp}.db`,
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup
    }
  }
}

export function exportDatabaseBackupBuffer(db: SqliteDb): Buffer {
  if (!db.memory) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // Ignore checkpoint error if read-only or busy
    }
  }
  return db.serialize();
}

function pruneOldAutoBackups(db: SqliteDb, retentionCount: number): number {
  const autoRows = db
    .prepare(
      `SELECT id, file_path
       FROM backup_records
       WHERE backup_type = 'auto'
       ORDER BY id DESC`
    )
    .all() as Array<{ id: number; file_path: string }>;

  if (autoRows.length <= retentionCount) return 0;

  const toPrune = autoRows.slice(retentionCount);
  const deleteStmt = db.prepare('DELETE FROM backup_records WHERE id = ?');
  let pruned = 0;

  for (const row of toPrune) {
    try {
      if (row.file_path && fs.existsSync(row.file_path)) {
        fs.unlinkSync(row.file_path);
      }
      deleteStmt.run(row.id);
      pruned += 1;
    } catch {
      // Keep record if file couldn't be removed so user isn't misled
    }
  }

  return pruned;
}

export async function createManagedBackup(
  db: SqliteDb,
  backupType: BackupRecordType = 'manual',
  options?: { skipAuditLog?: boolean; customFilename?: string }
): Promise<CreateBackupResult> {
  const settings = getBackupSettings(db);
  const targetDir = ensureWritableDirectory(settings.resolved_backup_dir);
  const stamp = formatBackupTimestamp();
  const prefix =
    backupType === 'auto'
      ? 'auto_backup'
      : backupType === 'pre_restore'
        ? 'pre_restore_backup'
        : 'manual_backup';

  const safeFilename = options?.customFilename
    ? path.basename(options.customFilename)
    : `${prefix}_${stamp}.db`;
  const targetPath = path.resolve(targetDir, safeFilename);

  if (!targetPath.startsWith(targetDir + path.sep)) {
    throw new ServiceError('مسار ملف النسخة الاحتياطية غير صالح.', 400, 'INVALID_BACKUP_PATH');
  }

  if (!db.memory) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // ignore busy
    }
  }

  const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await db.backup(tmpPath);
    const { integrityStatus, sizeBytes } = verifySqliteFileIntegrity(tmpPath);

    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    fs.renameSync(tmpPath, targetPath);

    let insertedId = 0;
    let prunedCount = 0;

    db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO backup_records (filename, file_path, backup_type, size_bytes, integrity_ok, created_at)
           VALUES (?, ?, ?, ?, 1, datetime('now'))`
        )
        .run(safeFilename, targetPath, backupType, sizeBytes);
      insertedId = Number(info.lastInsertRowid);

      if (backupType === 'auto') {
        prunedCount = pruneOldAutoBackups(db, settings.retention_count);
      }

      if (backupType === 'auto' || backupType === 'manual') {
        db.prepare(
          `UPDATE backup_settings
           SET last_backup_at = datetime('now'),
               last_backup_status = 'success',
               last_backup_message = ?,
               updated_at = datetime('now')
           WHERE id = 1`
        ).run(
          backupType === 'auto'
            ? `تم إنشاء النسخة الاحتياطية التلقائية بنجاح (${safeFilename})`
            : `تم إنشاء النسخة الاحتياطية اليدوية بنجاح (${safeFilename})`
        );
      }

      if (!options?.skipAuditLog && backupType !== 'pre_restore') {
        recordAuditLog(db, {
          operation_type: 'backup',
          section: 'backup',
          description:
            backupType === 'auto'
              ? `تنفيذ نسخة احتياطية تلقائية بنجاح (${safeFilename})`
              : `إنشاء نسخة احتياطية يدوية (${safeFilename})`,
          target_id: insertedId,
          target_label: safeFilename,
          new_value: {
            backup_type: backupType,
            filename: safeFilename,
            size_bytes: sizeBytes,
            integrity_status: integrityStatus,
            pruned_old_auto_backups: prunedCount,
          },
        });
      }
    })();

    const saved = db
      .prepare('SELECT id, filename, file_path, backup_type, size_bytes, integrity_ok, created_at FROM backup_records WHERE id = ?')
      .get(insertedId) as Omit<BackupRecord, 'file_exists'>;

    return {
      record: {
        ...saved,
        file_exists: fs.existsSync(saved.file_path),
      },
      integrity_status: integrityStatus,
      pruned_count: prunedCount,
    };
  } catch (err) {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // ignore
      }
    }
    if (backupType === 'auto') {
      try {
        db.prepare(
          `UPDATE backup_settings
           SET last_backup_status = 'error',
               last_backup_message = ?,
               updated_at = datetime('now')
           WHERE id = 1`
        ).run(err instanceof Error ? err.message : 'فشل النسخ الاحتياطي التلقائي');
      } catch {
        // ignore
      }
    }
    throw err;
  }
}

export function listBackupRecords(db: SqliteDb): BackupRecord[] {
  const rows = db
    .prepare(
      `SELECT id, filename, file_path, backup_type, size_bytes, integrity_ok, created_at
       FROM backup_records
       ORDER BY id DESC
       LIMIT 100`
    )
    .all() as Array<Omit<BackupRecord, 'file_exists'>>;

  return rows.map((row) => ({
    ...row,
    file_exists: Boolean(row.file_path && fs.existsSync(row.file_path)),
  }));
}

export function getBackupOverview(db: SqliteDb): BackupOverviewResponse {
  const settings = getBackupSettings(db);
  const records = listBackupRecords(db);
  return {
    settings,
    records,
    runtime_note:
      'يعمل النسخ الاحتياطي التلقائي عند تشغيل البرنامج أو الخادم، ويتحقق تلقائياً من الاستحقاق عند بدء التشغيل وبشكل دوري أثناء بقاء البرنامج مفتوحاً (لا يعمل عند إغلاق البرنامج بالكامل).',
    media_included_note:
      'تُحفظ الصور وشعار المدرسة داخل جدول media_assets في قاعدة بيانات SQLite نفسها، لذلك تشمل النسخة الاحتياطية جميع البيانات والصور والشعارات بشكل كامل.',
  };
}

export function updateBackupSettings(
  db: SqliteDb,
  input: UpdateBackupSettingsInput
): BackupSettings {
  const previous = getBackupSettings(db);
  const autoEnabled = input.auto_enabled === 1 || input.auto_enabled === true ? 1 : 0;
  const frequency: BackupFrequency = input.frequency === 'weekly' ? 'weekly' : 'daily';
  const retention = Number(input.retention_count);

  if (!Number.isInteger(retention) || retention < 1 || retention > 90) {
    throw new ServiceError(
      'عدد النسخ المحتفظ بها يجب أن يكون رقماً صحيحاً بين 1 و 90.',
      400,
      'INVALID_RETENTION_COUNT'
    );
  }

  let cleanBackupDir = normalizeNullableString(input.backup_dir);
  if (cleanBackupDir) {
    cleanBackupDir = ensureWritableDirectory(cleanBackupDir);
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE backup_settings
       SET auto_enabled = ?,
           frequency = ?,
           retention_count = ?,
           backup_dir = ?,
           updated_at = datetime('now')
       WHERE id = 1`
    ).run(autoEnabled, frequency, retention, cleanBackupDir);

    const updated = getBackupSettings(db);
    recordAuditLog(db, {
      operation_type: 'update',
      section: 'settings',
      description: 'تحديث إعدادات النسخ الاحتياطي التلقائي وسياسة الاحتفاظ',
      target_id: 1,
      target_label: 'إعدادات النسخ الاحتياطي',
      old_value: {
        auto_enabled: Boolean(previous.auto_enabled),
        frequency: previous.frequency,
        retention_count: previous.retention_count,
        backup_dir: previous.backup_dir,
      },
      new_value: {
        auto_enabled: Boolean(updated.auto_enabled),
        frequency: updated.frequency,
        retention_count: updated.retention_count,
        backup_dir: updated.backup_dir,
      },
    });
  })();

  return getBackupSettings(db);
}

export function getBackupRecordFile(
  db: SqliteDb,
  recordId: number
): { filePath: string; filename: string } {
  const row = db
    .prepare('SELECT id, filename, file_path FROM backup_records WHERE id = ?')
    .get(recordId) as { id: number; filename: string; file_path: string } | undefined;

  if (!row) {
    throw new ServiceError('سجل النسخة الاحتياطية غير موجود.', 404, 'BACKUP_NOT_FOUND');
  }

  const resolved = path.resolve(row.file_path);
  if (!fs.existsSync(resolved)) {
    throw new ServiceError('ملف النسخة الاحتياطية غير موجود على القرص.', 404, 'BACKUP_FILE_MISSING');
  }

  verifySqliteFileIntegrity(resolved);
  return {
    filePath: resolved,
    filename: path.basename(row.filename),
  };
}

export async function runAutoBackupIfDue(
  db: SqliteDb,
  options?: { force?: boolean }
): Promise<CreateBackupResult | null> {
  if (autoBackupInFlight) return null;

  const settings = getBackupSettings(db);
  if (!options?.force && settings.auto_enabled !== 1) {
    return null;
  }

  if (!options?.force && settings.last_backup_at) {
    const parsedMs = Date.parse(
      settings.last_backup_at.includes('T')
        ? settings.last_backup_at
        : `${settings.last_backup_at.replace(' ', 'T')}Z`
    );
    if (!Number.isNaN(parsedMs)) {
      const intervalMs =
        settings.frequency === 'weekly' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
      if (Date.now() - parsedMs < intervalMs) {
        return null;
      }
    }
  }

  autoBackupInFlight = true;
  try {
    return await createManagedBackup(db, 'auto');
  } finally {
    autoBackupInFlight = false;
  }
}

export async function restoreDatabaseBackupBuffer(
  currentDb: SqliteDb,
  backupBuffer: Buffer
): Promise<
  RestoreBackupResult & {
    db: SqliteDb;
  }
> {
  if (!Buffer.isBuffer(backupBuffer) || backupBuffer.length < 100) {
    throw new ServiceError('ملف النسخة الاحتياطية غير صالح أو فارغ.', 400, 'INVALID_BACKUP');
  }

  const header = backupBuffer.subarray(0, 16).toString('utf8');
  if (header !== SQLITE_MAGIC) {
    throw new ServiceError(
      'الملف المحدد ليس قاعدة بيانات SQLite صالحة.',
      400,
      'INVALID_SQLITE_FILE'
    );
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-restore-probe-'));
  const rawProbePath = path.join(tmpDir, 'uploaded.db');
  const verifiedProbePath = path.join(tmpDir, 'verified.db');
  let probeDb: SqliteDb | null = null;

  try {
    fs.writeFileSync(rawProbePath, backupBuffer);

    // 1. Validate integrity & required tables BEFORE touching current live DB
    verifySqliteFileIntegrity(rawProbePath);

    probeDb = new Database(rawProbePath);
    initializeDatabase(probeDb);
    await migrateLegacyDataUrlsToMediaAssets(probeDb);
    await probeDb.backup(verifiedProbePath);
    probeDb.close();
    probeDb = null;

    const { integrityStatus } = verifySqliteFileIntegrity(verifiedProbePath);
    const normalizedBuf = fs.readFileSync(verifiedProbePath);

    // 2. Create automatic pre-restore safety backup of current DB BEFORE overwriting
    let preRestoreFilename: string | null = null;
    let preRestorePath: string | null = null;
    let preRestoreSize = 0;

    try {
      const backupSettings = getBackupSettings(currentDb);
      const safeDir = ensureWritableDirectory(backupSettings.resolved_backup_dir);
      preRestoreFilename = `pre_restore_${formatBackupTimestamp()}.db`;
      preRestorePath = path.resolve(safeDir, preRestoreFilename);
      await currentDb.backup(preRestorePath);
      const verifiedPre = verifySqliteFileIntegrity(preRestorePath);
      preRestoreSize = verifiedPre.sizeBytes;
    } catch {
      // Do not lose pre-restore attempt if memory DB or restricted test dir, try os.tmpdir
      if (!currentDb.memory && currentDb.name) {
        throw new ServiceError(
          'تعذر إنشاء نسخة أمان تلقائية للبيانات الحالية قبل الاستعادة، لذلك أُلغيت عملية الاستعادة حفاظاً على بياناتك.',
          500,
          'PRE_RESTORE_BACKUP_FAILED'
        );
      }
    }

    // 3. Swap database atomically
    let nextDb: SqliteDb;
    if (!currentDb.memory && currentDb.name) {
      const dbPath = currentDb.name;
      currentDb.close();
      for (const suffix of ['-wal', '-shm']) {
        if (fs.existsSync(`${dbPath}${suffix}`)) {
          fs.unlinkSync(`${dbPath}${suffix}`);
        }
      }
      const stagingTarget = `${dbPath}.restoring-${process.pid}`;
      fs.writeFileSync(stagingTarget, normalizedBuf);
      fs.renameSync(stagingTarget, dbPath);
      nextDb = createDatabaseConnection(dbPath);
      setDbInstance(nextDb);
    } else {
      nextDb = new Database(normalizedBuf);
      initializeDatabase(nextDb);
      setDbInstance(nextDb);
    }

    // 4. Register pre-restore backup & audit log inside the newly active DB
    const mediaCount = (
      nextDb.prepare('SELECT COUNT(*) as c FROM media_assets').get() as { c: number }
    ).c;
    const studentsCount = (
      nextDb.prepare('SELECT COUNT(*) as c FROM students').get() as { c: number }
    ).c;

    nextDb.transaction(() => {
      if (preRestoreFilename && preRestorePath && fs.existsSync(preRestorePath)) {
        nextDb
          .prepare(
            `INSERT INTO backup_records (filename, file_path, backup_type, size_bytes, integrity_ok, created_at)
             VALUES (?, ?, 'pre_restore', ?, 1, datetime('now'))`
          )
          .run(preRestoreFilename, preRestorePath, preRestoreSize);
      }

      recordAuditLog(nextDb, {
        operation_type: 'restore',
        section: 'backup',
        description: `استعادة قاعدة البيانات من نسخة احتياطية (${studentsCount} طالب)`,
        target_label: preRestoreFilename ? `أمان قبل الاستعادة: ${preRestoreFilename}` : 'استعادة قاعدة البيانات',
        new_value: {
          students_count: studentsCount,
          media_assets_count: mediaCount,
          integrity_status: integrityStatus,
          pre_restore_backup: preRestoreFilename,
        },
      });
    })();

    return {
      db: nextDb,
      restored: true,
      media_assets_count: mediaCount,
      students_count: studentsCount,
      pre_restore_backup_filename: preRestoreFilename,
      integrity_status: integrityStatus,
    };
  } catch (err) {
    if (probeDb) {
      try {
        probeDb.close();
      } catch {
        // Ignore close cleanup failure
      }
    }
    if (err instanceof ServiceError) {
      throw err;
    }
    throw new ServiceError(
      'تعذر استعادة النسخة الاحتياطية بسبب تلف في ملف قاعدة البيانات.',
      400,
      'RESTORE_FAILED'
    );
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup
    }
  }
}
