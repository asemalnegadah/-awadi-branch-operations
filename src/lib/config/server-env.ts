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

const sharedAuthFields = {
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must contain at least 32 characters"),
  APP_BASE_URL: z.string().url(),
  TRUSTED_ORIGINS: z.string().trim().optional().default(""),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24).default(8),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(480)
    .default(60),
  LOGIN_EMAIL_MAX_PER_15_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(50)
    .default(10),
  LOGIN_IP_MAX_PER_15_MINUTES: z.coerce
    .number()
    .int()
    .min(10)
    .max(200)
    .default(30),
};

const authEnvSchema = z.object(sharedAuthFields);

const passwordRecoveryEnvSchema = z
  .object({
    ...sharedAuthFields,
    RESEND_API_KEY: z.string().trim().min(1),
    EMAIL_FROM: z.string().trim().min(3).refine((value) => value.includes("@"), {
      message: "EMAIL_FROM must contain an email address",
    }),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(10).max(60).default(30),
    PASSWORD_RESET_EMAIL_MAX_PER_HOUR: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(3),
    PASSWORD_RESET_IP_MAX_PER_HOUR: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10),
    ALLOW_INITIAL_MANAGER_EMAIL_BOOTSTRAP: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    INITIAL_MANAGER_EMAIL: z.string().trim().email().optional(),
    INITIAL_MANAGER_NAME: z.string().trim().min(2).max(200).optional(),
  })
  .superRefine((value, context) => {
    if (
      value.ALLOW_INITIAL_MANAGER_EMAIL_BOOTSTRAP &&
      (!value.INITIAL_MANAGER_EMAIL || !value.INITIAL_MANAGER_NAME)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "INITIAL_MANAGER_EMAIL and INITIAL_MANAGER_NAME are required when initial manager email bootstrap is enabled",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type AuthEnv = z.infer<typeof authEnvSchema> & {
  readonly TRUSTED_ORIGIN_SET: ReadonlySet<string>;
};
export type PasswordRecoveryEnv = z.infer<typeof passwordRecoveryEnvSchema> & {
  readonly TRUSTED_ORIGIN_SET: ReadonlySet<string>;
};

let cachedEnv: ServerEnv | undefined;
let cachedAuthEnv: AuthEnv | undefined;
let cachedPasswordRecoveryEnv: PasswordRecoveryEnv | undefined;

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

  const parsed = finalizeAuthEnvironment(authEnvSchema.parse(environment), environment);

  if (environment === process.env) {
    cachedAuthEnv = parsed;
  }

  return parsed;
}

export function getPasswordRecoveryEnv(
  environment: NodeJS.ProcessEnv = process.env,
): PasswordRecoveryEnv {
  if (environment === process.env && cachedPasswordRecoveryEnv) {
    return cachedPasswordRecoveryEnv;
  }

  const parsed = finalizeAuthEnvironment(
    passwordRecoveryEnvSchema.parse(environment),
    environment,
  );

  if (environment === process.env) {
    cachedPasswordRecoveryEnv = parsed;
  }

  return parsed;
}

export function resetServerEnvForTests(): void {
  cachedEnv = undefined;
  cachedAuthEnv = undefined;
  cachedPasswordRecoveryEnv = undefined;
}

function finalizeAuthEnvironment<
  T extends { APP_BASE_URL: string; TRUSTED_ORIGINS: string },
>(parsed: T, environment: NodeJS.ProcessEnv): T & {
  readonly TRUSTED_ORIGIN_SET: ReadonlySet<string>;
} {
  const baseUrl = validateOriginUrl(parsed.APP_BASE_URL, "APP_BASE_URL");

  if (environment.NODE_ENV === "production" && baseUrl.protocol !== "https:") {
    throw new Error("APP_BASE_URL must use HTTPS in production.");
  }

  const trustedOrigins = new Set<string>([baseUrl.origin]);
  for (const rawOrigin of parsed.TRUSTED_ORIGINS.split(",")) {
    const candidate = rawOrigin.trim();
    if (!candidate) {
      continue;
    }

    const originUrl = validateOriginUrl(candidate, "TRUSTED_ORIGINS");
    if (environment.NODE_ENV === "production" && originUrl.protocol !== "https:") {
      throw new Error("TRUSTED_ORIGINS must use HTTPS in production.");
    }
    trustedOrigins.add(originUrl.origin);
  }

  return Object.freeze({
    ...parsed,
    TRUSTED_ORIGIN_SET: Object.freeze(trustedOrigins),
  });
}

function validateOriginUrl(value: string, fieldName: string): URL {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${fieldName} must use HTTP or HTTPS.`);
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${fieldName} must contain origins only, without paths or credentials.`);
  }
  return parsed;
}
