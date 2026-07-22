import { describe, expect, it } from "vitest";

import {
  parseCreateFieldVisit,
  parseFieldVisitLocation,
  parseFieldVisitOutcome,
  parsePlanItemResult,
} from "./validation";
import {
  fieldVisitResultLabel,
  fieldVisitStateLabel,
  planItemResultLabel,
} from "./presentation";

const customerId = "11111111-1111-4111-8111-111111111111";
const planId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
const representativeId = "44444444-4444-4444-8444-444444444444";

describe("field visit validation", () => {
  it("accepts a planned visit only with a complete plan link", () => {
    expect(parseCreateFieldVisit({
      customerId,
      planId,
      planItemId: itemId,
      visitType: "COLLECTION",
      objective: "تحصيل المبلغ المستهدف.",
    })).toMatchObject({ planId, planItemId: itemId });

    expect(() => parseCreateFieldVisit({
      customerId,
      planId,
      visitType: "COLLECTION",
      objective: "تحصيل.",
    })).toThrow("يجب إرسال معرف الخطة وعنصرها معًا");
  });

  it("accepts representative assignment only for out-of-plan visits", () => {
    expect(parseCreateFieldVisit({
      customerId,
      representativeId,
      visitType: "PROBLEM_RESOLUTION",
      objective: "معالجة مشكلة طارئة.",
      outOfPlanReason: "تكليف مدير الفرع.",
    })).toMatchObject({ representativeId });

    expect(() => parseCreateFieldVisit({
      customerId,
      representativeId,
      planId,
      planItemId: itemId,
      visitType: "COLLECTION",
      objective: "تحصيل المبلغ المستهدف.",
    })).toThrow("مندوب الزيارة المرتبطة بالخطة يُستخرج من عنصر الخطة");
  });

  it("requires a documented reason for an out-of-plan visit", () => {
    expect(() => parseCreateFieldVisit({
      customerId,
      visitType: "PROBLEM_RESOLUTION",
      objective: "معالجة مشكلة طارئة.",
    })).toThrow("سبب الزيارة خارج الخطة مطلوب");
  });

  it("requires latitude and longitude together", () => {
    expect(() => parseFieldVisitLocation({ latitude: 12.8 })).toThrow(
      "خطا الطول والعرض يجب أن يرسلا معًا",
    );
  });

  it("requires matching references for collection and promise outcomes", () => {
    expect(() => parseFieldVisitOutcome({
      outcomeType: "COLLECTION",
      summary: "تحصيل موثق.",
    })).toThrow("معرف التحصيل مطلوب");

    expect(() => parseFieldVisitOutcome({
      outcomeType: "NO_RESULT",
      summary: "لم يوجد المسؤول.",
      currencyCode: "SR",
      amountMinor: 100,
    })).toThrow("نتيجة عدم الإنجاز لا تقبل مبلغًا أو مرجعًا");
  });

  it("requires a visit for visited results and a next action for rescheduling", () => {
    expect(() => parsePlanItemResult({
      planItemId: itemId,
      resultType: "VISITED_SUCCESS",
      reason: "نجحت الزيارة.",
    })).toThrow("النتيجة الميدانية تتطلب زيارة مرتبطة");

    expect(() => parsePlanItemResult({
      planItemId: itemId,
      resultType: "RESCHEDULED",
      reason: "أعيدت الجدولة.",
    })).toThrow("الإجراء التالي مطلوب");
  });
});

describe("field visit presentation", () => {
  it("provides Arabic labels for governed states and results", () => {
    expect(fieldVisitStateLabel("RETURNED")).toBe("معادة للاستكمال");
    expect(fieldVisitResultLabel("NO_CONTACT")).toBe("تعذر التواصل");
    expect(planItemResultLabel("VISITED_SUCCESS")).toBe("زيارة ناجحة");
  });
});
