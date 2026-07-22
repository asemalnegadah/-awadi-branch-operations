import type { Sql, TransactionSql } from "postgres";

import type { CurrencyCode } from "@/lib/domain/currency";

import {
  PromiseBusinessRuleError,
  PromiseConflictError,
  PromiseIdempotencyConflictError,
  PromiseNotFoundError,
} from "./errors";
import type {
  AddFollowUpInput,
  AllocateCollectionInput,
  CancelPromiseInput,
  ConfirmedCollectionOption,
  CreatePromiseInput,
  CurrencyPromiseSummary,
  CustomerPromiseSummary,
  EscalatePromiseInput,
  PaymentPromise,
  PaymentPromiseAllocation,
  PaymentPromiseDetails,
  PaymentPromiseEvent,
  PaymentPromiseFollowUp,
  PromiseBaseStatus,
  PromiseCommandContext,
  PromiseEventType,
  PromiseFormOptions,
  PromiseListFilters,
  PromisePage,
  PromiseTemporalStatus,
  RejectPromiseInput,
  ReverseAllocationInput,
  SalespersonPromiseSummary,
  UpdatePromiseInput,
} from "./types";

interface PromiseRow {
  id: string;
  customer_id: string;
  customer_account_id: string;
  customer_name: string;
  customer_number: string | null;
  representative_id: string;
  representative_name: string;
  currency_code: CurrencyCode;
  promised_amount_minor: string | number;
  fulfilled_amount_minor: string | number;
  remaining_amount_minor: string | number;
  promise_date: Date | string;
  due_date: Date | string;
  next_follow_up_at: Date | string | null;
  debt_reason: string;
  delay_reason: string | null;
  notes: string | null;
  base_status: PromiseBaseStatus;
  temporal_status: PromiseTemporalStatus | null;
  escalation_level: string | number;
  rejected_at: Date | string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  cancelled_at: Date | string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  created_by: string;
  created_at: Date | string;
  updated_by: string;
  updated_at: Date | string;
  version: string | number;
}

interface PromiseLockRow {
  id: string;
  customer_id: string;
  customer_account_id: string;
  representative_id: string;
  currency_code: CurrencyCode;
  promised_amount_minor: string | number;
  fulfilled_amount_minor: string | number;
  promise_date: Date | string;
  due_date: Date | string;
  next_follow_up_at: Date | string | null;
  debt_reason: string;
  delay_reason: string | null;
  notes: string | null;
  base_status: PromiseBaseStatus;
  escalation_level: string | number;
  version: string | number;
}

interface EventRow {
  id: string;
  promise_id: string;
  actor_user_id: string;
  actor_name: string;
  occurred_at: Date | string;
  request_id: string;
  event_type: PromiseEventType;
  old_values: unknown;
  new_values: unknown;
  operation_payload: unknown;
  reason: string | null;
  source_entity: string | null;
  source_id: string | null;
  idempotency_key: string | null;
}

interface FollowUpRow {
  id: string;
  promise_id: string;
  scheduled_at: Date | string;
  completed_at: Date | string | null;
  outcome: string | null;
  notes: string | null;
  created_by: string;
  created_by_name: string;
  created_at: Date | string;
  request_id: string;
  idempotency_key: string;
}

interface AllocationRow {
  id: string;
  promise_id: string;
  collection_id: string;
  currency_code: CurrencyCode;
  amount_minor: string | number;
  allocated_at: Date | string;
  allocated_by: string;
  allocated_by_name: string;
  request_id: string;
  idempotency_key: string;
  reversed_at: Date | string | null;
  reversed_by: string | null;
  reversal_reason: string | null;
  reversal_request_id: string | null;
  reversal_idempotency_key: string | null;
}

interface CollectionLockRow {
  id: string;
  customer_id: string;
  customer_account_id: string;
  currency_code: CurrencyCode;
  amount_minor: string | number;
  receipt_number: string | null;
  collected_at: Date | string;
  state: string;
  ledger_entry_id: string | null;
  reversed_at: Date | string | null;
}

interface SummaryRow {
  currency_code: CurrencyCode;
  promise_count: string | number;
  promised_amount_minor: string | number;
  fulfilled_amount_minor: string | number;
  remaining_amount_minor: string | number;
  due_today_count: string | number;
  overdue_count: string | number;
  partially_fulfilled_count: string | number;
  fulfilled_count: string | number;
}

type SqlParameter = string | number | boolean | Date | null;

interface CursorPayload {
  readonly dueDate: string;
  readonly createdAt: string;
  readonly id: string;
}

const openStatuses: readonly PromiseBaseStatus[] = [
  "NEW",
  "UPCOMING",
  "PARTIALLY_FULFILLED",
];

const adenTodaySql = "(now() AT TIME ZONE 'Asia/Aden')::date";
const promiseSelect = `
  promise.id,
  promise.customer_id,
  promise.customer_account_id,
  customer.trade_name_ar AS customer_name,
  customer.customer_number,
  promise.representative_id,
  representative.full_name_ar AS representative_name,
  promise.currency_code,
  promise.promised_amount_minor,
  promise.fulfilled_amount_minor,
  promise.remaining_amount_minor,
  promise.promise_date,
  promise.due_date,
  promise.next_follow_up_at,
  promise.debt_reason,
  promise.delay_reason,
  promise.notes,
  promise.base_status,
  CASE
    WHEN promise.base_status IN ('NEW', 'UPCOMING', 'PARTIALLY_FULFILLED')
      AND promise.due_date = ${adenTodaySql}
      THEN 'DUE_TODAY'
    WHEN promise.base_status IN ('NEW', 'UPCOMING', 'PARTIALLY_FULFILLED')
      AND promise.due_date < ${adenTodaySql}
      THEN 'OVERDUE'
    ELSE NULL
  END AS temporal_status,
  promise.escalation_level,
  promise.rejected_at,
  promise.rejected_by,
  promise.rejection_reason,
  promise.cancelled_at,
  promise.cancelled_by,
  promise.cancellation_reason,
  promise.created_by,
  promise.created_at,
  promise.updated_by,
  promise.updated_at,
  promise.version
`;

const promiseJoins = `
  FROM payment_promises AS promise
  JOIN customers AS customer ON customer.id = promise.customer_id
  JOIN sales_representatives AS representative
    ON representative.id = promise.representative_id
`;

export async function getActiveRepresentativeIdByUserPostgres(
  sql: TransactionSql,
  userId: string,
): Promise<string | null> {
  const rows = await sql.unsafe<{ id: string }[]>(
    `SELECT id
     FROM sales_representatives
     WHERE user_id = $1::uuid
       AND status = 'ACTIVE'
       AND deleted_at IS NULL
     LIMIT 1`,
    [userId],
  );
  return rows[0]?.id ?? null;
}

export async function createPromisePostgres(
  sql: Sql,
  input: CreatePromiseInput,
  context: PromiseCommandContext,
  representativeScopeId?: string,
): Promise<{ readonly promise: PaymentPromise; readonly replayed: boolean }> {
  return sql.begin(async (transaction) => {
    if (representativeScopeId) {
      if (input.representativeId !== representativeScopeId) {
        throw new PromiseNotFoundError();
      }
      await assertActiveRepresentativeAssignment(
        transaction,
        representativeScopeId,
        input.customerId,
      );
    }
    const payload = createOperationPayload(input);
    const inserted = await transaction.unsafe<{ id: string }[]>(
      `
        INSERT INTO payment_promises (
          customer_id,
          customer_account_id,
          representative_id,
          currency_code,
          promised_amount_minor,
          promise_date,
          due_date,
          next_follow_up_at,
          debt_reason,
          delay_reason,
          notes,
          base_status,
          created_by,
          created_at,
          updated_by,
          updated_at,
          idempotency_key
        ) VALUES (
          $1, $2, $3, $4, $5, $6::date, $7::date, $8::timestamptz,
          $9, $10, $11, payment_promise_open_status($7::date),
          $12, now(), $12, now(), $13
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `,
      [
        input.customerId,
        input.customerAccountId,
        input.representativeId,
        input.currencyCode,
        input.promisedAmountMinor,
        input.promiseDate,
        input.dueDate,
        input.nextFollowUpAt ?? null,
        input.debtReason,
        input.delayReason ?? null,
        input.notes ?? null,
        context.actor.id,
        context.idempotencyKey,
      ],
    );

    if (!inserted[0]) {
      const existing = await transaction.unsafe<
        (PromiseLockRow & {
          idempotency_key: string;
          create_payload: unknown;
        })[]
      >(
        `
          SELECT
            id,
            customer_id,
            customer_account_id,
            representative_id,
            currency_code,
            promised_amount_minor,
            fulfilled_amount_minor,
            promise_date,
            due_date,
            next_follow_up_at,
            debt_reason,
            delay_reason,
            notes,
            base_status,
            escalation_level,
            version,
            idempotency_key,
            create_payload
          FROM payment_promises
          WHERE idempotency_key = $1
          FOR UPDATE
        `,
        [context.idempotencyKey],
      );
      const row = existing[0];
      if (!row || !jsonEqual(row.create_payload, payload)) {
        throw new PromiseIdempotencyConflictError();
      }
      const promise = await requirePromiseById(transaction, row.id, representativeScopeId);
      return Object.freeze({ promise, replayed: true });
    }

    const promise = await requirePromiseById(transaction, inserted[0].id, representativeScopeId);
    await insertEvent(transaction, {
      promiseId: promise.id,
      context,
      eventType: "CREATED",
      oldValues: {},
      newValues: promiseSnapshot(promise),
      operationPayload: payload,
      reason: null,
      sourceEntity: null,
      sourceId: null,
      idempotencyKey: null,
    });
    await insertAudit(
      transaction,
      context,
      "promises.create",
      promise.id,
      null,
      promiseSnapshot(promise),
    );
    return Object.freeze({ promise, replayed: false });
  });
}

export async function getPromisePostgres(
  sql: TransactionSql,
  promiseId: string,
  representativeScopeId?: string,
): Promise<PaymentPromise | null> {
  const rows = await selectPromises(
    sql,
    representativeScopeId
      ? "WHERE promise.id = $1 AND promise.representative_id = $2::uuid"
      : "WHERE promise.id = $1",
    representativeScopeId ? [promiseId, representativeScopeId] : [promiseId],
  );
  return rows[0] ? mapPromiseRow(rows[0]) : null;
}

export async function getPromiseDetailsPostgres(
  sql: Sql,
  promiseId: string,
  representativeScopeId?: string,
): Promise<PaymentPromiseDetails | null> {
  return sql.begin(async (transaction) => {
    const promise = await getPromisePostgres(
      transaction,
      promiseId,
      representativeScopeId,
    );
    if (!promise) return null;
    const [events, followUps, allocations] = await Promise.all([
      getPromiseHistoryPostgres(transaction, promiseId),
      listPromiseFollowUpsPostgres(transaction, promiseId),
      listPromiseAllocationsPostgres(transaction, promiseId),
    ]);
    return Object.freeze({ promise, events, followUps, allocations });
  });
}

export async function listPromisesPostgres(
  sql: TransactionSql,
  filters: PromiseListFilters,
  representativeScopeId?: string,
): Promise<PromisePage> {
  const conditions: string[] = [];
  const parameters: SqlParameter[] = [];
  const add = (clause: string, value: SqlParameter): void => {
    parameters.push(value);
    conditions.push(clause.replace("?", `$${parameters.length}`));
  };

  if (representativeScopeId) {
    add("promise.representative_id = ?::uuid", representativeScopeId);
  }
  if (filters.dueDateFrom)
    add("promise.due_date >= ?::date", filters.dueDateFrom);
  if (filters.dueDateTo) add("promise.due_date <= ?::date", filters.dueDateTo);
  if (filters.customerId)
    add("promise.customer_id = ?::uuid", filters.customerId);
  if (filters.representativeId) {
    add("promise.representative_id = ?::uuid", filters.representativeId);
  }
  if (filters.currencyCode)
    add("promise.currency_code = ?", filters.currencyCode);
  if (filters.baseStatus) add("promise.base_status = ?", filters.baseStatus);
  if (filters.escalationLevel !== undefined) {
    add("promise.escalation_level = ?::smallint", filters.escalationLevel);
  }
  if (filters.temporalStatus === "DUE_TODAY") {
    conditions.push(
      `promise.base_status IN ('NEW', 'UPCOMING', 'PARTIALLY_FULFILLED') AND promise.due_date = ${adenTodaySql}`,
    );
  }
  if (filters.temporalStatus === "OVERDUE") {
    conditions.push(
      `promise.base_status IN ('NEW', 'UPCOMING', 'PARTIALLY_FULFILLED') AND promise.due_date < ${adenTodaySql}`,
    );
  }
  if (filters.partiallyFulfilled) {
    conditions.push("promise.base_status = 'PARTIALLY_FULFILLED'");
  }
  if (filters.fulfilled) conditions.push("promise.base_status = 'FULFILLED'");
  if (filters.query) {
    const pattern = `%${escapeLikePattern(filters.query.toLowerCase())}%`;
    parameters.push(pattern);
    const position = `$${parameters.length}`;
    conditions.push(`(
      lower(customer.trade_name_ar) LIKE ${position} ESCAPE '\\'
      OR lower(COALESCE(customer.customer_number, '')) LIKE ${position} ESCAPE '\\'
      OR lower(promise.debt_reason) LIKE ${position} ESCAPE '\\'
      OR lower(COALESCE(promise.delay_reason, '')) LIKE ${position} ESCAPE '\\'
      OR lower(COALESCE(promise.notes, '')) LIKE ${position} ESCAPE '\\'
    )`);
  }
  if (filters.cursor) {
    const cursor = decodeCursor(filters.cursor);
    parameters.push(cursor.dueDate, cursor.createdAt, cursor.id);
    const offset = parameters.length - 2;
    conditions.push(`(
      promise.due_date,
      promise.created_at,
      promise.id
    ) > ($${offset}::date, $${offset + 1}::timestamptz, $${offset + 2}::uuid)`);
  }

  parameters.push(filters.limit + 1);
  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await selectPromises(
    sql,
    `${where} ORDER BY promise.due_date ASC, promise.created_at ASC, promise.id ASC LIMIT $${parameters.length}`,
    parameters,
  );
  const hasMore = rows.length > filters.limit;
  const selected = hasMore ? rows.slice(0, filters.limit) : rows;
  const items = selected.map(mapPromiseRow);
  const last = selected.at(-1);
  return Object.freeze({
    items: Object.freeze(items),
    nextCursor:
      hasMore && last
        ? encodeCursor({
            dueDate: toDateString(last.due_date),
            createdAt: toIsoString(last.created_at),
            id: last.id,
          })
        : null,
  });
}

export async function updatePromisePostgres(
  sql: Sql,
  promiseId: string,
  input: UpdatePromiseInput,
  context: PromiseCommandContext,
  representativeScopeId?: string,
): Promise<{ readonly promise: PaymentPromise; readonly replayed: boolean }> {
  return sql.begin(async (transaction) => {
    const payload = normalizePayload(input);
    const replay = await findOperationReplay(
      transaction,
      promiseId,
      "UPDATED",
      context.idempotencyKey,
      payload,
    );
    if (replay) {
      return Object.freeze({
        promise: await requirePromiseById(
          transaction,
          promiseId,
          representativeScopeId,
        ),
        replayed: true,
      });
    }

    const locked = await lockPromise(
      transaction,
      promiseId,
      representativeScopeId,
    );
    if (
      await findOperationReplay(
        transaction,
        promiseId,
        "UPDATED",
        context.idempotencyKey,
        payload,
      )
    ) {
      return Object.freeze({
        promise: await requirePromiseById(
          transaction,
          promiseId,
          representativeScopeId,
        ),
        replayed: true,
      });
    }
    assertVersion(locked, input.version);
    assertOpenPromise(locked);

    const finalRepresentativeId =
      input.representativeId ?? locked.representative_id;
    const finalPromisedAmount =
      input.promisedAmountMinor ??
      safeInteger(locked.promised_amount_minor, "promised amount");
    const fulfilledAmount = safeInteger(
      locked.fulfilled_amount_minor,
      "fulfilled amount",
    );
    if (finalPromisedAmount < fulfilledAmount) {
      throw new PromiseBusinessRuleError(
        "لا يمكن خفض مبلغ الوعد عن المبلغ المنفذ فعليًا.",
      );
    }
    const finalPromiseDate =
      input.promiseDate ?? toDateString(locked.promise_date);
    const finalDueDate = input.dueDate ?? toDateString(locked.due_date);
    if (finalDueDate < finalPromiseDate) {
      throw new PromiseBusinessRuleError(
        "تاريخ الاستحقاق لا يجوز أن يسبق تاريخ الوعد.",
      );
    }
    const finalNextFollowUp = Object.hasOwn(input, "nextFollowUpAt")
      ? (input.nextFollowUpAt ?? null)
      : toOptionalIsoString(locked.next_follow_up_at);
    const finalDebtReason = input.debtReason ?? locked.debt_reason;
    const finalDelayReason = Object.hasOwn(input, "delayReason")
      ? (input.delayReason ?? null)
      : locked.delay_reason;
    const finalNotes = Object.hasOwn(input, "notes")
      ? (input.notes ?? null)
      : locked.notes;
    const targetStatus = calculateStatus(
      fulfilledAmount,
      finalPromisedAmount,
      finalDueDate,
    );

    const updated = await transaction.unsafe<{ id: string }[]>(
      `
        UPDATE payment_promises
        SET representative_id = $1,
            promised_amount_minor = $2,
            promise_date = $3::date,
            due_date = $4::date,
            next_follow_up_at = $5::timestamptz,
            debt_reason = $6,
            delay_reason = $7,
            notes = $8,
            base_status = $9,
            updated_by = $10
        WHERE id = $11::uuid
          AND version = $12
        RETURNING id
      `,
      [
        finalRepresentativeId,
        finalPromisedAmount,
        finalPromiseDate,
        finalDueDate,
        targetStatus === "FULFILLED" ? null : finalNextFollowUp,
        finalDebtReason,
        finalDelayReason,
        finalNotes,
        targetStatus,
        context.actor.id,
        promiseId,
        input.version,
      ],
    );
    if (!updated[0]) throw new PromiseConflictError();

    const promise = await requirePromiseById(
      transaction,
      promiseId,
      representativeScopeId,
    );
    const oldSnapshot = lockSnapshot(locked);
    const newSnapshot = promiseSnapshot(promise);
    await insertEvent(transaction, {
      promiseId,
      context,
      eventType: "UPDATED",
      oldValues: oldSnapshot,
      newValues: newSnapshot,
      operationPayload: payload,
      reason: null,
      sourceEntity: null,
      sourceId: null,
      idempotencyKey: context.idempotencyKey,
    });
    if (locked.representative_id !== promise.representativeId) {
      await insertEvent(
        transaction,
        specializedEvent(
          promiseId,
          context,
          "ASSIGNED",
          oldSnapshot,
          newSnapshot,
        ),
      );
    }
    if (toDateString(locked.due_date) !== promise.dueDate) {
      await insertEvent(
        transaction,
        specializedEvent(
          promiseId,
          context,
          "DUE_DATE_CHANGED",
          oldSnapshot,
          newSnapshot,
        ),
      );
    }
    if (
      safeInteger(locked.promised_amount_minor, "promised amount") !==
      promise.promisedAmountMinor
    ) {
      await insertEvent(
        transaction,
        specializedEvent(
          promiseId,
          context,
          "AMOUNT_CHANGED",
          oldSnapshot,
          newSnapshot,
        ),
      );
    }
    await insertStatusEventIfChanged(
      transaction,
      locked.base_status,
      promise,
      context,
      oldSnapshot,
      newSnapshot,
    );
    await insertAudit(
      transaction,
      context,
      "promises.update",
      promiseId,
      oldSnapshot,
      newSnapshot,
    );
    return Object.freeze({ promise, replayed: false });
  });
}

export async function addFollowUpPostgres(
  sql: Sql,
  promiseId: string,
  input: AddFollowUpInput,
  context: PromiseCommandContext,
  representativeScopeId?: string,
): Promise<{
  readonly promise: PaymentPromise;
  readonly followUp: PaymentPromiseFollowUp;
  readonly replayed: boolean;
}> {
  return sql.begin(async (transaction) => {
    const existingRows = await transaction.unsafe<FollowUpRow[]>(
      `${followUpSelect} WHERE followup.idempotency_key = $1 FOR UPDATE`,
      [context.idempotencyKey],
    );
    if (existingRows[0]) {
      if (!sameFollowUpInput(existingRows[0], promiseId, input)) {
        throw new PromiseIdempotencyConflictError();
      }
      return Object.freeze({
        promise: await requirePromiseById(
          transaction,
          promiseId,
          representativeScopeId,
        ),
        followUp: mapFollowUpRow(existingRows[0]),
        replayed: true,
      });
    }

    await lockPromise(transaction, promiseId, representativeScopeId);
    const contendedRows = await transaction.unsafe<FollowUpRow[]>(
      `${followUpSelect} WHERE followup.idempotency_key = $1 FOR UPDATE`,
      [context.idempotencyKey],
    );
    if (contendedRows[0]) {
      if (!sameFollowUpInput(contendedRows[0], promiseId, input)) {
        throw new PromiseIdempotencyConflictError();
      }
      return Object.freeze({
        promise: await requirePromiseById(
          transaction,
          promiseId,
          representativeScopeId,
        ),
        followUp: mapFollowUpRow(contendedRows[0]),
        replayed: true,
      });
    }
    const before = await requirePromiseById(
      transaction,
      promiseId,
      representativeScopeId,
    );
    const inserted = await transaction.unsafe<{ id: string }[]>(
      `
        INSERT INTO payment_promise_followups (
          promise_id,
          scheduled_at,
          completed_at,
          outcome,
          notes,
          created_by,
          request_id,
          idempotency_key
        ) VALUES ($1, $2::timestamptz, $3::timestamptz, $4, $5, $6, $7, $8)
        RETURNING id
      `,
      [
        promiseId,
        input.scheduledAt,
        input.completedAt ?? null,
        input.outcome ?? null,
        input.notes ?? null,
        context.actor.id,
        context.request.requestId,
        context.idempotencyKey,
      ],
    );
    const id = inserted[0]?.id;
    if (!id) throw new Error("تعذر إنشاء متابعة الوعد.");
    const followUpRows = await transaction.unsafe<FollowUpRow[]>(
      `${followUpSelect} WHERE followup.id = $1`,
      [id],
    );
    const followUp = followUpRows[0];
    if (!followUp) throw new Error("تعذر استرجاع متابعة الوعد.");
    const promise = await requirePromiseById(
      transaction,
      promiseId,
      representativeScopeId,
    );
    await insertEvent(transaction, {
      promiseId,
      context,
      eventType: "FOLLOW_UP_ADDED",
      oldValues: promiseSnapshot(before),
      newValues: {
        followUp: followUpSnapshot(followUp),
        promise: promiseSnapshot(promise),
      },
      operationPayload: normalizePayload(input),
      reason: null,
      sourceEntity: "PAYMENT_PROMISE_FOLLOWUP",
      sourceId: followUp.id,
      idempotencyKey: context.idempotencyKey,
    });
    await insertAudit(
      transaction,
      context,
      "promises.follow_up",
      promiseId,
      promiseSnapshot(before),
      {
        followUp: followUpSnapshot(followUp),
        promise: promiseSnapshot(promise),
      },
    );
    return Object.freeze({
      promise,
      followUp: mapFollowUpRow(followUp),
      replayed: false,
    });
  });
}

export async function rejectPromisePostgres(
  sql: Sql,
  promiseId: string,
  input: RejectPromiseInput,
  context: PromiseCommandContext,
  representativeScopeId?: string,
): Promise<{ readonly promise: PaymentPromise; readonly replayed: boolean }> {
  return terminalTransition(
    sql,
    promiseId,
    input.version,
    input.reason,
    "REJECTED",
    context,
    representativeScopeId,
  );
}

export async function cancelPromisePostgres(
  sql: Sql,
  promiseId: string,
  input: CancelPromiseInput,
  context: PromiseCommandContext,
  representativeScopeId?: string,
): Promise<{ readonly promise: PaymentPromise; readonly replayed: boolean }> {
  return terminalTransition(
    sql,
    promiseId,
    input.version,
    input.reason,
    "CANCELLED",
    context,
    representativeScopeId,
  );
}

export async function escalatePromisePostgres(
  sql: Sql,
  promiseId: string,
  input: EscalatePromiseInput,
  context: PromiseCommandContext,
  representativeScopeId?: string,
): Promise<{ readonly promise: PaymentPromise; readonly replayed: boolean }> {
  return sql.begin(async (transaction) => {
    const payload = normalizePayload(input);
    if (
      await findOperationReplay(
        transaction,
        promiseId,
        "ESCALATED",
        context.idempotencyKey,
        payload,
      )
    ) {
      return Object.freeze({
        promise: await requirePromiseById(
          transaction,
          promiseId,
          representativeScopeId,
        ),
        replayed: true,
      });
    }
    const locked = await lockPromise(
      transaction,
      promiseId,
      representativeScopeId,
    );
    if (
      await findOperationReplay(
        transaction,
        promiseId,
        "ESCALATED",
        context.idempotencyKey,
        payload,
      )
    ) {
      return Object.freeze({
        promise: await requirePromiseById(
          transaction,
          promiseId,
          representativeScopeId,
        ),
        replayed: true,
      });
    }
    assertVersion(locked, input.version);
    assertOpenPromise(locked);
    const currentLevel = safeInteger(
      locked.escalation_level,
      "escalation level",
    );
    if (input.level <= currentLevel) {
      throw new PromiseBusinessRuleError(
        "مستوى التصعيد الجديد يجب أن يكون أعلى من المستوى الحالي.",
      );
    }
    const rows = await transaction.unsafe<{ id: string }[]>(
      `
        UPDATE payment_promises
        SET escalation_level = $1,
            delay_reason = $2,
            updated_by = $3
        WHERE id = $4::uuid AND version = $5
        RETURNING id
      `,
      [input.level, input.reason, context.actor.id, promiseId, input.version],
    );
    if (!rows[0]) throw new PromiseConflictError();
    const promise = await requirePromiseById(
      transaction,
      promiseId,
      representativeScopeId,
    );
    const oldSnapshot = lockSnapshot(locked);
    const newSnapshot = promiseSnapshot(promise);
    await insertEvent(transaction, {
      promiseId,
      context,
      eventType: "ESCALATED",
      oldValues: oldSnapshot,
      newValues: newSnapshot,
      operationPayload: payload,
      reason: input.reason,
      sourceEntity: null,
      sourceId: null,
      idempotencyKey: context.idempotencyKey,
    });
    await insertAudit(
      transaction,
      context,
      "promises.escalate",
      promiseId,
      oldSnapshot,
      newSnapshot,
      input.reason,
    );
    return Object.freeze({ promise, replayed: false });
  });
}

export async function allocateConfirmedCollectionPostgres(
  sql: Sql,
  promiseId: string,
  input: AllocateCollectionInput,
  context: PromiseCommandContext,
  representativeScopeId?: string,
): Promise<{
  readonly promise: PaymentPromise;
  readonly allocation: PaymentPromiseAllocation;
  readonly replayed: boolean;
}> {
  return sql.begin(async (transaction) => {
    const existingRows = await transaction.unsafe<AllocationRow[]>(
      `${allocationSelect} WHERE allocation.idempotency_key = $1 FOR UPDATE`,
      [context.idempotencyKey],
    );
    if (existingRows[0]) {
      if (!sameAllocationInput(existingRows[0], promiseId, input)) {
        throw new PromiseIdempotencyConflictError();
      }
      return Object.freeze({
        promise: await requirePromiseById(
          transaction,
          promiseId,
          representativeScopeId,
        ),
        allocation: mapAllocationRow(existingRows[0]),
        replayed: true,
      });
    }

    const lockedPromise = await lockPromise(
      transaction,
      promiseId,
      representativeScopeId,
    );
    const collection = await lockCollection(transaction, input.collectionId);

    const replayRows = await transaction.unsafe<AllocationRow[]>(
      `${allocationSelect} WHERE allocation.idempotency_key = $1 FOR UPDATE`,
      [context.idempotencyKey],
    );
    if (replayRows[0]) {
      if (!sameAllocationInput(replayRows[0], promiseId, input)) {
        throw new PromiseIdempotencyConflictError();
      }
      return Object.freeze({
        promise: await requirePromiseById(
          transaction,
          promiseId,
          representativeScopeId,
        ),
        allocation: mapAllocationRow(replayRows[0]),
        replayed: true,
      });
    }

    assertOpenPromise(lockedPromise);
    validateCollectionForPromise(lockedPromise, collection);

    const [promiseTotalRows, collectionTotalRows] = await Promise.all([
      transaction.unsafe<{ total: string | number }[]>(
        `SELECT COALESCE(SUM(amount_minor), 0) AS total
         FROM payment_promise_allocations
         WHERE promise_id = $1::uuid AND reversed_at IS NULL`,
        [promiseId],
      ),
      transaction.unsafe<{ total: string | number }[]>(
        `SELECT COALESCE(SUM(amount_minor), 0) AS total
         FROM payment_promise_allocations
         WHERE collection_id = $1::uuid AND reversed_at IS NULL`,
        [input.collectionId],
      ),
    ]);
    const promiseAllocated = safeInteger(
      promiseTotalRows[0]?.total ?? 0,
      "promise allocation total",
    );
    const collectionAllocated = safeInteger(
      collectionTotalRows[0]?.total ?? 0,
      "collection allocation total",
    );
    const promisedAmount = safeInteger(
      lockedPromise.promised_amount_minor,
      "promised amount",
    );
    const collectionAmount = safeInteger(
      collection.amount_minor,
      "collection amount",
    );
    if (promiseAllocated + input.amountMinor > promisedAmount) {
      throw new PromiseBusinessRuleError(
        "مبلغ الربط يتجاوز الرصيد المتبقي في الوعد.",
      );
    }
    if (collectionAllocated + input.amountMinor > collectionAmount) {
      throw new PromiseBusinessRuleError(
        "مبلغ الربط يتجاوز الرصيد المتاح في التحصيل.",
      );
    }

    const inserted = await transaction.unsafe<{ id: string }[]>(
      `
        INSERT INTO payment_promise_allocations (
          promise_id,
          collection_id,
          currency_code,
          amount_minor,
          allocated_by,
          request_id,
          idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `,
      [
        promiseId,
        input.collectionId,
        lockedPromise.currency_code,
        input.amountMinor,
        context.actor.id,
        context.request.requestId,
        context.idempotencyKey,
      ],
    );
    if (!inserted[0]) {
      const raced = await transaction.unsafe<AllocationRow[]>(
        `${allocationSelect} WHERE allocation.idempotency_key = $1 FOR UPDATE`,
        [context.idempotencyKey],
      );
      if (!raced[0] || !sameAllocationInput(raced[0], promiseId, input)) {
        throw new PromiseIdempotencyConflictError();
      }
      return Object.freeze({
        promise: await requirePromiseById(
          transaction,
          promiseId,
          representativeScopeId,
        ),
        allocation: mapAllocationRow(raced[0]),
        replayed: true,
      });
    }

    const allocationRows = await transaction.unsafe<AllocationRow[]>(
      `${allocationSelect} WHERE allocation.id = $1`,
      [inserted[0].id],
    );
    const allocation = allocationRows[0];
    if (!allocation) throw new Error("تعذر استرجاع ربط التحصيل.");
    const promise = await requirePromiseById(
      transaction,
      promiseId,
      representativeScopeId,
    );
    const oldSnapshot = lockSnapshot(lockedPromise);
    const newSnapshot = promiseSnapshot(promise);
    await insertEvent(transaction, {
      promiseId,
      context,
      eventType: "COLLECTION_ALLOCATED",
      oldValues: oldSnapshot,
      newValues: {
        allocation: allocationSnapshot(allocation),
        promise: newSnapshot,
      },
      operationPayload: normalizePayload(input),
      reason: null,
      sourceEntity: "COLLECTION",
      sourceId: input.collectionId,
      idempotencyKey: context.idempotencyKey,
    });
    await insertStatusEventIfChanged(
      transaction,
      lockedPromise.base_status,
      promise,
      context,
      oldSnapshot,
      newSnapshot,
    );
    await insertAudit(
      transaction,
      context,
      "promises.allocate_collection",
      promiseId,
      oldSnapshot,
      { allocation: allocationSnapshot(allocation), promise: newSnapshot },
    );
    return Object.freeze({
      promise,
      allocation: mapAllocationRow(allocation),
      replayed: false,
    });
  });
}

export async function reverseCollectionAllocationPostgres(
  sql: Sql,
  promiseId: string,
  allocationId: string,
  input: ReverseAllocationInput,
  context: PromiseCommandContext,
  representativeScopeId?: string,
): Promise<{
  readonly promise: PaymentPromise;
  readonly allocation: PaymentPromiseAllocation;
  readonly replayed: boolean;
}> {
  return sql.begin(async (transaction) => {
    const replayRows = await transaction.unsafe<AllocationRow[]>(
      `${allocationSelect} WHERE allocation.reversal_idempotency_key = $1 FOR UPDATE`,
      [context.idempotencyKey],
    );
    if (replayRows[0]) {
      if (
        replayRows[0].id !== allocationId ||
        replayRows[0].promise_id !== promiseId ||
        replayRows[0].reversal_reason !== input.reason
      ) {
        throw new PromiseIdempotencyConflictError();
      }
      return Object.freeze({
        promise: await requirePromiseById(
          transaction,
          promiseId,
          representativeScopeId,
        ),
        allocation: mapAllocationRow(replayRows[0]),
        replayed: true,
      });
    }

    const seedRows = await transaction.unsafe<
      { promise_id: string; collection_id: string }[]
    >(
      `SELECT promise_id, collection_id
       FROM payment_promise_allocations
       WHERE id = $1::uuid`,
      [allocationId],
    );
    const seed = seedRows[0];
    if (!seed || seed.promise_id !== promiseId)
      throw new PromiseNotFoundError();

    const lockedPromise = await lockPromise(
      transaction,
      promiseId,
      representativeScopeId,
    );
    await lockCollection(transaction, seed.collection_id);
    const allocationRows = await transaction.unsafe<AllocationRow[]>(
      `${allocationSelect} WHERE allocation.id = $1::uuid FOR UPDATE`,
      [allocationId],
    );
    const allocationBefore = allocationRows[0];
    if (!allocationBefore || allocationBefore.promise_id !== promiseId) {
      throw new PromiseNotFoundError();
    }
    if (allocationBefore.reversed_at) {
      if (
        allocationBefore.reversal_idempotency_key === context.idempotencyKey
      ) {
        if (allocationBefore.reversal_reason !== input.reason) {
          throw new PromiseIdempotencyConflictError();
        }
        return Object.freeze({
          promise: await requirePromiseById(
            transaction,
            promiseId,
            representativeScopeId,
          ),
          allocation: mapAllocationRow(allocationBefore),
          replayed: true,
        });
      }
      throw new PromiseConflictError("تم عكس هذا الربط مسبقًا.");
    }

    const updated = await transaction.unsafe<{ id: string }[]>(
      `
        UPDATE payment_promise_allocations
        SET reversed_at = now(),
            reversed_by = $1,
            reversal_reason = $2,
            reversal_request_id = $3,
            reversal_idempotency_key = $4
        WHERE id = $5::uuid AND reversed_at IS NULL
        RETURNING id
      `,
      [
        context.actor.id,
        input.reason,
        context.request.requestId,
        context.idempotencyKey,
        allocationId,
      ],
    );
    if (!updated[0])
      throw new PromiseConflictError("تم عكس هذا الربط من عملية أخرى.");

    const finalRows = await transaction.unsafe<AllocationRow[]>(
      `${allocationSelect} WHERE allocation.id = $1`,
      [allocationId],
    );
    const allocation = finalRows[0];
    if (!allocation) throw new Error("تعذر استرجاع الربط المعكوس.");
    const promise = await requirePromiseById(
      transaction,
      promiseId,
      representativeScopeId,
    );
    const oldSnapshot = lockSnapshot(lockedPromise);
    const newSnapshot = promiseSnapshot(promise);
    await insertEvent(transaction, {
      promiseId,
      context,
      eventType: "COLLECTION_REVERSED",
      oldValues: {
        allocation: allocationSnapshot(allocationBefore),
        promise: oldSnapshot,
      },
      newValues: {
        allocation: allocationSnapshot(allocation),
        promise: newSnapshot,
      },
      operationPayload: normalizePayload(input),
      reason: input.reason,
      sourceEntity: "PAYMENT_PROMISE_ALLOCATION",
      sourceId: allocationId,
      idempotencyKey: context.idempotencyKey,
    });
    await insertStatusEventIfChanged(
      transaction,
      lockedPromise.base_status,
      promise,
      context,
      oldSnapshot,
      newSnapshot,
    );
    await insertAudit(
      transaction,
      context,
      "promises.reverse_allocation",
      promiseId,
      {
        allocation: allocationSnapshot(allocationBefore),
        promise: oldSnapshot,
      },
      { allocation: allocationSnapshot(allocation), promise: newSnapshot },
      input.reason,
    );
    return Object.freeze({
      promise,
      allocation: mapAllocationRow(allocation),
      replayed: false,
    });
  });
}

export async function getPromiseHistoryPostgres(
  sql: TransactionSql,
  promiseId: string,
): Promise<readonly PaymentPromiseEvent[]> {
  const rows = await sql.unsafe<EventRow[]>(
    `
      SELECT
        event.id,
        event.promise_id,
        event.actor_user_id,
        actor.full_name AS actor_name,
        event.occurred_at,
        event.request_id,
        event.event_type,
        event.old_values,
        event.new_values,
        event.operation_payload,
        event.reason,
        event.source_entity,
        event.source_id,
        event.idempotency_key
      FROM payment_promise_events AS event
      JOIN users AS actor ON actor.id = event.actor_user_id
      WHERE event.promise_id = $1::uuid
      ORDER BY event.occurred_at ASC, event.id ASC
    `,
    [promiseId],
  );
  return Object.freeze(rows.map(mapEventRow));
}

export async function getDuePromisesPostgres(
  sql: TransactionSql,
  limit = 100,
  representativeScopeId?: string,
): Promise<PromisePage> {
  return listPromisesPostgres(
    sql,
    { temporalStatus: "DUE_TODAY", limit },
    representativeScopeId,
  );
}

export async function getOverduePromisesPostgres(
  sql: TransactionSql,
  limit = 100,
  representativeScopeId?: string,
): Promise<PromisePage> {
  return listPromisesPostgres(
    sql,
    { temporalStatus: "OVERDUE", limit },
    representativeScopeId,
  );
}

export async function getCustomerPromiseSummaryPostgres(
  sql: TransactionSql,
  customerId: string,
  representativeScopeId?: string,
): Promise<CustomerPromiseSummary | null> {
  const customerRows = await sql.unsafe<{ id: string; name: string }[]>(
    `SELECT id, trade_name_ar AS name FROM customers
     WHERE id = $1::uuid AND deleted_at IS NULL AND merged_into_customer_id IS NULL`,
    [customerId],
  );
  const customer = customerRows[0];
  if (!customer) return null;
  const rows = await summaryRows(
    sql,
    representativeScopeId
      ? "promise.customer_id = $1::uuid AND promise.representative_id = $2::uuid"
      : "promise.customer_id = $1::uuid",
    representativeScopeId
      ? [customerId, representativeScopeId]
      : [customerId],
  );
  if (representativeScopeId && rows.length === 0) return null;
  return Object.freeze({
    customerId: customer.id,
    customerName: customer.name,
    currencies: Object.freeze(rows.map(mapSummaryRow)),
  });
}

export async function getSalespersonPromiseSummaryPostgres(
  sql: TransactionSql,
  representativeId: string,
  representativeScopeId?: string,
): Promise<SalespersonPromiseSummary | null> {
  if (representativeScopeId && representativeScopeId !== representativeId) {
    return null;
  }
  const representativeRows = await sql.unsafe<{ id: string; name: string }[]>(
    `SELECT id, full_name_ar AS name FROM sales_representatives
     WHERE id = $1::uuid AND deleted_at IS NULL`,
    [representativeId],
  );
  const representative = representativeRows[0];
  if (!representative) return null;
  const rows = await summaryRows(sql, "promise.representative_id = $1::uuid", [
    representativeId,
  ]);
  return Object.freeze({
    representativeId: representative.id,
    representativeName: representative.name,
    currencies: Object.freeze(rows.map(mapSummaryRow)),
  });
}

export async function getPromiseDashboardSummaryPostgres(
  sql: TransactionSql,
  representativeScopeId?: string,
): Promise<readonly CurrencyPromiseSummary[]> {
  return Object.freeze(
    (
      await summaryRows(
        sql,
        representativeScopeId ? "promise.representative_id = $1::uuid" : "TRUE",
        representativeScopeId ? [representativeScopeId] : [],
      )
    ).map(mapSummaryRow),
  );
}

export async function getPromiseFormOptionsPostgres(
  sql: TransactionSql,
  representativeScopeId?: string,
): Promise<PromiseFormOptions> {
  const accountParameters: SqlParameter[] = [];
  const assignmentJoin = representativeScopeId
    ? `JOIN customer_rep_assignments AS assignment
         ON assignment.customer_id = customer.id
        AND assignment.representative_id = $1::uuid
        AND assignment.valid_from <= now()
        AND (assignment.valid_until IS NULL OR assignment.valid_until > now())`
    : "";
  if (representativeScopeId) accountParameters.push(representativeScopeId);

  const [accounts, representatives] = await Promise.all([
    sql.unsafe<
      {
        id: string;
        customer_id: string;
        customer_name: string;
        customer_number: string | null;
        currency_code: CurrencyCode;
      }[]
    >(
      `
        SELECT DISTINCT
          account.id,
          account.customer_id,
          customer.trade_name_ar AS customer_name,
          customer.customer_number,
          account.currency_code
        FROM customer_accounts AS account
        JOIN customers AS customer ON customer.id = account.customer_id
        ${assignmentJoin}
        WHERE account.status = 'ACTIVE'
          AND customer.deleted_at IS NULL
          AND customer.merged_into_customer_id IS NULL
        ORDER BY customer.trade_name_ar, account.currency_code, account.id
      `,
      accountParameters,
    ),
    sql.unsafe<{ id: string; name: string }[]>(
      `
        SELECT id, full_name_ar AS name
        FROM sales_representatives
        WHERE status = 'ACTIVE'
          AND deleted_at IS NULL
          AND ($1::uuid IS NULL OR id = $1::uuid)
        ORDER BY full_name_ar, id
      `,
      [representativeScopeId ?? null],
    ),
  ]);
  return Object.freeze({
    accounts: Object.freeze(
      accounts.map((row) =>
        Object.freeze({
          id: row.id,
          customerId: row.customer_id,
          customerName: row.customer_name,
          customerNumber: row.customer_number,
          currencyCode: row.currency_code,
        }),
      ),
    ),
    representatives: Object.freeze(
      representatives.map((row) =>
        Object.freeze({ id: row.id, name: row.name }),
      ),
    ),
  });
}

export async function listAvailableConfirmedCollectionsPostgres(
  sql: TransactionSql,
  promiseId: string,
  representativeScopeId?: string,
): Promise<readonly ConfirmedCollectionOption[]> {
  const promise = await locklessPromise(sql, promiseId, representativeScopeId);
  if (!promise) return [];
  const rows = await sql.unsafe<
    {
      id: string;
      receipt_number: string | null;
      collected_at: Date | string;
      amount_minor: string | number;
      available_amount_minor: string | number;
      currency_code: CurrencyCode;
    }[]
  >(
    `
      SELECT
        collection.id,
        collection.receipt_number,
        collection.collected_at,
        collection.amount_minor,
        collection.amount_minor - COALESCE(SUM(allocation.amount_minor)
          FILTER (WHERE allocation.reversed_at IS NULL), 0) AS available_amount_minor,
        collection.currency_code
      FROM collections AS collection
      LEFT JOIN payment_promise_allocations AS allocation
        ON allocation.collection_id = collection.id
      WHERE collection.customer_id = $1::uuid
        AND collection.customer_account_id = $2::uuid
        AND collection.currency_code = $3
        AND collection.state IN ('RECONCILED', 'CLOSED')
        AND collection.ledger_entry_id IS NOT NULL
        AND collection.reversed_at IS NULL
      GROUP BY collection.id
      HAVING collection.amount_minor - COALESCE(SUM(allocation.amount_minor)
        FILTER (WHERE allocation.reversed_at IS NULL), 0) > 0
      ORDER BY collection.collected_at DESC, collection.id DESC
      LIMIT 100
    `,
    [promise.customer_id, promise.customer_account_id, promise.currency_code],
  );
  return Object.freeze(
    rows.map((row) =>
      Object.freeze({
        id: row.id,
        receiptNumber: row.receipt_number,
        collectedAt: toIsoString(row.collected_at),
        amountMinor: safeInteger(row.amount_minor, "collection amount"),
        availableAmountMinor: safeInteger(
          row.available_amount_minor,
          "available collection amount",
        ),
        currencyCode: row.currency_code,
      }),
    ),
  );
}

async function terminalTransition(
  sql: Sql,
  promiseId: string,
  version: number,
  reason: string,
  status: "REJECTED" | "CANCELLED",
  context: PromiseCommandContext,
  representativeScopeId?: string,
): Promise<{ readonly promise: PaymentPromise; readonly replayed: boolean }> {
  return sql.begin(async (transaction) => {
    const eventType: PromiseEventType = status;
    const payload = normalizePayload({ version, reason });
    if (
      await findOperationReplay(
        transaction,
        promiseId,
        eventType,
        context.idempotencyKey,
        payload,
      )
    ) {
      return Object.freeze({
        promise: await requirePromiseById(transaction, promiseId, representativeScopeId),
        replayed: true,
      });
    }
    const locked = await lockPromise(transaction, promiseId, representativeScopeId);
    if (
      await findOperationReplay(
        transaction,
        promiseId,
        eventType,
        context.idempotencyKey,
        payload,
      )
    ) {
      return Object.freeze({
        promise: await requirePromiseById(transaction, promiseId, representativeScopeId),
        replayed: true,
      });
    }
    assertVersion(locked, version);
    assertOpenPromise(locked);
    if (safeInteger(locked.fulfilled_amount_minor, "fulfilled amount") !== 0) {
      throw new PromiseBusinessRuleError(
        "اعكس جميع روابط التحصيل قبل رفض الوعد أو إلغائه.",
      );
    }
    const columns =
      status === "REJECTED"
        ? "rejected_at = now(), rejected_by = $1, rejection_reason = $2"
        : "cancelled_at = now(), cancelled_by = $1, cancellation_reason = $2";
    const rows = await transaction.unsafe<{ id: string }[]>(
      `UPDATE payment_promises
       SET base_status = $3,
           next_follow_up_at = NULL,
           ${columns},
           updated_by = $1
       WHERE id = $4::uuid AND version = $5
       RETURNING id`,
      [context.actor.id, reason, status, promiseId, version],
    );
    if (!rows[0]) throw new PromiseConflictError();
    const promise = await requirePromiseById(transaction, promiseId, representativeScopeId);
    const oldSnapshot = lockSnapshot(locked);
    const newSnapshot = promiseSnapshot(promise);
    await insertEvent(transaction, {
      promiseId,
      context,
      eventType,
      oldValues: oldSnapshot,
      newValues: newSnapshot,
      operationPayload: payload,
      reason,
      sourceEntity: null,
      sourceId: null,
      idempotencyKey: context.idempotencyKey,
    });
    await insertAudit(
      transaction,
      context,
      `promises.${status === "REJECTED" ? "reject" : "cancel"}`,
      promiseId,
      oldSnapshot,
      newSnapshot,
      reason,
    );
    return Object.freeze({ promise, replayed: false });
  });
}

async function findOperationReplay(
  transaction: TransactionSql,
  promiseId: string,
  eventType: PromiseEventType,
  idempotencyKey: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  const rows = await transaction.unsafe<(EventRow & { payload_matches: boolean })[]>(
    `
      SELECT
        event.id,
        event.promise_id,
        event.actor_user_id,
        actor.full_name AS actor_name,
        event.occurred_at,
        event.request_id,
        event.event_type,
        event.old_values,
        event.new_values,
        event.operation_payload,
        event.reason,
        event.source_entity,
        event.source_id,
        event.idempotency_key,
        event.operation_payload = $2::jsonb AS payload_matches
      FROM payment_promise_events AS event
      JOIN users AS actor ON actor.id = event.actor_user_id
      WHERE event.idempotency_key = $1
      FOR UPDATE
    `,
    [idempotencyKey, transaction.json(payload as never)],
  );
  const row = rows[0];
  if (!row) return false;
  if (
    row.promise_id !== promiseId ||
    row.event_type !== eventType ||
    !row.payload_matches
  ) {
    throw new PromiseIdempotencyConflictError();
  }
  return true;
}

async function insertEvent(
  transaction: TransactionSql,
  input: {
    readonly promiseId: string;
    readonly context: PromiseCommandContext;
    readonly eventType: PromiseEventType;
    readonly oldValues: Readonly<Record<string, unknown>>;
    readonly newValues: Readonly<Record<string, unknown>>;
    readonly operationPayload: Readonly<Record<string, unknown>>;
    readonly reason: string | null;
    readonly sourceEntity: string | null;
    readonly sourceId: string | null;
    readonly idempotencyKey: string | null;
  },
): Promise<void> {
  try {
    await transaction.unsafe(
      `
        INSERT INTO payment_promise_events (
          promise_id,
          actor_user_id,
          request_id,
          event_type,
          old_values,
          new_values,
          operation_payload,
          reason,
          source_entity,
          source_id,
          idempotency_key
        ) VALUES (
          $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb,
          $8, $9, $10, $11
        )
      `,
      [
        input.promiseId,
        input.context.actor.id,
        input.context.request.requestId,
        input.eventType,
        transaction.json(input.oldValues as never),
        transaction.json(input.newValues as never),
        transaction.json(input.operationPayload as never),
        input.reason,
        input.sourceEntity,
        input.sourceId,
        input.idempotencyKey,
      ],
    );
  } catch (error) {
    if (postgresCode(error) === "23505" && input.idempotencyKey) {
      throw new PromiseIdempotencyConflictError();
    }
    throw error;
  }
}

async function insertAudit(
  transaction: TransactionSql,
  context: PromiseCommandContext,
  action: string,
  resourceId: string,
  previousValues: Readonly<Record<string, unknown>> | null,
  newValues: Readonly<Record<string, unknown>> | null,
  reason?: string,
): Promise<void> {
  await transaction.unsafe(
    `
      INSERT INTO audit_logs (
        actor_user_id,
        actor_type,
        action,
        resource_type,
        resource_id,
        request_id,
        session_id,
        ip_address,
        user_agent,
        reason,
        previous_values,
        new_values,
        result,
        metadata
      ) VALUES (
        $1, 'USER', $2, 'PAYMENT_PROMISE', $3, $4, $5,
        $6::inet, $7, $8, $9::jsonb, $10::jsonb, 'SUCCESS',
        jsonb_build_object('operating_mode', 'SINGLE_BRANCH_ADEN')
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
      previousValues ? transaction.json(previousValues as never) : null,
      newValues ? transaction.json(newValues as never) : null,
    ],
  );
}

async function insertStatusEventIfChanged(
  transaction: TransactionSql,
  oldStatus: PromiseBaseStatus,
  promise: PaymentPromise,
  context: PromiseCommandContext,
  oldValues: Readonly<Record<string, unknown>>,
  newValues: Readonly<Record<string, unknown>>,
): Promise<void> {
  if (oldStatus === promise.baseStatus) return;
  let eventType: PromiseEventType | null = null;
  if (promise.baseStatus === "PARTIALLY_FULFILLED")
    eventType = "PARTIALLY_FULFILLED";
  if (promise.baseStatus === "FULFILLED") eventType = "FULFILLED";
  if (
    (oldStatus === "FULFILLED" || oldStatus === "PARTIALLY_FULFILLED") &&
    promise.baseStatus !== "FULFILLED"
  ) {
    eventType = "REOPENED";
  }
  if (!eventType) return;
  await insertEvent(transaction, {
    promiseId: promise.id,
    context,
    eventType,
    oldValues,
    newValues,
    operationPayload: {},
    reason: null,
    sourceEntity: null,
    sourceId: null,
    idempotencyKey: null,
  });
}

function specializedEvent(
  promiseId: string,
  context: PromiseCommandContext,
  eventType: PromiseEventType,
  oldValues: Readonly<Record<string, unknown>>,
  newValues: Readonly<Record<string, unknown>>,
): Parameters<typeof insertEvent>[1] {
  return {
    promiseId,
    context,
    eventType,
    oldValues,
    newValues,
    operationPayload: {},
    reason: null,
    sourceEntity: null,
    sourceId: null,
    idempotencyKey: null,
  };
}

async function selectPromises(
  sql: TransactionSql,
  suffix: string,
  parameters: readonly SqlParameter[],
): Promise<PromiseRow[]> {
  return sql.unsafe<PromiseRow[]>(
    `SELECT ${promiseSelect} ${promiseJoins} ${suffix}`,
    [...parameters],
  );
}

async function assertActiveRepresentativeAssignment(
  sql: TransactionSql,
  representativeId: string,
  customerId: string,
): Promise<void> {
  const rows = await sql.unsafe<{ allowed: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1
       FROM customer_rep_assignments
       WHERE customer_id = $1::uuid
         AND representative_id = $2::uuid
         AND valid_from <= now()
         AND (valid_until IS NULL OR valid_until > now())
     ) AS allowed`,
    [customerId, representativeId],
  );
  if (!rows[0]?.allowed) throw new PromiseNotFoundError();
}

async function requirePromiseById(
  sql: TransactionSql,
  promiseId: string,
  representativeScopeId?: string,
): Promise<PaymentPromise> {
  const promise = await getPromisePostgres(sql, promiseId, representativeScopeId);
  if (!promise) throw new PromiseNotFoundError();
  return promise;
}

async function lockPromise(
  transaction: TransactionSql,
  promiseId: string,
  representativeScopeId?: string,
): Promise<PromiseLockRow> {
  const rows = await transaction.unsafe<PromiseLockRow[]>(
    `
      SELECT
        id,
        customer_id,
        customer_account_id,
        representative_id,
        currency_code,
        promised_amount_minor,
        fulfilled_amount_minor,
        promise_date,
        due_date,
        next_follow_up_at,
        debt_reason,
        delay_reason,
        notes,
        base_status,
        escalation_level,
        version
      FROM payment_promises
      WHERE id = $1::uuid
        AND ($2::uuid IS NULL OR representative_id = $2::uuid)
      FOR UPDATE
    `,
    [promiseId, representativeScopeId ?? null],
  );
  if (!rows[0]) throw new PromiseNotFoundError();
  return rows[0];
}

async function locklessPromise(
  sql: TransactionSql,
  promiseId: string,
  representativeScopeId?: string,
): Promise<PromiseLockRow | null> {
  const rows = await sql.unsafe<PromiseLockRow[]>(
    `
      SELECT
        id,
        customer_id,
        customer_account_id,
        representative_id,
        currency_code,
        promised_amount_minor,
        fulfilled_amount_minor,
        promise_date,
        due_date,
        next_follow_up_at,
        debt_reason,
        delay_reason,
        notes,
        base_status,
        escalation_level,
        version
      FROM payment_promises
      WHERE id = $1::uuid
        AND ($2::uuid IS NULL OR representative_id = $2::uuid)
    `,
    [promiseId, representativeScopeId ?? null],
  );
  return rows[0] ?? null;
}

async function lockCollection(
  transaction: TransactionSql,
  collectionId: string,
): Promise<CollectionLockRow> {
  const rows = await transaction.unsafe<CollectionLockRow[]>(
    `
      SELECT
        id,
        customer_id,
        customer_account_id,
        currency_code,
        amount_minor,
        receipt_number,
        collected_at,
        state,
        ledger_entry_id,
        reversed_at
      FROM collections
      WHERE id = $1::uuid
      FOR UPDATE
    `,
    [collectionId],
  );
  if (!rows[0])
    throw new PromiseBusinessRuleError("التحصيل غير موجود أو غير متاح.");
  return rows[0];
}

function validateCollectionForPromise(
  promise: PromiseLockRow,
  collection: CollectionLockRow,
): void {
  if (collection.state !== "RECONCILED" && collection.state !== "CLOSED") {
    throw new PromiseBusinessRuleError(
      "لا يمكن ربط وعد إلا بتحصيل مؤكد ماليًا.",
    );
  }
  if (!collection.ledger_entry_id || collection.reversed_at) {
    throw new PromiseBusinessRuleError("التحصيل غير مؤكد أو تم عكسه.");
  }
  if (
    collection.customer_id !== promise.customer_id ||
    collection.customer_account_id !== promise.customer_account_id
  ) {
    throw new PromiseBusinessRuleError(
      "التحصيل لا يخص العميل وحساب العملة المحددين في الوعد.",
    );
  }
  if (collection.currency_code !== promise.currency_code) {
    throw new PromiseBusinessRuleError("عملة التحصيل لا تطابق عملة الوعد.");
  }
}

const followUpSelect = `
  SELECT
    followup.id,
    followup.promise_id,
    followup.scheduled_at,
    followup.completed_at,
    followup.outcome,
    followup.notes,
    followup.created_by,
    creator.full_name AS created_by_name,
    followup.created_at,
    followup.request_id,
    followup.idempotency_key
  FROM payment_promise_followups AS followup
  JOIN users AS creator ON creator.id = followup.created_by
`;

async function listPromiseFollowUpsPostgres(
  sql: TransactionSql,
  promiseId: string,
): Promise<readonly PaymentPromiseFollowUp[]> {
  const rows = await sql.unsafe<FollowUpRow[]>(
    `${followUpSelect}
     WHERE followup.promise_id = $1::uuid
     ORDER BY followup.scheduled_at ASC, followup.id ASC`,
    [promiseId],
  );
  return Object.freeze(rows.map(mapFollowUpRow));
}

const allocationSelect = `
  SELECT
    allocation.id,
    allocation.promise_id,
    allocation.collection_id,
    allocation.currency_code,
    allocation.amount_minor,
    allocation.allocated_at,
    allocation.allocated_by,
    allocator.full_name AS allocated_by_name,
    allocation.request_id,
    allocation.idempotency_key,
    allocation.reversed_at,
    allocation.reversed_by,
    allocation.reversal_reason,
    allocation.reversal_request_id,
    allocation.reversal_idempotency_key
  FROM payment_promise_allocations AS allocation
  JOIN users AS allocator ON allocator.id = allocation.allocated_by
`;

async function listPromiseAllocationsPostgres(
  sql: TransactionSql,
  promiseId: string,
): Promise<readonly PaymentPromiseAllocation[]> {
  const rows = await sql.unsafe<AllocationRow[]>(
    `${allocationSelect}
     WHERE allocation.promise_id = $1::uuid
     ORDER BY allocation.allocated_at ASC, allocation.id ASC`,
    [promiseId],
  );
  return Object.freeze(rows.map(mapAllocationRow));
}

async function summaryRows(
  sql: TransactionSql,
  condition: string,
  parameters: readonly SqlParameter[],
): Promise<SummaryRow[]> {
  return sql.unsafe<SummaryRow[]>(
    `
      SELECT
        promise.currency_code,
        COUNT(*)::integer AS promise_count,
        COALESCE(SUM(promise.promised_amount_minor), 0) AS promised_amount_minor,
        COALESCE(SUM(promise.fulfilled_amount_minor), 0) AS fulfilled_amount_minor,
        COALESCE(SUM(promise.remaining_amount_minor), 0) AS remaining_amount_minor,
        COUNT(*) FILTER (
          WHERE promise.base_status IN ('NEW', 'UPCOMING', 'PARTIALLY_FULFILLED')
            AND promise.due_date = ${adenTodaySql}
        )::integer AS due_today_count,
        COUNT(*) FILTER (
          WHERE promise.base_status IN ('NEW', 'UPCOMING', 'PARTIALLY_FULFILLED')
            AND promise.due_date < ${adenTodaySql}
        )::integer AS overdue_count,
        COUNT(*) FILTER (WHERE promise.base_status = 'PARTIALLY_FULFILLED')::integer
          AS partially_fulfilled_count,
        COUNT(*) FILTER (WHERE promise.base_status = 'FULFILLED')::integer
          AS fulfilled_count
      FROM payment_promises AS promise
      WHERE ${condition}
      GROUP BY promise.currency_code
      ORDER BY promise.currency_code
    `,
    [...parameters],
  );
}

function mapPromiseRow(row: PromiseRow): PaymentPromise {
  return Object.freeze({
    id: row.id,
    customerId: row.customer_id,
    customerAccountId: row.customer_account_id,
    customerName: row.customer_name,
    customerNumber: row.customer_number,
    representativeId: row.representative_id,
    representativeName: row.representative_name,
    currencyCode: row.currency_code,
    promisedAmountMinor: safeInteger(
      row.promised_amount_minor,
      "promised amount",
    ),
    fulfilledAmountMinor: safeInteger(
      row.fulfilled_amount_minor,
      "fulfilled amount",
    ),
    remainingAmountMinor: safeInteger(
      row.remaining_amount_minor,
      "remaining amount",
    ),
    promiseDate: toDateString(row.promise_date),
    dueDate: toDateString(row.due_date),
    nextFollowUpAt: toOptionalIsoString(row.next_follow_up_at),
    debtReason: row.debt_reason,
    delayReason: row.delay_reason,
    notes: row.notes,
    baseStatus: row.base_status,
    temporalStatus: row.temporal_status,
    escalationLevel: safeInteger(row.escalation_level, "escalation level"),
    rejectedAt: toOptionalIsoString(row.rejected_at),
    rejectedBy: row.rejected_by,
    rejectionReason: row.rejection_reason,
    cancelledAt: toOptionalIsoString(row.cancelled_at),
    cancelledBy: row.cancelled_by,
    cancellationReason: row.cancellation_reason,
    createdBy: row.created_by,
    createdAt: toIsoString(row.created_at),
    updatedBy: row.updated_by,
    updatedAt: toIsoString(row.updated_at),
    version: safeInteger(row.version, "version"),
  });
}

function mapEventRow(row: EventRow): PaymentPromiseEvent {
  return Object.freeze({
    id: row.id,
    promiseId: row.promise_id,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    occurredAt: toIsoString(row.occurred_at),
    requestId: row.request_id,
    eventType: row.event_type,
    oldValues: Object.freeze(asRecord(row.old_values)),
    newValues: Object.freeze(asRecord(row.new_values)),
    reason: row.reason,
    sourceEntity: row.source_entity,
    sourceId: row.source_id,
  });
}

function mapFollowUpRow(row: FollowUpRow): PaymentPromiseFollowUp {
  return Object.freeze({
    id: row.id,
    promiseId: row.promise_id,
    scheduledAt: toIsoString(row.scheduled_at),
    completedAt: toOptionalIsoString(row.completed_at),
    outcome: row.outcome,
    notes: row.notes,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: toIsoString(row.created_at),
  });
}

function mapAllocationRow(row: AllocationRow): PaymentPromiseAllocation {
  return Object.freeze({
    id: row.id,
    promiseId: row.promise_id,
    collectionId: row.collection_id,
    currencyCode: row.currency_code,
    amountMinor: safeInteger(row.amount_minor, "allocation amount"),
    allocatedAt: toIsoString(row.allocated_at),
    allocatedBy: row.allocated_by,
    allocatedByName: row.allocated_by_name,
    reversedAt: toOptionalIsoString(row.reversed_at),
    reversedBy: row.reversed_by,
    reversalReason: row.reversal_reason,
  });
}

function mapSummaryRow(row: SummaryRow): CurrencyPromiseSummary {
  return Object.freeze({
    currencyCode: row.currency_code,
    promiseCount: safeInteger(row.promise_count, "promise count"),
    promisedAmountMinor: safeInteger(
      row.promised_amount_minor,
      "promised summary",
    ),
    fulfilledAmountMinor: safeInteger(
      row.fulfilled_amount_minor,
      "fulfilled summary",
    ),
    remainingAmountMinor: safeInteger(
      row.remaining_amount_minor,
      "remaining summary",
    ),
    dueTodayCount: safeInteger(row.due_today_count, "due today count"),
    overdueCount: safeInteger(row.overdue_count, "overdue count"),
    partiallyFulfilledCount: safeInteger(
      row.partially_fulfilled_count,
      "partial count",
    ),
    fulfilledCount: safeInteger(row.fulfilled_count, "fulfilled count"),
  });
}

function sameFollowUpInput(
  row: FollowUpRow,
  promiseId: string,
  input: AddFollowUpInput,
): boolean {
  return (
    row.promise_id === promiseId &&
    toIsoString(row.scheduled_at) === toIsoString(input.scheduledAt) &&
    toOptionalIsoString(row.completed_at) ===
      (input.completedAt ? toIsoString(input.completedAt) : null) &&
    row.outcome === (input.outcome ?? null) &&
    row.notes === (input.notes ?? null)
  );
}

function sameAllocationInput(
  row: AllocationRow,
  promiseId: string,
  input: AllocateCollectionInput,
): boolean {
  return (
    row.promise_id === promiseId &&
    row.collection_id === input.collectionId &&
    safeInteger(row.amount_minor, "allocation amount") === input.amountMinor
  );
}

function assertVersion(row: PromiseLockRow, expected: number): void {
  if (safeInteger(row.version, "version") !== expected)
    throw new PromiseConflictError();
}

function assertOpenPromise(row: PromiseLockRow): void {
  if (!openStatuses.includes(row.base_status)) {
    throw new PromiseBusinessRuleError(
      "حالة الوعد الحالية لا تسمح بهذه العملية.",
    );
  }
}

function calculateStatus(
  fulfilledAmount: number,
  promisedAmount: number,
  dueDate: string,
): PromiseBaseStatus {
  if (fulfilledAmount === promisedAmount) return "FULFILLED";
  if (fulfilledAmount > 0) return "PARTIALLY_FULFILLED";
  return dueDate > adenDateString(new Date()) ? "UPCOMING" : "NEW";
}

function promiseSnapshot(
  promise: PaymentPromise,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: promise.id,
    customerId: promise.customerId,
    customerAccountId: promise.customerAccountId,
    representativeId: promise.representativeId,
    currencyCode: promise.currencyCode,
    promisedAmountMinor: promise.promisedAmountMinor,
    fulfilledAmountMinor: promise.fulfilledAmountMinor,
    remainingAmountMinor: promise.remainingAmountMinor,
    promiseDate: promise.promiseDate,
    dueDate: promise.dueDate,
    nextFollowUpAt: promise.nextFollowUpAt,
    debtReason: promise.debtReason,
    delayReason: promise.delayReason,
    notes: promise.notes,
    baseStatus: promise.baseStatus,
    escalationLevel: promise.escalationLevel,
    version: promise.version,
  });
}

function lockSnapshot(row: PromiseLockRow): Readonly<Record<string, unknown>> {
  const promised = safeInteger(row.promised_amount_minor, "promised amount");
  const fulfilled = safeInteger(row.fulfilled_amount_minor, "fulfilled amount");
  return Object.freeze({
    id: row.id,
    customerId: row.customer_id,
    customerAccountId: row.customer_account_id,
    representativeId: row.representative_id,
    currencyCode: row.currency_code,
    promisedAmountMinor: promised,
    fulfilledAmountMinor: fulfilled,
    remainingAmountMinor: promised - fulfilled,
    promiseDate: toDateString(row.promise_date),
    dueDate: toDateString(row.due_date),
    nextFollowUpAt: toOptionalIsoString(row.next_follow_up_at),
    debtReason: row.debt_reason,
    delayReason: row.delay_reason,
    notes: row.notes,
    baseStatus: row.base_status,
    escalationLevel: safeInteger(row.escalation_level, "escalation level"),
    version: safeInteger(row.version, "version"),
  });
}

function followUpSnapshot(row: FollowUpRow): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: row.id,
    scheduledAt: toIsoString(row.scheduled_at),
    completedAt: toOptionalIsoString(row.completed_at),
    outcome: row.outcome,
    notes: row.notes,
  });
}

function allocationSnapshot(
  row: AllocationRow,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: row.id,
    collectionId: row.collection_id,
    currencyCode: row.currency_code,
    amountMinor: safeInteger(row.amount_minor, "allocation amount"),
    allocatedAt: toIsoString(row.allocated_at),
    reversedAt: toOptionalIsoString(row.reversed_at),
    reversalReason: row.reversal_reason,
  });
}

function createOperationPayload(
  input: CreatePromiseInput,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    customerId: input.customerId,
    customerAccountId: input.customerAccountId,
    representativeId: input.representativeId,
    currencyCode: input.currencyCode,
    promisedAmountMinor: input.promisedAmountMinor,
    promiseDate: input.promiseDate,
    dueDate: input.dueDate,
    nextFollowUpAt: input.nextFollowUpAt
      ? toIsoString(input.nextFollowUpAt)
      : null,
    debtReason: input.debtReason,
    delayReason: input.delayReason ?? null,
    notes: input.notes ?? null,
  });
}

function normalizePayload(value: object): Readonly<Record<string, unknown>> {
  return Object.freeze(
    JSON.parse(JSON.stringify(value)) as Record<string, unknown>,
  );
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJson(nested)]),
    );
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function encodeCursor(value: CursorPayload): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value: string): CursorPayload {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (!parsed || typeof parsed !== "object")
      throw new Error("invalid cursor");
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.dueDate !== "string" ||
      typeof record.createdAt !== "string" ||
      typeof record.id !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(record.dueDate) ||
      Number.isNaN(Date.parse(record.createdAt)) ||
      !/^[0-9a-f-]{36}$/iu.test(record.id)
    ) {
      throw new Error("invalid cursor");
    }
    return {
      dueDate: record.dueDate,
      createdAt: record.createdAt,
      id: record.id,
    };
  } catch {
    throw new PromiseBusinessRuleError("مؤشر الصفحة غير صالح.");
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}

function safeInteger(value: string | number, label: string): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numeric))
    throw new Error(`Stored ${label} is outside the safe integer range.`);
  return numeric;
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new Error("Stored timestamp is invalid.");
  return date.toISOString();
}

function toOptionalIsoString(value: Date | string | null): string | null {
  return value === null ? null : toIsoString(value);
}

function toDateString(value: Date | string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value))
    return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Stored date is invalid.");
  return date.toISOString().slice(0, 10);
}

function adenDateString(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Aden",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function postgresCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}
