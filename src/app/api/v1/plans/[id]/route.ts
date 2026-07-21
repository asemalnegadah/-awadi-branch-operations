import { NextRequest } from "next/server";

import { getDatabaseClient } from "@/lib/db/client";
import {
  authorizeDailyPlanApiRequest,
  dailyPlanApiError,
  dailyPlanJson,
} from "@/lib/plans/api";
import { getDailyPlanDetails } from "@/lib/plans/service";
import { parseDailyPlanId } from "@/lib/plans/validation";

export const runtime = "nodejs";
type RouteContext = { readonly params: Promise<{ readonly id: string }> };

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const authorization = await authorizeDailyPlanApiRequest(request, "plans.read_own", false);
  if (!authorization.ok) return authorization.response;
  try {
    const { id } = await routeContext.params;
    const data = await getDailyPlanDetails(
      getDatabaseClient(),
      parseDailyPlanId(id),
      authorization.readContext,
    );
    return dailyPlanJson(
      { success: true, data, requestId: authorization.requestContext.requestId },
      200,
      authorization.requestContext.requestId,
    );
  } catch (error) {
    return dailyPlanApiError(error, authorization.requestContext.requestId);
  }
}
