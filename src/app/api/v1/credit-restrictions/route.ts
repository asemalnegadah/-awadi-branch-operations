import { NextRequest } from "next/server";

import { getDatabaseClient } from "@/lib/db/client";
import {
  authorizeCreditRiskApiRequest,
  buildCreditRiskCommandContext,
  creditRiskApiError,
  readCreditRiskJson,
  riskJson,
} from "@/lib/risk/api";
import { createCreditRestriction } from "@/lib/risk/service";
import { parseCreateCreditRestrictionInput } from "@/lib/risk/validation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authorization = await authorizeCreditRiskApiRequest(
    request,
    "credit_restrictions.propose",
    true,
  );
  if (!authorization.ok) return authorization.response;
  try {
    const result = await createCreditRestriction(
      getDatabaseClient(),
      parseCreateCreditRestrictionInput(await readCreditRiskJson(request)),
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
