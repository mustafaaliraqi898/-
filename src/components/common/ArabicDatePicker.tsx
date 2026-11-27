import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

interface ArabicDatePickerProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}

const MONTHS = [
  'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
  'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول',
];
const WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function parseIso(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return year && month && day ? new Date(year, month - 1, day) : new Date();
}
function toIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function arabicNumber(value: number) {
  return new Intl.NumberFormat('ar-IQ', { useGrouping: false }).format(value);
}

export function ArabicDatePicker({ id, value, onChange, className = '', disabled = false }: ArabicDatePickerProps) {
  const selected = parseIso(value);
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(selected.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected.getMonth());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const date = parseIso(value);
    setViewYear(date.getFullYear());
    setViewMonth(date.getMonth());
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const days = useMemo(() => {
    const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    return [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  }, [viewYear, viewMonth]);

  const displayValue = new Intl.DateTimeFormat('ar-IQ', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }).format(selected);
  const today = toIso(new Date());

  function moveMonth(offset: number) {
    const next = new Date(viewYear, viewMonth + offset, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  return (
    <div ref={rootRef} className="relative" dir="rtl">
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`w-full flex items-center justify-between gap-2 text-right ${className} disabled:opacity-50`}
      >
        <span className="truncate">{displayValue}</span>
        <CalendarDays className="w-4 h-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
      </button>

      {open && (
        <div role="dialog" aria-label="اختيار التاريخ" className="absolute z-50 top-full right-0 mt-2 w-[min(320px,calc(100vw-2rem))] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-3">
          <div className="flex items-center justify-between gap-2 mb-3">
            <button type="button" onClick={() => moveMonth(-1)} aria-label="الشهر السابق" className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronRight className="w-4 h-4" /></button>
            <div className="font-bold text-sm text-slate-900 dark:text-slate-100">{MONTHS[viewMonth]} {arabicNumber(viewYear)}</div>
            <button type="button" onClick={() => moveMonth(1)} aria-label="الشهر التالي" className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronLeft className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map((day) => <div key={day} className="text-center text-[10px] font-semibold text-slate-500 dark:text-slate-400 py-1">{day.slice(0, 2)}</div>)}
            {days.map((day, index) => {
              if (day === null) return <span key={`blank-${index}`} />;
              const date = new Date(viewYear, viewMonth, day);
              const iso = toIso(date);
              const active = iso === value;
              const isToday = iso === today;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => { onChange(iso); setOpen(false); }}
                  aria-pressed={active}
                  className={`h-9 rounded-lg text-xs font-semibold transition-colors ${active ? 'bg-emerald-700 text-white' : isToday ? 'border border-emerald-500 text-emerald-700 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'}`}
                >{arabicNumber(day)}</button>
              );
            })}
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2 mt-2">
            <button type="button" onClick={() => { onChange(today); setOpen(false); }} className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">اليوم</button>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">إغلاق</button>
          </div>
        </div>
      )}
    </div>
  );
}
