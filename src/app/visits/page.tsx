import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/current-session";
import { getDatabaseClient } from "@/lib/db/client";
import { getActiveRepresentativeIdByUserPostgres } from "@/lib/promises/postgres-repository";
import { getFieldVisitFormOptionsPostgres } from "@/lib/visits/options";
import {
  fieldVisitResultLabel,
  fieldVisitStateLabel,
  fieldVisitTypeLabel,
  formatVisitDateTime,
} from "@/lib/visits/presentation";
import { listFieldVisits } from "@/lib/visits/service";
import { parseFieldVisitListFilters } from "@/lib/visits/validation";

import { CreateVisitForm } from "./create-visit-form";

export const metadata: Metadata = { title: "الزيارات الميدانية" };
export const dynamic = "force-dynamic";
type SearchValue = string | string[] | undefined;

export default async function FieldVisitsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, SearchValue>> }>) {
  const session = await requireCurrentSession();
  if (session.user.mustChangePassword) redirect("/settings/security");
  requirePermission(session.user, "visits.read_own");

  const sql = getDatabaseClient();
  const params = toUrlSearchParams(await searchParams);
  const context = { actor: session.user } as const;
  const canCreate = session.user.permissions.has("visits.create");
  const representativeScope = session.user.permissions.has("visits.read_all")
    ? undefined
    : await getActiveRepresentativeIdByUserPostgres(sql, session.user.id) ?? undefined;
  const [page, options] = await Promise.all([
    listFieldVisits(sql, parseFieldVisitListFilters(params), context),
    canCreate
      ? getFieldVisitFormOptionsPostgres(sql, representativeScope)
      : Promise.resolve(Object.freeze({ planItems: Object.freeze([]), customers: Object.freeze([]) })),
  ]);

  return (
    <main className="shell promises-shell">
      <header className="promises-header">
        <div>
          <p className="eyebrow dark-eyebrow">مجموعة العوادي التجارية – فرع عدن</p>
          <h1>الزيارات الميدانية</h1>
          <p className="dashboard-welcome">
            تنفيذ عناصر الخطط، توثيق الوصول والنتائج والأدلة، والتحقق الإداري دون حذف التاريخ.
          </p>
        </div>
        <div className="promises-actions">
          <Link className="secondary-button button-link" href="/dashboard">لوحة الفرع</Link>
          <Link className="secondary-button button-link" href="/plans">الخطط اليومية</Link>
        </div>
      </header>

      {canCreate ? <CreateVisitForm planItems={options.planItems} customers={options.customers} /> : null}

      <section className="grid promises-summary" aria-label="ملخص الزيارات الظاهرة">
        <article className="card"><span className="card-label">عدد الزيارات</span><strong>{page.items.length}</strong><small>ضمن الفلاتر الحالية.</small></article>
        <article className="card"><span className="card-label">مرسلة للتحقق</span><strong>{page.items.filter((visit) => visit.state === "SUBMITTED").length}</strong><small>تحتاج قرار المدير.</small></article>
        <article className="card"><span className="card-label">متحقق منها</span><strong>{page.items.filter((visit) => visit.state === "VERIFIED").length}</strong><small>نتائجها مثبتة.</small></article>
        <article className="card"><span className="card-label">خارج الخطة</span><strong>{page.items.filter((visit) => visit.visitSource === "OUT_OF_PLAN").length}</strong><small>تحتاج سببًا وتحقق مدير.</small></article>
      </section>

      <form className="promise-filters" method="get" aria-label="فلاتر الزيارات">
        <div className="promise-field">
          <label htmlFor="state">الحالة</label>
          <select id="state" name="state" defaultValue={params.get("state") ?? ""}>
            <option value="">الكل</option>
            <option value="DRAFT">مسودة</option><option value="CHECKED_IN">وصل</option>
            <option value="CHECKED_OUT">غادر</option><option value="SUBMITTED">مرسلة</option>
            <option value="VERIFIED">متحقق منها</option><option value="RETURNED">معادة</option>
            <option value="CANCELLED">ملغاة</option>
          </select>
        </div>
        <div className="promise-field"><label htmlFor="visitDateFrom">من تاريخ</label><input id="visitDateFrom" name="visitDateFrom" type="date" defaultValue={params.get("visitDateFrom") ?? ""} /></div>
        <div className="promise-field"><label htmlFor="visitDateTo">إلى تاريخ</label><input id="visitDateTo" name="visitDateTo" type="date" defaultValue={params.get("visitDateTo") ?? ""} /></div>
        <div className="filter-actions"><button className="primary-button" type="submit">تطبيق</button><Link className="secondary-button button-link" href="/visits">مسح</Link></div>
      </form>

      {page.items.length === 0 ? (
        <section className="promise-empty"><h2>لا توجد زيارات مطابقة</h2><p>أنشئ زيارة من خطة اليوم أو غيّر الفلاتر.</p></section>
      ) : (
        <div className="promise-table-wrap">
          <table className="promise-table">
            <thead><tr><th>العميل</th><th>المندوب</th><th>النوع</th><th>الحالة</th><th>النتيجة</th><th>الوصول</th><th>المخرجات</th></tr></thead>
            <tbody>{page.items.map((visit) => (
              <tr key={visit.id}>
                <td><Link className="promise-link" href={`/visits/${visit.id}`}>{visit.customerName}</Link><br /><small>{visit.customerNumber ?? "دون رقم"} — {visit.visitSource === "PLAN" ? "من الخطة" : "خارج الخطة"}</small></td>
                <td>{visit.representativeName}</td>
                <td>{fieldVisitTypeLabel(visit.visitType)}</td>
                <td><span className={`status-pill ${visit.state === "VERIFIED" ? "fulfilled" : visit.state === "RETURNED" || visit.state === "CANCELLED" ? "overdue" : ""}`}>{fieldVisitStateLabel(visit.state)}</span></td>
                <td>{fieldVisitResultLabel(visit.declaredResult)}</td>
                <td>{formatVisitDateTime(visit.arrivedAt ?? visit.createdAt)}</td>
                <td>{visit.outcomeCount} نتائج / {visit.evidenceCount} أدلة</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {page.nextCursor ? <nav className="promise-pagination"><Link className="secondary-button button-link" href={nextPageHref(params, page.nextCursor) as Route}>الصفحة التالية</Link></nav> : null}
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
  const next = new URLSearchParams(params); next.set("cursor", cursor); return `/visits?${next.toString()}`;
}
