import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";

const FORMAT = "scrypt-v1";
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAX_MEMORY = 64 * 1024 * 1024;

export const passwordPolicy = Object.freeze({
  minimumLength: 12,
  maximumLength: 128,
});

export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordPolicyError";
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);

  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = await deriveKey(password, salt);

  return [
    FORMAT,
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  try {
    const parts = encodedHash.split("$");
    if (parts.length !== 6) {
      return false;
    }

    const [format, costText, blockSizeText, parallelizationText, saltText, keyText] =
      parts;

    if (
      format !== FORMAT ||
      Number(costText) !== COST ||
      Number(blockSizeText) !== BLOCK_SIZE ||
      Number(parallelizationText) !== PARALLELIZATION ||
      !saltText ||
      !keyText
    ) {
      return false;
    }

    const salt = Buffer.from(saltText, "base64url");
    const expectedKey = Buffer.from(keyText, "base64url");

    if (salt.length !== SALT_LENGTH || expectedKey.length !== KEY_LENGTH) {
      return false;
    }

    const actualKey = await deriveKey(password, salt);
    return timingSafeEqual(actualKey, expectedKey);
  } catch {
    return false;
  }
}

export function assertPasswordPolicy(password: string): void {
  if (password.length < passwordPolicy.minimumLength) {
    throw new PasswordPolicyError(
      `يجب ألا تقل كلمة المرور عن ${passwordPolicy.minimumLength} حرفًا.`,
    );
  }

  if (password.length > passwordPolicy.maximumLength) {
    throw new PasswordPolicyError(
      `يجب ألا تزيد كلمة المرور عن ${passwordPolicy.maximumLength} حرفًا.`,
    );
  }
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      {
        N: COST,
        r: BLOCK_SIZE,
        p: PARALLELIZATION,
        maxmem: MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      },
    );
  });
}
