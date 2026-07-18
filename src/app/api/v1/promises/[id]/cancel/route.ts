import { NextRequest } from "next/server";
import { getDatabaseClient } from "@/lib/db/client";
import { authorizePromiseApiRequest, buildPromiseCommandContext, promiseApiError, promiseJson, readPromiseJson } from "@/lib/promises/api";
import { cancelPromise } from "@/lib/promises/service";
import { parseCancelPromiseInput, parsePromiseId } from "@/lib/promises/validation";
export const runtime = "nodejs";
type RouteContext = { readonly params: Promise<{ readonly id: string }> };
export async function POST(request: NextRequest, routeContext: RouteContext) {
  const authorization = await authorizePromiseApiRequest(request, "promises.cancel", true);
  if (!authorization.ok) return authorization.response;
  try {
    const { id } = await routeContext.params;
    const result = await cancelPromise(getDatabaseClient(), parsePromiseId(id), parseCancelPromiseInput(await readPromiseJson(request)), buildPromiseCommandContext(authorization, request));
    return promiseJson({ success: true, data: result, requestId: authorization.requestContext.requestId }, 200, authorization.requestContext.requestId);
  } catch (error) { return promiseApiError(error, authorization.requestContext.requestId); }
}
