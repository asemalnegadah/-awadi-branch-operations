import { describe, expect, it } from "vitest";

import {
  assertCollectionTransition,
  canTransitionCollection,
  isTerminalCollectionState,
} from "./state-machine";

describe("Collection state machine", () => {
  it("يسمح بإرسال المسودة للمراجعة", () => {
    expect(canTransitionCollection("DRAFT", "SUBMITTED")).toBe(true);
  });

  it("يرفض اعتماد المسودة مباشرة", () => {
    expect(canTransitionCollection("DRAFT", "APPROVED")).toBe(false);
    expect(() => assertCollectionTransition("DRAFT", "APPROVED")).toThrow(
      "انتقال حالة التحصيل غير مسموح",
    );
  });

  it("يسمح بإعادة التحصيل للمندوب ثم إعادة إرساله", () => {
    expect(canTransitionCollection("SUBMITTED", "RETURNED")).toBe(true);
    expect(canTransitionCollection("RETURNED", "SUBMITTED")).toBe(true);
  });

  it("لا يغلق التحصيل قبل استلام النقدية والمطابقة", () => {
    expect(canTransitionCollection("APPROVED", "CLOSED")).toBe(false);
    expect(canTransitionCollection("CASH_RECEIVED", "CLOSED")).toBe(false);
    expect(canTransitionCollection("RECONCILED", "CLOSED")).toBe(true);
  });

  it("يسمح بالعكس بعد الاعتماد أو الإغلاق", () => {
    expect(canTransitionCollection("APPROVED", "REVERSED")).toBe(true);
    expect(canTransitionCollection("CLOSED", "REVERSED")).toBe(true);
  });

  it("يعتبر الرفض والعكس حالات نهائية", () => {
    expect(isTerminalCollectionState("REJECTED")).toBe(true);
    expect(isTerminalCollectionState("REVERSED")).toBe(true);
    expect(isTerminalCollectionState("DRAFT")).toBe(false);
  });
});
