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
  revokeSessionByToken,
} from "./postgres-auth-service";
import { AuthenticationError } from "./types";

const sql = getDatabaseClient();
const authSecret = "integration-auth-secret-2026-07-14-long";
const managerEmail = "manager.auth.integration@example.test";
const lockEmail = "manager.lock.integration@example.test";
const password = "Manager-Password-2026";

beforeAll(async () => {
  const passwordHash = await hashPassword(password);

  for (const [email, fullName] of [
    [managerEmail, "مدير تكامل الجلسات"],
    [lockEmail, "مدير تكامل القفل"],
  ] as const) {
    const users = await sql<{ id: string }[]>`
      INSERT INTO users (
        email,
        full_name,
        password_hash,
        status,
        password_changed_at
      ) VALUES (
        ${email},
        ${fullName},
        ${passwordHash},
        'ACTIVE',
        now()
      )
      RETURNING id
    `;
    const user = users[0];
    if (!user) {
      throw new Error("تعذر إنشاء مستخدم اختبار المصادقة.");
    }

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

describe("PostgreSQL authentication", () => {
  it("ينشئ جلسة آمنة ويقرأ صلاحيات المدير ثم يبطلها", async () => {
    const loginContext = buildContext();
    const result = await loginPostgres(
      sql,
      { email: managerEmail, password },
      loginContext,
      { authSecret, sessionTtlHours: 8 },
    );

    expect(result.session.user.roles).toContain("BRANCH_MANAGER");
    expect(result.session.user.operatingMode).toBe("SINGLE_MANAGER");
    expect(result.session.user.permissions.has("collections.approve")).toBe(true);

    const loaded = await getAuthenticatedSessionByToken(
      sql,
      result.token,
      authSecret,
    );
    expect(loaded?.id).toBe(result.session.id);

    await expect(
      revokeSessionByToken(
        sql,
        result.token,
        authSecret,
        buildContext(),
      ),
    ).resolves.toBe(true);

    await expect(
      getAuthenticatedSessionByToken(sql, result.token, authSecret),
    ).resolves.toBeNull();
  });

  it("يقفل الحساب بعد خمس محاولات فاشلة ويسجلها", async () => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(
        loginPostgres(
          sql,
          { email: lockEmail, password: "Incorrect-Password-2026" },
          buildContext(),
          { authSecret, sessionTtlHours: 8 },
        ),
      ).rejects.toBeInstanceOf(AuthenticationError);
    }

    await expect(
      loginPostgres(
        sql,
        { email: lockEmail, password },
        buildContext(),
        { authSecret, sessionTtlHours: 8 },
      ),
    ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });

    const rows = await sql<
      { failed_login_attempts: number; locked: boolean; attempts: string }[]
    >`
      SELECT
        user_account.failed_login_attempts,
        user_account.locked_until > now() AS locked,
        COUNT(attempt.id)::text AS attempts
      FROM users AS user_account
      JOIN auth_login_attempts AS attempt
        ON attempt.user_id = user_account.id
      WHERE user_account.email = ${lockEmail}
      GROUP BY user_account.id
    `;

    expect(rows[0]).toMatchObject({
      failed_login_attempts: 5,
      locked: true,
      attempts: "6",
    });
  });
});

function buildContext() {
  return Object.freeze({
    requestId: randomUUID(),
    ipAddress: "127.0.0.1",
    userAgent: "auth-integration-test",
  });
}
