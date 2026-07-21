import type { Sql } from "postgres";

import { requirePermission } from "@/lib/auth/authorization";
import type { PermissionCode } from "@/lib/auth/permissions";
import { AuthorizationError } from "@/lib/auth/types";
import { getActiveRepresentativeIdByUserPostgres } from "@/lib/promises/postgres-repository";

import {
  deriveCreditRiskInputPostgres,
  getAssessmentHistoryPostgres,
  getCurrentAssessmentPostgres,
  listCreditRiskAccountsPostgres,
  recalculateCreditRiskPostgres,
} from "./postgres-assessment-repository";
import {
  approveCreditExceptionPostgres,
  approveCreditRestrictionPostgres,
  createCreditExceptionPostgres,
  createCreditRestrictionPostgres,
  evaluateCreditSalePostgres,
  listCreditExceptionEventsPostgres,
  listCreditExceptionsPostgres,
  listCreditRestrictionEventsPostgres,
  listCreditRestrictionsPostgres,
  rejectCreditExceptionPostgres,
  rejectCreditRestrictionPostgres,
  revokeCreditExceptionPostgres,
  revokeCreditRestrictionPostgres,
  submitCreditExceptionPostgres,
  submitCreditRestrictionPostgres,
} from "./postgres-decision-repository";
import type {
  CreateCreditExceptionInput,
  CreateCreditRestrictionInput,
  CreditRiskAccountDetails,
  CreditRiskCommandContext,
  CreditRiskListFilters,
  CreditRiskReadContext,
  DecisionTransitionInput,
  RecalculateCreditRiskInput,
} from "./types";

export async function listCreditRiskAccounts(
  sql: Sql,
  filters: CreditRiskListFilters,
  context: CreditRiskReadContext,
) {
  requireRiskPermission(context, "risk.read");
  return listCreditRiskAccountsPostgres(
    sql,
    filters,
    await resolveRepresentativeScope(sql, context),
  );
}

export async function getCreditRiskAccountDetails(
  sql: Sql,
  customerAccountId: string,
  context: CreditRiskReadContext,
): Promise<CreditRiskAccountDetails> {
  requireRiskPermission(context, "risk.read");
  const representativeScopeId = await resolveRepresentativeScope(sql, context);
  const derived = await deriveCreditRiskInputPostgres(
    sql,
    customerAccountId,
    representativeScopeId,
  );
  const canViewHistory = context.actor.permissions.has("risk.view_history");
  const [assessment, assessmentHistory, restrictions, exceptions, restrictionEvents, exceptionEvents] =
    await Promise.all([
      getCurrentAssessmentPostgres(sql, customerAccountId, representativeScopeId),
      canViewHistory
        ? getAssessmentHistoryPostgres(sql, customerAccountId, representativeScopeId)
        : Promise.resolve(Object.freeze([])),
      listCreditRestrictionsPostgres(sql, customerAccountId, representativeScopeId),
      listCreditExceptionsPostgres(sql, customerAccountId, representativeScopeId),
      canViewHistory
        ? listCreditRestrictionEventsPostgres(sql, customerAccountId, representativeScopeId)
        : Promise.resolve(Object.freeze([])),
      canViewHistory
        ? listCreditExceptionEventsPostgres(sql, customerAccountId, representativeScopeId)
        : Promise.resolve(Object.freeze([])),
    ]);

  const activeRestriction = restrictions.find((item) => item.state === "ACTIVE") ?? null;
  const now = Date.now();
  const activeException = exceptions.find(
    (item) =>
      item.state === "ACTIVE"
      && Date.parse(item.validFrom) <= now
      && Date.parse(item.validUntil) > now,
  ) ?? null;

  return Object.freeze({
    customerId: derived.account.customerId,
    customerAccountId: derived.account.id,
    customerName: derived.account.customerName,
    customerNumber: derived.account.customerNumber,
    currencyCode: derived.account.currencyCode,
    accountStatus: derived.account.accountStatus,
    creditLimitMinor: derived.account.creditLimitMinor,
    assessment,
    activeRestriction,
    activeException,
    assessmentHistory,
    restrictions,
    exceptions,
    restrictionEvents,
    exceptionEvents,
  });
}

export async function recalculateCreditRisk(
  sql: Sql,
  input: RecalculateCreditRiskInput,
  context: CreditRiskCommandContext,
) {
  requireRiskPermission(context, "risk.recalculate");
  return recalculateCreditRiskPostgres(
    sql,
    input.customerAccountId,
    context,
    await resolveRepresentativeScope(sql, context),
  );
}

export async function createCreditRestriction(
  sql: Sql,
  input: CreateCreditRestrictionInput,
  context: CreditRiskCommandContext,
) {
  requireRiskPermission(context, "credit_restrictions.propose");
  return createCreditRestrictionPostgres(
    sql,
    input,
    context,
    await resolveRepresentativeScope(sql, context),
  );
}

export async function submitCreditRestriction(
  sql: Sql,
  restrictionId: string,
  input: DecisionTransitionInput,
  context: CreditRiskCommandContext,
) {
  requireRiskPermission(context, "credit_restrictions.propose");
  return submitCreditRestrictionPostgres(
    sql,
    restrictionId,
    input,
    context,
    await resolveRepresentativeScope(sql, context),
  );
}

export async function approveCreditRestriction(
  sql: Sql,
  restrictionId: string,
  input: DecisionTransitionInput,
  context: CreditRiskCommandContext,
) {
  requireRiskPermission(context, "credit_restrictions.approve");
  return approveCreditRestrictionPostgres(
    sql,
    restrictionId,
    input,
    context,
    await resolveRepresentativeScope(sql, context),
  );
}

export async function rejectCreditRestriction(
  sql: Sql,
  restrictionId: string,
  input: DecisionTransitionInput,
  context: CreditRiskCommandContext,
) {
  requireRiskPermission(context, "credit_restrictions.approve");
  return rejectCreditRestrictionPostgres(
    sql,
    restrictionId,
    input,
    context,
    await resolveRepresentativeScope(sql, context),
  );
}

export async function revokeCreditRestriction(
  sql: Sql,
  restrictionId: string,
  input: DecisionTransitionInput,
  context: CreditRiskCommandContext,
) {
  requireRiskPermission(context, "credit_restrictions.revoke");
  return revokeCreditRestrictionPostgres(
    sql,
    restrictionId,
    input,
    context,
    await resolveRepresentativeScope(sql, context),
  );
}

export async function createCreditException(
  sql: Sql,
  input: CreateCreditExceptionInput,
  context: CreditRiskCommandContext,
) {
  requireRiskPermission(context, "credit_exceptions.propose");
  return createCreditExceptionPostgres(
    sql,
    input,
    context,
    await resolveRepresentativeScope(sql, context),
  );
}

export async function submitCreditException(
  sql: Sql,
  exceptionId: string,
  input: DecisionTransitionInput,
  context: CreditRiskCommandContext,
) {
  requireRiskPermission(context, "credit_exceptions.propose");
  return submitCreditExceptionPostgres(
    sql,
    exceptionId,
    input,
    context,
    await resolveRepresentativeScope(sql, context),
  );
}

export async function approveCreditException(
  sql: Sql,
  exceptionId: string,
  input: DecisionTransitionInput,
  context: CreditRiskCommandContext,
) {
  requireRiskPermission(context, "credit_exceptions.approve");
  return approveCreditExceptionPostgres(
    sql,
    exceptionId,
    input,
    context,
    await resolveRepresentativeScope(sql, context),
  );
}

export async function rejectCreditException(
  sql: Sql,
  exceptionId: string,
  input: DecisionTransitionInput,
  context: CreditRiskCommandContext,
) {
  requireRiskPermission(context, "credit_exceptions.approve");
  return rejectCreditExceptionPostgres(
    sql,
    exceptionId,
    input,
    context,
    await resolveRepresentativeScope(sql, context),
  );
}

export async function revokeCreditException(
  sql: Sql,
  exceptionId: string,
  input: DecisionTransitionInput,
  context: CreditRiskCommandContext,
) {
  requireRiskPermission(context, "credit_exceptions.revoke");
  return revokeCreditExceptionPostgres(
    sql,
    exceptionId,
    input,
    context,
    await resolveRepresentativeScope(sql, context),
  );
}

export async function evaluateCreditSale(
  sql: Sql,
  customerAccountId: string,
  amountMinor: number,
  context: CreditRiskReadContext,
) {
  requireRiskPermission(context, "risk.read");
  return evaluateCreditSalePostgres(
    sql,
    customerAccountId,
    amountMinor,
    await resolveRepresentativeScope(sql, context),
  );
}

function requireRiskPermission(
  context: CreditRiskReadContext,
  permission: PermissionCode,
): void {
  requirePermission(context.actor, permission);
}

const globalRiskRoles = new Set([
  "OWNER_AUDITOR",
  "BRANCH_MANAGER",
  "ACCOUNTING_CASHIER",
  "AUDITOR",
]);

async function resolveRepresentativeScope(
  sql: Sql,
  context: CreditRiskReadContext,
): Promise<string | undefined> {
  if (!context.actor.roles.includes("SALES_REP")) return undefined;
  if (context.actor.roles.some((role) => globalRiskRoles.has(role))) return undefined;
  const representativeId = await getActiveRepresentativeIdByUserPostgres(
    sql,
    context.actor.id,
  );
  if (!representativeId) throw new AuthorizationError();
  return representativeId;
}
