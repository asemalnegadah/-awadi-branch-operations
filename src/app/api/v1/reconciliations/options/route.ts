import { NextRequest } from "next/server";

import { getDatabaseClient } from "@/lib/db/client";
import {
  authorizeReconciliationApiRequest,
  reconciliationApiError,
  reconciliationJson,
} from "@/lib/reconciliations/api";
import { listReconciliationAccountOptions } from "@/lib/reconciliations/service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = await authorizeReconciliationApiRequest(
    request,
    "reconciliations.create",
    false,
  );
  if (!authorization.ok) return authorization.response;
  try {
    const query = request.nextUrl.searchParams.get("q")?.trim() || undefined;
    const result = await listReconciliationAccountOptions(
      getDatabaseClient(),
      query,
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
