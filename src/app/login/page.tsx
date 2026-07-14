import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentSession } from "@/lib/auth/current-session";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "تسجيل الدخول",
};

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getCurrentSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-brand">
          <p className="eyebrow dark-eyebrow">مجموعة العوادي التجارية – فرع عدن</p>
          <h1 id="login-title">تسجيل الدخول</h1>
          <p>
            نظام داخلي خاص بإدارة وتشغيل ورقابة فرع عدن. لا يسمح بالدخول دون
            حساب معتمد.
          </p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
