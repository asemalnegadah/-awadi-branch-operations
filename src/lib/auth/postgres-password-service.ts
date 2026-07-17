import type { Sql } from "postgres";

import { hashPassword, verifyPassword } from "./password";
import { createSessionToken, hashSessionToken } from "./session-token";
import { AuthenticationError } from "./types";
import type {
  AuthenticatedSession,
  RequestSecurityContext,
} from "./types";

interface PasswordUserRow {
  password_hash: string | null;
  password_version: number;
  status: string;
}

export interface ChangeOwnPasswordInput {
  readonly currentPassword: string;
  readonly newPassword: string;
}

export interface RotatedSessionToken {
  readonly token: string;
  readonly expiresAt: Date;
}

export async function changeOwnPasswordPostgres(
  sql: Sql,
  session: AuthenticatedSession,
  input: ChangeOwnPasswordInput,
  context: RequestSecurityContext,
  authSecret: string,
): Promise<RotatedSessionToken> {
  const newPasswordHash = await hashPassword(input.newPassword);
  const newSessionToken = createSessionToken();
  const newSessionTokenHash = await hashSessionToken(newSessionToken, authSecret);

  const changed = await sql.begin(async (transaction) => {
    const rows = await transaction<PasswordUserRow[]>`
      SELECT password_hash, password_version, status
      FROM users
      WHERE id = ${session.user.id}
        AND deleted_at IS NULL
      LIMIT 1
      FOR UPDATE
    `;
    const user = rows[0];

    if (
      !user ||
      user.status !== "ACTIVE" ||
      !user.password_hash ||
      !(await verifyPassword(input.currentPassword, user.password_hash))
    ) {
      await transaction`
        INSERT INTO audit_logs (
          actor_user_id,
          actor_type,
          action,
          resource_type,
          resource_id,
          request_id,
          session_id,
          ip_address,
          user_agent,
          result,
          metadata
        ) VALUES (
          ${session.user.id},
          'USER',
          'auth.password_change',
          'USER',
          ${session.user.id},
          ${context.requestId},
          ${session.id},
          ${context.ipAddress},
          ${context.userAgent},
          'DENIED',
          '{"reason":"CURRENT_PASSWORD_INVALID"}'::jsonb
        )
      `;
      return false;
    }

    const nextPasswordVersion = user.password_version + 1;

    await transaction`
      UPDATE users
      SET password_hash = ${newPasswordHash},
          password_changed_at = now(),
          password_version = ${nextPasswordVersion},
          must_change_password = false,
          failed_login_attempts = 0,
          locked_until = NULL,
          updated_at = now(),
          updated_by = ${session.user.id}
      WHERE id = ${session.user.id}
    `;

    await transaction`
      UPDATE user_sessions
      SET revoked_at = now(),
          revoked_by = ${session.user.id},
          revoke_reason = 'PASSWORD_CHANGED'
      WHERE user_id = ${session.user.id}
        AND id <> ${session.id}
        AND revoked_at IS NULL
    `;

    const currentSessionRows = await transaction<{ id: string }[]>`
      UPDATE user_sessions
      SET token_hash = ${newSessionTokenHash},
          password_version = ${nextPasswordVersion},
          last_seen_at = now()
      WHERE id = ${session.id}
        AND user_id = ${session.user.id}
        AND revoked_at IS NULL
        AND expires_at > now()
      RETURNING id
    `;

    if (!currentSessionRows[0]) {
      throw new Error("تعذر تدوير الجلسة الحالية بعد تغيير كلمة المرور.");
    }

    await transaction`
      INSERT INTO audit_logs (
        actor_user_id,
        actor_type,
        action,
        resource_type,
        resource_id,
        request_id,
        session_id,
        ip_address,
        user_agent,
        result,
        metadata
      ) VALUES (
        ${session.user.id},
        'USER',
        'auth.password_change',
        'USER',
        ${session.user.id},
        ${context.requestId},
        ${session.id},
        ${context.ipAddress},
        ${context.userAgent},
        'SUCCESS',
        ${JSON.stringify({
          revokedOtherSessions: true,
          rotatedCurrentSessionToken: true,
        })}::jsonb
      )
    `;

    return true;
  });

  if (!changed) {
    throw new AuthenticationError("INVALID_CREDENTIALS");
  }

  return Object.freeze({
    token: newSessionToken,
    expiresAt: session.expiresAt,
  });
}
