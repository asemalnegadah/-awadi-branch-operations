import { describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "@/lib/auth/types";

import { availablePromiseActions, formatPromiseMoney, promiseStatusLabel } from "./presentation";

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

  it("يعرض العملات منفصلة دون تحويل أو جمع", () => {
    expect(formatPromiseMoney(1500, "SR")).toContain("SR");
    expect(formatPromiseMoney(1500, "RG")).toContain("RG");
    expect(promiseStatusLabel("PARTIALLY_FULFILLED")).toBe("منفذ جزئيًا");
  });
});
