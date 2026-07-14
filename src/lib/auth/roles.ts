export const systemRoleCodes = [
  "OWNER_AUDITOR",
  "BRANCH_MANAGER",
  "ACCOUNTING_CASHIER",
  "STOREKEEPER",
  "SALES_REP",
  "AUDITOR",
  "SYSTEM_ADMIN",
] as const;

export type SystemRoleCode = (typeof systemRoleCodes)[number];

const systemRoleCodeSet = new Set<string>(systemRoleCodes);

export function isSystemRoleCode(value: string): value is SystemRoleCode {
  return systemRoleCodeSet.has(value);
}

export const systemRoleNamesAr: Readonly<Record<SystemRoleCode, string>> = {
  OWNER_AUDITOR: "المالك أو المراقب",
  BRANCH_MANAGER: "مدير فرع عدن",
  ACCOUNTING_CASHIER: "الحسابات والصندوق",
  STOREKEEPER: "أمين المخزن",
  SALES_REP: "المندوب",
  AUDITOR: "المدقق",
  SYSTEM_ADMIN: "مدير النظام",
};
