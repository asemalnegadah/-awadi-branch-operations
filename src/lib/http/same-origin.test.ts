import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { isSameOriginWrite } from "./same-origin";

describe("same-origin write validation", () => {
  it("يسمح بالطلب من الأصل نفسه", () => {
    const request = new NextRequest("https://app.example.test/api/action", {
      method: "POST",
      headers: { origin: "https://app.example.test" },
    });

    expect(isSameOriginWrite(request)).toBe(true);
  });

  it("يرفض الأصل المختلف أو غير الصالح", () => {
    const crossSite = new NextRequest("https://app.example.test/api/action", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    });
    const invalid = new NextRequest("https://app.example.test/api/action", {
      method: "POST",
      headers: { origin: "not-a-url" },
    });

    expect(isSameOriginWrite(crossSite)).toBe(false);
    expect(isSameOriginWrite(invalid)).toBe(false);
  });

  it("يسمح لأوامر الخادم التي لا ترسل Origin", () => {
    const request = new NextRequest("https://app.example.test/api/action", {
      method: "POST",
    });

    expect(isSameOriginWrite(request)).toBe(true);
  });
});
