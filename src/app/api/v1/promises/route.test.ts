import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PermissionCode } from "@/lib/auth/permissions";
import type { AuthenticatedSession } from "@/lib/auth/types";

const currentSession = vi.hoisted(() => vi.fn());
const createPromise = vi.hoisted(() => vi.fn());
const listPromises = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/current-session", () => ({ getCurrentSession: currentSession }));
vi.mock("@/lib/config/server-env", () => ({
  getAuthEnv: () => ({ TRUSTED_ORIGIN_SET: new Set(["https://app.example.test"]) }),
}));
vi.mock("@/lib/db/client", () => ({ getDatabaseClient: () => ({}) }));
vi.mock("@/lib/http/request-security-context", () => ({
  getRequestSecurityContext: () => ({
    requestId: "10000000-0000-4000-8000-000000000099",
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
  }),
}));
vi.mock("@/lib/promises/service", () => ({ createPromise, listPromises }));

import { GET, POST } from "./route";

function session(permissions: readonly PermissionCode[]): AuthenticatedSession {
  return {
    id: "10000000-0000-4000-8000-000000000010",
    user: {
      id: "10000000-0000-4000-8000-000000000011",
      email: "promise.api@example.test",
      fullName: "مستخدم API الوعود",
      roles: ["BRANCH_MANAGER"],
      permissions: new Set(permissions),
      operatingMode: "SINGLE_MANAGER",
      mustChangePassword: false,
    },
    createdAt: new Date("2026-07-18T00:00:00Z"),
    expiresAt: new Date("2026-07-19T00:00:00Z"),
  };
}

const validBody = {
  customerId: "10000000-0000-4000-8000-000000000001",
  customerAccountId: "10000000-0000-4000-8000-000000000002",
  representativeId: "10000000-0000-4000-8000-000000000003",
  currencyCode: "SR",
  promisedAmountMinor: 1000,
  promiseDate: "2026-07-18",
  dueDate: "2026-07-20",
  debtReason: "فاتورة آجلة",
};

function request(method: "GET" | "POST", body?: unknown, origin = "https://app.example.test") {
  const headers = {
    origin,
    "content-type": "application/json",
    "idempotency-key": "promise-api-test-001",
  };
  if (body === undefined) {
    return new NextRequest("https://app.example.test/api/v1/promises", { method, headers });
  }
  return new NextRequest("https://app.example.test/api/v1/promises", {
    method,
    headers,
    body: JSON.stringify(body),
  });
}


describe("/api/v1/promises", () => {
  beforeEach(() => {
    currentSession.mockReset(); createPromise.mockReset(); listPromises.mockReset();
  });

  it("يعيد 401 عند غياب الجلسة", async () => {
    currentSession.mockResolvedValue(null);
    const response = await GET(request("GET"));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("يرفض مصدر الكتابة غير الموثوق قبل تنفيذ الخدمة", async () => {
    currentSession.mockResolvedValue(session(["promises.create"]));
    const response = await POST(request("POST", validBody, "https://evil.example.test"));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "ORIGIN_REJECTED" } });
    expect(createPromise).not.toHaveBeenCalled();
  });

  it("يعيد 403 لمستخدم القراءة فقط", async () => {
    currentSession.mockResolvedValue(session(["promises.read"]));
    const response = await POST(request("POST", validBody));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("يرفض fulfilled_amount والحقول غير المعروفة بـ422", async () => {
    currentSession.mockResolvedValue(session(["promises.create"]));
    const response = await POST(
      request("POST", { ...validBody, fulfilledAmountMinor: 100 }),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(createPromise).not.toHaveBeenCalled();
  });

  it("ينشئ وعدًا ويعيد 201 مع request ID", async () => {
    currentSession.mockResolvedValue(session(["promises.create"]));
    createPromise.mockResolvedValue({
      promise: { id: "10000000-0000-4000-8000-000000000020" },
      replayed: false,
    });
    const response = await POST(request("POST", validBody));
    expect(response.status).toBe(201);
    expect(response.headers.get("x-request-id")).toBe("10000000-0000-4000-8000-000000000099");
    expect(createPromise).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ currencyCode: "SR" }),
      expect.objectContaining({ idempotencyKey: "promise-api-test-001" }),
    );
  });

  it("لا يسرب تفاصيل الاستثناءات الداخلية", async () => {
    currentSession.mockResolvedValue(session(["promises.create"]));
    createPromise.mockRejectedValue(new Error("postgres://user:secret@private-host/database"));
    const response = await POST(request("POST", validBody));
    const body = await response.json() as { error: { message: string } };
    expect(response.status).toBe(500);
    expect(body.error.message).toBe("تعذر إكمال العملية الآن.");
    expect(JSON.stringify(body)).not.toContain("private-host");
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
