import type { PermissionCode } from "./permissions";
import { hasPermission } from "./permissions";
import type { AuthenticatedUser } from "./types";
import { AuthorizationError } from "./types";

export function requirePermission(
  user: AuthenticatedUser,
  permission: PermissionCode,
): void {
  if (!hasPermission(user.permissions, permission)) {
    throw new AuthorizationError();
  }
}

export function canSelfApprove(user: AuthenticatedUser): boolean {
  return (
    user.operatingMode === "SINGLE_MANAGER" &&
    user.roles.includes("BRANCH_MANAGER")
  );
}
