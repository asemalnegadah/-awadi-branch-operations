import { NextRequest } from "next/server";

import { getDatabaseClient } from "@/lib/db/client";
import {
  authorizeFieldVisitApiRequest,
  buildFieldVisitCommandContext,
  fieldVisitApiError,
  fieldVisitJson,
  readFieldVisitJson,
} from "@/lib/visits/api";
import { createFieldVisit, listFieldVisits } from "@/lib/visits/service";
import { parseCreateFieldVisit, parseFieldVisitListFilters } from "@/lib/visits/validation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = await authorizeFieldVisitApiRequest(request, "visits.read_own", false);
  if (!authorization.ok) return authorization.response;
  try {
    const data = await listFieldVisits(
      getDatabaseClient(),
      parseFieldVisitListFilters(request.nextUrl.searchParams),
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

export async function POST(request: NextRequest) {
  const authorization = await authorizeFieldVisitApiRequest(request, "visits.create", true);
  if (!authorization.ok) return authorization.response;
  try {
    const data = await createFieldVisit(
      getDatabaseClient(),
      parseCreateFieldVisit(await readFieldVisitJson(request)),
      buildFieldVisitCommandContext(authorization, request),
    );
    return fieldVisitJson(
      { success: true, data, requestId: authorization.requestContext.requestId },
      data.replayed ? 200 : 201,
      authorization.requestContext.requestId,
    );
  } catch (error) {
    return fieldVisitApiError(error, authorization.requestContext.requestId);
  }
}
