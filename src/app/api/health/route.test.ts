import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseQuery = vi.fn();

vi.mock("@/lib/db/client", () => ({
  getDatabaseClient: () => databaseQuery,
}));

import { GET } from "./route";

describe("GET /api/health", () => {
  beforeEach(() => databaseQuery.mockReset());

  it("returns only public health state when healthy", async () => {
    databaseQuery.mockResolvedValueOnce([{ "?column?": 1 }]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "awadi-branch-operations" });
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
  });

  it("does not expose internal dependency errors", async () => {
    databaseQuery.mockRejectedValueOnce(
      new Error("postgresql://secret-user:secret-password@private-host/database"),
    );
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toEqual({ status: "degraded", service: "awadi-branch-operations" });
    expect(JSON.stringify(body)).not.toMatch(/secret|postgres|dependencies|timestamp|private-host/u);
  });
});
