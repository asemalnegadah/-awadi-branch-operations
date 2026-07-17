import { describe, expect, it } from "vitest";

import { safeErrorMetadata } from "./safe-error";

describe("sanitized error metadata", () => {
  it("لا يسجل رسالة الخطأ أو الأسرار", () => {
    const metadata = safeErrorMetadata(
      new TypeError("postgresql://user:password@private-host/database token=secret"),
    );

    expect(metadata).toEqual({ errorType: "TypeError" });
    expect(JSON.stringify(metadata)).not.toContain("password");
    expect(JSON.stringify(metadata)).not.toContain("private-host");
    expect(JSON.stringify(metadata)).not.toContain("secret");
  });
});
