export class ServiceError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 400, code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ServiceError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function normalizeWhitespace(value: string | null | undefined): string {
  if (!value) return '';
  return value.replace(/\s+/g, ' ').trim();
}

export function normalizeArabicLookup(value: string | null | undefined): string {
  return normalizeWhitespace(value)
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase();
}

export function normalizeNullableString(value: string | null | undefined): string | null {
  const trimmed = normalizeWhitespace(value);
  return trimmed.length > 0 ? trimmed : null;
}

export function validateBirthDate(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value);
  if (!normalized) return null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new ServiceError('صيغة تاريخ الميلاد غير صحيحة. يجب أن تكون بصيغة YYYY-MM-DD.', 400);
  }
  const date = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new ServiceError('تاريخ الميلاد المدخل غير صالح.', 400);
  }
  return normalized;
}

export function validateEnrollmentDate(value: string | null | undefined): string {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    return new Date().toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new ServiceError('صيغة تاريخ التسجيل غير صحيحة. يجب أن تكون بصيغة YYYY-MM-DD.', 400);
  }
  return normalized;
}

export function validatePhotoDataUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const isMediaRef =
    /^\/api\/media\/\d+\/(?:optimized|original|compat)(?:\?.*)?$/i.test(trimmed) ||
    /^app-media:\/\/asset\/\d+\/(?:optimized|original|compat)(?:\?.*)?$/i.test(trimmed);

  if (isMediaRef) {
    return trimmed;
  }

  const allowedPrefix = /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/i;
  if (!allowedPrefix.test(trimmed)) {
    throw new ServiceError(
      'مرجع أو صيغة الصورة غير مدعومة. يسمح برفع الصور عبر الخدمة المركزية أو بصيغ PNG وJPG وWebP وGIF وSVG.',
      400
    );
  }
  return trimmed;
}

export function isValidStudentFullName(name: string): boolean {
  const clean = normalizeWhitespace(name);
  if (clean.length < 3) return false;
  const parts = clean.split(' ').filter(Boolean);
  return parts.length >= 2;
}
