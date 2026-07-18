import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/current-session";

import { LogoutButton } from "./logout-button";

export const metadata: Metadata = {
  title: "لوحة مدير الفرع",
};

export const dynamic = "force-dynamic";

const nextModules = [
  "رفع ومراجعة كشوف Onyx",
  "مطابقة العملاء والعملات",
  "محرك المخاطر",
  "الخطط اليومية والزيارات",
];

export default async function DashboardPage() {
  const session = await requireCurrentSession();
  if (session.user.mustChangePassword) {
    redirect("/settings/security");
  }
  requirePermission(session.user, "dashboard.read");

  return (
    <main className="shell dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow dark-eyebrow">مجموعة العوادي التجارية – فرع عدن</p>
          <h1>لوحة مدير الفرع</h1>
          <p className="dashboard-welcome">
            مرحبًا، <strong>{session.user.fullName}</strong>. تم التحقق من الجلسة
            والصلاحيات من الخادم.
          </p>
        </div>
        <div className="dashboard-actions">
          <Link className="secondary-button button-link" href="/settings/security">
            أمان الحساب
          </Link>
          <LogoutButton />
        </div>
      </header>

      <section className="grid dashboard-grid" aria-label="حالة الحساب">
        <article className="card">
          <span className="card-label">وضع التشغيل</span>
          <strong>مدير فرع واحد</strong>
          <small>{session.user.operatingMode}</small>
        </article>
        <article className="card">
          <span className="card-label">الدور</span>
          <strong>مدير فرع عدن</strong>
          <small>{session.user.roles.join("، ")}</small>
        </article>
        <article className="card">
          <span className="card-label">الصلاحيات الفعالة</span>
          <strong>{session.user.permissions.size}</strong>
          <small>مستخرجة من PostgreSQL</small>
        </article>
        <article className="card">
          <span className="card-label">انتهاء الجلسة</span>
          <strong>
            {new Intl.DateTimeFormat("ar-YE", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "Asia/Aden",
            }).format(session.expiresAt)}
          </strong>
          <small>الجلسة قابلة للإبطال من الخادم</small>
        </article>
      </section>

      {session.user.permissions.has("promises.read") ? (
        <section className="panel">
          <h2>وعود السداد</h2>
          <p>متابعة الوعود والاستحقاقات وربط التحصيلات المؤكدة مع فصل العملات.</p>
          <Link className="primary-button button-link" href="/promises">فتح وحدة الوعود</Link>
        </section>
      ) : null}

      <section className="panel">
        <h2>حالة الوحدات التالية</h2>
        <p>
          تم تجهيز أساس الدخول والجلسات وصلاحيات مدير الفرع. الوحدات التالية
          ستظهر تدريجيًا بعد اكتمال كل دفعة واختبارها.
        </p>
        <ul className="module-list">
          {nextModules.map((module) => (
            <li key={module}>{module}</li>
          ))}
        </ul>
      </section>

      <footer>
        <span>{session.user.email}</span>
        <span>لا توجد بيانات تشغيلية حقيقية في هذه الدفعة</span>
      </footer>
    </main>
  );
}
