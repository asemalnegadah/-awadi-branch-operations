import postgres, { type Sql } from "postgres";

import { getServerEnv } from "@/lib/config/server-env";

declare global {
  var __awadiPostgresClient: Sql | undefined;
}

export function getDatabaseClient(): Sql {
  if (globalThis.__awadiPostgresClient) {
    return globalThis.__awadiPostgresClient;
  }

  const { DATABASE_URL } = getServerEnv();
  const client = postgres(DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
    onnotice: () => undefined,
  });

  if (process.env.NODE_ENV !== "production") {
    globalThis.__awadiPostgresClient = client;
  }

  return client;
}

export async function closeDatabaseClient(): Promise<void> {
  const client = globalThis.__awadiPostgresClient;

  if (!client) {
    return;
  }

  await client.end({ timeout: 5 });
  globalThis.__awadiPostgresClient = undefined;
}
