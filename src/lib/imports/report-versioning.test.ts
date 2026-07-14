import { describe, expect, it } from "vitest";

import { classifyReportVersion } from "./report-versioning";

const validIdentity = {
  reportSeriesKey:
    "ONYX|DEBT_AGING|REP:35|CUR:SR,RG|START:2026-01-01|SCHEME:ONYX_0_30_60_90_120",
  periodStart: "2026-01-01",
  periodEnd: "2026-07-05",
  asOfDate: "2026-07-05",
  sha256: "a".repeat(64),
};

describe("Report version identity validation", () => {
  it("يرفض تاريخًا شكليًا صحيحًا لكنه غير موجود", () => {
    expect(() =>
      classifyReportVersion(
        {
          ...validIdentity,
          periodEnd: "2026-02-31",
          asOfDate: "2026-02-31",
        },
        null,
      ),
    ).toThrow("incoming.periodEnd يجب أن يكون تاريخ ISO صالحًا.");
  });

  it("يرفض بداية فترة بعد نهايتها", () => {
    expect(() =>
      classifyReportVersion(
        {
          ...validIdentity,
          periodStart: "2026-08-01",
        },
        null,
      ),
    ).toThrow("incoming.periodStart لا يجوز أن يكون بعد periodEnd.");
  });

  it("يرفض تاريخ قطع لا يساوي نهاية التقرير", () => {
    expect(() =>
      classifyReportVersion(
        {
          ...validIdentity,
          asOfDate: "2026-07-04",
        },
        null,
      ),
    ).toThrow("incoming.asOfDate يجب أن يساوي periodEnd لهذا التقرير.");
  });

  it("يقبل الهوية الصحيحة", () => {
    expect(classifyReportVersion(validIdentity, null)).toMatchObject({
      relation: "FIRST_SNAPSHOT",
      mayBecomeCurrent: true,
      requiresReview: false,
    });
  });
});
