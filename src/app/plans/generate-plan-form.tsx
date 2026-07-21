"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { DailyPlanRepresentativeOption } from "@/lib/plans/options";

export function GeneratePlanForm({
  representatives,
  today,
}: Readonly<{
  representatives: readonly DailyPlanRepresentativeOption[];
  today: string;
}>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setMessage(null);
    try {
      const fuelCurrency = String(data.get("fuelBudgetCurrencyCode") ?? "").trim();
      const fuelAmount = String(data.get("fuelBudget") ?? "").trim();
      const response = await fetch("/api/v1/plans/generate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          representativeId: String(data.get("representativeId")),
          planDate: String(data.get("planDate")),
          maxItems: Number(data.get("maxItems")),
          workMinutesBudget: Number(data.get("workMinutesBudget")),
          fuelBudgetCurrencyCode: fuelCurrency || null,
          fuelBudgetMinor: fuelAmount ? majorToMinor(fuelAmount) : null,
          notes: String(data.get("notes") ?? "").trim() || null,
        }),
      });
      const body = await response.json() as {
        data?: { details?: { plan?: { id?: string } } };
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "تعذر توليد الخطة.");
      const planId = body.data?.details?.plan?.id;
      if (!planId) throw new Error("تم التوليد دون معرف خطة صالح.");
      setMessage("تم توليد الخطة وحفظ المرشحين المختارين والمستبعدين.");
      router.push(`/plans/${planId}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر توليد الخطة.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel promise-section">
      <h2>توليد خطة يومية</h2>
      <p>يعتمد الترتيب على بيانات الخادم عند وقت القطع، ويحفظ سبب الاختيار والاستبعاد.</p>
      {message ? <p className={message.startsWith("تم") ? "status-pill fulfilled" : "form-error"}>{message}</p> : null}
      <form className="promise-action-form" onSubmit={submit}>
        <div className="promise-field">
          <label htmlFor="representativeId">المندوب</label>
          <select id="representativeId" name="representativeId" required>
            <option value="">اختر المندوب</option>
            {representatives.map((representative) => (
              <option key={representative.id} value={representative.id}>
                {representative.name}{representative.employeeCode ? ` — ${representative.employeeCode}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="promise-field">
          <label htmlFor="planDate">يوم الخطة</label>
          <input id="planDate" name="planDate" type="date" min={today} defaultValue={today} required />
        </div>
        <div className="promise-field">
          <label htmlFor="maxItems">الحد الأقصى للزيارات</label>
          <input id="maxItems" name="maxItems" type="number" min="1" max="100" defaultValue="12" required />
        </div>
        <div className="promise-field">
          <label htmlFor="workMinutesBudget">طاقة يوم العمل بالدقائق</label>
          <input id="workMinutesBudget" name="workMinutesBudget" type="number" min="30" max="1440" defaultValue="480" required />
        </div>
        <div className="promise-field">
          <label htmlFor="fuelBudgetCurrencyCode">عملة ميزانية الوقود</label>
          <select id="fuelBudgetCurrencyCode" name="fuelBudgetCurrencyCode">
            <option value="">لا توجد ميزانية</option><option value="SR">SR</option><option value="RG">RG</option>
          </select>
        </div>
        <div className="promise-field">
          <label htmlFor="fuelBudget">ميزانية الوقود</label>
          <input id="fuelBudget" name="fuelBudget" type="number" min="0" step="0.01" />
        </div>
        <div className="promise-field full-width">
          <label htmlFor="notes">ملاحظات</label>
          <textarea id="notes" name="notes" maxLength={4000} />
        </div>
        <button className="primary-button" disabled={busy || representatives.length === 0}>
          {busy ? "جاري التوليد..." : "توليد الخطة"}
        </button>
      </form>
    </section>
  );
}

function majorToMinor(value: string): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("ميزانية الوقود غير صالحة.");
  const minor = Math.round(amount * 100);
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error("ميزانية الوقود خارج النطاق.");
  return minor;
}
