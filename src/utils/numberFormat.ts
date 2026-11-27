export type NumberDisplayMode = 'arabic' | 'english';

const ARABIC_INDIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'] as const;

const ARABIC_WEEKDAYS = [
  'الأحد',
  'الإثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;

const ARABIC_MONTH_NAMES = [
  'كانون الثاني',
  'شباط',
  'آذار',
  'نيسان',
  'أيار',
  'حزيران',
  'تموز',
  'آب',
  'أيلول',
  'تشرين الأول',
  'تشرين الثاني',
  'كانون الأول',
] as const;

/**
 * Normalizes any Arabic-Indic (٠-٩) or Eastern Arabic-Indic (۰-۹) digit to ASCII 0-9.
 */
export function normalizeToAsciiDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (ch) => String(ch.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0));
}

/**
 * Converts digits in a string deterministically to Arabic-Indic (٠-٩) or English ASCII (0-9).
 * Does not depend on OS/browser locale variations.
 */
export function convertRawDigits(input: string, mode: NumberDisplayMode): string {
  const ascii = normalizeToAsciiDigits(input);
  if (mode === 'english') {
    return ascii;
  }
  return ascii.replace(/\d/g, (digit) => ARABIC_INDIC_DIGITS[Number(digit)] ?? digit);
}

/**
 * Matches technical tokens whose digits must NOT be localized:
 * - URLs / API / data URIs
 * - Email addresses
 * - IPv4 addresses (optionally with port)
 * - Internal technical UIDs such as STU-2026-0001
 */
const TECHNICAL_TOKEN_REGEX =
  /(https?:\/\/[^\s<>"'()]+|\/api\/[^\s<>"'()]+|data:[^\s<>"'()]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b|\bSTU-[A-Za-z0-9-]+\b)/g;

/**
 * Converts user-facing digits in a string according to `mode`, while keeping technical tokens
 * (URLs, IPs, emails, STU-... codes) untouched in ASCII.
 */
export function convertDigits(
  value: string | number | null | undefined,
  mode: NumberDisplayMode
): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!text) return '';

  let result = '';
  let lastIndex = 0;
  TECHNICAL_TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TECHNICAL_TOKEN_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result += convertRawDigits(text.slice(lastIndex, match.index), mode);
    }
    result += match[0];
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    result += convertRawDigits(text.slice(lastIndex), mode);
  }

  return result;
}

/**
 * Formats an integer or numeric identifier without thousands separators
 * (ideal for sequence `ت`, thresholds, day counts, registry numbers, years, IDs).
 */
export function formatPlainNumber(
  value: number | string | null | undefined,
  mode: NumberDisplayMode,
  fallback = '—'
): string {
  if (value === null || value === undefined || value === '') return fallback;
  return convertRawDigits(String(value), mode);
}

/**
 * Formats summary/dashboard counts with deterministic thousands grouping and digits.
 */
export function formatCount(
  value: number | string | null | undefined,
  mode: NumberDisplayMode,
  fallback = '—'
): string {
  if (value === null || value === undefined || value === '') return fallback;
  const num = typeof value === 'number' ? value : Number(normalizeToAsciiDigits(String(value)));
  if (!Number.isFinite(num)) {
    return convertDigits(String(value), mode);
  }
  const grouped = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(num);
  if (mode === 'english') {
    return grouped;
  }
  return convertRawDigits(grouped.replace(/,/g, '٬'), 'arabic');
}

/**
 * Formats ISO date (`YYYY-MM-DD`) or ISO timestamp (`YYYY-MM-DD HH:MM:SS`) as `DD-MM-YYYY`
 * (optionally appending `HH:MM`) with digits formatted according to `mode`.
 * Never alters raw data; strictly display-only.
 */
export function formatDateDMY(
  raw: string | null | undefined,
  mode: NumberDisplayMode,
  options?: { includeTime?: boolean; fallback?: string }
): string {
  const fallback = options?.fallback ?? '—';
  if (!raw) return fallback;
  const trimmed = normalizeToAsciiDigits(String(raw).trim());
  if (!trimmed) return fallback;

  const isoMatch = trimmed.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?Z?)?$/
  );
  if (isoMatch) {
    const [, year, month, day, hour, minute] = isoMatch;
    const dd = day.padStart(2, '0');
    const mm = month.padStart(2, '0');
    let formatted = `${dd}-${mm}-${year}`;
    if (options?.includeTime && hour !== undefined && minute !== undefined) {
      formatted += ` ${hour.padStart(2, '0')}:${minute}`;
    }
    return convertRawDigits(formatted, mode);
  }

  const dmyMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    const [, day, month, year] = dmyMatch;
    return convertRawDigits(`${day.padStart(2, '0')}-${month.padStart(2, '0')}-${year}`, mode);
  }

  return convertDigits(raw, mode);
}

/**
 * Normalizes an academic year string (e.g. `2026-2027`) in logical left-to-right order
 * with digits formatted according to `mode`.
 * Always render inside an LTR-isolated span in RTL layouts.
 */
export function formatAcademicYearDisplay(
  yearName: string | null | undefined,
  mode: NumberDisplayMode,
  fallback = '—'
): string {
  if (!yearName) return fallback;
  const normalized = normalizeToAsciiDigits(String(yearName).trim());
  if (!normalized) return fallback;

  const yearRange = normalized.match(/^(\d{4})\s*[-–/]\s*(\d{4})$/);
  if (yearRange) {
    return convertRawDigits(`${yearRange[1]}-${yearRange[2]}`, mode);
  }

  return convertDigits(normalized, mode);
}

/**
 * Formats today's (or a given Date's) Arabic long date deterministically
 * (e.g. `الخميس، 26 تشرين الثاني 2026` or `الخميس، ٢٦ تشرين الثاني ٢٠٢٦`).
 */
export function formatArabicLongDate(
  mode: NumberDisplayMode,
  date: Date = new Date()
): string {
  const weekday = ARABIC_WEEKDAYS[date.getDay()] ?? '';
  const day = date.getDate();
  const monthName = ARABIC_MONTH_NAMES[date.getMonth()] ?? '';
  const year = date.getFullYear();
  return convertRawDigits(`${weekday}، ${day} ${monthName} ${year}`, mode);
}

export interface BidiSegment {
  text: string;
  ltr: boolean;
}

/**
 * Splits mixed RTL/LTR text (such as official document numbers `ق/401`, `12-401`, `2026/15`,
 * or official letter paragraphs containing years/numbers) into segments where technical tokens
 * and contiguous numeric/compound-numeric expressions are marked `ltr: true` for isolated
 * `<span dir="ltr" style="unicode-bidi: isolate;">` rendering, while Arabic words and
 * non-numeric punctuation stay `ltr: false` inside RTL context.
 */
export function tokenizeBidiText(
  input: string | number | null | undefined,
  mode: NumberDisplayMode
): BidiSegment[] {
  if (input === null || input === undefined) return [];
  const raw = String(input);
  if (!raw) return [];

  const segments: BidiSegment[] = [];
  let lastIndex = 0;
  TECHNICAL_TOKEN_REGEX.lastIndex = 0;
  let techMatch: RegExpExecArray | null;

  const pushNonTech = (chunk: string) => {
    if (!chunk) return;
    const converted = convertRawDigits(chunk, mode);
    const numRunRegex = /[0-9٠-٩]+(?:[-/.:][0-9٠-٩]+)*/g;
    let chunkLast = 0;
    let numMatch: RegExpExecArray | null;

    while ((numMatch = numRunRegex.exec(converted)) !== null) {
      if (numMatch.index > chunkLast) {
        segments.push({ text: converted.slice(chunkLast, numMatch.index), ltr: false });
      }
      segments.push({ text: numMatch[0], ltr: true });
      chunkLast = numMatch.index + numMatch[0].length;
    }

    if (chunkLast < converted.length) {
      segments.push({ text: converted.slice(chunkLast), ltr: false });
    }
  };

  while ((techMatch = TECHNICAL_TOKEN_REGEX.exec(raw)) !== null) {
    if (techMatch.index > lastIndex) {
      pushNonTech(raw.slice(lastIndex, techMatch.index));
    }
    segments.push({ text: techMatch[0], ltr: true });
    lastIndex = techMatch.index + techMatch[0].length;
  }

  if (lastIndex < raw.length) {
    pushNonTech(raw.slice(lastIndex));
  }

  return segments;
}

export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders mixed Arabic + numeric/year/document-number text to HTML with `dir="ltr"` +
 * `unicode-bidi: isolate` spans around numeric/compound-numeric and technical runs.
 */
export function formatBidiHtmlText(
  input: string | number | null | undefined,
  mode: NumberDisplayMode
): string {
  const segments = tokenizeBidiText(input, mode);
  if (segments.length === 0) return '';
  return segments
    .map((seg) => {
      const escaped = escapeHtmlText(seg.text);
      return seg.ltr ? `<span class="ltr-isolate" dir="ltr">${escaped}</span>` : escaped;
    })
    .join('');
}

/**
 * Wraps a preformatted LTR string (such as `DD-MM-YYYY` or `YYYY-YYYY`) in an HTML LTR-isolated span.
 */
export function formatIsolatedLtrHtml(text: string): string {
  return `<span class="ltr-isolate" dir="ltr">${escapeHtmlText(text)}</span>`;
}
