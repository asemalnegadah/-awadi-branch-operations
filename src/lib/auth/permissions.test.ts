import { describe, expect, it } from "vitest";

import { hasPermission, type PermissionCode } from "./permissions";

describe("permission implications", () => {
  it("allows visit read-all to pass visit read-own gates", () => {
    const permissions = new Set<PermissionCode>(["visits.read_all"]);

    expect(hasPermission(permissions, "visits.read_own")).toBe(true);
    expect(hasPermission(permissions, "visits.read_all")).toBe(true);
  });

  it("does not grant write permissions through a read implication", () => {
    const permissions = new Set<PermissionCode>(["visits.read_all"]);

    expect(hasPermission(permissions, "visits.create")).toBe(false);
    expect(hasPermission(permissions, "visits.manage")).toBe(false);
  });
});
