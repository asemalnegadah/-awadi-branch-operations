import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/current-session";
import { getDatabaseClient } from "@/lib/db/client";
import {
  formatReconciliationMoney,
  reconciliationReasonLabel,
  reconciliationSourceLabel,
  reconciliationStateLabel,
} from "@/lib/reconciliations/presentation";
import { getReconciliationDetails } from "@/lib/reconciliations/service";
import { parseReconciliationId } from "@/lib/reconciliations/validation";

import { ReconciliationActionPanel } from "./reconciliation-action-panel";

export const metadata: Metadata = { title: "تفاصيل المطابقة" };
export const dynamic = "force-dynamic";

type RouteContext = { readonly params: Promise<{ readonly id: string }> };

export default async function ReconciliationDetailsPage({ params }: RouteContext) {
  const session = await requireCurrentSession();
  if (session.user.mustChangePassword) redirect("/settings/security");
  requirePermission(session.user, "reconciliations.read");
  const { id } = await params;
  const reconciliation = await getReconciliationDetails(
    getDatabaseClient(),
    parseReconciliationId(id),
    { actor: session.user },
  );

  return (
    <main className="shell promises-shell">
      <header className="promises-header">
        <div>
          <p className="eyebrow dark-eyebrow">مجموعة العوادي التجارية – فرع عدن</p>
          <h1>تفاصيل المطابقة</h1>
          <p className="dashboard-welcome">
            {reconciliation.customerName} — {reconciliation.customerNumber ?? "بلا رقم"} — {reconciliation.currencyCode}
          </p>
        </div>
        <div className="promises-actions">
          <Link className="secondary-button button-link" href="/reconciliations">قائمة المطابقات</Link>
          <Link className="secondary-button button-link" href="/dashboard">لوحة الفرع</Link>
        </div>
      </header>

      <section className="grid promises-summary" aria-label="ملخص المطابقة">
        <article className="card">
          <span className="card-label">الحالة</span>
          <strong>{reconciliationStateLabel(reconciliation.state)}</strong>
          <small>الإصدار {reconciliation.version}</small>
        </article>
        <article className="card">
          <span className="card-label">المبلغ المتوقع</span>
          <strong>{formatReconciliationMoney(reconciliation.expectedAmountMinor, reconciliation.currencyCode)}</strong>
          <small>{reconciliation.cutoffDate}</small>
        </article>
        <article className="card">
          <span className="card-label">المبلغ المرصود</span>
          <strong>{formatReconciliationMoney(reconciliation.observedAmountMinor, reconciliation.currencyCode)}</strong>
          <small>{reconciliationSourceLabel(reconciliation.sourceKind)}</small>
        </article>
        <article className="card">
          <span className="card-label">الفرق</span>
          <strong>{formatReconciliationMoney(reconciliation.differenceAmountMinor, reconciliation.currencyCode)}</strong>
          <small>لا يدمج مع عملة أخرى</small>
        </article>
      </section>

      <section className="panel">
        <h2>المصدر والتصنيف</h2>
        <dl className="promise-details-grid">
          <div><dt>نوع المصدر</dt><dd>{reconciliation.sourceType}</dd></div>
          <div><dt>معرف المصدر</dt><dd>{reconciliation.sourceId}</dd></div>
          <div><dt>نوع المطابقة</dt><dd>{reconciliationSourceLabel(reconciliation.sourceKind)}</dd></div>
          <div><dt>منشئ المطابقة</dt><dd>{reconciliation.createdByName}</dd></div>
          <div><dt>تصنيف الفرق</dt><dd>{reconciliation.reasonCode ? reconciliationReasonLabel(reconciliation.reasonCode) : "لم يصنف بعد"}</dd></div>
          <div><dt>وصف الفرق</dt><dd>{reconciliation.reasonText ?? "—"}</dd></div>
          <div><dt>قيد التسوية</dt><dd>{reconciliation.settlementLedgerEntryId ?? "لم ينشأ"}</dd></div>
          <div><dt>آخر تحديث</dt><dd>{formatDateTime(reconciliation.updatedAt)}</dd></div>
        </dl>
      </section>

      <ReconciliationActionPanel
        reconciliationId={reconciliation.id}
        state={reconciliation.state}
        version={reconciliation.version}
        permissions={{
          canCreate: session.user.permissions.has("reconciliations.create"),
          canReview: session.user.permissions.has("reconciliations.review"),
          canApprove: session.user.permissions.has("reconciliations.approve"),
          canSettle: session.user.permissions.has("reconciliations.settle"),
        }}
      />

      {session.user.permissions.has("reconciliations.view_history") ? (
        <section className="panel">
          <h2>السجل غير القابل للتعديل</h2>
          {reconciliation.events.length === 0 ? <p>لا توجد أحداث مسجلة.</p> : (
            <ol className="promise-history">
              {reconciliation.events.map((event) => (
                <li key={event.id}>
                  <strong>{reconciliationStateLabel(event.toState)}</strong>
                  <span>{event.actorName} — {formatDateTime(event.occurredAt)}</span>
                  <small>
                    {event.reason ?? "دون ملاحظة"} — {event.operatingMode}
                    {event.selfApproved ? " — اعتماد ذاتي محكوم" : ""}
                  </small>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}
    </main>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ar-YE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Aden",
  }).format(new Date(value));
}
