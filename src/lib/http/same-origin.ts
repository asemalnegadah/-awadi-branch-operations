import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/session-token";

export type WriteRequestRejection =
  | "UNTRUSTED_HOST"
  | "CROSS_SITE"
  | "UNTRUSTED_ORIGIN"
  | "MISSING_BROWSER_ORIGIN";

export type WriteRequestValidation =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: WriteRequestRejection };

export function validateWriteRequestOrigin(
  request: NextRequest,
  trustedOrigins: ReadonlySet<string>,
): WriteRequestValidation {
  if (!trustedOrigins.has(request.nextUrl.origin)) {
    return { allowed: false, reason: "UNTRUSTED_HOST" };
  }

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  const origin = parseOrigin(request.headers.get("origin"));
  if (origin) {
    return trustedOrigins.has(origin)
      ? { allowed: true }
      : { allowed: false, reason: "UNTRUSTED_ORIGIN" };
  }

  const refererOrigin = parseOrigin(request.headers.get("referer"));
  if (refererOrigin) {
    return trustedOrigins.has(refererOrigin)
      ? { allowed: true }
      : { allowed: false, reason: "UNTRUSTED_ORIGIN" };
  }

  if (fetchSite === "same-origin") {
    return { allowed: true };
  }

  if (fetchSite === "cross-site" || fetchSite === "same-site") {
    return { allowed: false, reason: "CROSS_SITE" };
  }

  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);
  const looksLikeBrowser = Boolean(
    fetchSite ||
      request.headers.get("sec-fetch-mode") ||
      request.headers.get("sec-fetch-dest"),
  );

  if (hasSessionCookie || looksLikeBrowser) {
    return { allowed: false, reason: "MISSING_BROWSER_ORIGIN" };
  }

  return { allowed: true };
}

export function isSameOriginWrite(
  request: NextRequest,
  trustedOrigins: ReadonlySet<string> = new Set([request.nextUrl.origin]),
): boolean {
  return validateWriteRequestOrigin(request, trustedOrigins).allowed;
}

function parseOrigin(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return "invalid-origin";
  }
}
