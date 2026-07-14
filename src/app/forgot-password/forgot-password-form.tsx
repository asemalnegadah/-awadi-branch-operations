"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

interface ForgotPasswordApiResponse {
  readonly success: boolean;
  readonly message?: string;
  readonly error?: {
    readonly message?: string;
  };
}

export function ForgotPasswordForm() {
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setErrorMessage(null);
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");

    try {
      const response = await fetch("/api/v1/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json()) as ForgotPasswordApiResponse;

      if (!response.ok || !payload.success) {
        setErrorMessage(
          payload.error?.message ?? "تعذر إرسال طلب الاستعادة الآن.",
        );
        return;
      }

      setMessage(
        payload.message ??
          "إذا كان البريد مسجلًا، فستصل رسالة التفعيل أو الاستعادة خلال دقائق.",
      );
      event.currentTarget.reset();
    } catch {
      setErrorMessage("تعذر الاتصال بالنظام الآن. حاول مرة أخرى لاحقًا.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <div className="form-field">
        <label htmlFor="email">البريد الإلكتروني</label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          maxLength={254}
          dir="ltr"
        />
      </div>

      {message ? (
        <p className="form-success" role="status">
          {message}
        </p>
      ) : null}

      {errorMessage ? (
        <p className="form-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <button className="primary-button" type="submit" disabled={submitting}>
        {submitting ? "جارٍ الإرسال…" : "إرسال رابط الاستعادة"}
      </button>

      <Link className="auth-text-link" href="/login">
        العودة إلى تسجيل الدخول
      </Link>
    </form>
  );
}
