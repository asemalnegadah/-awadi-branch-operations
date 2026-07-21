import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/current-session";
import { getDatabaseClient } from "@/lib/db/client";
import {
  creditDecisionStateLabel,
  creditDecisionTypeLabel,
  creditRiskActionLabel,
  creditRiskLevelLabel,
  formatCreditMoney,
} from "@/lib/risk/presentation";
import { listCreditRiskAccounts } from "@/lib/risk/service";
import { parseCreditRiskListFilters } from "@/lib/risk/validation";

export const metadata: Metadata = { title: "المخاطر والمنع الائتماني" };
export const dynamic = "force-dynamic";

type SearchValue = string | string[] | undefined;

export default async function CreditRiskPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, SearchValue>> }>) {
  const session = await requireCurrentSession();
  if (session.user.mustChangePassword) redirect("/settings/security");
  requirePermission(session.user, "risk.read");

  const params = toUrlSearchParams(await searchParams);
  const page = await listCreditRiskAccounts(
    getDatabaseClient(),
    parseCreditRiskListFilters(params),
    { actor: session.user },
  );

  return (
    <main className="shell promises-shell">
      <header className="promises-header">
        <div>
          <p className="eyebrow dark-eyebrow">مجموعة العوادي التجارية – فرع عدن</p>
          <h1>المخاطر والمنع الائتماني</h1>
          <p className="dashboard-welcome">
            تقييم حتمي قابل للتفسير لكل حساب وعملة، مع قرارات مدير واستثناءات موثقة.
          </p>
        </div>
        <div className="promises-actions">
          <Link className="secondary-button button-link" href="/dashboard">لوحة الفرع</Link>
          <Link className="secondary-button button-link" href="/promises">وعود السداد</Link>
        </div>
      </header>

      <section className="grid promises-summary" aria-label="ملخص المخاطر الظاهر">
        {(["SR", "RG"] as const).flatMap((currency) => {
          const accounts = page.items.filter((item) => item.currencyCode === currency);
          const critical = accounts.filter((item) => item.assessment?.riskLevel === "CRITICAL").length;
          const blocked = accounts.filter((item) => item.activeRestriction !== null).length;
          return [
            <article className="card" key={`${currency}-critical`}>
              <span className="card-label">خطر حرج – {currency}</span>
              <strong>{critical}</strong>
              <small>ضمن الصفحة الحالية، دون جمع العملات.</small>
            </article>,
            <article className="card" key={`${currency}-blocked`}>
              <span className="card-label">قرارات نافذة – {currency}</span>
              <strong>{blocked}</strong>
              <small>منع أو تعليق أو تحديد ائتماني.</small>
            </article>,
          ];
        })}
      </section>

      <form className="promise-filters" method="get" aria-label="فلاتر المخاطر">
        <div className="promise-field">
          <label htmlFor="q">بحث</label>
          <input id="q" name="q" defaultValue={params.get("q") ?? ""} placeholder="العميل أو رقمه" />
        </div>
        <div className="promise-field">
          <label htmlFor="currency">العملة</label>
          <select id="currency" name="currency" defaultValue={params.get("currency") ?? ""}>
            <option value="">الكل</option><option value="SR">SR</option><option value="RG">RG</option>
          </select>
        </div>
        <div className="promise-field">
          <label htmlFor="riskLevel">مستوى الخطر</label>
          <select id="riskLevel" name="riskLevel" defaultValue={params.get("riskLevel") ?? ""}>
            <option value="">الكل</option>
            <option value="LOW">منخفض</option><option value="MEDIUM">متوسط</option>
            <option value="HIGH">مرتفع</option><option value="CRITICAL">حرج</option>
          </select>
        </div>
        <div className="promise-field">
          <label htmlFor="decisionState">حالة القرار</label>
          <select id="decisionState" name="decisionState" defaultValue={params.get("decisionState") ?? ""}>
            <option value="">الكل</option><option value="DRAFT">مسودة</option>
            <option value="PENDING_APPROVAL">بانتظار الاعتماد</option><option value="ACTIVE">نافذ</option>
            <option value="REJECTED">مرفوض</option><option value="REVOKED">ملغي</option>
            <option value="EXPIRED">منتهي</option>
          </select>
        </div>
        <div className="filter-actions">
          <button className="primary-button" type="submit">تطبيق</button>
          <Link className="secondary-button button-link" href="/risk">مسح</Link>
        </div>
      </form>

      {page.items.length === 0 ? (
        <section className="promise-empty">
          <h2>لا توجد حسابات مطابقة</h2>
          <p>غيّر الفلاتر أو ابدأ حساب التقييم من صفحة الحساب.</p>
        </section>
      ) : (
        <div className="promise-table-wrap">
          <table className="promise-table">
            <thead>
              <tr><th>العميل</th><th>العملة</th><th>الرصيد/الحد</th><th>الدرجة</th><th>التوصية</th><th>قرار الآجل</th><th>الاستثناء</th></tr>
            </thead>
            <tbody>
              {page.items.map((item) => (
                <tr key={item.customerAccountId}>
                  <td>
                    <Link className="promise-link" href={`/risk/${item.customerAccountId}`}>
                      {item.customerName}
                    </Link><br /><small>{item.customerNumber ?? "بلا رقم"}</small>
                  </td>
                  <td><strong>{item.currencyCode}</strong><br /><small>{item.accountStatus}</small></td>
                  <td>
                    {item.assessment
                      ? formatCreditMoney(
                          Number(item.assessment.sourceSnapshot.totalOutstandingMinor ?? 0),
                          item.currencyCode,
                        )
                      : "لم يحسب"}
                    <br /><small>الحد: {item.creditLimitMinor === null ? "غير محدد" : formatCreditMoney(item.creditLimitMinor, item.currencyCode)}</small>
                  </td>
                  <td>
                    {item.assessment ? <><strong>{item.assessment.score}</strong><br /><span className={`status-pill ${item.assessment.riskLevel === "CRITICAL" ? "overdue" : ""}`}>{creditRiskLevelLabel(item.assessment.riskLevel)}</span></> : "—"}
                  </td>
                  <td>{item.assessment ? creditRiskActionLabel(item.assessment.recommendedAction) : "—"}</td>
                  <td>
                    {item.activeRestriction
                      ? <><strong>{creditDecisionTypeLabel(item.activeRestriction.decisionType)}</strong><br /><span className="status-pill overdue">{creditDecisionStateLabel(item.activeRestriction.state)}</span></>
                      : "مسموح"}
                  </td>
                  <td>{item.activeException ? `${formatCreditMoney(item.activeException.maxAmountMinor, item.currencyCode)} حتى ${item.activeException.validUntil.slice(0, 10)}` : "لا يوجد"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {page.nextCursor ? (
        <nav className="promise-pagination">
          <Link className="secondary-button button-link" href={nextPageHref(params, page.nextCursor) as Route}>الصفحة التالية</Link>
        </nav>
      ) : null}
    </main>
  );
}

function toUrlSearchParams(raw: Record<string, SearchValue>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value)) for (const item of value) params.append(key, item);
  }
  return params;
}

function nextPageHref(params: URLSearchParams, cursor: string): string {
  const next = new URLSearchParams(params);
  next.set("cursor", cursor);
  return `/risk?${next.toString()}`;
}
