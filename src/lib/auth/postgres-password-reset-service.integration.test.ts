import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  PasswordResetEmailDelivery,
  PasswordResetEmailMessage,
  PasswordResetEmailSender,
} from "@/lib/email/password-reset-email";
import {
  closeDatabaseClient,
  getDatabaseClient,
} from "@/lib/db/client";

import { hashPassword } from "./password";
import { loginPostgres } from "./postgres-auth-service";
import {
  PasswordResetError,
  requestPasswordResetPostgres,
  resetPasswordPostgres,
} from "./postgres-password-reset-service";

const sql = getDatabaseClient();
const email = "password.recovery.integration@example.test";
const originalPassword = "Original-Recovery-2026";
const replacementPassword = "Replacement-Recovery-2026";
const authSecret = "password-recovery-integration-secret-2026";
const configuration = Object.freeze({
  authSecret,
  appBaseUrl: "https://awadi.example.test",
  tokenTtlMinutes: 30,
  maxEmailRequestsPerHour: 3,
  maxIpRequestsPerHour: 10,
  allowInitialManagerBootstrap: false,
});

let userId = "";

class CapturingSender implements PasswordResetEmailSender {
  messages: PasswordResetEmailMessage[] = [];

  async send(
    message: PasswordResetEmailMessage,
  ): Promise<PasswordResetEmailDelivery> {
    this.messages.push(message);
    return { provider: "TEST", messageId: randomUUID() };
  }
}

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
      'مدير اختبار استعادة كلمة المرور',
      ${passwordHash},
      'ACTIVE',
      now()
    )
    RETURNING id
  `;
  const user = rows[0];
  if (!user) {
    throw new Error("تعذر إنشاء مستخدم اختبار الاستعادة.");
  }
  userId = user.id;

  await sql`
    INSERT INTO user_roles (user_id, role_id, granted_by)
    SELECT ${userId}, id, ${userId}
    FROM roles
    WHERE code = 'BRANCH_MANAGER'
  `;
});

afterAll(async () => {
  await closeDatabaseClient();
});

describe("PostgreSQL email password recovery", () => {
  it("issues one-use token, changes password, and revokes previous sessions", async () => {
    const previousLogin = await loginPostgres(
      sql,
      { email, password: originalPassword },
      buildContext(),
      { authSecret, sessionTtlHours: 8 },
    );
    const sender = new CapturingSender();

    await requestPasswordResetPostgres(
      sql,
      email.toUpperCase(),
      buildContext(),
      configuration,
      sender,
    );

    expect(sender.messages).toHaveLength(1);
    const sentMessage = sender.messages[0];
    expect(sentMessage?.purpose).toBe("RESET");

    const resetUrl = new URL(sentMessage?.resetUrl ?? "");
    const token = new URLSearchParams(resetUrl.hash.slice(1)).get("token");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const tokenRows = await sql<
      { token_hash: string; delivered_at: Date | null; consumed_at: Date | null }[]
    >`
      SELECT token_hash, delivered_at, consumed_at
      FROM password_reset_tokens
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    expect(tokenRows[0]?.token_hash).toHaveLength(64);
    expect(tokenRows[0]?.token_hash).not.toBe(token);
    expect(tokenRows[0]?.delivered_at).not.toBeNull();
    expect(tokenRows[0]?.consumed_at).toBeNull();

    await resetPasswordPostgres(
      sql,
      token ?? "",
      replacementPassword,
      buildContext(),
      { authSecret },
    );

    await expect(
      loginPostgres(
        sql,
        { email, password: originalPassword },
        buildContext(),
        { authSecret, sessionTtlHours: 8 },
      ),
    ).rejects.toBeDefined();

    await expect(
      loginPostgres(
        sql,
        { email, password: replacementPassword },
        buildContext(),
        { authSecret, sessionTtlHours: 8 },
      ),
    ).resolves.toMatchObject({
      session: { user: { id: userId, email } },
    });

    const previousSessionRows = await sql<{ revoked_at: Date | null }[]>`
      SELECT revoked_at
      FROM user_sessions
      WHERE id = ${previousLogin.session.id}
    `;
    expect(previousSessionRows[0]?.revoked_at).not.toBeNull();

    await expect(
      resetPasswordPostgres(
        sql,
        token ?? "",
        "Another-Recovery-Password-2026",
        buildContext(),
        { authSecret },
      ),
    ).rejects.toMatchObject<PasswordResetError>({
      code: "INVALID_OR_EXPIRED_TOKEN",
    });

    const successAuditRows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM audit_logs
      WHERE actor_user_id = ${userId}
        AND action = 'auth.password_reset.completed'
        AND result = 'SUCCESS'
    `;
    expect(Number(successAuditRows[0]?.count)).toBe(1);
  });
});

function buildContext() {
  return Object.freeze({
    requestId: randomUUID(),
    ipAddress: "127.0.0.1",
    userAgent: "password-recovery-integration-test",
  });
}
