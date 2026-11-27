import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  convertDigits,
  formatAcademicYearDisplay,
  formatArabicLongDate,
  formatCount,
  formatDateDMY,
  formatPlainNumber,
  type NumberDisplayMode,
} from '../utils/numberFormat';

interface NumberDisplayContextValue {
  mode: NumberDisplayMode;
  convert: (value: string | number | null | undefined) => string;
  plain: (value: number | string | null | undefined, fallback?: string) => string;
  count: (value: number | string | null | undefined, fallback?: string) => string;
  dateDMY: (
    raw: string | null | undefined,
    options?: { includeTime?: boolean; fallback?: string }
  ) => string;
  academicYear: (yearName: string | null | undefined, fallback?: string) => string;
  todayLongDate: () => string;
}

const DEFAULT_MODE: NumberDisplayMode = 'english';

const NumberDisplayContext = createContext<NumberDisplayContextValue>({
  mode: DEFAULT_MODE,
  convert: (value) => convertDigits(value, DEFAULT_MODE),
  plain: (value, fallback) => formatPlainNumber(value, DEFAULT_MODE, fallback),
  count: (value, fallback) => formatCount(value, DEFAULT_MODE, fallback),
  dateDMY: (raw, options) => formatDateDMY(raw, DEFAULT_MODE, options),
  academicYear: (yearName, fallback) => formatAcademicYearDisplay(yearName, DEFAULT_MODE, fallback),
  todayLongDate: () => formatArabicLongDate(DEFAULT_MODE),
});

export function NumberDisplayProvider({
  mode,
  children,
}: {
  mode: NumberDisplayMode;
  children: ReactNode;
}) {
  const value = useMemo<NumberDisplayContextValue>(
    () => ({
      mode,
      convert: (val) => convertDigits(val, mode),
      plain: (val, fallback) => formatPlainNumber(val, mode, fallback),
      count: (val, fallback) => formatCount(val, mode, fallback),
      dateDMY: (raw, options) => formatDateDMY(raw, mode, options),
      academicYear: (yearName, fallback) => formatAcademicYearDisplay(yearName, mode, fallback),
      todayLongDate: () => formatArabicLongDate(mode),
    }),
    [mode]
  );

  return <NumberDisplayContext.Provider value={value}>{children}</NumberDisplayContext.Provider>;
}

export function useNumberDisplay(): NumberDisplayContextValue {
  return useContext(NumberDisplayContext);
}
