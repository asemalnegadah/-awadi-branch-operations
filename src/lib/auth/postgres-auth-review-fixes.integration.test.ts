import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeDatabaseClient,
  getDatabaseClient,
} from "@/lib/db/client";

import { hashPassword } from "./password";
import {
  getAuthenticatedSessionByToken,
  loginPostgres,
} from "./postgres-auth-service";
import { AuthenticationError } from "./types";

const sql = getDatabaseClient();
const authSecret = "review-fixes-integration-auth-secret-2026";
const staleEmail = "credential.version.drift@example.test";
const idleEmail = "idle.audit.integration@example.test";
const oldPassword = "Old-Password-For-Review-2026";
const newPassword = "New-Password-For-Review-2026";

beforeAll(async () => {
  const oldHash = await hashPassword(oldPassword);
  for (const [email, fullName] of [
    [staleEmail, "اختبار تغير نسخة كلمة المرور"],
    [idleEmail, "اختبار تدقيق انتهاء الخمول"],
  ] as const) {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO users (
        email,
        full_name,
        password_hash,
        status,
        password_changed_at
      ) VALUES (
        ${email},
        ${fullName},
        ${oldHash},
        'ACTIVE',
        now()
      )
      RETURNING id
    `;
    const user = rows[0];
    if (!user) throw new Error("تعذر إنشاء مستخدم اختبار مراجعة المصادقة.");

    await sql`
      INSERT INTO user_roles (user_id, role_id, granted_by)
      SELECT ${user.id}, id, ${user.id}
      FROM roles
      WHERE code = 'BRANCH_MANAGER'
    `;
  }
});

afterAll(async () => {
  await closeDatabaseClient();
});

describe("authentication review regressions", () => {
  it("لا يحتسب فشلًا قديمًا بعد تغير hash أو password_version أثناء التحقق", async () => {
    const newHash = await hashPassword(newPassword);
    let verifierCalls = 0;

    await expect(
      loginPostgres(
        sql,
        { email: staleEmail, password: "Incorrect-Password-2026" },
        context("127.0.4.10"),
        {
          authSecret,
          sessionTtlHours: 8,
          maxEmailAttemptsPer15Minutes: 10,
          maxIpAttemptsPer15Minutes: 30,
          passwordVerifier: async () => {
            verifierCalls += 1;
            await sql`
              UPDATE users
              SET password_hash = ${newHash},
                  password_version = password_version + 1,
                  failed_login_attempts = 0,
                  locked_until = NULL,
                  password_changed_at = now(),
                  updated_at = now()
              WHERE email = ${staleEmail}
            `;
            return false;
          },
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    expect(verifierCalls).toBe(1);
    const users = await sql<
      { password_version: number; failed_login_attempts: number; locked_until: Date | null }[]
    >`
      SELECT password_version, failed_login_attempts, locked_until
      FROM users
      WHERE email = ${staleEmail}
    `;
    expect(users[0]).toMatchObject({
      password_version: 2,
      failed_login_attempts: 0,
      locked_until: null,
    });

    const attempts = await sql<
      { attempt_state: string; succeeded: boolean; failure_reason: string }[]
    >`
      SELECT attempt_state, succeeded, failure_reason
      FROM auth_login_attempts
      WHERE normalized_email = ${staleEmail}
      ORDER BY occurred_at DESC
      LIMIT 1
    `;
    expect(attempts[0]).toEqual({
      attempt_state: "COMPLETED",
      succeeded: false,
      failure_reason: "INVALID_CREDENTIALS",
    });
  });

  it("يسجل إبطال الجلسة بسبب الخمول في سجل التدقيق داخل نفس المعاملة", async () => {
    const login = await loginPostgres(
      sql,
      { email: idleEmail, password: oldPassword },
      context("127.0.4.11"),
      { authSecret, sessionTtlHours: 8, sessionIdleTimeoutMinutes: 30 },
    );
    await sql`
      UPDATE user_sessions
      SET last_seen_at = now() - interval '31 minutes'
      WHERE id = ${login.session.id}
    `;

    const readContext = context("127.0.4.12");
    await expect(
      getAuthenticatedSessionByToken(
        sql,
        login.token,
        authSecret,
        30,
        readContext,
      ),
    ).resolves.toBeNull();

    const sessions = await sql<
      { revoke_reason: string | null; revoked_at: Date | null }[]
    >`
      SELECT revoke_reason, revoked_at
      FROM user_sessions
      WHERE id = ${login.session.id}
    `;
    expect(sessions[0]?.revoke_reason).toBe("IDLE_TIMEOUT");
    expect(sessions[0]?.revoked_at).toBeInstanceOf(Date);

    const audits = await sql<
      {
        actor_type: string;
        action: string;
        resource_type: string;
        resource_id: string | null;
        request_id: string;
        reason: string | null;
        result: string;
        metadata: { trigger?: string };
      }[]
    >`
      SELECT
        actor_type,
        action,
        resource_type,
        resource_id,
        request_id::text,
        reason,
        result,
        metadata
      FROM audit_logs
      WHERE request_id = ${readContext.requestId}
    `;
    expect(audits).toEqual([
      {
        actor_type: "SYSTEM",
        action: "auth.session.idle_timeout",
        resource_type: "USER_SESSION",
        resource_id: login.session.id,
        request_id: readContext.requestId,
        reason: "IDLE_TIMEOUT",
        result: "SUCCESS",
        metadata: { trigger: "SESSION_READ" },
      },
    ]);
  });

  it("يبقي رسالة المصادقة الخارجية موحدة بعد تغير نسخة الاعتماد", async () => {
    const error = new AuthenticationError("INVALID_CREDENTIALS");
    expect(error.message).toBe("تعذر تسجيل الدخول. تحقق من البيانات وحاول مرة أخرى.");
  });
});

function context(ipAddress: string | null) {
  return Object.freeze({
    requestId: randomUUID(),
    ipAddress,
    userAgent: "auth-review-regression-test",
  });
}
