import { NextRequest } from "next/server";
import { getDatabaseClient } from "@/lib/db/client";
import { authorizeFieldVisitApiRequest, buildFieldVisitCommandContext, fieldVisitApiError, fieldVisitJson, readFieldVisitJson } from "@/lib/visits/api";
import { recordDailyPlanItemResult } from "@/lib/visits/service";
import { parsePlanItemResult } from "@/lib/visits/validation";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const authorization = await authorizeFieldVisitApiRequest(request, "plans.execute", true);
  if (!authorization.ok) return authorization.response;
  try {
    const data = await recordDailyPlanItemResult(getDatabaseClient(), parsePlanItemResult(await readFieldVisitJson(request)), buildFieldVisitCommandContext(authorization, request));
    return fieldVisitJson({ success: true, data, requestId: authorization.requestContext.requestId }, data.replayed ? 200 : 201, authorization.requestContext.requestId);
  } catch (error) { return fieldVisitApiError(error, authorization.requestContext.requestId); }
}
