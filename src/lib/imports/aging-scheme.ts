export const agingBucketCodes = [
  "NOT_DUE",
  "DAYS_0_30",
  "DAYS_31_60",
  "DAYS_61_90",
  "DAYS_91_120",
  "OVER_120",
  "DAYS_91_180",
  "OVER_180",
  "UNKNOWN",
] as const;

export type AgingBucketCode = (typeof agingBucketCodes)[number];

export const agingSchemeCodes = [
  "ONYX_0_30_60_90_120",
  "STANDARD_0_30_60_90_180",
] as const;

export type AgingSchemeCode = (typeof agingSchemeCodes)[number];

export interface AgingBucketDefinition {
  readonly code: AgingBucketCode;
  readonly minimumDays: number | null;
  readonly maximumDays: number | null;
  readonly sourceLabels: readonly string[];
}

export interface AgingScheme {
  readonly code: AgingSchemeCode;
  readonly buckets: readonly AgingBucketDefinition[];
}

export const onyx120DayAgingScheme: AgingScheme = Object.freeze({
  code: "ONYX_0_30_60_90_120",
  buckets: Object.freeze([
    Object.freeze({
      code: "NOT_DUE",
      minimumDays: null,
      maximumDays: -1,
      sourceLabels: Object.freeze(["غير مستحق"]),
    }),
    Object.freeze({
      code: "DAYS_0_30",
      minimumDays: 0,
      maximumDays: 30,
      sourceLabels: Object.freeze(["0 - 30", "0-30", "30 - 0"]),
    }),
    Object.freeze({
      code: "DAYS_31_60",
      minimumDays: 31,
      maximumDays: 60,
      sourceLabels: Object.freeze(["31 - 60", "31-60", "60 - 31"]),
    }),
    Object.freeze({
      code: "DAYS_61_90",
      minimumDays: 61,
      maximumDays: 90,
      sourceLabels: Object.freeze(["61 - 90", "61-90", "90 - 61"]),
    }),
    Object.freeze({
      code: "DAYS_91_120",
      minimumDays: 91,
      maximumDays: 120,
      sourceLabels: Object.freeze(["91 - 120", "91-120", "120 - 91"]),
    }),
    Object.freeze({
      code: "OVER_120",
      minimumDays: 121,
      maximumDays: null,
      sourceLabels: Object.freeze(["> 120", "120 <", "اكثر من 120"]),
    }),
  ]),
});

export const standard180DayAgingScheme: AgingScheme = Object.freeze({
  code: "STANDARD_0_30_60_90_180",
  buckets: Object.freeze([
    Object.freeze({
      code: "NOT_DUE",
      minimumDays: null,
      maximumDays: -1,
      sourceLabels: Object.freeze(["غير مستحق"]),
    }),
    Object.freeze({
      code: "DAYS_0_30",
      minimumDays: 0,
      maximumDays: 30,
      sourceLabels: Object.freeze(["0 - 30", "0-30", "30 - 0"]),
    }),
    Object.freeze({
      code: "DAYS_31_60",
      minimumDays: 31,
      maximumDays: 60,
      sourceLabels: Object.freeze(["31 - 60", "31-60", "60 - 31"]),
    }),
    Object.freeze({
      code: "DAYS_61_90",
      minimumDays: 61,
      maximumDays: 90,
      sourceLabels: Object.freeze(["61 - 90", "61-90", "90 - 61"]),
    }),
    Object.freeze({
      code: "DAYS_91_180",
      minimumDays: 91,
      maximumDays: 180,
      sourceLabels: Object.freeze(["91 - 180", "91-180", "180 - 91"]),
    }),
    Object.freeze({
      code: "OVER_180",
      minimumDays: 181,
      maximumDays: null,
      sourceLabels: Object.freeze(["> 180", "180 <", "اكثر من 180"]),
    }),
  ]),
});

export function getAgingScheme(code: AgingSchemeCode): AgingScheme {
  return code === "ONYX_0_30_60_90_120"
    ? onyx120DayAgingScheme
    : standard180DayAgingScheme;
}

export function deriveAgingBucketForScheme(
  ageDays: number | undefined,
  schemeCode: AgingSchemeCode,
): AgingBucketCode {
  if (ageDays === undefined) {
    return "UNKNOWN";
  }

  const bucket = getAgingScheme(schemeCode).buckets.find((definition) => {
    const minimumMatches =
      definition.minimumDays === null || ageDays >= definition.minimumDays;
    const maximumMatches =
      definition.maximumDays === null || ageDays <= definition.maximumDays;
    return minimumMatches && maximumMatches;
  });

  return bucket?.code ?? "UNKNOWN";
}

export function parseAgingBucketForScheme(
  rawLabel: string | undefined,
  schemeCode: AgingSchemeCode,
): AgingBucketCode {
  if (!rawLabel?.trim()) {
    return "UNKNOWN";
  }

  const normalized = normalizeLabel(rawLabel);
  const bucket = getAgingScheme(schemeCode).buckets.find((definition) =>
    definition.sourceLabels.some(
      (label) => normalizeLabel(label) === normalized,
    ),
  );

  return bucket?.code ?? "UNKNOWN";
}

function normalizeLabel(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
