import { NextRequest } from "next/server";
import { getDatabaseClient } from "@/lib/db/client";
import { authorizeDailyPlanApiRequest, buildDailyPlanCommandContext, dailyPlanApiError, dailyPlanJson, readDailyPlanJson } from "@/lib/plans/api";
import { cancelDailyPlan } from "@/lib/plans/service";
import { parseDailyPlanId, parseDailyPlanTransitionInput } from "@/lib/plans/validation";
export const runtime = "nodejs";
type RouteContext = { readonly params: Promise<{ readonly id: string }> };
export async function POST(request: NextRequest, routeContext: RouteContext) {
  const authorization = await authorizeDailyPlanApiRequest(request, "plans.execute", true);
  if (!authorization.ok) return authorization.response;
  try {
    const { id } = await routeContext.params;
    const result = await cancelDailyPlan(getDatabaseClient(), parseDailyPlanId(id), parseDailyPlanTransitionInput(await readDailyPlanJson(request)), buildDailyPlanCommandContext(authorization, request));
    return dailyPlanJson({ success: true, data: result, requestId: authorization.requestContext.requestId }, 200, authorization.requestContext.requestId);
  } catch (error) { return dailyPlanApiError(error, authorization.requestContext.requestId); }
}
