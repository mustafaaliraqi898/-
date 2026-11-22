import Database from 'better-sqlite3';
import fs from 'fs';
import {
  createDatabaseConnection,
  initializeDatabase,
  setDbInstance,
  type SqliteDb,
} from '../db/connection';
import { ServiceError } from '../utils/validation';
import { migrateLegacyDataUrlsToMediaAssets } from './imageService';

const SQLITE_MAGIC = 'SQLite format 3\0';

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

export async function restoreDatabaseBackupBuffer(
  currentDb: SqliteDb,
  backupBuffer: Buffer
): Promise<{
  db: SqliteDb;
  media_assets_count: number;
  students_count: number;
}> {
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

  let probeDb: SqliteDb | null = null;
  try {
    probeDb = new Database(backupBuffer);
    const tables = probeDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const tableSet = new Set(tables.map((t) => t.name));

    if (!tableSet.has('school_settings') || !tableSet.has('students') || !tableSet.has('academic_years')) {
      throw new ServiceError(
        'النسخة الاحتياطية لا تحتوي على جداول نظام الغيابات الأساسية.',
        400,
        'INCOMPATIBLE_BACKUP'
      );
    }

    // Ensure schema + safe migrations (including media_assets if restoring an older backup)
    initializeDatabase(probeDb);
    await migrateLegacyDataUrlsToMediaAssets(probeDb);
    const normalizedBuf = probeDb.serialize();
    probeDb.close();
    probeDb = null;

    let nextDb: SqliteDb;
    if (!currentDb.memory && currentDb.name) {
      const dbPath = currentDb.name;
      currentDb.close();
      for (const suffix of ['-wal', '-shm']) {
        if (fs.existsSync(`${dbPath}${suffix}`)) {
          fs.unlinkSync(`${dbPath}${suffix}`);
        }
      }
      fs.writeFileSync(dbPath, normalizedBuf);
      nextDb = createDatabaseConnection(dbPath);
      setDbInstance(nextDb);
    } else {
      nextDb = new Database(normalizedBuf);
      initializeDatabase(nextDb);
      setDbInstance(nextDb);
    }

    const mediaCount = (
      nextDb.prepare('SELECT COUNT(*) as c FROM media_assets').get() as { c: number }
    ).c;
    const studentsCount = (
      nextDb.prepare('SELECT COUNT(*) as c FROM students').get() as { c: number }
    ).c;

    return {
      db: nextDb,
      media_assets_count: mediaCount,
      students_count: studentsCount,
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
  }
}
