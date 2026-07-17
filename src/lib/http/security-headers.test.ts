import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

describe("security headers", () => {
  it("يفرض CSP والرؤوس الأساسية دون كشف إطار أو MIME sniffing", async () => {
    const rules = await nextConfig.headers?.();
    const headers = new Map(rules?.[0]?.headers.map((header) => [header.key, header.value]));
    const csp = headers.get("Content-Security-Policy") ?? "";

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });
});
