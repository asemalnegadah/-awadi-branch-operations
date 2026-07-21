import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/current-session";
import { getDatabaseClient } from "@/lib/db/client";
import { getDailyPlanFormOptionsPostgres } from "@/lib/plans/options";
import {
  availableDailyPlanActions,
  dailyPlanPriorityLabel,
  dailyPlanStateLabel,
  dailyPlanTaskLabel,
  formatDailyPlanMoney,
} from "@/lib/plans/presentation";
import { getDailyPlanDetails } from "@/lib/plans/service";
import { parseDailyPlanId } from "@/lib/plans/validation";

import { PlanActionPanel } from "./plan-action-panel";

export const metadata: Metadata = { title: "تفاصيل الخطة اليومية" };
export const dynamic = "force-dynamic";
type RouteContext = { readonly params: Promise<{ readonly id: string }> };

export default async function DailyPlanDetailsPage({ params }: RouteContext) {
  const session = await requireCurrentSession();
  if (session.user.mustChangePassword) redirect("/settings/security");
  requirePermission(session.user, "plans.read_own");
  const { id } = await params;
  const context = { actor: session.user } as const;
  const details = await getDailyPlanDetails(
    getDatabaseClient(),
    parseDailyPlanId(id),
    context,
  );
  const actions = availableDailyPlanActions(session.user, details.plan);
  const options = actions.manageItems
    ? await getDailyPlanFormOptionsPostgres(getDatabaseClient())
    : Object.freeze({ representatives: Object.freeze([]), routes: Object.freeze([]) });

  return (
    <main className="shell promises-shell">
      <header className="promises-header">
        <div>
          <p className="eyebrow dark-eyebrow">خطة مندوب — فرع عدن</p>
          <h1>{details.plan.representativeName}</h1>
          <p className="dashboard-welcome">
            {details.plan.planDate} — <span className={`status-pill ${details.plan.state === "COMPLETED" ? "fulfilled" : details.plan.state === "REJECTED" || details.plan.state === "CANCELLED" ? "overdue" : ""}`}>{dailyPlanStateLabel(details.plan.state)}</span>
          </p>
        </div>
        <div className="promises-actions">
          <Link className="secondary-button button-link" href="/plans">قائمة الخطط</Link>
          <Link className="secondary-button button-link" href="/dashboard">لوحة الفرع</Link>
        </div>
      </header>

      <section className="grid promises-summary">
        <article className="card"><span className="card-label">تحصيل SR</span><strong>{formatDailyPlanMoney(details.plan.targetCollectionSrMinor, "SR")}</strong><small>مستقل عن RG.</small></article>
        <article className="card"><span className="card-label">تحصيل RG</span><strong>{formatDailyPlanMoney(details.plan.targetCollectionRgMinor, "RG")}</strong><small>مستقل عن SR.</small></article>
        <article className="card"><span className="card-label">بيع SR</span><strong>{formatDailyPlanMoney(details.plan.targetSalesSrMinor, "SR")}</strong><small>مستقل عن RG.</small></article>
        <article className="card"><span className="card-label">بيع RG</span><strong>{formatDailyPlanMoney(details.plan.targetSalesRgMinor, "RG")}</strong><small>مستقل عن SR.</small></article>
        <article className="card"><span className="card-label">وقت العمل</span><strong>{details.plan.estimatedWorkMinutes}</strong><small>دقيقة زيارة وتنقل.</small></article>
        <article className="card"><span className="card-label">وقت قطع البيانات</span><strong>{details.plan.cutoffAt}</strong><small>{details.plan.rulesetVersion}</small></article>
      </section>

      <section className="panel promise-section">
        <h2>عناصر الخطة المرتبة</h2>
        {details.items.length === 0 ? <p>لا توجد عناصر.</p> : (
          <div className="promise-table-wrap">
            <table className="promise-table">
              <thead><tr><th>#</th><th>العميل</th><th>المهمة</th><th>الأولوية</th><th>السبب والهدف</th><th>تحصيل SR/RG</th><th>بيع SR/RG</th><th>المسار والوقت</th></tr></thead>
              <tbody>{details.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.sequenceNumber}</td>
                  <td>{item.customerName}<br /><small>{item.customerNumber ?? "بلا رقم"}{item.linkedPromiseId ? ` — وعد ${item.linkedPromiseId}` : ""}</small></td>
                  <td>{dailyPlanTaskLabel(item.taskType)}</td>
                  <td><span className={`status-pill ${item.priorityLevel === "CRITICAL" ? "overdue" : ""}`}>{dailyPlanPriorityLabel(item.priorityLevel)} — {item.priorityScore}</span></td>
                  <td><strong>{item.selectionReason}</strong><br />{item.objective}<br /><small>المتوقع: {item.expectedResult}</small></td>
                  <td>{formatDailyPlanMoney(item.targetCollectionSrMinor, "SR")}<br />{formatDailyPlanMoney(item.targetCollectionRgMinor, "RG")}</td>
                  <td>{formatDailyPlanMoney(item.targetSalesSrMinor, "SR")}<br />{formatDailyPlanMoney(item.targetSalesRgMinor, "RG")}</td>
                  <td>{item.areaName ?? "بلا منطقة"} — {item.routeName ?? "بلا مسار"}<br /><small>{item.estimatedTravelMinutes} تنقل + {item.estimatedVisitMinutes} زيارة{item.manualOverride ? " — معدل يدويًا" : ""}</small></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <PlanActionPanel plan={details.plan} items={details.items} routes={options.routes} actions={actions} />

      {session.user.permissions.has("plans.view_history") ? (
        <>
          <section className="panel promise-section">
            <h2>المرشحون المختارون والمستبعدون</h2>
            {details.candidates.length === 0 ? <p>لا يوجد Snapshot مرشحين.</p> : (
              <div className="promise-table-wrap"><table className="promise-table"><thead><tr><th>العميل</th><th>الدرجة</th><th>القرار</th><th>السبب</th><th>المسار</th></tr></thead><tbody>{details.candidates.map((candidate) => <tr key={candidate.id}><td>{candidate.customerName}<br /><small>{candidate.customerNumber ?? "بلا رقم"}</small></td><td>{candidate.computedScore}</td><td>{candidate.selected ? `مختار #${candidate.selectionRank}` : "مستبعد"}</td><td>{candidate.exclusionReason ?? candidate.decisionReason}</td><td>{candidate.areaName ?? "—"} — {candidate.routeName ?? "—"}</td></tr>)}</tbody></table></div>
            )}
          </section>
          <section className="panel promise-section">
            <h2>سجل الخطة</h2>
            {details.events.length === 0 ? <p>لا توجد أحداث.</p> : (
              <div className="promise-table-wrap"><table className="promise-table"><thead><tr><th>الوقت</th><th>الحدث</th><th>المنفذ</th><th>السبب</th></tr></thead><tbody>{details.events.map((event) => <tr key={event.id}><td>{event.occurredAt}</td><td>{event.eventType}</td><td>{event.actorName}</td><td>{event.reason ?? "—"}</td></tr>)}</tbody></table></div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
