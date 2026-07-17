import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { getRequestSecurityContext } from "./request-security-context";

describe("request security context", () => {
  it("يحافظ على Request ID صالح ويأخذ IP من Cloudflare فقط", () => {
    const requestId = "10000000-0000-4000-8000-000000000001";
    const context = getRequestSecurityContext(
      new NextRequest("https://app.example.test/api/action", {
        headers: {
          "x-request-id": requestId,
          "cf-connecting-ip": "203.0.113.10",
          "x-forwarded-for": "198.51.100.1",
          "user-agent": "a".repeat(600),
        },
      }),
    );

    expect(context.requestId).toBe(requestId);
    expect(context.ipAddress).toBe("203.0.113.10");
    expect(context.userAgent).toHaveLength(500);
  });

  it("يستبدل Request ID غير الصالح ولا يثق في X-Forwarded-For", () => {
    const context = getRequestSecurityContext(
      new NextRequest("https://app.example.test/api/action", {
        headers: {
          "x-request-id": "../../secret",
          "x-forwarded-for": "198.51.100.1",
        },
      }),
    );

    expect(context.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(context.ipAddress).toBeNull();
  });
});
