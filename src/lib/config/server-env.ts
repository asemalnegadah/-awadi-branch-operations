import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .trim()
    .min(1)
    .refine(
      (value) =>
        value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "DATABASE_URL must be a PostgreSQL connection string",
    ),
});

const authEnvSchema = z.object({
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must contain at least 32 characters"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24).default(8),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type AuthEnv = z.infer<typeof authEnvSchema>;

let cachedEnv: ServerEnv | undefined;
let cachedAuthEnv: AuthEnv | undefined;

export function getServerEnv(
  environment: NodeJS.ProcessEnv = process.env,
): ServerEnv {
  if (environment === process.env && cachedEnv) {
    return cachedEnv;
  }

  const parsed = serverEnvSchema.parse(environment);

  if (environment === process.env) {
    cachedEnv = Object.freeze(parsed);
  }

  return parsed;
}

export function getAuthEnv(
  environment: NodeJS.ProcessEnv = process.env,
): AuthEnv {
  if (environment === process.env && cachedAuthEnv) {
    return cachedAuthEnv;
  }

  const parsed = authEnvSchema.parse(environment);

  if (environment === process.env) {
    cachedAuthEnv = Object.freeze(parsed);
  }

  return parsed;
}

export function resetServerEnvForTests(): void {
  cachedEnv = undefined;
  cachedAuthEnv = undefined;
}
