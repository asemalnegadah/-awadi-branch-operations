import type { Sql } from "postgres";

import { requirePermission } from "@/lib/auth/authorization";
import type { PermissionCode } from "@/lib/auth/permissions";

import { PromiseNotFoundError } from "./errors";
import {
  addFollowUpPostgres,
  allocateConfirmedCollectionPostgres,
  cancelPromisePostgres,
  createPromisePostgres,
  escalatePromisePostgres,
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
  return createPromisePostgres(sql, input, context);
}

export async function getPromise(sql: Sql, promiseId: string, context: PromiseReadContext) {
  requirePromisePermission(context.actor, "promises.read");
  const promise = await getPromisePostgres(sql, promiseId);
  if (!promise) throw new PromiseNotFoundError();
  return promise;
}

export async function getPromiseDetails(
  sql: Sql,
  promiseId: string,
  context: PromiseReadContext,
) {
  requirePromisePermission(context.actor, "promises.read");
  const details = await getPromiseDetailsPostgres(sql, promiseId);
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
  return listPromisesPostgres(sql, filters);
}

export async function updatePromise(
  sql: Sql,
  promiseId: string,
  input: UpdatePromiseInput,
  context: PromiseCommandContext,
) {
  requirePromisePermission(context.actor, "promises.update");
  return updatePromisePostgres(sql, promiseId, input, context);
}

export async function addFollowUp(
  sql: Sql,
  promiseId: string,
  input: AddFollowUpInput,
  context: PromiseCommandContext,
) {
  requirePromisePermission(context.actor, "promises.follow_up");
  return addFollowUpPostgres(sql, promiseId, input, context);
}

export async function rejectPromise(
  sql: Sql,
  promiseId: string,
  input: RejectPromiseInput,
  context: PromiseCommandContext,
) {
  requirePromisePermission(context.actor, "promises.reject");
  return rejectPromisePostgres(sql, promiseId, input, context);
}

export async function cancelPromise(
  sql: Sql,
  promiseId: string,
  input: CancelPromiseInput,
  context: PromiseCommandContext,
) {
  requirePromisePermission(context.actor, "promises.cancel");
  return cancelPromisePostgres(sql, promiseId, input, context);
}

export async function allocateConfirmedCollection(
  sql: Sql,
  promiseId: string,
  input: AllocateCollectionInput,
  context: PromiseCommandContext,
) {
  requirePromisePermission(context.actor, "promises.allocate_collection");
  return allocateConfirmedCollectionPostgres(sql, promiseId, input, context);
}

export async function reverseCollectionAllocation(
  sql: Sql,
  promiseId: string,
  allocationId: string,
  input: ReverseAllocationInput,
  context: PromiseCommandContext,
) {
  requirePromisePermission(context.actor, "promises.reverse_allocation");
  return reverseCollectionAllocationPostgres(sql, promiseId, allocationId, input, context);
}

export async function escalatePromise(
  sql: Sql,
  promiseId: string,
  input: EscalatePromiseInput,
  context: PromiseCommandContext,
) {
  requirePromisePermission(context.actor, "promises.escalate");
  return escalatePromisePostgres(sql, promiseId, input, context);
}

export async function getPromiseHistory(
  sql: Sql,
  promiseId: string,
  context: PromiseReadContext,
) {
  requirePromisePermission(context.actor, "promises.view_history");
  const promise = await getPromisePostgres(sql, promiseId);
  if (!promise) throw new PromiseNotFoundError();
  return getPromiseHistoryPostgres(sql, promiseId);
}

export async function getDuePromises(sql: Sql, context: PromiseReadContext, limit = 100) {
  requirePromisePermission(context.actor, "promises.read");
  return getDuePromisesPostgres(sql, limit);
}

export async function getOverduePromises(
  sql: Sql,
  context: PromiseReadContext,
  limit = 100,
) {
  requirePromisePermission(context.actor, "promises.read");
  return getOverduePromisesPostgres(sql, limit);
}

export async function getCustomerPromiseSummary(
  sql: Sql,
  customerId: string,
  context: PromiseReadContext,
) {
  requirePromisePermission(context.actor, "promises.read");
  const summary = await getCustomerPromiseSummaryPostgres(sql, customerId);
  if (!summary) throw new PromiseNotFoundError();
  return summary;
}

export async function getSalespersonPromiseSummary(
  sql: Sql,
  representativeId: string,
  context: PromiseReadContext,
) {
  requirePromisePermission(context.actor, "promises.read");
  const summary = await getSalespersonPromiseSummaryPostgres(sql, representativeId);
  if (!summary) throw new PromiseNotFoundError();
  return summary;
}

export async function getPromiseDashboardSummary(sql: Sql, context: PromiseReadContext) {
  requirePromisePermission(context.actor, "promises.read");
  return getPromiseDashboardSummaryPostgres(sql);
}

export async function getPromiseFormOptions(sql: Sql, context: PromiseReadContext) {
  requirePromisePermission(context.actor, "promises.create");
  return getPromiseFormOptionsPostgres(sql);
}

export async function listAvailableConfirmedCollections(
  sql: Sql,
  promiseId: string,
  context: PromiseReadContext,
) {
  requirePromisePermission(context.actor, "promises.allocate_collection");
  const promise = await getPromisePostgres(sql, promiseId);
  if (!promise) throw new PromiseNotFoundError();
  return listAvailableConfirmedCollectionsPostgres(sql, promiseId);
}

function requirePromisePermission(
  actor: PromiseReadContext["actor"],
  permission: PermissionCode,
): void {
  requirePermission(actor, permission);
}
