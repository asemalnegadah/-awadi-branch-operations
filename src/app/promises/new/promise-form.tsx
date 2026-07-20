"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import { parsePromiseMajorAmountToMinor } from "@/lib/promises/presentation";
import type { PromiseFormOptions } from "@/lib/promises/types";

export function CreatePromiseForm({ options }: Readonly<{ options: PromiseFormOptions }>) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(options.accounts[0]?.id ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const account = useMemo(() => options.accounts.find((item) => item.id === accountId), [accountId, options.accounts]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setMessage(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/promises", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          customerId: account?.customerId,
          customerAccountId: accountId,
          representativeId: String(data.get("representativeId")),
          currencyCode: account?.currencyCode,
          promisedAmountMinor: parsePromiseMajorAmountToMinor(data.get("promisedAmount")),
          promiseDate: String(data.get("promiseDate")),
          dueDate: String(data.get("dueDate")),
          nextFollowUpAt: dateTimeOrNull(data.get("nextFollowUpAt")),
          debtReason: String(data.get("debtReason")),
          delayReason: String(data.get("delayReason") ?? ""),
          notes: String(data.get("notes") ?? ""),
        }),
      });
      const body = await response.json() as { data?: { promise?: { id?: string } }; error?: { message?: string } };
      if (!response.ok || !body.data?.promise?.id) throw new Error(body.error?.message ?? "تعذر إنشاء الوعد.");
      router.push(`/promises/${body.data.promise.id}`); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر إنشاء الوعد."); }
    finally { setSubmitting(false); }
  }

  return (
    <form className="promise-form promise-section" onSubmit={submit}>
      <div className="promise-field full-width"><label htmlFor="accountId">حساب العميل والعملة</label><select id="accountId" value={accountId} onChange={(event) => setAccountId(event.target.value)} required>{options.accounts.map((item) => <option key={item.id} value={item.id}>{item.customerName} — {item.customerNumber ?? "بلا رقم"} — {item.currencyCode}</option>)}</select></div>
      <div className="promise-field"><label htmlFor="representativeId">المندوب المسؤول</label><select id="representativeId" name="representativeId" required>{options.representatives.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      <div className="promise-field"><label htmlFor="promisedAmount">المبلغ الموعود ({account?.currencyCode ?? ""})</label><input id="promisedAmount" name="promisedAmount" type="number" min="0.01" step="0.01" inputMode="decimal" required /></div>
      <div className="promise-field"><label htmlFor="promiseDate">تاريخ الوعد</label><input id="promiseDate" name="promiseDate" type="date" required /></div>
      <div className="promise-field"><label htmlFor="dueDate">تاريخ الاستحقاق</label><input id="dueDate" name="dueDate" type="date" required /></div>
      <div className="promise-field full-width"><label htmlFor="nextFollowUpAt">المتابعة القادمة</label><input id="nextFollowUpAt" name="nextFollowUpAt" type="datetime-local" /></div>
      <div className="promise-field full-width"><label htmlFor="debtReason">سبب الدين</label><textarea id="debtReason" name="debtReason" maxLength={1000} required /></div>
      <div className="promise-field full-width"><label htmlFor="delayReason">سبب التأخير</label><textarea id="delayReason" name="delayReason" maxLength={1000} /></div>
      <div className="promise-field full-width"><label htmlFor="notes">ملاحظات</label><textarea id="notes" name="notes" maxLength={4000} /></div>
      {message ? <p className="form-error promise-form-message" role="alert">{message}</p> : null}
      <button className="primary-button full-width" type="submit" disabled={submitting}>{submitting ? "جارٍ الحفظ…" : "حفظ الوعد"}</button>
    </form>
  );
}

function dateTimeOrNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text ? new Date(text).toISOString() : null;
}
