import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentSession } from "@/lib/auth/current-session";

import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "استعادة كلمة المرور",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  const session = await getCurrentSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="forgot-password-title">
        <div className="auth-brand">
          <p className="eyebrow dark-eyebrow">مجموعة العوادي التجارية – فرع عدن</p>
          <h1 id="forgot-password-title">استعادة كلمة المرور</h1>
          <p>
            أدخل بريدك المعتمد. سيُرسل رابط صالح لمرة واحدة لتفعيل الحساب أو
            تعيين كلمة مرور جديدة.
          </p>
        </div>
        <ForgotPasswordForm />
      </section>
    </main>
  );
}
