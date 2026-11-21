import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 left-4 right-4 sm:right-auto sm:left-5 z-50 flex flex-col gap-2.5 sm:max-w-md sm:w-full pointer-events-none"
    >
      {toasts.map((toast) => {
        const isError = toast.type === 'error';
        const isSuccess = toast.type === 'success';
        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3.5 rounded-xl border shadow-lg transition-all duration-200 ${
              isError
                ? 'bg-white dark:bg-slate-900 border-red-200 dark:border-red-900/60 text-red-800 dark:text-red-200'
                : isSuccess
                  ? 'bg-white dark:bg-slate-900 border-emerald-200 dark:border-emerald-900/60 text-emerald-900 dark:text-emerald-200'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100'
            }`}
          >
            <span className="mt-0.5 shrink-0">
              {isError ? (
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
              ) : isSuccess ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Info className="w-5 h-5 text-teal-600 dark:text-teal-400" />
              )}
            </span>
            <p className="text-sm leading-relaxed flex-1 font-medium">{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="إغلاق التنبيه"
              className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
