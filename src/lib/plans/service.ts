import type { Sql } from "postgres";

import { requirePermission } from "@/lib/auth/authorization";
import type { PermissionCode } from "@/lib/auth/permissions";
import { AuthorizationError } from "@/lib/auth/types";
import { getActiveRepresentativeIdByUserPostgres } from "@/lib/promises/postgres-repository";

import { generateDailyPlanPostgres } from "./postgres-generation-repository";
import {
  getDailyPlanDetailsPostgres,
  listDailyPlansPostgres,
} from "./postgres-read-repository";
import {
  approveDailyPlanPostgres,
  cancelDailyPlanPostgres,
  completeDailyPlanPostgres,
  rejectDailyPlanPostgres,
  startDailyPlanPostgres,
  submitDailyPlanPostgres,
} from "./postgres-transition-repository";
import type {
  DailyPlanCommandContext,
  DailyPlanListFilters,
  DailyPlanReadContext,
  DailyPlanTransitionInput,
  GenerateDailyPlanInput,
} from "./types";

export async function generateDailyPlan(
  sql: Sql,
  input: GenerateDailyPlanInput,
  context: DailyPlanCommandContext,
) {
  requirePlanPermission(context, "plans.generate");
  const result = await generateDailyPlanPostgres(sql, input, context);
  return Object.freeze({
    details: await getDailyPlanDetailsPostgres(
      sql,
      result.details.plan.id,
      undefined,
      context.actor.permissions.has("plans.view_history"),
    ),
    replayed: result.replayed,
  });
}

export async function listDailyPlans(
  sql: Sql,
  filters: DailyPlanListFilters,
  context: DailyPlanReadContext,
) {
  const representativeScopeId = await resolvePlanReadScope(sql, context);
  if (
    representativeScopeId
    && filters.representativeId
    && filters.representativeId !== representativeScopeId
  ) {
    throw new AuthorizationError();
  }
  return listDailyPlansPostgres(sql, filters, representativeScopeId);
}

export async function getDailyPlanDetails(
  sql: Sql,
  planId: string,
  context: DailyPlanReadContext,
) {
  const representativeScopeId = await resolvePlanReadScope(sql, context);
  return getDailyPlanDetailsPostgres(
    sql,
    planId,
    representativeScopeId,
    context.actor.permissions.has("plans.view_history"),
  );
}

export async function submitDailyPlan(
  sql: Sql,
  planId: string,
  input: DailyPlanTransitionInput,
  context: DailyPlanCommandContext,
) {
  requirePlanPermission(context, "plans.manage");
  return submitDailyPlanPostgres(sql, planId, input, context);
}

export async function approveDailyPlan(
  sql: Sql,
  planId: string,
  input: DailyPlanTransitionInput,
  context: DailyPlanCommandContext,
) {
  requirePlanPermission(context, "plans.approve");
  return approveDailyPlanPostgres(sql, planId, input, context);
}

export async function rejectDailyPlan(
  sql: Sql,
  planId: string,
  input: DailyPlanTransitionInput,
  context: DailyPlanCommandContext,
) {
  requirePlanPermission(context, "plans.approve");
  return rejectDailyPlanPostgres(sql, planId, input, context);
}

export async function startDailyPlan(
  sql: Sql,
  planId: string,
  input: DailyPlanTransitionInput,
  context: DailyPlanCommandContext,
) {
  requirePlanPermission(context, "plans.execute");
  return startDailyPlanPostgres(
    sql,
    planId,
    input,
    context,
    await resolvePlanExecutionScope(sql, context),
  );
}

export async function completeDailyPlan(
  sql: Sql,
  planId: string,
  input: DailyPlanTransitionInput,
  context: DailyPlanCommandContext,
) {
  requirePlanPermission(context, "plans.execute");
  return completeDailyPlanPostgres(
    sql,
    planId,
    input,
    context,
    await resolvePlanExecutionScope(sql, context),
  );
}

export async function cancelDailyPlan(
  sql: Sql,
  planId: string,
  input: DailyPlanTransitionInput,
  context: DailyPlanCommandContext,
) {
  if (
    !context.actor.permissions.has("plans.manage")
    && !context.actor.permissions.has("plans.execute")
  ) {
    throw new AuthorizationError();
  }
  return cancelDailyPlanPostgres(
    sql,
    planId,
    input,
    context,
    context.actor.permissions.has("plans.manage")
      ? undefined
      : await resolvePlanExecutionScope(sql, context),
  );
}

function requirePlanPermission(
  context: DailyPlanReadContext,
  permission: PermissionCode,
): void {
  requirePermission(context.actor, permission);
}

async function resolvePlanReadScope(
  sql: Sql,
  context: DailyPlanReadContext,
): Promise<string | undefined> {
  if (context.actor.permissions.has("plans.read_all")) return undefined;
  requirePlanPermission(context, "plans.read_own");
  return requireActiveRepresentativeId(sql, context);
}

async function resolvePlanExecutionScope(
  sql: Sql,
  context: DailyPlanReadContext,
): Promise<string | undefined> {
  if (context.actor.roles.includes("BRANCH_MANAGER")) return undefined;
  return requireActiveRepresentativeId(sql, context);
}

async function requireActiveRepresentativeId(
  sql: Sql,
  context: DailyPlanReadContext,
): Promise<string> {
  const representativeId = await getActiveRepresentativeIdByUserPostgres(
    sql,
    context.actor.id,
  );
  if (!representativeId) throw new AuthorizationError();
  return representativeId;
}
