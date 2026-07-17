import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseQuery = vi.fn();

vi.mock("@/lib/db/client", () => ({
  getDatabaseClient: () => databaseQuery,
}));

import { GET } from "./route";

describe("GET /api/health", () => {
  beforeEach(() => {
    databaseQuery.mockReset();
  });

  it("returns a minimal healthy response when the database is reachable", async () => {
    databaseQuery.mockResolvedValueOnce([{ "?column?": 1 }]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(body).toMatchObject({
      status: "ok",
      service: "awadi-branch-operations",
      dependencies: {
        database: "ok",
      },
    });
    expect(body).not.toHaveProperty("database_time");
    expect(body).not.toHaveProperty("started_at");
  });

  it("returns 503 without exposing the database error", async () => {
    databaseQuery.mockRejectedValueOnce(
      new Error("postgresql://secret-user:secret-password@private-host/database"),
    );

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      status: "degraded",
      service: "awadi-branch-operations",
      dependencies: {
        database: "unavailable",
      },
    });
    expect(JSON.stringify(body)).not.toContain("secret-password");
    expect(JSON.stringify(body)).not.toContain("private-host");
  });
});
