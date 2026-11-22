import assert from 'assert';
import crypto from 'crypto';
import express from 'express';
import http from 'http';
import sharp from 'sharp';
import { createDatabaseConnection, setDbInstance } from '../server/db/connection';
import { createApiRouter } from '../server/routes/api';
import { exportDatabaseBackupBuffer, restoreDatabaseBackupBuffer } from '../server/services/backupService';
import { createGrade } from '../server/services/gradeService';
import {
  getMediaAssetBlob,
  getMediaAssetMetaById,
  migrateLegacyDataUrlsToMediaAssets,
  processAndStoreImage,
  resolveMediaAssetDataUrl,
} from '../server/services/imageService';
import { getSimplifiedAbsenceReports } from '../server/services/reportsCenterService';
import { getSchoolSettings, updateSchoolSettings } from '../server/services/settingsService';
import { createStudent, getStudentById } from '../server/services/studentService';
import { buildSimplifiedReportStandaloneHtml } from '../src/components/reports/LegalPrintSheet';

function createDeterministicNoiseBuffer(width: number, height: number, channels: 3 | 4): Buffer {
  const buf = Buffer.alloc(width * height * channels);
  let seed = 0x12345678;
  for (let i = 0; i < buf.length; i++) {
    // Fast deterministic LCG for realistic high-entropy photo-like noise + smooth gradients
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const pixelIndex = Math.floor(i / channels);
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const ch = i % channels;
    if (channels === 4 && ch === 3) {
      // Half transparent border, half opaque center
      buf[i] = x < width / 4 || y < height / 4 ? 0 : 255;
    } else {
      const grad = ((x * 255) / width + (y * 255) / height) * 0.5;
      buf[i] = Math.min(255, Math.max(0, Math.floor(grad * 0.7 + ((seed >>> 24) & 0xff) * 0.3)));
    }
  }
  return buf;
}

async function runTests() {
  console.log('=== Starting Centralized Image Processing & Storage System Verification ===');

  const db = createDatabaseConnection(':memory:');
  setDbInstance(db);

  // ---------------------------------------------------------
  // Test Case 1: Transparent PNG (Logo / Crest with Alpha = 0)
  // ---------------------------------------------------------
  const logoWidth = 600;
  const logoHeight = 600;
  const transparentRaw = createDeterministicNoiseBuffer(logoWidth, logoHeight, 4);
  const transparentPngBuffer = await sharp(transparentRaw, {
    raw: { width: logoWidth, height: logoHeight, channels: 4 },
  })
    .png({ compressionLevel: 6 })
    .toBuffer();

  const logoAsset = await processAndStoreImage(db, transparentPngBuffer, {
    filename: 'school-crest-transparent.png',
    category: 'school_logo',
  });

  assert.strictEqual(logoAsset.has_alpha, true, 'Transparent PNG must preserve alpha flag');
  assert.strictEqual(logoAsset.width, logoWidth, 'Logo width must be preserved');
  assert.strictEqual(logoAsset.height, logoHeight, 'Logo height must be preserved');
  assert.notStrictEqual(
    logoAsset.optimized_mime,
    'image/jpeg',
    'Transparent PNG must NEVER be converted to JPEG'
  );
  assert.ok(
    logoAsset.optimized_mime === 'image/webp' || logoAsset.optimized_mime === 'image/png',
    `Expected WebP or PNG for transparent image, got ${logoAsset.optimized_mime}`
  );

  const logoOptBlob = await getMediaAssetBlob(db, logoAsset.id, 'optimized');
  const logoOrigBlob = await getMediaAssetBlob(db, logoAsset.id, 'original');
  const logoOptMeta = await sharp(logoOptBlob.buffer).metadata();
  assert.strictEqual(logoOptMeta.hasAlpha, true, 'Optimized WebP must still carry alpha channel');
  assert.strictEqual(logoOptMeta.width, logoWidth);
  assert.strictEqual(logoOptMeta.height, logoHeight);
  assert.strictEqual(
    Buffer.compare(logoOrigBlob.buffer, transparentPngBuffer),
    0,
    'Original transparent PNG bytes must be preserved unmodified'
  );

  console.log(
    `[CASE 1] Transparent PNG: ${logoAsset.original_size} B -> ${logoAsset.optimized_size} B (-${logoAsset.reduction_percent}%) | strategy=${logoAsset.strategy} | mime=${logoAsset.optimized_mime}`
  );

  // ---------------------------------------------------------
  // Test Case 2: Photographic JPEG (High-Detail Photo)
  // ---------------------------------------------------------
  const photoW = 1200;
  const photoH = 900;
  const photoRaw = createDeterministicNoiseBuffer(photoW, photoH, 3);
  const photoJpegBuffer = await sharp(photoRaw, {
    raw: { width: photoW, height: photoH, channels: 3 },
  })
    .jpeg({ quality: 95 })
    .toBuffer();

  const photoAsset = await processAndStoreImage(db, photoJpegBuffer, {
    filename: 'student-portrait.jpg',
    category: 'student_photo',
  });

  assert.strictEqual(photoAsset.has_alpha, false);
  assert.strictEqual(photoAsset.width, photoW);
  assert.strictEqual(photoAsset.height, photoH);
  assert.strictEqual(photoAsset.optimized_mime, 'image/webp');
  assert.strictEqual(photoAsset.strategy, 'webp-lossy');
  assert.ok(photoAsset.optimized_size < photoAsset.original_size, 'Photographic JPEG should shrink');

  const photoOrigBlob = await getMediaAssetBlob(db, photoAsset.id, 'original');
  assert.strictEqual(
    Buffer.compare(photoOrigBlob.buffer, photoJpegBuffer),
    0,
    'Original JPEG bytes must be preserved unmodified'
  );

  console.log(
    `[CASE 2] Photographic JPEG: ${photoAsset.original_size} B -> ${photoAsset.optimized_size} B (-${photoAsset.reduction_percent}%) | strategy=${photoAsset.strategy}`
  );

  // ---------------------------------------------------------
  // Test Case 3: WebP Image & Anti-Recompression Guard
  // ---------------------------------------------------------
  const photoOptBlob = await getMediaAssetBlob(db, photoAsset.id, 'optimized');
  const reuploadOptimized = await processAndStoreImage(db, photoOptBlob.buffer, {
    filename: 'reupload-already-optimized.webp',
    category: 'student_photo',
  });
  assert.strictEqual(reuploadOptimized.id, photoAsset.id, 'Must return existing asset without duplicating');
  assert.strictEqual(reuploadOptimized.deduplicated, true);
  assert.strictEqual(
    reuploadOptimized.skipped_recompression,
    true,
    'Must NOT re-compress an already-processed optimized WebP'
  );

  // Also test a fresh standalone tightly-compressed WebP
  const freshWebp = await sharp(photoRaw, {
    raw: { width: photoW, height: photoH, channels: 3 },
  })
    .webp({ quality: 78 })
    .toBuffer();
  const freshWebpAsset = await processAndStoreImage(db, freshWebp, {
    filename: 'fresh-webp.webp',
    category: 'general',
  });
  assert.ok(freshWebpAsset.optimized_size <= freshWebpAsset.original_size);
  console.log(
    `[CASE 3] WebP & Anti-Recompression: fresh WebP ${freshWebpAsset.original_size} B -> ${freshWebpAsset.optimized_size} B (${freshWebpAsset.strategy}) | re-upload skipped_recompression=${reuploadOptimized.skipped_recompression}`
  );

  // ---------------------------------------------------------
  // Test Case 4: Large Image (~20 MB high-res PNG)
  // ---------------------------------------------------------
  const bigW = 3000;
  const bigH = 2600;
  const bigRaw = createDeterministicNoiseBuffer(bigW, bigH, 3);
  const largeImageBuffer = await sharp(bigRaw, {
    raw: { width: bigW, height: bigH, channels: 3 },
  })
    .png({ compressionLevel: 1 }) // Fast low-compression PNG around ~18-24 MB
    .toBuffer();

  assert.ok(
    largeImageBuffer.length >= 15 * 1024 * 1024,
    `Expected large test image >= 15MB, got ${(largeImageBuffer.length / (1024 * 1024)).toFixed(2)} MB`
  );

  const largeAsset = await processAndStoreImage(db, largeImageBuffer, {
    filename: 'large-scan-20mb.png',
    category: 'general',
  });

  assert.strictEqual(largeAsset.width, bigW, 'Large image dimensions must remain exact');
  assert.strictEqual(largeAsset.height, bigH);
  assert.ok(
    largeAsset.optimized_size < largeAsset.original_size * 0.5,
    'Large 20MB raster should compress dramatically without failing size caps'
  );
  const largeOrig = await getMediaAssetBlob(db, largeAsset.id, 'original');
  assert.strictEqual(
    Buffer.compare(largeOrig.buffer, largeImageBuffer),
    0,
    'Large ~20MB original must remain intact byte-for-byte'
  );

  console.log(
    `[CASE 4] Large ~20MB Image (${(largeAsset.original_size / (1024 * 1024)).toFixed(2)} MB): ${largeAsset.original_size} B -> ${largeAsset.optimized_size} B (-${largeAsset.reduction_percent}%) | strategy=${largeAsset.strategy}`
  );

  // ---------------------------------------------------------
  // Test Case 5: Tiny / Small Image Not Needing Compression
  // ---------------------------------------------------------
  const tinyBuffer = await sharp({
    create: { width: 24, height: 24, channels: 3, background: { r: 15, g: 118, b: 110 } },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const tinyAsset = await processAndStoreImage(db, tinyBuffer, {
    filename: 'tiny-icon.png',
    category: 'general',
  });
  assert.ok(tinyAsset.optimized_size <= tinyAsset.original_size);
  console.log(
    `[CASE 5] Small Image (${tinyAsset.original_size} B): -> ${tinyAsset.optimized_size} B (-${tinyAsset.reduction_percent}%) | strategy=${tinyAsset.strategy}`
  );

  // ---------------------------------------------------------
  // Test Case 6: Corrupted / Unsupported / Malicious SVG
  // ---------------------------------------------------------
  let rejectedText = false;
  try {
    await processAndStoreImage(db, Buffer.from('this is definitely not an image', 'utf8'), {
      filename: 'fake.png',
    });
  } catch (err) {
    rejectedText = true;
    assert.strictEqual((err as { statusCode?: number }).statusCode, 400);
  }
  assert.strictEqual(rejectedText, true, 'Non-image payload must be rejected with 400');

  let rejectedTruncatedPng = false;
  try {
    await processAndStoreImage(db, transparentPngBuffer.subarray(0, 120), {
      filename: 'corrupted.png',
    });
  } catch (err) {
    rejectedTruncatedPng = true;
    assert.strictEqual((err as { statusCode?: number }).statusCode, 400);
  }
  assert.strictEqual(rejectedTruncatedPng, true, 'Truncated/corrupted PNG must be rejected with 400');

  // Script sanitization in SVG
  const unsafeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script><circle cx="32" cy="32" r="20" onclick="evil()" fill="#0f766e"/></svg>`;
  const svgAsset = await processAndStoreImage(db, Buffer.from(unsafeSvg, 'utf8'), {
    filename: 'crest.svg',
    category: 'school_logo',
  });
  const storedSvg = (await getMediaAssetBlob(db, svgAsset.id, 'optimized')).buffer.toString('utf8');
  assert.ok(!storedSvg.includes('<script'), 'SVG <script> must be stripped');
  assert.ok(!storedSvg.includes('onclick'), 'SVG inline event handlers must be stripped');
  console.log(
    `[CASE 6] Corrupted/Unsupported rejected (400 OK) & SVG sanitized safely (${svgAsset.original_size} B -> ${svgAsset.optimized_size} B)`
  );

  // ---------------------------------------------------------
  // Test Case 7: Deduplication + Linking Settings/Students + Legacy Migration
  // ---------------------------------------------------------
  const dupLogoAsset = await processAndStoreImage(db, transparentPngBuffer, {
    filename: 'school-crest-duplicate.png',
    category: 'school_logo',
  });
  assert.strictEqual(dupLogoAsset.id, logoAsset.id, 'Duplicate upload must reuse existing asset ID');
  assert.strictEqual(dupLogoAsset.deduplicated, true);

  const updatedSettings = updateSchoolSettings(db, {
    school_name: 'ثانوية بغداد النموذجية',
    directorate_name: 'تربية بغداد الرصافة',
    school_logo_data: logoAsset.optimized_url,
    school_logo_asset_id: logoAsset.id,
  });
  assert.strictEqual(updatedSettings.school_logo_asset_id, logoAsset.id);
  assert.strictEqual(updatedSettings.school_logo_data, logoAsset.optimized_url);

  const grade = createGrade(db, {
    name: 'الرابع العلمي',
    stage: 'preparatory',
    initial_sections: ['أ'],
  });
  const student = createStudent(db, {
    full_name: 'علي حسن كاظم',
    grade_id: grade.id,
    section_id: grade.sections[0].id,
    photo_data: photoAsset.optimized_url,
    photo_asset_id: photoAsset.id,
  });
  assert.strictEqual(student.photo_asset_id, photoAsset.id);
  assert.strictEqual(student.photo_data, photoAsset.optimized_url);

  // Legacy data:image/png;base64,... migration safety check
  const legacyPngBuf = await sharp({
    create: { width: 80, height: 80, channels: 4, background: { r: 20, g: 100, b: 180, alpha: 0.5 } },
  })
    .png()
    .toBuffer();
  const legacyDataUrl = `data:image/png;base64,${legacyPngBuf.toString('base64')}`;
  const legacyStudent = createStudent(db, {
    full_name: 'محمد كريم عباس',
    grade_id: grade.id,
    section_id: grade.sections[0].id,
    photo_data: legacyDataUrl,
  });
  assert.strictEqual(legacyStudent.photo_data, legacyDataUrl);
  assert.strictEqual(legacyStudent.photo_asset_id, null);

  const migrationResult = await migrateLegacyDataUrlsToMediaAssets(db);
  assert.strictEqual(migrationResult.migrated_students_count, 1);
  const migratedStudent = getStudentById(db, legacyStudent.id);
  assert.ok(migratedStudent.photo_asset_id && migratedStudent.photo_asset_id > 0);
  assert.strictEqual(migratedStudent.photo_data, `/api/media/${migratedStudent.photo_asset_id}/optimized`);
  console.log(
    `[CASE 7] Deduplication, settings/student linking & legacy base64 migration verified (migrated=${migrationResult.migrated_students_count})`
  );

  // ---------------------------------------------------------
  // Test Case 8: Compat Fallback, Standalone Print HTML & Live HTTP + Backup/Restore
  // ---------------------------------------------------------
  const logoCompat = await getMediaAssetBlob(db, logoAsset.id, 'compat');
  assert.strictEqual(logoCompat.mime, 'image/png', 'Transparent WebP compat fallback must be PNG');
  const logoCompatMeta = await sharp(logoCompat.buffer).metadata();
  assert.strictEqual(logoCompatMeta.hasAlpha, true, 'Compat PNG must keep transparency');

  const photoCompat = await getMediaAssetBlob(db, photoAsset.id, 'compat');
  assert.strictEqual(photoCompat.mime, 'image/jpeg', 'Opaque photo WebP compat fallback must be JPEG');

  // Verify standalone print HTML embeds compat PNG data URL while DB still serves optimized WebP
  const reportsData = getSimplifiedAbsenceReports(db, { report_type: 'warning' });
  const compatDataUrlForPrint = await resolveMediaAssetDataUrl(db, logoAsset.id, 'compat');
  assert.ok(compatDataUrlForPrint.startsWith('data:image/png;base64,'));
  const standaloneHtml = buildSimplifiedReportStandaloneHtml(
    reportsData,
    undefined,
    compatDataUrlForPrint
  );
  assert.ok(standaloneHtml.includes('data:image/png;base64,'));
  assert.strictEqual(getSchoolSettings(db).school_logo_data, `/api/media/${logoAsset.id}/optimized`);

  // Spin up Express API router on ephemeral port and verify HTTP binary upload/fetch/backup/restore
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/api', createApiRouter(() => db));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // Upload via HTTP binary endpoint
    const httpUploadRes = await fetch(`${baseUrl}/api/media/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        'X-Image-Filename': encodeURIComponent('http-logo.png'),
        'X-Image-Category': 'school_logo',
      },
      body: new Uint8Array(transparentPngBuffer),
    });
    assert.strictEqual(httpUploadRes.status, 200); // deduplicated match!
    const httpAsset = await httpUploadRes.json();
    assert.strictEqual(httpAsset.id, logoAsset.id);

    // Fetch optimized + original + compat over HTTP
    const optHttp = await fetch(`${baseUrl}/api/media/${logoAsset.id}/optimized`);
    assert.strictEqual(optHttp.status, 200);
    assert.strictEqual(optHttp.headers.get('x-content-type-options'), 'nosniff');

    const origHttp = await fetch(`${baseUrl}/api/media/${logoAsset.id}/original`);
    assert.strictEqual(origHttp.status, 200);
    const origHttpBuf = Buffer.from(await origHttp.arrayBuffer());
    assert.strictEqual(Buffer.compare(origHttpBuf, transparentPngBuffer), 0);

    const compatHttp = await fetch(`${baseUrl}/api/media/${photoAsset.id}/compat`);
    assert.strictEqual(compatHttp.status, 200);
    assert.strictEqual(compatHttp.headers.get('content-type'), 'image/jpeg');

    // Legacy non-WebP Accept header negotiation
    const legacyAcceptHttp = await fetch(`${baseUrl}/api/media/${photoAsset.id}/optimized`, {
      headers: { Accept: 'image/jpeg,image/png' },
    });
    assert.strictEqual(legacyAcceptHttp.status, 200);
    assert.strictEqual(legacyAcceptHttp.headers.get('content-type'), 'image/jpeg');

    // Backup export + wipe + restore check (preserving both originals & optimized versions)
    const backupRes = await fetch(`${baseUrl}/api/backup/export`);
    assert.strictEqual(backupRes.status, 200);
    const backupBuffer = Buffer.from(await backupRes.arrayBuffer());
    const exportedOriginalSha = getMediaAssetMetaById(db, largeAsset.id).original_sha256;
    const exportedOptimizedSha = getMediaAssetMetaById(db, largeAsset.id).optimized_sha256;

    // Mutate DB (delete an asset) then restore from backup
    db.prepare('UPDATE students SET photo_asset_id = NULL, photo_data = NULL').run();
    const restoreRes = await fetch(`${baseUrl}/api/backup/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(backupBuffer),
    });
    assert.strictEqual(restoreRes.status, 200);
    const restorePayload = await restoreRes.json();
    assert.strictEqual(restorePayload.restored, true);

    // Inspect restored DB via direct service call
    const { getDb } = await import('../server/db/connection');
    const restoredDb = getDb();
    const restoredLargeMeta = getMediaAssetMetaById(restoredDb, largeAsset.id);
    assert.strictEqual(restoredLargeMeta.original_sha256, exportedOriginalSha);
    assert.strictEqual(restoredLargeMeta.optimized_sha256, exportedOptimizedSha);
    const restoredOrigBlob = await getMediaAssetBlob(restoredDb, largeAsset.id, 'original');
    const restoredOptBlob = await getMediaAssetBlob(restoredDb, largeAsset.id, 'optimized');
    assert.strictEqual(
      crypto.createHash('sha256').update(restoredOrigBlob.buffer).digest('hex'),
      exportedOriginalSha
    );
    assert.strictEqual(
      crypto.createHash('sha256').update(restoredOptBlob.buffer).digest('hex'),
      exportedOptimizedSha
    );
    const restoredStudent = getStudentById(restoredDb, student.id);
    assert.strictEqual(restoredStudent.photo_asset_id, photoAsset.id);

    console.log(
      `[CASE 8] HTTP endpoints, Accept negotiation, compat PNG/JPEG print HTML, & SQLite backup/restore verified (restored ${restorePayload.media_assets_count} assets, ${restorePayload.students_count} students)`
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // Also test direct backupService round-trip
  const directBackup = exportDatabaseBackupBuffer(db);
  const directRestore = await restoreDatabaseBackupBuffer(db, directBackup);
  assert.ok(directRestore.media_assets_count >= 5);

  console.log('=== ALL 8 CENTRALIZED IMAGE SYSTEM TEST SUITES PASSED ===');
}

runTests().catch((err) => {
  console.error('Image verification failed:', err);
  process.exit(1);
});
