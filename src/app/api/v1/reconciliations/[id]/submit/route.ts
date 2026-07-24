import { NextRequest } from "next/server";

import { handleReconciliationTransition } from "@/lib/reconciliations/http-handlers";
import { submitReconciliation } from "@/lib/reconciliations/service";

export const runtime = "nodejs";
type RouteContext = { readonly params: Promise<{ readonly id: string }> };

export async function POST(request: NextRequest, routeContext: RouteContext) {
  const { id } = await routeContext.params;
  return handleReconciliationTransition(
    request,
    id,
    "reconciliations.create",
    submitReconciliation,
  );
}
