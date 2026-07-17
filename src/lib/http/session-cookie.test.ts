import { describe, expect, it } from "vitest";

import { createSessionCookie, expireSessionCookie } from "./session-cookie";

describe("session cookie policy", () => {
  it("يفرض HttpOnly وSecure وSameSite Strict في الإنتاج", () => {
    const expiresAt = new Date("2026-07-18T00:00:00.000Z");
    const cookie = createSessionCookie("a".repeat(43), expiresAt, true);

    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      expires: expiresAt,
      priority: "high",
    });
  });

  it("يبطل Cookie الجلسة بالخصائص الأمنية نفسها", () => {
    expect(expireSessionCookie(true)).toMatchObject({
      value: "",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 0,
      priority: "high",
    });
  });
});
