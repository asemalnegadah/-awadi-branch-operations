import { describe, expect, it } from "vitest";

import {
  createSessionToken,
  hashSessionToken,
  sessionExpiryFromNow,
} from "./session-token";

describe("session token protection", () => {
  it("ينشئ رمزًا عشوائيًا ولا يخزن الرمز الخام", () => {
    const secret = "a".repeat(32);
    const token = createSessionToken();
    const hash = hashSessionToken(token, secret);

    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
  });

  it("يعطي بصمة ثابتة للرمز والسر نفسيهما", () => {
    const token = createSessionToken();
    const secret = "b".repeat(32);

    expect(hashSessionToken(token, secret)).toBe(hashSessionToken(token, secret));
  });

  it("يحسب انتهاء الجلسة ضمن السياسة", () => {
    const now = new Date("2026-07-14T20:00:00.000Z");
    expect(sessionExpiryFromNow(8, now).toISOString()).toBe(
      "2026-07-15T04:00:00.000Z",
    );
    expect(() => sessionExpiryFromNow(25, now)).toThrow();
  });
});
