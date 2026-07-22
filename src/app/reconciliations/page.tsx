import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/current-session";
import { getDatabaseClient } from "@/lib/db/client";
import {
  formatReconciliationMoney,
  reconciliationSourceLabel,
  reconciliationStateLabel,
} from "@/lib/reconciliations/presentation";
import {
  listReconciliationAccountOptions,
  listReconciliations,
} from "@/lib/reconciliations/service";
import { parseReconciliationListFilters } from "@/lib/reconciliations/validation";

import { ReconciliationCreateForm } from "./reconciliation-create-form";

export const metadata: Metadata = { title: "المطابقات والفروقات والتسويات" };
export const dynamic = "force-dynamic";

type SearchValue = string | string[] | undefined;

export default async function ReconciliationsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, SearchValue>> }>) {
  const session = await requireCurrentSession();
  if (session.user.mustChangePassword) redirect("/settings/security");
  requirePermission(session.user, "reconciliations.read");

  const params = toUrlSearchParams(await searchParams);
  const context = { actor: session.user } as const;
  const [page, accounts] = await Promise.all([
    listReconciliations(
      getDatabaseClient(),
      parseReconciliationListFilters(params),
      context,
    ),
    session.user.permissions.has("reconciliations.create")
      ? listReconciliationAccountOptions(getDatabaseClient(), undefined, context)
      : Promise.resolve([]),
  ]);

  return (
    <main className="shell promises-shell">
      <header className="promises-header">
        <div>
          <p className="eyebrow dark-eyebrow">مجموعة العوادي التجارية – فرع عدن</p>
          <h1>المطابقات والفروقات والتسويات</h1>
          <p className="dashboard-welcome">
            مقارنة مصادر مالية موثقة، تصنيف الفروق، ثم اعتماد وتسوية بقيد دفتر واحد غير قابل للحذف.
          </p>
        </div>
        <div className="promises-actions">
          <Link className="secondary-button button-link" href="/dashboard">لوحة الفرع</Link>
          <Link className="secondary-button button-link" href="/risk">المخاطر</Link>
        </div>
      </header>

      <section className="grid promises-summary" aria-label="ملخص المطابقات الظاهرة">
        {(["SR", "RG"] as const).flatMap((currency) => {
          const items = page.items.filter((item) => item.currencyCode === currency);
          const open = items.filter((item) => !["MATCHED", "REJECTED", "SETTLED"].includes(item.state)).length;
          const difference = items.reduce((total, item) => total + item.differenceAmountMinor, 0);
          return [
            <article className="card" key={`${currency}-open`}>
              <span className="card-label">مطابقات مفتوحة – {currency}</span>
              <strong>{open}</strong>
              <small>ضمن الصفحة الحالية فقط.</small>
            </article>,
            <article className="card" key={`${currency}-difference`}>
              <span className="card-label">صافي الفروق – {currency}</span>
              <strong>{formatReconciliationMoney(difference, currency)}</strong>
              <small>لا يجمع مع العملة الأخرى.</small>
            </article>,
          ];
        })}
      </section>

      <form className="promise-filters" method="get" aria-label="فلاتر المطابقات">
        <div className="promise-field">
          <label htmlFor="q">بحث</label>
          <input id="q" name="q" defaultValue={params.get("q") ?? ""} placeholder="العميل أو رقم المصدر" />
        </div>
        <div className="promise-field">
          <label htmlFor="currency">العملة</label>
          <select id="currency" name="currency" defaultValue={params.get("currency") ?? ""}>
            <option value="">الكل</option><option value="SR">SR</option><option value="RG">RG</option>
          </select>
        </div>
        <div className="promise-field">
          <label htmlFor="state">الحالة</label>
          <select id="state" name="state" defaultValue={params.get("state") ?? ""}>
            <option value="">الكل</option>
            <option value="DRAFT">مسودة</option>
            <option value="PENDING_REVIEW">بانتظار المراجعة</option>
            <option value="REVIEWED">تمت المراجعة</option>
            <option value="PENDING_APPROVAL">بانتظار الاعتماد</option>
            <option value="APPROVED">معتمدة</option>
            <option value="RETURNED">معادة</option>
            <option value="REJECTED">مرفوضة</option>
            <option value="MATCHED">مطابقة بلا فرق</option>
            <option value="SETTLED">تمت التسوية</option>
          </select>
        </div>
        <div className="filter-actions">
          <button className="primary-button" type="submit">تطبيق</button>
          <Link className="secondary-button button-link" href="/reconciliations">مسح</Link>
        </div>
      </form>

      {session.user.permissions.has("reconciliations.create") ? (
        <section className="panel">
          <ReconciliationCreateForm accounts={accounts} />
        </section>
      ) : null}

      {page.items.length === 0 ? (
        <section className="promise-empty">
          <h2>لا توجد مطابقات</h2>
          <p>أنشئ مطابقة جديدة أو غيّر الفلاتر.</p>
        </section>
      ) : (
        <div className="promise-table-wrap">
          <table className="promise-table">
            <thead>
              <tr>
                <th>العميل</th><th>المصدر</th><th>تاريخ القطع</th><th>المتوقع</th>
                <th>المرصود</th><th>الفرق</th><th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {page.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link className="promise-link" href={`/reconciliations/${item.id}`}>
                      {item.customerName}
                    </Link><br />
                    <small>{item.customerNumber ?? "بلا رقم"} — {item.currencyCode}</small>
                  </td>
                  <td>{reconciliationSourceLabel(item.sourceKind)}<br /><small>{item.sourceId}</small></td>
                  <td>{item.cutoffDate}</td>
                  <td>{formatReconciliationMoney(item.expectedAmountMinor, item.currencyCode)}</td>
                  <td>{formatReconciliationMoney(item.observedAmountMinor, item.currencyCode)}</td>
                  <td><strong>{formatReconciliationMoney(item.differenceAmountMinor, item.currencyCode)}</strong></td>
                  <td><span className={`status-pill ${item.state === "REJECTED" || item.state === "RETURNED" ? "overdue" : ""}`}>{reconciliationStateLabel(item.state)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {page.nextCursor ? (
        <nav className="promise-pagination">
          <Link className="secondary-button button-link" href={nextPageHref(params, page.nextCursor) as Route}>
            الصفحة التالية
          </Link>
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
  return `/reconciliations?${next.toString()}`;
}
