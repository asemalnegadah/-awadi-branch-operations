import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const revoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/postgres-auth-service", () => ({ revokeSessionByToken: revoke }));
vi.mock("@/lib/config/server-env", () => ({
  getAuthEnv: () => ({
    AUTH_SECRET: "a".repeat(32),
    TRUSTED_ORIGIN_SET: new Set(["https://app.example.test"]),
  }),
}));
vi.mock("@/lib/db/client", () => ({ getDatabaseClient: () => ({}) }));
vi.mock("@/lib/http/request-security-context", () => ({
  getRequestSecurityContext: () => ({
    requestId: "10000000-0000-4000-8000-000000000001",
    ipAddress: null,
    userAgent: "vitest",
  }),
}));

import { POST } from "./route";

describe("POST /api/v1/auth/logout", () => {
  beforeEach(() => revoke.mockReset().mockResolvedValue(true));

  it("يبطل جلسة الخادم ويحذف Cookie العميل", async () => {
    const token = "s".repeat(43);
    const response = await POST(
      new NextRequest("https://app.example.test/api/v1/auth/logout", {
        method: "POST",
        headers: {
          origin: "https://app.example.test",
          cookie: `awadi_session=${token}`,
        },
      }),
    );

    expect(revoke).toHaveBeenCalledWith(
      expect.anything(),
      token,
      "a".repeat(32),
      expect.anything(),
    );
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("awadi_session=");
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("HttpOnly");
  });
});
