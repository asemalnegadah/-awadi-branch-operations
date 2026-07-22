"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type {
  ReconciliationReasonCode,
  ReconciliationState,
} from "@/lib/reconciliations/types";

interface ActionPermissions {
  readonly canCreate: boolean;
  readonly canReview: boolean;
  readonly canApprove: boolean;
  readonly canSettle: boolean;
}

interface ApiResponse {
  readonly success: boolean;
  readonly error?: { readonly message?: string };
}

type ActionName = "submit" | "review" | "request-approval" | "approve" | "return" | "reject" | "settle";

export function ReconciliationActionPanel({
  reconciliationId,
  state,
  version,
  permissions,
}: Readonly<{
  reconciliationId: string;
  state: ReconciliationState;
  version: number;
  permissions: ActionPermissions;
}>) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [reasonCode, setReasonCode] = useState<ReconciliationReasonCode>("WRONG_AMOUNT");
  const [busy, setBusy] = useState<ActionName | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(action: ActionName) {
    setBusy(action);
    setMessage(null);
    try {
      const payload = action === "review"
        ? { version, reasonCode, reasonText: reason }
        : ["return", "reject", "settle"].includes(action)
          ? { version, reason }
          : { version };
      const response = await fetch(`/api/v1/reconciliations/${reconciliationId}/${action}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `reconciliation:${action}:${crypto.randomUUID()}`,
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as ApiResponse;
      if (!response.ok || !body.success) {
        throw new Error(body.error?.message ?? "تعذر تنفيذ العملية.");
      }
      setReason("");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تنفيذ العملية.");
    } finally {
      setBusy(null);
    }
  }

  const needsClassification = state === "PENDING_REVIEW" && permissions.canReview;
  const needsOperationalReason = (
    (state === "PENDING_REVIEW" && permissions.canReview)
    || (state === "PENDING_APPROVAL" && (permissions.canReview || permissions.canApprove))
    || (state === "APPROVED" && permissions.canSettle)
  );

  return (
    <section className="panel" aria-label="إجراءات المطابقة">
      <h2>الإجراءات المتاحة</h2>
      {needsClassification ? (
        <div className="promise-field">
          <label htmlFor="reasonCode">تصنيف الفرق</label>
          <select
            id="reasonCode"
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value as ReconciliationReasonCode)}
          >
            <option value="TIMING_DIFFERENCE">فرق توقيت</option>
            <option value="MISSING_COLLECTION">تحصيل غير مثبت</option>
            <option value="UNPOSTED_INVOICE">فاتورة غير مرحلة</option>
            <option value="DUPLICATE_ENTRY">حركة مكررة</option>
            <option value="WRONG_ACCOUNT">حساب غير صحيح</option>
            <option value="WRONG_CURRENCY">عملة غير صحيحة</option>
            <option value="WRONG_AMOUNT">مبلغ غير صحيح</option>
            <option value="UNALLOCATED_COLLECTION">تحصيل غير موزع</option>
            <option value="IMPORT_VARIANCE">فرق استيراد</option>
            <option value="CUSTODY_VARIANCE">فرق عهدة</option>
            <option value="MANUAL_ERROR">خطأ يدوي</option>
            <option value="OTHER">سبب آخر</option>
          </select>
        </div>
      ) : null}
      {needsOperationalReason ? (
        <div className="promise-field">
          <label htmlFor="reconciliationReason">
            {state === "PENDING_REVIEW" ? "شرح الفرق أو سبب الإرجاع/الرفض" : state === "APPROVED" ? "سبب التسوية" : "سبب الإرجاع أو الرفض"}
          </label>
          <textarea
            id="reconciliationReason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={4}
            maxLength={2000}
          />
        </div>
      ) : null}

      <div className="promises-actions">
        {(state === "DRAFT" || state === "RETURNED") && permissions.canCreate ? (
          <button className="primary-button" type="button" disabled={busy !== null} onClick={() => run("submit")}>
            {busy === "submit" ? "جارٍ الإرسال…" : "إرسال للمراجعة"}
          </button>
        ) : null}
        {state === "PENDING_REVIEW" && permissions.canReview ? (
          <button className="primary-button" type="button" disabled={busy !== null || reason.trim().length < 3} onClick={() => run("review")}>
            {busy === "review" ? "جارٍ الحفظ…" : "اعتماد نتيجة المراجعة"}
          </button>
        ) : null}
        {state === "REVIEWED" && permissions.canReview ? (
          <button className="primary-button" type="button" disabled={busy !== null} onClick={() => run("request-approval")}>
            {busy === "request-approval" ? "جارٍ الإرسال…" : "إرسال للاعتماد"}
          </button>
        ) : null}
        {state === "PENDING_APPROVAL" && permissions.canApprove ? (
          <button className="primary-button" type="button" disabled={busy !== null} onClick={() => run("approve")}>
            {busy === "approve" ? "جارٍ الاعتماد…" : "اعتماد المطابقة"}
          </button>
        ) : null}
        {(state === "PENDING_REVIEW" || state === "PENDING_APPROVAL") && (permissions.canReview || permissions.canApprove) ? (
          <>
            <button className="secondary-button" type="button" disabled={busy !== null || reason.trim().length < 3} onClick={() => run("return")}>
              {busy === "return" ? "جارٍ الإرجاع…" : "إرجاع للتصحيح"}
            </button>
            <button className="secondary-button" type="button" disabled={busy !== null || reason.trim().length < 3} onClick={() => run("reject")}>
              {busy === "reject" ? "جارٍ الرفض…" : "رفض المطابقة"}
            </button>
          </>
        ) : null}
        {state === "APPROVED" && permissions.canSettle ? (
          <button className="primary-button" type="button" disabled={busy !== null || reason.trim().length < 3} onClick={() => run("settle")}>
            {busy === "settle" ? "جارٍ إنشاء القيد…" : "تنفيذ التسوية"}
          </button>
        ) : null}
      </div>
      {message ? <p className="form-error" role="alert">{message}</p> : null}
      {["MATCHED", "REJECTED", "SETTLED"].includes(state) ? (
        <p>هذه حالة نهائية ولا توجد عليها إجراءات تعديل.</p>
      ) : null}
    </section>
  );
}
