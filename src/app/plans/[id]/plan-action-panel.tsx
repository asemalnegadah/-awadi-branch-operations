"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { DailyPlanRouteOption } from "@/lib/plans/options";
import type { DailyPlanUiActions } from "@/lib/plans/presentation";
import type { DailyPlan, DailyPlanItem } from "@/lib/plans/types";

export function PlanActionPanel({
  plan,
  items,
  routes,
  actions,
}: Readonly<{
  plan: DailyPlan;
  items: readonly DailyPlanItem[];
  routes: readonly DailyPlanRouteOption[];
  actions: DailyPlanUiActions;
}>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function request(path: string, method: "POST" | "PATCH" | "DELETE", payload: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(path, {
        method,
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "تعذر تنفيذ العملية.");
      setMessage("تم تنفيذ العملية بنجاح.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تنفيذ العملية.");
    } finally {
      setBusy(false);
    }
  }

  async function transition(event: FormEvent<HTMLFormElement>, action: string, reasonRequired = false) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await request(`/api/v1/plans/${plan.id}/${action}`, "POST", {
      version: plan.version,
      reason: reasonRequired ? String(data.get("reason") ?? "").trim() : undefined,
    });
  }

  const hasTransitions = actions.submit || actions.approve || actions.reject || actions.start || actions.complete || actions.cancel;
  if (!hasTransitions && !actions.manageItems) return null;

  return (
    <section className="panel promise-section">
      <h2>الإجراءات المتاحة</h2>
      {message ? <p className={message.startsWith("تم") ? "status-pill fulfilled" : "form-error"} role="status">{message}</p> : null}
      <div className="promise-action-grid">
        {actions.submit ? <TransitionForm title="إرسال الخطة للاعتماد" button="إرسال" busy={busy} onSubmit={(event) => transition(event, "submit")} /> : null}
        {actions.approve ? <TransitionForm title="اعتماد الخطة" button="اعتماد" busy={busy} onSubmit={(event) => transition(event, "approve")} /> : null}
        {actions.reject ? <TransitionForm title="رفض الخطة" button="رفض" busy={busy} reasonRequired danger onSubmit={(event) => transition(event, "reject", true)} /> : null}
        {actions.start ? <TransitionForm title="بدء تنفيذ الخطة" button="بدء" busy={busy} onSubmit={(event) => transition(event, "start")} /> : null}
        {actions.complete ? <TransitionForm title="إكمال الخطة" button="إكمال" busy={busy} onSubmit={(event) => transition(event, "complete")} /> : null}
        {actions.cancel ? <TransitionForm title="إلغاء الخطة" button="إلغاء" busy={busy} reasonRequired danger onSubmit={(event) => transition(event, "cancel", true)} /> : null}
      </div>

      {actions.manageItems ? (
        <div>
          <h3>تعديل عناصر المسودة</h3>
          <p>كل تغيير يتطلب سببًا ويُسجل في سجل تعديلات Append-only.</p>
          <div className="promise-action-grid">
            {items.map((item) => (
              <form
                className="promise-action-form"
                key={item.id}
                onSubmit={async (event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  const routeValue = String(data.get("routeId") ?? "").trim();
                  await request(`/api/v1/plans/${plan.id}/items/${item.id}`, "PATCH", {
                    version: item.version,
                    reason: String(data.get("reason") ?? "").trim(),
                    taskType: String(data.get("taskType")),
                    objective: String(data.get("objective")),
                    expectedResult: String(data.get("expectedResult")),
                    targetCollectionSrMinor: majorToMinor(data.get("targetCollectionSr"), true),
                    targetCollectionRgMinor: majorToMinor(data.get("targetCollectionRg"), true),
                    targetSalesSrMinor: majorToMinor(data.get("targetSalesSr"), true),
                    targetSalesRgMinor: majorToMinor(data.get("targetSalesRg"), true),
                    routeId: routeValue || null,
                    estimatedVisitMinutes: Number(data.get("estimatedVisitMinutes")),
                    estimatedTravelMinutes: Number(data.get("estimatedTravelMinutes")),
                  });
                }}
              >
                <h3>#{item.sequenceNumber} — {item.customerName}</h3>
                <div className="promise-field"><label>نوع المهمة</label><select name="taskType" defaultValue={item.taskType}><option value="COLLECTION">تحصيل</option><option value="PROMISE_FOLLOWUP">متابعة وعد</option><option value="RECONCILIATION">مطابقة</option><option value="SALES">بيع</option><option value="DATA_UPDATE">تحديث بيانات</option><option value="PROBLEM_RESOLUTION">حل مشكلة</option><option value="MIXED">مركبة</option></select></div>
                <div className="promise-field"><label>المسار</label><select name="routeId" defaultValue={item.routeId ?? ""}><option value="">بلا مسار</option>{routes.map((route) => <option key={route.id} value={route.id}>{route.areaName} — {route.name}</option>)}</select></div>
                <div className="promise-field full-width"><label>الهدف</label><textarea name="objective" defaultValue={item.objective} required /></div>
                <div className="promise-field full-width"><label>النتيجة المتوقعة</label><textarea name="expectedResult" defaultValue={item.expectedResult} required /></div>
                <MoneyInput name="targetCollectionSr" label="تحصيل SR" minor={item.targetCollectionSrMinor} />
                <MoneyInput name="targetCollectionRg" label="تحصيل RG" minor={item.targetCollectionRgMinor} />
                <MoneyInput name="targetSalesSr" label="بيع SR" minor={item.targetSalesSrMinor} />
                <MoneyInput name="targetSalesRg" label="بيع RG" minor={item.targetSalesRgMinor} />
                <div className="promise-field"><label>دقائق الزيارة</label><input name="estimatedVisitMinutes" type="number" min="5" max="480" defaultValue={item.estimatedVisitMinutes} required /></div>
                <div className="promise-field"><label>دقائق التنقل</label><input name="estimatedTravelMinutes" type="number" min="0" max="1440" defaultValue={item.estimatedTravelMinutes} required /></div>
                <div className="promise-field full-width"><label>سبب التعديل</label><textarea name="reason" required /></div>
                <button className="primary-button" disabled={busy}>حفظ التعديل</button>
                <button
                  className="promise-danger-button"
                  disabled={busy}
                  type="button"
                  onClick={async () => {
                    const reason = window.prompt("اكتب سبب حذف العنصر من المسودة:");
                    if (!reason?.trim()) return;
                    await request(`/api/v1/plans/${plan.id}/items/${item.id}`, "DELETE", {
                      version: item.version,
                      reason: reason.trim(),
                    });
                  }}
                >حذف العنصر</button>
              </form>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TransitionForm({ title, button, reasonRequired = false, danger = false, busy, onSubmit }: Readonly<{
  title: string;
  button: string;
  reasonRequired?: boolean;
  danger?: boolean;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
}>) {
  return (
    <form className="promise-action-form" onSubmit={onSubmit}>
      <h3>{title}</h3>
      {reasonRequired ? <div className="promise-field"><label>السبب</label><textarea name="reason" required /></div> : <p>يسجل المستخدم والوقت وRequest ID تلقائيًا.</p>}
      <button className={danger ? "promise-danger-button" : "primary-button"} disabled={busy}>{button}</button>
    </form>
  );
}

function MoneyInput({ name, label, minor }: Readonly<{ name: string; label: string; minor: number }>) {
  return <div className="promise-field"><label>{label}</label><input name={name} type="number" min="0" step="0.01" defaultValue={(minor / 100).toFixed(2)} required /></div>;
}

function majorToMinor(value: FormDataEntryValue | null, allowZero: boolean): number {
  const amount = Number(String(value ?? "").trim());
  if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount === 0)) {
    throw new Error("أحد المبالغ غير صالح.");
  }
  const minor = Math.round(amount * 100);
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error("أحد المبالغ خارج النطاق.");
  return minor;
}
