import { NextRequest } from "next/server";
import { getDatabaseClient } from "@/lib/db/client";
import { authorizeFieldVisitApiRequest, buildFieldVisitCommandContext, fieldVisitApiError, fieldVisitJson, readFieldVisitJson } from "@/lib/visits/api";
import { parseFieldVisitId } from "@/lib/visits/route-validation";
import { addFieldVisitEvidence } from "@/lib/visits/service";
import { parseFieldVisitEvidence } from "@/lib/visits/validation";
export const runtime = "nodejs";
type RouteContext = { readonly params: Promise<{ readonly id: string }> };
export async function POST(request: NextRequest, routeContext: RouteContext) {
  const authorization = await authorizeFieldVisitApiRequest(request, "visits.manage", true);
  if (!authorization.ok) return authorization.response;
  try {
    const { id } = await routeContext.params;
    const data = await addFieldVisitEvidence(getDatabaseClient(), parseFieldVisitId(id), parseFieldVisitEvidence(await readFieldVisitJson(request)), buildFieldVisitCommandContext(authorization, request));
    return fieldVisitJson({ success: true, data, requestId: authorization.requestContext.requestId }, data.replayed ? 200 : 201, authorization.requestContext.requestId);
  } catch (error) { return fieldVisitApiError(error, authorization.requestContext.requestId); }
}
