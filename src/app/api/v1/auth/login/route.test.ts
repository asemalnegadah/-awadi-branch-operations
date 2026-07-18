import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("@/lib/auth/postgres-auth-service", () => ({
  loginPostgres: mocks.login,
  revokeSessionByToken: mocks.revoke,
}));
vi.mock("@/lib/config/server-env", () => ({
  getAuthEnv: () => ({
    AUTH_SECRET: "a".repeat(32),
    SESSION_TTL_HOURS: 8,
    SESSION_IDLE_TIMEOUT_MINUTES: 60,
    LOGIN_EMAIL_MAX_PER_15_MINUTES: 10,
    LOGIN_IP_MAX_PER_15_MINUTES: 30,
    TRUSTED_ORIGIN_SET: new Set(["https://app.example.test"]),
  }),
}));
vi.mock("@/lib/db/client", () => ({ getDatabaseClient: () => ({}) }));
vi.mock("@/lib/http/request-security-context", () => ({
  getRequestSecurityContext: () => ({
    requestId: "10000000-0000-4000-8000-000000000001",
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
  }),
}));

import { POST } from "./route";

describe("POST /api/v1/auth/login", () => {
  beforeEach(() => {
    mocks.login.mockReset();
    mocks.revoke.mockReset();
    mocks.revoke.mockResolvedValue(true);
    mocks.login.mockResolvedValue({
      token: "n".repeat(43),
      session: {
        id: "20000000-0000-4000-8000-000000000001",
        createdAt: new Date("2026-07-17T00:00:00.000Z"),
        expiresAt: new Date("2026-07-17T08:00:00.000Z"),
        user: {
          id: "30000000-0000-4000-8000-000000000001",
          email: "manager@example.test",
          fullName: "مدير الفرع",
          roles: ["BRANCH_MANAGER"],
          permissions: new Set(["dashboard.read"]),
          operatingMode: "SINGLE_MANAGER",
          mustChangePassword: false,
        },
      },
    });
  });

  it("يرفض Origin غير الموثوق قبل التحقق من بيانات الدخول", async () => {
    const response = await POST(buildRequest("https://attacker.example"));

    expect(response.status).toBe(403);
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it("يدور الجلسة عند تسجيل الدخول ويصدر Cookie محمية", async () => {
    const oldToken = "o".repeat(43);
    const response = await POST(
      buildRequest("https://app.example.test", `${oldToken}`),
    );

    expect(response.status).toBe(200);
    expect(mocks.revoke).toHaveBeenCalledWith(
      expect.anything(),
      oldToken,
      "a".repeat(32),
      expect.anything(),
      "SESSION_ROTATED_ON_LOGIN",
    );
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("awadi_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=strict");
    expect(setCookie).toContain("Path=/");
  });
});

function buildRequest(origin: string, sessionToken?: string): NextRequest {
  return new NextRequest("https://app.example.test/api/v1/auth/login", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...(sessionToken ? { cookie: `awadi_session=${sessionToken}` } : {}),
    },
    body: JSON.stringify({
      email: "manager@example.test",
      password: "Manager-Password-2026",
    }),
  });
}
