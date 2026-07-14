import type { Metadata } from "next";

import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "تعيين كلمة مرور جديدة",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ResetPasswordPage() {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="reset-password-title">
        <div className="auth-brand">
          <p className="eyebrow dark-eyebrow">مجموعة العوادي التجارية – فرع عدن</p>
          <h1 id="reset-password-title">تعيين كلمة مرور جديدة</h1>
          <p>
            الرابط صالح لمرة واحدة فقط. بعد الحفظ تُلغى الجلسات والروابط السابقة
            لحماية الحساب.
          </p>
        </div>
        <ResetPasswordForm />
      </section>
    </main>
  );
}
