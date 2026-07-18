import type { Sql } from "postgres";

import { isPermissionCode, type PermissionCode } from "./permissions";
import { hashPassword, verifyPassword } from "./password";
import { isSystemRoleCode, type SystemRoleCode } from "./roles";
import {
  createSessionToken,
  hashSessionToken,
  assertIdleTimeoutMinutes,
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
const dummyPasswordHash = hashPassword("non-account timing equalization value");

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export interface LoginConfiguration {
  readonly authSecret: string;
  readonly sessionTtlHours: number;
  readonly sessionIdleTimeoutMinutes?: number;
  readonly maxEmailAttemptsPer15Minutes?: number;
  readonly maxIpAttemptsPer15Minutes?: number;
  readonly passwordVerifier?: (
    password: string,
    encodedHash: string,
  ) => Promise<boolean>;
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

interface ReservedAttemptRow {
  id: string;
}

type ReservationOutcome =
  | { readonly allowed: false }
  | { readonly allowed: true; readonly attemptId: string };

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
  const maxEmailAttempts = assertPositiveLimit(
    configuration.maxEmailAttemptsPer15Minutes ?? 10,
    "maxEmailAttemptsPer15Minutes",
  );
  const maxIpAttempts = assertPositiveLimit(
    configuration.maxIpAttemptsPer15Minutes ?? 30,
    "maxIpAttemptsPer15Minutes",
  );
  const passwordVerifier = configuration.passwordVerifier ?? verifyPassword;

  const reservation = await reserveLoginAttempt(
    sql,
    normalizedEmail,
    context,
    maxEmailAttempts,
    maxIpAttempts,
  );
  if (!reservation.allowed) {
    throw new AuthenticationError("RATE_LIMITED");
  }

  const user = await loadLoginUser(sql, normalizedEmail);
  if (!user) {
    await passwordVerifier(input.password, await dummyPasswordHash);
    await finalizeSimpleFailure(
      sql,
      reservation.attemptId,
      normalizedEmail,
      null,
      "INVALID_CREDENTIALS",
      context,
    );
    throw new AuthenticationError("INVALID_CREDENTIALS");
  }

  if (user.status !== "ACTIVE" || !user.password_hash) {
    await passwordVerifier(input.password, await dummyPasswordHash);
    await finalizeSimpleFailure(
      sql,
      reservation.attemptId,
      normalizedEmail,
      user.id,
      "ACCOUNT_DISABLED",
      context,
    );
    throw new AuthenticationError("ACCOUNT_DISABLED");
  }

  if (isCurrentlyLocked(user.locked_until)) {
    await finalizeSimpleFailure(
      sql,
      reservation.attemptId,
      normalizedEmail,
      user.id,
      "ACCOUNT_LOCKED",
      context,
    );
    throw new AuthenticationError("ACCOUNT_LOCKED");
  }

  const validPassword = await passwordVerifier(input.password, user.password_hash);
  if (!validPassword) {
    const code = await finalizeInvalidPassword(
      sql,
      reservation.attemptId,
      normalizedEmail,
      user,
      context,
    );
    throw new AuthenticationError(code);
  }

  const token = createSessionToken();
  const tokenHash = await hashSessionToken(token, configuration.authSecret);
  const expiresAt = sessionExpiryFromNow(configuration.sessionTtlHours);

  const outcome = await finalizeSuccessfulLogin(
    sql,
    reservation.attemptId,
    normalizedEmail,
    user,
    token,
    tokenHash,
    expiresAt,
    context,
  );
  if (!outcome.ok) {
    throw new AuthenticationError(outcome.code);
  }

  const session = await getAuthenticatedSessionByHash(
    sql,
    outcome.tokenHash,
    true,
    configuration.sessionIdleTimeoutMinutes ?? 60,
  );
  if (!session) {
    throw new Error("تم إنشاء الجلسة لكن تعذر قراءتها بعد الحفظ.");
  }

  return Object.freeze({ token: outcome.token, session });
}

export function getLoginThrottleLockKeys(
  normalizedEmail: string,
  trustedIpAddress: string | null,
): readonly string[] {
  const keys = [`auth-login:email:${normalizedEmail}`];
  if (trustedIpAddress) {
    keys.push(`auth-login:ip:${trustedIpAddress}`);
  }
  return Object.freeze(
    keys.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

export async function getAuthenticatedSessionByToken(
  sql: Sql,
  token: string,
  authSecret: string,
  idleTimeoutMinutes = 60,
): Promise<AuthenticatedSession | null> {
  if (!token) return null;
  assertIdleTimeoutMinutes(idleTimeoutMinutes);
  let tokenHash: string;
  try {
    tokenHash = await hashSessionToken(token, authSecret);
  } catch {
    return null;
  }
  await sql`
    UPDATE user_sessions
    SET revoked_at = now(), revoke_reason = 'IDLE_TIMEOUT'
    WHERE token_hash = ${tokenHash}
      AND revoked_at IS NULL
      AND last_seen_at <= now() - (${idleTimeoutMinutes} * interval '1 minute')
  `;
  return getAuthenticatedSessionByHash(sql, tokenHash, true, idleTimeoutMinutes);
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
    tokenHash = await hashSessionToken(token, authSecret);
  } catch {
    return false;
  }
  return sql.begin(async (transaction) => {
    const rows = await transaction<{ session_id: string; user_id: string }[]>`
      SELECT id AS session_id, user_id
      FROM user_sessions
      WHERE token_hash = ${tokenHash} AND revoked_at IS NULL
      LIMIT 1 FOR UPDATE
    `;
    const existing = rows[0];
    if (!existing) return false;
    await transaction`
      UPDATE user_sessions
      SET revoked_at = now(), revoked_by = ${existing.user_id}, revoke_reason = ${reason}
      WHERE id = ${existing.session_id}
    `;
    await transaction`
      INSERT INTO audit_logs (
        actor_user_id, actor_type, action, resource_type, resource_id,
        request_id, session_id, ip_address, user_agent, reason, result
      ) VALUES (
        ${existing.user_id}, 'USER', 'auth.logout', 'USER_SESSION', ${existing.session_id},
        ${context.requestId}, ${existing.session_id}, ${context.ipAddress}, ${context.userAgent},
        ${reason}, 'SUCCESS'
      )
    `;
    return true;
  });
}

async function reserveLoginAttempt(
  sql: Sql,
  normalizedEmail: string,
  context: RequestSecurityContext,
  maxEmailAttempts: number,
  maxIpAttempts: number,
): Promise<ReservationOutcome> {
  return sql.begin<ReservationOutcome>(async (transaction) => {
    for (const lockKey of getLoginThrottleLockKeys(
      normalizedEmail,
      context.ipAddress,
    )) {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
      `;
    }

    const emailRows = await transaction<{ count: number }[]>`
      SELECT COUNT(*)::integer AS count
      FROM auth_login_attempts
      WHERE normalized_email = ${normalizedEmail}
        AND occurred_at > now() - interval '15 minutes'
        AND (
          attempt_state = 'PENDING'
          OR (succeeded = false AND failure_reason <> 'RATE_LIMITED')
        )
    `;
    const emailLimited = (emailRows[0]?.count ?? 0) >= maxEmailAttempts;

    let ipLimited = false;
    if (context.ipAddress) {
      const ipRows = await transaction<{ count: number }[]>`
        SELECT COUNT(*)::integer AS count
        FROM auth_login_attempts
        WHERE ip_address = ${context.ipAddress}
          AND occurred_at > now() - interval '15 minutes'
          AND (
            attempt_state = 'PENDING'
            OR (succeeded = false AND failure_reason <> 'RATE_LIMITED')
          )
      `;
      ipLimited = (ipRows[0]?.count ?? 0) >= maxIpAttempts;
    }

    if (emailLimited || ipLimited) {
      await transaction`
        INSERT INTO auth_login_attempts (
          normalized_email,
          succeeded,
          failure_reason,
          attempt_state,
          completed_at,
          request_id,
          ip_address,
          user_agent
        ) VALUES (
          ${normalizedEmail},
          false,
          'RATE_LIMITED',
          'COMPLETED',
          now(),
          ${context.requestId},
          ${context.ipAddress},
          ${context.userAgent}
        )
      `;
      await recordLoginAudit(
        transaction,
        normalizedEmail,
        null,
        null,
        "DENIED",
        "RATE_LIMITED",
        context,
      );
      return { allowed: false };
    }

    const rows = await transaction<ReservedAttemptRow[]>`
      INSERT INTO auth_login_attempts (
        normalized_email,
        succeeded,
        failure_reason,
        attempt_state,
        completed_at,
        request_id,
        ip_address,
        user_agent
      ) VALUES (
        ${normalizedEmail},
        NULL,
        NULL,
        'PENDING',
        NULL,
        ${context.requestId},
        ${context.ipAddress},
        ${context.userAgent}
      )
      RETURNING id
    `;
    const attempt = rows[0];
    if (!attempt) {
      throw new Error("تعذر حجز محاولة تسجيل الدخول.");
    }
    return { allowed: true, attemptId: attempt.id };
  });
}

async function loadLoginUser(
  sql: Sql,
  normalizedEmail: string,
): Promise<LoginUserRow | null> {
  const rows = await sql<LoginUserRow[]>`
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
  `;
  return rows[0] ?? null;
}

async function finalizeSimpleFailure(
  sql: Sql,
  attemptId: string,
  normalizedEmail: string,
  userId: string | null,
  failureCode: AuthenticationFailureCode,
  context: RequestSecurityContext,
): Promise<void> {
  await sql.begin(async (transaction) => {
    await completeReservedAttempt(
      transaction,
      attemptId,
      userId,
      null,
      false,
      failureCode,
    );
    await recordLoginAudit(
      transaction,
      normalizedEmail,
      userId,
      null,
      "DENIED",
      failureCode,
      context,
    );
  });
}

async function finalizeInvalidPassword(
  sql: Sql,
  attemptId: string,
  normalizedEmail: string,
  snapshot: LoginUserRow,
  context: RequestSecurityContext,
): Promise<AuthenticationFailureCode> {
  return sql.begin<AuthenticationFailureCode>(async (transaction) => {
    const current = await lockCurrentUser(transaction, snapshot.id);
    if (!current || current.status !== "ACTIVE" || !current.password_hash) {
      const code: AuthenticationFailureCode = "ACCOUNT_DISABLED";
      await completeReservedAttempt(
        transaction,
        attemptId,
        current?.id ?? snapshot.id,
        null,
        false,
        code,
      );
      await recordLoginAudit(
        transaction,
        normalizedEmail,
        current?.id ?? snapshot.id,
        null,
        "DENIED",
        code,
        context,
      );
      return code;
    }

    if (isCurrentlyLocked(current.locked_until)) {
      const code: AuthenticationFailureCode = "ACCOUNT_LOCKED";
      await completeReservedAttempt(
        transaction,
        attemptId,
        current.id,
        null,
        false,
        code,
      );
      await recordLoginAudit(
        transaction,
        normalizedEmail,
        current.id,
        null,
        "DENIED",
        code,
        context,
      );
      return code;
    }

    const nextFailureCount = current.failed_login_attempts + 1;
    const shouldLock = nextFailureCount >= MAX_FAILED_LOGIN_ATTEMPTS;
    const code: AuthenticationFailureCode = shouldLock
      ? "ACCOUNT_LOCKED"
      : "INVALID_CREDENTIALS";

    await transaction`
      UPDATE users
      SET failed_login_attempts = ${nextFailureCount},
          locked_until = CASE
            WHEN ${shouldLock} THEN now() + (${LOCK_MINUTES} * interval '1 minute')
            ELSE NULL
          END,
          updated_at = now()
      WHERE id = ${current.id}
    `;
    await completeReservedAttempt(
      transaction,
      attemptId,
      current.id,
      null,
      false,
      code,
    );
    await recordLoginAudit(
      transaction,
      normalizedEmail,
      current.id,
      null,
      "DENIED",
      code,
      context,
    );
    return code;
  });
}

async function finalizeSuccessfulLogin(
  sql: Sql,
  attemptId: string,
  normalizedEmail: string,
  snapshot: LoginUserRow,
  token: string,
  tokenHash: string,
  expiresAt: Date,
  context: RequestSecurityContext,
): Promise<LoginTransactionOutcome> {
  return sql.begin<LoginTransactionOutcome>(async (transaction) => {
    const current = await lockCurrentUser(transaction, snapshot.id);
    if (
      !current ||
      current.status !== "ACTIVE" ||
      !current.password_hash ||
      current.password_hash !== snapshot.password_hash ||
      current.password_version !== snapshot.password_version
    ) {
      const code: AuthenticationFailureCode = current
        ? "INVALID_CREDENTIALS"
        : "ACCOUNT_DISABLED";
      await completeReservedAttempt(
        transaction,
        attemptId,
        current?.id ?? snapshot.id,
        null,
        false,
        code,
      );
      await recordLoginAudit(
        transaction,
        normalizedEmail,
        current?.id ?? snapshot.id,
        null,
        "DENIED",
        code,
        context,
      );
      return { ok: false, code };
    }

    if (isCurrentlyLocked(current.locked_until)) {
      const code: AuthenticationFailureCode = "ACCOUNT_LOCKED";
      await completeReservedAttempt(
        transaction,
        attemptId,
        current.id,
        null,
        false,
        code,
      );
      await recordLoginAudit(
        transaction,
        normalizedEmail,
        current.id,
        null,
        "DENIED",
        code,
        context,
      );
      return { ok: false, code };
    }

    await transaction`
      UPDATE users
      SET failed_login_attempts = 0,
          locked_until = NULL,
          last_login_at = now(),
          updated_at = now()
      WHERE id = ${current.id}
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
        ${current.id},
        ${tokenHash},
        ${current.password_version},
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

    await completeReservedAttempt(
      transaction,
      attemptId,
      current.id,
      session.id,
      true,
      null,
    );
    await recordLoginAudit(
      transaction,
      normalizedEmail,
      current.id,
      session.id,
      "SUCCESS",
      null,
      context,
    );
    return { ok: true, token, tokenHash };
  });
}

async function lockCurrentUser(
  transaction: Sql,
  userId: string,
): Promise<LoginUserRow | null> {
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
    WHERE id = ${userId}
      AND deleted_at IS NULL
    LIMIT 1
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function completeReservedAttempt(
  transaction: Sql,
  attemptId: string,
  userId: string | null,
  sessionId: string | null,
  succeeded: boolean,
  failureCode: AuthenticationFailureCode | null,
): Promise<void> {
  const rows = await transaction<{ id: string }[]>`
    UPDATE auth_login_attempts
    SET user_id = ${userId},
        session_id = ${sessionId},
        succeeded = ${succeeded},
        failure_reason = ${failureCode},
        attempt_state = 'COMPLETED',
        completed_at = now()
    WHERE id = ${attemptId}
      AND attempt_state = 'PENDING'
    RETURNING id
  `;
  if (!rows[0]) {
    throw new Error("تعذر إنهاء محاولة تسجيل الدخول المحجوزة.");
  }
}

async function recordLoginAudit(
  sql: Sql,
  normalizedEmail: string,
  userId: string | null,
  sessionId: string | null,
  result: "SUCCESS" | "DENIED",
  failureCode: AuthenticationFailureCode | null,
  context: RequestSecurityContext,
): Promise<void> {
  await sql`
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
      ${userId},
      'USER',
      'auth.login',
      ${sessionId ? "USER_SESSION" : "AUTHENTICATION"},
      ${sessionId ?? normalizedEmail},
      ${context.requestId},
      ${sessionId},
      ${context.ipAddress},
      ${context.userAgent},
      ${result},
      ${JSON.stringify(failureCode ? { failureCode } : { operatingMode: "SINGLE_MANAGER" })}::jsonb
    )
  `;
}

async function getAuthenticatedSessionByHash(
  sql: Sql,
  tokenHash: string,
  touch: boolean,
  idleTimeoutMinutes: number,
): Promise<AuthenticatedSession | null> {
  assertIdleTimeoutMinutes(idleTimeoutMinutes);
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
      COALESCE(array_agg(DISTINCT role.code) FILTER (WHERE role.code IS NOT NULL), ARRAY[]::text[]) AS roles,
      COALESCE(array_agg(DISTINCT permission.code) FILTER (WHERE permission.code IS NOT NULL), ARRAY[]::text[]) AS permissions
    FROM user_sessions AS session
    JOIN users AS user_account ON user_account.id = session.user_id
    CROSS JOIN organization_settings AS organization
    LEFT JOIN user_roles AS user_role
      ON user_role.user_id = user_account.id
     AND user_role.revoked_at IS NULL
     AND user_role.valid_from <= now()
     AND (user_role.valid_until IS NULL OR user_role.valid_until > now())
    LEFT JOIN roles AS role ON role.id = user_role.role_id
    LEFT JOIN role_permissions AS role_permission ON role_permission.role_id = role.id
    LEFT JOIN permissions AS permission ON permission.id = role_permission.permission_id
    WHERE session.token_hash = ${tokenHash}
      AND session.revoked_at IS NULL
      AND session.expires_at > now()
      AND session.last_seen_at > now() - (${idleTimeoutMinutes} * interval '1 minute')
      AND session.password_version = user_account.password_version
      AND user_account.status = 'ACTIVE'
      AND user_account.deleted_at IS NULL
    GROUP BY session.id, user_account.id, organization.operating_mode
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  if (touch) {
    await sql`
      UPDATE user_sessions SET last_seen_at = now()
      WHERE id = ${row.session_id} AND last_seen_at < now() - interval '5 minutes'
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

function isCurrentlyLocked(lockedUntil: Date | string | null): boolean {
  return Boolean(lockedUntil && new Date(lockedUntil).getTime() > Date.now());
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertPositiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} يجب أن يكون عددًا صحيحًا موجبًا.`);
  }
  return value;
}

function assertRequestContext(context: RequestSecurityContext): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(context.requestId)) {
    throw new Error("requestId يجب أن يكون UUID صالحًا.");
  }
}
