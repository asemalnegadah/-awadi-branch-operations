import type { Sql } from "postgres";

import { money } from "@/lib/domain/money";

import { collectionStates, type CollectionState } from "./state-machine";
import type {
  CollectionEvidence,
  CollectionPaymentMethod,
  CollectionRecord,
} from "./types";
import {
  createCollectionDraft,
  type CreateCollectionDraftInput,
} from "./workflow";

export interface CreateCollectionDraftContext {
  readonly idempotencyKey: string;
  readonly requestId: string;
}

export class IdempotencyConflictError extends Error {
  constructor() {
    super("تم استخدام مفتاح منع التكرار نفسه لطلب مختلف.");
    this.name = "IdempotencyConflictError";
  }
}

interface CollectionRow {
  id: string;
  customer_id: string;
  customer_account_id: string;
  representative_id: string;
  currency_code: "SR" | "RG";
  amount_minor: string | number;
  payment_method: CollectionPaymentMethod;
  collected_at: Date | string;
  receipt_number: string | null;
  evidence_document_id: string | null;
  evidence_note: string | null;
  state: string;
  created_at: Date | string;
  created_by: string;
  reviewed_by: string | null;
  approved_by: string | null;
  cash_received_by: string | null;
  ledger_entry_id: string | null;
  closed_at: Date | string | null;
  reversed_at: Date | string | null;
  reversal_reason: string | null;
}

const collectionReturningColumns = `
  id,
  customer_id,
  customer_account_id,
  representative_id,
  currency_code,
  amount_minor,
  payment_method,
  collected_at,
  receipt_number,
  evidence_document_id,
  evidence_note,
  state,
  created_at,
  created_by,
  reviewed_by,
  approved_by,
  cash_received_by,
  ledger_entry_id,
  closed_at,
  reversed_at,
  reversal_reason
`;

export async function createCollectionDraftPostgres(
  sql: Sql,
  input: CreateCollectionDraftInput,
  context: CreateCollectionDraftContext,
): Promise<{ collection: CollectionRecord; replayed: boolean }> {
  assertUuid(context.requestId, "requestId");
  assertRequiredText(context.idempotencyKey, "idempotencyKey");

  const draft = createCollectionDraft(input);

  return sql.begin(async (transaction) => {
    await transaction`
      SELECT set_config('app.request_id', ${context.requestId}, true)
    `;

    const inserted = await transaction.unsafe<CollectionRow[]>(
      `
        INSERT INTO collections (
          id,
          customer_id,
          customer_account_id,
          representative_id,
          currency_code,
          amount_minor,
          payment_method,
          collected_at,
          receipt_number,
          evidence_document_id,
          evidence_note,
          state,
          created_at,
          created_by,
          updated_at,
          updated_by,
          idempotency_key
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, 'DRAFT', $12, $13, $12, $13, $14
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING ${collectionReturningColumns}
      `,
      [
        draft.id,
        draft.customerId,
        draft.customerAccountId,
        draft.representativeId,
        draft.amount.currency,
        draft.amount.minorUnits,
        draft.paymentMethod,
        draft.collectedAt,
        draft.evidence.receiptNumber ?? null,
        draft.evidence.evidenceDocumentId ?? null,
        draft.evidence.note ?? null,
        draft.createdAt,
        draft.createdBy,
        context.idempotencyKey,
      ],
    );

    if (inserted[0]) {
      return Object.freeze({
        collection: mapCollectionRow(inserted[0]),
        replayed: false,
      });
    }

    const existingRows = await transaction.unsafe<CollectionRow[]>(
      `
        SELECT ${collectionReturningColumns}
        FROM collections
        WHERE idempotency_key = $1
        FOR UPDATE
      `,
      [context.idempotencyKey],
    );

    const existing = existingRows[0];
    if (!existing) {
      throw new Error("تعذر استرجاع التحصيل بعد تعارض مفتاح منع التكرار.");
    }

    const existingCollection = mapCollectionRow(existing);
    if (!sameDraft(existingCollection, draft)) {
      throw new IdempotencyConflictError();
    }

    return Object.freeze({
      collection: existingCollection,
      replayed: true,
    });
  });
}

export async function findCollectionByIdPostgres(
  sql: Sql,
  collectionId: string,
): Promise<CollectionRecord | null> {
  assertUuid(collectionId, "collectionId");

  const rows = await sql.unsafe<CollectionRow[]>(
    `
      SELECT ${collectionReturningColumns}
      FROM collections
      WHERE id = $1
    `,
    [collectionId],
  );

  return rows[0] ? mapCollectionRow(rows[0]) : null;
}

function mapCollectionRow(row: CollectionRow): CollectionRecord {
  const amountMinor = Number(row.amount_minor);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("مبلغ التحصيل المخزن خارج النطاق الصحيح.");
  }

  const state = parseCollectionState(row.state);
  const evidence: CollectionEvidence = Object.freeze({
    receiptNumber: row.receipt_number ?? undefined,
    evidenceDocumentId: row.evidence_document_id ?? undefined,
    note: row.evidence_note ?? undefined,
  });

  return Object.freeze({
    id: row.id,
    customerId: row.customer_id,
    customerAccountId: row.customer_account_id,
    representativeId: row.representative_id,
    amount: money(row.currency_code, amountMinor),
    paymentMethod: row.payment_method,
    collectedAt: toIsoString(row.collected_at),
    state,
    evidence,
    createdAt: toIsoString(row.created_at),
    createdBy: row.created_by,
    reviewedBy: row.reviewed_by ?? undefined,
    approvedBy: row.approved_by ?? undefined,
    cashReceivedBy: row.cash_received_by ?? undefined,
    ledgerEntryId: row.ledger_entry_id ?? undefined,
    closedAt: toOptionalIsoString(row.closed_at),
    reversedAt: toOptionalIsoString(row.reversed_at),
    reversalReason: row.reversal_reason ?? undefined,
  });
}

function sameDraft(left: CollectionRecord, right: CollectionRecord): boolean {
  return (
    left.id === right.id &&
    left.customerId === right.customerId &&
    left.customerAccountId === right.customerAccountId &&
    left.representativeId === right.representativeId &&
    left.amount.currency === right.amount.currency &&
    left.amount.minorUnits === right.amount.minorUnits &&
    left.paymentMethod === right.paymentMethod &&
    left.collectedAt === right.collectedAt &&
    left.createdAt === right.createdAt &&
    left.createdBy === right.createdBy &&
    left.evidence.receiptNumber === right.evidence.receiptNumber &&
    left.evidence.evidenceDocumentId === right.evidence.evidenceDocumentId &&
    left.evidence.note === right.evidence.note
  );
}

function parseCollectionState(value: string): CollectionState {
  if (!collectionStates.includes(value as CollectionState)) {
    throw new Error(`حالة تحصيل غير معروفة في قاعدة البيانات: ${value}`);
  }

  return value as CollectionState;
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("تاريخ غير صالح مسترجع من قاعدة البيانات.");
  }

  return date.toISOString();
}

function toOptionalIsoString(value: Date | string | null): string | undefined {
  return value === null ? undefined : toIsoString(value);
}

function assertRequiredText(value: string, fieldName: string): void {
  if (!value.trim()) {
    throw new Error(`الحقل ${fieldName} إلزامي.`);
  }
}

function assertUuid(value: string, fieldName: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`الحقل ${fieldName} يجب أن يكون UUID صالحًا.`);
  }
}
