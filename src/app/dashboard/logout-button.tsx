"use client";

import { useState } from "react";

export function LogoutButton() {
  const [submitting, setSubmitting] = useState(false);

  async function logout() {
    setSubmitting(true);
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <button
      className="secondary-button"
      type="button"
      onClick={logout}
      disabled={submitting}
    >
      {submitting ? "جارٍ الخروج…" : "تسجيل الخروج"}
    </button>
  );
}
