import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireCurrentSession } from "@/lib/auth/current-session";
import { getDatabaseClient } from "@/lib/db/client";
import {
  availablePromiseActions,
  formatPromiseMoney,
  promiseEventLabel,
  promiseStatusLabel,
  promiseTemporalLabel,
} from "@/lib/promises/presentation";
import {
  getPromiseDetails,
  getPromiseUpdateFormOptions,
  listAvailableConfirmedCollections,
} from "@/lib/promises/service";
import { parsePromiseId } from "@/lib/promises/validation";
import { PromiseNotFoundError } from "@/lib/promises/errors";

import { PromiseActionPanel } from "./promise-action-panel";

export const metadata: Metadata = { title: "تفاصيل وعد السداد" };
export const dynamic = "force-dynamic";

type PageContext = { readonly params: Promise<{ readonly id: string }> };

export default async function PromiseDetailsPage({ params }: PageContext) {
  const session = await requireCurrentSession();
  if (session.user.mustChangePassword) redirect("/settings/security");
  const { id: rawId } = await params;
  let id: string;
  try { id = parsePromiseId(rawId); } catch { notFound(); }

  const db = getDatabaseClient();
  let details;
  try { details = await getPromiseDetails(db, id, { actor: session.user }); }
  catch (error) { if (error instanceof PromiseNotFoundError) notFound(); throw error; }

  const actions = availablePromiseActions(session.user, details.promise);
  const [formOptions, collections] = await Promise.all([
    actions.update
      ? getPromiseUpdateFormOptions(db, { actor: session.user })
      : Promise.resolve(null),
    actions.allocate
      ? listAvailableConfirmedCollections(db, id, { actor: session.user })
      : Promise.resolve([]),
  ]);
  const temporal = promiseTemporalLabel(details.promise);

  return (
    <main className="shell promises-shell">
      <header className="promise-detail-header">
        <div>
          <p className="eyebrow dark-eyebrow">وعد سداد – فرع عدن</p>
          <h1>{details.promise.customerName}</h1>
          <p className="dashboard-welcome">
            {details.promise.customerNumber ?? "بلا رقم عميل"} — {details.promise.representativeName}
          </p>
        </div>
        <div className="promises-actions">
          <Link className="secondary-button button-link" href="/promises">قائمة الوعود</Link>
          <span className={`status-pill ${details.promise.baseStatus === "FULFILLED" ? "fulfilled" : ""}`}>{promiseStatusLabel(details.promise.baseStatus)}</span>
          {temporal ? <span className={`status-pill ${details.promise.temporalStatus === "OVERDUE" ? "overdue" : "due"}`}>{temporal}</span> : null}
        </div>
      </header>

      <section className="grid promise-detail-grid" aria-label="بيانات الوعد">
        <article className="card"><span className="card-label">المبلغ الموعود</span><strong>{formatPromiseMoney(details.promise.promisedAmountMinor, details.promise.currencyCode)}</strong><small>العملة مستقلة: {details.promise.currencyCode}</small></article>
        <article className="card"><span className="card-label">المنفذ</span><strong>{formatPromiseMoney(details.promise.fulfilledAmountMinor, details.promise.currencyCode)}</strong><small>من تحصيلات مؤكدة فقط</small></article>
        <article className="card"><span className="card-label">المتبقي</span><strong>{formatPromiseMoney(details.promise.remainingAmountMinor, details.promise.currencyCode)}</strong><small>محسوب من قاعدة البيانات</small></article>
        <article className="card"><span className="card-label">تاريخ الوعد</span><strong>{details.promise.promiseDate}</strong><small>الإصدار {details.promise.version}</small></article>
        <article className="card"><span className="card-label">الاستحقاق</span><strong>{details.promise.dueDate}</strong><small>{temporal ?? "ضمن المسار الزمني"}</small></article>
        <article className="card"><span className="card-label">المتابعة القادمة</span><strong>{formatDateTime(details.promise.nextFollowUpAt)}</strong><small>مستخرجة من أقرب متابعة مفتوحة</small></article>
      </section>

      <section className="panel promise-section">
        <h2>تفاصيل الدين</h2>
        <p><strong>سبب الدين:</strong> {details.promise.debtReason}</p>
        <p><strong>سبب التأخير:</strong> {details.promise.delayReason ?? "غير مسجل"}</p>
        <p><strong>الملاحظات:</strong> {details.promise.notes ?? "لا توجد"}</p>
        <p><strong>مستوى التصعيد:</strong> {details.promise.escalationLevel}</p>
      </section>

      <section className="panel promise-section">
        <div className="promise-section-header"><h2>المتابعات</h2><span>{details.followUps.length}</span></div>
        {details.followUps.length === 0 ? <p>لا توجد متابعات مسجلة.</p> : (
          <div className="promise-table-wrap"><table className="promise-table"><thead><tr><th>الموعد</th><th>الإكمال</th><th>النتيجة</th><th>الملاحظات</th><th>المنشئ</th></tr></thead><tbody>{details.followUps.map((followUp) => <tr key={followUp.id}><td>{formatDateTime(followUp.scheduledAt)}</td><td>{formatDateTime(followUp.completedAt)}</td><td>{followUp.outcome ?? "مفتوحة"}</td><td>{followUp.notes ?? "—"}</td><td>{followUp.createdByName}</td></tr>)}</tbody></table></div>
        )}
      </section>

      <section className="panel promise-section">
        <div className="promise-section-header"><h2>روابط التحصيل</h2><span>{details.allocations.length}</span></div>
        {details.allocations.length === 0 ? <p>لم يُربط تحصيل مؤكد بهذا الوعد.</p> : (
          <div className="promise-table-wrap"><table className="promise-table"><thead><tr><th>التحصيل</th><th>المبلغ</th><th>وقت الربط</th><th>الحالة</th></tr></thead><tbody>{details.allocations.map((allocation) => <tr key={allocation.id}><td>{allocation.collectionId}</td><td>{formatPromiseMoney(allocation.amountMinor, allocation.currencyCode)}</td><td>{formatDateTime(allocation.allocatedAt)}</td><td>{allocation.reversedAt ? `معكوس: ${allocation.reversalReason ?? ""}` : "فعال"}</td></tr>)}</tbody></table></div>
        )}
      </section>

      {actions.viewHistory ? (
        <section className="panel promise-section">
          <div className="promise-section-header"><h2>سجل الأحداث</h2><span>{details.events.length}</span></div>
          <ol className="promise-timeline">{details.events.map((event) => <li key={event.id}><p><strong>{promiseEventLabel(event.eventType)}</strong> — {event.actorName}</p><p>{formatDateTime(event.occurredAt)}</p>{event.reason ? <p>السبب: {event.reason}</p> : null}<small>Request ID: {event.requestId}</small></li>)}</ol>
        </section>
      ) : null}

      <PromiseActionPanel
        promise={details.promise}
        allocations={details.allocations}
        collections={collections}
        representatives={formOptions?.representatives ?? []}
        actions={actions}
      />
    </main>
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return "غير محدد";
  return new Intl.DateTimeFormat("ar-YE", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Aden" }).format(new Date(value));
}
