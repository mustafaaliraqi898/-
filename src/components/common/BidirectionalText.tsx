import type { CSSProperties, ReactNode } from 'react';
import { useNumberDisplay } from '../../contexts/NumberDisplayContext';
import { tokenizeBidiText, type NumberDisplayMode } from '../../utils/numberFormat';

const LTR_ISOLATE_STYLE: CSSProperties = {
  unicodeBidi: 'isolate',
  direction: 'ltr',
};

/**
 * Renders an LTR-isolated span so dates (`DD-MM-YYYY`), academic years (`2026-2027`),
 * phone numbers, and numeric codes never invert inside Arabic RTL containers.
 */
export function LtrSpan({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      dir="ltr"
      className={className ? `ltr-isolate ${className}` : 'ltr-isolate'}
      style={style ? { ...LTR_ISOLATE_STYLE, ...style } : LTR_ISOLATE_STYLE}
    >
      {children}
    </span>
  );
}

/**
 * Renders mixed Arabic + numeric/year/document-number text with localized digits and
 * automatic LTR isolation around numeric and compound-numeric fragments.
 */
export function BidiText({
  text,
  mode,
}: {
  text: string | number | null | undefined;
  mode?: NumberDisplayMode;
}) {
  const ctx = useNumberDisplay();
  const activeMode = mode ?? ctx.mode;
  const segments = tokenizeBidiText(text, activeMode);
  if (segments.length === 0) return null;

  return (
    <>
      {segments.map((seg, idx) =>
        seg.ltr ? (
          <span key={idx} dir="ltr" className="ltr-isolate" style={LTR_ISOLATE_STYLE}>
            {seg.text}
          </span>
        ) : (
          <span key={idx}>{seg.text}</span>
        )
      )}
    </>
  );
}
