import type { Sql } from "postgres";

import { requirePermission } from "@/lib/auth/authorization";
import { AuthorizationError } from "@/lib/auth/types";
import { getActiveRepresentativeIdByUserPostgres } from "@/lib/promises/postgres-repository";

import { deriveCreditRiskInputPostgres } from "./postgres-assessment-repository";
import { recalculateCreditRiskIdempotentPostgres } from "./postgres-recalculation-repository";
import type {
  CreditRiskCommandContext,
  CreditRiskReadContext,
  RecalculateCreditRiskInput,
} from "./types";

export async function recalculateCreditRiskSafely(
  sql: Sql,
  input: RecalculateCreditRiskInput,
  context: CreditRiskCommandContext,
) {
  requirePermission(context.actor, "risk.recalculate");
  const representativeScopeId = await resolveRepresentativeScope(sql, context);

  // Enforce record scope before any idempotent replay can reveal an existing assessment.
  await deriveCreditRiskInputPostgres(
    sql,
    input.customerAccountId,
    representativeScopeId,
  );

  return recalculateCreditRiskIdempotentPostgres(
    sql,
    input.customerAccountId,
    context,
    representativeScopeId,
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
