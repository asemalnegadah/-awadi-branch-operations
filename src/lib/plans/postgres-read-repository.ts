import type { Sql, TransactionSql } from "postgres";

import { DailyPlanNotFoundError } from "./errors";
import type {
  DailyPlan,
  DailyPlanCandidateRecord,
  DailyPlanDetails,
  DailyPlanEvent,
  DailyPlanItem,
  DailyPlanListFilters,
  DailyPlanPage,
} from "./types";

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

interface CandidateRow {
  id: string;
  plan_id: string;
  customer_id: string;
  customer_name: string;
  customer_number: string | null;
  route_id: string | null;
  route_name: string | null;
  area_id: string | null;
  area_name: string | null;
  computed_score: string | number;
  selected: boolean;
  selection_rank: string | number | null;
  decision_reason: string;
  exclusion_reason: string | null;
  factors: DailyPlanCandidateRecord["factors"];
  source_snapshot: Readonly<Record<string, unknown>>;
  linked_promise_id: string | null;
}

interface EventRow {
  id: string;
  plan_id: string;
  event_type: DailyPlanEvent["eventType"];
  actor_user_id: string;
  actor_name: string;
  occurred_at: string | Date;
  old_values: Readonly<Record<string, unknown>>;
  new_values: Readonly<Record<string, unknown>>;
  reason: string | null;
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

export async function listDailyPlansPostgres(
  sql: TransactionSql,
  filters: DailyPlanListFilters,
  representativeScopeId?: string,
): Promise<DailyPlanPage> {
  const rows = await sql.unsafe<PlanRow[]>(
    `${planSelect}
     WHERE ($1::uuid IS NULL OR plan.representative_id = $1::uuid)
       AND ($2::uuid IS NULL OR plan.representative_id = $2::uuid)
       AND ($3::date IS NULL OR plan.plan_date >= $3::date)
       AND ($4::date IS NULL OR plan.plan_date <= $4::date)
       AND ($5::text IS NULL OR plan.state = $5)
       AND ($6::uuid IS NULL OR plan.id < $6::uuid)
     ORDER BY plan.plan_date DESC, plan.id DESC
     LIMIT $7`,
    [
      representativeScopeId ?? null,
      filters.representativeId ?? null,
      filters.planDateFrom ?? null,
      filters.planDateTo ?? null,
      filters.state ?? null,
      filters.cursor ?? null,
      filters.limit + 1,
    ],
  );
  const hasMore = rows.length > filters.limit;
  const selected = hasMore ? rows.slice(0, filters.limit) : rows;
  return Object.freeze({
    items: Object.freeze(selected.map(mapPlanRow)),
    nextCursor: hasMore ? selected.at(-1)?.id ?? null : null,
  });
}

export async function getDailyPlanPostgres(
  sql: TransactionSql,
  planId: string,
  representativeScopeId?: string,
  lock = false,
): Promise<DailyPlan | null> {
  const rows = await sql.unsafe<PlanRow[]>(
    `${planSelect}
     WHERE plan.id = $1::uuid
       AND ($2::uuid IS NULL OR plan.representative_id = $2::uuid)
     ${lock ? "FOR UPDATE OF plan" : ""}`,
    [planId, representativeScopeId ?? null],
  );
  return rows[0] ? mapPlanRow(rows[0]) : null;
}

export async function requireDailyPlanPostgres(
  sql: TransactionSql,
  planId: string,
  representativeScopeId?: string,
  lock = false,
): Promise<DailyPlan> {
  const plan = await getDailyPlanPostgres(sql, planId, representativeScopeId, lock);
  if (!plan) throw new DailyPlanNotFoundError();
  return plan;
}

export async function getDailyPlanDetailsPostgres(
  sql: TransactionSql,
  planId: string,
  representativeScopeId?: string,
  includeHistory = true,
): Promise<DailyPlanDetails> {
  const plan = await requireDailyPlanPostgres(sql, planId, representativeScopeId);
  const [itemRows, candidateRows, eventRows] = await Promise.all([
    sql.unsafe<ItemRow[]>(
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
    ),
    includeHistory
      ? sql.unsafe<CandidateRow[]>(
          `
            SELECT
              candidate.*,
              customer.trade_name_ar AS customer_name,
              customer.customer_number,
              area.name_ar AS area_name,
              route.name_ar AS route_name
            FROM daily_plan_candidates AS candidate
            JOIN customers AS customer ON customer.id = candidate.customer_id
            LEFT JOIN areas AS area ON area.id = candidate.area_id
            LEFT JOIN routes AS route ON route.id = candidate.route_id
            WHERE candidate.plan_id = $1::uuid
            ORDER BY candidate.selected DESC, candidate.selection_rank, candidate.computed_score DESC, candidate.id
          `,
          [planId],
        )
      : Promise.resolve([]),
    includeHistory
      ? sql.unsafe<EventRow[]>(
          `
            SELECT
              event.id,
              event.plan_id,
              event.event_type,
              event.actor_user_id,
              actor.full_name AS actor_name,
              event.occurred_at,
              event.old_values,
              event.new_values,
              event.reason
            FROM daily_plan_events AS event
            JOIN users AS actor ON actor.id = event.actor_user_id
            WHERE event.plan_id = $1::uuid
            ORDER BY event.occurred_at ASC, event.id ASC
          `,
          [planId],
        )
      : Promise.resolve([]),
  ]);

  return Object.freeze({
    plan,
    items: Object.freeze(itemRows.map(mapItemRow)),
    candidates: Object.freeze(candidateRows.map(mapCandidateRow)),
    events: Object.freeze(eventRows.map(mapEventRow)),
  });
}

export function mapPlanRow(row: PlanRow): DailyPlan {
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

export function mapItemRow(row: ItemRow): DailyPlanItem {
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
    estimatedVisitMinutes: safeInteger(row.estimated_visit_minutes, "visit minutes"),
    estimatedTravelMinutes: safeInteger(row.estimated_travel_minutes, "travel minutes"),
    manualOverride: row.manual_override,
    version: safeInteger(row.version, "item version"),
  });
}

function mapCandidateRow(row: CandidateRow): DailyPlanCandidateRecord {
  return Object.freeze({
    id: row.id,
    planId: row.plan_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerNumber: row.customer_number,
    routeId: row.route_id,
    routeName: row.route_name,
    areaId: row.area_id,
    areaName: row.area_name,
    computedScore: safeInteger(row.computed_score, "candidate score"),
    selected: row.selected,
    selectionRank: nullableSafeInteger(row.selection_rank, "selection rank"),
    decisionReason: row.decision_reason,
    exclusionReason: row.exclusion_reason,
    factors: Object.freeze(row.factors),
    sourceSnapshot: Object.freeze({ ...row.source_snapshot }),
    linkedPromiseId: row.linked_promise_id,
  });
}

function mapEventRow(row: EventRow): DailyPlanEvent {
  return Object.freeze({
    id: row.id,
    planId: row.plan_id,
    eventType: row.event_type,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    occurredAt: iso(row.occurred_at),
    oldValues: Object.freeze({ ...row.old_values }),
    newValues: Object.freeze({ ...row.new_values }),
    reason: row.reason,
  });
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
