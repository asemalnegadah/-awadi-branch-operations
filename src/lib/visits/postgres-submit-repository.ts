import type { Sql, TransactionSql } from "postgres";

import {
  FieldVisitBusinessRuleError,
  FieldVisitConflictError,
  FieldVisitIdempotencyConflictError,
} from "./errors";
import {
  requireFieldVisitPostgres,
} from "./postgres-repository";
import type {
  FieldVisit,
  FieldVisitCommandContext,
  SubmitFieldVisitInput,
} from "./types";

type SqlExecutor = Sql | TransactionSql;

export async function submitFieldVisitSafelyPostgres(
  sql: Sql,
  visitId: string,
  input: SubmitFieldVisitInput,
  context: FieldVisitCommandContext,
  representativeScopeId?: string,
): Promise<{ readonly visit: FieldVisit; readonly replayed: boolean }> {
  return sql.begin(async (transaction) => {
    const current = await requireFieldVisitPostgres(
      transaction,
      visitId,
      representativeScopeId,
      true,
    );
    const payload = Object.freeze({
      eventType: "SUBMITTED",
      version: input.version,
      result: input.result,
      summary: input.summary,
    });
    if (await findReplay(transaction, context.idempotencyKey, visitId, payload)) {
      return Object.freeze({ visit: current, replayed: true });
    }
    if (current.version !== input.version) {
      throw new FieldVisitConflictError("تم تعديل الزيارة من عملية أخرى.");
    }
    if (!(["CHECKED_OUT", "RETURNED"] as const).includes(current.state as "CHECKED_OUT" | "RETURNED")) {
      throw new FieldVisitBusinessRuleError("لا يمكن إرسال الزيارة من حالتها الحالية.");
    }

    const rows = await transaction.unsafe<{ id: string }[]>(
      `UPDATE field_visits
       SET state = 'SUBMITTED',
           declared_result = $1,
           outcome_summary = $2,
           submitted_by = COALESCE(submitted_by, $3::uuid),
           submitted_at = COALESCE(submitted_at, now())
       WHERE id = $4::uuid
         AND version = $5
       RETURNING id`,
      [input.result, input.summary, context.actor.id, visitId, input.version],
    );
    if (!rows[0]) throw new FieldVisitConflictError("تم تعديل الزيارة من عملية أخرى.");

    const visit = await requireFieldVisitPostgres(
      transaction,
      visitId,
      representativeScopeId,
    );
    await insertSubmissionEvent(transaction, visitId, payload, context);
    await insertSubmissionAudit(transaction, current, visit, context);
    return Object.freeze({ visit, replayed: false });
  });
}

async function findReplay(
  sql: SqlExecutor,
  idempotencyKey: string,
  visitId: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  const rows = await sql.unsafe<{
    visit_id: string;
    event_type: string;
    payload_matches: boolean;
  }[]>(
    `SELECT visit_id, event_type, new_values = $2::jsonb AS payload_matches
     FROM field_visit_events
     WHERE idempotency_key = $1
     FOR UPDATE`,
    [idempotencyKey, sql.json(payload as never)],
  );
  const row = rows[0];
  if (!row) return false;
  if (row.visit_id !== visitId || row.event_type !== "SUBMITTED" || !row.payload_matches) {
    throw new FieldVisitIdempotencyConflictError();
  }
  return true;
}

async function insertSubmissionEvent(
  sql: SqlExecutor,
  visitId: string,
  payload: Readonly<Record<string, unknown>>,
  context: FieldVisitCommandContext,
): Promise<void> {
  try {
    await sql.unsafe(
      `INSERT INTO field_visit_events (
         visit_id, event_type, actor_user_id, request_id,
         old_values, new_values, idempotency_key
       ) VALUES ($1, 'SUBMITTED', $2, $3, '{}'::jsonb, $4::jsonb, $5)`,
      [visitId, context.actor.id, context.request.requestId,
       sql.json(payload as never), context.idempotencyKey],
    );
  } catch (error) {
    if (postgresCode(error) === "23505") throw new FieldVisitIdempotencyConflictError();
    throw error;
  }
}

async function insertSubmissionAudit(
  sql: SqlExecutor,
  previous: FieldVisit,
  visit: FieldVisit,
  context: FieldVisitCommandContext,
): Promise<void> {
  await sql.unsafe(
    `INSERT INTO audit_logs (
       actor_user_id, actor_type, action, resource_type, resource_id,
       request_id, session_id, ip_address, user_agent,
       previous_values, new_values, result, metadata
     ) VALUES ($1, 'USER', 'visits.submitted', 'FIELD_VISIT', $2,
       $3, $4, $5::inet, $6, $7::jsonb, $8::jsonb, 'SUCCESS', $9::jsonb)`,
    [context.actor.id, visit.id, context.request.requestId, context.sessionId ?? null,
     context.request.ipAddress, context.request.userAgent,
     sql.json({ state: previous.state, version: previous.version } as never),
     sql.json({ state: visit.state, result: visit.declaredResult, version: visit.version } as never),
     sql.json({ firstSubmittedBy: visit.submittedBy, firstSubmittedAt: visit.submittedAt } as never)],
  );
}

function postgresCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}
