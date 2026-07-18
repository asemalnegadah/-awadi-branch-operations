import { randomUUID } from "node:crypto";

import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeDatabaseClient,
  getDatabaseClient,
} from "@/lib/db/client";

import { hashPassword } from "./password";
import {
  getLoginThrottleLockKeys,
  loginPostgres,
  type LoginConfiguration,
} from "./postgres-auth-service";
import { AuthenticationError, type AuthenticationFailureCode } from "./types";

const sql = getDatabaseClient();
const authSecret = "atomic-rate-limit-integration-secret-2026";
const correctPassword = "Atomic-Login-Password-2026";
const successfulEmail = "atomic.login.success@example.test";

beforeAll(async () => {
  const passwordHash = await hashPassword(correctPassword);
  const rows = await sql<{ id: string }[]>`
    INSERT INTO users (
      email,
      full_name,
      password_hash,
      status,
      password_changed_at
    ) VALUES (
      ${successfulEmail},
      'مدير اختبار الحجز الذري',
      ${passwordHash},
      'ACTIVE',
      now()
    )
    RETURNING id
  `;
  const user = rows[0];
  if (!user) throw new Error("تعذر إنشاء مستخدم اختبار الحجز الذري.");

  await sql`
    INSERT INTO user_roles (user_id, role_id, granted_by)
    SELECT ${user.id}, id, ${user.id}
    FROM roles
    WHERE code = 'BRANCH_MANAGER'
  `;
});

afterAll(async () => {
  await closeDatabaseClient();
});

describe("atomic PostgreSQL login throttling", () => {
  it("serializes the same email and IP and never exceeds either limit", async () => {
    let verificationCalls = 0;
    const outcomes = await runBurst(
      sql,
      Array.from({ length: 8 }, () => "atomic.same@example.test"),
      Array.from({ length: 8 }, () => "127.0.1.10"),
      {
        maxEmailAttemptsPer15Minutes: 3,
        maxIpAttemptsPer15Minutes: 3,
        passwordVerifier: async () => {
          verificationCalls += 1;
          return false;
        },
      },
    );

    expect(count(outcomes, "INVALID_CREDENTIALS")).toBe(3);
    expect(count(outcomes, "RATE_LIMITED")).toBe(5);
    expect(verificationCalls).toBe(3);
  });

  it("enforces one IP limit across different emails", async () => {
    const outcomes = await runBurst(
      sql,
      Array.from({ length: 9 }, (_, index) => `atomic.ip.${index}@example.test`),
      Array.from({ length: 9 }, () => "127.0.1.11"),
      {
        maxEmailAttemptsPer15Minutes: 50,
        maxIpAttemptsPer15Minutes: 4,
        passwordVerifier: async () => false,
      },
    );

    expect(count(outcomes, "INVALID_CREDENTIALS")).toBe(4);
    expect(count(outcomes, "RATE_LIMITED")).toBe(5);
  });

  it("enforces one email limit across different IP addresses", async () => {
    const outcomes = await runBurst(
      sql,
      Array.from({ length: 9 }, () => "atomic.email@example.test"),
      Array.from({ length: 9 }, (_, index) => `127.0.2.${index + 1}`),
      {
        maxEmailAttemptsPer15Minutes: 4,
        maxIpAttemptsPer15Minutes: 50,
        passwordVerifier: async () => false,
      },
    );

    expect(count(outcomes, "INVALID_CREDENTIALS")).toBe(4);
    expect(count(outcomes, "RATE_LIMITED")).toBe(5);
  });

  it("does not exceed the limit with independent parallel PostgreSQL connections", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests.");

    const clients = Array.from({ length: 10 }, () =>
      postgres(databaseUrl, {
        max: 1,
        idle_timeout: 5,
        connect_timeout: 5,
        onnotice: () => undefined,
      }),
    );

    try {
      const outcomes = await Promise.all(
        clients.map((client) =>
          captureLogin(
            client,
            "atomic.connections@example.test",
            "127.0.1.12",
            {
              maxEmailAttemptsPer15Minutes: 4,
              maxIpAttemptsPer15Minutes: 4,
              passwordVerifier: async () => false,
            },
          ),
        ),
      );
      expect(count(outcomes, "INVALID_CREDENTIALS")).toBe(4);
      expect(count(outcomes, "RATE_LIMITED")).toBe(6);
    } finally {
      await Promise.all(clients.map((client) => client.end({ timeout: 5 })));
    }
  });

  it("uses a stable lock order and completes a crossed-key burst without deadlock", async () => {
    expect(
      getLoginThrottleLockKeys("stable@example.test", "127.0.3.1"),
    ).toEqual([
      "auth-login:email:stable@example.test",
      "auth-login:ip:127.0.3.1",
    ]);

    const pairs = Array.from({ length: 24 }, (_, index) => ({
      email: `atomic.deadlock.${index % 2}@example.test`,
      ip: `127.0.3.${(index % 2) + 1}`,
    }));
    const execution = Promise.all(
      pairs.map(({ email, ip }) =>
        captureLogin(sql, email, ip, {
          maxEmailAttemptsPer15Minutes: 50,
          maxIpAttemptsPer15Minutes: 50,
          passwordVerifier: async () => false,
        }),
      ),
    );

    const outcomes = await withTimeout(execution, 10_000);
    expect(outcomes).toHaveLength(24);
    expect(outcomes.every((outcome) => outcome === "INVALID_CREDENTIALS")).toBe(true);
  });

  it("allows a correct login within the configured limit", async () => {
    const result = await loginPostgres(
      sql,
      { email: successfulEmail, password: correctPassword },
      context("127.0.1.13"),
      configuration({
        maxEmailAttemptsPer15Minutes: 3,
        maxIpAttemptsPer15Minutes: 3,
      }),
    );

    expect(result.session.user.email).toBe(successfulEmail);
    expect(result.session.user.roles).toContain("BRANCH_MANAGER");
  });

  it("does not persist passwords, auth secrets, session tokens, or connection strings", async () => {
    const successRequestId = randomUUID();
    const failureRequestId = randomUUID();
    const rejectedPassword = "Do-Not-Persist-This-Password-2026";
    const result = await loginPostgres(
      sql,
      { email: successfulEmail, password: correctPassword },
      { ...context("127.0.1.14"), requestId: successRequestId },
      configuration(),
    );
    await expect(
      loginPostgres(
        sql,
        { email: "atomic.secret.failure@example.test", password: rejectedPassword },
        { ...context("127.0.1.16"), requestId: failureRequestId },
        configuration({ passwordVerifier: async () => false }),
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);

    const rows = await sql<Record<string, unknown>[]>`
      SELECT *
      FROM auth_login_attempts
      WHERE request_id IN (${successRequestId}, ${failureRequestId})
      ORDER BY request_id
    `;
    expect(rows).toHaveLength(2);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(rejectedPassword);
    expect(serialized).not.toContain(correctPassword);
    expect(serialized).not.toContain(authSecret);
    expect(serialized).not.toContain(result.token);
    expect(serialized).not.toContain(process.env.DATABASE_URL ?? "__missing_database_url__");
  });

  it("preserves the pending reservation when final result persistence fails", async () => {
    const requestId = randomUUID();
    await sql`
      CREATE TABLE test_auth_login_finalize_failures (
        request_id uuid PRIMARY KEY
      )
    `;
    await sql`
      INSERT INTO test_auth_login_finalize_failures (request_id)
      VALUES (${requestId})
    `;
    await sql`
      CREATE FUNCTION fail_selected_auth_login_finalization()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM test_auth_login_finalize_failures
          WHERE request_id = NEW.request_id
        ) THEN
          RAISE EXCEPTION 'forced auth login finalization failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `;
    await sql`
      CREATE TRIGGER zz_test_auth_login_finalize_failure
      BEFORE UPDATE ON auth_login_attempts
      FOR EACH ROW EXECUTE FUNCTION fail_selected_auth_login_finalization()
    `;

    try {
      await expect(
        loginPostgres(
          sql,
          {
            email: "atomic.finalize.failure@example.test",
            password: "Incorrect-Password-2026",
          },
          { ...context("127.0.1.15"), requestId },
          configuration({ passwordVerifier: async () => false }),
        ),
      ).rejects.toThrow("forced auth login finalization failure");

      const rows = await sql<
        { attempt_state: string; succeeded: boolean | null; completed_at: Date | null }[]
      >`
        SELECT attempt_state, succeeded, completed_at
        FROM auth_login_attempts
        WHERE request_id = ${requestId}
      `;
      expect(rows).toEqual([
        { attempt_state: "PENDING", succeeded: null, completed_at: null },
      ]);
    } finally {
      await sql`
        DROP TRIGGER IF EXISTS zz_test_auth_login_finalize_failure
        ON auth_login_attempts
      `;
      await sql`DROP FUNCTION IF EXISTS fail_selected_auth_login_finalization()`;
      await sql`DROP TABLE IF EXISTS test_auth_login_finalize_failures`;
    }
  });
});

async function runBurst(
  client: Sql,
  emails: readonly string[],
  ips: readonly string[],
  overrides: Partial<LoginConfiguration>,
): Promise<AuthenticationFailureCode[]> {
  if (emails.length !== ips.length) throw new Error("Burst inputs must have equal length.");
  return Promise.all(
    emails.map((email, index) =>
      captureLogin(client, email, ips[index] ?? null, overrides),
    ),
  );
}

async function captureLogin(
  client: Sql,
  email: string,
  ipAddress: string | null,
  overrides: Partial<LoginConfiguration>,
): Promise<AuthenticationFailureCode> {
  try {
    await loginPostgres(
      client,
      { email, password: "Incorrect-Password-2026" },
      context(ipAddress),
      configuration(overrides),
    );
    throw new Error("Expected login to fail.");
  } catch (error) {
    if (error instanceof AuthenticationError) return error.code;
    throw error;
  }
}

function configuration(
  overrides: Partial<LoginConfiguration> = {},
): LoginConfiguration {
  return {
    authSecret,
    sessionTtlHours: 8,
    sessionIdleTimeoutMinutes: 60,
    maxEmailAttemptsPer15Minutes: 10,
    maxIpAttemptsPer15Minutes: 30,
    ...overrides,
  };
}

function context(ipAddress: string | null) {
  return Object.freeze({
    requestId: randomUUID(),
    ipAddress,
    userAgent: "atomic-login-integration-test",
  });
}

function count(
  outcomes: readonly AuthenticationFailureCode[],
  code: AuthenticationFailureCode,
): number {
  return outcomes.filter((outcome) => outcome === code).length;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out after ${milliseconds}ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
