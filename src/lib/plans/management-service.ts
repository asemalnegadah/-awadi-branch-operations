import type { Sql } from "postgres";

import { requirePermission } from "@/lib/auth/authorization";

import type {
  DeleteDailyPlanItemInput,
  UpdateDailyPlanItemInput,
} from "./management-types";
import {
  deleteDailyPlanItemPostgres,
  updateDailyPlanItemPostgres,
} from "./postgres-management-repository";
import type { DailyPlanCommandContext } from "./types";

export async function updateDailyPlanItem(
  sql: Sql,
  planId: string,
  itemId: string,
  input: UpdateDailyPlanItemInput,
  context: DailyPlanCommandContext,
) {
  requirePermission(context.actor, "plans.manage");
  return updateDailyPlanItemPostgres(sql, planId, itemId, input, context);
}

export async function deleteDailyPlanItem(
  sql: Sql,
  planId: string,
  itemId: string,
  input: DeleteDailyPlanItemInput,
  context: DailyPlanCommandContext,
) {
  requirePermission(context.actor, "plans.manage");
  return deleteDailyPlanItemPostgres(sql, planId, itemId, input, context);
}
