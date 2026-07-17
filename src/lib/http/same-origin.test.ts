import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { SESSION_COOKIE_NAME } from "@/lib/auth/session-token";

import { validateWriteRequestOrigin } from "./same-origin";

const trustedOrigins = new Set(["https://app.example.test"]);

describe("same-origin write validation", () => {
  it("يسمح بالطلب من الأصل الموثوق", () => {
    const request = new NextRequest("https://app.example.test/api/action", {
      method: "POST",
      headers: {
        origin: "https://app.example.test",
        "sec-fetch-site": "same-origin",
      },
    });

    expect(validateWriteRequestOrigin(request, trustedOrigins)).toEqual({ allowed: true });
  });

  it("يرفض Origin غير الموثوق وSec-Fetch-Site عبر المواقع", () => {
    const crossOrigin = new NextRequest("https://app.example.test/api/action", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    });
    const crossSite = new NextRequest("https://app.example.test/api/action", {
      method: "POST",
      headers: {
        origin: "https://app.example.test",
        "sec-fetch-site": "cross-site",
      },
    });

    expect(validateWriteRequestOrigin(crossOrigin, trustedOrigins)).toEqual({
      allowed: false,
      reason: "UNTRUSTED_ORIGIN",
    });
    expect(validateWriteRequestOrigin(crossSite, trustedOrigins)).toEqual({
      allowed: false,
      reason: "CROSS_SITE",
    });
  });

  it("يسمح بطلب خادم بلا Origin عندما لا يحمل Cookie أو بيانات متصفح", () => {
    const request = new NextRequest("https://app.example.test/api/action", {
      method: "POST",
    });

    expect(validateWriteRequestOrigin(request, trustedOrigins)).toEqual({ allowed: true });
  });

  it("يرفض طلب متصفح أو جلسة بلا Origin أو Referer", () => {
    const withCookie = new NextRequest("https://app.example.test/api/action", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${"a".repeat(43)}` },
    });
    const browserMetadata = new NextRequest("https://app.example.test/api/action", {
      method: "POST",
      headers: { "sec-fetch-mode": "cors" },
    });

    expect(validateWriteRequestOrigin(withCookie, trustedOrigins)).toEqual({
      allowed: false,
      reason: "MISSING_BROWSER_ORIGIN",
    });
    expect(validateWriteRequestOrigin(browserMetadata, trustedOrigins)).toEqual({
      allowed: false,
      reason: "MISSING_BROWSER_ORIGIN",
    });
  });

  it("يقبل Referer موثوقًا ويرفض Host غير موثوق", () => {
    const referer = new NextRequest("https://app.example.test/api/action", {
      method: "PATCH",
      headers: { referer: "https://app.example.test/settings/security" },
    });
    const untrustedHost = new NextRequest("https://preview.example.test/api/action", {
      method: "DELETE",
      headers: { origin: "https://app.example.test" },
    });

    expect(validateWriteRequestOrigin(referer, trustedOrigins)).toEqual({ allowed: true });
    expect(validateWriteRequestOrigin(untrustedHost, trustedOrigins)).toEqual({
      allowed: false,
      reason: "UNTRUSTED_HOST",
    });
  });
});
