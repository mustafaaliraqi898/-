import type { ImageCategory, MediaAssetInfo } from '../types/school';
import { schoolService } from '../services/schoolService';

export const ACCEPTED_IMAGE_INPUT =
  'image/png,image/jpeg,image/webp,image/gif,image/avif,image/tiff,image/svg+xml';

export function formatBytesReadable(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 بايت';
  if (bytes < 1024) return `${bytes} بايت`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} ك.ب`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} م.ب`;
}

export function describeMediaProcessingResult(asset: MediaAssetInfo): string {
  const dims =
    asset.width && asset.height ? `${asset.width}×${asset.height}` : 'متجهي';

  if (asset.deduplicated && asset.skipped_recompression) {
    return `صورة معالجة مسبقاً (${dims}) • لم تُعد معالجتها (${formatBytesReadable(asset.optimized_size)})`;
  }
  if (asset.strategy === 'original-kept' || asset.strategy === 'fallback-original') {
    return `تم الحفظ بدون فقدان (${dims}) • ${formatBytesReadable(asset.optimized_size)}`;
  }
  const modeLabel = asset.strategy === 'webp-lossless' ? 'ضغط دون فقدان' : 'تحسين ذكي';
  if (asset.reduction_percent > 0) {
    return `${modeLabel} (${dims}) • تم تقليص الحجم بنسبة ${asset.reduction_percent}% (${formatBytesReadable(asset.original_size)} ← ${formatBytesReadable(asset.optimized_size)})`;
  }
  return `${modeLabel} (${dims}) • ${formatBytesReadable(asset.optimized_size)}`;
}

/**
 * Centralized client image upload & processing entry point.
 * Sends the unmodified original file to the server/Electron image service
 * without enforcing tiny client-side byte limits.
 */
export async function processAndUploadImageFile(
  file: File,
  category: ImageCategory
): Promise<MediaAssetInfo> {
  if (!file || file.size === 0) {
    throw new Error('الملف المختار فارغ أو غير صالح.');
  }

  return schoolService.uploadImage(file, category);
}

/**
 * Resolves any stored image reference (/api/media/:id/optimized, app-media://, or data:image/...)
 * into a self-contained universal PNG/JPEG data URL suitable for offline standalone HTML print
 * or legacy PDF/print tools without altering the stored optimized WebP in the database.
 */
export async function resolvePrintableImageDataUrl(
  imageSrc: string | null | undefined
): Promise<string | null> {
  if (!imageSrc) return null;
  const trimmed = imageSrc.trim();
  if (!trimmed) return null;

  const mediaMatch =
    trimmed.match(/^\/api\/media\/(\d+)\/(?:optimized|original|compat)/i) ||
    trimmed.match(/^app-media:\/\/asset\/(\d+)\/(?:optimized|original|compat)/i);

  if (mediaMatch) {
    const assetId = Number(mediaMatch[1]);
    try {
      return await schoolService.getMediaCompatDataUrl(assetId);
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}
