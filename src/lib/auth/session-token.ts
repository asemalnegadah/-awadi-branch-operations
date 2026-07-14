import { createHmac, randomBytes } from "node:crypto";

export const SESSION_COOKIE_NAME = "awadi_session";
export const DEFAULT_SESSION_TTL_HOURS = 8;

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string, authSecret: string): string {
  if (token.length < 32) {
    throw new Error("رمز الجلسة غير صالح.");
  }

  if (authSecret.length < 32) {
    throw new Error("AUTH_SECRET يجب أن يكون بطول 32 حرفًا على الأقل.");
  }

  return createHmac("sha256", authSecret).update(token).digest("hex");
}

export function sessionExpiryFromNow(
  ttlHours: number = DEFAULT_SESSION_TTL_HOURS,
  now: Date = new Date(),
): Date {
  if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > 24) {
    throw new Error("مدة الجلسة يجب أن تكون بين ساعة و24 ساعة.");
  }

  return new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
}
