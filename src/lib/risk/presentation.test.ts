import { describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "@/lib/auth/types";

import { availableCreditRiskActions } from "./presentation";
import type { CreditException, CreditRestriction } from "./types";

const manager: AuthenticatedUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "risk.manager@example.test",
  fullName: "مدير اختبار المخاطر",
  roles: ["BRANCH_MANAGER"],
  permissions: new Set([
    "risk.read",
    "risk.recalculate",
    "risk.view_history",
    "credit_restrictions.propose",
    "credit_restrictions.approve",
    "credit_restrictions.revoke",
    "credit_exceptions.propose",
    "credit_exceptions.approve",
    "credit_exceptions.revoke",
    "credit_exceptions.consume",
  ]),
  operatingMode: "SINGLE_MANAGER",
  mustChangePassword: false,
};

function restriction(state: CreditRestriction["state"]): CreditRestriction {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    customerId: "20000000-0000-4000-8000-000000000001",
    customerAccountId: "30000000-0000-4000-8000-000000000001",
    customerName: "عميل اختبار",
    customerNumber: "R-1",
    currencyCode: "SR",
    decisionType: "BLOCK",
    limitAmountMinor: null,
    state,
    reasonCode: "OLD_DEBT",
    reasonText: "دين قديم",
    sourceAssessmentId: null,
    effectiveFrom: "2026-07-21T00:00:00.000Z",
    reviewDueAt: null,
    expiresAt: null,
    restorationConditions: "السداد",
    proposedBy: manager.id,
    proposedByName: manager.fullName,
    proposedAt: "2026-07-21T00:00:00.000Z",
    submittedBy: state === "DRAFT" ? null : manager.id,
    submittedAt: state === "DRAFT" ? null : "2026-07-21T00:01:00.000Z",
    approvedBy: state === "ACTIVE" ? manager.id : null,
    approvedAt: state === "ACTIVE" ? "2026-07-21T00:02:00.000Z" : null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    revokedBy: null,
    revokedAt: null,
    revocationReason: null,
    version: 1,
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
  };
}

function exception(state: CreditException["state"]): CreditException {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    restrictionId: "10000000-0000-4000-8000-000000000001",
    customerId: "20000000-0000-4000-8000-000000000001",
    customerAccountId: "30000000-0000-4000-8000-000000000001",
    customerName: "عميل اختبار",
    currencyCode: "SR",
    scope: "SINGLE_TRANSACTION",
    maxAmountMinor: 1000,
    validFrom: "2026-07-21T00:00:00.000Z",
    validUntil: "2026-07-22T00:00:00.000Z",
    state,
    reason: "استثناء",
    conditions: "عملية واحدة",
    proposedBy: manager.id,
    proposedByName: manager.fullName,
    proposedAt: "2026-07-21T00:00:00.000Z",
    submittedBy: state === "DRAFT" ? null : manager.id,
    submittedAt: state === "DRAFT" ? null : "2026-07-21T00:01:00.000Z",
    approvedBy: state === "ACTIVE" ? manager.id : null,
    approvedAt: state === "ACTIVE" ? "2026-07-21T00:02:00.000Z" : null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    revokedBy: null,
    revokedAt: null,
    revocationReason: null,
    version: 1,
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
  };
}

describe("credit risk action gating", () => {
  it("يسمح بإنشاء قرار عند عدم وجود قرار مفتوح", () => {
    const actions = availableCreditRiskActions(manager, null, null);
    expect(actions.recalculate).toBe(true);
    expect(actions.proposeRestriction).toBe(true);
    expect(actions.approveRestriction).toBe(false);
  });

  it("يعرض الإرسال للمسودة والاعتماد للحالة المعلقة", () => {
    expect(availableCreditRiskActions(manager, restriction("DRAFT"), null).submitRestriction).toBe(true);
    const pending = availableCreditRiskActions(manager, restriction("PENDING_APPROVAL"), null);
    expect(pending.approveRestriction).toBe(true);
    expect(pending.rejectRestriction).toBe(true);
  });

  it("يمنع إلغاء القرار الأب أثناء وجود استثناء نافذ", () => {
    const actions = availableCreditRiskActions(
      manager,
      restriction("ACTIVE"),
      exception("ACTIVE"),
    );
    expect(actions.revokeRestriction).toBe(false);
    expect(actions.revokeException).toBe(true);
  });

  it("لا يمنح مدير النظام أزرار أعمال دون صلاحيات صريحة", () => {
    const systemAdmin: AuthenticatedUser = {
      ...manager,
      roles: ["SYSTEM_ADMIN"],
      permissions: new Set(["dashboard.read", "users.manage"]),
    };
    expect(Object.values(availableCreditRiskActions(systemAdmin, null, null)).every((value) => !value)).toBe(true);
  });
});
