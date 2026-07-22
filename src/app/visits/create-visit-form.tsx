"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type {
  FieldVisitCustomerOption,
  FieldVisitPlanItemOption,
  FieldVisitRepresentativeOption,
} from "@/lib/visits/options";

interface Props {
  readonly planItems: readonly FieldVisitPlanItemOption[];
  readonly customers: readonly FieldVisitCustomerOption[];
  readonly representatives: readonly FieldVisitRepresentativeOption[];
}

export function CreateVisitForm({ planItems, customers, representatives }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"PLAN" | "OUT_OF_PLAN">(
    planItems.length > 0 ? "PLAN" : "OUT_OF_PLAN",
  );
  const [planItemId, setPlanItemId] = useState(planItems[0]?.id ?? "");
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [representativeId, setRepresentativeId] = useState(representatives[0]?.id ?? "");
  const [visitType, setVisitType] = useState("MIXED");
  const [objective, setObjective] = useState(planItems[0]?.objective ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const selectedPlanItem = useMemo(
    () => planItems.find((item) => item.id === planItemId) ?? null,
    [planItemId, planItems],
  );

  function choosePlanItem(value: string) {
    setPlanItemId(value);
    const item = planItems.find((entry) => entry.id === value);
    if (item) {
      setObjective(item.objective);
      setVisitType(item.taskType);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = mode === "PLAN"
        ? {
            customerId: selectedPlanItem?.customerId,
            planId: selectedPlanItem?.planId,
            planItemId: selectedPlanItem?.id,
            visitType,
            objective,
          }
        : {
            customerId,
            representativeId,
            visitType,
            objective,
            outOfPlanReason: reason,
          };
      const response = await fetch("/api/v1/visits", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `visit-create-${crypto.randomUUID()}`,
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as {
        readonly success: boolean;
        readonly data?: { readonly visit?: { readonly id: string } };
        readonly error?: { readonly message?: string };
      };
      if (!response.ok || !body.success || !body.data?.visit?.id) {
        throw new Error(body.error?.message ?? "تعذر إنشاء الزيارة.");
      }
      router.push(`/visits/${body.data.visit.id}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر إنشاء الزيارة.");
    } finally {
      setSubmitting(false);
    }
  }

  const outOfPlanUnavailable = customers.length === 0 || representatives.length === 0;

  return (
    <section className="panel">
      <h2>إنشاء زيارة</h2>
      <form className="promise-form" onSubmit={submit}>
        <div className="promise-field">
          <label htmlFor="visit-mode">مصدر الزيارة</label>
          <select id="visit-mode" value={mode} onChange={(event) => setMode(event.target.value as "PLAN" | "OUT_OF_PLAN")}>
            <option value="PLAN" disabled={planItems.length === 0}>من الخطة المعتمدة</option>
            <option value="OUT_OF_PLAN" disabled={outOfPlanUnavailable}>خارج الخطة بسبب موثق</option>
          </select>
        </div>
        {mode === "PLAN" ? (
          <div className="promise-field">
            <label htmlFor="plan-item">عنصر الخطة</label>
            <select id="plan-item" value={planItemId} onChange={(event) => choosePlanItem(event.target.value)} required>
              {planItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.representativeName} — {item.customerName} — {item.objective}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <>
            <div className="promise-field">
              <label htmlFor="visit-representative">المندوب المسؤول</label>
              <select id="visit-representative" value={representativeId} onChange={(event) => setRepresentativeId(event.target.value)} required>
                {representatives.map((representative) => (
                  <option key={representative.id} value={representative.id}>
                    {representative.name} — {representative.employeeCode}
                  </option>
                ))}
              </select>
            </div>
            <div className="promise-field">
              <label htmlFor="visit-customer">العميل</label>
              <select id="visit-customer" value={customerId} onChange={(event) => setCustomerId(event.target.value)} required>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}{customer.number ? ` — ${customer.number}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        <div className="promise-field">
          <label htmlFor="visit-type">نوع الزيارة</label>
          <select id="visit-type" value={visitType} onChange={(event) => setVisitType(event.target.value)}>
            <option value="COLLECTION">تحصيل</option>
            <option value="SALES">بيع</option>
            <option value="PROMISE_FOLLOWUP">متابعة وعد</option>
            <option value="RECONCILIATION">مطابقة</option>
            <option value="DATA_UPDATE">تحديث بيانات</option>
            <option value="PROBLEM_RESOLUTION">حل مشكلة</option>
            <option value="MIXED">مهمة مختلطة</option>
          </select>
        </div>
        <div className="promise-field full-width">
          <label htmlFor="visit-objective">الهدف</label>
          <textarea id="visit-objective" value={objective} onChange={(event) => setObjective(event.target.value)} required minLength={2} />
        </div>
        {mode === "OUT_OF_PLAN" ? (
          <div className="promise-field full-width">
            <label htmlFor="out-of-plan-reason">سبب الخروج عن الخطة</label>
            <textarea id="out-of-plan-reason" value={reason} onChange={(event) => setReason(event.target.value)} required minLength={2} />
          </div>
        ) : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button
          className="primary-button"
          type="submit"
          disabled={submitting || (mode === "PLAN" ? !selectedPlanItem : outOfPlanUnavailable || !representativeId || !customerId)}
        >
          {submitting ? "جارٍ الإنشاء…" : "إنشاء الزيارة"}
        </button>
      </form>
    </section>
  );
}
