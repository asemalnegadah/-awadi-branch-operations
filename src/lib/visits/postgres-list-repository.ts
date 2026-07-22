import type { Sql } from "postgres";

import { decodeFieldVisitCursor, encodeFieldVisitCursor } from "./cursor";
import type { FieldVisit, FieldVisitListFilters, FieldVisitPage } from "./types";

interface VisitListRow {
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

export async function listFieldVisitsStablePostgres(
  sql: Sql,
  filters: FieldVisitListFilters,
  representativeScopeId?: string,
): Promise<FieldVisitPage> {
  const cursor = decodeFieldVisitCursor(filters.cursor);
  const rows = await sql.unsafe<VisitListRow[]>(
    `SELECT
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
     WHERE ($1::uuid IS NULL OR visit.representative_id = $1::uuid)
       AND ($2::uuid IS NULL OR visit.representative_id = $2::uuid)
       AND ($3::uuid IS NULL OR visit.customer_id = $3::uuid)
       AND ($4::text IS NULL OR visit.state = $4)
       AND ($5::date IS NULL OR COALESCE(visit.arrived_at, visit.created_at)::date >= $5::date)
       AND ($6::date IS NULL OR COALESCE(visit.arrived_at, visit.created_at)::date <= $6::date)
       AND (
         $7::timestamptz IS NULL
         OR visit.created_at < $7::timestamptz
         OR (visit.created_at = $7::timestamptz AND visit.id < $8::uuid)
       )
     ORDER BY visit.created_at DESC, visit.id DESC
     LIMIT $9`,
    [
      representativeScopeId ?? null,
      filters.representativeId ?? null,
      filters.customerId ?? null,
      filters.state ?? null,
      filters.visitDateFrom ?? null,
      filters.visitDateTo ?? null,
      cursor?.createdAt ?? null,
      cursor?.id ?? null,
      filters.limit + 1,
    ],
  );
  const hasMore = rows.length > filters.limit;
  const selected = hasMore ? rows.slice(0, filters.limit) : rows;
  const last = selected.at(-1);
  return Object.freeze({
    items: Object.freeze(selected.map(mapRow)),
    nextCursor: hasMore && last
      ? encodeFieldVisitCursor({ createdAt: iso(last.created_at), id: last.id })
      : null,
  });
}

function mapRow(row: VisitListRow): FieldVisit {
  return Object.freeze({
    id: row.id,
    representativeId: row.representative_id,
    representativeName: row.representative_name,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerNumber: row.customer_number,
    planId: row.plan_id,
    planItemId: row.plan_item_id,
    visitSource: row.visit_source,
    state: row.state,
    visitType: row.visit_type,
    objective: row.objective,
    declaredResult: row.declared_result,
    outcomeSummary: row.outcome_summary,
    arrivedAt: nullableIso(row.arrived_at),
    departedAt: nullableIso(row.departed_at),
    deviceArrivedAt: nullableIso(row.device_arrived_at),
    deviceDepartedAt: nullableIso(row.device_departed_at),
    checkinLatitude: nullableNumber(row.checkin_latitude),
    checkinLongitude: nullableNumber(row.checkin_longitude),
    checkinAccuracyMeters: nullableNumber(row.checkin_accuracy_meters),
    checkoutLatitude: nullableNumber(row.checkout_latitude),
    checkoutLongitude: nullableNumber(row.checkout_longitude),
    checkoutAccuracyMeters: nullableNumber(row.checkout_accuracy_meters),
    syncStatus: row.sync_status,
    syncReceivedAt: nullableIso(row.sync_received_at),
    outOfPlanReason: row.out_of_plan_reason,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: iso(row.created_at),
    submittedBy: row.submitted_by,
    submittedAt: nullableIso(row.submitted_at),
    verifiedBy: row.verified_by,
    verifiedAt: nullableIso(row.verified_at),
    cancelledBy: row.cancelled_by,
    cancelledAt: nullableIso(row.cancelled_at),
    cancellationReason: row.cancellation_reason,
    version: safeInteger(row.version, "visit version"),
    updatedAt: iso(row.updated_at),
    outcomeCount: safeInteger(row.outcome_count, "outcome count"),
    qualifyingOutcomeCount: safeInteger(row.qualifying_outcome_count, "qualifying outcome count"),
    evidenceCount: safeInteger(row.evidence_count, "evidence count"),
  });
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function nullableIso(value: string | Date | null): string | null {
  return value === null ? null : iso(value);
}
function nullableNumber(value: string | number | null): number | null {
  if (value === null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("invalid numeric database value");
  return number;
}
function safeInteger(value: string | number, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`${label} is outside safe integer range`);
  return number;
}
