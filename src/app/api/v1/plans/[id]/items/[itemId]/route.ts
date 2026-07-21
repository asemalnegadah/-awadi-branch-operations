import { NextRequest } from "next/server";

import { getDatabaseClient } from "@/lib/db/client";
import {
  authorizeDailyPlanApiRequest,
  buildDailyPlanCommandContext,
  dailyPlanApiError,
  dailyPlanJson,
  readDailyPlanJson,
} from "@/lib/plans/api";
import {
  deleteDailyPlanItem,
  updateDailyPlanItem,
} from "@/lib/plans/management-service";
import {
  parseDailyPlanItemId,
  parseDeleteDailyPlanItemInput,
  parseUpdateDailyPlanItemInput,
} from "@/lib/plans/management-validation";
import { parseDailyPlanId } from "@/lib/plans/validation";

export const runtime = "nodejs";
type RouteContext = {
  readonly params: Promise<{ readonly id: string; readonly itemId: string }>;
};

export async function PATCH(request: NextRequest, routeContext: RouteContext) {
  const authorization = await authorizeDailyPlanApiRequest(request, "plans.manage", true);
  if (!authorization.ok) return authorization.response;
  try {
    const { id, itemId } = await routeContext.params;
    const result = await updateDailyPlanItem(
      getDatabaseClient(),
      parseDailyPlanId(id),
      parseDailyPlanItemId(itemId),
      parseUpdateDailyPlanItemInput(await readDailyPlanJson(request)),
      buildDailyPlanCommandContext(authorization, request),
    );
    return dailyPlanJson(
      { success: true, data: result, requestId: authorization.requestContext.requestId },
      200,
      authorization.requestContext.requestId,
    );
  } catch (error) {
    return dailyPlanApiError(error, authorization.requestContext.requestId);
  }
}

export async function DELETE(request: NextRequest, routeContext: RouteContext) {
  const authorization = await authorizeDailyPlanApiRequest(request, "plans.manage", true);
  if (!authorization.ok) return authorization.response;
  try {
    const { id, itemId } = await routeContext.params;
    const result = await deleteDailyPlanItem(
      getDatabaseClient(),
      parseDailyPlanId(id),
      parseDailyPlanItemId(itemId),
      parseDeleteDailyPlanItemInput(await readDailyPlanJson(request)),
      buildDailyPlanCommandContext(authorization, request),
    );
    return dailyPlanJson(
      { success: true, data: result, requestId: authorization.requestContext.requestId },
      200,
      authorization.requestContext.requestId,
    );
  } catch (error) {
    return dailyPlanApiError(error, authorization.requestContext.requestId);
  }
}
