import { describe, expect, it } from "vitest";

import { deriveAgingBucket } from "./debt-aging-row";
import { parseOnyxDebtAgingReportMetadata } from "./onyx-debt-aging-report";
import { classifyReportVersion } from "./report-versioning";

const syntheticOnyxText = `
أعمار الديون للعملاء
من تاريخ : ٠١/٠١/٢٠٢٦ إلى تاريخ : ٠٥/٠٧/٢٠٢٦
٠٥/٠٧/٢٠٢٦ ٠٢:٠١:٤٨ AM 4 / 1 تاريخ التقرير
رقم العميل اسم العميل المندوب العملة المبلغ 30 - 0 60 - 31 90 - 61 120 - 91 120 <
60016
اسم عميل مقطوع
RG
35
60017
اسم عميل آخر
SR
35
4 / 4
`;

describe("Onyx debt aging report metadata", () => {
  it("يستخرج الفترة وتاريخ القطع والمندوب والعملات والمخطط الفعلي", () => {
    const metadata = parseOnyxDebtAgingReportMetadata(syntheticOnyxText);

    expect(metadata.periodStart).toBe("2026-01-01");
    expect(metadata.periodEnd).toBe("2026-07-05");
    expect(metadata.asOfDate).toBe("2026-07-05");
    expect(metadata.generatedAt).toBe("2026-07-05T02:01:48+03:00");
    expect(metadata.declaredPageCount).toBe(4);
    expect(metadata.representativeCode).toBe("35");
    expect(metadata.currencies).toEqual(["SR", "RG"]);
    expect(metadata.agingScheme).toBe("ONYX_0_30_60_90_120");
    expect(metadata.reportSeriesKey).toContain("REP:35");
    expect(metadata.reportSeriesKey).toContain("START:2026-01-01");
  });

  it("يستخدم حدود 120 يومًا الخاصة بهذا التقرير", () => {
    expect(deriveAgingBucket(0, "ONYX_0_30_60_90_120")).toBe("DAYS_0_30");
    expect(deriveAgingBucket(120, "ONYX_0_30_60_90_120")).toBe(
      "DAYS_91_120",
    );
    expect(deriveAgingBucket(121, "ONYX_0_30_60_90_120")).toBe("OVER_120");
  });
});

describe("Debt aging report versioning", () => {
  const base = {
    reportSeriesKey:
      "ONYX|DEBT_AGING|REP:35|CUR:SR,RG|START:2026-01-01|SCHEME:ONYX_0_30_60_90_120",
    periodStart: "2026-01-01",
    periodEnd: "2026-07-05",
    asOfDate: "2026-07-05",
    sha256: "a".repeat(64),
  };

  it("يصنف نهاية أحدث مع البداية نفسها كنسخة أحدث", () => {
    const result = classifyReportVersion(
      {
        ...base,
        periodEnd: "2026-07-12",
        asOfDate: "2026-07-12",
        sha256: "b".repeat(64),
      },
      base,
    );

    expect(result.relation).toBe("NEWER_SNAPSHOT");
    expect(result.mayBecomeCurrent).toBe(true);
    expect(result.requiresReview).toBe(false);
  });

  it("لا يجعل الملف التاريخي مصدر الخطط الحالي", () => {
    const result = classifyReportVersion(
      {
        ...base,
        periodEnd: "2026-06-30",
        asOfDate: "2026-06-30",
        sha256: "c".repeat(64),
      },
      base,
    );

    expect(result.relation).toBe("HISTORICAL_BACKFILL");
    expect(result.mayBecomeCurrent).toBe(false);
  });

  it("يكشف تعارض ملفين مختلفين لنفس تاريخ القطع", () => {
    const result = classifyReportVersion(
      { ...base, sha256: "d".repeat(64) },
      base,
    );

    expect(result.relation).toBe("SAME_SNAPSHOT_CONFLICT");
    expect(result.requiresReview).toBe(true);
  });

  it("يكشف النسخة المكررة من البصمة نفسها", () => {
    const result = classifyReportVersion(base, base);

    expect(result.relation).toBe("SAME_SNAPSHOT_DUPLICATE");
    expect(result.requiresReview).toBe(false);
  });
});
