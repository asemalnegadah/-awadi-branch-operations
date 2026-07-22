import { NextRequest } from "next/server";
import { getDatabaseClient } from "@/lib/db/client";
import { authorizeFieldVisitApiRequest, buildFieldVisitCommandContext, fieldVisitApiError, fieldVisitJson, readFieldVisitJson } from "@/lib/visits/api";
import { parseFieldVisitId } from "@/lib/visits/route-validation";
import { cancelFieldVisit } from "@/lib/visits/service";
import { parseFieldVisitTransition } from "@/lib/visits/validation";
export const runtime = "nodejs";
type RouteContext = { readonly params: Promise<{ readonly id: string }> };
export async function POST(request: NextRequest, routeContext: RouteContext) {
  const authorization = await authorizeFieldVisitApiRequest(request, "visits.manage", true);
  if (!authorization.ok) return authorization.response;
  try {
    const { id } = await routeContext.params;
    const data = await cancelFieldVisit(getDatabaseClient(), parseFieldVisitId(id), parseFieldVisitTransition(await readFieldVisitJson(request)), buildFieldVisitCommandContext(authorization, request));
    return fieldVisitJson({ success: true, data, requestId: authorization.requestContext.requestId }, 200, authorization.requestContext.requestId);
  } catch (error) { return fieldVisitApiError(error, authorization.requestContext.requestId); }
}
