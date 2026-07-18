import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAuthEnv } from "@/lib/config/server-env";
import { getDatabaseClient } from "@/lib/db/client";

import { getAuthenticatedSessionByToken } from "./postgres-auth-service";
import { SESSION_COOKIE_NAME } from "./session-token";
import type { AuthenticatedSession } from "./types";

export async function getCurrentSession(): Promise<AuthenticatedSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  const authEnv = getAuthEnv();
  return getAuthenticatedSessionByToken(
    getDatabaseClient(),
    token,
    authEnv.AUTH_SECRET,
    authEnv.SESSION_IDLE_TIMEOUT_MINUTES,
  );
}

export async function requireCurrentSession(): Promise<AuthenticatedSession> {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login");
  }

  return session;
}
