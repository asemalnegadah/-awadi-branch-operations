import type { Sql } from "postgres";

import { requirePermission } from "@/lib/auth/authorization";
import type { PermissionCode } from "@/lib/auth/permissions";
import { AuthorizationError } from "@/lib/auth/types";
import { getActiveRepresentativeIdByUserPostgres } from "@/lib/promises/postgres-repository";

import {
  addFieldVisitEvidencePostgres,
  addFieldVisitOutcomePostgres,
  cancelFieldVisitPostgres,
  checkInFieldVisitPostgres,
  checkOutFieldVisitPostgres,
  createFieldVisitPostgres,
  getFieldVisitDetailsPostgres,
  listFieldVisitsPostgres,
  recordDailyPlanItemResultPostgres,
  returnFieldVisitPostgres,
  verifyFieldVisitPostgres,
} from "./postgres-repository";
import { submitFieldVisitSafelyPostgres } from "./postgres-submit-repository";
import type {
  AddFieldVisitEvidenceInput,
  AddFieldVisitOutcomeInput,
  CreateFieldVisitInput,
  FieldVisitCommandContext,
  FieldVisitListFilters,
  FieldVisitLocationInput,
  FieldVisitReadContext,
  FieldVisitTransitionInput,
  RecordPlanItemResultInput,
  SubmitFieldVisitInput,
} from "./types";

export async function listFieldVisits(
  sql: Sql,
  filters: FieldVisitListFilters,
  context: FieldVisitReadContext,
) {
  const representativeScopeId = await resolveVisitReadScope(sql, context);
  if (
    representativeScopeId
    && filters.representativeId
    && filters.representativeId !== representativeScopeId
  ) {
    throw new AuthorizationError();
  }
  return listFieldVisitsPostgres(sql, filters, representativeScopeId);
}

export async function getFieldVisitDetails(
  sql: Sql,
  visitId: string,
  context: FieldVisitReadContext,
) {
  return getFieldVisitDetailsPostgres(
    sql,
    visitId,
    await resolveVisitReadScope(sql, context),
    context.actor.permissions.has("visits.view_history"),
  );
}

export async function createFieldVisit(
  sql: Sql,
  input: CreateFieldVisitInput,
  context: FieldVisitCommandContext,
) {
  requireVisitPermission(context, "visits.create");
  const representativeId = await resolveVisitCreatorRepresentative(sql, input, context);
  return createFieldVisitPostgres(sql, representativeId, input, context);
}

export async function checkInFieldVisit(
  sql: Sql,
  visitId: string,
  input: FieldVisitLocationInput,
  context: FieldVisitCommandContext,
) {
  requireVisitPermission(context, "visits.manage");
  return checkInFieldVisitPostgres(
    sql,
    visitId,
    input,
    context,
    await resolveVisitManagementScope(sql, context),
  );
}

export async function checkOutFieldVisit(
  sql: Sql,
  visitId: string,
  input: FieldVisitLocationInput & { readonly version: number },
  context: FieldVisitCommandContext,
) {
  requireVisitPermission(context, "visits.manage");
  return checkOutFieldVisitPostgres(
    sql,
    visitId,
    input,
    context,
    await resolveVisitManagementScope(sql, context),
  );
}

export async function addFieldVisitOutcome(
  sql: Sql,
  visitId: string,
  input: AddFieldVisitOutcomeInput,
  context: FieldVisitCommandContext,
) {
  requireVisitPermission(context, "visits.manage");
  return addFieldVisitOutcomePostgres(
    sql,
    visitId,
    input,
    context,
    await resolveVisitManagementScope(sql, context),
  );
}

export async function addFieldVisitEvidence(
  sql: Sql,
  visitId: string,
  input: AddFieldVisitEvidenceInput,
  context: FieldVisitCommandContext,
) {
  requireVisitPermission(context, "visits.manage");
  return addFieldVisitEvidencePostgres(
    sql,
    visitId,
    input,
    context,
    await resolveVisitManagementScope(sql, context),
  );
}

export async function submitFieldVisit(
  sql: Sql,
  visitId: string,
  input: SubmitFieldVisitInput,
  context: FieldVisitCommandContext,
) {
  requireVisitPermission(context, "visits.manage");
  return submitFieldVisitSafelyPostgres(
    sql,
    visitId,
    input,
    context,
    await resolveVisitManagementScope(sql, context),
  );
}

export async function verifyFieldVisit(
  sql: Sql,
  visitId: string,
  input: FieldVisitTransitionInput,
  context: FieldVisitCommandContext,
) {
  requireVisitPermission(context, "visits.verify");
  return verifyFieldVisitPostgres(sql, visitId, input, context);
}

export async function returnFieldVisit(
  sql: Sql,
  visitId: string,
  input: FieldVisitTransitionInput,
  context: FieldVisitCommandContext,
) {
  requireVisitPermission(context, "visits.verify");
  return returnFieldVisitPostgres(sql, visitId, input, context);
}

export async function cancelFieldVisit(
  sql: Sql,
  visitId: string,
  input: FieldVisitTransitionInput,
  context: FieldVisitCommandContext,
) {
  if (
    !context.actor.permissions.has("visits.manage")
    && !context.actor.permissions.has("visits.verify")
  ) {
    throw new AuthorizationError();
  }
  return cancelFieldVisitPostgres(
    sql,
    visitId,
    input,
    context,
    context.actor.permissions.has("visits.verify")
      ? undefined
      : await resolveVisitManagementScope(sql, context),
  );
}

export async function recordDailyPlanItemResult(
  sql: Sql,
  input: RecordPlanItemResultInput,
  context: FieldVisitCommandContext,
) {
  if (
    !context.actor.permissions.has("plans.execute")
    && !context.actor.permissions.has("visits.manage")
  ) {
    throw new AuthorizationError();
  }
  return recordDailyPlanItemResultPostgres(
    sql,
    input,
    context,
    context.actor.roles.includes("BRANCH_MANAGER")
      ? undefined
      : await requireActiveRepresentativeId(sql, context),
  );
}

function requireVisitPermission(
  context: FieldVisitReadContext,
  permission: PermissionCode,
): void {
  requirePermission(context.actor, permission);
}

async function resolveVisitReadScope(
  sql: Sql,
  context: FieldVisitReadContext,
): Promise<string | undefined> {
  if (context.actor.permissions.has("visits.read_all")) return undefined;
  requireVisitPermission(context, "visits.read_own");
  return requireActiveRepresentativeId(sql, context);
}

async function resolveVisitManagementScope(
  sql: Sql,
  context: FieldVisitReadContext,
): Promise<string | undefined> {
  if (context.actor.roles.includes("BRANCH_MANAGER")) return undefined;
  return requireActiveRepresentativeId(sql, context);
}

async function resolveVisitCreatorRepresentative(
  sql: Sql,
  input: CreateFieldVisitInput,
  context: FieldVisitReadContext,
): Promise<string> {
  const activeRepresentativeId = await getActiveRepresentativeIdByUserPostgres(
    sql,
    context.actor.id,
  );
  if (activeRepresentativeId) return activeRepresentativeId;
  if (!context.actor.roles.includes("BRANCH_MANAGER") || !input.planItemId) {
    throw new AuthorizationError();
  }
  const rows = await sql.unsafe<{ representative_id: string }[]>(
    `SELECT plan.representative_id
     FROM daily_plan_items AS item
     JOIN daily_plans AS plan ON plan.id = item.plan_id
     WHERE item.id = $1::uuid
       AND ($2::uuid IS NULL OR plan.id = $2::uuid)`,
    [input.planItemId, input.planId ?? null],
  );
  const representativeId = rows[0]?.representative_id;
  if (!representativeId) throw new AuthorizationError();
  return representativeId;
}

async function requireActiveRepresentativeId(
  sql: Sql,
  context: FieldVisitReadContext,
): Promise<string> {
  const representativeId = await getActiveRepresentativeIdByUserPostgres(
    sql,
    context.actor.id,
  );
  if (!representativeId) throw new AuthorizationError();
  return representativeId;
}
