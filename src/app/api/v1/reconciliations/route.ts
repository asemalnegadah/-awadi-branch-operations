import { NextRequest } from "next/server";

import { getDatabaseClient } from "@/lib/db/client";
import {
  authorizeReconciliationApiRequest,
  buildReconciliationCommandContext,
  readReconciliationJson,
  reconciliationApiError,
  reconciliationJson,
} from "@/lib/reconciliations/api";
import {
  createReconciliation,
  listReconciliations,
} from "@/lib/reconciliations/service";
import {
  parseCreateReconciliationInput,
  parseReconciliationListFilters,
} from "@/lib/reconciliations/validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = await authorizeReconciliationApiRequest(
    request,
    "reconciliations.read",
    false,
  );
  if (!authorization.ok) return authorization.response;
  try {
    const result = await listReconciliations(
      getDatabaseClient(),
      parseReconciliationListFilters(request.nextUrl.searchParams),
      authorization.readContext,
    );
    return reconciliationJson(
      { success: true, data: result, requestId: authorization.requestContext.requestId },
      200,
      authorization.requestContext.requestId,
    );
  } catch (error) {
    return reconciliationApiError(error, authorization.requestContext.requestId);
  }
}

export async function POST(request: NextRequest) {
  const authorization = await authorizeReconciliationApiRequest(
    request,
    "reconciliations.create",
    true,
  );
  if (!authorization.ok) return authorization.response;
  try {
    const result = await createReconciliation(
      getDatabaseClient(),
      parseCreateReconciliationInput(await readReconciliationJson(request)),
      buildReconciliationCommandContext(authorization, request),
    );
    return reconciliationJson(
      { success: true, data: result, requestId: authorization.requestContext.requestId },
      result.replayed ? 200 : 201,
      authorization.requestContext.requestId,
    );
  } catch (error) {
    return reconciliationApiError(error, authorization.requestContext.requestId);
  }
}
