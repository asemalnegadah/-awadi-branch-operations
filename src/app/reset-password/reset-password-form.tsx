"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

interface ResetPasswordApiResponse {
  readonly success: boolean;
  readonly message?: string;
  readonly error?: {
    readonly message?: string;
  };
}

export function ResetPasswordForm() {
  const [token, setToken] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    const fragmentToken = parameters.get("token");

    if (fragmentToken && /^[A-Za-z0-9_-]{43}$/.test(fragmentToken)) {
      setToken(fragmentToken);
    }

    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
    setTokenReady(true);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setErrorMessage(null);

    if (!token) {
      setErrorMessage("رابط الاستعادة غير صالح. اطلب رابطًا جديدًا.");
      return;
    }

    setSubmitting(true);
    const formData = new FormData(event.currentTarget);
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirmation = String(formData.get("confirmation") ?? "");

    try {
      const response = await fetch("/api/v1/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, newPassword, confirmation }),
      });
      const payload = (await response.json()) as ResetPasswordApiResponse;

      if (!response.ok || !payload.success) {
        setErrorMessage(
          payload.error?.message ?? "تعذر تعيين كلمة المرور الجديدة.",
        );
        return;
      }

      setToken(null);
      event.currentTarget.reset();
      setMessage(
        payload.message ??
          "تم تعيين كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.",
      );
    } catch {
      setErrorMessage("تعذر الاتصال بالنظام الآن. حاول مرة أخرى لاحقًا.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!tokenReady) {
    return <p className="auth-loading">جارٍ التحقق من رابط الاستعادة…</p>;
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      {token ? (
        <>
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
            <small>لا تقل عن 12 حرفًا، ولا تستخدم كلمة مرور لحساب آخر.</small>
          </div>

          <div className="form-field">
            <label htmlFor="confirmation">تأكيد كلمة المرور</label>
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
        </>
      ) : null}

      {message ? (
        <p className="form-success" role="status">
          {message}
        </p>
      ) : null}

      {errorMessage || !token ? (
        <p className="form-error" role="alert">
          {errorMessage ?? "رابط الاستعادة غير صالح. اطلب رابطًا جديدًا."}
        </p>
      ) : null}

      {token ? (
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? "جارٍ الحفظ…" : "حفظ كلمة المرور الجديدة"}
        </button>
      ) : (
        <Link className="primary-button button-link" href="/forgot-password">
          طلب رابط جديد
        </Link>
      )}

      <Link className="auth-text-link" href="/login">
        العودة إلى تسجيل الدخول
      </Link>
    </form>
  );
}
