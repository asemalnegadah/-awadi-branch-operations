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
  "مطابقة الحسابات والفوارق",
  "تسليم النقدية والإغلاق اليومي",
  "المخزون والتشغيلات والانتهاء",
  "المركبات والوقود والصيانة",
  "التقارير والتنبيهات التشغيلية",
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
          <strong>{session.user.operatingMode === "SINGLE_MANAGER" ? "مدير فرع واحد" : "فصل المهام"}</strong>
          <small>{session.user.operatingMode}</small>
        </article>
        <article className="card">
          <span className="card-label">الأدوار</span>
          <strong>{session.user.roles.length}</strong>
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

      <section className="grid">
        {session.user.permissions.has("promises.read") ? (
          <article className="panel">
            <h2>وعود السداد</h2>
            <p>متابعة الوعود والاستحقاقات وربط التحصيلات المؤكدة مع فصل العملات.</p>
            <Link className="primary-button button-link" href="/promises">فتح وحدة الوعود</Link>
          </article>
        ) : null}

        {session.user.permissions.has("risk.read") ? (
          <article className="panel">
            <h2>المخاطر والمنع الائتماني</h2>
            <p>تقييم قابل للتفسير لكل حساب وعملة، وقرارات منع واستثناءات باعتماد وتدقيق.</p>
            <Link className="primary-button button-link" href="/risk">فتح وحدة المخاطر</Link>
          </article>
        ) : null}

        {session.user.permissions.has("plans.read_own") ? (
          <article className="panel">
            <h2>الخطط اليومية</h2>
            <p>خطط حتمية بأهداف تحصيل وبيع منفصلة لـSR وRG ومسارات اعتماد وتنفيذ موثقة.</p>
            <Link className="primary-button button-link" href="/plans">فتح وحدة الخطط</Link>
          </article>
        ) : null}

        {session.user.permissions.has("visits.read_own") ? (
          <article className="panel">
            <h2>الزيارات الميدانية</h2>
            <p>تسجيل الوصول والمغادرة والنتائج والأدلة وربطها بعناصر الخطة والتحقق الإداري.</p>
            <Link className="primary-button button-link" href="/visits">فتح وحدة الزيارات</Link>
          </article>
        ) : null}
      </section>

      <section className="panel">
        <h2>الوحدات قيد الاستكمال</h2>
        <p>
          يستمر البناء كوحدات تشغيلية كاملة تشمل قاعدة البيانات والصلاحيات والـAPI
          والواجهة والاختبارات قبل دمج كل دفعة.
        </p>
        <ul className="module-list">
          {nextModules.map((module) => (
            <li key={module}>{module}</li>
          ))}
        </ul>
      </section>

      <footer>
        <span>{session.user.email}</span>
        <span>فرع عدن فقط — العملات مستقلة — وقت الخادم معتمد</span>
      </footer>
    </main>
  );
}
