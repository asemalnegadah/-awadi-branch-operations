import { createHash } from "node:crypto";

import type { Sql, TransactionSql } from "postgres";

type SqlExecutor = Sql | TransactionSql;

import {
  DailyPlanBusinessRuleError,
  DailyPlanConflictError,
  DailyPlanIdempotencyConflictError,
  DailyPlanNotFoundError,
} from "./errors";
import { buildDailyPlan } from "./scoring";
import {
  DAILY_PLAN_RULESET_VERSION,
  type DailyPlan,
  type DailyPlanCandidateInput,
  type DailyPlanCommandContext,
  type DailyPlanDetails,
  type DailyPlanItem,
  type GenerateDailyPlanInput,
  type PlannedDailyPlanCandidate,
} from "./types";

interface ServerClockRow {
  cutoff_at: string | Date;
  local_date: string | Date;
}

interface CandidateRow {
  customer_id: string;
  customer_name: string;
  customer_number: string | null;
  lifecycle_status: DailyPlanCandidateInput["lifecycleStatus"];
  area_id: string | null;
  route_id: string | null;
  route_name: string | null;
  estimated_travel_minutes: string | number | null;
  estimated_visit_minutes: string | number | null;
  outstanding_sr_minor: string | number;
  outstanding_rg_minor: string | number;
  overdue_31_60_sr_minor: string | number;
  overdue_31_60_rg_minor: string | number;
  overdue_61_90_sr_minor: string | number;
  overdue_61_90_rg_minor: string | number;
  overdue_91_180_sr_minor: string | number;
  overdue_91_180_rg_minor: string | number;
  overdue_over_180_sr_minor: string | number;
  overdue_over_180_rg_minor: string | number;
  promise_id: string | null;
  promise_currency_code: "SR" | "RG" | null;
  promise_remaining_amount_minor: string | number | null;
  promise_due_date: string | Date | null;
  promise_temporal_status: "OVERDUE" | "DUE_TODAY" | "UPCOMING" | null;
  risk_signals: Array<{
    currencyCode: "SR" | "RG";
    score: number;
    riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    hasActiveRestriction: boolean;
  }> | null;
  manager_priority: string | number | null;
}

interface PlanRow {
  id: string;
  representative_id: string;
  representative_name: string;
  plan_date: string | Date;
  state: DailyPlan["state"];
  generation_mode: DailyPlan["generationMode"];
  cutoff_at: string | Date;
  ruleset_version: string;
  source_snapshot: Readonly<Record<string, unknown>>;
  input_fingerprint: string;
  target_collection_sr_minor: string | number;
  target_collection_rg_minor: string | number;
  target_sales_sr_minor: string | number;
  target_sales_rg_minor: string | number;
  fuel_budget_currency_code: "SR" | "RG" | null;
  fuel_budget_minor: string | number | null;
  estimated_work_minutes: string | number;
  notes: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string | Date;
  submitted_by: string | null;
  submitted_at: string | Date | null;
  approved_by: string | null;
  approved_at: string | Date | null;
  rejected_by: string | null;
  rejected_at: string | Date | null;
  rejection_reason: string | null;
  started_by: string | null;
  started_at: string | Date | null;
  completed_by: string | null;
  completed_at: string | Date | null;
  cancelled_by: string | null;
  cancelled_at: string | Date | null;
  cancellation_reason: string | null;
  version: string | number;
  updated_at: string | Date;
  idempotency_key: string;
  generation_request_matches?: boolean;
}

interface ItemRow {
  id: string;
  plan_id: string;
  sequence_number: string | number;
  customer_id: string;
  customer_name: string;
  customer_number: string | null;
  linked_promise_id: string | null;
  task_type: DailyPlanItem["taskType"];
  priority_level: DailyPlanItem["priorityLevel"];
  priority_score: string | number;
  selection_reason: string;
  objective: string;
  expected_result: string;
  target_collection_sr_minor: string | number;
  target_collection_rg_minor: string | number;
  target_sales_sr_minor: string | number;
  target_sales_rg_minor: string | number;
  area_id: string | null;
  area_name: string | null;
  route_id: string | null;
  route_name: string | null;
  estimated_visit_minutes: string | number;
  estimated_travel_minutes: string | number;
  manual_override: boolean;
  version: string | number;
}

const planSelect = `
  SELECT
    plan.*,
    representative.full_name_ar AS representative_name,
    creator.full_name AS created_by_name
  FROM daily_plans AS plan
  JOIN sales_representatives AS representative ON representative.id = plan.representative_id
  JOIN users AS creator ON creator.id = plan.created_by
`;

export async function generateDailyPlanPostgres(
  sql: Sql,
  input: GenerateDailyPlanInput,
  context: DailyPlanCommandContext,
): Promise<{ readonly details: DailyPlanDetails; readonly replayed: boolean }> {
  const generationRequest = generationRequestPayload(input);

  return sql.begin(async (transaction) => {
    const clockRows = await transaction.unsafe<ServerClockRow[]>(
      `SELECT now() AS cutoff_at, (now() AT TIME ZONE 'Asia/Aden')::date AS local_date`,
    );
    const clock = clockRows[0];
    if (!clock) throw new Error("failed to read server clock");
    const cutoffAt = iso(clock.cutoff_at);
    const localDate = dateOnly(clock.local_date);
    if (input.planDate < localDate) {
      throw new DailyPlanBusinessRuleError("لا يمكن توليد خطة ليوم مضى.");
    }

    const representativeRows = await transaction.unsafe<{ id: string }[]>(
      `
        SELECT id
        FROM sales_representatives
        WHERE id = $1::uuid
          AND status = 'ACTIVE'
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [input.representativeId],
    );
    if (!representativeRows[0]) {
      throw new DailyPlanNotFoundError("لم يتم العثور على مندوب نشط لتوليد الخطة.");
    }

    const replay = await findPlanByIdempotencyKey(
      transaction,
      context.idempotencyKey,
      generationRequest,
      true,
    );
    if (replay) {
      assertPlanGenerationReplay(replay, input);
      return Object.freeze({
        details: await getGeneratedPlanDetails(transaction, replay.id),
        replayed: true,
      });
    }

    const openRows = await transaction.unsafe<{ id: string }[]>(
      `
        SELECT id
        FROM daily_plans
        WHERE representative_id = $1::uuid
          AND plan_date = $2::date
          AND state NOT IN ('REJECTED', 'CANCELLED')
        LIMIT 1
        FOR UPDATE
      `,
      [input.representativeId, input.planDate],
    );
    if (openRows[0]) {
      throw new DailyPlanConflictError("توجد خطة مفتوحة للمندوب في هذا اليوم.");
    }

    const candidateInputs = await loadDailyPlanCandidateInputsPostgres(
      transaction,
      input.representativeId,
      input.planDate,
      cutoffAt,
    );
    if (candidateInputs.length === 0) {
      throw new DailyPlanBusinessRuleError("لا يوجد عملاء مكلفون للمندوب عند وقت قطع البيانات.");
    }

    const built = buildDailyPlan(candidateInputs, {
      maxItems: input.maxItems,
      workMinutesBudget: input.workMinutesBudget,
    });
    if (built.selected.length === 0) {
      throw new DailyPlanBusinessRuleError("لم ينتج عن القواعد أي عنصر صالح ضمن طاقة يوم العمل.");
    }

    const inputFingerprint = fingerprintGeneration(
      generationRequest,
      candidateInputs,
      cutoffAt,
    );
    const sourceSnapshot = Object.freeze({
      generationRequest,
      candidateCount: built.allCandidates.length,
      selectedCount: built.selected.length,
      excludedCount: built.excluded.length,
      missingDataPolicy: Object.freeze([
        "daysSinceLastVisit",
        "unresolvedReconciliationCount",
        "salesOpportunityScore",
      ]),
      currencyIsolation: "SR_AND_RG_TARGETS_ARE_SEPARATE",
    });

    const insertedPlanRows = await transaction.unsafe<{ id: string }[]>(
      `
        INSERT INTO daily_plans (
          representative_id,
          plan_date,
          generation_mode,
          cutoff_at,
          ruleset_version,
          source_snapshot,
          input_fingerprint,
          fuel_budget_currency_code,
          fuel_budget_minor,
          notes,
          created_by,
          idempotency_key
        ) VALUES (
          $1, $2, 'AUTO', $3, $4, $5::jsonb, $6,
          $7, $8, $9, $10, $11
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id
      `,
      [
        input.representativeId,
        input.planDate,
        cutoffAt,
        DAILY_PLAN_RULESET_VERSION,
        transaction.json(sourceSnapshot as never),
        inputFingerprint,
        input.fuelBudgetCurrencyCode ?? null,
        input.fuelBudgetMinor ?? null,
        input.notes ?? null,
        context.actor.id,
        context.idempotencyKey,
      ],
    );

    if (!insertedPlanRows[0]) {
      const raced = await findPlanByIdempotencyKey(
        transaction,
        context.idempotencyKey,
        generationRequest,
        true,
      );
      if (!raced) throw new DailyPlanIdempotencyConflictError();
      assertPlanGenerationReplay(raced, input);
      return Object.freeze({
        details: await getGeneratedPlanDetails(transaction, raced.id),
        replayed: true,
      });
    }

    const planId = insertedPlanRows[0].id;
    for (const candidate of built.allCandidates) {
      await insertCandidate(transaction, planId, candidate);
    }
    for (const candidate of built.selected) {
      await insertPlanItem(transaction, planId, candidate, context.actor.id);
    }

    const plan = await requirePlanById(transaction, planId);
    await insertGeneratedEvent(
      transaction,
      plan,
      context,
      generationRequest,
      built.selected.length,
      built.excluded.length,
    );
    await insertGenerationAudit(transaction, plan, context);

    return Object.freeze({
      details: await getGeneratedPlanDetails(transaction, planId),
      replayed: false,
    });
  });
}

export async function loadDailyPlanCandidateInputsPostgres(
  sql: SqlExecutor,
  representativeId: string,
  planDate: string,
  cutoffAt: string,
): Promise<readonly DailyPlanCandidateInput[]> {
  const rows = await sql.unsafe<CandidateRow[]>(
    `
      WITH assigned_customers AS (
        SELECT
          customer.id AS customer_id,
          customer.trade_name_ar AS customer_name,
          customer.customer_number,
          customer.lifecycle_status
        FROM customer_rep_assignments AS assignment
        JOIN customers AS customer ON customer.id = assignment.customer_id
        WHERE assignment.representative_id = $1::uuid
          AND assignment.valid_from <= $3::timestamptz
          AND (assignment.valid_until IS NULL OR assignment.valid_until > $3::timestamptz)
          AND customer.deleted_at IS NULL
          AND customer.merged_into_customer_id IS NULL
      ),
      assigned_accounts AS (
        SELECT account.*
        FROM customer_accounts AS account
        JOIN assigned_customers AS customer ON customer.customer_id = account.customer_id
      ),
      ledger_totals AS (
        SELECT
          account.id AS customer_account_id,
          COALESCE(SUM(entry.amount_minor) FILTER (WHERE entry.direction = 'DEBIT'), 0)::bigint AS total_debits,
          COALESCE(SUM(entry.amount_minor) FILTER (WHERE entry.direction = 'CREDIT'), 0)::bigint AS total_credits
        FROM assigned_accounts AS account
        LEFT JOIN customer_ledger_entries AS entry
          ON entry.customer_account_id = account.id
          AND entry.posted_at <= $3::timestamptz
        GROUP BY account.id
      ),
      debit_rows AS (
        SELECT
          entry.customer_account_id,
          entry.accounting_date,
          entry.posted_at,
          entry.id,
          entry.amount_minor,
          COALESCE(
            SUM(entry.amount_minor) OVER (
              PARTITION BY entry.customer_account_id
              ORDER BY entry.accounting_date ASC, entry.posted_at ASC, entry.id ASC
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ),
            0
          )::bigint AS older_debit_total
        FROM customer_ledger_entries AS entry
        JOIN assigned_accounts AS account ON account.id = entry.customer_account_id
        WHERE entry.direction = 'DEBIT'
          AND entry.posted_at <= $3::timestamptz
      ),
      remaining_debits AS (
        SELECT
          debit.customer_account_id,
          debit.accounting_date,
          GREATEST(
            LEAST(
              debit.amount_minor,
              GREATEST(ledger.total_debits - ledger.total_credits, 0) - debit.older_debit_total
            ),
            0
          )::bigint AS remaining_minor
        FROM debit_rows AS debit
        JOIN ledger_totals AS ledger ON ledger.customer_account_id = debit.customer_account_id
      ),
      aging_by_account AS (
        SELECT
          account.id AS customer_account_id,
          account.customer_id,
          account.currency_code,
          GREATEST(ledger.total_debits - ledger.total_credits, 0)::bigint AS outstanding_minor,
          COALESCE(SUM(remaining.remaining_minor) FILTER (
            WHERE ($2::date - remaining.accounting_date) BETWEEN 31 AND 60
          ), 0)::bigint AS overdue_31_60_minor,
          COALESCE(SUM(remaining.remaining_minor) FILTER (
            WHERE ($2::date - remaining.accounting_date) BETWEEN 61 AND 90
          ), 0)::bigint AS overdue_61_90_minor,
          COALESCE(SUM(remaining.remaining_minor) FILTER (
            WHERE ($2::date - remaining.accounting_date) BETWEEN 91 AND 180
          ), 0)::bigint AS overdue_91_180_minor,
          COALESCE(SUM(remaining.remaining_minor) FILTER (
            WHERE ($2::date - remaining.accounting_date) > 180
          ), 0)::bigint AS overdue_over_180_minor
        FROM assigned_accounts AS account
        JOIN ledger_totals AS ledger ON ledger.customer_account_id = account.id
        LEFT JOIN remaining_debits AS remaining ON remaining.customer_account_id = account.id
        GROUP BY account.id, account.customer_id, account.currency_code, ledger.total_debits, ledger.total_credits
      ),
      money_by_customer AS (
        SELECT
          customer_id,
          COALESCE(MAX(outstanding_minor) FILTER (WHERE currency_code = 'SR'), 0)::bigint AS outstanding_sr_minor,
          COALESCE(MAX(outstanding_minor) FILTER (WHERE currency_code = 'RG'), 0)::bigint AS outstanding_rg_minor,
          COALESCE(MAX(overdue_31_60_minor) FILTER (WHERE currency_code = 'SR'), 0)::bigint AS overdue_31_60_sr_minor,
          COALESCE(MAX(overdue_31_60_minor) FILTER (WHERE currency_code = 'RG'), 0)::bigint AS overdue_31_60_rg_minor,
          COALESCE(MAX(overdue_61_90_minor) FILTER (WHERE currency_code = 'SR'), 0)::bigint AS overdue_61_90_sr_minor,
          COALESCE(MAX(overdue_61_90_minor) FILTER (WHERE currency_code = 'RG'), 0)::bigint AS overdue_61_90_rg_minor,
          COALESCE(MAX(overdue_91_180_minor) FILTER (WHERE currency_code = 'SR'), 0)::bigint AS overdue_91_180_sr_minor,
          COALESCE(MAX(overdue_91_180_minor) FILTER (WHERE currency_code = 'RG'), 0)::bigint AS overdue_91_180_rg_minor,
          COALESCE(MAX(overdue_over_180_minor) FILTER (WHERE currency_code = 'SR'), 0)::bigint AS overdue_over_180_sr_minor,
          COALESCE(MAX(overdue_over_180_minor) FILTER (WHERE currency_code = 'RG'), 0)::bigint AS overdue_over_180_rg_minor
        FROM aging_by_account
        GROUP BY customer_id
      ),
      promise_ranked AS (
        SELECT
          promise.*,
          ROW_NUMBER() OVER (
            PARTITION BY promise.customer_id
            ORDER BY
              CASE
                WHEN promise.due_date < $2::date THEN 0
                WHEN promise.due_date = $2::date THEN 1
                ELSE 2
              END,
              promise.due_date ASC,
              promise.remaining_amount_minor DESC,
              promise.id ASC
          ) AS row_number
        FROM payment_promises AS promise
        JOIN assigned_customers AS customer ON customer.customer_id = promise.customer_id
        WHERE promise.representative_id = $1::uuid
          AND promise.base_status IN ('NEW', 'UPCOMING', 'PARTIALLY_FULFILLED')
          AND promise.created_at <= $3::timestamptz
      ),
      selected_promise AS (
        SELECT * FROM promise_ranked WHERE row_number = 1
      ),
      risk_signals AS (
        SELECT
          account.customer_id,
          jsonb_agg(
            jsonb_build_object(
              'currencyCode', account.currency_code,
              'score', assessment.score,
              'riskLevel', assessment.risk_level,
              'hasActiveRestriction', EXISTS (
                SELECT 1
                FROM credit_restrictions AS restriction
                WHERE restriction.customer_account_id = account.id
                  AND restriction.state = 'ACTIVE'
                  AND restriction.effective_from <= $3::timestamptz
                  AND (restriction.expires_at IS NULL OR restriction.expires_at > $3::timestamptz)
              )
            )
            ORDER BY account.currency_code
          ) FILTER (WHERE assessment.id IS NOT NULL) AS signals
        FROM assigned_accounts AS account
        LEFT JOIN current_credit_risk_assessments AS assessment
          ON assessment.customer_account_id = account.id
          AND assessment.cutoff_at <= $3::timestamptz
        GROUP BY account.customer_id
      )
      SELECT
        customer.customer_id,
        customer.customer_name,
        customer.customer_number,
        customer.lifecycle_status,
        COALESCE(route.area_id, location.area_id) AS area_id,
        route.id AS route_id,
        route.name_ar AS route_name,
        route.estimated_travel_minutes,
        route.default_visit_minutes AS estimated_visit_minutes,
        COALESCE(money.outstanding_sr_minor, 0)::bigint AS outstanding_sr_minor,
        COALESCE(money.outstanding_rg_minor, 0)::bigint AS outstanding_rg_minor,
        COALESCE(money.overdue_31_60_sr_minor, 0)::bigint AS overdue_31_60_sr_minor,
        COALESCE(money.overdue_31_60_rg_minor, 0)::bigint AS overdue_31_60_rg_minor,
        COALESCE(money.overdue_61_90_sr_minor, 0)::bigint AS overdue_61_90_sr_minor,
        COALESCE(money.overdue_61_90_rg_minor, 0)::bigint AS overdue_61_90_rg_minor,
        COALESCE(money.overdue_91_180_sr_minor, 0)::bigint AS overdue_91_180_sr_minor,
        COALESCE(money.overdue_91_180_rg_minor, 0)::bigint AS overdue_91_180_rg_minor,
        COALESCE(money.overdue_over_180_sr_minor, 0)::bigint AS overdue_over_180_sr_minor,
        COALESCE(money.overdue_over_180_rg_minor, 0)::bigint AS overdue_over_180_rg_minor,
        promise.id AS promise_id,
        promise.currency_code AS promise_currency_code,
        promise.remaining_amount_minor AS promise_remaining_amount_minor,
        promise.due_date AS promise_due_date,
        CASE
          WHEN promise.id IS NULL THEN NULL
          WHEN promise.due_date < $2::date THEN 'OVERDUE'
          WHEN promise.due_date = $2::date THEN 'DUE_TODAY'
          ELSE 'UPCOMING'
        END AS promise_temporal_status,
        risk.signals AS risk_signals,
        COALESCE((
          SELECT MAX(priority.priority)
          FROM planning_priority_overrides AS priority
          WHERE priority.customer_id = customer.customer_id
            AND priority.state = 'ACTIVE'
            AND $2::date BETWEEN priority.valid_from AND priority.valid_until
            AND (priority.representative_id IS NULL OR priority.representative_id = $1::uuid)
        ), 0)::integer AS manager_priority
      FROM assigned_customers AS customer
      LEFT JOIN money_by_customer AS money ON money.customer_id = customer.customer_id
      LEFT JOIN selected_promise AS promise ON promise.customer_id = customer.customer_id
      LEFT JOIN risk_signals AS risk ON risk.customer_id = customer.customer_id
      LEFT JOIN LATERAL (
        SELECT route_record.*
        FROM customer_route_assignments AS assignment
        JOIN routes AS route_record ON route_record.id = assignment.route_id
        WHERE assignment.customer_id = customer.customer_id
          AND assignment.valid_from <= $3::timestamptz
          AND (assignment.valid_until IS NULL OR assignment.valid_until > $3::timestamptz)
          AND route_record.is_active = true
        ORDER BY
          CASE assignment.assignment_type WHEN 'PRIMARY' THEN 0 WHEN 'TEMPORARY' THEN 1 ELSE 2 END,
          assignment.valid_from DESC,
          assignment.id DESC
        LIMIT 1
      ) AS route ON true
      LEFT JOIN LATERAL (
        SELECT location_record.*
        FROM customer_locations AS location_record
        WHERE location_record.customer_id = customer.customer_id
          AND location_record.deleted_at IS NULL
        ORDER BY location_record.is_primary DESC, location_record.created_at DESC, location_record.id DESC
        LIMIT 1
      ) AS location ON true
      ORDER BY customer.customer_id ASC
    `,
    [representativeId, planDate, cutoffAt],
  );

  return Object.freeze(rows.map((row) => mapCandidateRow(row, representativeId)));
}

async function insertCandidate(
  transaction: SqlExecutor,
  planId: string,
  candidate: PlannedDailyPlanCandidate,
): Promise<void> {
  await transaction.unsafe(
    `
      INSERT INTO daily_plan_candidates (
        plan_id,
        customer_id,
        route_id,
        area_id,
        computed_score,
        selected,
        selection_rank,
        decision_reason,
        exclusion_reason,
        factors,
        source_snapshot,
        linked_promise_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10::jsonb, $11::jsonb, $12
      )
    `,
    [
      planId,
      candidate.input.customerId,
      candidate.input.routeId,
      candidate.input.areaId,
      candidate.score,
      candidate.selected,
      candidate.selectionRank,
      candidate.selectionReason,
      candidate.finalExclusionReason,
      transaction.json(candidate.factors as never),
      transaction.json(candidateSnapshot(candidate) as never),
      candidate.input.promise?.id ?? null,
    ],
  );
}

async function insertPlanItem(
  transaction: SqlExecutor,
  planId: string,
  candidate: PlannedDailyPlanCandidate,
  actorUserId: string,
): Promise<void> {
  if (!candidate.selected || candidate.selectionRank === null) {
    throw new Error("cannot insert an unselected daily plan item");
  }
  await transaction.unsafe(
    `
      INSERT INTO daily_plan_items (
        plan_id,
        sequence_number,
        customer_id,
        linked_promise_id,
        task_type,
        priority_level,
        priority_score,
        selection_reason,
        objective,
        expected_result,
        target_collection_sr_minor,
        target_collection_rg_minor,
        target_sales_sr_minor,
        target_sales_rg_minor,
        area_id,
        route_id,
        estimated_visit_minutes,
        estimated_travel_minutes,
        created_by,
        updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $19
      )
    `,
    [
      planId,
      candidate.selectionRank,
      candidate.input.customerId,
      candidate.input.promise?.id ?? null,
      candidate.taskType,
      candidate.priorityLevel,
      candidate.score,
      candidate.selectionReason,
      candidate.objective,
      candidate.expectedResult,
      candidate.targetCollectionMinor.SR,
      candidate.targetCollectionMinor.RG,
      candidate.targetSalesMinor.SR,
      candidate.targetSalesMinor.RG,
      candidate.input.areaId,
      candidate.input.routeId,
      candidate.input.estimatedVisitMinutes,
      candidate.input.estimatedTravelMinutes,
      actorUserId,
    ],
  );
}

async function findPlanByIdempotencyKey(
  sql: SqlExecutor,
  key: string,
  generationRequest: Readonly<Record<string, unknown>>,
  lock: boolean,
): Promise<PlanRow | null> {
  const rows = await sql.unsafe<PlanRow[]>(
    `${planSelect}
     WHERE plan.idempotency_key = $1
     ${lock ? "FOR UPDATE OF plan" : ""}`,
    [key],
  );
  const row = rows[0];
  if (!row) return null;
  const storedRequest = row.source_snapshot.generationRequest;
  row.generation_request_matches =
    JSON.stringify(storedRequest) === JSON.stringify(generationRequest);
  return row;
}

function assertPlanGenerationReplay(row: PlanRow, input: GenerateDailyPlanInput): void {
  if (
    row.representative_id !== input.representativeId
    || dateOnly(row.plan_date) !== input.planDate
    || row.generation_request_matches !== true
  ) {
    throw new DailyPlanIdempotencyConflictError();
  }
}

async function getGeneratedPlanDetails(
  sql: SqlExecutor,
  planId: string,
): Promise<DailyPlanDetails> {
  const plan = await requirePlanById(sql, planId);
  const itemRows = await sql.unsafe<ItemRow[]>(
    `
      SELECT
        item.*,
        customer.trade_name_ar AS customer_name,
        customer.customer_number,
        area.name_ar AS area_name,
        route.name_ar AS route_name
      FROM daily_plan_items AS item
      JOIN customers AS customer ON customer.id = item.customer_id
      LEFT JOIN areas AS area ON area.id = item.area_id
      LEFT JOIN routes AS route ON route.id = item.route_id
      WHERE item.plan_id = $1::uuid
      ORDER BY item.sequence_number ASC, item.id ASC
    `,
    [planId],
  );
  return Object.freeze({
    plan,
    items: Object.freeze(itemRows.map(mapItemRow)),
    candidates: Object.freeze([]),
    events: Object.freeze([]),
  });
}

async function requirePlanById(sql: SqlExecutor, planId: string): Promise<DailyPlan> {
  const rows = await sql.unsafe<PlanRow[]>(
    `${planSelect} WHERE plan.id = $1::uuid`,
    [planId],
  );
  const row = rows[0];
  if (!row) throw new DailyPlanNotFoundError();
  return mapPlanRow(row);
}

async function insertGeneratedEvent(
  transaction: SqlExecutor,
  plan: DailyPlan,
  context: DailyPlanCommandContext,
  generationRequest: Readonly<Record<string, unknown>>,
  selectedCount: number,
  excludedCount: number,
): Promise<void> {
  await transaction.unsafe(
    `
      INSERT INTO daily_plan_events (
        plan_id,
        event_type,
        actor_user_id,
        request_id,
        new_values,
        operation_payload,
        reason,
        idempotency_key
      ) VALUES (
        $1, 'GENERATED', $2, $3, $4::jsonb, $5::jsonb, $6, $7
      )
    `,
    [
      plan.id,
      context.actor.id,
      context.request.requestId,
      transaction.json({
        state: plan.state,
        selectedCount,
        excludedCount,
        targetCollectionSrMinor: plan.targetCollectionSrMinor,
        targetCollectionRgMinor: plan.targetCollectionRgMinor,
        targetSalesSrMinor: plan.targetSalesSrMinor,
        targetSalesRgMinor: plan.targetSalesRgMinor,
      } as never),
      transaction.json(generationRequest as never),
      "توليد خطة يومية حتمية من آخر البيانات المعتمدة.",
      context.idempotencyKey,
    ],
  );
}

async function insertGenerationAudit(
  transaction: SqlExecutor,
  plan: DailyPlan,
  context: DailyPlanCommandContext,
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
        new_values,
        result,
        metadata
      ) VALUES (
        $1, 'USER', 'plans.generate', 'DAILY_PLAN', $2, $3, $4,
        $5::inet, $6, $7::jsonb, 'SUCCESS', $8::jsonb
      )
    `,
    [
      context.actor.id,
      plan.id,
      context.request.requestId,
      context.sessionId ?? null,
      context.request.ipAddress,
      context.request.userAgent,
      transaction.json({
        representativeId: plan.representativeId,
        planDate: plan.planDate,
        rulesetVersion: plan.rulesetVersion,
        targetCollectionSrMinor: plan.targetCollectionSrMinor,
        targetCollectionRgMinor: plan.targetCollectionRgMinor,
        targetSalesSrMinor: plan.targetSalesSrMinor,
        targetSalesRgMinor: plan.targetSalesRgMinor,
      } as never),
      transaction.json({
        operatingMode: context.actor.operatingMode,
        currencyIsolation: "SR_AND_RG_TARGETS_ARE_SEPARATE",
      } as never),
    ],
  );
}

function mapCandidateRow(
  row: CandidateRow,
  representativeId: string,
): DailyPlanCandidateInput {
  return Object.freeze({
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerNumber: row.customer_number,
    representativeId,
    lifecycleStatus: row.lifecycle_status,
    areaId: row.area_id,
    routeId: row.route_id,
    routeName: row.route_name,
    estimatedTravelMinutes: safeInteger(row.estimated_travel_minutes ?? 0, "travel minutes"),
    estimatedVisitMinutes: safeInteger(row.estimated_visit_minutes ?? 30, "visit minutes"),
    outstandingMinor: Object.freeze({
      SR: safeInteger(row.outstanding_sr_minor, "outstanding SR"),
      RG: safeInteger(row.outstanding_rg_minor, "outstanding RG"),
    }),
    overdue31To60Minor: Object.freeze({
      SR: safeInteger(row.overdue_31_60_sr_minor, "aging 31-60 SR"),
      RG: safeInteger(row.overdue_31_60_rg_minor, "aging 31-60 RG"),
    }),
    overdue61To90Minor: Object.freeze({
      SR: safeInteger(row.overdue_61_90_sr_minor, "aging 61-90 SR"),
      RG: safeInteger(row.overdue_61_90_rg_minor, "aging 61-90 RG"),
    }),
    overdue91To180Minor: Object.freeze({
      SR: safeInteger(row.overdue_91_180_sr_minor, "aging 91-180 SR"),
      RG: safeInteger(row.overdue_91_180_rg_minor, "aging 91-180 RG"),
    }),
    overdueOver180Minor: Object.freeze({
      SR: safeInteger(row.overdue_over_180_sr_minor, "aging over 180 SR"),
      RG: safeInteger(row.overdue_over_180_rg_minor, "aging over 180 RG"),
    }),
    promise: row.promise_id && row.promise_currency_code && row.promise_due_date && row.promise_temporal_status
      ? Object.freeze({
          id: row.promise_id,
          currencyCode: row.promise_currency_code,
          remainingAmountMinor: safeInteger(
            row.promise_remaining_amount_minor ?? 0,
            "promise remaining amount",
          ),
          dueDate: dateOnly(row.promise_due_date),
          temporalStatus: row.promise_temporal_status,
        })
      : null,
    riskSignals: Object.freeze((row.risk_signals ?? []).map((signal) => Object.freeze({
      ...signal,
      score: safeInteger(signal.score, "risk score"),
    }))),
    daysSinceLastVisit: null,
    unresolvedReconciliationCount: 0,
    managerPriority: safeInteger(row.manager_priority ?? 0, "manager priority"),
    salesOpportunityScore: 0,
    salesTargetMinor: Object.freeze({ SR: 0, RG: 0 }),
    missingInputs: Object.freeze([
      "daysSinceLastVisit",
      "unresolvedReconciliationCount",
      "salesOpportunityScore",
    ]),
  });
}

function mapPlanRow(row: PlanRow): DailyPlan {
  return Object.freeze({
    id: row.id,
    representativeId: row.representative_id,
    representativeName: row.representative_name,
    planDate: dateOnly(row.plan_date),
    state: row.state,
    generationMode: row.generation_mode,
    cutoffAt: iso(row.cutoff_at),
    rulesetVersion: row.ruleset_version,
    sourceSnapshot: Object.freeze({ ...row.source_snapshot }),
    inputFingerprint: row.input_fingerprint,
    targetCollectionSrMinor: safeInteger(row.target_collection_sr_minor, "plan collection SR"),
    targetCollectionRgMinor: safeInteger(row.target_collection_rg_minor, "plan collection RG"),
    targetSalesSrMinor: safeInteger(row.target_sales_sr_minor, "plan sales SR"),
    targetSalesRgMinor: safeInteger(row.target_sales_rg_minor, "plan sales RG"),
    fuelBudgetCurrencyCode: row.fuel_budget_currency_code,
    fuelBudgetMinor: nullableSafeInteger(row.fuel_budget_minor, "fuel budget"),
    estimatedWorkMinutes: safeInteger(row.estimated_work_minutes, "work minutes"),
    notes: row.notes,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: iso(row.created_at),
    submittedBy: row.submitted_by,
    submittedAt: nullableIso(row.submitted_at),
    approvedBy: row.approved_by,
    approvedAt: nullableIso(row.approved_at),
    rejectedBy: row.rejected_by,
    rejectedAt: nullableIso(row.rejected_at),
    rejectionReason: row.rejection_reason,
    startedBy: row.started_by,
    startedAt: nullableIso(row.started_at),
    completedBy: row.completed_by,
    completedAt: nullableIso(row.completed_at),
    cancelledBy: row.cancelled_by,
    cancelledAt: nullableIso(row.cancelled_at),
    cancellationReason: row.cancellation_reason,
    version: safeInteger(row.version, "plan version"),
    updatedAt: iso(row.updated_at),
  });
}

function mapItemRow(row: ItemRow): DailyPlanItem {
  return Object.freeze({
    id: row.id,
    planId: row.plan_id,
    sequenceNumber: safeInteger(row.sequence_number, "sequence number"),
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerNumber: row.customer_number,
    linkedPromiseId: row.linked_promise_id,
    taskType: row.task_type,
    priorityLevel: row.priority_level,
    priorityScore: safeInteger(row.priority_score, "priority score"),
    selectionReason: row.selection_reason,
    objective: row.objective,
    expectedResult: row.expected_result,
    targetCollectionSrMinor: safeInteger(row.target_collection_sr_minor, "item collection SR"),
    targetCollectionRgMinor: safeInteger(row.target_collection_rg_minor, "item collection RG"),
    targetSalesSrMinor: safeInteger(row.target_sales_sr_minor, "item sales SR"),
    targetSalesRgMinor: safeInteger(row.target_sales_rg_minor, "item sales RG"),
    areaId: row.area_id,
    areaName: row.area_name,
    routeId: row.route_id,
    routeName: row.route_name,
    estimatedVisitMinutes: safeInteger(row.estimated_visit_minutes, "item visit minutes"),
    estimatedTravelMinutes: safeInteger(row.estimated_travel_minutes, "item travel minutes"),
    manualOverride: row.manual_override,
    version: safeInteger(row.version, "item version"),
  });
}

function generationRequestPayload(
  input: GenerateDailyPlanInput,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    representativeId: input.representativeId,
    planDate: input.planDate,
    maxItems: input.maxItems,
    workMinutesBudget: input.workMinutesBudget,
    fuelBudgetCurrencyCode: input.fuelBudgetCurrencyCode ?? null,
    fuelBudgetMinor: input.fuelBudgetMinor ?? null,
    notes: input.notes ?? null,
  });
}

function candidateSnapshot(
  candidate: PlannedDailyPlanCandidate,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    lifecycleStatus: candidate.input.lifecycleStatus,
    routeId: candidate.input.routeId,
    routeName: candidate.input.routeName,
    outstandingMinor: candidate.input.outstandingMinor,
    overdue31To60Minor: candidate.input.overdue31To60Minor,
    overdue61To90Minor: candidate.input.overdue61To90Minor,
    overdue91To180Minor: candidate.input.overdue91To180Minor,
    overdueOver180Minor: candidate.input.overdueOver180Minor,
    promise: candidate.input.promise,
    riskSignals: candidate.input.riskSignals,
    daysSinceLastVisit: candidate.input.daysSinceLastVisit,
    unresolvedReconciliationCount: candidate.input.unresolvedReconciliationCount,
    managerPriority: candidate.input.managerPriority,
    salesOpportunityScore: candidate.input.salesOpportunityScore,
    targetCollectionMinor: candidate.targetCollectionMinor,
    targetSalesMinor: candidate.targetSalesMinor,
    estimatedWorkMinutes: candidate.estimatedWorkMinutes,
    missingInputs: candidate.input.missingInputs ?? [],
  });
}

function fingerprintGeneration(
  request: Readonly<Record<string, unknown>>,
  candidates: readonly DailyPlanCandidateInput[],
  cutoffAt: string,
): string {
  const stableCandidates = [...candidates]
    .sort((left, right) => left.customerId.localeCompare(right.customerId))
    .map((candidate) => ({ ...candidate }));
  return createHash("sha256")
    .update(JSON.stringify({ request, cutoffAt, candidates: stableCandidates }))
    .digest("hex");
}

function safeInteger(value: string | number, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${label} is outside the safe integer range`);
  }
  return number;
}

function nullableSafeInteger(
  value: string | number | null,
  label: string,
): number | null {
  return value === null ? null : safeInteger(value, label);
}

function iso(value: string | Date): string {
  return new Date(value).toISOString();
}

function nullableIso(value: string | Date | null): string | null {
  return value === null ? null : iso(value);
}

function dateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
