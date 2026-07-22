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
  "risk.read",
  "risk.recalculate",
  "risk.view_history",
  "credit_restrictions.propose",
  "credit_restrictions.approve",
  "credit_restrictions.revoke",
  "credit_exceptions.propose",
  "credit_exceptions.approve",
  "credit_exceptions.revoke",
  "credit_exceptions.consume",
  "reconciliations.read",
  "reconciliations.create",
  "reconciliations.review",
  "reconciliations.approve",
  "reconciliations.settle",
  "reconciliations.view_history",
  "plans.read_own",
  "plans.read_all",
  "plans.generate",
  "plans.manage",
  "plans.approve",
  "plans.execute",
  "plans.view_history",
  "visits.read_own",
  "visits.read_all",
  "visits.create",
  "visits.manage",
  "visits.verify",
  "visits.view_history",
  "reports.read",
  "reports.export",
  "settings.manage",
] as const;

export type PermissionCode = (typeof permissionCodes)[number];

const permissionSet = new Set<string>(permissionCodes);

const permissionImplications: Partial<Record<PermissionCode, readonly PermissionCode[]>> = {
  "visits.read_own": ["visits.read_all"],
};

export function isPermissionCode(value: string): value is PermissionCode {
  return permissionSet.has(value);
}

export function hasPermission(
  grantedPermissions: ReadonlySet<PermissionCode>,
  requiredPermission: PermissionCode,
): boolean {
  if (grantedPermissions.has(requiredPermission)) return true;
  return permissionImplications[requiredPermission]?.some((permission) => (
    grantedPermissions.has(permission)
  )) ?? false;
}
