import { NextRequest } from "next/server";

import { getDatabaseClient } from "@/lib/db/client";
import {
  authorizePromiseApiRequest,
  buildPromiseCommandContext,
  promiseApiError,
  promiseJson,
  readPromiseJson,
} from "@/lib/promises/api";
import { createPromise, listPromises } from "@/lib/promises/service";
import {
  parseCreatePromiseInput,
  parsePromiseListFilters,
} from "@/lib/promises/validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = await authorizePromiseApiRequest(request, "promises.read", false);
  if (!authorization.ok) return authorization.response;
  try {
    const filters = parsePromiseListFilters(request.nextUrl.searchParams);
    const page = await listPromises(getDatabaseClient(), filters, authorization.readContext);
    return promiseJson(
      { success: true, data: page, requestId: authorization.requestContext.requestId },
      200,
      authorization.requestContext.requestId,
    );
  } catch (error) {
    return promiseApiError(error, authorization.requestContext.requestId);
  }
}

export async function POST(request: NextRequest) {
  const authorization = await authorizePromiseApiRequest(request, "promises.create", true);
  if (!authorization.ok) return authorization.response;
  try {
    const input = parseCreatePromiseInput(await readPromiseJson(request));
    const result = await createPromise(
      getDatabaseClient(),
      input,
      buildPromiseCommandContext(authorization, request),
    );
    return promiseJson(
      { success: true, data: result, requestId: authorization.requestContext.requestId },
      result.replayed ? 200 : 201,
      authorization.requestContext.requestId,
    );
  } catch (error) {
    return promiseApiError(error, authorization.requestContext.requestId);
  }
}
