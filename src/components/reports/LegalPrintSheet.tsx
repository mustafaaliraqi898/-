import { useEffect } from 'react';
import type {
  EducationalStage,
  LegalProcedureType,
  LegalStageRegulation,
  ReportCategoryId,
  ReportsCenterResponse,
  ReportsCenterStudentRow,
  SchoolSettings,
  StudentLegalProcedureRecord,
} from '../../types/school';

export type LegalPrintKind =
  | 'report_list'
  | 'warning_letter'
  | 'summons_letter'
  | 'procedures_log';

export type LetterIssueMode = 'official' | 'draft';

export const REPORT_TITLE_MAP: Record<ReportCategoryId, string> = {
  preliminary_warnings: 'تقرير التحذيرات الأولية',
  first_warnings: 'تقرير الإنذار الأول',
  final_warnings: 'تقرير الإنذار النهائي',
  effective_limit_reached: 'كشف الطلاب الذين بلغوا حد الغياب المؤثر',
  guardian_notifications: 'سجل تبليغات أولياء الأمور',
  guardian_summons: 'سجل استدعاءات أولياء الأمور',
};

export const PROCEDURE_LABELS_MAP: Record<LegalProcedureType, string> = {
  preliminary_warning: 'تحذير أولي',
  first_warning: 'إنذار أول',
  final_warning: 'إنذار نهائي',
  effective_limit_notice: 'إشعار بلوغ حد الغياب المؤثر',
  guardian_notification: 'تبليغ ولي أمر',
  guardian_summons: 'استدعاء ولي أمر',
};

function escapeHtml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function canIssueOfficialLetter(reg: LegalStageRegulation | null): boolean {
  return Boolean(
    reg &&
      reg.is_legally_approved === 1 &&
      reg.official_letter_approved === 1 &&
      reg.thresholds_are_provisional === 0
  );
}

export function formatDecisionReference(reg: LegalStageRegulation | null): string {
  if (!reg) return 'غير محدد';
  if (reg.is_legally_approved !== 1) {
    return 'ضابطة غير معتمدة قانونياً (مسودة إدارية داخلية)';
  }
  const parts: string[] = [];
  if (reg.decision_name) parts.push(reg.decision_name);
  if (reg.decision_number) parts.push(`رقم ${reg.decision_number}`);
  if (reg.decision_issue_date) parts.push(`بتاريخ ${reg.decision_issue_date}`);
  return parts.length > 0 ? parts.join(' — ') : 'معتمد قانونياً';
}

export function fillLetterTemplate(params: {
  template: string;
  student: ReportsCenterStudentRow;
  regulation: LegalStageRegulation | null;
  schoolSettings: SchoolSettings;
  academicYearName: string;
  todayDate?: string;
}): string {
  const { template, student, regulation, schoolSettings, academicYearName } = params;
  const today = params.todayDate ?? new Date().toISOString().slice(0, 10);
  const threshold =
    student.report_threshold_days ??
    student.next_threshold_days ??
    regulation?.final_effective_limit_days ??
    '—';
  const remaining =
    student.remaining_days_to_next_threshold !== null
      ? String(student.remaining_days_to_next_threshold)
      : '—';

  const replacements: Record<string, string> = {
    '{{student_name}}': student.full_name,
    '{{grade_name}}': student.grade_name,
    '{{section_name}}': student.section_name,
    '{{stage_name}}': student.stage_name ?? 'غير محددة',
    '{{counted_days}}': String(student.counted_legal_absence_days),
    '{{unexcused_days}}': String(student.unexcused_absence_days),
    '{{threshold_days}}': String(threshold),
    '{{remaining_days}}': remaining,
    '{{decision_ref}}': formatDecisionReference(regulation),
    '{{school_name}}': schoolSettings.school_name,
    '{{academic_year}}': academicYearName,
    '{{today_date}}': today,
  };

  let out = template;
  for (const [token, val] of Object.entries(replacements)) {
    out = out.split(token).join(val);
  }
  return out;
}

const DEFAULT_CREST_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="54" height="54" fill="none">
  <circle cx="32" cy="32" r="29" stroke="#0f766e" stroke-width="2.5" fill="#f0fdfa"/>
  <path d="M18 22h11c2 0 3 1.2 3 3v19c0-1.5-1.5-2.5-3.5-2.5H18V22zm28 0H35c-2 0-3 1.2-3 3v19c0-1.5 1.5-2.5 3.5-2.5H46V22z" stroke="#0f766e" stroke-width="2.2" stroke-linejoin="round" fill="#ffffff"/>
  <path d="M32 14l2.2 4.4 4.8.7-3.5 3.4.8 4.8-4.3-2.3-4.3 2.3.8-4.8-3.5-3.4 4.8-.7L32 14z" fill="#b45309"/>
</svg>`;

export interface LegalPrintPayload {
  kind: LegalPrintKind;
  data: ReportsCenterResponse;
  student?: ReportsCenterStudentRow | null;
  letterMode: LetterIssueMode;
  letterTitle?: string;
  letterNumber?: string;
  letterDate?: string;
  customBody?: string;
  recipientLabel?: string;
}

export function buildLegalStandaloneHtml(payload: LegalPrintPayload): string {
  const { kind, data, student, letterMode, customBody, letterTitle, letterNumber, letterDate, recipientLabel } =
    payload;
  const school = data.school_settings;
  const logoHtml = school.school_logo_data
    ? `<img src="${escapeHtml(school.school_logo_data)}" alt="شعار المدرسة" class="school-logo" />`
    : DEFAULT_CREST_SVG;

  const isLandscape = kind === 'report_list' || kind === 'procedures_log';
  const pageSizeCss = isLandscape ? 'A4 landscape' : 'A4 portrait';
  const todayIso = letterDate || new Date().toISOString().slice(0, 10);

  let documentTitle = REPORT_TITLE_MAP[data.report_type];
  let bodyContentHtml = '';

  if (kind === 'report_list') {
    const stagesInList = Array.from(
      new Set(data.rows.map((r) => r.stage).filter(Boolean))
    ) as EducationalStage[];
    const anyProvisional = stagesInList.some(
      (st) => data.stage_regulations[st]?.is_legally_approved !== 1
    );

    const rowsHtml =
      data.rows.length === 0
        ? `<tr><td colspan="9" class="empty-cell">لا توجد سجلات مطابقة لهذا التقرير حالياً.</td></tr>`
        : data.rows
            .map((r, idx) => {
              const lastAct = r.last_action_date
                ? `${escapeHtml(r.last_action_label ?? '')} (${escapeHtml(r.last_action_date)})`
                : 'لا يوجد';
              return `<tr>
                <td class="c-center">${idx + 1}</td>
                <td class="c-bold">${escapeHtml(r.full_name)}</td>
                <td>${escapeHtml(r.grade_name)} / ${escapeHtml(r.section_name)}</td>
                <td>${escapeHtml(r.stage_name ?? 'غير محددة')}</td>
                <td class="c-center c-bold">${r.counted_legal_absence_days}</td>
                <td class="c-center">${r.unexcused_absence_days}</td>
                <td class="c-center">${r.report_threshold_days ?? '—'}</td>
                <td class="c-center">${
                  r.remaining_days_to_next_threshold !== null
                    ? r.remaining_days_to_next_threshold
                    : '—'
                }</td>
                <td>${escapeHtml(r.procedure_status_label)}<div class="sub-line">آخر إجراء: ${lastAct}</div></td>
              </tr>`;
            })
            .join('');

    bodyContentHtml = `
      ${
        anyProvisional
          ? `<div class="provisional-banner">تنبيه: تتضمن القائمة مراحل ذات ضوابط تجريبية غير معتمدة قانونياً بعد — تُستخدم للمتابعة الإدارية الداخلية فقط.</div>`
          : ''
      }
      <table class="data-table">
        <thead>
          <tr>
            <th>ت</th>
            <th>اسم الطالب</th>
            <th>الصف والشعبة</th>
            <th>المرحلة</th>
            <th>الغياب المحتسب</th>
            <th>دون عذر</th>
            <th>العتبة المحددة</th>
            <th>المتبقي للحد</th>
            <th>حالة الإجراء وآخر تبليغ</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  } else if (kind === 'procedures_log') {
    documentTitle = `سجل الإجراءات والإنذارات والتبليغات — ${data.academic_year.name}`;
    const logsHtml =
      data.procedure_logs.length === 0
        ? `<tr><td colspan="8" class="empty-cell">لا توجد إجراءات إدارية أو قانونية مسجلة حتى الآن.</td></tr>`
        : data.procedure_logs
            .map(
              (log: StudentLegalProcedureRecord, idx) => `<tr>
                <td class="c-center">${idx + 1}</td>
                <td class="c-bold">${escapeHtml(log.student_name ?? '')}</td>
                <td>${escapeHtml(log.grade_name ?? '')} / ${escapeHtml(log.section_name ?? '')}</td>
                <td>${escapeHtml(PROCEDURE_LABELS_MAP[log.procedure_type])}</td>
                <td class="c-center">${escapeHtml(log.procedure_date)}</td>
                <td class="c-center">${log.absence_days_at_action} يوم</td>
                <td>${escapeHtml(log.delivery_method ?? '—')}</td>
                <td>${escapeHtml(log.summons_result ?? log.notes ?? '—')}</td>
              </tr>`
            )
            .join('');

    bodyContentHtml = `
      <table class="data-table">
        <thead>
          <tr>
            <th>ت</th>
            <th>اسم الطالب</th>
            <th>الصف والشعبة</th>
            <th>نوع الإجراء</th>
            <th>التاريخ</th>
            <th>الغياب وقت الإجراء</th>
            <th>وسيلة التبليغ</th>
            <th>النتيجة / الملاحظات</th>
          </tr>
        </thead>
        <tbody>${logsHtml}</tbody>
      </table>
    `;
  } else if (student) {
    const reg = student.stage ? data.stage_regulations[student.stage] : null;
    const isOfficiallyApproved = canIssueOfficialLetter(reg) && letterMode === 'official';
    const defaultTitle =
      kind === 'warning_letter' ? 'إشعار وإنذار غياب رسمي' : 'كتاب استدعاء ولي أمر الطالب';
    documentTitle = letterTitle || defaultTitle;

    const decisionLine = formatDecisionReference(reg);
    const bodyText = (customBody ?? '').replace(/\n/g, '<br/>');

    bodyContentHtml = `
      ${
        !isOfficiallyApproved
          ? `<div class="draft-stamp">مسودة إدارية غير معتمدة قانونياً — لأغراض المراجعة والمتابعة الداخلية فقط</div>`
          : ''
      }
      <div class="meta-grid">
        <div><strong>العدد:</strong> ${escapeHtml(letterNumber || '—')}</div>
        <div><strong>التاريخ:</strong> ${escapeHtml(todayIso)}</div>
        <div><strong>السنة الدراسية:</strong> ${escapeHtml(data.academic_year.name)}</div>
        <div><strong>المرجع القانوني:</strong> ${escapeHtml(decisionLine)}</div>
      </div>

      <div class="recipient-line">
        <strong>إلى /</strong> ${escapeHtml(
          recipientLabel || `ولي أمر الطالب (${student.full_name}) المحترم`
        )}
      </div>
      <div class="subject-line">
        <strong>الموضوع /</strong> ${escapeHtml(documentTitle)}
      </div>

      <div class="student-summary-box">
        <div><span>اسم الطالب:</span> <strong>${escapeHtml(student.full_name)}</strong></div>
        <div><span>الصف والشعبة:</span> <strong>${escapeHtml(student.grade_name)} — ${escapeHtml(student.section_name)}</strong></div>
        <div><span>المرحلة:</span> <strong>${escapeHtml(student.stage_name ?? 'غير محددة')}</strong></div>
        <div><span>الغياب المحتسب:</span> <strong>${student.counted_legal_absence_days} يوم</strong></div>
        <div><span>الغياب دون عذر:</span> <strong>${student.unexcused_absence_days} يوم</strong></div>
        <div><span>المتبقي للحد التالي:</span> <strong>${
          student.remaining_days_to_next_threshold !== null
            ? `${student.remaining_days_to_next_threshold} يوم`
            : '—'
        }</strong></div>
      </div>

      <div class="letter-body">${bodyText}</div>

      <div class="signatures-row">
        <div class="sig-box">
          <div class="sig-title">المرشد التربوي / مسؤول الغيابات</div>
          <div class="sig-line">الاسم والتوقيع: ............................</div>
        </div>
        <div class="sig-box">
          <div class="sig-title">معاون المدير للشؤون الإدارية</div>
          <div class="sig-line">الاسم والتوقيع: ............................</div>
        </div>
        <div class="sig-box">
          <div class="sig-title">مدير المدرسة (الختم الرسمي)</div>
          <div class="sig-line">الاسم والتوقيع والختم: ....................</div>
        </div>
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(documentTitle)} — ${escapeHtml(school.school_name)}</title>
  <style>
    @page { size: ${pageSizeCss}; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Cairo', 'Almarai', 'Segoe UI', Tahoma, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 12px;
      direction: rtl;
      font-size: 12px;
      line-height: 1.65;
    }
    .doc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 2px solid #0f766e;
      padding-bottom: 10px;
      margin-bottom: 14px;
    }
    .header-col {
      font-size: 11px;
      font-weight: 700;
      color: #1e293b;
    }
    .header-center {
      text-align: center;
    }
    .header-center h1 {
      margin: 0;
      font-size: 15px;
      font-weight: 800;
      color: #0f172a;
    }
    .header-center p {
      margin: 2px 0 0;
      font-size: 12px;
      font-weight: 700;
      color: #0f766e;
    }
    .school-logo {
      width: 56px;
      height: 56px;
      object-fit: contain;
    }
    .provisional-banner, .draft-stamp {
      border: 1.5px dashed #b45309;
      background: #fffbeb;
      color: #92400e;
      font-weight: 800;
      text-align: center;
      padding: 7px 12px;
      border-radius: 6px;
      margin-bottom: 12px;
      font-size: 11.5px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px 16px;
      padding: 8px 12px;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      margin-bottom: 12px;
      font-size: 11.5px;
    }
    .recipient-line, .subject-line {
      font-size: 13px;
      margin-bottom: 6px;
    }
    .student-summary-box {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px 12px;
      padding: 8px 12px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      background: #ffffff;
      margin: 10px 0 14px;
      font-size: 11.5px;
    }
    .student-summary-box span { color: #475569; }
    .letter-body {
      min-height: 150px;
      padding: 14px 16px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      background: #ffffff;
      font-size: 13px;
      line-height: 1.9;
      margin-bottom: 24px;
    }
    .signatures-row {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
      margin-top: 28px;
      padding-top: 12px;
      border-top: 1px solid #cbd5e1;
      text-align: center;
      font-size: 11.5px;
    }
    .sig-title { font-weight: 800; color: #0f172a; margin-bottom: 24px; }
    .sig-line { color: #475569; font-size: 11px; }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    .data-table th, .data-table td {
      border: 1px solid #cbd5e1;
      padding: 6px 8px;
      text-align: right;
      vertical-align: top;
    }
    .data-table th {
      background: #f1f5f9;
      font-weight: 800;
      color: #0f172a;
    }
    .c-center { text-align: center !important; }
    .c-bold { font-weight: 700; }
    .sub-line { font-size: 10px; color: #475569; margin-top: 2px; }
    .empty-cell { text-align: center !important; padding: 20px !important; color: #64748b; }
    .doc-footer {
      margin-top: 16px;
      font-size: 10px;
      color: #64748b;
      display: flex;
      justify-content: space-between;
      border-top: 1px solid #e2e8f0;
      padding-top: 6px;
    }
  </style>
</head>
<body>
  <header class="doc-header">
    <div class="header-col">
      <div>جمهورية العراق — وزارة التربية</div>
      <div>${escapeHtml(school.directorate_name)}</div>
      <div>${escapeHtml(school.school_name)}</div>
    </div>
    <div class="header-center">
      <h1>${escapeHtml(documentTitle)}</h1>
      <p>العام الدراسي: ${escapeHtml(data.academic_year.name)}</p>
    </div>
    <div>${logoHtml}</div>
  </header>

  ${bodyContentHtml}

  <footer class="doc-footer">
    <span>تاريخ الإصدار والطباعة: ${escapeHtml(todayIso)}</span>
    <span>نظام إدارة حضور وغياب الطلاب — الضوابط القانونية والتقارير</span>
  </footer>
</body>
</html>`;
}

interface LegalPrintSheetProps {
  payload: LegalPrintPayload;
  mode: 'preview' | 'print';
}

export function LegalPrintSheet({ payload, mode }: LegalPrintSheetProps) {
  const { kind, data, student, letterMode, customBody, letterTitle, letterNumber, letterDate, recipientLabel } =
    payload;
  const isLandscape = kind === 'report_list' || kind === 'procedures_log';

  useEffect(() => {
    if (mode !== 'print') return;
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-legal-print-page', 'true');
    styleEl.textContent = `@page { size: ${isLandscape ? 'A4 landscape' : 'A4 portrait'}; margin: 12mm; }`;
    document.head.appendChild(styleEl);
    return () => {
      document.head.removeChild(styleEl);
    };
  }, [mode, isLandscape]);

  const school = data.school_settings;
  const todayIso = letterDate || new Date().toISOString().slice(0, 10);
  const reg = student?.stage ? data.stage_regulations[student.stage] : null;
  const isOfficiallyApproved = canIssueOfficialLetter(reg) && letterMode === 'official';

  let docHeading = REPORT_TITLE_MAP[data.report_type];
  if (kind === 'procedures_log') {
    docHeading = 'سجل الإجراءات والإنذارات والتبليغات';
  } else if (kind === 'warning_letter') {
    docHeading = letterTitle || 'إشعار وإنذار غياب رسمي';
  } else if (kind === 'summons_letter') {
    docHeading = letterTitle || 'كتاب استدعاء ولي أمر الطالب';
  }

  return (
    <div
      id={mode === 'print' ? 'legal-print-sheet' : undefined}
      dir="rtl"
      className={
        mode === 'print'
          ? 'print-only bg-white text-slate-900 text-xs'
          : 'bg-white text-slate-900 rounded-xl border border-slate-200 p-5 sm:p-7 shadow-sm text-xs max-w-4xl mx-auto'
      }
    >
      {/* Official Header */}
      <header className="flex items-center justify-between border-b-2 border-teal-700 pb-3 mb-4">
        <div className="space-y-0.5 font-bold text-slate-800 text-[11px]">
          <p>جمهورية العراق — وزارة التربية</p>
          <p>{school.directorate_name}</p>
          <p>{school.school_name}</p>
        </div>

        <div className="text-center">
          <h2 className="text-base font-extrabold text-slate-900 font-display">{docHeading}</h2>
          <p className="text-xs font-bold text-teal-800 mt-0.5 tabular-nums">
            العام الدراسي: {data.academic_year.name}
          </p>
        </div>

        <div className="shrink-0">
          {school.school_logo_data ? (
            <img
              src={school.school_logo_data}
              alt="شعار المدرسة"
              className="w-14 h-14 object-contain"
            />
          ) : (
            <div
              className="w-14 h-14 flex items-center justify-center"
              dangerouslySetInnerHTML={{ __html: DEFAULT_CREST_SVG }}
            />
          )}
        </div>
      </header>

      {/* Report List */}
      {kind === 'report_list' && (
        <div className="space-y-3">
          {data.rows.some(
            (r) => r.stage && data.stage_regulations[r.stage]?.is_legally_approved !== 1
          ) && (
            <div className="border border-dashed border-amber-500 bg-amber-50 text-amber-900 font-bold text-center py-2 px-3 rounded text-[11px]">
              تنبيه: تتضمن القائمة مراحل ذات ضوابط تجريبية غير معتمدة قانونياً بعد — تُستخدم للمتابعة الإدارية الداخلية فقط.
            </div>
          )}
          <table className="w-full border-collapse text-[11px] tabular-nums print-table">
            <thead>
              <tr className="bg-slate-100 text-slate-900">
                <th className="border border-slate-300 px-2 py-1.5 text-center">ت</th>
                <th className="border border-slate-300 px-2 py-1.5 text-right">اسم الطالب</th>
                <th className="border border-slate-300 px-2 py-1.5 text-right">الصف والشعبة</th>
                <th className="border border-slate-300 px-2 py-1.5 text-right">المرحلة</th>
                <th className="border border-slate-300 px-2 py-1.5 text-center">المحتسب</th>
                <th className="border border-slate-300 px-2 py-1.5 text-center">دون عذر</th>
                <th className="border border-slate-300 px-2 py-1.5 text-center">العتبة</th>
                <th className="border border-slate-300 px-2 py-1.5 text-center">المتبقي</th>
                <th className="border border-slate-300 px-2 py-1.5 text-right">حالة الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, idx) => (
                <tr key={r.student_id}>
                  <td className="border border-slate-300 px-2 py-1.5 text-center">{idx + 1}</td>
                  <td className="border border-slate-300 px-2 py-1.5 font-bold">{r.full_name}</td>
                  <td className="border border-slate-300 px-2 py-1.5">
                    {r.grade_name} / {r.section_name}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5">
                    {r.stage_name ?? 'غير محددة'}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 text-center font-bold">
                    {r.counted_legal_absence_days}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 text-center">
                    {r.unexcused_absence_days}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 text-center">
                    {r.report_threshold_days ?? '—'}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 text-center">
                    {r.remaining_days_to_next_threshold ?? '—'}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5">
                    <div>{r.procedure_status_label}</div>
                    {r.last_action_date && (
                      <div className="text-[10px] text-slate-600">
                        آخر إجراء: {r.last_action_label} ({r.last_action_date})
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Procedures Log */}
      {kind === 'procedures_log' && (
        <table className="w-full border-collapse text-[11px] tabular-nums print-table">
          <thead>
            <tr className="bg-slate-100 text-slate-900">
              <th className="border border-slate-300 px-2 py-1.5 text-center">ت</th>
              <th className="border border-slate-300 px-2 py-1.5 text-right">اسم الطالب</th>
              <th className="border border-slate-300 px-2 py-1.5 text-right">الصف والشعبة</th>
              <th className="border border-slate-300 px-2 py-1.5 text-right">الإجراء</th>
              <th className="border border-slate-300 px-2 py-1.5 text-center">التاريخ</th>
              <th className="border border-slate-300 px-2 py-1.5 text-center">الغياب وقتها</th>
              <th className="border border-slate-300 px-2 py-1.5 text-right">النتيجة / الملاحظات</th>
            </tr>
          </thead>
          <tbody>
            {data.procedure_logs.map((log, idx) => (
              <tr key={log.id}>
                <td className="border border-slate-300 px-2 py-1.5 text-center">{idx + 1}</td>
                <td className="border border-slate-300 px-2 py-1.5 font-bold">{log.student_name}</td>
                <td className="border border-slate-300 px-2 py-1.5">
                  {log.grade_name} / {log.section_name}
                </td>
                <td className="border border-slate-300 px-2 py-1.5">
                  {PROCEDURE_LABELS_MAP[log.procedure_type]}
                </td>
                <td className="border border-slate-300 px-2 py-1.5 text-center">
                  {log.procedure_date}
                </td>
                <td className="border border-slate-300 px-2 py-1.5 text-center">
                  {log.absence_days_at_action} يوم
                </td>
                <td className="border border-slate-300 px-2 py-1.5">
                  {log.summons_result || log.notes || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Formal Warning / Summons Letter */}
      {(kind === 'warning_letter' || kind === 'summons_letter') && student && (
        <div className="space-y-4">
          {!isOfficiallyApproved && (
            <div className="border-2 border-dashed border-amber-500 bg-amber-50 text-amber-900 font-extrabold text-center py-2 px-3 rounded">
              مسودة إدارية غير معتمدة قانونياً — لأغراض المراجعة والمتابعة الداخلية فقط
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 px-3 py-2 bg-slate-50 border border-slate-300 rounded text-[11.5px] tabular-nums">
            <div>
              <strong>العدد:</strong> {letterNumber || '—'}
            </div>
            <div>
              <strong>التاريخ:</strong> {todayIso}
            </div>
            <div>
              <strong>السنة الدراسية:</strong> {data.academic_year.name}
            </div>
            <div>
              <strong>المرجع القانوني:</strong> {formatDecisionReference(reg)}
            </div>
          </div>

          <div className="space-y-1 text-sm">
            <p>
              <strong>إلى /</strong>{' '}
              {recipientLabel || `ولي أمر الطالب (${student.full_name}) المحترم`}
            </p>
            <p>
              <strong>الموضوع /</strong> {docHeading}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 px-3 py-2 border border-slate-300 rounded text-[11px] tabular-nums">
            <div>
              <span className="text-slate-500">اسم الطالب:</span>{' '}
              <strong>{student.full_name}</strong>
            </div>
            <div>
              <span className="text-slate-500">الصف والشعبة:</span>{' '}
              <strong>
                {student.grade_name} — {student.section_name}
              </strong>
            </div>
            <div>
              <span className="text-slate-500">المرحلة:</span>{' '}
              <strong>{student.stage_name ?? 'غير محددة'}</strong>
            </div>
            <div>
              <span className="text-slate-500">الغياب المحتسب:</span>{' '}
              <strong>{student.counted_legal_absence_days} يوم</strong>
            </div>
            <div>
              <span className="text-slate-500">الغياب دون عذر:</span>{' '}
              <strong>{student.unexcused_absence_days} يوم</strong>
            </div>
            <div>
              <span className="text-slate-500">المتبقي للحد التالي:</span>{' '}
              <strong>
                {student.remaining_days_to_next_threshold !== null
                  ? `${student.remaining_days_to_next_threshold} يوم`
                  : '—'}
              </strong>
            </div>
          </div>

          <div className="min-h-[140px] p-4 border border-slate-200 rounded text-sm leading-8 whitespace-pre-wrap">
            {customBody}
          </div>

          <div className="grid grid-cols-3 gap-4 pt-6 border-t border-slate-300 text-center text-[11px]">
            <div>
              <p className="font-extrabold mb-6">المرشد التربوي / مسؤول الغيابات</p>
              <p className="text-slate-500">الاسم والتوقيع: ......................</p>
            </div>
            <div>
              <p className="font-extrabold mb-6">معاون المدير للشؤون الإدارية</p>
              <p className="text-slate-500">الاسم والتوقيع: ......................</p>
            </div>
            <div>
              <p className="font-extrabold mb-6">مدير المدرسة (الختم الرسمي)</p>
              <p className="text-slate-500">التوقيع والختم: ......................</p>
            </div>
          </div>
        </div>
      )}

      <footer className="mt-5 pt-2 border-t border-slate-200 flex items-center justify-between text-[10px] text-slate-500 tabular-nums">
        <span>تاريخ الإصدار والطباعة: {todayIso}</span>
        <span>نظام إدارة حضور وغياب الطلاب — {school.school_name}</span>
      </footer>
    </div>
  );
}
