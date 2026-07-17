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
import { changeOwnPasswordPostgres } from "./postgres-password-service";
import { AuthenticationError } from "./types";

const sql = getDatabaseClient();
const email = "password.change.integration@example.test";
const originalPassword = "Original-Manager-2026";
const replacementPassword = "Replacement-Manager-2026";
const authSecret = "password-change-integration-secret-2026";

beforeAll(async () => {
  const passwordHash = await hashPassword(originalPassword);
  const rows = await sql<{ id: string }[]>`
    INSERT INTO users (
      email,
      full_name,
      password_hash,
      status,
      password_changed_at
    ) VALUES (
      ${email},
      'مدير اختبار تغيير كلمة المرور',
      ${passwordHash},
      'ACTIVE',
      now()
    )
    RETURNING id
  `;
  const user = rows[0];
  if (!user) {
    throw new Error("تعذر إنشاء مستخدم اختبار تغيير كلمة المرور.");
  }

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

describe("PostgreSQL password change", () => {
  it("يرفض الكلمة الحالية الخاطئة دون إبطال الجلسة", async () => {
    const login = await createLogin(originalPassword);

    await expect(
      changeOwnPasswordPostgres(
        sql,
        login.session,
        {
          currentPassword: "Wrong-Current-Password-2026",
          newPassword: replacementPassword,
        },
        buildContext(),
        authSecret,
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);

    await expect(
      getAuthenticatedSessionByToken(sql, login.token, authSecret),
    ).resolves.not.toBeNull();

    const deniedRows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM audit_logs
      WHERE actor_user_id = ${login.session.user.id}
        AND action = 'auth.password_change'
        AND result = 'DENIED'
    `;
    expect(Number(deniedRows[0]?.count)).toBeGreaterThanOrEqual(1);
  });

  it("يغير كلمة المرور ويبقي الجلسة الحالية ويبطل الجلسات الأخرى", async () => {
    const currentLogin = await createLogin(originalPassword);
    const otherLogin = await createLogin(originalPassword);

    const rotated = await changeOwnPasswordPostgres(
      sql,
      currentLogin.session,
      {
        currentPassword: originalPassword,
        newPassword: replacementPassword,
      },
      buildContext(),
      authSecret,
    );

    await expect(
      getAuthenticatedSessionByToken(sql, currentLogin.token, authSecret),
    ).resolves.toBeNull();
    await expect(
      getAuthenticatedSessionByToken(sql, rotated.token, authSecret),
    ).resolves.toMatchObject({ user: { email } });
    await expect(
      getAuthenticatedSessionByToken(sql, otherLogin.token, authSecret),
    ).resolves.toBeNull();

    await expect(createLogin(originalPassword)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    await expect(createLogin(replacementPassword)).resolves.toMatchObject({
      session: {
        user: { email },
      },
    });

    const successRows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM audit_logs
      WHERE actor_user_id = ${currentLogin.session.user.id}
        AND action = 'auth.password_change'
        AND result = 'SUCCESS'
    `;
    expect(Number(successRows[0]?.count)).toBeGreaterThanOrEqual(1);
  });
});

function createLogin(password: string) {
  return loginPostgres(
    sql,
    { email, password },
    buildContext(),
    { authSecret, sessionTtlHours: 8 },
  );
}

function buildContext() {
  return Object.freeze({
    requestId: randomUUID(),
    ipAddress: "127.0.0.1",
    userAgent: "password-change-integration-test",
  });
}
