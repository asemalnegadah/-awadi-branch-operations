import { NextRequest } from "next/server";

import { getDatabaseClient } from "@/lib/db/client";
import {
  authorizeDailyPlanApiRequest,
  buildDailyPlanCommandContext,
  dailyPlanApiError,
  dailyPlanJson,
  readDailyPlanJson,
} from "@/lib/plans/api";
import { generateDailyPlan } from "@/lib/plans/service";
import { parseGenerateDailyPlanInput } from "@/lib/plans/validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authorization = await authorizeDailyPlanApiRequest(request, "plans.generate", true);
  if (!authorization.ok) return authorization.response;
  try {
    const result = await generateDailyPlan(
      getDatabaseClient(),
      parseGenerateDailyPlanInput(await readDailyPlanJson(request)),
      buildDailyPlanCommandContext(authorization, request),
    );
    return dailyPlanJson(
      { success: true, data: result, requestId: authorization.requestContext.requestId },
      result.replayed ? 200 : 201,
      authorization.requestContext.requestId,
    );
  } catch (error) {
    return dailyPlanApiError(error, authorization.requestContext.requestId);
  }
}
