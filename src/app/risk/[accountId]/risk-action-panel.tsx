"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { CreditRiskUiActions } from "@/lib/risk/presentation";
import type { CreditException, CreditRestriction } from "@/lib/risk/types";

interface Props {
  readonly customerAccountId: string;
  readonly currencyCode: "SR" | "RG";
  readonly assessmentId: string | null;
  readonly restriction: CreditRestriction | null;
  readonly exception: CreditException | null;
  readonly actions: CreditRiskUiActions;
}

export function RiskActionPanel(props: Props) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasActions = Object.values(props.actions).some(Boolean);
  if (!hasActions) return null;

  async function submit(
    event: FormEvent<HTMLFormElement>,
    path: string,
    payload: (data: FormData) => Record<string, unknown>,
  ) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(payload(data)),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "تعذر تنفيذ العملية.");
      setMessage("تم تنفيذ العملية بنجاح.");
      form.reset();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تنفيذ العملية.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel promise-section">
      <h2>الإجراءات المتاحة</h2>
      {message ? (
        <p className={message.includes("بنجاح") ? "status-pill fulfilled" : "form-error"} role="status">
          {message}
        </p>
      ) : null}
      <div className="promise-action-grid">
        {props.actions.recalculate ? (
          <form className="promise-action-form" onSubmit={(event) => submit(event, "/api/v1/risk/recalculate", () => ({ customerAccountId: props.customerAccountId }))}>
            <h3>إعادة حساب المخاطر</h3>
            <p>يقرأ النظام دفتر الحركات والوعود والتحصيلات وبيانات العميل من الخادم، ثم يحفظ Snapshot جديدًا.</p>
            <button className="primary-button" disabled={busy}>إعادة الحساب</button>
          </form>
        ) : null}

        {props.actions.proposeRestriction ? (
          <form className="promise-action-form" onSubmit={(event) => submit(event, "/api/v1/credit-restrictions", (data) => ({
            customerAccountId: props.customerAccountId,
            decisionType: String(data.get("decisionType")),
            limitAmountMinor: optionalMajorToMinor(data.get("limitAmount")),
            reasonCode: String(data.get("reasonCode")),
            reasonText: String(data.get("reasonText")),
            sourceAssessmentId: props.assessmentId,
            effectiveFrom: dateTime(data.get("effectiveFrom")),
            reviewDueAt: optionalDateTime(data.get("reviewDueAt")),
            expiresAt: optionalDateTime(data.get("expiresAt")),
            restorationConditions: String(data.get("restorationConditions")),
          }))}>
            <h3>اقتراح قرار ائتماني</h3>
            <div className="promise-field"><label>نوع القرار</label><select name="decisionType" required><option value="BLOCK">منع كامل</option><option value="SUSPEND">تعليق الآجل</option><option value="LIMIT">تحديد حد</option></select></div>
            <div className="promise-field"><label>الحد ({props.currencyCode}) عند اختيار التحديد</label><input name="limitAmount" type="number" min="0.01" step="0.01" /></div>
            <div className="promise-field"><label>سبب القرار</label><select name="reasonCode" required><option value="OLD_DEBT">دين قديم</option><option value="BROKEN_PROMISE">وعد مكسور</option><option value="CREDIT_LIMIT_EXCEEDED">تجاوز الحد</option><option value="CLOSED_OR_BANKRUPT">إغلاق أو إفلاس</option><option value="RECONCILIATION_DIFFERENCE">فرق مطابقة</option><option value="DISPUTE">نزاع</option><option value="MISSING_CONTACT">بيانات اتصال ناقصة</option><option value="NO_VISIT">عدم زيارة</option><option value="UNHANDED_COLLECTION">تحصيل غير مسلّم</option><option value="MANAGER_DECISION">قرار مدير</option><option value="OTHER">سبب آخر</option></select></div>
            <div className="promise-field full-width"><label>شرح السبب</label><textarea name="reasonText" required /></div>
            <div className="promise-field"><label>يبدأ من</label><input name="effectiveFrom" type="datetime-local" required /></div>
            <div className="promise-field"><label>مراجعة في</label><input name="reviewDueAt" type="datetime-local" /></div>
            <div className="promise-field"><label>ينتهي في</label><input name="expiresAt" type="datetime-local" /></div>
            <div className="promise-field full-width"><label>شروط إعادة السماح</label><textarea name="restorationConditions" required /></div>
            <button className="primary-button" disabled={busy}>حفظ المسودة</button>
          </form>
        ) : null}

        {props.actions.submitRestriction && props.restriction ? (
          <TransitionForm title="إرسال قرار المنع للاعتماد" button="إرسال" path={`/api/v1/credit-restrictions/${props.restriction.id}/submit`} version={props.restriction.version} busy={busy} submit={submit} />
        ) : null}
        {props.actions.approveRestriction && props.restriction ? (
          <TransitionForm title="اعتماد قرار المنع" button="اعتماد" path={`/api/v1/credit-restrictions/${props.restriction.id}/approve`} version={props.restriction.version} busy={busy} submit={submit} />
        ) : null}
        {props.actions.rejectRestriction && props.restriction ? (
          <TransitionForm title="رفض قرار المنع" button="رفض" path={`/api/v1/credit-restrictions/${props.restriction.id}/reject`} version={props.restriction.version} reasonRequired danger busy={busy} submit={submit} />
        ) : null}
        {props.actions.revokeRestriction && props.restriction ? (
          <TransitionForm title="إلغاء قرار المنع" button="إلغاء القرار" path={`/api/v1/credit-restrictions/${props.restriction.id}/revoke`} version={props.restriction.version} reasonRequired danger busy={busy} submit={submit} />
        ) : null}

        {props.actions.proposeException && props.restriction ? (
          <form className="promise-action-form" onSubmit={(event) => submit(event, "/api/v1/credit-exceptions", (data) => ({
            restrictionId: props.restriction?.id,
            scope: String(data.get("scope")),
            maxAmountMinor: majorToMinor(data.get("maxAmount")),
            validFrom: dateTime(data.get("validFrom")),
            validUntil: dateTime(data.get("validUntil")),
            reason: String(data.get("reason")),
            conditions: String(data.get("conditions")),
          }))}>
            <h3>اقتراح استثناء</h3>
            <div className="promise-field"><label>النطاق</label><select name="scope" required><option value="SINGLE_TRANSACTION">عملية واحدة</option><option value="MULTIPLE_TRANSACTIONS">عدة عمليات</option></select></div>
            <div className="promise-field"><label>الحد الأقصى ({props.currencyCode})</label><input name="maxAmount" type="number" min="0.01" step="0.01" required /></div>
            <div className="promise-field"><label>يبدأ من</label><input name="validFrom" type="datetime-local" required /></div>
            <div className="promise-field"><label>ينتهي في</label><input name="validUntil" type="datetime-local" required /></div>
            <div className="promise-field full-width"><label>السبب</label><textarea name="reason" required /></div>
            <div className="promise-field full-width"><label>الشروط</label><textarea name="conditions" required /></div>
            <button className="primary-button" disabled={busy}>حفظ الاستثناء</button>
          </form>
        ) : null}

        {props.actions.submitException && props.exception ? (
          <TransitionForm title="إرسال الاستثناء للاعتماد" button="إرسال" path={`/api/v1/credit-exceptions/${props.exception.id}/submit`} version={props.exception.version} busy={busy} submit={submit} />
        ) : null}
        {props.actions.approveException && props.exception ? (
          <TransitionForm title="اعتماد الاستثناء" button="اعتماد" path={`/api/v1/credit-exceptions/${props.exception.id}/approve`} version={props.exception.version} busy={busy} submit={submit} />
        ) : null}
        {props.actions.rejectException && props.exception ? (
          <TransitionForm title="رفض الاستثناء" button="رفض" path={`/api/v1/credit-exceptions/${props.exception.id}/reject`} version={props.exception.version} reasonRequired danger busy={busy} submit={submit} />
        ) : null}
        {props.actions.revokeException && props.exception ? (
          <TransitionForm title="إلغاء الاستثناء" button="إلغاء الاستثناء" path={`/api/v1/credit-exceptions/${props.exception.id}/revoke`} version={props.exception.version} reasonRequired danger busy={busy} submit={submit} />
        ) : null}
      </div>
    </section>
  );
}

type SubmitFunction = (
  event: FormEvent<HTMLFormElement>,
  path: string,
  payload: (data: FormData) => Record<string, unknown>,
) => Promise<void>;

function TransitionForm({
  title,
  button,
  path,
  version,
  reasonRequired = false,
  danger = false,
  busy,
  submit,
}: Readonly<{
  title: string;
  button: string;
  path: string;
  version: number;
  reasonRequired?: boolean;
  danger?: boolean;
  busy: boolean;
  submit: SubmitFunction;
}>) {
  return (
    <form className="promise-action-form" onSubmit={(event) => submit(event, path, (data) => ({
      version,
      reason: reasonRequired ? String(data.get("reason")) : undefined,
    }))}>
      <h3>{title}</h3>
      {reasonRequired ? <div className="promise-field"><label>السبب</label><textarea name="reason" required /></div> : <p>سيتم تسجيل المنفذ والوقت وRequest ID في سجل التدقيق.</p>}
      <button className={danger ? "promise-danger-button" : "primary-button"} disabled={busy}>{button}</button>
    </form>
  );
}

function majorToMinor(value: FormDataEntryValue | null): number {
  const amount = Number(String(value ?? "").trim());
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("المبلغ غير صالح.");
  const minor = Math.round(amount * 100);
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error("المبلغ خارج النطاق المسموح.");
  return minor;
}

function optionalMajorToMinor(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  return text ? majorToMinor(text) : null;
}

function dateTime(value: FormDataEntryValue | null): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error("التاريخ والوقت مطلوبان.");
  return new Date(text).toISOString();
}

function optionalDateTime(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text ? new Date(text).toISOString() : null;
}
