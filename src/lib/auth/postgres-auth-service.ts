import type { Sql } from "postgres";

import { isPermissionCode, type PermissionCode } from "./permissions";
import { verifyPassword } from "./password";
import { isSystemRoleCode, type SystemRoleCode } from "./roles";
import {
  createSessionToken,
  hashSessionToken,
  sessionExpiryFromNow,
} from "./session-token";
import {
  AuthenticationError,
  type AuthenticatedSession,
  type AuthenticationFailureCode,
  type LoginResult,
  type OperatingMode,
  type RequestSecurityContext,
} from "./types";

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const DUMMY_PASSWORD_HASH =
  "scrypt-v1$16384$8$1$YXdhZGktZHVtbXktc2FsdA$SlWplebT25md2m8HHziXx_aaBtcPsvjm2J_jL0k2uPs8NZVe3tBWYOWROeE_7MxdUrySwIbiJ07tEqkU739Q5w";

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export interface LoginConfiguration {
  readonly authSecret: string;
  readonly sessionTtlHours: number;
}

interface LoginUserRow {
  id: string;
  email: string;
  full_name: string;
  password_hash: string | null;
  password_version: number;
  must_change_password: boolean;
  status: string;
  failed_login_attempts: number;
  locked_until: Date | string | null;
}

interface CreatedSessionRow {
  id: string;
}

interface SessionContextRow {
  session_id: string;
  user_id: string;
  email: string;
  full_name: string;
  must_change_password: boolean;
  operating_mode: OperatingMode;
  session_created_at: Date | string;
  expires_at: Date | string;
  roles: string[];
  permissions: string[];
}

type LoginTransactionOutcome =
  | { readonly ok: false; readonly code: AuthenticationFailureCode }
  | {
      readonly ok: true;
      readonly token: string;
      readonly tokenHash: string;
    };

export async function loginPostgres(
  sql: Sql,
  input: LoginInput,
  context: RequestSecurityContext,
  configuration: LoginConfiguration,
): Promise<LoginResult> {
  const normalizedEmail = normalizeEmail(input.email);
  assertRequestContext(context);

  const outcome = await sql.begin<LoginTransactionOutcome>(async (transaction) => {
    const rows = await transaction<LoginUserRow[]>`
      SELECT
        id,
        email,
        full_name,
        password_hash,
        password_version,
        must_change_password,
        status,
        failed_login_attempts,
        locked_until
      FROM users
      WHERE email = ${normalizedEmail}
        AND deleted_at IS NULL
      LIMIT 1
      FOR UPDATE
    `;
    const user = rows[0];

    if (!user) {
      await verifyPassword(input.password, DUMMY_PASSWORD_HASH);
      await recordFailure(
        transaction,
        normalizedEmail,
        null,
        "INVALID_CREDENTIALS",
        context,
      );
      return { ok: false, code: "INVALID_CREDENTIALS" };
    }

    if (user.status !== "ACTIVE" || !user.password_hash) {
      await verifyPassword(input.password, DUMMY_PASSWORD_HASH);
      await recordFailure(
        transaction,
        normalizedEmail,
        user.id,
        "ACCOUNT_DISABLED",
        context,
      );
      return { ok: false, code: "ACCOUNT_DISABLED" };
    }

    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      await recordFailure(
        transaction,
        normalizedEmail,
        user.id,
        "ACCOUNT_LOCKED",
        context,
      );
      return { ok: false, code: "ACCOUNT_LOCKED" };
    }

    const validPassword = await verifyPassword(input.password, user.password_hash);
    if (!validPassword) {
      const nextFailureCount = user.failed_login_attempts + 1;
      const shouldLock = nextFailureCount >= MAX_FAILED_LOGIN_ATTEMPTS;

      await transaction`
        UPDATE users
        SET failed_login_attempts = ${nextFailureCount},
            locked_until = CASE
              WHEN ${shouldLock} THEN now() + (${LOCK_MINUTES} * interval '1 minute')
              ELSE NULL
            END,
            updated_at = now()
        WHERE id = ${user.id}
      `;

      await recordFailure(
        transaction,
        normalizedEmail,
        user.id,
        shouldLock ? "ACCOUNT_LOCKED" : "INVALID_CREDENTIALS",
        context,
      );
      return {
        ok: false,
        code: shouldLock ? "ACCOUNT_LOCKED" : "INVALID_CREDENTIALS",
      };
    }

    const token = createSessionToken();
    const tokenHash = hashSessionToken(token, configuration.authSecret);
    const expiresAt = sessionExpiryFromNow(configuration.sessionTtlHours);

    await transaction`
      UPDATE users
      SET failed_login_attempts = 0,
          locked_until = NULL,
          last_login_at = now(),
          updated_at = now()
      WHERE id = ${user.id}
    `;

    const sessionRows = await transaction<CreatedSessionRow[]>`
      INSERT INTO user_sessions (
        user_id,
        token_hash,
        password_version,
        expires_at,
        ip_address,
        user_agent
      ) VALUES (
        ${user.id},
        ${tokenHash},
        ${user.password_version},
        ${expiresAt},
        ${context.ipAddress},
        ${context.userAgent}
      )
      RETURNING id
    `;
    const session = sessionRows[0];
    if (!session) {
      throw new Error("تعذر إنشاء جلسة المستخدم.");
    }

    await transaction`
      INSERT INTO auth_login_attempts (
        normalized_email,
        user_id,
        session_id,
        succeeded,
        request_id,
        ip_address,
        user_agent
      ) VALUES (
        ${normalizedEmail},
        ${user.id},
        ${session.id},
        true,
        ${context.requestId},
        ${context.ipAddress},
        ${context.userAgent}
      )
    `;

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
        ${user.id},
        'USER',
        'auth.login',
        'USER_SESSION',
        ${session.id},
        ${context.requestId},
        ${session.id},
        ${context.ipAddress},
        ${context.userAgent},
        'SUCCESS',
        ${JSON.stringify({ operatingMode: "SINGLE_MANAGER" })}::jsonb
      )
    `;

    return { ok: true, token, tokenHash };
  });

  if (!outcome.ok) {
    throw new AuthenticationError(outcome.code);
  }

  const session = await getAuthenticatedSessionByHash(sql, outcome.tokenHash, true);
  if (!session) {
    throw new Error("تم إنشاء الجلسة لكن تعذر قراءتها بعد الحفظ.");
  }

  return Object.freeze({ token: outcome.token, session });
}

export async function getAuthenticatedSessionByToken(
  sql: Sql,
  token: string,
  authSecret: string,
): Promise<AuthenticatedSession | null> {
  if (!token) {
    return null;
  }

  let tokenHash: string;
  try {
    tokenHash = hashSessionToken(token, authSecret);
  } catch {
    return null;
  }

  return getAuthenticatedSessionByHash(sql, tokenHash, true);
}

export async function revokeSessionByToken(
  sql: Sql,
  token: string,
  authSecret: string,
  context: RequestSecurityContext,
  reason = "USER_LOGOUT",
): Promise<boolean> {
  assertRequestContext(context);

  let tokenHash: string;
  try {
    tokenHash = hashSessionToken(token, authSecret);
  } catch {
    return false;
  }

  return sql.begin(async (transaction) => {
    const rows = await transaction<
      { session_id: string; user_id: string }[]
    >`
      SELECT id AS session_id, user_id
      FROM user_sessions
      WHERE token_hash = ${tokenHash}
        AND revoked_at IS NULL
      LIMIT 1
      FOR UPDATE
    `;
    const existing = rows[0];
    if (!existing) {
      return false;
    }

    await transaction`
      UPDATE user_sessions
      SET revoked_at = now(),
          revoked_by = ${existing.user_id},
          revoke_reason = ${reason}
      WHERE id = ${existing.session_id}
    `;

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
        reason,
        result
      ) VALUES (
        ${existing.user_id},
        'USER',
        'auth.logout',
        'USER_SESSION',
        ${existing.session_id},
        ${context.requestId},
        ${existing.session_id},
        ${context.ipAddress},
        ${context.userAgent},
        ${reason},
        'SUCCESS'
      )
    `;

    return true;
  });
}

async function getAuthenticatedSessionByHash(
  sql: Sql,
  tokenHash: string,
  touch: boolean,
): Promise<AuthenticatedSession | null> {
  const rows = await sql<SessionContextRow[]>`
    SELECT
      session.id AS session_id,
      user_account.id AS user_id,
      user_account.email,
      user_account.full_name,
      user_account.must_change_password,
      organization.operating_mode,
      session.created_at AS session_created_at,
      session.expires_at,
      COALESCE(
        array_agg(DISTINCT role.code) FILTER (WHERE role.code IS NOT NULL),
        ARRAY[]::text[]
      ) AS roles,
      COALESCE(
        array_agg(DISTINCT permission.code)
          FILTER (WHERE permission.code IS NOT NULL),
        ARRAY[]::text[]
      ) AS permissions
    FROM user_sessions AS session
    JOIN users AS user_account ON user_account.id = session.user_id
    CROSS JOIN organization_settings AS organization
    LEFT JOIN user_roles AS user_role
      ON user_role.user_id = user_account.id
     AND user_role.revoked_at IS NULL
     AND user_role.valid_from <= now()
     AND (user_role.valid_until IS NULL OR user_role.valid_until > now())
    LEFT JOIN roles AS role ON role.id = user_role.role_id
    LEFT JOIN role_permissions AS role_permission
      ON role_permission.role_id = role.id
    LEFT JOIN permissions AS permission
      ON permission.id = role_permission.permission_id
    WHERE session.token_hash = ${tokenHash}
      AND session.revoked_at IS NULL
      AND session.expires_at > now()
      AND session.password_version = user_account.password_version
      AND user_account.status = 'ACTIVE'
      AND user_account.deleted_at IS NULL
    GROUP BY
      session.id,
      user_account.id,
      organization.operating_mode
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    return null;
  }

  if (touch) {
    await sql`
      UPDATE user_sessions
      SET last_seen_at = now()
      WHERE id = ${row.session_id}
        AND last_seen_at < now() - interval '5 minutes'
    `;
  }

  const roles = row.roles.filter(isSystemRoleCode) as SystemRoleCode[];
  const permissions = row.permissions.filter(isPermissionCode) as PermissionCode[];

  return Object.freeze({
    id: row.session_id,
    user: Object.freeze({
      id: row.user_id,
      email: row.email,
      fullName: row.full_name,
      roles: Object.freeze(roles),
      permissions: new Set(permissions),
      operatingMode: row.operating_mode,
      mustChangePassword: row.must_change_password,
    }),
    createdAt: new Date(row.session_created_at),
    expiresAt: new Date(row.expires_at),
  });
}

async function recordFailure(
  sql: Sql,
  normalizedEmail: string,
  userId: string | null,
  failureCode: AuthenticationFailureCode,
  context: RequestSecurityContext,
): Promise<void> {
  await sql`
    INSERT INTO auth_login_attempts (
      normalized_email,
      user_id,
      succeeded,
      failure_reason,
      request_id,
      ip_address,
      user_agent
    ) VALUES (
      ${normalizedEmail},
      ${userId},
      false,
      ${failureCode},
      ${context.requestId},
      ${context.ipAddress},
      ${context.userAgent}
    )
  `;

  await sql`
    INSERT INTO audit_logs (
      actor_user_id,
      actor_type,
      action,
      resource_type,
      resource_id,
      request_id,
      ip_address,
      user_agent,
      result,
      metadata
    ) VALUES (
      ${userId},
      'USER',
      'auth.login',
      'AUTHENTICATION',
      ${normalizedEmail},
      ${context.requestId},
      ${context.ipAddress},
      ${context.userAgent},
      'DENIED',
      ${JSON.stringify({ failureCode })}::jsonb
    )
  `;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertRequestContext(context: RequestSecurityContext): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      context.requestId,
    )
  ) {
    throw new Error("requestId يجب أن يكون UUID صالحًا.");
  }
}
