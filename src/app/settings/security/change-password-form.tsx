"use client";

import { FormEvent, useState } from "react";

interface ApiResponse {
  readonly success: boolean;
  readonly error?: { readonly message?: string };
}

export function ChangePasswordForm() {
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<
    { readonly kind: "success" | "error"; readonly text: string } | null
  >(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const response = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: String(data.get("currentPassword") ?? ""),
          newPassword: String(data.get("newPassword") ?? ""),
          confirmation: String(data.get("confirmation") ?? ""),
        }),
      });
      const payload = (await response.json()) as ApiResponse;

      if (!response.ok || !payload.success) {
        setMessage({
          kind: "error",
          text: payload.error?.message ?? "تعذر تغيير كلمة المرور.",
        });
        return;
      }

      form.reset();
      setMessage({
        kind: "success",
        text: "تم تغيير كلمة المرور وإبطال الجلسات الأخرى بنجاح.",
      });
    } catch {
      setMessage({
        kind: "error",
        text: "تعذر الاتصال بالنظام الآن. حاول مرة أخرى.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form security-form" onSubmit={handleSubmit}>
      <div className="form-field">
        <label htmlFor="currentPassword">كلمة المرور الحالية</label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
          dir="ltr"
        />
      </div>

      <div className="form-field">
        <label htmlFor="newPassword">كلمة المرور الجديدة</label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          dir="ltr"
        />
        <small>12 حرفًا على الأقل، ويفضل استخدام عبارة طويلة وفريدة.</small>
      </div>

      <div className="form-field">
        <label htmlFor="confirmation">تأكيد كلمة المرور الجديدة</label>
        <input
          id="confirmation"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={128}
          dir="ltr"
        />
      </div>

      {message ? (
        <p
          className={message.kind === "success" ? "form-success" : "form-error"}
          role="status"
        >
          {message.text}
        </p>
      ) : null}

      <button className="primary-button" type="submit" disabled={submitting}>
        {submitting ? "جارٍ الحفظ…" : "تغيير كلمة المرور"}
      </button>
    </form>
  );
}
