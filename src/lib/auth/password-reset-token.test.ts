import { describe, expect, it } from "vitest";

import {
  createPasswordResetToken,
  hashPasswordResetToken,
  isPasswordResetToken,
} from "./password-reset-token";

const secret = "0123456789abcdef0123456789abcdef";

describe("password reset tokens", () => {
  it("creates URL-safe random tokens", () => {
    const token = createPasswordResetToken();

    expect(token).toHaveLength(43);
    expect(isPasswordResetToken(token)).toBe(true);
  });

  it("hashes deterministically with domain separation", () => {
    const token = createPasswordResetToken();

    expect(hashPasswordResetToken(token, secret)).toHaveLength(64);
    expect(hashPasswordResetToken(token, secret)).toBe(
      hashPasswordResetToken(token, secret),
    );
    expect(hashPasswordResetToken(token, `${secret}x`)).not.toBe(
      hashPasswordResetToken(token, secret),
    );
  });

  it("rejects malformed tokens", () => {
    expect(isPasswordResetToken("not-a-token")).toBe(false);
    expect(() => hashPasswordResetToken("not-a-token", secret)).toThrow();
  });
});
