import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";

import { SESSION_COOKIE_NAME } from "@/lib/auth/session-token";

export function createSessionCookie(
  value: string,
  expiresAt: Date,
  production = process.env.NODE_ENV === "production",
): ResponseCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value,
    httpOnly: true,
    secure: production,
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
    priority: "high",
  };
}

export function expireSessionCookie(
  production = process.env.NODE_ENV === "production",
): ResponseCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: production,
    sameSite: "strict",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
    priority: "high",
  };
}
