import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("reconciliation PostgreSQL source repair export", () => {
  it("exports the exact repaired repository source for an atomic Git data update", () => {
    const source = readFileSync("src/lib/reconciliations/postgres-repository.ts", "utf8");
    const replacements = [
      [
        "$9::bigint, $10::bigint, $11, $12,",
        "$9::bigint, $10::bigint, $11::text, $12::text,",
      ],
      [
        "jsonb_build_object('reconciliationId', $8, 'settlementId', $12)",
        "jsonb_build_object('reconciliationId', $8::text, 'settlementId', $12::uuid)",
      ],
      [
        "jsonb_build_object('idempotencyKey', $11)",
        "jsonb_build_object('idempotencyKey', $11::text)",
      ],
    ] as const;

    let repaired = source;
    for (const [before, after] of replacements) {
      expect(repaired.split(before)).toHaveLength(2);
      repaired = repaired.replace(before, after);
    }

    console.log("PATCHED_SOURCE_BASE64_BEGIN");
    console.log(Buffer.from(repaired, "utf8").toString("base64"));
    console.log("PATCHED_SOURCE_BASE64_END");
    throw new Error("intentional source export; remove this diagnostic test in the repair commit");
  });
});
