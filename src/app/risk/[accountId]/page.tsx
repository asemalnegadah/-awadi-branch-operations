import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/current-session";
import { getDatabaseClient } from "@/lib/db/client";
import {
  availableCreditRiskActions,
  creditDecisionStateLabel,
  creditDecisionTypeLabel,
  creditRestrictionReasonLabel,
  creditRiskActionLabel,
  creditRiskLevelLabel,
  formatCreditMoney,
} from "@/lib/risk/presentation";
import { getCreditRiskAccountDetails } from "@/lib/risk/service";
import { parseRiskId } from "@/lib/risk/validation";

import { RiskActionPanel } from "./risk-action-panel";

export const metadata: Metadata = { title: "تفاصيل المخاطر الائتمانية" };
export const dynamic = "force-dynamic";
type RouteContext = { readonly params: Promise<{ readonly accountId: string }> };

export default async function CreditRiskDetailsPage({ params }: RouteContext) {
  const session = await requireCurrentSession();
  if (session.user.mustChangePassword) redirect("/settings/security");
  requirePermission(session.user, "risk.read");
  const { accountId } = await params;
  const details = await getCreditRiskAccountDetails(
    getDatabaseClient(),
    parseRiskId(accountId),
    { actor: session.user },
  );

  const restriction = details.restrictions.find((item) =>
    ["DRAFT", "PENDING_APPROVAL", "ACTIVE"].includes(item.state),
  ) ?? null;
  const exception = details.exceptions.find((item) =>
    ["DRAFT", "PENDING_APPROVAL", "ACTIVE"].includes(item.state)
    && (!restriction || item.restrictionId === restriction.id),
  ) ?? null;
  const actions = availableCreditRiskActions(session.user, restriction, exception);

  return (
    <main className="shell promises-shell">
      <header className="promises-header">
        <div>
          <p className="eyebrow dark-eyebrow">ملف خطر مستقل لكل حساب وعملة</p>
          <h1>{details.customerName}</h1>
          <p className="dashboard-welcome">
            {details.customerNumber ?? "بلا رقم"} — <strong>{details.currencyCode}</strong> — الحساب {details.accountStatus}
          </p>
        </div>
        <div className="promises-actions">
          <Link className="secondary-button button-link" href="/risk">قائمة المخاطر</Link>
          <Link className="secondary-button button-link" href="/promises">وعود السداد</Link>
        </div>
      </header>

      <section className="grid promises-summary">
        <article className="card">
          <span className="card-label">درجة الخطر</span>
          <strong>{details.assessment?.score ?? "—"}</strong>
          <small>{details.assessment ? creditRiskLevelLabel(details.assessment.riskLevel) : "لم يحسب بعد"}</small>
        </article>
        <article className="card">
          <span className="card-label">التوصية</span>
          <strong>{details.assessment ? creditRiskActionLabel(details.assessment.recommendedAction) : "—"}</strong>
          <small>التوصية لا تعتمد قرارًا تلقائيًا.</small>
        </article>
        <article className="card">
          <span className="card-label">الرصيد القائم – {details.currencyCode}</span>
          <strong>{formatCreditMoney(Number(details.assessment?.sourceSnapshot.totalOutstandingMinor ?? 0), details.currencyCode)}</strong>
          <small>الحد: {details.creditLimitMinor === null ? "غير محدد" : formatCreditMoney(details.creditLimitMinor, details.currencyCode)}</small>
        </article>
        <article className="card">
          <span className="card-label">جودة البيانات</span>
          <strong>{details.assessment?.dataQualityScore ?? "—"}</strong>
          <small>{details.assessment?.missingInputs.length ? `ناقص: ${details.assessment.missingInputs.join("، ")}` : "المدخلات المتاحة مكتملة"}</small>
        </article>
      </section>

      {details.assessment ? (
        <section className="panel promise-section">
          <h2>عوامل التقييم</h2>
          {details.assessment.factors.length === 0 ? <p>لا توجد عوامل خطر مسجلة في التقييم الحالي.</p> : (
            <div className="promise-table-wrap">
              <table className="promise-table">
                <thead><tr><th>العامل</th><th>النقاط</th><th>القيمة المرصودة</th><th>التفسير</th></tr></thead>
                <tbody>{details.assessment.factors.map((factor) => (
                  <tr key={factor.code}><td>{factor.code}</td><td>{factor.points}/{factor.maxPoints}</td><td>{String(factor.observedValue ?? "—")}</td><td>{factor.explanationAr}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <p><small>إصدار القواعد: {details.assessment.rulesetVersion} — قطع البيانات: {details.assessment.cutoffAt}</small></p>
        </section>
      ) : (
        <section className="promise-empty"><h2>لا يوجد تقييم بعد</h2><p>استخدم إعادة الحساب لإنشاء أول Snapshot من بيانات الخادم.</p></section>
      )}

      <section className="grid">
        <article className="panel promise-section">
          <h2>قرار الآجل الحالي</h2>
          {restriction ? (
            <dl className="promise-details-grid">
              <div><dt>الحالة</dt><dd>{creditDecisionStateLabel(restriction.state)}</dd></div>
              <div><dt>النوع</dt><dd>{creditDecisionTypeLabel(restriction.decisionType)}</dd></div>
              <div><dt>السبب</dt><dd>{creditRestrictionReasonLabel(restriction.reasonCode)}</dd></div>
              <div><dt>التفصيل</dt><dd>{restriction.reasonText}</dd></div>
              <div><dt>الحد</dt><dd>{restriction.limitAmountMinor === null ? "لا ينطبق" : formatCreditMoney(restriction.limitAmountMinor, restriction.currencyCode)}</dd></div>
              <div><dt>شروط الإعادة</dt><dd>{restriction.restorationConditions}</dd></div>
            </dl>
          ) : <p>لا يوجد قرار ائتماني مفتوح أو نافذ.</p>}
        </article>
        <article className="panel promise-section">
          <h2>الاستثناء الحالي</h2>
          {exception ? (
            <dl className="promise-details-grid">
              <div><dt>الحالة</dt><dd>{creditDecisionStateLabel(exception.state)}</dd></div>
              <div><dt>النطاق</dt><dd>{exception.scope === "SINGLE_TRANSACTION" ? "عملية واحدة" : "عدة عمليات"}</dd></div>
              <div><dt>الحد</dt><dd>{formatCreditMoney(exception.maxAmountMinor, exception.currencyCode)}</dd></div>
              <div><dt>الصلاحية</dt><dd>{exception.validFrom} — {exception.validUntil}</dd></div>
              <div><dt>السبب</dt><dd>{exception.reason}</dd></div>
              <div><dt>الشروط</dt><dd>{exception.conditions}</dd></div>
            </dl>
          ) : <p>لا يوجد استثناء مفتوح أو نافذ.</p>}
        </article>
      </section>

      <RiskActionPanel
        customerAccountId={details.customerAccountId}
        currencyCode={details.currencyCode}
        assessmentId={details.assessment?.id ?? null}
        restriction={restriction}
        exception={exception}
        actions={actions}
      />

      {session.user.permissions.has("risk.view_history") ? (
        <>
          <section className="panel promise-section">
            <h2>تاريخ التقييمات</h2>
            {details.assessmentHistory.length === 0 ? <p>لا يوجد تاريخ تقييمات.</p> : (
              <div className="promise-table-wrap"><table className="promise-table"><thead><tr><th>وقت القطع</th><th>الدرجة</th><th>المستوى</th><th>التوصية</th><th>جودة البيانات</th><th>نفذه</th></tr></thead><tbody>{details.assessmentHistory.map((assessment) => <tr key={assessment.id}><td>{assessment.cutoffAt}</td><td>{assessment.score}</td><td>{creditRiskLevelLabel(assessment.riskLevel)}</td><td>{creditRiskActionLabel(assessment.recommendedAction)}</td><td>{assessment.dataQualityScore}</td><td>{assessment.assessedByName}</td></tr>)}</tbody></table></div>
            )}
          </section>
          <section className="panel promise-section">
            <h2>تاريخ قرارات المنع والاستثناءات</h2>
            {[...details.restrictionEvents, ...details.exceptionEvents].length === 0 ? <p>لا توجد أحداث.</p> : (
              <div className="promise-table-wrap"><table className="promise-table"><thead><tr><th>الوقت</th><th>الحدث</th><th>المنفذ</th><th>السبب</th></tr></thead><tbody>{[...details.restrictionEvents, ...details.exceptionEvents].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map((event) => <tr key={event.id}><td>{event.occurredAt}</td><td>{event.eventType}</td><td>{event.actorName}</td><td>{event.reason ?? "—"}</td></tr>)}</tbody></table></div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
