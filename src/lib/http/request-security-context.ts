import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

import type { NextRequest } from "next/server";

import type { RequestSecurityContext } from "@/lib/auth/types";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getRequestSecurityContext(
  request: NextRequest,
): RequestSecurityContext {
  const suppliedRequestId = request.headers.get("x-request-id")?.trim();
  const requestId =
    suppliedRequestId && uuidPattern.test(suppliedRequestId)
      ? suppliedRequestId
      : randomUUID();

  return Object.freeze({
    requestId,
    ipAddress: getTrustedIpCandidate(request),
    userAgent: truncate(request.headers.get("user-agent"), 500),
  });
}

function getTrustedIpCandidate(request: NextRequest): string | null {
  const candidates = [
    request.headers.get("cf-connecting-ip"),
    request.headers.get("x-real-ip"),
    request.headers.get("x-forwarded-for")?.split(",")[0],
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && isIP(value) !== 0) {
      return value;
    }
  }

  return null;
}

function truncate(value: string | null, maximumLength: number): string | null {
  if (!value) {
    return null;
  }

  return value.slice(0, maximumLength);
}
