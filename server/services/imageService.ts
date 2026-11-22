import crypto from 'crypto';
import sharp, { type Metadata } from 'sharp';
import type { SqliteDb } from '../db/connection';
import { ServiceError } from '../utils/validation';

export type ImageCategory = 'school_logo' | 'student_photo' | 'general';

export type ImageCompressionStrategy =
  | 'webp-lossless'
  | 'webp-lossy'
  | 'original-kept'
  | 'fallback-original';

export interface MediaAssetSummary {
  id: number;
  original_sha256: string;
  optimized_sha256: string;
  original_filename: string | null;
  category: ImageCategory;
  original_mime: string;
  optimized_mime: string;
  original_size: number;
  optimized_size: number;
  saved_bytes: number;
  reduction_percent: number;
  width: number | null;
  height: number | null;
  has_alpha: boolean;
  strategy: ImageCompressionStrategy;
  is_processed: boolean;
  processing_note: string | null;
  deduplicated: boolean;
  skipped_recompression: boolean;
  optimized_url: string;
  original_url: string;
  compat_url: string;
  created_at: string;
}

interface MediaAssetRow {
  id: number;
  original_sha256: string;
  optimized_sha256: string;
  original_filename: string | null;
  category: ImageCategory;
  original_mime: string;
  optimized_mime: string;
  original_size: number;
  optimized_size: number;
  width: number | null;
  height: number | null;
  has_alpha: number;
  strategy: ImageCompressionStrategy;
  is_processed: number;
  processing_note: string | null;
  original_blob?: Buffer;
  optimized_blob?: Buffer;
  created_at: string;
  updated_at: string;
}

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB safety ceiling (no tiny arbitrary cap)
const MAX_INPUT_PIXELS = 200_000_000; // Up to ~200MP high-resolution images

const FORMAT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  avif: 'image/avif',
  heif: 'image/heif',
  svg: 'image/svg+xml',
};

function computeSha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function buildMediaUrl(id: number, variant: 'optimized' | 'original' | 'compat'): string {
  return `/api/media/${id}/${variant}`;
}

function toSummary(
  row: MediaAssetRow,
  flags: { deduplicated: boolean; skipped_recompression: boolean }
): MediaAssetSummary {
  const savedBytes = Math.max(0, row.original_size - row.optimized_size);
  const reductionPercent =
    row.original_size > 0
      ? Number(((savedBytes / row.original_size) * 100).toFixed(1))
      : 0;

  return {
    id: row.id,
    original_sha256: row.original_sha256,
    optimized_sha256: row.optimized_sha256,
    original_filename: row.original_filename,
    category: row.category,
    original_mime: row.original_mime,
    optimized_mime: row.optimized_mime,
    original_size: row.original_size,
    optimized_size: row.optimized_size,
    saved_bytes: savedBytes,
    reduction_percent: reductionPercent,
    width: row.width,
    height: row.height,
    has_alpha: Boolean(row.has_alpha),
    strategy: row.strategy,
    is_processed: Boolean(row.is_processed),
    processing_note: row.processing_note,
    deduplicated: flags.deduplicated,
    skipped_recompression: flags.skipped_recompression,
    optimized_url: buildMediaUrl(row.id, 'optimized'),
    original_url: buildMediaUrl(row.id, 'original'),
    compat_url: buildMediaUrl(row.id, 'compat'),
    created_at: row.created_at,
  };
}

function normalizeCategory(category?: string | null): ImageCategory {
  if (category === 'school_logo' || category === 'student_photo') {
    return category;
  }
  return 'general';
}

function normalizeFilename(filename?: string | null): string | null {
  if (!filename) return null;
  const clean = filename.replace(/[\r\n\0/\\]+/g, '_').trim();
  return clean ? clean.slice(0, 180) : null;
}

function isLikelySvgBuffer(buffer: Buffer): boolean {
  const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8').trimStart();
  if (!head) return false;
  if (head.startsWith('<svg')) return true;
  if (head.startsWith('<?xml') && /<svg[\s>]/i.test(head)) return true;
  return false;
}

function sanitizeSvgContent(rawSvg: string): string {
  // Verify balanced basic structure
  if (!/<svg[\s>]/i.test(rawSvg) || !/<\/svg\s*>/i.test(rawSvg)) {
    throw new ServiceError('ملف SVG غير صالح أو تالف.', 400, 'INVALID_IMAGE');
  }
  // Strip active script/XSS payloads safely while keeping vector artwork intact
  const cleaned = rawSvg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|xlink:href)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '');

  return cleaned;
}

function hasKnownRasterSignature(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  // PNG
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return true;
  }
  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return true;
  }
  // GIF
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return true;
  }
  // WEBP (RIFF....WEBP)
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return true;
  }
  // TIFF
  if (
    (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
    (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a)
  ) {
    return true;
  }
  // AVIF / HEIF (....ftyp)
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    return true;
  }
  // BMP
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return true;
  }
  return false;
}

export function resolveAssetIdFromImageRef(ref: string | null | undefined): number | null {
  if (!ref) return null;
  const trimmed = ref.trim();
  const match =
    trimmed.match(/^\/api\/media\/(\d+)\/(?:optimized|original|compat)(?:\?.*)?$/i) ||
    trimmed.match(/^app-media:\/\/asset\/(\d+)\/(?:optimized|original|compat)(?:\?.*)?$/i);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function getMediaAssetMetaById(db: SqliteDb, id: number): MediaAssetSummary {
  const row = db
    .prepare(
      `SELECT id, original_sha256, optimized_sha256, original_filename, category,
              original_mime, optimized_mime, original_size, optimized_size,
              width, height, has_alpha, strategy, is_processed, processing_note,
              created_at, updated_at
       FROM media_assets
       WHERE id = ?`
    )
    .get(id) as MediaAssetRow | undefined;

  if (!row) {
    throw new ServiceError('تعذر العثور على الصورة المطلوبة في وحدة التخزين.', 404, 'MEDIA_NOT_FOUND');
  }

  return toSummary(row, { deduplicated: false, skipped_recompression: false });
}

export async function processAndStoreImage(
  db: SqliteDb,
  rawBuffer: Buffer,
  options: {
    filename?: string | null;
    mimeHint?: string | null;
    category?: ImageCategory | string | null;
    forceOriginalOnEncodeFailure?: boolean;
  } = {}
): Promise<MediaAssetSummary> {
  if (!Buffer.isBuffer(rawBuffer) || rawBuffer.length === 0) {
    throw new ServiceError('لم يتم استلام أي بيانات صالحة للصورة.', 400, 'EMPTY_IMAGE');
  }

  if (rawBuffer.length > MAX_UPLOAD_BYTES) {
    throw new ServiceError(
      'حجم الملف كبير جداً بحيث يتجاوز السعة القصوى المسموحة للمعالجة الآمنة (100 ميغابايت).',
      400,
      'IMAGE_TOO_LARGE'
    );
  }

  const category = normalizeCategory(options.category);
  const filename = normalizeFilename(options.filename);
  const incomingSha256 = computeSha256(rawBuffer);

  // 1. Deduplication & Anti-Recompression check
  const existingRow = db
    .prepare(
      `SELECT id, original_sha256, optimized_sha256, original_filename, category,
              original_mime, optimized_mime, original_size, optimized_size,
              width, height, has_alpha, strategy, is_processed, processing_note,
              created_at, updated_at
       FROM media_assets
       WHERE original_sha256 = ? OR optimized_sha256 = ?
       LIMIT 1`
    )
    .get(incomingSha256, incomingSha256) as MediaAssetRow | undefined;

  if (existingRow) {
    const isAlreadyOptimizedInput =
      existingRow.optimized_sha256 === incomingSha256 &&
      existingRow.original_sha256 !== incomingSha256;
    return toSummary(existingRow, {
      deduplicated: true,
      skipped_recompression: isAlreadyOptimizedInput,
    });
  }

  // 2. Inspect image type & validate integrity before processing
  const isSvg = isLikelySvgBuffer(rawBuffer);
  if (isSvg) {
    const rawText = rawBuffer.toString('utf8');
    const cleanSvg = sanitizeSvgContent(rawText);
    const cleanBuffer = Buffer.from(cleanSvg, 'utf8');
    const cleanSha = computeSha256(cleanBuffer);

    const existingClean = db
      .prepare(
        `SELECT id, original_sha256, optimized_sha256, original_filename, category,
                original_mime, optimized_mime, original_size, optimized_size,
                width, height, has_alpha, strategy, is_processed, processing_note,
                created_at, updated_at
         FROM media_assets WHERE original_sha256 = ? LIMIT 1`
      )
      .get(cleanSha) as MediaAssetRow | undefined;

    if (existingClean) {
      return toSummary(existingClean, { deduplicated: true, skipped_recompression: false });
    }

    let svgWidth: number | null = null;
    let svgHeight: number | null = null;
    try {
      const svgMeta = await sharp(cleanBuffer).metadata();
      svgWidth = svgMeta.width ?? null;
      svgHeight = svgMeta.height ?? null;
    } catch {
      // SVG dimensions optional if viewBox only
    }

    const insertInfo = db
      .prepare(
        `INSERT INTO media_assets (
           original_sha256, optimized_sha256, original_filename, category,
           original_mime, optimized_mime, original_size, optimized_size,
           width, height, has_alpha, strategy, is_processed, processing_note,
           original_blob, optimized_blob
         ) VALUES (?, ?, ?, ?, 'image/svg+xml', 'image/svg+xml', ?, ?, ?, ?, 1, 'original-kept', 1, ?, ?, ?)`
      )
      .run(
        cleanSha,
        cleanSha,
        filename,
        category,
        cleanBuffer.length,
        cleanBuffer.length,
        svgWidth,
        svgHeight,
        'تم حفظ شعار SVG المتجهي بصيغته الأصلية بدون فقدان جودة',
        cleanBuffer,
        cleanBuffer
      );

    return getMediaAssetMetaById(db, Number(insertInfo.lastInsertRowid));
  }

  // Raster magic bytes + strict Sharp decode check
  if (!hasKnownRasterSignature(rawBuffer)) {
    throw new ServiceError(
      'الملف المرفق ليس صورة مدعومة أو أنه تالف. الصيغ المدعومة: PNG، JPG، WebP، GIF، TIFF، AVIF، SVG.',
      400,
      'UNSUPPORTED_IMAGE_FORMAT'
    );
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(rawBuffer, {
      failOn: 'error',
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();

    // Trigger full pixel decode check so truncated/corrupted bitstreams fail cleanly here
    await sharp(rawBuffer, {
      failOn: 'error',
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .stats();
  } catch {
    throw new ServiceError(
      'تعذر قراءة الصورة لأنها تالفة أو غير مكتملة أو بصيغة غير مدعومة.',
      400,
      'CORRUPTED_IMAGE'
    );
  }

  const sourceFormat = String(metadata.format ?? '').toLowerCase();
  const originalMime = FORMAT_TO_MIME[sourceFormat];
  if (!originalMime || !metadata.width || !metadata.height) {
    throw new ServiceError(
      'صيغة الصورة غير مدعومة أو أبعادها غير صالحة.',
      400,
      'UNSUPPORTED_IMAGE_FORMAT'
    );
  }

  const hasAlpha = Boolean(metadata.hasAlpha);
  const originalSize = rawBuffer.length;
  const orientationSwapped = Boolean(metadata.orientation && metadata.orientation >= 5);
  const width = orientationSwapped ? metadata.height : metadata.width;
  const height = orientationSwapped ? metadata.width : metadata.height;

  // 3. Smart Compression Decision Engine
  let optimizedBuffer: Buffer = rawBuffer;
  let optimizedMime: string = originalMime;
  let strategy: ImageCompressionStrategy = 'original-kept';
  let processingNote = 'تم الاحتفاظ بالنسخة الأصلية لأنها مثالية بالفعل دون حاجة لضغط إضافي';

  try {
    // Preserve original dimensions always; only auto-rotate if EXIF orientation exists
    const buildPipeline = () => {
      const p = sharp(rawBuffer, {
        failOn: 'error',
        limitInputPixels: MAX_INPUT_PIXELS,
        animated: sourceFormat === 'gif' || sourceFormat === 'webp' ? (metadata.pages ?? 1) > 1 : false,
      });
      return metadata.orientation ? p.rotate() : p;
    };

    const isAnimated = Boolean(metadata.pages && metadata.pages > 1);

    if (isAnimated) {
      // Animated images: preserve frames in WebP only if significantly smaller, else keep original
      const animatedWebp = await buildPipeline()
        .webp({ quality: 85, effort: 4 })
        .toBuffer();
      if (animatedWebp.length < originalSize * 0.9) {
        optimizedBuffer = animatedWebp;
        optimizedMime = 'image/webp';
        strategy = 'webp-lossy';
        processingNote = 'تم تحسين الصورة المتحركة إلى WebP مع الحفاظ على الإطارات والأبعاد';
      }
    } else if (originalSize <= 8 * 1024) {
      // Very small icons/assets: lossless WebP ONLY if meaningfully smaller
      const losslessSmall = await buildPipeline()
        .webp({ lossless: true, effort: 4 })
        .toBuffer();
      if (losslessSmall.length < originalSize * 0.9) {
        optimizedBuffer = losslessSmall;
        optimizedMime = 'image/webp';
        strategy = 'webp-lossless';
        processingNote = 'تم ضغط الصورة الصغيرة بدون فقدان جودة (Lossless WebP)';
      }
    } else if (hasAlpha) {
      // Transparent images: NEVER convert to JPEG!
      const losslessWebp = await buildPipeline()
        .webp({ lossless: true, effort: 5 })
        .toBuffer();

      if (originalSize <= 350 * 1024 || losslessWebp.length <= 350 * 1024) {
        if (losslessWebp.length < originalSize * 0.95) {
          optimizedBuffer = losslessWebp;
          optimizedMime = 'image/webp';
          strategy = 'webp-lossless';
          processingNote = 'تم تحويل الصورة الشفافة إلى WebP بدون فقدان جودة مع الحفاظ على الشفافية';
        }
      } else if (losslessWebp.length > originalSize * 0.7) {
        const alphaLossyWebp = await buildPipeline()
          .webp({ quality: 90, alphaQuality: 100, smartSubsample: true, effort: 5 })
          .toBuffer();

        if (
          alphaLossyWebp.length < losslessWebp.length * 0.72 &&
          alphaLossyWebp.length < originalSize * 0.85
        ) {
          optimizedBuffer = alphaLossyWebp;
          optimizedMime = 'image/webp';
          strategy = 'webp-lossy';
          processingNote =
            'تم ضغط الصورة الشفافة الكبيرة بصيغة WebP عالية الجودة مع الحفاظ الكامل على الشفافية';
        } else if (losslessWebp.length < originalSize * 0.95) {
          optimizedBuffer = losslessWebp;
          optimizedMime = 'image/webp';
          strategy = 'webp-lossless';
          processingNote = 'تم تحويل الصورة الشفافة إلى WebP بدون فقدان جودة مع الحفاظ على الشفافية';
        }
      } else if (losslessWebp.length < originalSize * 0.95) {
        optimizedBuffer = losslessWebp;
        optimizedMime = 'image/webp';
        strategy = 'webp-lossless';
        processingNote = 'تم تحويل الصورة الشفافة إلى WebP بدون فقدان جودة مع الحفاظ على الشفافية';
      }
    } else if (sourceFormat === 'png' || sourceFormat === 'tiff' || sourceFormat === 'bmp') {
      // Opaque graphic or uncompressed raster: prefer Lossless WebP for logos/diagrams,
      // or high-quality WebP lossy when photographic/large PNG produces dramatic savings
      const losslessWebp = await buildPipeline()
        .webp({ lossless: true, effort: 5 })
        .toBuffer();

      if (losslessWebp.length <= 250 * 1024 && losslessWebp.length < originalSize * 0.95) {
        optimizedBuffer = losslessWebp;
        optimizedMime = 'image/webp';
        strategy = 'webp-lossless';
        processingNote = 'تم تحسين الصورة بدون فقدان جودة (Lossless WebP) مع الحفاظ على الأبعاد';
      } else {
        const quality = originalSize > 2 * 1024 * 1024 ? 86 : 88;
        const lossyWebp = await buildPipeline()
          .webp({ quality, smartSubsample: true, effort: 5 })
          .toBuffer();

        if (lossyWebp.length < losslessWebp.length * 0.75 && lossyWebp.length < originalSize * 0.9) {
          optimizedBuffer = lossyWebp;
          optimizedMime = 'image/webp';
          strategy = 'webp-lossy';
          processingNote = 'تم تحسين الصورة بصيغة WebP عالية الجودة مع تقليص ملحوظ في الحجم';
        } else if (losslessWebp.length < originalSize * 0.95) {
          optimizedBuffer = losslessWebp;
          optimizedMime = 'image/webp';
          strategy = 'webp-lossless';
          processingNote = 'تم تحسين الصورة بدون فقدان جودة (Lossless WebP) مع الحفاظ على الأبعاد';
        }
      }
    } else {
      // Photographic formats (JPEG / WebP / AVIF / HEIF)
      const quality = originalSize > 2 * 1024 * 1024 ? 86 : 88;
      const lossyWebp = await buildPipeline()
        .webp({ quality, smartSubsample: true, effort: 5 })
        .toBuffer();

      if (lossyWebp.length < originalSize * 0.92) {
        optimizedBuffer = lossyWebp;
        optimizedMime = 'image/webp';
        strategy = 'webp-lossy';
        processingNote = 'تم تحويل الصورة الفوتوغرافية إلى WebP عالي الجودة مع الحفاظ على التفاصيل والأبعاد';
      }
    }
  } catch (err) {
    // Graceful non-destructive fallback when a valid image fails encoding
    if (options.forceOriginalOnEncodeFailure !== false) {
      optimizedBuffer = rawBuffer;
      optimizedMime = originalMime;
      strategy = 'fallback-original';
      processingNote = 'تعذر ضغط الصورة بالخوارزمية الذكية، فتم حفظ النسخة الأصلية مباشرة لحماية البيانات';
    } else {
      throw err;
    }
  }

  // Final guard: never store an "optimized" blob larger than original
  if (optimizedBuffer.length >= originalSize) {
    optimizedBuffer = rawBuffer;
    optimizedMime = originalMime;
    if (strategy !== 'fallback-original') {
      strategy = 'original-kept';
      processingNote = 'تم الاحتفاظ بالصورة الأصلية لعدم وجود جدوى من إعادة الضغط';
    }
  }

  const optimizedSha256 = computeSha256(optimizedBuffer);

  const info = db
    .prepare(
      `INSERT INTO media_assets (
         original_sha256, optimized_sha256, original_filename, category,
         original_mime, optimized_mime, original_size, optimized_size,
         width, height, has_alpha, strategy, is_processed, processing_note,
         original_blob, optimized_blob
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    )
    .run(
      incomingSha256,
      optimizedSha256,
      filename,
      category,
      originalMime,
      optimizedMime,
      originalSize,
      optimizedBuffer.length,
      width,
      height,
      hasAlpha ? 1 : 0,
      strategy,
      processingNote,
      rawBuffer,
      optimizedBuffer
    );

  return getMediaAssetMetaById(db, Number(info.lastInsertRowid));
}

export async function getMediaAssetBlob(
  db: SqliteDb,
  id: number,
  variant: 'optimized' | 'original' | 'compat',
  preferCompatFormat?: 'png' | 'jpeg'
): Promise<{
  buffer: Buffer;
  mime: string;
  sha256: string;
  filename: string;
  has_alpha: boolean;
}> {
  const row = db
    .prepare(
      `SELECT id, original_sha256, optimized_sha256, original_filename,
              original_mime, optimized_mime, has_alpha,
              original_blob, optimized_blob
       FROM media_assets
       WHERE id = ?`
    )
    .get(id) as MediaAssetRow | undefined;

  if (!row || !row.original_blob || !row.optimized_blob) {
    throw new ServiceError('تعذر العثور على ملف الصورة المطلوب.', 404, 'MEDIA_NOT_FOUND');
  }

  const baseName = (row.original_filename || `image-${row.id}`).replace(/\.[^.]+$/, '');

  if (variant === 'original') {
    const ext = row.original_mime.split('/')[1]?.replace('+xml', '') || 'bin';
    return {
      buffer: Buffer.from(row.original_blob),
      mime: row.original_mime,
      sha256: row.original_sha256,
      filename: `${baseName}.${ext}`,
      has_alpha: Boolean(row.has_alpha),
    };
  }

  if (variant === 'optimized') {
    const ext = row.optimized_mime.split('/')[1]?.replace('+xml', '') || 'webp';
    return {
      buffer: Buffer.from(row.optimized_blob),
      mime: row.optimized_mime,
      sha256: row.optimized_sha256,
      filename: `${baseName}.${ext}`,
      has_alpha: Boolean(row.has_alpha),
    };
  }

  // 'compat': On-demand temporary conversion to universally compatible PNG/JPEG without altering stored DB blobs
  const optMime = row.optimized_mime;
  const hasAlpha = Boolean(row.has_alpha);

  if (
    !preferCompatFormat &&
    (optMime === 'image/png' || optMime === 'image/jpeg')
  ) {
    const ext = optMime === 'image/png' ? 'png' : 'jpg';
    return {
      buffer: Buffer.from(row.optimized_blob),
      mime: optMime,
      sha256: row.optimized_sha256,
      filename: `${baseName}.${ext}`,
      has_alpha: hasAlpha,
    };
  }

  const usePng = preferCompatFormat === 'png' || (preferCompatFormat !== 'jpeg' && (hasAlpha || optMime === 'image/svg+xml'));
  const sourceBlob = Buffer.from(row.optimized_blob);

  const compatBuffer = usePng
    ? await sharp(sourceBlob).png({ compressionLevel: 6 }).toBuffer()
    : await sharp(sourceBlob).flatten({ background: '#ffffff' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();

  return {
    buffer: compatBuffer,
    mime: usePng ? 'image/png' : 'image/jpeg',
    sha256: computeSha256(compatBuffer),
    filename: `${baseName}.${usePng ? 'png' : 'jpg'}`,
    has_alpha: usePng ? hasAlpha : false,
  };
}

export async function resolveMediaAssetDataUrl(
  db: SqliteDb,
  id: number,
  variant: 'optimized' | 'original' | 'compat' = 'compat'
): Promise<string> {
  const { buffer, mime } = await getMediaAssetBlob(db, id, variant);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

export async function convertLegacyDataUrlToCompatDataUrl(dataUrl: string): Promise<string> {
  const match = dataUrl.trim().match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return dataUrl;
  const mime = match[1].toLowerCase();
  if (mime === 'image/png' || mime === 'image/jpeg') {
    return dataUrl;
  }
  const raw = Buffer.from(match[2], 'base64');
  const meta = await sharp(raw).metadata();
  const usePng = Boolean(meta.hasAlpha) || mime === 'image/svg+xml';
  const out = usePng
    ? await sharp(raw).png({ compressionLevel: 6 }).toBuffer()
    : await sharp(raw).flatten({ background: '#ffffff' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  return `data:${usePng ? 'image/png' : 'image/jpeg'};base64,${out.toString('base64')}`;
}

export function decodeBase64DataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const match = dataUrl.trim().match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const base64Clean = match[2].replace(/\s+/g, '');
  const buffer = Buffer.from(base64Clean, 'base64');
  if (buffer.length === 0) return null;
  return { mime, buffer };
}

/**
 * Safely migrates any legacy base64 data URLs in school_settings & students
 * into the centralized media_assets table without altering or losing existing data.
 */
export async function migrateLegacyDataUrlsToMediaAssets(db: SqliteDb): Promise<{
  migrated_school_logo: boolean;
  migrated_students_count: number;
  skipped_errors: number;
}> {
  let migratedSchoolLogo = false;
  let migratedStudentsCount = 0;
  let skippedErrors = 0;

  try {
    const settingsRow = db
      .prepare('SELECT id, school_logo_data, school_logo_asset_id FROM school_settings WHERE id = 1')
      .get() as { id: number; school_logo_data: string | null; school_logo_asset_id: number | null } | undefined;

    if (
      settingsRow &&
      !settingsRow.school_logo_asset_id &&
      settingsRow.school_logo_data &&
      settingsRow.school_logo_data.startsWith('data:image/')
    ) {
      const decoded = decodeBase64DataUrl(settingsRow.school_logo_data);
      if (decoded) {
        const asset = await processAndStoreImage(db, decoded.buffer, {
          category: 'school_logo',
          mimeHint: decoded.mime,
          filename: 'legacy-school-logo',
        });
        db.prepare(
          `UPDATE school_settings
           SET school_logo_asset_id = ?, school_logo_data = ?, updated_at = datetime('now')
           WHERE id = 1`
        ).run(asset.id, asset.optimized_url);
        migratedSchoolLogo = true;
      }
    }
  } catch {
    skippedErrors += 1;
  }

  const studentRows = db
    .prepare(
      `SELECT id, photo_data
       FROM students
       WHERE photo_asset_id IS NULL AND photo_data IS NOT NULL AND photo_data LIKE 'data:image/%'`
    )
    .all() as Array<{ id: number; photo_data: string }>;

  for (const st of studentRows) {
    try {
      const decoded = decodeBase64DataUrl(st.photo_data);
      if (!decoded) continue;
      const asset = await processAndStoreImage(db, decoded.buffer, {
        category: 'student_photo',
        mimeHint: decoded.mime,
        filename: `student-${st.id}`,
      });
      db.prepare(
        `UPDATE students
         SET photo_asset_id = ?, photo_data = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(asset.id, asset.optimized_url, st.id);
      migratedStudentsCount += 1;
    } catch {
      skippedErrors += 1;
    }
  }

  return {
    migrated_school_logo: migratedSchoolLogo,
    migrated_students_count: migratedStudentsCount,
    skipped_errors: skippedErrors,
  };
}
