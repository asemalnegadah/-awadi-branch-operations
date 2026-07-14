import type { Sql } from "postgres";

import type {
  PasswordResetEmailSender,
  PasswordResetPurpose,
} from "@/lib/email/password-reset-email";

import { hashPassword } from "./password";
import {
  createPasswordResetToken,
  hashPasswordResetToken,
  isPasswordResetToken,
} from "./password-reset-token";
import type { RequestSecurityContext } from "./types";

interface ResetUserRow {
  id: string;
  email: string;
  full_name: string;
  status: string;
}

interface ResetTokenRow {
  id: string;
  user_id: string;
  purpose: PasswordResetPurpose;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  revoked_at: Date | string | null;
  email: string;
  full_name: string;
  status: string;
}

interface CountRow {
  count: number;
}

interface PreparedReset {
  readonly tokenId: string;
  readonly rawToken: string;
  readonly purpose: PasswordResetPurpose;
  readonly user: ResetUserRow;
}

export interface PasswordRecoveryConfiguration {
  readonly authSecret: string;
  readonly appBaseUrl: string;
  readonly tokenTtlMinutes: number;
  readonly maxEmailRequestsPerHour: number;
  readonly maxIpRequestsPerHour: number;
  readonly allowInitialManagerBootstrap: boolean;
  readonly initialManagerEmail?: string;
  readonly initialManagerName?: string;
}

export class PasswordResetError extends Error {
  constructor(
    public readonly code:
      | "INVALID_OR_EXPIRED_TOKEN"
      | "DELIVERY_FAILED"
      | "BOOTSTRAP_CONFIGURATION_INVALID",
  ) {
    super(
      code === "INVALID_OR_EXPIRED_TOKEN"
        ? "رابط الاستعادة غير صالح أو انتهت صلاحيته."
        : code === "DELIVERY_FAILED"
          ? "تعذر إرسال رسالة الاستعادة الآن."
          : "إعداد التفعيل الأولي غير مكتمل.",
    );
    this.name = "PasswordResetError";
  }
}

export async function requestPasswordResetPostgres(
  sql: Sql,
  email: string,
  context: RequestSecurityContext,
  configuration: PasswordRecoveryConfiguration,
  sender: PasswordResetEmailSender,
): Promise<void> {
  const normalizedEmail = normalizeEmail(email);
  assertConfiguration(configuration);

  const prepared = await sql.begin<PreparedReset | null>(async (transaction) => {
    const throttled = await isRequestThrottled(
      transaction,
      normalizedEmail,
      context,
      configuration,
    );

    if (throttled) {
      await recordRequestAudit(
        transaction,
        null,
        normalizedEmail,
        context,
        "DENIED",
        { outcome: "THROTTLED" },
      );
      return null;
    }

    let user = await findEligibleUser(transaction, normalizedEmail);

    if (!user && canBootstrapInitialManager(normalizedEmail, configuration)) {
      user = await createInitialManagerInvitation(
        transaction,
        normalizedEmail,
        configuration.initialManagerName ?? "",
        context,
      );
    }

    if (!user) {
      await recordRequestAudit(
        transaction,
        null,
        normalizedEmail,
        context,
        "SUCCESS",
        { outcome: "NO_ELIGIBLE_ACCOUNT" },
      );
      return null;
    }

    const rawToken = createPasswordResetToken();
    const tokenHash = hashPasswordResetToken(rawToken, configuration.authSecret);
    const purpose: PasswordResetPurpose = user.status === "INVITED" ? "INVITE" : "RESET";

    await transaction`
      UPDATE password_reset_tokens
      SET revoked_at = now(),
          revoke_reason = 'REPLACED_BY_NEW_REQUEST'
      WHERE user_id = ${user.id}
        AND consumed_at IS NULL
        AND revoked_at IS NULL
    `;

    const insertedRows = await transaction<{ id: string }[]>`
      INSERT INTO password_reset_tokens (
        user_id,
        token_hash,
        purpose,
        expires_at,
        request_id,
        requested_ip,
        metadata
      ) VALUES (
        ${user.id},
        ${tokenHash},
        ${purpose},
        now() + (${configuration.tokenTtlMinutes} * interval '1 minute'),
        ${context.requestId},
        ${context.ipAddress},
        ${JSON.stringify({ userAgent: context.userAgent })}::jsonb
      )
      RETURNING id
    `;
    const inserted = insertedRows[0];
    if (!inserted) {
      throw new Error("تعذر إنشاء رمز استعادة كلمة المرور.");
    }

    await recordRequestAudit(
      transaction,
      user.id,
      normalizedEmail,
      context,
      "SUCCESS",
      { outcome: "TOKEN_CREATED", purpose },
    );

    return {
      tokenId: inserted.id,
      rawToken,
      purpose,
      user,
    };
  });

  if (!prepared) {
    return;
  }

  const resetUrl = buildResetUrl(configuration.appBaseUrl, prepared.rawToken);

  try {
    const delivery = await sender.send({
      to: prepared.user.email,
      fullName: prepared.user.full_name,
      resetUrl,
      purpose: prepared.purpose,
      expiresInMinutes: configuration.tokenTtlMinutes,
      idempotencyKey: `password-reset-${prepared.tokenId}`,
    });

    await sql.begin(async (transaction) => {
      await transaction`
        UPDATE password_reset_tokens
        SET delivered_at = now(),
            delivery_provider = ${delivery.provider},
            delivery_id = ${delivery.messageId}
        WHERE id = ${prepared.tokenId}
          AND consumed_at IS NULL
          AND revoked_at IS NULL
      `;

      await transaction`
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
          ${prepared.user.id},
          'SYSTEM',
          'auth.password_reset.email_sent',
          'USER',
          ${prepared.user.id},
          ${context.requestId},
          ${context.ipAddress},
          ${context.userAgent},
          'SUCCESS',
          ${JSON.stringify({
            purpose: prepared.purpose,
            provider: delivery.provider,
            deliveryId: delivery.messageId,
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    await sql.begin(async (transaction) => {
      await transaction`
        UPDATE password_reset_tokens
        SET revoked_at = now(),
            revoke_reason = 'DELIVERY_FAILED'
        WHERE id = ${prepared.tokenId}
          AND consumed_at IS NULL
          AND revoked_at IS NULL
      `;

      await transaction`
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
          ${prepared.user.id},
          'SYSTEM',
          'auth.password_reset.email_sent',
          'USER',
          ${prepared.user.id},
          ${context.requestId},
          ${context.ipAddress},
          ${context.userAgent},
          'FAILED',
          ${JSON.stringify({
            purpose: prepared.purpose,
            error: error instanceof Error ? error.message.slice(0, 240) : "unknown",
          })}::jsonb
        )
      `;
    });

    throw new PasswordResetError("DELIVERY_FAILED");
  }
}

export async function resetPasswordPostgres(
  sql: Sql,
  rawToken: string,
  newPassword: string,
  context: RequestSecurityContext,
  configuration: Pick<PasswordRecoveryConfiguration, "authSecret">,
): Promise<void> {
  if (!isPasswordResetToken(rawToken)) {
    throw new PasswordResetError("INVALID_OR_EXPIRED_TOKEN");
  }

  const tokenHash = hashPasswordResetToken(rawToken, configuration.authSecret);
  const passwordHash = await hashPassword(newPassword);

  const resetSucceeded = await sql.begin<boolean>(async (transaction) => {
    const tokenRows = await transaction<ResetTokenRow[]>`
      SELECT
        reset_token.id,
        reset_token.user_id,
        reset_token.purpose,
        reset_token.expires_at,
        reset_token.consumed_at,
        reset_token.revoked_at,
        user_account.email,
        user_account.full_name,
        user_account.status
      FROM password_reset_tokens AS reset_token
      JOIN users AS user_account ON user_account.id = reset_token.user_id
      WHERE reset_token.token_hash = ${tokenHash}
        AND user_account.deleted_at IS NULL
      LIMIT 1
      FOR UPDATE OF reset_token, user_account
    `;
    const token = tokenRows[0];

    if (
      !token ||
      token.consumed_at ||
      token.revoked_at ||
      new Date(token.expires_at).getTime() <= Date.now() ||
      !["INVITED", "ACTIVE"].includes(token.status)
    ) {
      return false;
    }

    await transaction`
      UPDATE users
      SET password_hash = ${passwordHash},
          status = 'ACTIVE',
          password_changed_at = now(),
          password_version = password_version + 1,
          must_change_password = false,
          failed_login_attempts = 0,
          locked_until = NULL,
          updated_at = now(),
          updated_by = ${token.user_id}
      WHERE id = ${token.user_id}
    `;

    await transaction`
      UPDATE user_sessions
      SET revoked_at = now(),
          revoked_by = ${token.user_id},
          revoke_reason = 'PASSWORD_RESET'
      WHERE user_id = ${token.user_id}
        AND revoked_at IS NULL
    `;

    await transaction`
      UPDATE password_reset_tokens
      SET consumed_at = now(),
          consumed_ip = ${context.ipAddress}
      WHERE id = ${token.id}
    `;

    await transaction`
      UPDATE password_reset_tokens
      SET revoked_at = now(),
          revoke_reason = 'PASSWORD_RESET_COMPLETED'
      WHERE user_id = ${token.user_id}
        AND id <> ${token.id}
        AND consumed_at IS NULL
        AND revoked_at IS NULL
    `;

    await transaction`
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
        ${token.user_id},
        'USER',
        'auth.password_reset.completed',
        'USER',
        ${token.user_id},
        ${context.requestId},
        ${context.ipAddress},
        ${context.userAgent},
        'SUCCESS',
        ${JSON.stringify({ purpose: token.purpose, revokedSessions: true })}::jsonb
      )
    `;

    return true;
  });

  if (!resetSucceeded) {
    throw new PasswordResetError("INVALID_OR_EXPIRED_TOKEN");
  }
}

async function isRequestThrottled(
  sql: Sql,
  normalizedEmail: string,
  context: RequestSecurityContext,
  configuration: PasswordRecoveryConfiguration,
): Promise<boolean> {
  const emailRows = await sql<CountRow[]>`
    SELECT COUNT(*)::integer AS count
    FROM audit_logs
    WHERE action = 'auth.password_reset.request'
      AND resource_type = 'AUTHENTICATION'
      AND resource_id = ${normalizedEmail}
      AND occurred_at > now() - interval '1 hour'
  `;

  if ((emailRows[0]?.count ?? 0) >= configuration.maxEmailRequestsPerHour) {
    return true;
  }

  if (!context.ipAddress) {
    return false;
  }

  const ipRows = await sql<CountRow[]>`
    SELECT COUNT(*)::integer AS count
    FROM audit_logs
    WHERE action = 'auth.password_reset.request'
      AND ip_address = ${context.ipAddress}
      AND occurred_at > now() - interval '1 hour'
  `;

  return (ipRows[0]?.count ?? 0) >= configuration.maxIpRequestsPerHour;
}

async function findEligibleUser(
  sql: Sql,
  normalizedEmail: string,
): Promise<ResetUserRow | null> {
  const rows = await sql<ResetUserRow[]>`
    SELECT id, email, full_name, status
    FROM users
    WHERE email = ${normalizedEmail}
      AND status IN ('INVITED', 'ACTIVE')
      AND deleted_at IS NULL
    LIMIT 1
    FOR UPDATE
  `;

  return rows[0] ?? null;
}

function canBootstrapInitialManager(
  normalizedEmail: string,
  configuration: PasswordRecoveryConfiguration,
): boolean {
  return (
    configuration.allowInitialManagerBootstrap &&
    normalizeEmail(configuration.initialManagerEmail ?? "") === normalizedEmail
  );
}

async function createInitialManagerInvitation(
  sql: Sql,
  normalizedEmail: string,
  fullName: string,
  context: RequestSecurityContext,
): Promise<ResetUserRow> {
  if (fullName.trim().length < 2) {
    throw new PasswordResetError("BOOTSTRAP_CONFIGURATION_INVALID");
  }

  const userCountRows = await sql<CountRow[]>`
    SELECT COUNT(*)::integer AS count
    FROM users
    WHERE deleted_at IS NULL
  `;

  if ((userCountRows[0]?.count ?? 0) !== 0) {
    throw new PasswordResetError("BOOTSTRAP_CONFIGURATION_INVALID");
  }

  const managerRoleRows = await sql<{ id: string }[]>`
    SELECT id
    FROM roles
    WHERE code = 'BRANCH_MANAGER'
    LIMIT 1
    FOR UPDATE
  `;
  const managerRole = managerRoleRows[0];
  if (!managerRole) {
    throw new PasswordResetError("BOOTSTRAP_CONFIGURATION_INVALID");
  }

  const userRows = await sql<ResetUserRow[]>`
    INSERT INTO users (
      email,
      full_name,
      status,
      must_change_password
    ) VALUES (
      ${normalizedEmail},
      ${fullName.trim()},
      'INVITED',
      true
    )
    RETURNING id, email, full_name, status
  `;
  const user = userRows[0];
  if (!user) {
    throw new Error("تعذر إنشاء حساب مدير الفرع الأول.");
  }

  await sql`
    INSERT INTO user_roles (user_id, role_id, granted_by)
    VALUES (${user.id}, ${managerRole.id}, ${user.id})
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
      reason,
      result,
      metadata
    ) VALUES (
      ${user.id},
      'SYSTEM',
      'auth.bootstrap_manager_invitation',
      'USER',
      ${user.id},
      ${context.requestId},
      ${context.ipAddress},
      ${context.userAgent},
      'EMAIL_ACTIVATION_REQUIRED',
      'SUCCESS',
      '{"operatingMode":"SINGLE_MANAGER"}'::jsonb
    )
  `;

  return user;
}

async function recordRequestAudit(
  sql: Sql,
  userId: string | null,
  normalizedEmail: string,
  context: RequestSecurityContext,
  result: "SUCCESS" | "DENIED" | "FAILED",
  metadata: Record<string, unknown>,
): Promise<void> {
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
      'SYSTEM',
      'auth.password_reset.request',
      'AUTHENTICATION',
      ${normalizedEmail},
      ${context.requestId},
      ${context.ipAddress},
      ${context.userAgent},
      ${result},
      ${JSON.stringify(metadata)}::jsonb
    )
  `;
}

function buildResetUrl(appBaseUrl: string, rawToken: string): string {
  const url = new URL("/reset-password", appBaseUrl);
  url.hash = `token=${rawToken}`;
  return url.toString();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertConfiguration(configuration: PasswordRecoveryConfiguration): void {
  if (configuration.authSecret.length < 32) {
    throw new PasswordResetError("BOOTSTRAP_CONFIGURATION_INVALID");
  }

  const url = new URL(configuration.appBaseUrl);
  if (!url.origin || !["http:", "https:"].includes(url.protocol)) {
    throw new PasswordResetError("BOOTSTRAP_CONFIGURATION_INVALID");
  }

  if (
    configuration.tokenTtlMinutes < 10 ||
    configuration.tokenTtlMinutes > 60 ||
    configuration.maxEmailRequestsPerHour < 1 ||
    configuration.maxIpRequestsPerHour < 1
  ) {
    throw new PasswordResetError("BOOTSTRAP_CONFIGURATION_INVALID");
  }
}
