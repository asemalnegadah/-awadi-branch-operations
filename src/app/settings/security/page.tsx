import type { Metadata } from "next";
import Link from "next/link";

import { requireCurrentSession } from "@/lib/auth/current-session";

import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = {
  title: "أمان الحساب",
};

export const dynamic = "force-dynamic";

export default async function SecuritySettingsPage() {
  const session = await requireCurrentSession();

  return (
    <main className="auth-shell settings-shell">
      <section className="auth-card settings-card" aria-labelledby="security-title">
        <div className="auth-brand">
          <Link className="text-link" href="/dashboard">
            العودة إلى لوحة المدير
          </Link>
          <p className="eyebrow dark-eyebrow">أمان حساب مدير الفرع</p>
          <h1 id="security-title">تغيير كلمة المرور</h1>
          <p>
            الحساب الحالي: <strong>{session.user.email}</strong>. عند نجاح التغيير
            تبقى هذه الجلسة فقط وتُبطل أي جلسات أخرى.
          </p>
        </div>
        <ChangePasswordForm />
      </section>
    </main>
  );
}
