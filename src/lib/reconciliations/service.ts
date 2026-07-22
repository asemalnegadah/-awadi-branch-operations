import type { Sql } from "postgres";

import { hasPermission } from "@/lib/auth/permissions";
import { AuthorizationError } from "@/lib/auth/types";

import { listReconciliationAccountOptionsPostgres } from "./postgres-options-repository";
import {
  approveReconciliationPostgres,
  createReconciliationPostgres,
  getReconciliationDetailsPostgres,
  listReconciliationsPostgres,
  rejectReconciliationPostgres,
  requestReconciliationApprovalPostgres,
  returnReconciliationPostgres,
  reviewReconciliationPostgres,
  settleReconciliationPostgres,
  submitReconciliationPostgres,
} from "./postgres-repository";
import type {
  CreateReconciliationInput,
  ReconciliationCommandContext,
  ReconciliationListFilters,
  ReconciliationReadContext,
  ReconciliationTransitionInput,
} from "./types";

export async function listReconciliations(
  sql: Sql,
  filters: ReconciliationListFilters,
  context: ReconciliationReadContext,
) {
  requireReconciliationPermission(context, "reconciliations.read");
  return listReconciliationsPostgres(sql, filters);
}

export async function listReconciliationAccountOptions(
  sql: Sql,
  query: string | undefined,
  context: ReconciliationReadContext,
) {
  requireReconciliationPermission(context, "reconciliations.create");
  return listReconciliationAccountOptionsPostgres(sql, query);
}

export async function getReconciliationDetails(
  sql: Sql,
  reconciliationId: string,
  context: ReconciliationReadContext,
) {
  requireReconciliationPermission(context, "reconciliations.read");
  return getReconciliationDetailsPostgres(
    sql,
    reconciliationId,
    context.actor.permissions.has("reconciliations.view_history"),
  );
}

export async function createReconciliation(
  sql: Sql,
  input: CreateReconciliationInput,
  context: ReconciliationCommandContext,
) {
  requireReconciliationPermission(context, "reconciliations.create");
  return createReconciliationPostgres(sql, input, context);
}

export async function submitReconciliation(
  sql: Sql,
  reconciliationId: string,
  input: ReconciliationTransitionInput,
  context: ReconciliationCommandContext,
) {
  requireReconciliationPermission(context, "reconciliations.create");
  return submitReconciliationPostgres(sql, reconciliationId, input, context);
}

export async function reviewReconciliation(
  sql: Sql,
  reconciliationId: string,
  input: ReconciliationTransitionInput,
  context: ReconciliationCommandContext,
) {
  requireReconciliationPermission(context, "reconciliations.review");
  return reviewReconciliationPostgres(sql, reconciliationId, input, context);
}

export async function requestReconciliationApproval(
  sql: Sql,
  reconciliationId: string,
  input: ReconciliationTransitionInput,
  context: ReconciliationCommandContext,
) {
  requireReconciliationPermission(context, "reconciliations.review");
  return requestReconciliationApprovalPostgres(sql, reconciliationId, input, context);
}

export async function approveReconciliation(
  sql: Sql,
  reconciliationId: string,
  input: ReconciliationTransitionInput,
  context: ReconciliationCommandContext,
) {
  requireReconciliationPermission(context, "reconciliations.approve");
  return approveReconciliationPostgres(sql, reconciliationId, input, context);
}

export async function returnReconciliation(
  sql: Sql,
  reconciliationId: string,
  input: ReconciliationTransitionInput,
  context: ReconciliationCommandContext,
) {
  requireAnyPermission(context, ["reconciliations.review", "reconciliations.approve"]);
  return returnReconciliationPostgres(sql, reconciliationId, input, context);
}

export async function rejectReconciliation(
  sql: Sql,
  reconciliationId: string,
  input: ReconciliationTransitionInput,
  context: ReconciliationCommandContext,
) {
  requireAnyPermission(context, ["reconciliations.review", "reconciliations.approve"]);
  return rejectReconciliationPostgres(sql, reconciliationId, input, context);
}

export async function settleReconciliation(
  sql: Sql,
  reconciliationId: string,
  input: ReconciliationTransitionInput,
  context: ReconciliationCommandContext,
) {
  requireReconciliationPermission(context, "reconciliations.settle");
  return settleReconciliationPostgres(sql, reconciliationId, input, context);
}

function requireReconciliationPermission(
  context: ReconciliationReadContext,
  permission: Parameters<typeof hasPermission>[1],
): void {
  if (!hasPermission(context.actor.permissions, permission)) throw new AuthorizationError();
}

function requireAnyPermission(
  context: ReconciliationReadContext,
  permissions: readonly Parameters<typeof hasPermission>[1][],
): void {
  if (!permissions.some((permission) => hasPermission(context.actor.permissions, permission))) {
    throw new AuthorizationError();
  }
}
