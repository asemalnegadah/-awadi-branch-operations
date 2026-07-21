import type { Sql, TransactionSql } from "postgres";

import {
  FieldVisitBusinessRuleError,
  FieldVisitConflictError,
  FieldVisitIdempotencyConflictError,
  FieldVisitNotFoundError,
} from "./errors";
import type {
  AddFieldVisitEvidenceInput,
  AddFieldVisitOutcomeInput,
  CreateFieldVisitInput,
  DailyPlanItemExecutionResult,
  FieldVisit,
  FieldVisitCommandContext,
  FieldVisitDetails,
  FieldVisitEvent,
  FieldVisitEvidence,
  FieldVisitListFilters,
  FieldVisitLocationInput,
  FieldVisitOutcome,
  FieldVisitPage,
  FieldVisitTransitionInput,
  RecordPlanItemResultInput,
  SubmitFieldVisitInput,
} from "./types";

type SqlExecutor = Sql | TransactionSql;

interface VisitRow {
  id: string;
  representative_id: string;
  representative_name: string;
  customer_id: string;
  customer_name: string;
  customer_number: string | null;
  plan_id: string | null;
  plan_item_id: string | null;
  visit_source: FieldVisit["visitSource"];
  state: FieldVisit["state"];
  visit_type: FieldVisit["visitType"];
  objective: string;
  declared_result: FieldVisit["declaredResult"];
  outcome_summary: string | null;
  arrived_at: string | Date | null;
  departed_at: string | Date | null;
  device_arrived_at: string | Date | null;
  device_departed_at: string | Date | null;
  checkin_latitude: string | number | null;
  checkin_longitude: string | number | null;
  checkin_accuracy_meters: string | number | null;
  checkout_latitude: string | number | null;
  checkout_longitude: string | number | null;
  checkout_accuracy_meters: string | number | null;
  sync_status: FieldVisit["syncStatus"];
  sync_received_at: string | Date | null;
  out_of_plan_reason: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string | Date;
  submitted_by: string | null;
  submitted_at: string | Date | null;
  verified_by: string | null;
  verified_at: string | Date | null;
  cancelled_by: string | null;
  cancelled_at: string | Date | null;
  cancellation_reason: string | null;
  version: string | number;
  updated_at: string | Date;
  outcome_count: string | number;
  qualifying_outcome_count: string | number;
  evidence_count: string | number;
}

interface OutcomeRow {
  id: string;
  visit_id: string;
  outcome_type: FieldVisitOutcome["outcomeType"];
  collection_id: string | null;
  promise_id: string | null;
  reference_id: string | null;
  currency_code: FieldVisitOutcome["currencyCode"];
  amount_minor: string | number | null;
  summary: string;
  details: Readonly<Record<string, unknown>>;
  qualifies_success: boolean;
  recorded_by: string;
  recorded_by_name: string;
  recorded_at: string | Date;
}

interface EvidenceRow {
  id: string;
  visit_id: string;
  uploaded_file_id: string;
  file_name: string;
  media_type: string;
  evidence_type: FieldVisitEvidence["evidenceType"];
  caption: string | null;
  recorded_by: string;
  recorded_by_name: string;
  recorded_at: string | Date;
}

interface EventRow {
  id: string;
  visit_id: string;
  event_type: FieldVisitEvent["eventType"];
  actor_user_id: string;
  actor_name: string;
  occurred_at: string | Date;
  old_values: Readonly<Record<string, unknown>>;
  new_values: Readonly<Record<string, unknown>>;
  reason: string | null;
}

interface ResultRow {
  id: string;
  plan_item_id: string;
  visit_id: string | null;
  result_type: DailyPlanItemExecutionResult["resultType"];
  reason: string;
  next_action_at: string | Date | null;
  recorded_by: string;
  recorded_by_name: string;
  recorded_at: string | Date;
  supersedes_result_id: string | null;
}

const visitSelect = `
  SELECT
    visit.*,
    representative.full_name_ar AS representative_name,
    customer.trade_name_ar AS customer_name,
    customer.customer_number,
    creator.full_name AS created_by_name,
    COALESCE(summary.outcome_count, 0) AS outcome_count,
    COALESCE(summary.qualifying_outcome_count, 0) AS qualifying_outcome_count,
    COALESCE(summary.evidence_count, 0) AS evidence_count
  FROM field_visits AS visit
  JOIN sales_representatives AS representative ON representative.id = visit.representative_id
  JOIN customers AS customer ON customer.id = visit.customer_id
  JOIN users AS creator ON creator.id = visit.created_by
  LEFT JOIN field_visit_summaries AS summary ON summary.visit_id = visit.id
`;

export async function listFieldVisitsPostgres(
  sql: Sql,
  filters: FieldVisitListFilters,
  representativeScopeId?: string,
): Promise<FieldVisitPage> {
  const rows = await sql.unsafe<VisitRow[]>(
    `${visitSelect}
     WHERE ($1::uuid IS NULL OR visit.representative_id = $1::uuid)
       AND ($2::uuid IS NULL OR visit.representative_id = $2::uuid)
       AND ($3::uuid IS NULL OR visit.customer_id = $3::uuid)
       AND ($4::text IS NULL OR visit.state = $4)
       AND ($5::date IS NULL OR COALESCE(visit.arrived_at, visit.created_at)::date >= $5::date)
       AND ($6::date IS NULL OR COALESCE(visit.arrived_at, visit.created_at)::date <= $6::date)
       AND ($7::uuid IS NULL OR visit.id < $7::uuid)
     ORDER BY COALESCE(visit.arrived_at, visit.created_at) DESC, visit.id DESC
     LIMIT $8`,
    [
      representativeScopeId ?? null,
      filters.representativeId ?? null,
      filters.customerId ?? null,
      filters.state ?? null,
      filters.visitDateFrom ?? null,
      filters.visitDateTo ?? null,
      filters.cursor ?? null,
      filters.limit + 1,
    ],
  );
  const hasMore = rows.length > filters.limit;
  const selected = hasMore ? rows.slice(0, filters.limit) : rows;
  return Object.freeze({
    items: Object.freeze(selected.map(mapVisitRow)),
    nextCursor: hasMore ? selected.at(-1)?.id ?? null : null,
  });
}

export async function getFieldVisitPostgres(
  sql: SqlExecutor,
  visitId: string,
  representativeScopeId?: string,
  lock = false,
): Promise<FieldVisit | null> {
  const rows = await sql.unsafe<VisitRow[]>(
    `${visitSelect}
     WHERE visit.id = $1::uuid
       AND ($2::uuid IS NULL OR visit.representative_id = $2::uuid)
     ${lock ? "FOR UPDATE OF visit" : ""}`,
    [visitId, representativeScopeId ?? null],
  );
  return rows[0] ? mapVisitRow(rows[0]) : null;
}

export async function requireFieldVisitPostgres(
  sql: SqlExecutor,
  visitId: string,
  representativeScopeId?: string,
  lock = false,
): Promise<FieldVisit> {
  const visit = await getFieldVisitPostgres(sql, visitId, representativeScopeId, lock);
  if (!visit) throw new FieldVisitNotFoundError();
  return visit;
}

export async function getFieldVisitDetailsPostgres(
  sql: Sql,
  visitId: string,
  representativeScopeId?: string,
  includeHistory = true,
): Promise<FieldVisitDetails> {
  const visit = await requireFieldVisitPostgres(sql, visitId, representativeScopeId);
  const [outcomeRows, evidenceRows, eventRows, resultRows] = await Promise.all([
    sql.unsafe<OutcomeRow[]>(
      `SELECT outcome.*, actor.full_name AS recorded_by_name
       FROM field_visit_outcomes AS outcome
       JOIN users AS actor ON actor.id = outcome.recorded_by
       WHERE outcome.visit_id = $1::uuid
       ORDER BY outcome.recorded_at, outcome.id`,
      [visitId],
    ),
    sql.unsafe<EvidenceRow[]>(
      `SELECT evidence.*, file.original_name AS file_name, file.media_type,
              actor.full_name AS recorded_by_name
       FROM field_visit_evidence AS evidence
       JOIN uploaded_files AS file ON file.id = evidence.uploaded_file_id
       JOIN users AS actor ON actor.id = evidence.recorded_by
       WHERE evidence.visit_id = $1::uuid
       ORDER BY evidence.recorded_at, evidence.id`,
      [visitId],
    ),
    includeHistory
      ? sql.unsafe<EventRow[]>(
          `SELECT event.*, actor.full_name AS actor_name
           FROM field_visit_events AS event
           JOIN users AS actor ON actor.id = event.actor_user_id
           WHERE event.visit_id = $1::uuid
           ORDER BY event.occurred_at, event.id`,
          [visitId],
        )
      : Promise.resolve([]),
    visit.planItemId
      ? sql.unsafe<ResultRow[]>(
          `SELECT result.*, actor.full_name AS recorded_by_name
           FROM current_daily_plan_item_results AS result
           JOIN users AS actor ON actor.id = result.recorded_by
           WHERE result.plan_item_id = $1::uuid`,
          [visit.planItemId],
        )
      : Promise.resolve([]),
  ]);
  return Object.freeze({
    visit,
    outcomes: Object.freeze(outcomeRows.map(mapOutcomeRow)),
    evidence: Object.freeze(evidenceRows.map(mapEvidenceRow)),
    events: Object.freeze(eventRows.map(mapEventRow)),
    planItemResult: resultRows[0] ? mapResultRow(resultRows[0]) : null,
  });
}

export async function createFieldVisitPostgres(
  sql: Sql,
  representativeId: string,
  input: CreateFieldVisitInput,
  context: FieldVisitCommandContext,
): Promise<{ readonly visit: FieldVisit; readonly replayed: boolean }> {
  return sql.begin(async (transaction) => {
    const existing = await findVisitByIdempotency(transaction, context.idempotencyKey, true);
    const payload = createPayload(representativeId, input);
    if (existing) {
      if (!sameCreatePayload(existing, payload)) throw new FieldVisitIdempotencyConflictError();
      return Object.freeze({ visit: existing, replayed: true });
    }
    const rows = await transaction.unsafe<{ id: string }[]>(
      `INSERT INTO field_visits (
         representative_id, customer_id, plan_id, plan_item_id, visit_source,
         visit_type, objective, out_of_plan_reason, created_by, idempotency_key
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        representativeId,
        input.customerId,
        input.planId ?? null,
        input.planItemId ?? null,
        input.planId ? "PLAN" : "OUT_OF_PLAN",
        input.visitType,
        input.objective,
        input.outOfPlanReason ?? null,
        context.actor.id,
        context.idempotencyKey,
      ],
    );
    const visitId = rows[0]?.id;
    if (!visitId) throw new FieldVisitConflictError("تعذر إنشاء الزيارة.");
    const visit = await requireFieldVisitPostgres(transaction, visitId);
    await insertEvent(transaction, visitId, "CREATED", context, {}, visitSnapshot(visit), null);
    await insertAudit(transaction, visit, "visits.created", context, {}, visitSnapshot(visit), null);
    return Object.freeze({ visit, replayed: false });
  });
}

export async function checkInFieldVisitPostgres(
  sql: Sql,
  visitId: string,
  input: FieldVisitLocationInput,
  context: FieldVisitCommandContext,
  representativeScopeId?: string,
) {
  return transitionVisit(sql, visitId, { version: undefined, location: input }, context, representativeScopeId, "CHECKED_IN");
}

export async function checkOutFieldVisitPostgres(
  sql: Sql,
  visitId: string,
  input: FieldVisitLocationInput & { readonly version: number },
  context: FieldVisitCommandContext,
  representativeScopeId?: string,
) {
  return transitionVisit(sql, visitId, { version: input.version, location: input }, context, representativeScopeId, "CHECKED_OUT");
}

export async function submitFieldVisitPostgres(
  sql: Sql,
  visitId: string,
  input: SubmitFieldVisitInput,
  context: FieldVisitCommandContext,
  representativeScopeId?: string,
) {
  return transitionVisit(sql, visitId, { version: input.version, submit: input }, context, representativeScopeId, "SUBMITTED");
}

export async function verifyFieldVisitPostgres(
  sql: Sql,
  visitId: string,
  input: FieldVisitTransitionInput,
  context: FieldVisitCommandContext,
) {
  return transitionVisit(sql, visitId, { version: input.version, reason: input.reason }, context, undefined, "VERIFIED");
}

export async function returnFieldVisitPostgres(
  sql: Sql,
  visitId: string,
  input: FieldVisitTransitionInput,
  context: FieldVisitCommandContext,
) {
  if (!input.reason) throw new FieldVisitBusinessRuleError("سبب إعادة الزيارة مطلوب.");
  return transitionVisit(sql, visitId, { version: input.version, reason: input.reason }, context, undefined, "RETURNED");
}

export async function cancelFieldVisitPostgres(
  sql: Sql,
  visitId: string,
  input: FieldVisitTransitionInput,
  context: FieldVisitCommandContext,
  representativeScopeId?: string,
) {
  if (!input.reason) throw new FieldVisitBusinessRuleError("سبب إلغاء الزيارة مطلوب.");
  return transitionVisit(sql, visitId, { version: input.version, reason: input.reason }, context, representativeScopeId, "CANCELLED");
}

export async function addFieldVisitOutcomePostgres(
  sql: Sql,
  visitId: string,
  input: AddFieldVisitOutcomeInput,
  context: FieldVisitCommandContext,
  representativeScopeId?: string,
): Promise<{ readonly outcome: FieldVisitOutcome; readonly replayed: boolean }> {
  return sql.begin(async (transaction) => {
    await requireFieldVisitPostgres(transaction, visitId, representativeScopeId, true);
    const existing = await findOutcomeByIdempotency(transaction, context.idempotencyKey, true);
    const payload = outcomePayload(visitId, input);
    if (existing) {
      if (!sameOutcomePayload(existing, payload)) throw new FieldVisitIdempotencyConflictError();
      return Object.freeze({ outcome: existing, replayed: true });
    }
    const rows = await transaction.unsafe<{ id: string }[]>(
      `INSERT INTO field_visit_outcomes (
         visit_id, outcome_type, collection_id, promise_id, reference_id,
         currency_code, amount_minor, summary, details, recorded_by,
         request_id, idempotency_key
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
       RETURNING id`,
      [visitId, input.outcomeType, input.collectionId ?? null, input.promiseId ?? null,
       input.referenceId ?? null, input.currencyCode ?? null, input.amountMinor ?? null,
       input.summary, transaction.json((input.details ?? {}) as never), context.actor.id,
       context.request.requestId, context.idempotencyKey],
    );
    const outcome = await requireOutcome(transaction, rows[0]?.id);
    await insertEvent(transaction, visitId, "OUTCOME_ADDED", context, {}, outcomeSnapshot(outcome), null);
    return Object.freeze({ outcome, replayed: false });
  });
}

export async function addFieldVisitEvidencePostgres(
  sql: Sql,
  visitId: string,
  input: AddFieldVisitEvidenceInput,
  context: FieldVisitCommandContext,
  representativeScopeId?: string,
): Promise<{ readonly evidence: FieldVisitEvidence; readonly replayed: boolean }> {
  return sql.begin(async (transaction) => {
    await requireFieldVisitPostgres(transaction, visitId, representativeScopeId, true);
    const existing = await findEvidenceByIdempotency(transaction, context.idempotencyKey, true);
    if (existing) {
      if (existing.visitId !== visitId || existing.uploadedFileId !== input.uploadedFileId || existing.evidenceType !== input.evidenceType || existing.caption !== (input.caption ?? null)) {
        throw new FieldVisitIdempotencyConflictError();
      }
      return Object.freeze({ evidence: existing, replayed: true });
    }
    const rows = await transaction.unsafe<{ id: string }[]>(
      `INSERT INTO field_visit_evidence (
         visit_id, uploaded_file_id, evidence_type, caption,
         recorded_by, request_id, idempotency_key
       ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [visitId, input.uploadedFileId, input.evidenceType, input.caption ?? null,
       context.actor.id, context.request.requestId, context.idempotencyKey],
    );
    const evidence = await requireEvidence(transaction, rows[0]?.id);
    await insertEvent(transaction, visitId, "EVIDENCE_ADDED", context, {}, evidenceSnapshot(evidence), null);
    return Object.freeze({ evidence, replayed: false });
  });
}

export async function recordDailyPlanItemResultPostgres(
  sql: Sql,
  input: RecordPlanItemResultInput,
  context: FieldVisitCommandContext,
  representativeScopeId?: string,
): Promise<{ readonly result: DailyPlanItemExecutionResult; readonly replayed: boolean }> {
  return sql.begin(async (transaction) => {
    await lockPlanItemScope(transaction, input.planItemId, representativeScopeId);
    const existing = await findResultByIdempotency(transaction, context.idempotencyKey, true);
    if (existing) {
      if (!sameResultInput(existing, input)) throw new FieldVisitIdempotencyConflictError();
      return Object.freeze({ result: existing, replayed: true });
    }
    const rows = await transaction.unsafe<{ id: string }[]>(
      `INSERT INTO daily_plan_item_results (
         plan_item_id, visit_id, result_type, reason, next_action_at,
         recorded_by, request_id, idempotency_key, supersedes_result_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [input.planItemId, input.visitId ?? null, input.resultType, input.reason,
       input.nextActionAt ?? null, context.actor.id, context.request.requestId,
       context.idempotencyKey, input.supersedesResultId ?? null],
    );
    const result = await requireResult(transaction, rows[0]?.id);
    await insertAudit(transaction, null, "plans.item_result_recorded", context, {}, resultSnapshot(result), input.reason, input.planItemId);
    return Object.freeze({ result, replayed: false });
  });
}

interface TransitionCommand {
  readonly version?: number | undefined;
  readonly location?: FieldVisitLocationInput | undefined;
  readonly submit?: SubmitFieldVisitInput | undefined;
  readonly reason?: string | undefined;
}

async function transitionVisit(
  sql: Sql,
  visitId: string,
  command: TransitionCommand,
  context: FieldVisitCommandContext,
  representativeScopeId: string | undefined,
  eventType: "CHECKED_IN" | "CHECKED_OUT" | "SUBMITTED" | "VERIFIED" | "RETURNED" | "CANCELLED",
) {
  return sql.begin(async (transaction) => {
    const current = await requireFieldVisitPostgres(transaction, visitId, representativeScopeId, true);
    const payload = Object.freeze({ eventType, ...command, location: command.location ?? null, submit: command.submit ?? null });
    const replay = await findEventReplay(transaction, context.idempotencyKey, visitId, eventType, payload);
    if (replay) return Object.freeze({ visit: current, replayed: true });
    if (command.version !== undefined && current.version !== command.version) {
      throw new FieldVisitConflictError("تم تعديل الزيارة من عملية أخرى.");
    }
    const oldValues = visitSnapshot(current);
    const values = transitionValues(eventType, command, context);
    const rows = await transaction.unsafe<{ id: string }[]>(
      `UPDATE field_visits
       SET state = $1,
           arrived_at = COALESCE($2::timestamptz, arrived_at),
           departed_at = COALESCE($3::timestamptz, departed_at),
           device_arrived_at = COALESCE($4::timestamptz, device_arrived_at),
           device_departed_at = COALESCE($5::timestamptz, device_departed_at),
           checkin_latitude = COALESCE($6::numeric, checkin_latitude),
           checkin_longitude = COALESCE($7::numeric, checkin_longitude),
           checkin_accuracy_meters = COALESCE($8::numeric, checkin_accuracy_meters),
           checkout_latitude = COALESCE($9::numeric, checkout_latitude),
           checkout_longitude = COALESCE($10::numeric, checkout_longitude),
           checkout_accuracy_meters = COALESCE($11::numeric, checkout_accuracy_meters),
           sync_status = COALESCE($12::text, sync_status),
           sync_received_at = COALESCE($13::timestamptz, sync_received_at),
           declared_result = COALESCE($14::text, declared_result),
           outcome_summary = COALESCE($15, outcome_summary),
           submitted_by = COALESCE($16::uuid, submitted_by),
           submitted_at = COALESCE($17::timestamptz, submitted_at),
           verified_by = COALESCE($18::uuid, verified_by),
           verified_at = COALESCE($19::timestamptz, verified_at),
           cancelled_by = COALESCE($20::uuid, cancelled_by),
           cancelled_at = COALESCE($21::timestamptz, cancelled_at),
           cancellation_reason = COALESCE($22, cancellation_reason)
       WHERE id = $23::uuid
         AND ($24::integer IS NULL OR version = $24)
       RETURNING id`,
      [values.state, values.arrivedAt, values.departedAt, values.deviceArrivedAt,
       values.deviceDepartedAt, values.checkinLatitude, values.checkinLongitude,
       values.checkinAccuracyMeters, values.checkoutLatitude, values.checkoutLongitude,
       values.checkoutAccuracyMeters, values.syncStatus, values.syncReceivedAt,
       values.declaredResult, values.outcomeSummary, values.submittedBy, values.submittedAt,
       values.verifiedBy, values.verifiedAt, values.cancelledBy, values.cancelledAt,
       values.cancellationReason, visitId, command.version ?? null],
    );
    if (!rows[0]) throw new FieldVisitConflictError("تم تعديل الزيارة من عملية أخرى.");
    const visit = await requireFieldVisitPostgres(transaction, visitId, representativeScopeId);
    await insertEvent(transaction, visitId, eventType, context, oldValues, payload, command.reason ?? null);
    await insertAudit(transaction, visit, `visits.${eventType.toLowerCase()}`, context, oldValues, visitSnapshot(visit), command.reason ?? null);
    return Object.freeze({ visit, replayed: false });
  });
}

function transitionValues(eventType: string, command: TransitionCommand, context: FieldVisitCommandContext) {
  const now = new Date().toISOString();
  const location = command.location;
  return {
    state: eventType,
    arrivedAt: eventType === "CHECKED_IN" ? now : null,
    departedAt: eventType === "CHECKED_OUT" ? now : null,
    deviceArrivedAt: eventType === "CHECKED_IN" ? location?.deviceAt ?? null : null,
    deviceDepartedAt: eventType === "CHECKED_OUT" ? location?.deviceAt ?? null : null,
    checkinLatitude: eventType === "CHECKED_IN" ? location?.latitude ?? null : null,
    checkinLongitude: eventType === "CHECKED_IN" ? location?.longitude ?? null : null,
    checkinAccuracyMeters: eventType === "CHECKED_IN" ? location?.accuracyMeters ?? null : null,
    checkoutLatitude: eventType === "CHECKED_OUT" ? location?.latitude ?? null : null,
    checkoutLongitude: eventType === "CHECKED_OUT" ? location?.longitude ?? null : null,
    checkoutAccuracyMeters: eventType === "CHECKED_OUT" ? location?.accuracyMeters ?? null : null,
    syncStatus: location?.syncStatus ?? null,
    syncReceivedAt: location?.syncStatus && location.syncStatus !== "ONLINE" ? now : null,
    declaredResult: command.submit?.result ?? null,
    outcomeSummary: command.submit?.summary ?? null,
    submittedBy: eventType === "SUBMITTED" ? context.actor.id : null,
    submittedAt: eventType === "SUBMITTED" ? now : null,
    verifiedBy: eventType === "VERIFIED" ? context.actor.id : null,
    verifiedAt: eventType === "VERIFIED" ? now : null,
    cancelledBy: eventType === "CANCELLED" ? context.actor.id : null,
    cancelledAt: eventType === "CANCELLED" ? now : null,
    cancellationReason: eventType === "CANCELLED" ? command.reason ?? null : null,
  } as const;
}

async function findVisitByIdempotency(sql: SqlExecutor, key: string, lock: boolean) {
  const rows = await sql.unsafe<VisitRow[]>(
    `${visitSelect} WHERE visit.idempotency_key = $1 ${lock ? "FOR UPDATE OF visit" : ""}`,
    [key],
  );
  return rows[0] ? mapVisitRow(rows[0]) : null;
}

async function findEventReplay(sql: SqlExecutor, key: string, visitId: string, eventType: string, payload: Readonly<Record<string, unknown>>) {
  const rows = await sql.unsafe<{ visit_id: string; event_type: string; payload_matches: boolean }[]>(
    `SELECT visit_id, event_type, new_values = $2::jsonb AS payload_matches
     FROM field_visit_events WHERE idempotency_key = $1 FOR UPDATE`,
    [key, sql.json(payload as never)],
  );
  const row = rows[0];
  if (!row) return false;
  if (row.visit_id !== visitId || row.event_type !== eventType || !row.payload_matches) throw new FieldVisitIdempotencyConflictError();
  return true;
}

async function insertEvent(sql: SqlExecutor, visitId: string, eventType: FieldVisitEvent["eventType"], context: FieldVisitCommandContext, oldValues: Readonly<Record<string, unknown>>, newValues: Readonly<Record<string, unknown>>, reason: string | null) {
  try {
    await sql.unsafe(
      `INSERT INTO field_visit_events (
         visit_id, event_type, actor_user_id, request_id,
         old_values, new_values, reason, idempotency_key
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
      [visitId, eventType, context.actor.id, context.request.requestId,
       sql.json(oldValues as never), sql.json(newValues as never), reason, context.idempotencyKey],
    );
  } catch (error) {
    if (postgresCode(error) === "23505") throw new FieldVisitIdempotencyConflictError();
    throw error;
  }
}

async function insertAudit(sql: SqlExecutor, visit: FieldVisit | null, action: string, context: FieldVisitCommandContext, previousValues: Readonly<Record<string, unknown>>, newValues: Readonly<Record<string, unknown>>, reason: string | null, resourceId?: string) {
  await sql.unsafe(
    `INSERT INTO audit_logs (
       actor_user_id, actor_type, action, resource_type, resource_id,
       request_id, session_id, ip_address, user_agent, reason,
       previous_values, new_values, result, metadata
     ) VALUES ($1,'USER',$2,$3,$4,$5,$6,$7::inet,$8,$9,$10::jsonb,$11::jsonb,'SUCCESS',$12::jsonb)`,
    [context.actor.id, action, visit ? "FIELD_VISIT" : "DAILY_PLAN_ITEM_RESULT",
     resourceId ?? visit?.id ?? null, context.request.requestId, context.sessionId ?? null,
     context.request.ipAddress, context.request.userAgent, reason,
     sql.json(previousValues as never), sql.json(newValues as never),
     sql.json({ representativeId: visit?.representativeId ?? null, customerId: visit?.customerId ?? null } as never)],
  );
}

async function findOutcomeByIdempotency(sql: SqlExecutor, key: string, lock: boolean) {
  const rows = await sql.unsafe<OutcomeRow[]>(
    `SELECT outcome.*, actor.full_name AS recorded_by_name
     FROM field_visit_outcomes AS outcome JOIN users AS actor ON actor.id = outcome.recorded_by
     WHERE outcome.idempotency_key = $1 ${lock ? "FOR UPDATE OF outcome" : ""}`,
    [key],
  );
  return rows[0] ? mapOutcomeRow(rows[0]) : null;
}

async function requireOutcome(sql: SqlExecutor, id?: string) {
  if (!id) throw new FieldVisitConflictError("تعذر حفظ نتيجة الزيارة.");
  const rows = await sql.unsafe<OutcomeRow[]>(
    `SELECT outcome.*, actor.full_name AS recorded_by_name
     FROM field_visit_outcomes AS outcome JOIN users AS actor ON actor.id = outcome.recorded_by
     WHERE outcome.id = $1`, [id]);
  if (!rows[0]) throw new FieldVisitConflictError("تعذر قراءة نتيجة الزيارة.");
  return mapOutcomeRow(rows[0]);
}

async function findEvidenceByIdempotency(sql: SqlExecutor, key: string, lock: boolean) {
  const rows = await sql.unsafe<EvidenceRow[]>(
    `SELECT evidence.*, file.original_name AS file_name, file.media_type,
            actor.full_name AS recorded_by_name
     FROM field_visit_evidence AS evidence
     JOIN uploaded_files AS file ON file.id = evidence.uploaded_file_id
     JOIN users AS actor ON actor.id = evidence.recorded_by
     WHERE evidence.idempotency_key = $1 ${lock ? "FOR UPDATE OF evidence" : ""}`,
    [key],
  );
  return rows[0] ? mapEvidenceRow(rows[0]) : null;
}

async function requireEvidence(sql: SqlExecutor, id?: string) {
  if (!id) throw new FieldVisitConflictError("تعذر حفظ دليل الزيارة.");
  const rows = await sql.unsafe<EvidenceRow[]>(
    `SELECT evidence.*, file.original_name AS file_name, file.media_type,
            actor.full_name AS recorded_by_name
     FROM field_visit_evidence AS evidence
     JOIN uploaded_files AS file ON file.id = evidence.uploaded_file_id
     JOIN users AS actor ON actor.id = evidence.recorded_by
     WHERE evidence.id = $1`, [id]);
  if (!rows[0]) throw new FieldVisitConflictError("تعذر قراءة دليل الزيارة.");
  return mapEvidenceRow(rows[0]);
}

async function findResultByIdempotency(sql: SqlExecutor, key: string, lock: boolean) {
  const rows = await sql.unsafe<ResultRow[]>(
    `SELECT result.*, actor.full_name AS recorded_by_name
     FROM daily_plan_item_results AS result JOIN users AS actor ON actor.id = result.recorded_by
     WHERE result.idempotency_key = $1 ${lock ? "FOR UPDATE OF result" : ""}`,
    [key],
  );
  return rows[0] ? mapResultRow(rows[0]) : null;
}

async function requireResult(sql: SqlExecutor, id?: string) {
  if (!id) throw new FieldVisitConflictError("تعذر حفظ نتيجة عنصر الخطة.");
  const rows = await sql.unsafe<ResultRow[]>(
    `SELECT result.*, actor.full_name AS recorded_by_name
     FROM daily_plan_item_results AS result JOIN users AS actor ON actor.id = result.recorded_by
     WHERE result.id = $1`, [id]);
  if (!rows[0]) throw new FieldVisitConflictError("تعذر قراءة نتيجة عنصر الخطة.");
  return mapResultRow(rows[0]);
}

async function lockPlanItemScope(sql: SqlExecutor, itemId: string, representativeScopeId?: string) {
  const rows = await sql.unsafe<{ id: string }[]>(
    `SELECT item.id
     FROM daily_plan_items AS item
     JOIN daily_plans AS plan ON plan.id = item.plan_id
     WHERE item.id = $1::uuid
       AND ($2::uuid IS NULL OR plan.representative_id = $2::uuid)
     FOR UPDATE OF item, plan`, [itemId, representativeScopeId ?? null]);
  if (!rows[0]) throw new FieldVisitNotFoundError("عنصر الخطة غير موجود أو خارج نطاق المستخدم.");
}

function createPayload(representativeId: string, input: CreateFieldVisitInput) {
  return { representativeId, customerId: input.customerId, planId: input.planId ?? null,
    planItemId: input.planItemId ?? null, visitSource: input.planId ? "PLAN" : "OUT_OF_PLAN",
    visitType: input.visitType, objective: input.objective, outOfPlanReason: input.outOfPlanReason ?? null } as const;
}

function sameCreatePayload(visit: FieldVisit, payload: ReturnType<typeof createPayload>) {
  return visit.representativeId === payload.representativeId && visit.customerId === payload.customerId
    && visit.planId === payload.planId && visit.planItemId === payload.planItemId
    && visit.visitSource === payload.visitSource && visit.visitType === payload.visitType
    && visit.objective === payload.objective && visit.outOfPlanReason === payload.outOfPlanReason;
}

function outcomePayload(visitId: string, input: AddFieldVisitOutcomeInput) {
  return { visitId, outcomeType: input.outcomeType, collectionId: input.collectionId ?? null,
    promiseId: input.promiseId ?? null, referenceId: input.referenceId ?? null,
    currencyCode: input.currencyCode ?? null, amountMinor: input.amountMinor ?? null,
    summary: input.summary, details: input.details ?? {} } as const;
}

function sameOutcomePayload(outcome: FieldVisitOutcome, payload: ReturnType<typeof outcomePayload>) {
  return outcome.visitId === payload.visitId && outcome.outcomeType === payload.outcomeType
    && outcome.collectionId === payload.collectionId && outcome.promiseId === payload.promiseId
    && outcome.referenceId === payload.referenceId && outcome.currencyCode === payload.currencyCode
    && outcome.amountMinor === payload.amountMinor && outcome.summary === payload.summary
    && JSON.stringify(outcome.details) === JSON.stringify(payload.details);
}

function sameResultInput(result: DailyPlanItemExecutionResult, input: RecordPlanItemResultInput) {
  return result.planItemId === input.planItemId && result.visitId === (input.visitId ?? null)
    && result.resultType === input.resultType && result.reason === input.reason
    && result.nextActionAt === (input.nextActionAt ?? null)
    && result.supersedesResultId === (input.supersedesResultId ?? null);
}

function mapVisitRow(row: VisitRow): FieldVisit {
  return Object.freeze({
    id: row.id, representativeId: row.representative_id, representativeName: row.representative_name,
    customerId: row.customer_id, customerName: row.customer_name, customerNumber: row.customer_number,
    planId: row.plan_id, planItemId: row.plan_item_id, visitSource: row.visit_source,
    state: row.state, visitType: row.visit_type, objective: row.objective,
    declaredResult: row.declared_result, outcomeSummary: row.outcome_summary,
    arrivedAt: nullableIso(row.arrived_at), departedAt: nullableIso(row.departed_at),
    deviceArrivedAt: nullableIso(row.device_arrived_at), deviceDepartedAt: nullableIso(row.device_departed_at),
    checkinLatitude: nullableNumber(row.checkin_latitude), checkinLongitude: nullableNumber(row.checkin_longitude),
    checkinAccuracyMeters: nullableNumber(row.checkin_accuracy_meters),
    checkoutLatitude: nullableNumber(row.checkout_latitude), checkoutLongitude: nullableNumber(row.checkout_longitude),
    checkoutAccuracyMeters: nullableNumber(row.checkout_accuracy_meters), syncStatus: row.sync_status,
    syncReceivedAt: nullableIso(row.sync_received_at), outOfPlanReason: row.out_of_plan_reason,
    createdBy: row.created_by, createdByName: row.created_by_name, createdAt: iso(row.created_at),
    submittedBy: row.submitted_by, submittedAt: nullableIso(row.submitted_at),
    verifiedBy: row.verified_by, verifiedAt: nullableIso(row.verified_at),
    cancelledBy: row.cancelled_by, cancelledAt: nullableIso(row.cancelled_at),
    cancellationReason: row.cancellation_reason, version: safeInteger(row.version, "visit version"),
    updatedAt: iso(row.updated_at), outcomeCount: safeInteger(row.outcome_count, "outcome count"),
    qualifyingOutcomeCount: safeInteger(row.qualifying_outcome_count, "qualifying outcome count"),
    evidenceCount: safeInteger(row.evidence_count, "evidence count"),
  });
}

function mapOutcomeRow(row: OutcomeRow): FieldVisitOutcome {
  return Object.freeze({ id: row.id, visitId: row.visit_id, outcomeType: row.outcome_type,
    collectionId: row.collection_id, promiseId: row.promise_id, referenceId: row.reference_id,
    currencyCode: row.currency_code, amountMinor: nullableSafeInteger(row.amount_minor, "outcome amount"),
    summary: row.summary, details: Object.freeze({ ...row.details }), qualifiesSuccess: row.qualifies_success,
    recordedBy: row.recorded_by, recordedByName: row.recorded_by_name, recordedAt: iso(row.recorded_at) });
}

function mapEvidenceRow(row: EvidenceRow): FieldVisitEvidence {
  return Object.freeze({ id: row.id, visitId: row.visit_id, uploadedFileId: row.uploaded_file_id,
    fileName: row.file_name, mediaType: row.media_type, evidenceType: row.evidence_type,
    caption: row.caption, recordedBy: row.recorded_by, recordedByName: row.recorded_by_name,
    recordedAt: iso(row.recorded_at) });
}

function mapEventRow(row: EventRow): FieldVisitEvent {
  return Object.freeze({ id: row.id, visitId: row.visit_id, eventType: row.event_type,
    actorUserId: row.actor_user_id, actorName: row.actor_name, occurredAt: iso(row.occurred_at),
    oldValues: Object.freeze({ ...row.old_values }), newValues: Object.freeze({ ...row.new_values }), reason: row.reason });
}

function mapResultRow(row: ResultRow): DailyPlanItemExecutionResult {
  return Object.freeze({ id: row.id, planItemId: row.plan_item_id, visitId: row.visit_id,
    resultType: row.result_type, reason: row.reason, nextActionAt: nullableIso(row.next_action_at),
    recordedBy: row.recorded_by, recordedByName: row.recorded_by_name,
    recordedAt: iso(row.recorded_at), supersedesResultId: row.supersedes_result_id });
}

function visitSnapshot(visit: FieldVisit) {
  return { id: visit.id, state: visit.state, representativeId: visit.representativeId,
    customerId: visit.customerId, planId: visit.planId, planItemId: visit.planItemId,
    declaredResult: visit.declaredResult, version: visit.version } as const;
}
function outcomeSnapshot(outcome: FieldVisitOutcome) { return { id: outcome.id, type: outcome.outcomeType, referenceId: outcome.referenceId, currencyCode: outcome.currencyCode, amountMinor: outcome.amountMinor } as const; }
function evidenceSnapshot(evidence: FieldVisitEvidence) { return { id: evidence.id, uploadedFileId: evidence.uploadedFileId, evidenceType: evidence.evidenceType } as const; }
function resultSnapshot(result: DailyPlanItemExecutionResult) { return { id: result.id, planItemId: result.planItemId, visitId: result.visitId, resultType: result.resultType, supersedesResultId: result.supersedesResultId } as const; }

function iso(value: string | Date) { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function nullableIso(value: string | Date | null) { return value === null ? null : iso(value); }
function nullableNumber(value: string | number | null) { if (value === null) return null; const number = Number(value); if (!Number.isFinite(number)) throw new Error("invalid numeric database value"); return number; }
function safeInteger(value: string | number, label: string) { const number = Number(value); if (!Number.isSafeInteger(number)) throw new Error(`${label} is outside safe integer range`); return number; }
function nullableSafeInteger(value: string | number | null, label: string) { return value === null ? null : safeInteger(value, label); }
function postgresCode(error: unknown) { if (!error || typeof error !== "object") return null; const code = (error as { code?: unknown }).code; return typeof code === "string" ? code : null; }
