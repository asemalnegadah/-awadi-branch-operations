import { NextRequest } from "next/server";
import { getDatabaseClient } from "@/lib/db/client";
import { authorizePromiseApiRequest, buildPromiseCommandContext, promiseApiError, promiseJson, readPromiseJson } from "@/lib/promises/api";
import { reverseCollectionAllocation } from "@/lib/promises/service";
import { parsePromiseId, parseReverseAllocationInput } from "@/lib/promises/validation";
export const runtime = "nodejs";
type RouteContext = { readonly params: Promise<{ readonly id: string; readonly allocationId: string }> };
export async function POST(request: NextRequest, routeContext: RouteContext) {
  const authorization = await authorizePromiseApiRequest(request, "promises.reverse_allocation", true);
  if (!authorization.ok) return authorization.response;
  try {
    const { id, allocationId } = await routeContext.params;
    const result = await reverseCollectionAllocation(getDatabaseClient(), parsePromiseId(id), parsePromiseId(allocationId), parseReverseAllocationInput(await readPromiseJson(request)), buildPromiseCommandContext(authorization, request));
    return promiseJson({ success: true, data: result, requestId: authorization.requestContext.requestId }, 200, authorization.requestContext.requestId);
  } catch (error) { return promiseApiError(error, authorization.requestContext.requestId); }
}
