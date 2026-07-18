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

  it("hashes deterministically with domain separation", async () => {
    const token = createPasswordResetToken();
    const first = await hashPasswordResetToken(token, secret);
    const second = await hashPasswordResetToken(token, secret);
    const otherSecret = await hashPasswordResetToken(token, `${secret}x`);

    expect(first).toHaveLength(64);
    expect(first).toBe(second);
    expect(otherSecret).not.toBe(first);
  });

  it("rejects malformed tokens", async () => {
    expect(isPasswordResetToken("not-a-token")).toBe(false);
    await expect(hashPasswordResetToken("not-a-token", secret)).rejects.toThrow();
  });
});
