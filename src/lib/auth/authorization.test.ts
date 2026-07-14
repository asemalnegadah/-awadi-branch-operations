import { describe, expect, it } from "vitest";

import { canSelfApprove, requirePermission } from "./authorization";
import type { PermissionCode } from "./permissions";
import type { AuthenticatedUser } from "./types";
import { AuthorizationError } from "./types";

function buildUser(
  permissions: readonly PermissionCode[],
  operatingMode: AuthenticatedUser["operatingMode"] = "SINGLE_MANAGER",
): AuthenticatedUser {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    email: "manager@example.test",
    fullName: "مدير الفرع",
    roles: ["BRANCH_MANAGER"],
    permissions: new Set(permissions),
    operatingMode,
    mustChangePassword: false,
  };
}

describe("authorization", () => {
  it("يسمح بالصلاحية الممنوحة ويرفض غير الممنوحة", () => {
    const user = buildUser(["dashboard.read"]);

    expect(() => requirePermission(user, "dashboard.read")).not.toThrow();
    expect(() => requirePermission(user, "collections.approve")).toThrow(
      AuthorizationError,
    );
  });

  it("يسمح لمدير الفرع بالاعتماد الذاتي في وضع المستخدم الواحد فقط", () => {
    expect(canSelfApprove(buildUser([]))).toBe(true);
    expect(canSelfApprove(buildUser([], "MULTI_USER"))).toBe(false);
  });
});
