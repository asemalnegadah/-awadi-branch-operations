import type {
  ReconciliationReasonCode,
  ReconciliationSourceKind,
  ReconciliationState,
} from "./types";

const stateLabels: Readonly<Record<ReconciliationState, string>> = {
  DRAFT: "مسودة",
  PENDING_REVIEW: "بانتظار المراجعة",
  REVIEWED: "تمت المراجعة",
  PENDING_APPROVAL: "بانتظار الاعتماد",
  APPROVED: "معتمدة",
  RETURNED: "معادة للتصحيح",
  REJECTED: "مرفوضة",
  MATCHED: "مطابقة بلا فرق",
  SETTLED: "تمت التسوية",
};

const sourceLabels: Readonly<Record<ReconciliationSourceKind, string>> = {
  LEDGER_TO_STATEMENT: "الدفتر مقابل كشف الحساب",
  COLLECTION_TO_LEDGER: "التحصيلات مقابل الدفتر",
  IMPORT_TO_LEDGER: "نتيجة الاستيراد مقابل الدفتر",
  CUSTODY_TO_COLLECTION: "العهدة مقابل التحصيلات",
};

const reasonLabels: Readonly<Record<ReconciliationReasonCode, string>> = {
  TIMING_DIFFERENCE: "فرق توقيت",
  MISSING_COLLECTION: "تحصيل غير مثبت",
  UNPOSTED_INVOICE: "فاتورة غير مرحلة",
  DUPLICATE_ENTRY: "حركة مكررة",
  WRONG_ACCOUNT: "حساب غير صحيح",
  WRONG_CURRENCY: "عملة غير صحيحة",
  WRONG_AMOUNT: "مبلغ غير صحيح",
  UNALLOCATED_COLLECTION: "تحصيل غير موزع",
  IMPORT_VARIANCE: "فرق ناتج الاستيراد",
  CUSTODY_VARIANCE: "فرق عهدة",
  MANUAL_ERROR: "خطأ يدوي",
  OTHER: "سبب آخر",
};

export function reconciliationStateLabel(state: ReconciliationState): string {
  return stateLabels[state];
}

export function reconciliationSourceLabel(source: ReconciliationSourceKind): string {
  return sourceLabels[source];
}

export function reconciliationReasonLabel(reason: ReconciliationReasonCode): string {
  return reasonLabels[reason];
}

export function formatReconciliationMoney(minorUnits: number, currency: "SR" | "RG"): string {
  if (!Number.isSafeInteger(minorUnits)) throw new Error("المبلغ خارج النطاق الصحيح.");
  const sign = minorUnits < 0 ? "−" : "";
  const absolute = Math.abs(minorUnits);
  const major = Math.floor(absolute / 100);
  const minor = String(absolute % 100).padStart(2, "0");
  return `${sign}${major.toLocaleString("en-US")}.${minor} ${currency}`;
}
