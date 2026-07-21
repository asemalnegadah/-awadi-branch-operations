import type { Sql } from "postgres";

import { requirePermission } from "@/lib/auth/authorization";
import { AuthorizationError } from "@/lib/auth/types";
import { getActiveRepresentativeIdByUserPostgres } from "@/lib/promises/postgres-repository";

import {
  consumeCreditExceptionPostgres,
  evaluateCreditSaleWithUsagePostgres,
  listCreditExceptionUsagesPostgres,
  reverseCreditExceptionUsagePostgres,
} from "./postgres-usage-repository";
import type { CreditRiskCommandContext, CreditRiskReadContext } from "./types";
import type {
  ConsumeCreditExceptionInput,
  ReverseCreditExceptionUsageInput,
} from "./usage-types";

export async function consumeCreditException(
  sql: Sql,
  input: ConsumeCreditExceptionInput,
  context: CreditRiskCommandContext,
) {
  requirePermission(context.actor, "credit_exceptions.consume");
  return consumeCreditExceptionPostgres(
    sql,
    input,
    context,
    await resolveRepresentativeScope(sql, context),
  );
}

export async function reverseCreditExceptionUsage(
  sql: Sql,
  input: ReverseCreditExceptionUsageInput,
  context: CreditRiskCommandContext,
) {
  requirePermission(context.actor, "credit_exceptions.consume");
  return reverseCreditExceptionUsagePostgres(
    sql,
    input,
    context,
    await resolveRepresentativeScope(sql, context),
  );
}

export async function listCreditExceptionUsages(
  sql: Sql,
  customerAccountId: string,
  context: CreditRiskReadContext,
) {
  requirePermission(context.actor, "risk.view_history");
  return listCreditExceptionUsagesPostgres(
    sql,
    customerAccountId,
    await resolveRepresentativeScope(sql, context),
  );
}

export async function evaluateCreditSaleWithUsage(
  sql: Sql,
  customerAccountId: string,
  amountMinor: number,
  context: CreditRiskReadContext,
) {
  requirePermission(context.actor, "risk.read");
  return evaluateCreditSaleWithUsagePostgres(
    sql,
    customerAccountId,
    amountMinor,
    await resolveRepresentativeScope(sql, context),
  );
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
