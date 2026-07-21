import { NextRequest } from "next/server";

import { getDatabaseClient } from "@/lib/db/client";
import {
  authorizeCreditRiskApiRequest,
  creditRiskApiError,
  riskJson,
} from "@/lib/risk/api";
import { listCreditRiskAccounts } from "@/lib/risk/service";
import { parseCreditRiskListFilters } from "@/lib/risk/validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = await authorizeCreditRiskApiRequest(request, "risk.read", false);
  if (!authorization.ok) return authorization.response;
  try {
    const data = await listCreditRiskAccounts(
      getDatabaseClient(),
      parseCreditRiskListFilters(request.nextUrl.searchParams),
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
