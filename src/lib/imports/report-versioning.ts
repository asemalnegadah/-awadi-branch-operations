export const reportVersionRelations = [
  "FIRST_SNAPSHOT",
  "NEWER_SNAPSHOT",
  "SAME_SNAPSHOT_DUPLICATE",
  "SAME_SNAPSHOT_CONFLICT",
  "HISTORICAL_BACKFILL",
  "DIFFERENT_SERIES",
  "OVERLAPPING_PERIOD",
] as const;

export type ReportVersionRelation = (typeof reportVersionRelations)[number];

export interface ReportVersionIdentity {
  readonly reportSeriesKey: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly asOfDate: string;
  readonly sha256: string;
}

export interface ReportVersionDecision {
  readonly relation: ReportVersionRelation;
  readonly mayBecomeCurrent: boolean;
  readonly requiresReview: boolean;
  readonly reason: string;
}

export function classifyReportVersion(
  incoming: ReportVersionIdentity,
  current: ReportVersionIdentity | null,
): ReportVersionDecision {
  assertIsoDate(incoming.periodStart, "incoming.periodStart");
  assertIsoDate(incoming.periodEnd, "incoming.periodEnd");
  assertIsoDate(incoming.asOfDate, "incoming.asOfDate");
  assertSha256(incoming.sha256);

  if (!current) {
    return freezeDecision(
      "FIRST_SNAPSHOT",
      true,
      false,
      "هذه أول نسخة معتمدة في سلسلة التقرير.",
    );
  }

  assertIsoDate(current.periodStart, "current.periodStart");
  assertIsoDate(current.periodEnd, "current.periodEnd");
  assertIsoDate(current.asOfDate, "current.asOfDate");
  assertSha256(current.sha256);

  if (incoming.reportSeriesKey !== current.reportSeriesKey) {
    return freezeDecision(
      "DIFFERENT_SERIES",
      false,
      true,
      "الملف لا يغطي السلسلة نفسها من حيث المندوب أو العملة أو بداية الفترة أو مخطط الأعمار.",
    );
  }

  if (
    incoming.periodStart === current.periodStart &&
    incoming.periodEnd === current.periodEnd &&
    incoming.asOfDate === current.asOfDate
  ) {
    if (incoming.sha256 === current.sha256) {
      return freezeDecision(
        "SAME_SNAPSHOT_DUPLICATE",
        false,
        false,
        "الملف نسخة مطابقة سبق تسجيلها.",
      );
    }

    return freezeDecision(
      "SAME_SNAPSHOT_CONFLICT",
      false,
      true,
      "يوجد ملفان مختلفان لنفس فترة البيانات وتاريخ القطع؛ يجب تحديد النسخة الصحيحة.",
    );
  }

  if (incoming.asOfDate > current.asOfDate) {
    if (incoming.periodStart === current.periodStart) {
      return freezeDecision(
        "NEWER_SNAPSHOT",
        true,
        false,
        "الملف امتداد أحدث للسلسلة نفسها وتاريخ نهايته أحدث.",
      );
    }

    if (incoming.periodStart <= current.periodEnd) {
      return freezeDecision(
        "OVERLAPPING_PERIOD",
        false,
        true,
        "الفترة أحدث لكنها تتداخل مع السلسلة الحالية ببداية مختلفة؛ يلزم التحقق من نطاق التقرير.",
      );
    }

    return freezeDecision(
      "DIFFERENT_SERIES",
      false,
      true,
      "الملف يبدأ بعد نهاية السلسلة الحالية ويجب تسجيله كسلسلة تقرير جديدة.",
    );
  }

  return freezeDecision(
    "HISTORICAL_BACKFILL",
    false,
    false,
    "الملف أقدم من النسخة الحالية ويستخدم للتحليل التاريخي ولا يستبدل مصدر الخطط.",
  );
}

function freezeDecision(
  relation: ReportVersionRelation,
  mayBecomeCurrent: boolean,
  requiresReview: boolean,
  reason: string,
): ReportVersionDecision {
  return Object.freeze({ relation, mayBecomeCurrent, requiresReview, reason });
}

function assertIsoDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${field} يجب أن يكون تاريخ ISO صالحًا.`);
  }
}

function assertSha256(value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("sha256 يجب أن يكون بصمة صغيرة الحروف من 64 خانة.");
  }
}
