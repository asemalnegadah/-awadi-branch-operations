import { NextRequest } from "next/server";

import { getDatabaseClient } from "@/lib/db/client";
import {
  authorizeDailyPlanApiRequest,
  dailyPlanApiError,
  dailyPlanJson,
} from "@/lib/plans/api";
import { listDailyPlans } from "@/lib/plans/service";
import { parseDailyPlanListFilters } from "@/lib/plans/validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = await authorizeDailyPlanApiRequest(request, "plans.read_own", false);
  if (!authorization.ok) return authorization.response;
  try {
    const data = await listDailyPlans(
      getDatabaseClient(),
      parseDailyPlanListFilters(request.nextUrl.searchParams),
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
