import { NextRequest } from "next/server";
import type { Sql } from "postgres";

import type { PermissionCode } from "@/lib/auth/permissions";
import { getDatabaseClient } from "@/lib/db/client";

import {
  authorizeReconciliationApiRequest,
  buildReconciliationCommandContext,
  readReconciliationJson,
  reconciliationApiError,
  reconciliationJson,
} from "./api";
import type {
  ReconciliationCommandContext,
  ReconciliationMutationResult,
  ReconciliationTransitionInput,
} from "./types";
import {
  parseReconciliationId,
  parseReconciliationTransitionInput,
} from "./validation";

export type ReconciliationTransitionService = (
  sql: Sql,
  reconciliationId: string,
  input: ReconciliationTransitionInput,
  context: ReconciliationCommandContext,
) => Promise<ReconciliationMutationResult>;

export async function handleReconciliationTransition(
  request: NextRequest,
  rawId: string,
  permission: PermissionCode | readonly PermissionCode[],
  service: ReconciliationTransitionService,
) {
  const authorization = await authorizeReconciliationApiRequest(request, permission, true);
  if (!authorization.ok) return authorization.response;
  try {
    const result = await service(
      getDatabaseClient(),
      parseReconciliationId(rawId),
      parseReconciliationTransitionInput(await readReconciliationJson(request)),
      buildReconciliationCommandContext(authorization, request),
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
