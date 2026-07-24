import { describe, expect, it } from "vitest";

import {
  parseCashClosingIdempotencyKey,
  parseCashClosingListFilters,
  parseCashClosingTransitionInput,
  parseCreateCashClosingInput,
  parseCreateCashHandoverInput,
  parseReviseCashClosingInput,
} from "./validation";

const representativeId = "11111111-1111-4111-8111-111111111111";
const receiverId = "22222222-2222-4222-8222-222222222222";

describe("cash closing validation", () => {
  it("accepts a timezone-aware partial handover", () => {
    expect(parseCreateCashHandoverInput({
      representativeId,
      currencyCode: "SR",
      amountMinor: 12_500,
      handedOverAt: "2026-07-24T17:00:00+03:00",
      receivedBy: receiverId,
      reference: "HANDOVER-2026-07-24-001",
      note: "تسليم جزئي للحسابات.",
    })).toEqual({
      representativeId,
      currencyCode: "SR",
      amountMinor: 12_500,
      handedOverAt: "2026-07-24T17:00:00+03:00",
      receivedBy: receiverId,
      reference: "HANDOVER-2026-07-24-001",
      note: "تسليم جزئي للحسابات.",
    });
  });

  it("rejects non-positive handovers and datetimes without an offset", () => {
    expect(() => parseCreateCashHandoverInput({
      representativeId,
      currencyCode: "SR",
      amountMinor: 0,
      handedOverAt: "2026-07-24T17:00:00",
      receivedBy: receiverId,
      reference: "H-1",
    })).toThrow();
  });

  it("keeps SR and RG as the only accepted currencies", () => {
    expect(() => parseCreateCashClosingInput({
      representativeId,
      businessDate: "2026-07-24",
      currencyCode: "USD",
      declaredCashMinor: 0,
    })).toThrow();
  });

  it("accepts zero declared cash and a documented variance reason", () => {
    expect(parseCreateCashClosingInput({
      representativeId,
      businessDate: "2026-07-24",
      currencyCode: "RG",
      declaredCashMinor: 0,
      varianceReason: "لم يستلم المندوب أي نقدية في هذا اليوم.",
    })).toMatchObject({ currencyCode: "RG", declaredCashMinor: 0 });
  });

  it("requires positive optimistic versions for revisions and transitions", () => {
    expect(() => parseReviseCashClosingInput({
      version: 0,
      declaredCashMinor: 100,
    })).toThrow();
    expect(() => parseCashClosingTransitionInput({ version: -1 })).toThrow();
  });

  it("rejects additional command fields", () => {
    expect(() => parseCashClosingTransitionInput({
      version: 1,
      state: "APPROVED",
    })).toThrow();
  });

  it("normalizes list filters without accepting unknown query fields", () => {
    const filters = parseCashClosingListFilters(new URLSearchParams({
      representative: representativeId,
      currency: "SR",
      state: "PENDING_REVIEW",
      date: "2026-07-24",
      limit: "25",
    }));
    expect(filters).toEqual({
      representativeId,
      currencyCode: "SR",
      state: "PENDING_REVIEW",
      businessDate: "2026-07-24",
      limit: 25,
      cursor: undefined,
    });
  });

  it("requires a safe structured idempotency key", () => {
    expect(parseCashClosingIdempotencyKey("cash-closing:2026-07-24/1")).toBe(
      "cash-closing:2026-07-24/1",
    );
    expect(() => parseCashClosingIdempotencyKey("short")).toThrow();
    expect(() => parseCashClosingIdempotencyKey("invalid key with spaces")).toThrow();
  });
});
