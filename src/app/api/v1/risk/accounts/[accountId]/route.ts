import { NextRequest } from "next/server";

import { getDatabaseClient } from "@/lib/db/client";
import {
  authorizeCreditRiskApiRequest,
  creditRiskApiError,
  riskJson,
} from "@/lib/risk/api";
import { getCreditRiskAccountDetails } from "@/lib/risk/service";
import { parseRiskId } from "@/lib/risk/validation";

export const runtime = "nodejs";
type RouteContext = { readonly params: Promise<{ readonly accountId: string }> };

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const authorization = await authorizeCreditRiskApiRequest(request, "risk.read", false);
  if (!authorization.ok) return authorization.response;
  try {
    const { accountId } = await routeContext.params;
    const data = await getCreditRiskAccountDetails(
      getDatabaseClient(),
      parseRiskId(accountId),
      authorization.readContext,
    );
    return riskJson(
      { success: true, data, requestId: authorization.requestContext.requestId },
      200,
      authorization.requestContext.requestId,
    );
  } catch (error) {
    return creditRiskApiError(error, authorization.requestContext.requestId);
  }
}
