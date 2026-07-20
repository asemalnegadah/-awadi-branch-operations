import type { PermissionCode } from "@/lib/auth/permissions";
import type { AuthenticatedUser } from "@/lib/auth/types";

import type { PaymentPromise, PromiseBaseStatus, PromiseEventType } from "./types";

const statusLabels: Readonly<Record<PromiseBaseStatus, string>> = Object.freeze({
  NEW: "جديد",
  UPCOMING: "قادم",
  PARTIALLY_FULFILLED: "منفذ جزئيًا",
  FULFILLED: "منفذ",
  REJECTED: "مرفوض",
  CANCELLED: "ملغي",
});

const eventLabels: Readonly<Record<PromiseEventType, string>> = Object.freeze({
  CREATED: "إنشاء الوعد",
  UPDATED: "تحديث الوعد",
  FOLLOW_UP_ADDED: "إضافة متابعة",
  ASSIGNED: "تغيير المسؤول",
  DUE_DATE_CHANGED: "تغيير تاريخ الاستحقاق",
  AMOUNT_CHANGED: "تغيير مبلغ الوعد",
  COLLECTION_ALLOCATED: "ربط تحصيل",
  COLLECTION_REVERSED: "عكس ربط تحصيل",
  PARTIALLY_FULFILLED: "تنفيذ جزئي",
  FULFILLED: "تنفيذ كامل",
  REJECTED: "رفض الوعد",
  CANCELLED: "إلغاء الوعد",
  ESCALATED: "تصعيد الوعد",
  REOPENED: "إعادة فتح الوعد",
});

const moneyFormatter = new Intl.NumberFormat("ar-YE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export interface PromiseUiActions {
  readonly update: boolean;
  readonly followUp: boolean;
  readonly reject: boolean;
  readonly cancel: boolean;
  readonly allocate: boolean;
  readonly reverse: boolean;
  readonly escalate: boolean;
  readonly viewHistory: boolean;
}

export function promiseStatusLabel(status: PromiseBaseStatus): string {
  return statusLabels[status];
}

export function promiseEventLabel(eventType: PromiseEventType): string {
  return eventLabels[eventType];
}

export function formatPromiseMoney(amountMinor: number, currency: "SR" | "RG"): string {
  return `${moneyFormatter.format(amountMinor / 100)} ${currency}`;
}

export function formatPromiseMinorForInput(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error("قيمة مالية غير صالحة.");
  }
  return (amountMinor / 100).toFixed(2);
}

export function parsePromiseMajorAmountToMinor(
  value: FormDataEntryValue | string | number | null,
): number {
  const text = String(value ?? "").trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) {
    throw new Error("أدخل مبلغًا صحيحًا بمنزلتين عشريتين كحد أقصى.");
  }

  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const amountMinor = whole * 100 + fraction;
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("يجب أن يكون المبلغ أكبر من صفر وضمن الحد المسموح.");
  }
  return amountMinor;
}

export function promiseTemporalLabel(promise: PaymentPromise): string | null {
  if (promise.temporalStatus === "DUE_TODAY") return "مستحق اليوم";
  if (promise.temporalStatus === "OVERDUE") return "متأخر";
  return null;
}

export function availablePromiseActions(
  actor: AuthenticatedUser,
  promise: Pick<PaymentPromise, "baseStatus">,
): PromiseUiActions {
  const open = ["NEW", "UPCOMING", "PARTIALLY_FULFILLED"].includes(promise.baseStatus);
  const terminalAllowed = ["NEW", "UPCOMING"].includes(promise.baseStatus);
  const has = (permission: PermissionCode): boolean => actor.permissions.has(permission);
  return Object.freeze({
    update: open && has("promises.update"),
    followUp: open && has("promises.follow_up"),
    reject: terminalAllowed && has("promises.reject"),
    cancel: terminalAllowed && has("promises.cancel"),
    allocate: open && has("promises.allocate_collection"),
    reverse: has("promises.reverse_allocation"),
    escalate: open && has("promises.escalate"),
    viewHistory: has("promises.view_history"),
  });
}
