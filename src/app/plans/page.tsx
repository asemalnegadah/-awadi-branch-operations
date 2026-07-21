import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/current-session";
import { getDatabaseClient } from "@/lib/db/client";
import { getDailyPlanFormOptionsPostgres } from "@/lib/plans/options";
import {
  dailyPlanStateLabel,
  formatDailyPlanMoney,
} from "@/lib/plans/presentation";
import { listDailyPlans } from "@/lib/plans/service";
import { parseDailyPlanListFilters } from "@/lib/plans/validation";

import { GeneratePlanForm } from "./generate-plan-form";

export const metadata: Metadata = { title: "الخطط اليومية" };
export const dynamic = "force-dynamic";
type SearchValue = string | string[] | undefined;

export default async function DailyPlansPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, SearchValue>> }>) {
  const session = await requireCurrentSession();
  if (session.user.mustChangePassword) redirect("/settings/security");
  requirePermission(session.user, "plans.read_own");

  const params = toUrlSearchParams(await searchParams);
  const context = { actor: session.user } as const;
  const canGenerate = session.user.permissions.has("plans.generate");
  const [page, options] = await Promise.all([
    listDailyPlans(
      getDatabaseClient(),
      parseDailyPlanListFilters(params),
      context,
    ),
    canGenerate
      ? getDailyPlanFormOptionsPostgres(getDatabaseClient())
      : Promise.resolve(Object.freeze({ representatives: Object.freeze([]), routes: Object.freeze([]) })),
  ]);
  const today = adenDate(new Date());

  return (
    <main className="shell promises-shell">
      <header className="promises-header">
        <div>
          <p className="eyebrow dark-eyebrow">مجموعة العوادي التجارية – فرع عدن</p>
          <h1>الخطط اليومية</h1>
          <p className="dashboard-welcome">
            ترتيب حتمي قابل للتفسير للعملاء والمهام، مع أهداف SR وRG منفصلة واعتماد موثق.
          </p>
        </div>
        <div className="promises-actions">
          <Link className="secondary-button button-link" href="/dashboard">لوحة الفرع</Link>
          <Link className="secondary-button button-link" href="/risk">المخاطر</Link>
          <Link className="secondary-button button-link" href="/promises">الوعود</Link>
        </div>
      </header>

      {canGenerate ? (
        <GeneratePlanForm representatives={options.representatives} today={today} />
      ) : null}

      <section className="grid promises-summary" aria-label="ملخص الخطط الظاهرة">
        <article className="card">
          <span className="card-label">عدد الخطط</span>
          <strong>{page.items.length}</strong>
          <small>ضمن الصفحة والفلاتر الحالية.</small>
        </article>
        <article className="card">
          <span className="card-label">هدف التحصيل SR</span>
          <strong>{formatDailyPlanMoney(page.items.reduce((sum, plan) => sum + plan.targetCollectionSrMinor, 0), "SR")}</strong>
          <small>مستقل عن RG.</small>
        </article>
        <article className="card">
          <span className="card-label">هدف التحصيل RG</span>
          <strong>{formatDailyPlanMoney(page.items.reduce((sum, plan) => sum + plan.targetCollectionRgMinor, 0), "RG")}</strong>
          <small>مستقل عن SR.</small>
        </article>
        <article className="card">
          <span className="card-label">قيد التنفيذ</span>
          <strong>{page.items.filter((plan) => plan.state === "IN_PROGRESS").length}</strong>
          <small>الخطط التي بدأها المندوب.</small>
        </article>
      </section>

      <form className="promise-filters" method="get" aria-label="فلاتر الخطط">
        {session.user.permissions.has("plans.read_all") ? (
          <div className="promise-field">
            <label htmlFor="representativeId">المندوب</label>
            <select id="representativeId" name="representativeId" defaultValue={params.get("representativeId") ?? ""}>
              <option value="">الكل</option>
              {options.representatives.map((representative) => (
                <option key={representative.id} value={representative.id}>{representative.name}</option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="promise-field">
          <label htmlFor="planDateFrom">من تاريخ</label>
          <input id="planDateFrom" name="planDateFrom" type="date" defaultValue={params.get("planDateFrom") ?? ""} />
        </div>
        <div className="promise-field">
          <label htmlFor="planDateTo">إلى تاريخ</label>
          <input id="planDateTo" name="planDateTo" type="date" defaultValue={params.get("planDateTo") ?? ""} />
        </div>
        <div className="promise-field">
          <label htmlFor="state">الحالة</label>
          <select id="state" name="state" defaultValue={params.get("state") ?? ""}>
            <option value="">الكل</option>
            <option value="DRAFT">مسودة</option><option value="PENDING_APPROVAL">بانتظار الاعتماد</option>
            <option value="APPROVED">معتمدة</option><option value="REJECTED">مرفوضة</option>
            <option value="IN_PROGRESS">قيد التنفيذ</option><option value="COMPLETED">مكتملة</option>
            <option value="CANCELLED">ملغاة</option>
          </select>
        </div>
        <div className="filter-actions">
          <button className="primary-button" type="submit">تطبيق</button>
          <Link className="secondary-button button-link" href="/plans">مسح</Link>
        </div>
      </form>

      {page.items.length === 0 ? (
        <section className="promise-empty">
          <h2>لا توجد خطط مطابقة</h2>
          <p>غيّر الفلاتر أو ولّد خطة جديدة بحسب صلاحيتك.</p>
        </section>
      ) : (
        <div className="promise-table-wrap">
          <table className="promise-table">
            <thead><tr><th>التاريخ</th><th>المندوب</th><th>الحالة</th><th>تحصيل SR</th><th>تحصيل RG</th><th>بيع SR</th><th>بيع RG</th><th>الوقت</th></tr></thead>
            <tbody>
              {page.items.map((plan) => (
                <tr key={plan.id}>
                  <td><Link className="promise-link" href={`/plans/${plan.id}`}>{plan.planDate}</Link><br /><small>{plan.rulesetVersion}</small></td>
                  <td>{plan.representativeName}</td>
                  <td><span className={`status-pill ${plan.state === "COMPLETED" ? "fulfilled" : plan.state === "REJECTED" || plan.state === "CANCELLED" ? "overdue" : ""}`}>{dailyPlanStateLabel(plan.state)}</span></td>
                  <td>{formatDailyPlanMoney(plan.targetCollectionSrMinor, "SR")}</td>
                  <td>{formatDailyPlanMoney(plan.targetCollectionRgMinor, "RG")}</td>
                  <td>{formatDailyPlanMoney(plan.targetSalesSrMinor, "SR")}</td>
                  <td>{formatDailyPlanMoney(plan.targetSalesRgMinor, "RG")}</td>
                  <td>{plan.estimatedWorkMinutes} دقيقة</td>
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
  return `/plans?${next.toString()}`;
}

function adenDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Aden",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
