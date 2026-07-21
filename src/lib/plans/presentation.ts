import type { AuthenticatedUser } from "@/lib/auth/types";
import { formatPromiseMoney } from "@/lib/promises/presentation";

import type {
  DailyPlan,
  DailyPlanPriorityLevel,
  DailyPlanState,
  DailyPlanTaskType,
} from "./types";

const stateLabels: Readonly<Record<DailyPlanState, string>> = Object.freeze({
  DRAFT: "مسودة",
  PENDING_APPROVAL: "بانتظار الاعتماد",
  APPROVED: "معتمدة",
  REJECTED: "مرفوضة",
  IN_PROGRESS: "قيد التنفيذ",
  COMPLETED: "مكتملة",
  CANCELLED: "ملغاة",
});

const taskLabels: Readonly<Record<DailyPlanTaskType, string>> = Object.freeze({
  COLLECTION: "تحصيل",
  PROMISE_FOLLOWUP: "متابعة وعد",
  RECONCILIATION: "مطابقة",
  SALES: "بيع",
  DATA_UPDATE: "تحديث بيانات",
  PROBLEM_RESOLUTION: "حل مشكلة",
  MIXED: "مهمة مركبة",
});

const priorityLabels: Readonly<Record<DailyPlanPriorityLevel, string>> = Object.freeze({
  LOW: "منخفضة",
  MEDIUM: "متوسطة",
  HIGH: "مرتفعة",
  CRITICAL: "حرجة",
});

export interface DailyPlanUiActions {
  readonly submit: boolean;
  readonly approve: boolean;
  readonly reject: boolean;
  readonly start: boolean;
  readonly complete: boolean;
  readonly cancel: boolean;
  readonly manageItems: boolean;
}

export function dailyPlanStateLabel(state: DailyPlanState): string {
  return stateLabels[state];
}

export function dailyPlanTaskLabel(task: DailyPlanTaskType): string {
  return taskLabels[task];
}

export function dailyPlanPriorityLabel(priority: DailyPlanPriorityLevel): string {
  return priorityLabels[priority];
}

export function formatDailyPlanMoney(amountMinor: number, currency: "SR" | "RG"): string {
  return formatPromiseMoney(amountMinor, currency);
}

export function availableDailyPlanActions(
  actor: AuthenticatedUser,
  plan: DailyPlan,
): DailyPlanUiActions {
  const manage = actor.permissions.has("plans.manage");
  const approve = actor.permissions.has("plans.approve");
  const execute = actor.permissions.has("plans.execute");
  return Object.freeze({
    submit: manage && plan.state === "DRAFT",
    approve: approve && plan.state === "PENDING_APPROVAL",
    reject: approve && plan.state === "PENDING_APPROVAL",
    start: execute && plan.state === "APPROVED",
    complete: execute && plan.state === "IN_PROGRESS",
    cancel: (manage || execute) && ["APPROVED", "IN_PROGRESS"].includes(plan.state),
    manageItems: manage && plan.state === "DRAFT",
  });
}
