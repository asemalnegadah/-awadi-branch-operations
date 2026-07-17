import { createRandomToken, hmacSha256Hex } from "@/lib/security/web-crypto";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_DOMAIN = "awadi-password-reset-v1";

export function createPasswordResetToken(): string {
  return createRandomToken(32);
}

export function isPasswordResetToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export async function hashPasswordResetToken(
  token: string,
  authSecret: string,
): Promise<string> {
  if (!isPasswordResetToken(token)) {
    throw new Error("Invalid password reset token format.");
  }

  return hmacSha256Hex(authSecret, TOKEN_DOMAIN, token);
}
