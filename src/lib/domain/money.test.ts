import { describe, expect, it } from "vitest";

import { addMoney, isZero, money, subtractMoney } from "./money";

describe("Money", () => {
  it("يجمع مبالغ من العملة نفسها", () => {
    const result = addMoney(money("SR", 1250), money("SR", 750));

    expect(result).toEqual({ currency: "SR", minorUnits: 2000 });
  });

  it("يطرح مبالغ من العملة نفسها", () => {
    const result = subtractMoney(money("RG", 5000), money("RG", 1250));

    expect(result).toEqual({ currency: "RG", minorUnits: 3750 });
  });

  it("يرفض جمع عملتين مختلفتين", () => {
    expect(() => addMoney(money("SR", 100), money("RG", 100))).toThrow(
      "لا يمكن جمع مبالغ بعملتين مختلفتين.",
    );
  });

  it("يرفض طرح عملتين مختلفتين", () => {
    expect(() => subtractMoney(money("SR", 100), money("RG", 100))).toThrow(
      "لا يمكن طرح مبالغ بعملتين مختلفتين.",
    );
  });

  it("يتحقق من الصفر دون تغيير العملة", () => {
    expect(isZero(money("SR", 0))).toBe(true);
    expect(isZero(money("RG", 1))).toBe(false);
  });

  it("يرفض مبلغًا غير صحيح", () => {
    expect(() => money("SR", 1.5)).toThrow();
  });
});
