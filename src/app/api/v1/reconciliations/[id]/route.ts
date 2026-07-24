import { NextRequest } from "next/server";

import { getDatabaseClient } from "@/lib/db/client";
import {
  authorizeReconciliationApiRequest,
  reconciliationApiError,
  reconciliationJson,
} from "@/lib/reconciliations/api";
import { getReconciliationDetails } from "@/lib/reconciliations/service";
import { parseReconciliationId } from "@/lib/reconciliations/validation";

export const runtime = "nodejs";
type RouteContext = { readonly params: Promise<{ readonly id: string }> };

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const authorization = await authorizeReconciliationApiRequest(
    request,
    "reconciliations.read",
    false,
  );
  if (!authorization.ok) return authorization.response;
  try {
    const { id } = await routeContext.params;
    const result = await getReconciliationDetails(
      getDatabaseClient(),
      parseReconciliationId(id),
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
