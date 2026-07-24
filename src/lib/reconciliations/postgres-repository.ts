import { randomUUID } from "node:crypto";

import type { Sql, TransactionSql } from "postgres";

import {
  ReconciliationBusinessRuleError,
  ReconciliationConflictError,
  ReconciliationIdempotencyConflictError,
  ReconciliationNotFoundError,
} from "./errors";
import {
  reconciliationReasonCodes,
  reconciliationSourceKinds,
  reconciliationStates,
  type CreateReconciliationInput,
  type ReconciliationCommandContext,
  type ReconciliationDetails,
  type ReconciliationEvent,
  type ReconciliationListFilters,
  type ReconciliationMutationResult,
  type ReconciliationPage,
  type ReconciliationReasonCode,
  type ReconciliationRecord,
  type ReconciliationState,
  type ReconciliationTransitionInput,
} from "./types";

type SqlExecutor = Sql | TransactionSql;
type Operation = "SUBMIT" | "REVIEW" | "REQUEST_APPROVAL" | "APPROVE" | "RETURN" | "REJECT" | "SETTLE";

interface AccountRow {
  id: string;
  customer_id: string;
  currency_code: "SR" | "RG";
}

interface ReconciliationRow {
  id: string;
  customer_id: string;
  customer_account_id: string;
  customer_name: string;
  customer_number: string | null;
  currency_code: "SR" | "RG";
  source_kind: string;
  source_type: string;
  source_id: string;
  cutoff_date: Date | string;
  expected_amount_minor: string | number;
  observed_amount_minor: string | number;
  difference_amount_minor: string | number;
  reason_code: string | null;
  reason_text: string | null;
  state: string;
  created_by: string;
  created_by_name: string;
  created_at: Date | string;
  submitted_by: string | null;
  submitted_at: Date | string | null;
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  approved_by: string | null;
  approved_at: Date | string | null;
  rejected_by: string | null;
  rejected_at: Date | string | null;
  rejection_reason: string | null;
  returned_by: string | null;
  returned_at: Date | string | null;
  return_reason: string | null;
  settled_by: string | null;
  settled_at: Date | string | null;
  settlement_ledger_entry_id: string | null;
  version: string | number;
  updated_at: Date | string;
}

interface CaseLockRow {
  id: string;
  customer_id: string;
  customer_account_id: string;
  currency_code: "SR" | "RG";
  state: string;
  difference_amount_minor: string | number;
  version: string | number;
}

interface ExistingCreateRow {
  id: string;
  payload_matches: boolean;
}

interface CommandRow {
  reconciliation_id: string;
  operation: string;
  payload_matches: boolean;
}

interface EventRow {
  id: string;
  event_type: ReconciliationEvent["eventType"];
  from_state: string | null;
  to_state: string;
  actor_user_id: string;
  actor_name: string;
  occurred_at: Date | string;
  reason: string | null;
  operating_mode: "SINGLE_MANAGER" | "MULTI_USER";
  self_approved: boolean;
}

const stateSet = new Set<string>(reconciliationStates);
const sourceKindSet = new Set<string>(reconciliationSourceKinds);
const reasonCodeSet = new Set<string>(reconciliationReasonCodes);

const reconciliationSelect = `
  SELECT
    reconciliation.id,
    reconciliation.customer_id,
    reconciliation.customer_account_id,
    customer.trade_name_ar AS customer_name,
    customer.customer_number,
    reconciliation.currency_code,
    reconciliation.source_kind,
    reconciliation.source_type,
    reconciliation.source_id,
    reconciliation.cutoff_date,
    reconciliation.expected_amount_minor,
    reconciliation.observed_amount_minor,
    reconciliation.difference_amount_minor,
    reconciliation.reason_code,
    reconciliation.reason_text,
    reconciliation.state,
    reconciliation.created_by,
    creator.full_name AS created_by_name,
    reconciliation.created_at,
    reconciliation.submitted_by,
    reconciliation.submitted_at,
    reconciliation.reviewed_by,
    reconciliation.reviewed_at,
    reconciliation.approved_by,
    reconciliation.approved_at,
    reconciliation.rejected_by,
    reconciliation.rejected_at,
    reconciliation.rejection_reason,
    reconciliation.returned_by,
    reconciliation.returned_at,
    reconciliation.return_reason,
    reconciliation.settled_by,
    reconciliation.settled_at,
    reconciliation.settlement_ledger_entry_id,
    reconciliation.version,
    reconciliation.updated_at
  FROM reconciliation_cases AS reconciliation
  JOIN customers AS customer ON customer.id = reconciliation.customer_id
  JOIN users AS creator ON creator.id = reconciliation.created_by
`;

export async function createReconciliationPostgres(
  sql: Sql,
  input: CreateReconciliationInput,
  context: ReconciliationCommandContext,
): Promise<ReconciliationMutationResult> {
  return sql.begin(async (transaction) => {
    await setRequestContext(transaction, context);
    const accounts = await transaction.unsafe<AccountRow[]>(
      `SELECT id, customer_id, currency_code FROM customer_accounts WHERE id = $1::uuid FOR SHARE`,
      [input.customerAccountId],
    );
    const account = accounts[0];
    if (!account) throw new ReconciliationNotFoundError("لم يتم العثور على حساب العميل.");

    const payload = canonicalCreatePayload(input, context.actor.id);
    const id = randomUUID();
    const inserted = await transaction.unsafe<{ id: string }[]>(
      `
        INSERT INTO reconciliation_cases (
          id, customer_id, customer_account_id, currency_code,
          source_kind, source_type, source_id, cutoff_date,
          expected_amount_minor, observed_amount_minor, reason_code, reason_text,
          created_by, updated_by, idempotency_key
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4,
          $5, $6, $7, $8::date,
          $9::bigint, $10::bigint, $11::text, $12::text,
          $13::uuid, $13::uuid, $14
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `,
      [
        id,
        account.customer_id,
        account.id,
        account.currency_code,
        input.sourceKind,
        input.sourceType,
        input.sourceId,
        input.cutoffDate,
        input.expectedAmountMinor,
        input.observedAmountMinor,
        input.reasonCode ?? null,
        input.reasonText ?? null,
        context.actor.id,
        context.idempotencyKey,
      ],
    );

    if (!inserted[0]) {
      const existing = await transaction.unsafe<ExistingCreateRow[]>(
        `
          SELECT id, create_payload = $2::text::jsonb AS payload_matches
          FROM reconciliation_cases
          WHERE idempotency_key = $1
          FOR UPDATE
        `,
        [context.idempotencyKey, JSON.stringify(payload)],
      );
      const replay = existing[0];
      if (!replay) throw new ReconciliationConflictError("تعذر استرجاع المطابقة المتكررة.");
      if (!replay.payload_matches) throw new ReconciliationIdempotencyConflictError();
      return Object.freeze({
        reconciliation: await getReconciliationRecord(transaction, replay.id),
        replayed: true,
      });
    }

    await insertAudit(transaction, context, "reconciliations.create", id, null, {
      state: "DRAFT",
      customerAccountId: account.id,
      currencyCode: account.currency_code,
      differenceAmountMinor: input.observedAmountMinor - input.expectedAmountMinor,
    });
    return Object.freeze({
      reconciliation: await getReconciliationRecord(transaction, id),
      replayed: false,
    });
  });
}

export async function listReconciliationsPostgres(
  sql: SqlExecutor,
  filters: ReconciliationListFilters,
): Promise<ReconciliationPage> {
  const rows = await sql.unsafe<ReconciliationRow[]>(
    `
      ${reconciliationSelect}
      WHERE ($1::text IS NULL OR reconciliation.currency_code = $1)
        AND ($2::text IS NULL OR reconciliation.state = $2)
        AND (
          $3::text IS NULL
          OR customer.trade_name_ar ILIKE '%' || $3 || '%'
          OR customer.customer_number ILIKE '%' || $3 || '%'
          OR reconciliation.source_id ILIKE '%' || $3 || '%'
        )
        AND (
          $4::uuid IS NULL
          OR (reconciliation.created_at, reconciliation.id) < (
            SELECT cursor_case.created_at, cursor_case.id
            FROM reconciliation_cases AS cursor_case
            WHERE cursor_case.id = $4::uuid
          )
        )
      ORDER BY reconciliation.created_at DESC, reconciliation.id DESC
      LIMIT $5
    `,
    [
      filters.currencyCode ?? null,
      filters.state ?? null,
      filters.query ?? null,
      filters.cursor ?? null,
      filters.limit + 1,
    ],
  );
  const hasMore = rows.length > filters.limit;
  const selected = hasMore ? rows.slice(0, filters.limit) : rows;
  return Object.freeze({
    items: Object.freeze(selected.map(mapReconciliationRow)),
    nextCursor: hasMore ? selected.at(-1)?.id ?? null : null,
  });
}

export async function getReconciliationDetailsPostgres(
  sql: SqlExecutor,
  reconciliationId: string,
  includeHistory: boolean,
): Promise<ReconciliationDetails> {
  const reconciliation = await getReconciliationRecord(sql, reconciliationId);
  const events = includeHistory
    ? await sql.unsafe<EventRow[]>(
      `
        SELECT
          event.id, event.event_type, event.from_state, event.to_state,
          event.actor_user_id, actor.full_name AS actor_name,
          event.occurred_at, event.reason, event.operating_mode, event.self_approved
        FROM reconciliation_events AS event
        JOIN users AS actor ON actor.id = event.actor_user_id
        WHERE event.reconciliation_id = $1::uuid
        ORDER BY event.occurred_at ASC, event.id ASC
      `,
      [reconciliationId],
    )
    : [];
  return Object.freeze({
    ...reconciliation,
    events: Object.freeze(events.map(mapEventRow)),
  });
}

export async function submitReconciliationPostgres(
  sql: Sql,
  reconciliationId: string,
  input: ReconciliationTransitionInput,
  context: ReconciliationCommandContext,
): Promise<ReconciliationMutationResult> {
  return transitionReconciliation(sql, reconciliationId, "SUBMIT", input, context);
}

export async function reviewReconciliationPostgres(
  sql: Sql,
  reconciliationId: string,
  input: ReconciliationTransitionInput,
  context: ReconciliationCommandContext,
): Promise<ReconciliationMutationResult> {
  if (!input.reasonCode || !input.reasonText) {
    throw new ReconciliationBusinessRuleError("مراجعة الفرق تتطلب تصنيف السبب ووصفه.");
  }
  return transitionReconciliation(sql, reconciliationId, "REVIEW", input, context);
}

export async function requestReconciliationApprovalPostgres(
  sql: Sql,
  reconciliationId: string,
  input: ReconciliationTransitionInput,
  context: ReconciliationCommandContext,
): Promise<ReconciliationMutationResult> {
  return transitionReconciliation(sql, reconciliationId, "REQUEST_APPROVAL", input, context);
}

export async function approveReconciliationPostgres(
  sql: Sql,
  reconciliationId: string,
  input: ReconciliationTransitionInput,
  context: ReconciliationCommandContext,
): Promise<ReconciliationMutationResult> {
  return transitionReconciliation(sql, reconciliationId, "APPROVE", input, context);
}

export async function returnReconciliationPostgres(
  sql: Sql,
  reconciliationId: string,
  input: ReconciliationTransitionInput,
  context: ReconciliationCommandContext,
): Promise<ReconciliationMutationResult> {
  if (!input.reason) throw new ReconciliationBusinessRuleError("سبب الإرجاع إلزامي.");
  return transitionReconciliation(sql, reconciliationId, "RETURN", input, context);
}

export async function rejectReconciliationPostgres(
  sql: Sql,
  reconciliationId: string,
  input: ReconciliationTransitionInput,
  context: ReconciliationCommandContext,
): Promise<ReconciliationMutationResult> {
  if (!input.reason) throw new ReconciliationBusinessRuleError("سبب الرفض إلزامي.");
  return transitionReconciliation(sql, reconciliationId, "REJECT", input, context);
}

export async function settleReconciliationPostgres(
  sql: Sql,
  reconciliationId: string,
  input: ReconciliationTransitionInput,
  context: ReconciliationCommandContext,
): Promise<ReconciliationMutationResult> {
  if (!input.reason) throw new ReconciliationBusinessRuleError("سبب التسوية إلزامي.");
  const settlementReason = input.reason;
  return sql.begin(async (transaction) => {
    await setRequestContext(transaction, context, settlementReason);
    const locked = await lockCase(transaction, reconciliationId);
    const payload = canonicalTransitionPayload(input);
    if (await commandReplay(transaction, reconciliationId, "SETTLE", payload, context)) {
      return Object.freeze({
        reconciliation: await getReconciliationRecord(transaction, reconciliationId),
        replayed: true,
      });
    }
    assertVersion(locked, input.version);
    if (locked.state !== "APPROVED") {
      throw new ReconciliationConflictError("لا يمكن تسوية مطابقة غير معتمدة.");
    }
    const difference = safeInteger(locked.difference_amount_minor, "difference amount");
    if (difference === 0) {
      throw new ReconciliationBusinessRuleError("لا تنشأ تسوية مالية لفارق صفري.");
    }
    const direction = difference > 0 ? "DEBIT" : "CREDIT";
    const amountMinor = Math.abs(difference);
    const ledgerEntryId = randomUUID();
    const settlementId = randomUUID();

    await transaction.unsafe(
      `
        INSERT INTO customer_ledger_entries (
          id, customer_id, customer_account_id, currency_code,
          direction, entry_type, amount_minor, accounting_date,
          description, source_type, source_id, idempotency_key,
          posted_at, posted_by, request_id, metadata
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4,
          $5, 'RECONCILIATION_ADJUSTMENT', $6::bigint,
          (now() AT TIME ZONE 'Asia/Aden')::date,
          $7, 'RECONCILIATION', $8, $9,
          now(), $10::uuid, $11::uuid,
          jsonb_build_object('reconciliationId', $8::text, 'settlementId', $12::uuid)
        )
      `,
      [
        ledgerEntryId,
        locked.customer_id,
        locked.customer_account_id,
        locked.currency_code,
        direction,
        amountMinor,
        settlementReason,
        reconciliationId,
        `reconciliation-ledger:${context.idempotencyKey}`,
        context.actor.id,
        context.request.requestId,
        settlementId,
      ],
    );

    await transaction.unsafe(
      `
        INSERT INTO reconciliation_settlements (
          id, reconciliation_id, ledger_entry_id, direction, amount_minor,
          settled_by, idempotency_key, request_id, reason
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5::bigint,
          $6::uuid, $7, $8::uuid, $9
        )
      `,
      [
        settlementId,
        reconciliationId,
        ledgerEntryId,
        direction,
        amountMinor,
        context.actor.id,
        context.idempotencyKey,
        context.request.requestId,
        settlementReason,
      ],
    );

    await transaction.unsafe(
      `
        UPDATE reconciliation_cases
        SET state = 'SETTLED', settled_by = $2::uuid, settled_at = now(),
            settlement_ledger_entry_id = $3::uuid, updated_by = $2::uuid
        WHERE id = $1::uuid AND state = 'APPROVED' AND version = $4
      `,
      [reconciliationId, context.actor.id, ledgerEntryId, input.version],
    );
    const result = await getReconciliationRecord(transaction, reconciliationId);
    if (result.state !== "SETTLED") throw new ReconciliationConflictError();
    await recordCommand(transaction, reconciliationId, "SETTLE", payload, result.state, context);
    await insertAudit(transaction, context, "reconciliations.settle", reconciliationId, {
      state: "APPROVED",
      differenceAmountMinor: difference,
    }, {
      state: "SETTLED",
      ledgerEntryId,
      direction,
      amountMinor,
    }, settlementReason);
    return Object.freeze({ reconciliation: result, replayed: false });
  });
}

async function transitionReconciliation(
  sql: Sql,
  reconciliationId: string,
  operation: Exclude<Operation, "SETTLE">,
  input: ReconciliationTransitionInput,
  context: ReconciliationCommandContext,
): Promise<ReconciliationMutationResult> {
  return sql.begin(async (transaction) => {
    await setRequestContext(transaction, context, input.reason);
    const locked = await lockCase(transaction, reconciliationId);
    const payload = canonicalTransitionPayload(input);
    if (await commandReplay(transaction, reconciliationId, operation, payload, context)) {
      return Object.freeze({
        reconciliation: await getReconciliationRecord(transaction, reconciliationId),
        replayed: true,
      });
    }
    assertVersion(locked, input.version);
    const update = transitionUpdate(operation, locked, input, context.actor.id);
    await transaction.unsafe(
      `UPDATE reconciliation_cases SET ${update.sql} WHERE id = $1::uuid AND version = $2`,
      [reconciliationId, input.version, ...update.parameters],
    );
    const result = await getReconciliationRecord(transaction, reconciliationId);
    if (result.state !== update.targetState) throw new ReconciliationConflictError();
    await recordCommand(transaction, reconciliationId, operation, payload, result.state, context);
    await insertAudit(
      transaction,
      context,
      `reconciliations.${operation.toLowerCase()}`,
      reconciliationId,
      { state: parseState(locked.state), version: input.version },
      { state: result.state, version: result.version },
      input.reason,
    );
    return Object.freeze({ reconciliation: result, replayed: false });
  });
}

function transitionUpdate(
  operation: Exclude<Operation, "SETTLE">,
  locked: CaseLockRow,
  input: ReconciliationTransitionInput,
  actorId: string,
): { readonly sql: string; readonly parameters: readonly (string | number)[]; readonly targetState: ReconciliationState } {
  const state = parseState(locked.state);
  switch (operation) {
    case "SUBMIT": {
      if (!new Set<ReconciliationState>(["DRAFT", "RETURNED"]).has(state)) {
        throw new ReconciliationConflictError("لا تسمح حالة المطابقة الحالية بالإرسال.");
      }
      const targetState = safeInteger(locked.difference_amount_minor, "difference amount") === 0
        ? "MATCHED"
        : "PENDING_REVIEW";
      return {
        sql: `state = '${targetState}', submitted_by = $3::uuid, submitted_at = now(), updated_by = $3::uuid`,
        parameters: [actorId],
        targetState,
      };
    }
    case "REVIEW":
      if (state !== "PENDING_REVIEW") throw new ReconciliationConflictError("المطابقة ليست بانتظار المراجعة.");
      if (!input.reasonCode || !input.reasonText) {
        throw new ReconciliationBusinessRuleError("مراجعة الفرق تتطلب تصنيف السبب ووصفه.");
      }
      return {
        sql: "state = 'REVIEWED', reviewed_by = $3::uuid, reviewed_at = now(), reason_code = $4, reason_text = $5, updated_by = $3::uuid",
        parameters: [actorId, input.reasonCode, input.reasonText],
        targetState: "REVIEWED",
      };
    case "REQUEST_APPROVAL":
      if (state !== "REVIEWED") throw new ReconciliationConflictError("يجب إكمال المراجعة قبل طلب الاعتماد.");
      return {
        sql: "state = 'PENDING_APPROVAL', updated_by = $3::uuid",
        parameters: [actorId],
        targetState: "PENDING_APPROVAL",
      };
    case "APPROVE":
      if (state !== "PENDING_APPROVAL") throw new ReconciliationConflictError("المطابقة ليست بانتظار الاعتماد.");
      return {
        sql: "state = 'APPROVED', approved_by = $3::uuid, approved_at = now(), updated_by = $3::uuid",
        parameters: [actorId],
        targetState: "APPROVED",
      };
    case "RETURN":
      if (state !== "PENDING_REVIEW" && state !== "PENDING_APPROVAL") {
        throw new ReconciliationConflictError("لا يمكن إرجاع المطابقة من حالتها الحالية.");
      }
      if (!input.reason) throw new ReconciliationBusinessRuleError("سبب الإرجاع إلزامي.");
      return {
        sql: "state = 'RETURNED', returned_by = $3::uuid, returned_at = now(), return_reason = $4, updated_by = $3::uuid",
        parameters: [actorId, input.reason],
        targetState: "RETURNED",
      };
    case "REJECT":
      if (state !== "PENDING_REVIEW" && state !== "PENDING_APPROVAL") {
        throw new ReconciliationConflictError("لا يمكن رفض المطابقة من حالتها الحالية.");
      }
      if (!input.reason) throw new ReconciliationBusinessRuleError("سبب الرفض إلزامي.");
      return {
        sql: "state = 'REJECTED', rejected_by = $3::uuid, rejected_at = now(), rejection_reason = $4, updated_by = $3::uuid",
        parameters: [actorId, input.reason],
        targetState: "REJECTED",
      };
  }
}

async function lockCase(transaction: TransactionSql, reconciliationId: string): Promise<CaseLockRow> {
  const rows = await transaction.unsafe<CaseLockRow[]>(
    `
      SELECT id, customer_id, customer_account_id, currency_code,
             state, difference_amount_minor, version
      FROM reconciliation_cases
      WHERE id = $1::uuid
      FOR UPDATE
    `,
    [reconciliationId],
  );
  const row = rows[0];
  if (!row) throw new ReconciliationNotFoundError();
  return row;
}

async function commandReplay(
  transaction: TransactionSql,
  reconciliationId: string,
  operation: Operation,
  payload: Readonly<Record<string, unknown>>,
  context: ReconciliationCommandContext,
): Promise<boolean> {
  const rows = await transaction.unsafe<CommandRow[]>(
    `
      SELECT reconciliation_id, operation, canonical_payload = $2::text::jsonb AS payload_matches
      FROM reconciliation_commands
      WHERE idempotency_key = $1
      FOR UPDATE
    `,
    [context.idempotencyKey, JSON.stringify(payload)],
  );
  const command = rows[0];
  if (!command) return false;
  if (
    command.reconciliation_id !== reconciliationId
    || command.operation !== operation
    || !command.payload_matches
  ) {
    throw new ReconciliationIdempotencyConflictError();
  }
  return true;
}

async function recordCommand(
  transaction: TransactionSql,
  reconciliationId: string,
  operation: Operation,
  payload: Readonly<Record<string, unknown>>,
  resultState: ReconciliationState,
  context: ReconciliationCommandContext,
): Promise<void> {
  await transaction.unsafe(
    `
      INSERT INTO reconciliation_commands (
        reconciliation_id, operation, canonical_payload, result_state,
        actor_user_id, idempotency_key, request_id
      ) VALUES ($1::uuid, $2, $3::text::jsonb, $4, $5::uuid, $6, $7::uuid)
    `,
    [
      reconciliationId,
      operation,
      JSON.stringify(payload),
      resultState,
      context.actor.id,
      context.idempotencyKey,
      context.request.requestId,
    ],
  );
}

async function getReconciliationRecord(
  sql: SqlExecutor,
  reconciliationId: string,
): Promise<ReconciliationRecord> {
  const rows = await sql.unsafe<ReconciliationRow[]>(
    `${reconciliationSelect} WHERE reconciliation.id = $1::uuid`,
    [reconciliationId],
  );
  const row = rows[0];
  if (!row) throw new ReconciliationNotFoundError();
  return mapReconciliationRow(row);
}

function mapReconciliationRow(row: ReconciliationRow): ReconciliationRecord {
  return Object.freeze({
    id: row.id,
    customerId: row.customer_id,
    customerAccountId: row.customer_account_id,
    customerName: row.customer_name,
    customerNumber: row.customer_number,
    currencyCode: row.currency_code,
    sourceKind: parseSourceKind(row.source_kind),
    sourceType: row.source_type,
    sourceId: row.source_id,
    cutoffDate: toDateString(row.cutoff_date),
    expectedAmountMinor: safeInteger(row.expected_amount_minor, "expected amount"),
    observedAmountMinor: safeInteger(row.observed_amount_minor, "observed amount"),
    differenceAmountMinor: safeInteger(row.difference_amount_minor, "difference amount"),
    reasonCode: parseNullableReasonCode(row.reason_code),
    reasonText: row.reason_text,
    state: parseState(row.state),
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: toIsoString(row.created_at),
    submittedBy: row.submitted_by,
    submittedAt: toOptionalIsoString(row.submitted_at),
    reviewedBy: row.reviewed_by,
    reviewedAt: toOptionalIsoString(row.reviewed_at),
    approvedBy: row.approved_by,
    approvedAt: toOptionalIsoString(row.approved_at),
    rejectedBy: row.rejected_by,
    rejectedAt: toOptionalIsoString(row.rejected_at),
    rejectionReason: row.rejection_reason,
    returnedBy: row.returned_by,
    returnedAt: toOptionalIsoString(row.returned_at),
    returnReason: row.return_reason,
    settledBy: row.settled_by,
    settledAt: toOptionalIsoString(row.settled_at),
    settlementLedgerEntryId: row.settlement_ledger_entry_id,
    version: safeInteger(row.version, "version"),
    updatedAt: toIsoString(row.updated_at),
  });
}

function mapEventRow(row: EventRow): ReconciliationEvent {
  return Object.freeze({
    id: row.id,
    eventType: row.event_type,
    fromState: row.from_state === null ? null : parseState(row.from_state),
    toState: parseState(row.to_state),
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    occurredAt: toIsoString(row.occurred_at),
    reason: row.reason,
    operatingMode: row.operating_mode,
    selfApproved: row.self_approved,
  });
}

async function setRequestContext(
  transaction: TransactionSql,
  context: ReconciliationCommandContext,
  reason?: string,
): Promise<void> {
  await transaction`SELECT set_config('app.request_id', ${context.request.requestId}, true)`;
  await transaction`SELECT set_config('app.transition_reason', ${reason ?? ""}, true)`;
}

async function insertAudit(
  transaction: TransactionSql,
  context: ReconciliationCommandContext,
  action: string,
  resourceId: string,
  previousValues: Readonly<Record<string, unknown>> | null,
  newValues: Readonly<Record<string, unknown>>,
  reason?: string,
): Promise<void> {
  await transaction.unsafe(
    `
      INSERT INTO audit_logs (
        actor_user_id, actor_type, action, resource_type, resource_id,
        request_id, session_id, ip_address, user_agent, reason,
        previous_values, new_values, result, metadata
      ) VALUES (
        $1::uuid, 'USER', $2, 'RECONCILIATION', $3,
        $4::uuid, $5, $6::inet, $7, $8,
        $9::text::jsonb, $10::text::jsonb, 'SUCCESS',
        jsonb_build_object('idempotencyKey', $11::text)
      )
    `,
    [
      context.actor.id,
      action,
      resourceId,
      context.request.requestId,
      context.sessionId ?? null,
      context.request.ipAddress,
      context.request.userAgent,
      reason ?? null,
      JSON.stringify(previousValues),
      JSON.stringify(newValues),
      context.idempotencyKey,
    ],
  );
}

function assertVersion(row: CaseLockRow, version: number): void {
  if (safeInteger(row.version, "version") !== version) throw new ReconciliationConflictError();
}

function canonicalCreatePayload(
  input: CreateReconciliationInput,
  createdBy: string,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    customerAccountId: input.customerAccountId,
    sourceKind: input.sourceKind,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    cutoffDate: input.cutoffDate,
    expectedAmountMinor: input.expectedAmountMinor,
    observedAmountMinor: input.observedAmountMinor,
    reasonCode: input.reasonCode ?? null,
    reasonText: input.reasonText ?? null,
    createdBy,
  });
}

function canonicalTransitionPayload(
  input: ReconciliationTransitionInput,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    version: input.version,
    reason: input.reason ?? null,
    reasonCode: input.reasonCode ?? null,
    reasonText: input.reasonText ?? null,
  });
}

function parseState(value: string): ReconciliationState {
  if (!stateSet.has(value)) throw new Error(`Unknown reconciliation state: ${value}`);
  return value as ReconciliationState;
}

function parseSourceKind(value: string): ReconciliationRecord["sourceKind"] {
  if (!sourceKindSet.has(value)) throw new Error(`Unknown reconciliation source kind: ${value}`);
  return value as ReconciliationRecord["sourceKind"];
}

function parseNullableReasonCode(value: string | null): ReconciliationReasonCode | null {
  if (value === null) return null;
  if (!reasonCodeSet.has(value)) throw new Error(`Unknown reconciliation reason code: ${value}`);
  return value as ReconciliationReasonCode;
}

function safeInteger(value: string | number, label: string): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} is outside the safe integer range.`);
  return result;
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid timestamp returned by PostgreSQL.");
  return date.toISOString();
}

function toOptionalIsoString(value: Date | string | null): string | null {
  return value === null ? null : toIsoString(value);
}

function toDateString(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}
