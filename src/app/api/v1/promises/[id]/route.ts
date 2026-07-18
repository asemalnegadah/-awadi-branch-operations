import { NextRequest } from "next/server";

import { getDatabaseClient } from "@/lib/db/client";
import {
  authorizePromiseApiRequest,
  buildPromiseCommandContext,
  promiseApiError,
  promiseJson,
  readPromiseJson,
} from "@/lib/promises/api";
import { getPromise, updatePromise } from "@/lib/promises/service";
import { parsePromiseId, parseUpdatePromiseInput } from "@/lib/promises/validation";

export const runtime = "nodejs";

type RouteContext = { readonly params: Promise<{ readonly id: string }> };

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const authorization = await authorizePromiseApiRequest(request, "promises.read", false);
  if (!authorization.ok) return authorization.response;
  try {
    const { id } = await routeContext.params;
    const promise = await getPromise(
      getDatabaseClient(),
      parsePromiseId(id),
      authorization.readContext,
    );
    return promiseJson(
      { success: true, data: promise, requestId: authorization.requestContext.requestId },
      200,
      authorization.requestContext.requestId,
    );
  } catch (error) {
    return promiseApiError(error, authorization.requestContext.requestId);
  }
}

export async function PATCH(request: NextRequest, routeContext: RouteContext) {
  const authorization = await authorizePromiseApiRequest(request, "promises.update", true);
  if (!authorization.ok) return authorization.response;
  try {
    const { id } = await routeContext.params;
    const result = await updatePromise(
      getDatabaseClient(),
      parsePromiseId(id),
      parseUpdatePromiseInput(await readPromiseJson(request)),
      buildPromiseCommandContext(authorization, request),
    );
    return promiseJson(
      { success: true, data: result, requestId: authorization.requestContext.requestId },
      200,
      authorization.requestContext.requestId,
    );
  } catch (error) {
    return promiseApiError(error, authorization.requestContext.requestId);
  }
}
