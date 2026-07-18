import { NextRequest } from "next/server";

import { getDatabaseClient } from "@/lib/db/client";
import { authorizePromiseApiRequest, promiseApiError, promiseJson } from "@/lib/promises/api";
import { getPromiseHistory } from "@/lib/promises/service";
import { parsePromiseId } from "@/lib/promises/validation";

export const runtime = "nodejs";
type RouteContext = { readonly params: Promise<{ readonly id: string }> };

export async function GET(request: NextRequest, routeContext: RouteContext) {
  const authorization = await authorizePromiseApiRequest(
    request,
    "promises.view_history",
    false,
  );
  if (!authorization.ok) return authorization.response;
  try {
    const { id } = await routeContext.params;
    const history = await getPromiseHistory(
      getDatabaseClient(),
      parsePromiseId(id),
      authorization.readContext,
    );
    return promiseJson(
      { success: true, data: history, requestId: authorization.requestContext.requestId },
      200,
      authorization.requestContext.requestId,
    );
  } catch (error) {
    return promiseApiError(error, authorization.requestContext.requestId);
  }
}
