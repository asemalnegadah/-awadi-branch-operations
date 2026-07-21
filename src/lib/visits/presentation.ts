import type {
  DailyPlanItemResultType,
  FieldVisitResult,
  FieldVisitState,
  FieldVisitType,
} from "./types";

export function fieldVisitStateLabel(state: FieldVisitState): string {
  return ({
    DRAFT: "مسودة",
    CHECKED_IN: "وصل المندوب",
    CHECKED_OUT: "غادر المندوب",
    SUBMITTED: "مرسلة للتحقق",
    VERIFIED: "متحقق منها",
    RETURNED: "معادة للاستكمال",
    CANCELLED: "ملغاة",
  } as const)[state];
}

export function fieldVisitTypeLabel(type: FieldVisitType): string {
  return ({
    COLLECTION: "تحصيل",
    SALES: "بيع",
    PROMISE_FOLLOWUP: "متابعة وعد",
    RECONCILIATION: "مطابقة",
    DATA_UPDATE: "تحديث بيانات",
    PROBLEM_RESOLUTION: "حل مشكلة",
    MIXED: "مهمة مختلطة",
  } as const)[type];
}

export function fieldVisitResultLabel(result: FieldVisitResult | null): string {
  if (!result) return "لم تسجل النتيجة";
  return ({
    SUCCESS: "ناجحة",
    PARTIAL: "جزئية",
    FAILED: "غير ناجحة",
    NO_CONTACT: "تعذر التواصل",
  } as const)[result];
}

export function planItemResultLabel(result: DailyPlanItemResultType): string {
  return ({
    VISITED_SUCCESS: "زيارة ناجحة",
    VISITED_PARTIAL: "زيارة جزئية",
    VISITED_FAILED: "زيارة غير ناجحة",
    CUSTOMER_ABSENT: "العميل غير موجود",
    REFUSED: "رفض العميل",
    CLOSED: "المنشأة مغلقة",
    NOT_FOUND: "تعذر العثور على العميل",
    RESCHEDULED: "أعيدت الجدولة",
    SKIPPED: "لم تنفذ",
    OTHER: "نتيجة أخرى",
  } as const)[result];
}

export function formatVisitDateTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-YE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Aden",
  }).format(new Date(value));
}
