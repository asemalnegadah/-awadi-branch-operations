import type { NextRequest } from "next/server";

export function isSameOriginWrite(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }

  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}
