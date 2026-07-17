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
      : crypto.randomUUID();

  return Object.freeze({
    requestId,
    ipAddress: getTrustedIpCandidate(request),
    userAgent: sanitizeHeader(request.headers.get("user-agent"), 500),
  });
}

function getTrustedIpCandidate(request: NextRequest): string | null {
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp && isIpAddress(cloudflareIp)) {
    return cloudflareIp;
  }

  if (process.env.NODE_ENV !== "production") {
    const localProxyIp = request.headers.get("x-real-ip")?.trim();
    if (localProxyIp && isIpAddress(localProxyIp)) {
      return localProxyIp;
    }
  }

  return null;
}

function isIpAddress(value: string): boolean {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(value)) {
    return value.split(".").every((part) => Number(part) <= 255);
  }

  return /^[0-9a-f:]+$/iu.test(value) && value.includes(":");
}

function sanitizeHeader(value: string | null, maximumLength: number): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, maximumLength);
}
