import { describe, expect, it } from "vitest";

import {
  assertPasswordPolicy,
  hashPassword,
  PasswordPolicyError,
  verifyPassword,
} from "./password";

describe("password hashing", () => {
  it("ينشئ بصمة مختلفة لكل كلمة مرور ويتحقق منها", async () => {
    const password = "Correct-Horse-2026";
    const first = await hashPassword(password);
    const second = await hashPassword(password);

    expect(first).not.toBe(second);
    await expect(verifyPassword(password, first)).resolves.toBe(true);
    await expect(verifyPassword("Wrong-Password-2026", first)).resolves.toBe(false);
  });

  it("يرفض البصمات التالفة دون رمي خطأ", async () => {
    await expect(verifyPassword("Correct-Horse-2026", "invalid")).resolves.toBe(
      false,
    );
  });

  it("يفرض الحد الأدنى والأقصى لكلمة المرور", () => {
    expect(() => assertPasswordPolicy("short")).toThrow(PasswordPolicyError);
    expect(() => assertPasswordPolicy("x".repeat(129))).toThrow(
      PasswordPolicyError,
    );
    expect(() => assertPasswordPolicy("Long-Enough-2026")).not.toThrow();
  });
});
