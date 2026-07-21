import { NextRequest } from "next/server";

import { getDatabaseClient } from "@/lib/db/client";
import {
  authorizeCreditRiskApiRequest,
  buildCreditRiskCommandContext,
  creditRiskApiError,
  readCreditRiskJson,
  riskJson,
} from "@/lib/risk/api";
import { consumeCreditException } from "@/lib/risk/usage-service";
import { parseConsumeCreditExceptionInput } from "@/lib/risk/usage-validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authorization = await authorizeCreditRiskApiRequest(
    request,
    "credit_exceptions.consume",
    true,
  );
  if (!authorization.ok) return authorization.response;
  try {
    const result = await consumeCreditException(
      getDatabaseClient(),
      parseConsumeCreditExceptionInput(await readCreditRiskJson(request)),
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
