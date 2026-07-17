import type { PermissionCode } from "./permissions";
import type { SystemRoleCode } from "./roles";

export type OperatingMode = "SINGLE_MANAGER" | "MULTI_USER";

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly roles: readonly SystemRoleCode[];
  readonly permissions: ReadonlySet<PermissionCode>;
  readonly operatingMode: OperatingMode;
  readonly mustChangePassword: boolean;
}

export interface AuthenticatedSession {
  readonly id: string;
  readonly user: AuthenticatedUser;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export interface RequestSecurityContext {
  readonly requestId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export interface LoginResult {
  readonly token: string;
  readonly session: AuthenticatedSession;
}

export type AuthenticationFailureCode =
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_DISABLED"
  | "RATE_LIMITED";

export class AuthenticationError extends Error {
  readonly code: AuthenticationFailureCode;

  constructor(code: AuthenticationFailureCode) {
    super("تعذر تسجيل الدخول. تحقق من البيانات وحاول مرة أخرى.");
    this.name = "AuthenticationError";
    this.code = code;
  }
}

export class AuthorizationError extends Error {
  constructor() {
    super("لا تملك الصلاحية اللازمة لتنفيذ هذه العملية.");
    this.name = "AuthorizationError";
  }
}
