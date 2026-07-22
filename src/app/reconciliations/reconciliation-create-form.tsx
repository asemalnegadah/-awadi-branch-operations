"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ReconciliationAccountOption } from "@/lib/reconciliations/postgres-options-repository";

interface ApiResponse {
  readonly success: boolean;
  readonly data?: { readonly reconciliation?: { readonly id: string } };
  readonly error?: { readonly message?: string };
}

export function ReconciliationCreateForm({
  accounts,
}: Readonly<{ accounts: readonly ReconciliationAccountOption[] }>) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setSubmitting(true);
    setMessage(null);
    try {
      const expectedAmountMinor = parseMajorAmount(String(formData.get("expectedAmount") ?? ""));
      const observedAmountMinor = parseMajorAmount(String(formData.get("observedAmount") ?? ""));
      const response = await fetch("/api/v1/reconciliations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `reconciliation:create:${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          customerAccountId: String(formData.get("customerAccountId") ?? ""),
          sourceKind: String(formData.get("sourceKind") ?? ""),
          sourceType: String(formData.get("sourceType") ?? ""),
          sourceId: String(formData.get("sourceId") ?? ""),
          cutoffDate: String(formData.get("cutoffDate") ?? ""),
          expectedAmountMinor,
          observedAmountMinor,
        }),
      });
      const body = await response.json() as ApiResponse;
      if (!response.ok || !body.success) {
        throw new Error(body.error?.message ?? "تعذر إنشاء المطابقة.");
      }
      const id = body.data?.reconciliation?.id;
      if (!id) throw new Error("لم يرجع الخادم رقم المطابقة.");
      router.push(`/reconciliations/${id}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر إنشاء المطابقة.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="promise-form" action={submit} aria-label="إنشاء مطابقة جديدة">
      <h2>إنشاء مطابقة</h2>
      <div className="promise-field">
        <label htmlFor="customerAccountId">حساب العميل والعملة</label>
        <select id="customerAccountId" name="customerAccountId" required defaultValue="">
          <option value="" disabled>اختر الحساب</option>
          {accounts.map((account) => (
            <option key={account.customerAccountId} value={account.customerAccountId}>
              {account.customerName} — {account.customerNumber ?? "بلا رقم"} — {account.currencyCode}
            </option>
          ))}
        </select>
      </div>
      <div className="promise-field">
        <label htmlFor="sourceKind">نوع المطابقة</label>
        <select id="sourceKind" name="sourceKind" required defaultValue="LEDGER_TO_STATEMENT">
          <option value="LEDGER_TO_STATEMENT">الدفتر مقابل كشف الحساب</option>
          <option value="COLLECTION_TO_LEDGER">التحصيلات مقابل الدفتر</option>
          <option value="IMPORT_TO_LEDGER">نتيجة الاستيراد مقابل الدفتر</option>
          <option value="CUSTODY_TO_COLLECTION">العهدة مقابل التحصيلات</option>
        </select>
      </div>
      <div className="promise-field">
        <label htmlFor="sourceType">مرجع المصدر</label>
        <input id="sourceType" name="sourceType" required maxLength={80} placeholder="ONYX_STATEMENT" />
      </div>
      <div className="promise-field">
        <label htmlFor="sourceId">رقم أو معرف المصدر</label>
        <input id="sourceId" name="sourceId" required maxLength={160} />
      </div>
      <div className="promise-field">
        <label htmlFor="cutoffDate">تاريخ القطع</label>
        <input id="cutoffDate" name="cutoffDate" type="date" required />
      </div>
      <div className="promise-field">
        <label htmlFor="expectedAmount">المبلغ المتوقع</label>
        <input id="expectedAmount" name="expectedAmount" inputMode="decimal" required placeholder="0.00" />
      </div>
      <div className="promise-field">
        <label htmlFor="observedAmount">المبلغ المرصود</label>
        <input id="observedAmount" name="observedAmount" inputMode="decimal" required placeholder="0.00" />
      </div>
      {message ? <p className="form-error" role="alert">{message}</p> : null}
      <button className="primary-button" type="submit" disabled={submitting || accounts.length === 0}>
        {submitting ? "جارٍ الحفظ…" : "حفظ المسودة"}
      </button>
    </form>
  );
}

function parseMajorAmount(raw: string): number {
  const normalized = raw.trim().replace(/,/gu, "");
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/u.exec(normalized);
  if (!match) throw new Error("المبلغ يجب أن يكون رقمًا صحيحًا مع منزلتين عشريتين كحد أقصى.");
  const sign = match[1] === "-" ? -1 : 1;
  const major = Number(match[2]);
  const fraction = Number((match[3] ?? "").padEnd(2, "0"));
  const minor = sign * (major * 100 + fraction);
  if (!Number.isSafeInteger(minor)) throw new Error("المبلغ خارج النطاق المسموح.");
  return minor;
}
