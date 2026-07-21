import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/current-session";
import { getDatabaseClient } from "@/lib/db/client";
import { FieldVisitNotFoundError } from "@/lib/visits/errors";
import {
  fieldVisitResultLabel,
  fieldVisitStateLabel,
  fieldVisitTypeLabel,
  formatVisitDateTime,
  planItemResultLabel,
} from "@/lib/visits/presentation";
import { getFieldVisitDetails } from "@/lib/visits/service";

import { VisitActionPanel } from "./visit-action-panel";

export const metadata: Metadata = { title: "تفاصيل الزيارة" };
export const dynamic = "force-dynamic";
type PageProps = { readonly params: Promise<{ readonly id: string }> };

export default async function FieldVisitDetailsPage({ params }: PageProps) {
  const session = await requireCurrentSession();
  if (session.user.mustChangePassword) redirect("/settings/security");
  requirePermission(session.user, "visits.read_own");
  const { id } = await params;
  let details;
  try {
    details = await getFieldVisitDetails(
      getDatabaseClient(),
      id,
      { actor: session.user },
    );
  } catch (error) {
    if (error instanceof FieldVisitNotFoundError) notFound();
    throw error;
  }
  const visit = details.visit;

  return (
    <main className="shell promises-shell">
      <header className="promises-header">
        <div>
          <p className="eyebrow dark-eyebrow">مجموعة العوادي التجارية – فرع عدن</p>
          <h1>{visit.customerName}</h1>
          <p className="dashboard-welcome">
            {visit.representativeName} — {fieldVisitTypeLabel(visit.visitType)} — {visit.visitSource === "PLAN" ? "مرتبطة بالخطة" : "خارج الخطة"}
          </p>
        </div>
        <div className="promises-actions">
          <Link className="secondary-button button-link" href="/visits">كل الزيارات</Link>
          {visit.planId ? <Link className="secondary-button button-link" href={`/plans/${visit.planId}`}>الخطة المرتبطة</Link> : null}
        </div>
      </header>

      <section className="grid promises-summary">
        <article className="card"><span className="card-label">الحالة</span><strong>{fieldVisitStateLabel(visit.state)}</strong><small>الإصدار {visit.version}</small></article>
        <article className="card"><span className="card-label">النتيجة</span><strong>{fieldVisitResultLabel(visit.declaredResult)}</strong><small>{visit.outcomeSummary ?? "لم تسجل الخلاصة"}</small></article>
        <article className="card"><span className="card-label">الوصول</span><strong>{formatVisitDateTime(visit.arrivedAt)}</strong><small>المغادرة: {formatVisitDateTime(visit.departedAt)}</small></article>
        <article className="card"><span className="card-label">التوثيق</span><strong>{visit.outcomeCount} نتائج</strong><small>{visit.evidenceCount} أدلة</small></article>
      </section>

      <section className="panel">
        <h2>هدف الزيارة ونطاقها</h2>
        <p>{visit.objective}</p>
        {visit.outOfPlanReason ? <p><strong>سبب الخروج عن الخطة:</strong> {visit.outOfPlanReason}</p> : null}
        <dl className="promise-detail-grid">
          <div><dt>رقم العميل</dt><dd>{visit.customerNumber ?? "—"}</dd></div>
          <div><dt>أنشأها</dt><dd>{visit.createdByName}</dd></div>
          <div><dt>وقت الإنشاء</dt><dd>{formatVisitDateTime(visit.createdAt)}</dd></div>
          <div><dt>حالة المزامنة</dt><dd>{visit.syncStatus}</dd></div>
          <div><dt>إحداثيات الوصول</dt><dd>{visit.checkinLatitude ?? "—"}، {visit.checkinLongitude ?? "—"}</dd></div>
          <div><dt>دقة الوصول</dt><dd>{visit.checkinAccuracyMeters === null ? "—" : `${visit.checkinAccuracyMeters} متر`}</dd></div>
        </dl>
      </section>

      <VisitActionPanel
        details={details}
        canManage={session.user.permissions.has("visits.manage")}
        canVerify={session.user.permissions.has("visits.verify")}
        canExecutePlan={session.user.permissions.has("plans.execute") || session.user.permissions.has("visits.manage")}
      />

      <section className="panel">
        <h2>النتائج المسجلة</h2>
        {details.outcomes.length === 0 ? <p>لا توجد نتيجة مسجلة بعد.</p> : (
          <div className="promise-table-wrap"><table className="promise-table"><thead><tr><th>النوع</th><th>الوصف</th><th>المرجع</th><th>المبلغ</th><th>المسجل</th></tr></thead><tbody>{details.outcomes.map((outcome) => (
            <tr key={outcome.id}><td>{outcome.outcomeType}</td><td>{outcome.summary}</td><td>{outcome.referenceId ?? "—"}</td><td>{outcome.amountMinor === null ? "—" : `${(outcome.amountMinor / 100).toFixed(2)} ${outcome.currencyCode}`}</td><td>{outcome.recordedByName}<br /><small>{formatVisitDateTime(outcome.recordedAt)}</small></td></tr>
          ))}</tbody></table></div>
        )}
      </section>

      <section className="panel">
        <h2>الأدلة</h2>
        {details.evidence.length === 0 ? <p>لا يوجد دليل مرتبط.</p> : <ul className="module-list">{details.evidence.map((evidence) => <li key={evidence.id}><strong>{evidence.evidenceType}</strong> — {evidence.fileName} — {evidence.caption ?? "دون وصف"}</li>)}</ul>}
      </section>

      {details.planItemResult ? (
        <section className="panel"><h2>نتيجة عنصر الخطة</h2><p><strong>{planItemResultLabel(details.planItemResult.resultType)}</strong> — {details.planItemResult.reason}</p><small>سجلها {details.planItemResult.recordedByName} في {formatVisitDateTime(details.planItemResult.recordedAt)}</small></section>
      ) : null}

      {details.events.length > 0 ? (
        <section className="panel"><h2>سجل الزيارة</h2><div className="promise-table-wrap"><table className="promise-table"><thead><tr><th>الحدث</th><th>المستخدم</th><th>الوقت</th><th>السبب</th></tr></thead><tbody>{details.events.map((event) => <tr key={event.id}><td>{event.eventType}</td><td>{event.actorName}</td><td>{formatVisitDateTime(event.occurredAt)}</td><td>{event.reason ?? "—"}</td></tr>)}</tbody></table></div></section>
      ) : null}
    </main>
  );
}
