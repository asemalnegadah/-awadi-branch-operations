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
  return isIpv4Address(value) || isIpv6Address(value);
}

function isIpv4Address(value: string): boolean {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(value)) {
    return false;
  }

  return value.split(".").every((part) => {
    if (part.length > 1 && part.startsWith("0")) return false;
    const numeric = Number(part);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 255;
  });
}

function isIpv6Address(value: string): boolean {
  if (
    !value.includes(":") ||
    value.includes("%") ||
    value.includes("[") ||
    value.includes("]") ||
    !/^[0-9a-f:.]+$/iu.test(value)
  ) {
    return false;
  }

  const compressionParts = value.split("::");
  if (compressionParts.length > 2) return false;

  const hasCompression = compressionParts.length === 2;
  if (!hasCompression && (value.startsWith(":") || value.endsWith(":"))) {
    return false;
  }

  const left = parseIpv6Side(compressionParts[0] ?? "", hasCompression);
  const right = parseIpv6Side(compressionParts[1] ?? "", hasCompression);
  if (!left.valid || !right.valid) return false;
  if (left.hasIpv4 && hasCompression) return false;

  const totalGroups = left.groupCount + right.groupCount;
  return hasCompression ? totalGroups < 8 : totalGroups === 8;
}

function parseIpv6Side(
  value: string,
  allowEmpty: boolean,
): { readonly valid: boolean; readonly groupCount: number; readonly hasIpv4: boolean } {
  if (!value) {
    return { valid: allowEmpty, groupCount: 0, hasIpv4: false };
  }

  const groups = value.split(":");
  if (groups.some((group) => group.length === 0)) {
    return { valid: false, groupCount: 0, hasIpv4: false };
  }

  let groupCount = 0;
  let hasIpv4 = false;
  for (const [index, group] of groups.entries()) {
    if (group.includes(".")) {
      if (index !== groups.length - 1 || hasIpv4 || !isIpv4Address(group)) {
        return { valid: false, groupCount: 0, hasIpv4: false };
      }
      groupCount += 2;
      hasIpv4 = true;
      continue;
    }

    if (!/^[0-9a-f]{1,4}$/iu.test(group)) {
      return { valid: false, groupCount: 0, hasIpv4: false };
    }
    groupCount += 1;
  }

  return { valid: true, groupCount, hasIpv4 };
}

function sanitizeHeader(value: string | null, maximumLength: number): string | null {
  if (!value) {
    return null;
  }

  return value.replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, maximumLength);
}
