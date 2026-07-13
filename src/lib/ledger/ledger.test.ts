import { describe, expect, it } from "vitest";

import { money } from "@/lib/domain/money";

import {
  calculateLedgerBalance,
  createPostedLedgerEntry,
  createReversalEntry,
  validateAllocationTotal,
} from "./ledger";
import type { PostedLedgerEntry } from "./types";

const userId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";

function entry(
  overrides: Partial<PostedLedgerEntry> = {},
): PostedLedgerEntry {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    customerId,
    customerAccountId: accountId,
    amount: money("SR", 10_000),
    direction: "DEBIT",
    entryType: "INVOICE",
    accountingDate: "2026-07-13",
    postedAt: "2026-07-13T12:00:00.000Z",
    postedBy: userId,
    sourceType: "INVOICE",
    sourceId: "INV-001",
    idempotencyKey: "ledger-entry-001",
    ...overrides,
  };
}

describe("Financial ledger", () => {
  it("ينشئ حركة مرحلة بمبلغ موجب", () => {
    const result = createPostedLedgerEntry({
      ...entry(),
      entryType: "INVOICE",
    });

    expect(result.amount.minorUnits).toBe(10_000);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("يرفض مبلغًا صفريًا أو سالبًا", () => {
    expect(() =>
      createPostedLedgerEntry({
        ...entry(),
        amount: money("SR", 0),
        entryType: "INVOICE",
      }),
    ).toThrow("عددًا صحيحًا موجبًا");
  });

  it("يحسب الرصيد من المدين ناقص الدائن", () => {
    const result = calculateLedgerBalance(
      [
        entry({ amount: money("SR", 10_000), direction: "DEBIT" }),
        entry({
          id: "55555555-5555-4555-8555-555555555555",
          amount: money("SR", 3_000),
          direction: "CREDIT",
          entryType: "COLLECTION",
          sourceType: "COLLECTION",
          sourceId: "COL-001",
          idempotencyKey: "ledger-entry-002",
        }),
      ],
      "SR",
    );

    expect(result).toEqual({ currency: "SR", minorUnits: 7_000 });
  });

  it("يرفض حساب رصيد يخلط SR وRG", () => {
    expect(() =>
      calculateLedgerBalance(
        [entry(), entry({ amount: money("RG", 100) })],
        "SR",
      ),
    ).toThrow("لا يمكن حساب رصيد SR باستخدام حركة RG");
  });

  it("ينشئ حركة عكسية مساوية ومعاكسة", () => {
    const original = entry();
    const reversal = createReversalEntry({
      id: "66666666-6666-4666-8666-666666666666",
      original,
      postedAt: "2026-07-14T09:00:00.000Z",
      postedBy: userId,
      sourceType: "REVERSAL_REQUEST",
      sourceId: "REV-001",
      idempotencyKey: "ledger-reversal-001",
      reason: "تصحيح فاتورة مدخلة بالخطأ",
    });

    expect(reversal.direction).toBe("CREDIT");
    expect(reversal.amount).toEqual(original.amount);
    expect(reversal.reversalOfEntryId).toBe(original.id);
    expect(calculateLedgerBalance([original, reversal], "SR").minorUnits).toBe(0);
  });

  it("يرفض عكس حركة عكسية", () => {
    const reversal = entry({
      entryType: "REVERSAL",
      reversalOfEntryId: "77777777-7777-4777-8777-777777777777",
    });

    expect(() =>
      createReversalEntry({
        id: "88888888-8888-4888-8888-888888888888",
        original: reversal,
        postedAt: "2026-07-14T09:00:00.000Z",
        postedBy: userId,
        sourceType: "REVERSAL_REQUEST",
        sourceId: "REV-002",
        idempotencyKey: "ledger-reversal-002",
        reason: "محاولة غير صحيحة",
      }),
    ).toThrow("لا يمكن عكس حركة عكسية مباشرة");
  });

  it("يتحقق من التخصيص دون تجاوز المبلغ", () => {
    const allocated = validateAllocationTotal(money("SR", 10_000), [
      money("SR", 4_000),
      money("SR", 5_000),
    ]);

    expect(allocated.minorUnits).toBe(9_000);
  });

  it("يرفض تخصيصًا بعملة مختلفة أو أكبر من المتاح", () => {
    expect(() =>
      validateAllocationTotal(money("SR", 10_000), [money("RG", 1_000)]),
    ).toThrow("بعملة مختلفة");

    expect(() =>
      validateAllocationTotal(money("SR", 10_000), [money("SR", 10_001)]),
    ).toThrow("يتجاوز المبلغ المتاح");
  });
});
