import type { Sql } from "postgres";

import { requirePermission } from "@/lib/auth/authorization";
import type { PermissionCode } from "@/lib/auth/permissions";
import { AuthorizationError } from "@/lib/auth/types";

import { PromiseNotFoundError } from "./errors";
import {
  addFollowUpPostgres,
  allocateConfirmedCollectionPostgres,
  cancelPromisePostgres,
  createPromisePostgres,
  escalatePromisePostgres,
  getActiveRepresentativeIdByUserPostgres,
  getCustomerPromiseSummaryPostgres,
  getDuePromisesPostgres,
  getOverduePromisesPostgres,
  getPromiseDashboardSummaryPostgres,
  getPromiseDetailsPostgres,
  getPromiseFormOptionsPostgres,
  getPromiseHistoryPostgres,
  getPromisePostgres,
  getSalespersonPromiseSummaryPostgres,
  listAvailableConfirmedCollectionsPostgres,
  listPromisesPostgres,
  rejectPromisePostgres,
  reverseCollectionAllocationPostgres,
  updatePromisePostgres,
} from "./postgres-repository";
import type {
  AddFollowUpInput,
  AllocateCollectionInput,
  CancelPromiseInput,
  CreatePromiseInput,
  EscalatePromiseInput,
  PromiseCommandContext,
  PromiseListFilters,
  PromiseReadContext,
  RejectPromiseInput,
  ReverseAllocationInput,
  UpdatePromiseInput,
} from "./types";

export async function createPromise(
  sql: Sql,
  input: CreatePromiseInput,
  context: PromiseCommandContext,
) {
  requirePromisePermission(context.actor, "promises.create");
  const representativeScopeId = await resolveRepresentativeScope(
    sql,
    context.actor,
  );
  assertRepresentativeAssignmentInput(representativeScopeId, input.representativeId);
  return createPromisePostgres(sql, input, context, representativeScopeId);
}

export async function getPromise(sql: Sql, promiseId: string, context: PromiseReadContext) {
  requirePromisePermission(context.actor, "promises.read");
  const representativeScopeId = await resolveRepresentativeScope(
    sql,
    context.actor,
  );
  const promise = await getPromisePostgres(sql, promiseId, representativeScopeId);
  if (!promise) throw new PromiseNotFoundError();
  return promise;
}

export async function getPromiseDetails(
  sql: Sql,
  promiseId: string,
  context: PromiseReadContext,
) {
  requirePromisePermission(context.actor, "promises.read");
  const representativeScopeId = await resolveRepresentativeScope(
    sql,
    context.actor,
  );
  const details = await getPromiseDetailsPostgres(
    sql,
    promiseId,
    representativeScopeId,
  );
  if (!details) throw new PromiseNotFoundError();
  if (context.actor.permissions.has("promises.view_history")) return details;
  return Object.freeze({ ...details, events: Object.freeze([]) });
}

export async function listPromises(
  sql: Sql,
  filters: PromiseListFilters,
  context: PromiseReadContext,
) {
  requirePromisePermission(context.actor, "promises.read");
  const representativeScopeId = await resolveRepresentativeScope(
    sql,
    context.actor,
  );
  return listPromisesPostgres(sql, filters, representativeScopeId);
}

export async function updatePromise(
  sql: Sql,
  promiseId: string,
  input: UpdatePromiseInput,
  context: PromiseCommandContext,
) {
  requirePromisePermission(context.actor, "promises.update");
  const representativeScopeId = await resolveRepresentativeScope(
    sql,
    context.actor,
  );
  if (input.representativeId) {
    assertRepresentativeAssignmentInput(
      representativeScopeId,
      input.representativeId,
    );
  }
  return updatePromisePostgres(
    sql,
    promiseId,
    input,
    context,
    representativeScopeId,
  );
}

export async function addFollowUp(
  sql: Sql,
  promiseId: string,
  input: AddFollowUpInput,
  context: PromiseCommandContext,
) {
  requirePromisePermission(context.actor, "promises.follow_up");
  const representativeScopeId = await resolveRepresentativeScope(
    sql,
    context.actor,
  );
  return addFollowUpPostgres(
    sql,
    promiseId,
    input,
    context,
    representativeScopeId,
  );
}

export async function rejectPromise(
  sql: Sql,
  promiseId: string,
  input: RejectPromiseInput,
  context: PromiseCommandContext,
) {
  requirePromisePermission(context.actor, "promises.reject");
  const representativeScopeId = await resolveRepresentativeScope(
    sql,
    context.actor,
  );
  return rejectPromisePostgres(
    sql,
    promiseId,
    input,
    context,
    representativeScopeId,
  );
}

export async function cancelPromise(
  sql: Sql,
  promiseId: string,
  input: CancelPromiseInput,
  context: PromiseCommandContext,
) {
  requirePromisePermission(context.actor, "promises.cancel");
  const representativeScopeId = await resolveRepresentativeScope(
    sql,
    context.actor,
  );
  return cancelPromisePostgres(
    sql,
    promiseId,
    input,
    context,
    representativeScopeId,
  );
}

export async function allocateConfirmedCollection(
  sql: Sql,
  promiseId: string,
  input: AllocateCollectionInput,
  context: PromiseCommandContext,
) {
  requirePromisePermission(context.actor, "promises.allocate_collection");
  const representativeScopeId = await resolveRepresentativeScope(
    sql,
    context.actor,
  );
  return allocateConfirmedCollectionPostgres(
    sql,
    promiseId,
    input,
    context,
    representativeScopeId,
  );
}

export async function reverseCollectionAllocation(
  sql: Sql,
  promiseId: string,
  allocationId: string,
  input: ReverseAllocationInput,
  context: PromiseCommandContext,
) {
  requirePromisePermission(context.actor, "promises.reverse_allocation");
  const representativeScopeId = await resolveRepresentativeScope(
    sql,
    context.actor,
  );
  return reverseCollectionAllocationPostgres(
    sql,
    promiseId,
    allocationId,
    input,
    context,
    representativeScopeId,
  );
}

export async function escalatePromise(
  sql: Sql,
  promiseId: string,
  input: EscalatePromiseInput,
  context: PromiseCommandContext,
) {
  requirePromisePermission(context.actor, "promises.escalate");
  const representativeScopeId = await resolveRepresentativeScope(
    sql,
    context.actor,
  );
  return escalatePromisePostgres(
    sql,
    promiseId,
    input,
    context,
    representativeScopeId,
  );
}

export async function getPromiseHistory(
  sql: Sql,
  promiseId: string,
  context: PromiseReadContext,
) {
  requirePromisePermission(context.actor, "promises.view_history");
  const representativeScopeId = await resolveRepresentativeScope(
    sql,
    context.actor,
  );
  const promise = await getPromisePostgres(sql, promiseId, representativeScopeId);
  if (!promise) throw new PromiseNotFoundError();
  return getPromiseHistoryPostgres(sql, promiseId);
}

export async function getDuePromises(sql: Sql, context: PromiseReadContext, limit = 100) {
  requirePromisePermission(context.actor, "promises.read");
  const representativeScopeId = await resolveRepresentativeScope(
    sql,
    context.actor,
  );
  return getDuePromisesPostgres(sql, limit, representativeScopeId);
}

export async function getOverduePromises(
  sql: Sql,
  context: PromiseReadContext,
  limit = 100,
) {
  requirePromisePermission(context.actor, "promises.read");
  const representativeScopeId = await resolveRepresentativeScope(
    sql,
    context.actor,
  );
  return getOverduePromisesPostgres(sql, limit, representativeScopeId);
}

export async function getCustomerPromiseSummary(
  sql: Sql,
  customerId: string,
  context: PromiseReadContext,
) {
  requirePromisePermission(context.actor, "promises.read");
  const representativeScopeId = await resolveRepresentativeScope(
    sql,
    context.actor,
  );
  const summary = await getCustomerPromiseSummaryPostgres(
    sql,
    customerId,
    representativeScopeId,
  );
  if (!summary) throw new PromiseNotFoundError();
  return summary;
}

export async function getSalespersonPromiseSummary(
  sql: Sql,
  representativeId: string,
  context: PromiseReadContext,
) {
  requirePromisePermission(context.actor, "promises.read");
  const representativeScopeId = await resolveRepresentativeScope(
    sql,
    context.actor,
  );
  const summary = await getSalespersonPromiseSummaryPostgres(
    sql,
    representativeId,
    representativeScopeId,
  );
  if (!summary) throw new PromiseNotFoundError();
  return summary;
}

export async function getPromiseDashboardSummary(sql: Sql, context: PromiseReadContext) {
  requirePromisePermission(context.actor, "promises.read");
  const representativeScopeId = await resolveRepresentativeScope(
    sql,
    context.actor,
  );
  return getPromiseDashboardSummaryPostgres(sql, representativeScopeId);
}

export async function getPromiseFormOptions(sql: Sql, context: PromiseReadContext) {
  requirePromisePermission(context.actor, "promises.create");
  return loadPromiseFormOptions(sql, context);
}

export async function getPromiseUpdateFormOptions(
  sql: Sql,
  context: PromiseReadContext,
) {
  requirePromisePermission(context.actor, "promises.update");
  return loadPromiseFormOptions(sql, context);
}

export async function listAvailableConfirmedCollections(
  sql: Sql,
  promiseId: string,
  context: PromiseReadContext,
) {
  requirePromisePermission(context.actor, "promises.allocate_collection");
  const representativeScopeId = await resolveRepresentativeScope(
    sql,
    context.actor,
  );
  const details = await getPromiseDetailsPostgres(
    sql,
    promiseId,
    representativeScopeId,
  );
  if (!details) throw new PromiseNotFoundError();

  const collections = await listAvailableConfirmedCollectionsPostgres(
    sql,
    promiseId,
    representativeScopeId,
  );
  const activeCollectionIds = new Set(
    details.allocations
      .filter((allocation) => allocation.reversedAt === null)
      .map((allocation) => allocation.collectionId),
  );

  return Object.freeze(
    collections.filter((collection) => !activeCollectionIds.has(collection.id)),
  );
}

async function loadPromiseFormOptions(
  sql: Sql,
  context: PromiseReadContext,
) {
  const representativeScopeId = await resolveRepresentativeScope(
    sql,
    context.actor,
  );
  return getPromiseFormOptionsPostgres(sql, representativeScopeId);
}

function requirePromisePermission(
  actor: PromiseReadContext["actor"],
  permission: PermissionCode,
): void {
  requirePermission(actor, permission);
}

const globalPromiseRoles = new Set([
  "OWNER_AUDITOR",
  "BRANCH_MANAGER",
  "ACCOUNTING_CASHIER",
  "AUDITOR",
]);

async function resolveRepresentativeScope(
  sql: Sql,
  actor: PromiseReadContext["actor"],
): Promise<string | undefined> {
  if (!actor.roles.includes("SALES_REP")) return undefined;
  if (actor.roles.some((role) => globalPromiseRoles.has(role))) return undefined;
  const representativeId = await getActiveRepresentativeIdByUserPostgres(
    sql,
    actor.id,
  );
  if (!representativeId) throw new AuthorizationError();
  return representativeId;
}

function assertRepresentativeAssignmentInput(
  representativeScopeId: string | undefined,
  requestedRepresentativeId: string,
): void {
  if (
    representativeScopeId &&
    requestedRepresentativeId !== representativeScopeId
  ) {
    throw new AuthorizationError();
  }
}
