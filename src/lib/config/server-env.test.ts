import { describe, expect, it } from "vitest";

import { getAuthEnv } from "./server-env";

const baseEnvironment = {
  AUTH_SECRET: "a".repeat(32),
  APP_BASE_URL: "https://app.example.test",
  TRUSTED_ORIGINS: "https://admin.example.test, https://app.example.test",
} as unknown as NodeJS.ProcessEnv;

describe("authentication environment validation", () => {
  it("يبني قائمة الأصول الموثوقة من APP_BASE_URL والقائمة الإضافية", () => {
    const environment = getAuthEnv(baseEnvironment);

    expect([...environment.TRUSTED_ORIGIN_SET].sort()).toEqual([
      "https://admin.example.test",
      "https://app.example.test",
    ]);
  });

  it("يرفض HTTP في الإنتاج والمسارات داخل APP_BASE_URL", () => {
    expect(() =>
      getAuthEnv({ ...baseEnvironment, APP_BASE_URL: "http://app.example.test", NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/HTTPS/);
    expect(() =>
      getAuthEnv({ ...baseEnvironment, APP_BASE_URL: "https://app.example.test/login" } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/origins only/);
  });
});
