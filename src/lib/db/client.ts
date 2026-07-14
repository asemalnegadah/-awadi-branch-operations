import postgres, { type Sql } from "postgres";

import { getServerEnv } from "@/lib/config/server-env";

declare global {
  var __awadiPostgresClient: Sql | undefined;
  var __awadiPostgresClientUrl: string | undefined;
}

export function getDatabaseClient(): Sql {
  const { DATABASE_URL } = getServerEnv();
  const existing = globalThis.__awadiPostgresClient;

  if (existing) {
    if (globalThis.__awadiPostgresClientUrl !== DATABASE_URL) {
      throw new Error(
        "تم تغيير DATABASE_URL بعد إنشاء عميل PostgreSQL؛ أعد تشغيل العملية بدل فتح pool ثانٍ.",
      );
    }

    return existing;
  }

  const client = postgres(DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
    onnotice: () => undefined,
  });

  // Reuse one pool per warm process in development and production. This avoids
  // opening a new pool for every Next.js request while still allowing explicit
  // shutdown in tests and command-line jobs.
  globalThis.__awadiPostgresClient = client;
  globalThis.__awadiPostgresClientUrl = DATABASE_URL;

  return client;
}

export async function closeDatabaseClient(): Promise<void> {
  const client = globalThis.__awadiPostgresClient;

  if (!client) {
    return;
  }

  await client.end({ timeout: 5 });
  globalThis.__awadiPostgresClient = undefined;
  globalThis.__awadiPostgresClientUrl = undefined;
}
