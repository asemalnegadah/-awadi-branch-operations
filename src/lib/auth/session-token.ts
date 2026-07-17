import { createRandomToken, hmacSha256Hex } from "@/lib/security/web-crypto";

export const SESSION_COOKIE_NAME = "awadi_session";
export const DEFAULT_SESSION_TTL_HOURS = 8;
export const DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES = 60;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_TOKEN_DOMAIN = "awadi-session-v2";

export function createSessionToken(): string {
  return createRandomToken(32);
}

export function isSessionToken(token: string): boolean {
  return SESSION_TOKEN_PATTERN.test(token);
}

export async function hashSessionToken(
  token: string,
  authSecret: string,
): Promise<string> {
  if (!isSessionToken(token)) {
    throw new Error("رمز الجلسة غير صالح.");
  }

  return hmacSha256Hex(authSecret, SESSION_TOKEN_DOMAIN, token);
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

export function assertIdleTimeoutMinutes(value: number): void {
  if (!Number.isInteger(value) || value < 5 || value > 480) {
    throw new Error("مدة خمول الجلسة يجب أن تكون بين 5 و480 دقيقة.");
  }
}
