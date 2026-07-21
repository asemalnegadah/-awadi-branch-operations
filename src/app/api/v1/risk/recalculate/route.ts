import { NextRequest } from "next/server";

import { getDatabaseClient } from "@/lib/db/client";
import {
  authorizeCreditRiskApiRequest,
  buildCreditRiskCommandContext,
  creditRiskApiError,
  readCreditRiskJson,
  riskJson,
} from "@/lib/risk/api";
import { recalculateCreditRisk } from "@/lib/risk/service";
import { parseRecalculateCreditRiskInput } from "@/lib/risk/validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authorization = await authorizeCreditRiskApiRequest(request, "risk.recalculate", true);
  if (!authorization.ok) return authorization.response;
  try {
    const result = await recalculateCreditRisk(
      getDatabaseClient(),
      parseRecalculateCreditRiskInput(await readCreditRiskJson(request)),
      buildCreditRiskCommandContext(authorization, request),
    );
    return riskJson(
      { success: true, data: result, requestId: authorization.requestContext.requestId },
      result.replayed ? 200 : 201,
      authorization.requestContext.requestId,
    );
  } catch (error) {
    return creditRiskApiError(error, authorization.requestContext.requestId);
  }
}
