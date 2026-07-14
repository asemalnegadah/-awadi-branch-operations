import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
} from "node:crypto";

import postgres from "postgres";

const requiredNames = [
  "DATABASE_URL",
  "MANAGER_EMAIL",
  "MANAGER_NAME",
  "MANAGER_PASSWORD",
];

for (const name of requiredNames) {
  if (!process.env[name]?.trim()) {
    throw new Error(`${name} is required.`);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const email = process.env.MANAGER_EMAIL.trim().toLowerCase();
const fullName = process.env.MANAGER_NAME.trim();
const password = process.env.MANAGER_PASSWORD;
const allowReset = process.env.ALLOW_MANAGER_PASSWORD_RESET === "true";

if (!email.includes("@") || email.length > 254) {
  throw new Error("MANAGER_EMAIL is invalid.");
}

if (fullName.length < 2 || fullName.length > 200) {
  throw new Error("MANAGER_NAME is invalid.");
}

if (password.length < 12 || password.length > 128) {
  throw new Error("MANAGER_PASSWORD must contain between 12 and 128 characters.");
}

const passwordHash = await hashPassword(password);
const requestId = randomUUID();
const sql = postgres(databaseUrl, {
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
  onnotice: () => undefined,
});

try {
  const outcome = await sql.begin(async (transaction) => {
    const managerRoleRows = await transaction`
      SELECT id
      FROM roles
      WHERE code = 'BRANCH_MANAGER'
      LIMIT 1
      FOR UPDATE
    `;
    const managerRole = managerRoleRows[0];
    if (!managerRole) {
      throw new Error("BRANCH_MANAGER role is missing. Apply migrations first.");
    }

    const existingRows = await transaction`
      SELECT id, password_hash
      FROM users
      WHERE email = ${email}
        AND deleted_at IS NULL
      LIMIT 1
      FOR UPDATE
    `;
    const existing = existingRows[0];

    const activeManagerRows = await transaction`
      SELECT user_account.id, user_account.email
      FROM users AS user_account
      JOIN user_roles AS user_role ON user_role.user_id = user_account.id
      JOIN roles AS role ON role.id = user_role.role_id
      WHERE role.code = 'BRANCH_MANAGER'
        AND user_account.status = 'ACTIVE'
        AND user_account.deleted_at IS NULL
        AND user_role.revoked_at IS NULL
        AND user_role.valid_from <= now()
        AND (user_role.valid_until IS NULL OR user_role.valid_until > now())
      FOR UPDATE OF user_account
    `;

    if (!existing && activeManagerRows.length > 0) {
      throw new Error(
        "An active branch manager already exists. Refusing to create a second manager in SINGLE_MANAGER mode.",
      );
    }

    let userId;
    let action;

    if (existing) {
      if (!allowReset) {
        throw new Error(
          "The manager email already exists. Set ALLOW_MANAGER_PASSWORD_RESET=true only for an intentional password reset.",
        );
      }

      const updatedRows = await transaction`
        UPDATE users
        SET full_name = ${fullName},
            password_hash = ${passwordHash},
            password_changed_at = now(),
            password_version = password_version + 1,
            must_change_password = false,
            status = 'ACTIVE',
            failed_login_attempts = 0,
            locked_until = NULL,
            updated_at = now()
        WHERE id = ${existing.id}
        RETURNING id
      `;
      userId = updatedRows[0].id;
      action = "RESET";

      await transaction`
        UPDATE user_sessions
        SET revoked_at = now(),
            revoked_by = ${userId},
            revoke_reason = 'MANAGER_PASSWORD_RESET'
        WHERE user_id = ${userId}
          AND revoked_at IS NULL
      `;
    } else {
      const insertedRows = await transaction`
        INSERT INTO users (
          email,
          full_name,
          password_hash,
          status,
          password_changed_at,
          must_change_password
        ) VALUES (
          ${email},
          ${fullName},
          ${passwordHash},
          'ACTIVE',
          now(),
          false
        )
        RETURNING id
      `;
      userId = insertedRows[0].id;
      action = "CREATE";
    }

    await transaction`
      INSERT INTO user_roles (user_id, role_id, granted_by)
      VALUES (${userId}, ${managerRole.id}, ${userId})
      ON CONFLICT (user_id, role_id, valid_from) DO NOTHING
    `;

    await transaction`
      UPDATE organization_settings
      SET operating_mode = 'SINGLE_MANAGER',
          updated_at = now()
      WHERE singleton_id = 1
    `;

    await transaction`
      INSERT INTO audit_logs (
        actor_user_id,
        actor_type,
        action,
        resource_type,
        resource_id,
        request_id,
        reason,
        result,
        metadata
      ) VALUES (
        ${userId},
        'SYSTEM',
        'auth.bootstrap_manager',
        'USER',
        ${userId},
        ${requestId},
        ${action},
        'SUCCESS',
        ${JSON.stringify({ operatingMode: "SINGLE_MANAGER" })}::jsonb
      )
    `;

    return { userId, action };
  });

  console.log(
    `Manager bootstrap completed (${outcome.action}). User ID: ${outcome.userId}`,
  );
} finally {
  await sql.end({ timeout: 5 });
}

async function hashPassword(value) {
  const salt = randomBytes(16);
  const derivedKey = await new Promise((resolve, reject) => {
    scryptCallback(
      value,
      salt,
      64,
      { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(key);
      },
    );
  });

  return [
    "scrypt-v1",
    16_384,
    8,
    1,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}
