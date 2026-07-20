import { describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "@/lib/auth/types";

import {
  availablePromiseActions,
  formatPromiseMinorForInput,
  formatPromiseMoney,
  parsePromiseMajorAmountToMinor,
  promiseStatusLabel,
} from "./presentation";

function user(permissions: AuthenticatedUser["permissions"]): AuthenticatedUser {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    email: "ui@example.test",
    fullName: "مستخدم واجهة",
    roles: ["BRANCH_MANAGER"],
    permissions,
    operatingMode: "SINGLE_MANAGER",
    mustChangePassword: false,
  };
}

describe("payment promises UI behavior", () => {
  it("لا يعرض إجراءات لا يملكها المستخدم", () => {
    const actions = availablePromiseActions(user(new Set(["promises.read"])), {
      baseStatus: "NEW",
    });
    expect(actions).toMatchObject({
      update: false,
      followUp: false,
      allocate: false,
      reverse: false,
    });
  });

  it("يفصل صلاحية عكس الربط عن التخصيص", () => {
    const actions = availablePromiseActions(
      user(new Set(["promises.reverse_allocation"])),
      { baseStatus: "FULFILLED" },
    );
    expect(actions.reverse).toBe(true);
    expect(actions.allocate).toBe(false);
    expect(actions.update).toBe(false);
  });

  it("يخفي الرفض والإلغاء بعد التنفيذ الجزئي", () => {
    const actions = availablePromiseActions(
      user(new Set(["promises.reject", "promises.cancel", "promises.reverse_allocation"])),
      { baseStatus: "PARTIALLY_FULFILLED" },
    );
    expect(actions.reject).toBe(false);
    expect(actions.cancel).toBe(false);
    expect(actions.reverse).toBe(true);
  });

  it("يحوّل الوحدات الصغرى إلى قيمة مالية بمنزلتين عشريتين", () => {
    const expected = new Intl.NumberFormat("ar-YE", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(15);
    expect(formatPromiseMoney(1500, "SR")).toBe(`${expected} SR`);
    expect(formatPromiseMoney(1500, "RG")).toBe(`${expected} RG`);
    expect(formatPromiseMinorForInput(1500)).toBe("15.00");
    expect(promiseStatusLabel("PARTIALLY_FULFILLED")).toBe("منفذ جزئيًا");
  });

  it("يحوّل إدخال المستخدم بالوحدة الرئيسية إلى وحدات صغرى بدقة", () => {
    expect(parsePromiseMajorAmountToMinor("15")).toBe(1500);
    expect(parsePromiseMajorAmountToMinor("15.7")).toBe(1570);
    expect(parsePromiseMajorAmountToMinor("15.07")).toBe(1507);
    expect(parsePromiseMajorAmountToMinor("0.01")).toBe(1);
    expect(() => parsePromiseMajorAmountToMinor("15.001")).toThrow();
    expect(() => parsePromiseMajorAmountToMinor("0")).toThrow();
  });
});
