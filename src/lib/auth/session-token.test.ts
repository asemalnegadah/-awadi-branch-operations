import { describe, expect, it } from "vitest";

import {
  createSessionToken,
  hashSessionToken,
  sessionExpiryFromNow,
} from "./session-token";

describe("session token protection", () => {
  it("ينشئ رمزًا عشوائيًا ولا يخزن الرمز الخام", async () => {
    const secret = "a".repeat(32);
    const token = createSessionToken();
    const hash = await hashSessionToken(token, secret);

    expect(token).toHaveLength(43);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
  });

  it("يعطي بصمة ثابتة للرمز والسر نفسيهما", async () => {
    const token = createSessionToken();
    const secret = "b".repeat(32);

    await expect(hashSessionToken(token, secret)).resolves.toBe(
      await hashSessionToken(token, secret),
    );
  });

  it("ينشئ رموزًا مختلفة لمنع تثبيت الجلسة", () => {
    expect(createSessionToken()).not.toBe(createSessionToken());
  });

  it("يرفض الرموز المشوهة", async () => {
    await expect(hashSessionToken("not-a-session-token", "c".repeat(32))).rejects.toThrow();
  });

  it("يحسب انتهاء الجلسة ضمن السياسة", () => {
    const now = new Date("2026-07-14T20:00:00.000Z");
    expect(sessionExpiryFromNow(8, now).toISOString()).toBe(
      "2026-07-15T04:00:00.000Z",
    );
    expect(() => sessionExpiryFromNow(25, now)).toThrow();
  });
});
