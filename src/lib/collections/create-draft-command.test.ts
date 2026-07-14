import { describe, expect, it } from "vitest";

import type { PermissionCode } from "@/lib/auth/permissions";

import {
  createCollectionDraftCommand,
  type CollectionDraftPersistence,
} from "./create-draft-command";
import { createCollectionDraft } from "./workflow";

const actorUserId = "11111111-1111-4111-8111-111111111111";
const representativeId = "22222222-2222-4222-8222-222222222222";
const customerId = "33333333-3333-4333-8333-333333333333";
const accountId = "44444444-4444-4444-8444-444444444444";
const generatedId = "55555555-5555-4555-8555-555555555555";
const requestId = "66666666-6666-4666-8666-666666666666";

function request() {
  return {
    customerId,
    customerAccountId: accountId,
    representativeId,
    currency: "SR",
    amountMinor: 15_000,
    paymentMethod: "CASH",
    collectedAt: "2026-07-14T12:00:00.000Z",
    evidence: { receiptNumber: "RCPT-CMD-001" },
  };
}

function permissions(...values: PermissionCode[]): ReadonlySet<PermissionCode> {
  return new Set(values);
}

describe("Create collection draft command", () => {
  it("ينشئ مسودة بوقت ومعرف من الخادم", async () => {
    let persistedId: string | undefined;
    let persistedCreatedAt: string | undefined;

    const persistence: CollectionDraftPersistence = {
      async create(input) {
        persistedId = input.id;
        persistedCreatedAt = input.createdAt;
        return {
          collection: createCollectionDraft(input),
          replayed: false,
        };
      },
    };

    const execute = createCollectionDraftCommand({
      persistence,
      generateId: () => generatedId,
      now: () => new Date("2026-07-14T12:05:00.000Z"),
    });

    const result = await execute(request(), {
      actorUserId,
      actorRepresentativeId: representativeId,
      permissions: permissions("collections.create"),
      idempotencyKey: "collection-command-001",
      requestId,
    });

    expect(persistedId).toBe(generatedId);
    expect(persistedCreatedAt).toBe("2026-07-14T12:05:00.000Z");
    expect(result.collection.createdBy).toBe(actorUserId);
  });

  it("يرفض المستخدم دون صلاحية إنشاء تحصيل", async () => {
    const persistence: CollectionDraftPersistence = {
      async create() {
        throw new Error("يجب ألا يصل التنفيذ إلى التخزين");
      },
    };
    const execute = createCollectionDraftCommand({ persistence });

    await expect(
      execute(request(), {
        actorUserId,
        actorRepresentativeId: representativeId,
        permissions: permissions(),
        idempotencyKey: "collection-command-002",
        requestId,
      }),
    ).rejects.toThrow("لا يملك المستخدم صلاحية إنشاء تحصيل");
  });

  it("يرفض إنشاء المندوب تحصيلًا باسم مندوب آخر", async () => {
    const persistence: CollectionDraftPersistence = {
      async create() {
        throw new Error("يجب ألا يصل التنفيذ إلى التخزين");
      },
    };
    const execute = createCollectionDraftCommand({ persistence });

    await expect(
      execute(request(), {
        actorUserId,
        actorRepresentativeId: "77777777-7777-4777-8777-777777777777",
        permissions: permissions("collections.create"),
        idempotencyKey: "collection-command-003",
        requestId,
      }),
    ).rejects.toThrow("لا يجوز للمندوب إنشاء تحصيل باسم مندوب آخر");
  });

  it("يرفض المبلغ غير الموجب أو تاريخًا غير صالح", async () => {
    const persistence: CollectionDraftPersistence = {
      async create() {
        throw new Error("يجب ألا يصل التنفيذ إلى التخزين");
      },
    };
    const execute = createCollectionDraftCommand({ persistence });
    const context = {
      actorUserId,
      actorRepresentativeId: representativeId,
      permissions: permissions("collections.create"),
      idempotencyKey: "collection-command-004",
      requestId,
    };

    await expect(
      execute({ ...request(), amountMinor: 0 }, context),
    ).rejects.toThrow();

    await expect(
      execute({ ...request(), collectedAt: "not-a-date" }, context),
    ).rejects.toThrow();
  });
});
