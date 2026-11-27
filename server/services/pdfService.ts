import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import type { SqliteDb } from '../db/connection';
import type { SchoolSettings } from '../../src/types/school';
import {
  buildOfficialLetterPdfHtml,
  buildStageReportPdfHtml,
} from '../../src/utils/officialDocumentHtml';
import { getDynamicStageReport, getIssuedLetterById } from './absenceStagesService';
import {
  convertLegacyDataUrlToCompatDataUrl,
  resolveAssetIdFromImageRef,
  resolveMediaAssetDataUrl,
} from './imageService';
import { getSchoolSettings } from './settingsService';
import { ServiceError } from '../utils/validation';

const execFileAsync = promisify(execFile);

let cachedBrowserPath: string | null = null;
let cachedFontCss: string | null = null;
let cachedOfficialLetterFontCss: string | null = null;

function findFileRecursive(dir: string, targetNames: Set<string>, maxDepth = 4): string | null {
  if (maxDepth < 0 || !fs.existsSync(dir)) return null;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && targetNames.has(entry.name)) {
      return full;
    }
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = findFileRecursive(path.join(dir, entry.name), targetNames, maxDepth - 1);
      if (found) return found;
    }
  }
  return null;
}

export function resolveHeadlessBrowserPath(): string | null {
  if (cachedBrowserPath && fs.existsSync(cachedBrowserPath)) {
    return cachedBrowserPath;
  }

  const envCandidates = [process.env.PDF_BROWSER_PATH, process.env.CHROME_PATH].filter(
    (v): v is string => Boolean(v && v.trim())
  );
  for (const candidate of envCandidates) {
    if (fs.existsSync(candidate)) {
      cachedBrowserPath = candidate;
      return candidate;
    }
  }

  const staticCandidates = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/microsoft-edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const candidate of staticCandidates) {
    if (fs.existsSync(candidate)) {
      cachedBrowserPath = candidate;
      return candidate;
    }
  }

  const targetNames = new Set([
    'chrome-headless-shell',
    'chrome-headless-shell.exe',
    'chrome',
    'chromium',
  ]);
  const playwrightDirs = [
    '/ms-playwright',
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    '/root/.cache/ms-playwright',
  ];

  for (const dir of playwrightDirs) {
    const found = findFileRecursive(dir, targetNames, 4);
    if (found) {
      cachedBrowserPath = found;
      return found;
    }
  }

  return null;
}

export function buildEmbeddedArabicFontCss(): string {
  if (cachedFontCss !== null) return cachedFontCss;

  const regularCandidates = [
    '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf',
  ];
  const boldCandidates = [
    '/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf',
    '/usr/share/fonts/truetype/noto/NotoNaskhArabic-Bold.ttf',
  ];

  const regularPath = regularCandidates.find((p) => fs.existsSync(p));
  const boldPath = boldCandidates.find((p) => fs.existsSync(p));

  const chunks: string[] = [];
  if (regularPath) {
    const b64 = fs.readFileSync(regularPath).toString('base64');
    chunks.push(`
      @font-face {
        font-family: 'EmbeddedNotoArabic';
        font-style: normal;
        font-weight: 400;
        src: url('data:font/ttf;base64,${b64}') format('truetype');
      }
    `);
  }
  if (boldPath) {
    const b64 = fs.readFileSync(boldPath).toString('base64');
    chunks.push(`
      @font-face {
        font-family: 'EmbeddedNotoArabic';
        font-style: normal;
        font-weight: 700 900;
        src: url('data:font/ttf;base64,${b64}') format('truetype');
      }
    `);
  }

  cachedFontCss = chunks.join('\n');
  return cachedFontCss;
}

export function buildEmbeddedOfficialLetterFontCss(): string {
  if (cachedOfficialLetterFontCss !== null) return cachedOfficialLetterFontCss;

  const regularCandidates = [
    path.resolve(process.cwd(), 'public/fonts/NotoNaskhArabic-Regular.ttf'),
    '/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
  ];
  const boldCandidates = [
    path.resolve(process.cwd(), 'public/fonts/NotoNaskhArabic-Bold.ttf'),
    '/usr/share/fonts/truetype/noto/NotoNaskhArabic-Bold.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf',
  ];

  const regularPath = regularCandidates.find((p) => fs.existsSync(p));
  const boldPath = boldCandidates.find((p) => fs.existsSync(p));

  const chunks: string[] = [];
  if (regularPath) {
    const b64 = fs.readFileSync(regularPath).toString('base64');
    chunks.push(`
      @font-face {
        font-family: 'EmbeddedOfficialNaskhArabic';
        font-style: normal;
        font-weight: 400;
        src: url('data:font/ttf;base64,${b64}') format('truetype');
      }
    `);
  }
  if (boldPath) {
    const b64 = fs.readFileSync(boldPath).toString('base64');
    chunks.push(`
      @font-face {
        font-family: 'EmbeddedOfficialNaskhArabic';
        font-style: normal;
        font-weight: 700 900;
        src: url('data:font/ttf;base64,${b64}') format('truetype');
      }
    `);
  }

  cachedOfficialLetterFontCss = chunks.join('\n');
  return cachedOfficialLetterFontCss;
}

export async function resolveSchoolLogoDataUri(
  db: SqliteDb,
  settings: SchoolSettings
): Promise<string | null> {
  const assetId =
    settings.school_logo_asset_id ?? resolveAssetIdFromImageRef(settings.school_logo_data);

  if (assetId) {
    try {
      return await resolveMediaAssetDataUrl(db, assetId, 'compat');
    } catch {
      // ignore and fall back to inline data URL if any
    }
  }

  if (settings.school_logo_data && settings.school_logo_data.trim().startsWith('data:image/')) {
    try {
      return await convertLegacyDataUrlToCompatDataUrl(settings.school_logo_data);
    } catch {
      return settings.school_logo_data.trim();
    }
  }

  return null;
}

export async function renderHtmlToPdfBuffer(html: string): Promise<Buffer> {
  const browserPath = resolveHeadlessBrowserPath();
  if (!browserPath) {
    throw new ServiceError(
      'محرك إنشاء ملفات PDF غير متوفر على الخادم حالياً.',
      500,
      'PDF_ENGINE_UNAVAILABLE'
    );
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-pdf-'));
  const htmlPath = path.join(tmpDir, 'document.html');
  const pdfPath = path.join(tmpDir, 'document.pdf');

  try {
    fs.writeFileSync(htmlPath, html, 'utf8');
    await execFileAsync(
      browserPath,
      [
        '--headless',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-pdf-header-footer',
        `--print-to-pdf=${pdfPath}`,
        `file://${htmlPath}`,
      ],
      { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
    );

    if (!fs.existsSync(pdfPath)) {
      throw new ServiceError('فشل إنشاء ملف PDF.', 500, 'PDF_GENERATION_FAILED');
    }

    const buffer = fs.readFileSync(pdfPath);
    if (buffer.length < 100 || !buffer.subarray(0, 5).toString('ascii').startsWith('%PDF-')) {
      throw new ServiceError('تم إنشاء ملف PDF غير صالح.', 500, 'INVALID_PDF_OUTPUT');
    }

    return buffer;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  }
}

export function buildFilterSummaryText(
  db: SqliteDb,
  query: { grade_id?: number; section_id?: number; search?: string }
): string {
  const parts: string[] = [];
  if (query.grade_id) {
    const g = db.prepare('SELECT name FROM grades WHERE id = ?').get(query.grade_id) as
      | { name: string }
      | undefined;
    if (g) parts.push(`الصف: ${g.name}`);
  }
  if (query.section_id) {
    const s = db.prepare('SELECT name FROM sections WHERE id = ?').get(query.section_id) as
      | { name: string }
      | undefined;
    if (s) parts.push(`الشعبة: ${s.name}`);
  }
  if (query.search && query.search.trim()) {
    parts.push(`بحث: ${query.search.trim()}`);
  }
  return parts.join(' · ');
}

export async function generateStageReportDocumentHtml(
  db: SqliteDb,
  query: {
    academic_year_id?: number;
    stage_id?: number;
    grade_id?: number;
    section_id?: number;
    search?: string;
  }
): Promise<{ html: string; filename: string }> {
  const report = getDynamicStageReport(db, query);
  const logoDataUri = await resolveSchoolLogoDataUri(db, report.school_settings);
  const filterSummary = buildFilterSummaryText(db, query);
  const extraFontCss = buildEmbeddedArabicFontCss();

  const html = buildStageReportPdfHtml({
    report,
    logoDataUri,
    filterSummary: filterSummary || undefined,
    extraFontCss,
  });

  const stageLabel = (report.current_stage?.name || 'تقرير_الغياب').replace(/[/\\:*?"<>|]+/g, '_');
  const filename = `تقرير_${stageLabel}_${report.academic_year.name}.pdf`;
  return { html, filename };
}

export async function generateIssuedLetterDocumentHtml(
  db: SqliteDb,
  letterId: number
): Promise<{ html: string; filename: string }> {
  const letter = getIssuedLetterById(db, letterId);
  const settings = getSchoolSettings(db);
  const yearRow = db
    .prepare('SELECT name FROM academic_years WHERE id = ?')
    .get(letter.academic_year_id) as { name: string } | undefined;
  const academicYearName = yearRow?.name || settings.academic_year_name || 'العام الدراسي';
  const logoDataUri = await resolveSchoolLogoDataUri(db, settings);
  const extraFontCss = buildEmbeddedOfficialLetterFontCss();

  const html = buildOfficialLetterPdfHtml({
    letter,
    schoolSettings: settings,
    academicYearName,
    logoDataUri,
    extraFontCss,
  });

  const docNumSafe = (letter.document_number || String(letter.id)).replace(/[/\\:*?"<>|]+/g, '_');
  const filename = `كتاب_رسمي_${docNumSafe}.pdf`;
  return { html, filename };
}
