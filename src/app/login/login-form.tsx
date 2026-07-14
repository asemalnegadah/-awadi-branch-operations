"use client";

import { FormEvent, useState } from "react";

interface LoginApiResponse {
  readonly success: boolean;
  readonly error?: {
    readonly message?: string;
  };
}

export function LoginForm() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json()) as LoginApiResponse;

      if (!response.ok || !payload.success) {
        setErrorMessage(
          payload.error?.message ?? "تعذر تسجيل الدخول. حاول مرة أخرى.",
        );
        return;
      }

      window.location.assign("/dashboard");
    } catch {
      setErrorMessage("تعذر الاتصال بالنظام الآن. تحقق من الاتصال وحاول مجددًا.");
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
          autoComplete="username"
          required
          maxLength={254}
          dir="ltr"
        />
      </div>

      <div className="form-field">
        <label htmlFor="password">كلمة المرور</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
          dir="ltr"
        />
      </div>

      {errorMessage ? (
        <p className="form-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <button className="primary-button" type="submit" disabled={submitting}>
        {submitting ? "جارٍ التحقق…" : "تسجيل الدخول"}
      </button>
    </form>
  );
}
