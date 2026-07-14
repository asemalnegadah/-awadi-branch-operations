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

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | undefined;

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

export function resetServerEnvForTests(): void {
  cachedEnv = undefined;
}
