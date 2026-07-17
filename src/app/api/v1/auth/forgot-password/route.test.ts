import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requestReset = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/postgres-password-reset-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/postgres-password-reset-service")>();
  return { ...actual, requestPasswordResetPostgres: requestReset };
});
vi.mock("@/lib/config/server-env", () => ({
  getPasswordRecoveryEnv: () => ({
    AUTH_SECRET: "a".repeat(32),
    APP_BASE_URL: "https://app.example.test",
    TRUSTED_ORIGIN_SET: new Set(["https://app.example.test"]),
    RESEND_API_KEY: "test-key",
    EMAIL_FROM: "security@example.test",
    PASSWORD_RESET_TTL_MINUTES: 30,
    PASSWORD_RESET_EMAIL_MAX_PER_HOUR: 3,
    PASSWORD_RESET_IP_MAX_PER_HOUR: 10,
    ALLOW_INITIAL_MANAGER_EMAIL_BOOTSTRAP: false,
  }),
}));
vi.mock("@/lib/db/client", () => ({ getDatabaseClient: () => ({}) }));
vi.mock("@/lib/email/password-reset-email", () => ({
  ResendPasswordResetEmailSender: class {},
}));
vi.mock("@/lib/http/request-security-context", () => ({
  getRequestSecurityContext: () => ({
    requestId: "10000000-0000-4000-8000-000000000001",
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
  }),
}));

import { POST } from "./route";

describe("POST /api/v1/auth/forgot-password", () => {
  beforeEach(() => requestReset.mockReset().mockResolvedValue(undefined));

  it("يعيد الرسالة نفسها للبريد المسجل وغير المسجل", async () => {
    const known = await POST(buildRequest("known@example.test"));
    const unknown = await POST(buildRequest("unknown@example.test"));

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    const knownBody = (await known.json()) as { message: string };
    const unknownBody = (await unknown.json()) as { message: string };
    expect(knownBody.message).toBe(unknownBody.message);
    expect(knownBody).not.toHaveProperty("userExists");
  });

  it("يرفض Origin غير الموثوق دون استدعاء خدمة الاستعادة", async () => {
    const response = await POST(buildRequest("known@example.test", "https://attacker.example"));
    expect(response.status).toBe(403);
    expect(requestReset).not.toHaveBeenCalled();
  });
});

function buildRequest(email: string, origin = "https://app.example.test") {
  return new NextRequest("https://app.example.test/api/v1/auth/forgot-password", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
}
