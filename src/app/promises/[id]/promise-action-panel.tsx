"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  formatPromiseMinorForInput,
  formatPromiseMoney,
  parsePromiseMajorAmountToMinor,
  type PromiseUiActions,
} from "@/lib/promises/presentation";
import type {
  ConfirmedCollectionOption,
  PaymentPromise,
  PaymentPromiseAllocation,
  PromiseFormRepresentativeOption,
} from "@/lib/promises/types";

interface Props {
  readonly promise: PaymentPromise;
  readonly allocations: readonly PaymentPromiseAllocation[];
  readonly collections: readonly ConfirmedCollectionOption[];
  readonly representatives: readonly PromiseFormRepresentativeOption[];
  readonly actions: PromiseUiActions;
}

export function PromiseActionPanel(props: Props) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasActions = Object.values(props.actions).some(Boolean);
  if (!hasActions) return null;

  async function submit(
    event: FormEvent<HTMLFormElement>,
    path: string,
    method: "POST" | "PATCH",
    payload: (data: FormData) => Record<string, unknown>,
  ) {
    event.preventDefault(); setBusy(true); setMessage(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(path, {
        method,
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(payload(data)),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "تعذر تنفيذ العملية.");
      setMessage("تم تنفيذ العملية بنجاح."); router.refresh(); event.currentTarget.reset();
    } catch (error) { setMessage(error instanceof Error ? error.message : "تعذر تنفيذ العملية."); }
    finally { setBusy(false); }
  }

  const basePath = `/api/v1/promises/${props.promise.id}`;
  return (
    <section className="panel promise-section">
      <h2>الإجراءات المتاحة</h2>
      {message ? <p className={message.includes("بنجاح") ? "status-pill fulfilled" : "form-error"} role="status">{message}</p> : null}
      <div className="promise-action-grid">
        {props.actions.update ? (
          <form className="promise-action-form" onSubmit={(event) => submit(event, basePath, "PATCH", (data) => ({ version: props.promise.version, representativeId: String(data.get("representativeId")), promisedAmountMinor: parsePromiseMajorAmountToMinor(data.get("promisedAmount")), dueDate: String(data.get("dueDate")), debtReason: String(data.get("debtReason")), delayReason: String(data.get("delayReason") ?? ""), notes: String(data.get("notes") ?? "") }))}>
            <h3>تحديث الوعد</h3>
            <div className="promise-field"><label>المندوب</label><select name="representativeId" defaultValue={props.promise.representativeId}>{props.representatives.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
            <div className="promise-field"><label>المبلغ الموعود</label><input name="promisedAmount" type="number" min={formatPromiseMinorForInput(Math.max(1, props.promise.fulfilledAmountMinor))} step="0.01" inputMode="decimal" defaultValue={formatPromiseMinorForInput(props.promise.promisedAmountMinor)} required /></div>
            <div className="promise-field"><label>تاريخ الاستحقاق</label><input name="dueDate" type="date" defaultValue={props.promise.dueDate} required /></div>
            <div className="promise-field"><label>سبب الدين</label><textarea name="debtReason" defaultValue={props.promise.debtReason} required /></div>
            <div className="promise-field"><label>سبب التأخير</label><textarea name="delayReason" defaultValue={props.promise.delayReason ?? ""} /></div>
            <div className="promise-field"><label>الملاحظات</label><textarea name="notes" defaultValue={props.promise.notes ?? ""} /></div>
            <button className="primary-button" disabled={busy}>حفظ التحديث</button>
          </form>
        ) : null}

        {props.actions.followUp ? (
          <form className="promise-action-form" onSubmit={(event) => submit(event, `${basePath}/follow-ups`, "POST", (data) => ({ scheduledAt: new Date(String(data.get("scheduledAt"))).toISOString(), notes: String(data.get("notes") ?? "") }))}>
            <h3>إضافة متابعة</h3><div className="promise-field"><label>الموعد</label><input name="scheduledAt" type="datetime-local" required /></div><div className="promise-field"><label>الملاحظات</label><textarea name="notes" /></div><button className="primary-button" disabled={busy}>إضافة المتابعة</button>
          </form>
        ) : null}

        {props.actions.allocate ? (
          <form className="promise-action-form" onSubmit={(event) => submit(event, `${basePath}/allocations`, "POST", (data) => ({ collectionId: String(data.get("collectionId")), amountMinor: parsePromiseMajorAmountToMinor(data.get("amount")) }))}>
            <h3>ربط تحصيل مؤكد</h3>
            {props.collections.length === 0 ? <p>لا توجد تحصيلات مؤكدة متاحة لهذا العميل والعملة.</p> : <><div className="promise-field"><label>التحصيل</label><select name="collectionId" required>{props.collections.map((item) => <option key={item.id} value={item.id}>{item.receiptNumber ?? item.id} — {formatPromiseMoney(item.availableAmountMinor, item.currencyCode)} متاح</option>)}</select></div><div className="promise-field"><label>مبلغ الربط</label><input name="amount" type="number" min="0.01" step="0.01" inputMode="decimal" max={formatPromiseMinorForInput(props.promise.remainingAmountMinor)} required /></div><button className="primary-button" disabled={busy}>ربط التحصيل</button></>}
          </form>
        ) : null}

        {props.actions.escalate ? (
          <form className="promise-action-form" onSubmit={(event) => submit(event, `${basePath}/escalate`, "POST", (data) => ({ version: props.promise.version, level: Number(data.get("level")), reason: String(data.get("reason")) }))}>
            <h3>تصعيد الوعد</h3><div className="promise-field"><label>المستوى</label><select name="level" defaultValue={Math.min(5, Math.max(1, props.promise.escalationLevel + 1))}>{[1,2,3,4,5].map((level) => <option key={level} value={level}>{level}</option>)}</select></div><div className="promise-field"><label>السبب</label><textarea name="reason" required /></div><button className="primary-button" disabled={busy}>تنفيذ التصعيد</button>
          </form>
        ) : null}

        {props.actions.reject ? <ReasonForm title="رفض الوعد" button="رفض" danger path={`${basePath}/reject`} busy={busy} version={props.promise.version} submit={submit} /> : null}
        {props.actions.cancel ? <ReasonForm title="إلغاء الوعد" button="إلغاء" danger path={`${basePath}/cancel`} busy={busy} version={props.promise.version} submit={submit} /> : null}

        {props.actions.reverse ? props.allocations.filter((item) => !item.reversedAt).map((allocation) => (
          <form className="promise-action-form" key={allocation.id} onSubmit={(event) => submit(event, `${basePath}/allocations/${allocation.id}/reverse`, "POST", (data) => ({ reason: String(data.get("reason")) }))}>
            <h3>عكس ربط {formatPromiseMoney(allocation.amountMinor, allocation.currencyCode)}</h3><div className="promise-field"><label>سبب العكس</label><textarea name="reason" required /></div><button className="promise-danger-button" disabled={busy}>عكس الربط</button>
          </form>
        )) : null}
      </div>
    </section>
  );
}

function ReasonForm({ title, button, danger, path, busy, version, submit }: Readonly<{ title: string; button: string; danger: boolean; path: string; busy: boolean; version: number; submit: (event: FormEvent<HTMLFormElement>, path: string, method: "POST" | "PATCH", payload: (data: FormData) => Record<string, unknown>) => Promise<void> }>) {
  return <form className="promise-action-form" onSubmit={(event) => submit(event, path, "POST", (data) => ({ version, reason: String(data.get("reason")) }))}><h3>{title}</h3><div className="promise-field"><label>السبب</label><textarea name="reason" required /></div><button className={danger ? "promise-danger-button" : "primary-button"} disabled={busy}>{button}</button></form>;
}
