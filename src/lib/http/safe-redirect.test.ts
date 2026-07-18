import { describe, expect, it } from "vitest";

import { safeInternalRedirectPath } from "./safe-redirect";

describe("safe internal redirects", () => {
  it("يسمح بالمسارات الداخلية فقط", () => {
    expect(safeInternalRedirectPath("/settings/security?tab=sessions#active")).toBe(
      "/settings/security?tab=sessions#active",
    );
  });

  it.each([
    "https://attacker.example/steal",
    "//attacker.example/steal",
    "javascript:alert(1)",
    "https://user:pass@app.example.test/",
  ])("يرفض التحويل المفتوح: %s", (value) => {
    expect(safeInternalRedirectPath(value)).toBe("/dashboard");
  });
});
