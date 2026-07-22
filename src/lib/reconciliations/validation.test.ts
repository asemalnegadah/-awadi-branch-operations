import { describe, expect, it } from "vitest";

import {
  parseCreateReconciliationInput,
  parseReconciliationIdempotencyKey,
  parseReconciliationTransitionInput,
} from "./validation";

describe("reconciliation validation", () => {
  const validCreate = {
    customerAccountId: "11111111-1111-4111-8111-111111111111",
    sourceKind: "LEDGER_TO_STATEMENT" as const,
    sourceType: "ONYX_STATEMENT",
    sourceId: "STATEMENT-2026-07-22",
    cutoffDate: "2026-07-22",
    expectedAmountMinor: 100_000,
    observedAmountMinor: 105_000,
  };

  it("accepts signed, safe minor-unit amounts and derives no client difference", () => {
    const parsed = parseCreateReconciliationInput({
      ...validCreate,
      expectedAmountMinor: -2_500,
      observedAmountMinor: 1_250,
    });
    expect(parsed.expectedAmountMinor).toBe(-2_500);
    expect("differenceAmountMinor" in parsed).toBe(false);
  });

  it("rejects unsafe financial integers", () => {
    expect(() => parseCreateReconciliationInput({
      ...validCreate,
      observedAmountMinor: Number.MAX_SAFE_INTEGER + 1,
    })).toThrow();
  });

  it("rejects impossible calendar dates", () => {
    expect(() => parseCreateReconciliationInput({
      ...validCreate,
      cutoffDate: "2026-02-30",
    })).toThrow();
  });

  it("requires reason code and text together", () => {
    expect(() => parseCreateReconciliationInput({
      ...validCreate,
      reasonCode: "WRONG_AMOUNT",
    })).toThrow("رمز السبب ووصفه يجب أن يرسلا معًا");
  });

  it("requires a classified reason pair during review", () => {
    expect(() => parseReconciliationTransitionInput({
      version: 2,
      reasonCode: "WRONG_AMOUNT",
    })).toThrow("تصنيف الفرق ووصفه يجب أن يرسلا معًا");
  });

  it("accepts a documented transition", () => {
    expect(parseReconciliationTransitionInput({
      version: 3,
      reason: "تمت مراجعة المستند الأصلي.",
      reasonCode: "TIMING_DIFFERENCE",
      reasonText: "الحركة مثبتة في اليوم التالي لتاريخ القطع.",
    })).toEqual({
      version: 3,
      reason: "تمت مراجعة المستند الأصلي.",
      reasonCode: "TIMING_DIFFERENCE",
      reasonText: "الحركة مثبتة في اليوم التالي لتاريخ القطع.",
    });
  });

  it("accepts only bounded idempotency keys", () => {
    expect(parseReconciliationIdempotencyKey("reconciliation:submit:001")).toBe(
      "reconciliation:submit:001",
    );
    expect(() => parseReconciliationIdempotencyKey("short")).toThrow();
    expect(() => parseReconciliationIdempotencyKey("bad key with spaces")).toThrow();
  });
});
