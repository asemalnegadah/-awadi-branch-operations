import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { PermissionCode } from "@/lib/auth/permissions";
import { hasPermission } from "@/lib/auth/permissions";
import type { CurrencyCode } from "@/lib/domain/currency";

import type { CollectionPaymentMethod, CollectionRecord } from "./types";
import type { CreateCollectionDraftInput } from "./workflow";

const createCollectionDraftRequestSchema = z.object({
  customerId: z.string().uuid(),
  customerAccountId: z.string().uuid(),
  representativeId: z.string().uuid(),
  currency: z.enum(["SR", "RG"]),
  amountMinor: z.number().int().safe().positive(),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CHECK", "OTHER"]),
  collectedAt: z.string().datetime({ offset: true }),
  evidence: z
    .object({
      receiptNumber: z.string().trim().min(1).max(100).optional(),
      evidenceDocumentId: z.string().uuid().optional(),
      note: z.string().trim().max(1000).optional(),
    })
    .optional(),
});

export type CreateCollectionDraftRequest = z.infer<
  typeof createCollectionDraftRequestSchema
>;

export interface CollectionCommandContext {
  readonly actorUserId: string;
  readonly actorRepresentativeId?: string | undefined;
  readonly permissions: ReadonlySet<PermissionCode>;
  readonly idempotencyKey: string;
  readonly requestId: string;
}

export interface CollectionDraftPersistence {
  create(
    input: CreateCollectionDraftInput,
    context: { idempotencyKey: string; requestId: string },
  ): Promise<{ collection: CollectionRecord; replayed: boolean }>;
}

interface CreateCollectionDraftCommandDependencies {
  readonly persistence: CollectionDraftPersistence;
  readonly generateId?: () => string;
  readonly now?: () => Date;
}

export function createCollectionDraftCommand({
  persistence,
  generateId = randomUUID,
  now = () => new Date(),
}: CreateCollectionDraftCommandDependencies) {
  return async function execute(
    rawRequest: unknown,
    context: CollectionCommandContext,
  ): Promise<{ collection: CollectionRecord; replayed: boolean }> {
    assertContext(context);

    if (!hasPermission(context.permissions, "collections.create")) {
      throw new Error("لا يملك المستخدم صلاحية إنشاء تحصيل.");
    }

    const request = createCollectionDraftRequestSchema.parse(rawRequest);

    if (
      context.actorRepresentativeId &&
      context.actorRepresentativeId !== request.representativeId
    ) {
      throw new Error("لا يجوز للمندوب إنشاء تحصيل باسم مندوب آخر.");
    }

    const input: CreateCollectionDraftInput = {
      id: generateId(),
      customerId: request.customerId,
      customerAccountId: request.customerAccountId,
      representativeId: request.representativeId,
      currency: request.currency as CurrencyCode,
      amountMinor: request.amountMinor,
      paymentMethod: request.paymentMethod as CollectionPaymentMethod,
      collectedAt: request.collectedAt,
      evidence: request.evidence,
      createdAt: now().toISOString(),
      createdBy: context.actorUserId,
    };

    return persistence.create(input, {
      idempotencyKey: context.idempotencyKey,
      requestId: context.requestId,
    });
  };
}

function assertContext(context: CollectionCommandContext): void {
  if (!z.string().uuid().safeParse(context.actorUserId).success) {
    throw new Error("معرف المستخدم غير صالح.");
  }

  if (
    context.actorRepresentativeId &&
    !z.string().uuid().safeParse(context.actorRepresentativeId).success
  ) {
    throw new Error("معرف المندوب المرتبط بالمستخدم غير صالح.");
  }

  if (!z.string().uuid().safeParse(context.requestId).success) {
    throw new Error("معرف الطلب غير صالح.");
  }

  if (context.idempotencyKey.trim().length < 8) {
    throw new Error("مفتاح منع التكرار قصير أو غير صالح.");
  }
}
