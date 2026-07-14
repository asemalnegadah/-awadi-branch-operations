import { createHmac, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_DOMAIN = "awadi-password-reset-v1";

export function createPasswordResetToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function isPasswordResetToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export function hashPasswordResetToken(token: string, authSecret: string): string {
  if (!isPasswordResetToken(token)) {
    throw new Error("Invalid password reset token format.");
  }

  if (authSecret.length < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 characters.");
  }

  return createHmac("sha256", authSecret)
    .update(TOKEN_DOMAIN)
    .update("\0")
    .update(token)
    .digest("hex");
}
