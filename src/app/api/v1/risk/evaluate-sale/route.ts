import { NextRequest } from "next/server";
import { z } from "zod";

import { getDatabaseClient } from "@/lib/db/client";
import {
  authorizeCreditRiskApiRequest,
  creditRiskApiError,
  readCreditRiskJson,
  riskJson,
} from "@/lib/risk/api";
import { evaluateCreditSale } from "@/lib/risk/service";

export const runtime = "nodejs";

const schema = z
  .object({
    customerAccountId: z.string().uuid(),
    amountMinor: z.number().int().safe().positive(),
  })
  .strict();

export async function POST(request: NextRequest) {
  const authorization = await authorizeCreditRiskApiRequest(request, "risk.read", false);
  if (!authorization.ok) return authorization.response;
  try {
    const input = schema.parse(await readCreditRiskJson(request));
    const data = await evaluateCreditSale(
      getDatabaseClient(),
      input.customerAccountId,
      input.amountMinor,
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
