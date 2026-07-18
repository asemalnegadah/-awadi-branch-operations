export const permissionCodes = [
  "dashboard.read",
  "users.read",
  "users.manage",
  "roles.read",
  "roles.manage",
  "audit.read",
  "audit.export",
  "customers.read_own",
  "customers.read_all",
  "customers.manage",
  "collections.create",
  "collections.review",
  "collections.approve",
  "collections.reverse",
  "promises.read",
  "promises.create",
  "promises.update",
  "promises.follow_up",
  "promises.reject",
  "promises.cancel",
  "promises.allocate_collection",
  "promises.reverse_allocation",
  "promises.escalate",
  "promises.view_history",
  "plans.read_own",
  "plans.manage",
  "plans.approve",
  "reports.read",
  "reports.export",
  "settings.manage",
] as const;

export type PermissionCode = (typeof permissionCodes)[number];

const permissionSet = new Set<string>(permissionCodes);

export function isPermissionCode(value: string): value is PermissionCode {
  return permissionSet.has(value);
}

export function hasPermission(
  grantedPermissions: ReadonlySet<PermissionCode>,
  requiredPermission: PermissionCode,
): boolean {
  return grantedPermissions.has(requiredPermission);
}
