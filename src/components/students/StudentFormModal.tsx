import { Camera, Loader2, Trash2, User, X } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { GradeWithSections, StudentRecord, StudentStatus } from '../../types/school';
import { schoolService } from '../../services/schoolService';
import {
  ACCEPTED_IMAGE_INPUT,
  describeMediaProcessingResult,
  processAndUploadImageFile,
} from '../../utils/imageUpload';

interface StudentFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  student: StudentRecord | null;
  grades: GradeWithSections[];
  selectedYearId: number | null;
  onClose: () => void;
  onSuccess: (message: string) => Promise<void>;
  onError: (message: string) => void;
}

export function StudentFormModal({
  open,
  mode,
  student,
  grades,
  selectedYearId,
  onClose,
  onSuccess,
  onError,
}: StudentFormModalProps) {
  const [fullName, setFullName] = useState('');
  const [gradeId, setGradeId] = useState<number | ''>('');
  const [sectionId, setSectionId] = useState<number | ''>('');
  const [registryNumber, setRegistryNumber] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [photoData, setPhotoData] = useState<string | null>(null);
  const [photoAssetId, setPhotoAssetId] = useState<number | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoStatusText, setPhotoStatusText] = useState<string | null>(null);
  const [status, setStatus] = useState<StudentStatus>('active');
  const [submitting, setSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;

    if (mode === 'edit' && student) {
      setFullName(student.full_name);
      setGradeId(student.grade_id ?? '');
      setSectionId(student.section_id ?? '');
      setRegistryNumber(student.registry_number ?? '');
      setBirthDate(student.birth_date ?? '');
      setPhone(student.phone ?? '');
      setPhotoData(student.photo_data ?? null);
      setPhotoAssetId(student.photo_asset_id ?? null);
      setPhotoStatusText(null);
      setStatus(student.status);
    } else {
      setFullName('');
      const firstGradeWithSection = grades.find((g) => g.sections.length > 0) ?? grades[0];
      setGradeId(firstGradeWithSection ? firstGradeWithSection.id : '');
      setSectionId(
        firstGradeWithSection && firstGradeWithSection.sections.length > 0
          ? firstGradeWithSection.sections[0].id
          : ''
      );
      setRegistryNumber('');
      setBirthDate('');
      setPhone('');
      setPhotoData(null);
      setPhotoAssetId(null);
      setPhotoStatusText(null);
      setStatus('active');
    }
    setUploadingPhoto(false);
  }, [open, mode, student, grades]);

  if (!open) return null;

  const selectedGradeObj = grades.find((g) => g.id === Number(gradeId));
  const availableSections = selectedGradeObj?.sections ?? [];

  function handleGradeChange(newGradeIdStr: string) {
    const gId = Number(newGradeIdStr);
    setGradeId(gId || '');
    const gObj = grades.find((g) => g.id === gId);
    if (gObj && gObj.sections.length > 0) {
      setSectionId(gObj.sections[0].id);
    } else {
      setSectionId('');
    }
  }

  async function handlePhotoSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploadingPhoto(true);
    setPhotoStatusText('جاري فحص ومعالجة الصورة تلقائياً...');
    try {
      const asset = await processAndUploadImageFile(file, 'student_photo');
      setPhotoData(asset.optimized_url);
      setPhotoAssetId(asset.id);
      setPhotoStatusText(describeMediaProcessingResult(asset));
    } catch (err) {
      setPhotoStatusText(null);
      onError(err instanceof Error ? err.message : 'تعذر معالجة الصورة المختارة.');
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (uploadingPhoto) {
      onError('يرجى الانتظار حتى تكتمل معالجة الصورة.');
      return;
    }
    if (!fullName.trim()) {
      onError('اسم الطالب حقل إجباري.');
      return;
    }

    if (mode === 'create') {
      if (!gradeId || !sectionId) {
        onError('يجب اختيار الصف والشعبة للطالب.');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (mode === 'create') {
        await schoolService.createStudent({
          full_name: fullName.trim(),
          grade_id: Number(gradeId),
          section_id: Number(sectionId),
          registry_number: registryNumber.trim() || null,
          birth_date: birthDate || null,
          phone: phone.trim() || null,
          photo_data: photoData,
          photo_asset_id: photoAssetId,
          academic_year_id: selectedYearId ?? undefined,
        });
        await onSuccess(`تمت إضافة الطالب "${fullName.trim()}" بنجاح.`);
      } else if (student) {
        await schoolService.updateStudent(student.id, {
          full_name: fullName.trim(),
          registry_number: registryNumber.trim() || null,
          birth_date: birthDate || null,
          phone: phone.trim() || null,
          photo_data: photoData,
          photo_asset_id: photoAssetId,
          status,
        });
        await onSuccess(`تم تحديث بيانات الطالب "${fullName.trim()}" بنجاح.`);
      }
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'تعذر حفظ بيانات الطالب.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/50 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden max-h-[90dvh] flex flex-col">
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display truncate">
              {mode === 'create' ? 'إضافة طالب جديد' : 'تعديل بيانات الطالب'}
            </h3>
            {mode === 'edit' && student && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono-tabular truncate">
                المعرف الداخلي الدائم: {student.student_uid}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto">
          {/* Student Photo Upload (Optional) */}
          <div className="flex flex-wrap items-center gap-3.5 sm:gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div className="w-16 h-16 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 overflow-hidden flex items-center justify-center shrink-0">
              {photoData ? (
                <img
                  src={photoData}
                  alt="صورة الطالب"
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <User className="w-7 h-7 text-slate-400" />
              )}
            </div>
            <div className="space-y-1.5 min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                صورة الطالب (اختياري)
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_IMAGE_INPUT}
                  onChange={handlePhotoSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={uploadingPhoto}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-60"
                >
                  {uploadingPhoto ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-700 dark:text-teal-400" />
                  ) : (
                    <Camera className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {uploadingPhoto
                      ? 'جاري المعالجة...'
                      : photoData
                        ? 'تغيير الصورة'
                        : 'رفع صورة'}
                  </span>
                </button>
                {photoData && !uploadingPhoto && (
                  <button
                    type="button"
                    onClick={() => {
                      setPhotoData(null);
                      setPhotoAssetId(null);
                      setPhotoStatusText(null);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>إزالة</span>
                  </button>
                )}
              </div>
              {photoStatusText ? (
                <p className="text-[11px] text-teal-700 dark:text-teal-400">{photoStatusText}</p>
              ) : (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  تتم معالجة الصور وضغطها تلقائياً مع حفظ النسخة الأصلية (PNG, JPG, WebP وغيرها).
                </p>
              )}
            </div>
          </div>

          {/* Full Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              اسم الطالب الكامل (ثلاثي أو رباعي) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="مثال: علي حسين محمد كاظم"
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
            />
          </div>

          {/* Grade & Section (Only selectable during create; in edit mode show current placement note) */}
          {mode === 'create' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  الصف الدراسي <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={gradeId}
                  onChange={(e) => handleGradeChange(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                >
                  <option value="">اختر الصف...</option>
                  {grades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  الشعبة <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={sectionId}
                  onChange={(e) => setSectionId(Number(e.target.value) || '')}
                  disabled={!gradeId || availableSections.length === 0}
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30 disabled:opacity-50"
                >
                  {availableSections.length === 0 ? (
                    <option value="">لا توجد شعب لهذا الصف</option>
                  ) : (
                    availableSections.map((s) => (
                      <option key={s.id} value={s.id}>
                        شعبة {s.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                التسجيل الحالي:
              </span>{' '}
              {student?.grade_name ?? '—'} · شعبة {student?.section_name ?? '—'} — لتغيير الصف أو
              الشعبة استخدم إجراء <span className="font-semibold">«نقل الطالب»</span> حفاظاً على
              السجل التاريخي.
            </div>
          )}

          {/* Registry Number & Birth Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                رقم القيد المدرسي (اختياري)
              </label>
              <input
                type="text"
                value={registryNumber}
                onChange={(e) => setRegistryNumber(e.target.value)}
                placeholder="مثال: 4125 (يمنع تكراره)"
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30 font-mono-tabular"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                تاريخ الميلاد (اختياري)
              </label>
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30 tabular-nums"
              />
            </div>
          </div>

          {/* Phone & Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                رقم الهاتف (اختياري)
              </label>
              <input
                type="tel"
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="07XXXXXXXXX"
                className="w-full px-3.5 py-2 text-sm text-right rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30 font-mono-tabular"
              />
            </div>

            {mode === 'edit' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  حالة القيد الدراسي
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as StudentStatus)}
                  className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                >
                  <option value="active">مستمر بالدوام</option>
                  <option value="transferred_out">منقول خارج المدرسة</option>
                  <option value="graduated">متخرج</option>
                  <option value="archived">مؤرشف</option>
                </select>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-sm font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 text-white transition-colors disabled:opacity-60"
            >
              {submitting ? 'جاري الحفظ...' : mode === 'create' ? 'إضافة الطالب' : 'حفظ التعديلات'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
