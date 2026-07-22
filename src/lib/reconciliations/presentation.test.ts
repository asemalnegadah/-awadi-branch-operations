import { describe, expect, it } from "vitest";

import {
  formatReconciliationMoney,
  reconciliationReasonLabel,
  reconciliationStateLabel,
} from "./presentation";

describe("reconciliation presentation", () => {
  it("formats positive and negative minor units without mixing currencies", () => {
    expect(formatReconciliationMoney(123_456, "SR")).toBe("1,234.56 SR");
    expect(formatReconciliationMoney(-7_050, "RG")).toBe("−70.50 RG");
  });

  it("labels terminal and classified states in Arabic", () => {
    expect(reconciliationStateLabel("MATCHED")).toBe("مطابقة بلا فرق");
    expect(reconciliationStateLabel("SETTLED")).toBe("تمت التسوية");
    expect(reconciliationReasonLabel("CUSTODY_VARIANCE")).toBe("فرق عهدة");
  });

  it("rejects unsafe integers", () => {
    expect(() => formatReconciliationMoney(Number.MAX_SAFE_INTEGER + 1, "SR")).toThrow();
  });
});
