import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/current-session";
import { getDatabaseClient } from "@/lib/db/client";
import {
  formatPromiseMoney,
  promiseStatusLabel,
  promiseTemporalLabel,
} from "@/lib/promises/presentation";
import { getPromiseDashboardSummary, listPromises } from "@/lib/promises/service";
import { parsePromiseListFilters } from "@/lib/promises/validation";

export const metadata: Metadata = { title: "وعود السداد" };
export const dynamic = "force-dynamic";

type SearchValue = string | string[] | undefined;

export default async function PromisesPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, SearchValue>> }>) {
  const session = await requireCurrentSession();
  if (session.user.mustChangePassword) redirect("/settings/security");
  requirePermission(session.user, "promises.read");

  const raw = await searchParams;
  const params = toUrlSearchParams(raw);
  const filters = parsePromiseListFilters(params);
  const context = { actor: session.user } as const;
  const [page, summary] = await Promise.all([
    listPromises(getDatabaseClient(), filters, context),
    getPromiseDashboardSummary(getDatabaseClient(), context),
  ]);
  const canCreate = session.user.permissions.has("promises.create");

  return (
    <main className="shell promises-shell">
      <header className="promises-header">
        <div>
          <p className="eyebrow dark-eyebrow">مجموعة العوادي التجارية – فرع عدن</p>
          <h1>وعود السداد</h1>
          <p className="dashboard-welcome">
            متابعة الوعود والتحصيلات المؤكدة مع فصل SR وRG وسجل أحداث غير قابل للتعديل.
          </p>
        </div>
        <div className="promises-actions">
          <Link className="secondary-button button-link" href="/dashboard">لوحة الفرع</Link>
          {canCreate ? (
            <Link className="primary-button button-link" href="/promises/new">إنشاء وعد</Link>
          ) : null}
        </div>
      </header>

      <section className="grid promises-summary" aria-label="ملخص وعود السداد">
        {summary.length === 0 ? (
          <article className="card"><span className="card-label">الحالة</span><strong>لا توجد وعود</strong><small>لم تُسجل بيانات بعد.</small></article>
        ) : summary.flatMap((currency) => [
          <article className="card" key={`${currency.currencyCode}-due`}>
            <span className="card-label">مستحق اليوم – {currency.currencyCode}</span>
            <strong>{currency.dueTodayCount}</strong>
            <small>{formatPromiseMoney(currency.remainingAmountMinor, currency.currencyCode)} متبقٍ إجمالًا</small>
          </article>,
          <article className="card" key={`${currency.currencyCode}-overdue`}>
            <span className="card-label">متأخر – {currency.currencyCode}</span>
            <strong>{currency.overdueCount}</strong>
            <small>العملة معروضة مستقلة</small>
          </article>,
          <article className="card" key={`${currency.currencyCode}-partial`}>
            <span className="card-label">منفذ جزئيًا – {currency.currencyCode}</span>
            <strong>{currency.partiallyFulfilledCount}</strong>
            <small>{formatPromiseMoney(currency.fulfilledAmountMinor, currency.currencyCode)} منفذ</small>
          </article>,
          <article className="card" key={`${currency.currencyCode}-fulfilled`}>
            <span className="card-label">منفذ – {currency.currencyCode}</span>
            <strong>{currency.fulfilledCount}</strong>
            <small>{currency.promiseCount} وعدًا في هذه العملة</small>
          </article>,
        ])}
      </section>

      <form className="promise-filters" method="get" aria-label="فلاتر الوعود">
        <div className="promise-field">
          <label htmlFor="q">بحث</label>
          <input id="q" name="q" defaultValue={params.get("q") ?? ""} placeholder="العميل أو سبب الدين" />
        </div>
        <div className="promise-field">
          <label htmlFor="currency">العملة</label>
          <select id="currency" name="currency" defaultValue={params.get("currency") ?? ""}>
            <option value="">الكل</option><option value="SR">SR</option><option value="RG">RG</option>
          </select>
        </div>
        <div className="promise-field">
          <label htmlFor="status">الحالة</label>
          <select id="status" name="status" defaultValue={params.get("status") ?? ""}>
            <option value="">الكل</option>
            <option value="NEW">جديد</option><option value="UPCOMING">قادم</option>
            <option value="PARTIALLY_FULFILLED">منفذ جزئيًا</option><option value="FULFILLED">منفذ</option>
            <option value="REJECTED">مرفوض</option><option value="CANCELLED">ملغي</option>
          </select>
        </div>
        <div className="promise-field">
          <label htmlFor="temporalStatus">الحالة الزمنية</label>
          <select id="temporalStatus" name="temporalStatus" defaultValue={params.get("temporalStatus") ?? ""}>
            <option value="">الكل</option><option value="DUE_TODAY">مستحق اليوم</option><option value="OVERDUE">متأخر</option>
          </select>
        </div>
        <div className="promise-field">
          <label htmlFor="dueDateFrom">الاستحقاق من</label>
          <input id="dueDateFrom" name="dueDateFrom" type="date" defaultValue={params.get("dueDateFrom") ?? ""} />
        </div>
        <div className="promise-field">
          <label htmlFor="dueDateTo">الاستحقاق إلى</label>
          <input id="dueDateTo" name="dueDateTo" type="date" defaultValue={params.get("dueDateTo") ?? ""} />
        </div>
        <div className="promise-field">
          <label htmlFor="escalationLevel">التصعيد</label>
          <select id="escalationLevel" name="escalationLevel" defaultValue={params.get("escalationLevel") ?? ""}>
            <option value="">الكل</option>{[0,1,2,3,4,5].map((level) => <option key={level} value={level}>{level}</option>)}
          </select>
        </div>
        <div className="filter-actions">
          <button className="primary-button" type="submit">تطبيق</button>
          <Link className="secondary-button button-link" href="/promises">مسح</Link>
        </div>
      </form>

      {page.items.length === 0 ? (
        <section className="promise-empty"><h2>لا توجد نتائج</h2><p>عدّل الفلاتر أو أنشئ وعدًا جديدًا بحسب صلاحيتك.</p></section>
      ) : (
        <div className="promise-table-wrap">
          <table className="promise-table">
            <thead><tr><th>العميل</th><th>المندوب</th><th>العملة</th><th>الموعود</th><th>المنفذ</th><th>المتبقي</th><th>الاستحقاق</th><th>الحالة</th></tr></thead>
            <tbody>
              {page.items.map((promise) => {
                const temporal = promiseTemporalLabel(promise);
                return (
                  <tr key={promise.id}>
                    <td><Link className="promise-link" href={`/promises/${promise.id}`}>{promise.customerName}</Link><br /><small>{promise.customerNumber ?? "بلا رقم"}</small></td>
                    <td>{promise.representativeName}</td><td><strong>{promise.currencyCode}</strong></td>
                    <td>{formatPromiseMoney(promise.promisedAmountMinor, promise.currencyCode)}</td>
                    <td>{formatPromiseMoney(promise.fulfilledAmountMinor, promise.currencyCode)}</td>
                    <td>{formatPromiseMoney(promise.remainingAmountMinor, promise.currencyCode)}</td>
                    <td>{promise.dueDate}{temporal ? <><br /><span className={`status-pill ${promise.temporalStatus === "OVERDUE" ? "overdue" : "due"}`}>{temporal}</span></> : null}</td>
                    <td><span className={`status-pill ${promise.baseStatus === "FULFILLED" ? "fulfilled" : ""}`}>{promiseStatusLabel(promise.baseStatus)}</span></td>
                  </tr>
                );
              })}
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
  return `/promises?${next.toString()}`;
}
