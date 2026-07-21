import { NextRequest } from "next/server";
import { getDatabaseClient } from "@/lib/db/client";
import { authorizeCreditRiskApiRequest, buildCreditRiskCommandContext, creditRiskApiError, readCreditRiskJson, riskJson } from "@/lib/risk/api";
import { approveCreditException } from "@/lib/risk/service";
import { parseDecisionTransitionInput, parseRiskId } from "@/lib/risk/validation";
export const runtime = "nodejs";
type RouteContext = { readonly params: Promise<{ readonly id: string }> };
export async function POST(request: NextRequest, routeContext: RouteContext) {
  const authorization = await authorizeCreditRiskApiRequest(request, "credit_exceptions.approve", true);
  if (!authorization.ok) return authorization.response;
  try {
    const { id } = await routeContext.params;
    const result = await approveCreditException(getDatabaseClient(), parseRiskId(id), parseDecisionTransitionInput(await readCreditRiskJson(request)), buildCreditRiskCommandContext(authorization, request));
    return riskJson({ success: true, data: result, requestId: authorization.requestContext.requestId }, 200, authorization.requestContext.requestId);
  } catch (error) { return creditRiskApiError(error, authorization.requestContext.requestId); }
}
