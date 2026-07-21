import type { AuthenticatedUser } from "@/lib/auth/types";
import { formatPromiseMoney } from "@/lib/promises/presentation";

import type {
  CreditDecisionState,
  CreditException,
  CreditRestriction,
  CreditRestrictionDecisionType,
  CreditRestrictionReasonCode,
  CreditRiskAction,
  CreditRiskLevel,
} from "./types";

const levelLabels: Readonly<Record<CreditRiskLevel, string>> = Object.freeze({
  LOW: "منخفض",
  MEDIUM: "متوسط",
  HIGH: "مرتفع",
  CRITICAL: "حرج",
});
const actionLabels: Readonly<Record<CreditRiskAction, string>> = Object.freeze({
  NONE: "لا إجراء",
  MONITOR: "مراقبة",
  LIMIT: "تحديد الآجل",
  BLOCK: "منع الآجل",
});
const stateLabels: Readonly<Record<CreditDecisionState, string>> = Object.freeze({
  DRAFT: "مسودة",
  PENDING_APPROVAL: "بانتظار الاعتماد",
  ACTIVE: "نافذ",
  REJECTED: "مرفوض",
  REVOKED: "ملغي",
  EXPIRED: "منتهي",
});
const decisionLabels: Readonly<Record<CreditRestrictionDecisionType, string>> = Object.freeze({
  LIMIT: "تحديد حد",
  SUSPEND: "تعليق الآجل",
  BLOCK: "منع كامل",
});
const reasonLabels: Readonly<Record<CreditRestrictionReasonCode, string>> = Object.freeze({
  OLD_DEBT: "دين قديم",
  BROKEN_PROMISE: "وعد مكسور",
  RECONCILIATION_DIFFERENCE: "فرق مطابقة",
  CLOSED_OR_BANKRUPT: "إغلاق أو إفلاس",
  DISPUTE: "نزاع",
  MISSING_CONTACT: "بيانات اتصال ناقصة",
  NO_VISIT: "عدم زيارة",
  UNHANDED_COLLECTION: "تحصيل غير مسلّم",
  CREDIT_LIMIT_EXCEEDED: "تجاوز الحد الائتماني",
  MANAGER_DECISION: "قرار مدير",
  OTHER: "سبب آخر",
});

export interface CreditRiskUiActions {
  readonly recalculate: boolean;
  readonly proposeRestriction: boolean;
  readonly submitRestriction: boolean;
  readonly approveRestriction: boolean;
  readonly rejectRestriction: boolean;
  readonly revokeRestriction: boolean;
  readonly proposeException: boolean;
  readonly submitException: boolean;
  readonly approveException: boolean;
  readonly rejectException: boolean;
  readonly revokeException: boolean;
}

export function creditRiskLevelLabel(level: CreditRiskLevel): string {
  return levelLabels[level];
}

export function creditRiskActionLabel(action: CreditRiskAction): string {
  return actionLabels[action];
}

export function creditDecisionStateLabel(state: CreditDecisionState): string {
  return stateLabels[state];
}

export function creditDecisionTypeLabel(type: CreditRestrictionDecisionType): string {
  return decisionLabels[type];
}

export function creditRestrictionReasonLabel(code: CreditRestrictionReasonCode): string {
  return reasonLabels[code];
}

export function formatCreditMoney(amountMinor: number, currency: "SR" | "RG"): string {
  return formatPromiseMoney(amountMinor, currency);
}

export function availableCreditRiskActions(
  actor: AuthenticatedUser,
  restriction: CreditRestriction | null,
  exception: CreditException | null,
): CreditRiskUiActions {
  const has = (permission: Parameters<AuthenticatedUser["permissions"]["has"]>[0]) =>
    actor.permissions.has(permission);
  return Object.freeze({
    recalculate: has("risk.recalculate"),
    proposeRestriction: has("credit_restrictions.propose") && restriction === null,
    submitRestriction:
      has("credit_restrictions.propose") && restriction?.state === "DRAFT",
    approveRestriction:
      has("credit_restrictions.approve") && restriction?.state === "PENDING_APPROVAL",
    rejectRestriction:
      has("credit_restrictions.approve") && restriction?.state === "PENDING_APPROVAL",
    revokeRestriction:
      has("credit_restrictions.revoke")
      && restriction?.state === "ACTIVE"
      && exception?.state !== "ACTIVE",
    proposeException:
      has("credit_exceptions.propose")
      && restriction?.state === "ACTIVE"
      && exception === null,
    submitException: has("credit_exceptions.propose") && exception?.state === "DRAFT",
    approveException:
      has("credit_exceptions.approve") && exception?.state === "PENDING_APPROVAL",
    rejectException:
      has("credit_exceptions.approve") && exception?.state === "PENDING_APPROVAL",
    revokeException: has("credit_exceptions.revoke") && exception?.state === "ACTIVE",
  });
}
