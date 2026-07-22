import { NextRequest } from "next/server";

import { getDatabaseClient } from "@/lib/db/client";
import { authorizeFieldVisitApiRequest, fieldVisitApiError, fieldVisitJson } from "@/lib/visits/api";
import { parseFieldVisitId } from "@/lib/visits/route-validation";
import { getFieldVisitDetails } from "@/lib/visits/service";

export const runtime = "nodejs";
type RouteContext = { readonly params: Promise<{ readonly id: string }> };

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const authorization = await authorizeFieldVisitApiRequest(request, "visits.read_own", false);
  if (!authorization.ok) return authorization.response;
  try {
    const { id } = await routeContext.params;
    const data = await getFieldVisitDetails(
      getDatabaseClient(),
      parseFieldVisitId(id),
      authorization.readContext,
    );
    return fieldVisitJson(
      { success: true, data, requestId: authorization.requestContext.requestId },
      200,
      authorization.requestContext.requestId,
    );
  } catch (error) {
    return fieldVisitApiError(error, authorization.requestContext.requestId);
  }
}
