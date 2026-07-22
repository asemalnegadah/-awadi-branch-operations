import type { Sql, TransactionSql } from "postgres";

import {
  DailyPlanBusinessRuleError,
  DailyPlanConflictError,
  DailyPlanIdempotencyConflictError,
  DailyPlanNotFoundError,
} from "./errors";
import type {
  DeleteDailyPlanItemInput,
  UpdateDailyPlanItemInput,
} from "./management-types";
import { requireDailyPlanPostgres } from "./postgres-read-repository";
import type { DailyPlanCommandContext, DailyPlanItem } from "./types";

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

interface AdjustmentReplayRow {
  plan_id: string;
  plan_item_id: string | null;
  adjustment_type: string;
  payload_matches: boolean;
}

const itemSelect = `
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
`;

export async function updateDailyPlanItemPostgres(
  sql: Sql,
  planId: string,
  itemId: string,
  input: UpdateDailyPlanItemInput,
  context: DailyPlanCommandContext,
): Promise<{ readonly item: DailyPlanItem; readonly replayed: boolean }> {
  const patchPayload = normalizedUpdatePayload(input);

  return sql.begin(async (transaction) => {
    const plan = await requireDailyPlanPostgres(transaction, planId, undefined, true);
    if (plan.state !== "DRAFT") {
      throw new DailyPlanBusinessRuleError("لا يمكن تعديل عناصر الخطة بعد إرسالها للاعتماد.");
    }

    const replay = await findAdjustmentReplay(
      transaction,
      context.idempotencyKey,
      planId,
      itemId,
      adjustmentTypeFor(input),
      patchPayload,
    );
    if (replay) {
      return Object.freeze({
        item: await requireItemById(transaction, planId, itemId),
        replayed: true,
      });
    }

    const current = await requireItemById(transaction, planId, itemId, true);
    if (current.version !== input.version) {
      throw new DailyPlanConflictError("تم تعديل عنصر الخطة من عملية أخرى.");
    }

    const oldSnapshot = itemSnapshot(current);
    const desired = Object.freeze({
      taskType: input.taskType ?? current.taskType,
      objective: input.objective ?? current.objective,
      expectedResult: input.expectedResult ?? current.expectedResult,
      targetCollectionSrMinor:
        input.targetCollectionSrMinor ?? current.targetCollectionSrMinor,
      targetCollectionRgMinor:
        input.targetCollectionRgMinor ?? current.targetCollectionRgMinor,
      targetSalesSrMinor: input.targetSalesSrMinor ?? current.targetSalesSrMinor,
      targetSalesRgMinor: input.targetSalesRgMinor ?? current.targetSalesRgMinor,
      routeId: input.routeId === undefined ? current.routeId : input.routeId,
      estimatedVisitMinutes:
        input.estimatedVisitMinutes ?? current.estimatedVisitMinutes,
      estimatedTravelMinutes:
        input.estimatedTravelMinutes ?? current.estimatedTravelMinutes,
    });

    const rows = await transaction.unsafe<{ id: string }[]>(
      `
        UPDATE daily_plan_items
        SET task_type = $1,
            objective = $2,
            expected_result = $3,
            target_collection_sr_minor = $4,
            target_collection_rg_minor = $5,
            target_sales_sr_minor = $6,
            target_sales_rg_minor = $7,
            route_id = $8::uuid,
            area_id = CASE WHEN $8::uuid IS NULL THEN NULL ELSE area_id END,
            estimated_visit_minutes = $9,
            estimated_travel_minutes = $10,
            manual_override = true,
            updated_by = $11
        WHERE id = $12::uuid
          AND plan_id = $13::uuid
          AND version = $14
        RETURNING id
      `,
      [
        desired.taskType,
        desired.objective,
        desired.expectedResult,
        desired.targetCollectionSrMinor,
        desired.targetCollectionRgMinor,
        desired.targetSalesSrMinor,
        desired.targetSalesRgMinor,
        desired.routeId,
        desired.estimatedVisitMinutes,
        desired.estimatedTravelMinutes,
        context.actor.id,
        itemId,
        planId,
        input.version,
      ],
    );
    if (!rows[0]) throw new DailyPlanConflictError("تم تعديل عنصر الخطة من عملية أخرى.");

    const item = await requireItemById(transaction, planId, itemId);
    const newSnapshot = itemSnapshot(item);
    await insertAdjustment(
      transaction,
      planId,
      itemId,
      adjustmentTypeFor(input),
      context,
      input.reason,
      oldSnapshot,
      patchPayload,
    );
    await insertManagementAudit(
      transaction,
      context,
      "plans.update_item",
      planId,
      itemId,
      input.reason,
      oldSnapshot,
      newSnapshot,
    );
    return Object.freeze({ item, replayed: false });
  });
}

export async function deleteDailyPlanItemPostgres(
  sql: Sql,
  planId: string,
  itemId: string,
  input: DeleteDailyPlanItemInput,
  context: DailyPlanCommandContext,
): Promise<{ readonly item: DailyPlanItem; readonly replayed: boolean }> {
  const operationPayload = Object.freeze({
    itemId,
    version: input.version,
    reason: input.reason,
    deleted: true,
  });

  return sql.begin(async (transaction) => {
    const plan = await requireDailyPlanPostgres(transaction, planId, undefined, true);
    if (plan.state !== "DRAFT") {
      throw new DailyPlanBusinessRuleError("لا يمكن حذف عنصر من خطة أرسلت للاعتماد.");
    }

    const replay = await findAdjustmentReplay(
      transaction,
      context.idempotencyKey,
      planId,
      null,
      "REMOVE_ITEM",
      operationPayload,
    );
    if (replay) {
      const snapshot = await findDeletedItemSnapshot(
        transaction,
        context.idempotencyKey,
      );
      if (!snapshot) throw new DailyPlanIdempotencyConflictError();
      return Object.freeze({ item: snapshot, replayed: true });
    }

    const current = await requireItemById(transaction, planId, itemId, true);
    if (current.version !== input.version) {
      throw new DailyPlanConflictError("تم تعديل عنصر الخطة من عملية أخرى.");
    }
    const oldSnapshot = itemSnapshot(current);

    await insertAdjustment(
      transaction,
      planId,
      null,
      "REMOVE_ITEM",
      context,
      input.reason,
      oldSnapshot,
      operationPayload,
    );
    const deleted = await transaction.unsafe<{ id: string }[]>(
      `DELETE FROM daily_plan_items WHERE id = $1::uuid AND plan_id = $2::uuid RETURNING id`,
      [itemId, planId],
    );
    if (!deleted[0]) throw new DailyPlanConflictError();

    await insertManagementAudit(
      transaction,
      context,
      "plans.remove_item",
      planId,
      itemId,
      input.reason,
      oldSnapshot,
      null,
    );
    return Object.freeze({ item: current, replayed: false });
  });
}

async function requireItemById(
  sql: TransactionSql,
  planId: string,
  itemId: string,
  lock = false,
): Promise<DailyPlanItem> {
  const rows = await sql.unsafe<ItemRow[]>(
    `${itemSelect}
     WHERE item.id = $1::uuid AND item.plan_id = $2::uuid
     ${lock ? "FOR UPDATE OF item" : ""}`,
    [itemId, planId],
  );
  const row = rows[0];
  if (!row) throw new DailyPlanNotFoundError("لم يتم العثور على عنصر الخطة المطلوب.");
  return mapItemRow(row);
}

async function findAdjustmentReplay(
  transaction: TransactionSql,
  idempotencyKey: string,
  planId: string,
  itemId: string | null,
  adjustmentType: string,
  operationPayload: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  const rows = await transaction.unsafe<AdjustmentReplayRow[]>(
    `
      SELECT
        plan_id,
        plan_item_id,
        adjustment_type,
        new_values = $2::jsonb AS payload_matches
      FROM daily_plan_adjustments
      WHERE idempotency_key = $1
      FOR UPDATE
    `,
    [idempotencyKey, transaction.json(operationPayload as never)],
  );
  const row = rows[0];
  if (!row) return false;
  if (
    row.plan_id !== planId
    || row.plan_item_id !== itemId
    || row.adjustment_type !== adjustmentType
    || !row.payload_matches
  ) {
    throw new DailyPlanIdempotencyConflictError();
  }
  return true;
}

async function findDeletedItemSnapshot(
  transaction: TransactionSql,
  idempotencyKey: string,
): Promise<DailyPlanItem | null> {
  const rows = await transaction.unsafe<{ old_values: Readonly<Record<string, unknown>> }[]>(
    `SELECT old_values FROM daily_plan_adjustments WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  const value = rows[0]?.old_values;
  if (!value) return null;
  return itemFromSnapshot(value);
}

async function insertAdjustment(
  transaction: TransactionSql,
  planId: string,
  itemId: string | null,
  adjustmentType: string,
  context: DailyPlanCommandContext,
  reason: string,
  oldValues: Readonly<Record<string, unknown>>,
  newValues: Readonly<Record<string, unknown>>,
): Promise<void> {
  try {
    await transaction.unsafe(
      `
        INSERT INTO daily_plan_adjustments (
          plan_id,
          plan_item_id,
          adjustment_type,
          actor_user_id,
          reason,
          old_values,
          new_values,
          request_id,
          idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
      `,
      [
        planId,
        itemId,
        adjustmentType,
        context.actor.id,
        reason,
        transaction.json(oldValues as never),
        transaction.json(newValues as never),
        context.request.requestId,
        context.idempotencyKey,
      ],
    );
  } catch (error) {
    if (postgresCode(error) === "23505") {
      throw new DailyPlanIdempotencyConflictError();
    }
    throw error;
  }
}

async function insertManagementAudit(
  transaction: TransactionSql,
  context: DailyPlanCommandContext,
  action: string,
  planId: string,
  itemId: string,
  reason: string,
  oldValues: Readonly<Record<string, unknown>> | null,
  newValues: Readonly<Record<string, unknown>> | null,
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
        $1, 'USER', $2, 'DAILY_PLAN_ITEM', $3, $4, $5,
        $6::inet, $7, $8, $9::jsonb, $10::jsonb, 'SUCCESS', $11::jsonb
      )
    `,
    [
      context.actor.id,
      action,
      itemId,
      context.request.requestId,
      context.sessionId ?? null,
      context.request.ipAddress,
      context.request.userAgent,
      reason,
      oldValues ? transaction.json(oldValues as never) : null,
      newValues ? transaction.json(newValues as never) : null,
      transaction.json({
        planId,
        operatingMode: context.actor.operatingMode,
      } as never),
    ],
  );
}

function normalizedUpdatePayload(
  input: UpdateDailyPlanItemInput,
): Readonly<Record<string, unknown>> {
  const payload: Record<string, unknown> = {
    version: input.version,
    reason: input.reason,
  };
  if (input.taskType !== undefined) payload.taskType = input.taskType;
  if (input.objective !== undefined) payload.objective = input.objective;
  if (input.expectedResult !== undefined) payload.expectedResult = input.expectedResult;
  if (input.targetCollectionSrMinor !== undefined) {
    payload.targetCollectionSrMinor = input.targetCollectionSrMinor;
  }
  if (input.targetCollectionRgMinor !== undefined) {
    payload.targetCollectionRgMinor = input.targetCollectionRgMinor;
  }
  if (input.targetSalesSrMinor !== undefined) payload.targetSalesSrMinor = input.targetSalesSrMinor;
  if (input.targetSalesRgMinor !== undefined) payload.targetSalesRgMinor = input.targetSalesRgMinor;
  if (input.routeId !== undefined) payload.routeId = input.routeId;
  if (input.estimatedVisitMinutes !== undefined) {
    payload.estimatedVisitMinutes = input.estimatedVisitMinutes;
  }
  if (input.estimatedTravelMinutes !== undefined) {
    payload.estimatedTravelMinutes = input.estimatedTravelMinutes;
  }
  return Object.freeze(payload);
}

function adjustmentTypeFor(input: UpdateDailyPlanItemInput): string {
  if (
    input.targetCollectionSrMinor !== undefined
    || input.targetCollectionRgMinor !== undefined
    || input.targetSalesSrMinor !== undefined
    || input.targetSalesRgMinor !== undefined
  ) return "CHANGE_TARGET";
  if (input.routeId !== undefined) return "CHANGE_ROUTE";
  if (
    input.estimatedVisitMinutes !== undefined
    || input.estimatedTravelMinutes !== undefined
  ) return "CHANGE_TIMING";
  return "CHANGE_TASK";
}

function itemSnapshot(item: DailyPlanItem): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: item.id,
    planId: item.planId,
    sequenceNumber: item.sequenceNumber,
    customerId: item.customerId,
    customerName: item.customerName,
    customerNumber: item.customerNumber,
    linkedPromiseId: item.linkedPromiseId,
    taskType: item.taskType,
    priorityLevel: item.priorityLevel,
    priorityScore: item.priorityScore,
    selectionReason: item.selectionReason,
    objective: item.objective,
    expectedResult: item.expectedResult,
    targetCollectionSrMinor: item.targetCollectionSrMinor,
    targetCollectionRgMinor: item.targetCollectionRgMinor,
    targetSalesSrMinor: item.targetSalesSrMinor,
    targetSalesRgMinor: item.targetSalesRgMinor,
    areaId: item.areaId,
    areaName: item.areaName,
    routeId: item.routeId,
    routeName: item.routeName,
    estimatedVisitMinutes: item.estimatedVisitMinutes,
    estimatedTravelMinutes: item.estimatedTravelMinutes,
    manualOverride: item.manualOverride,
    version: item.version,
  });
}

function itemFromSnapshot(value: Readonly<Record<string, unknown>>): DailyPlanItem {
  return Object.freeze({
    id: requiredString(value.id, "id"),
    planId: requiredString(value.planId, "planId"),
    sequenceNumber: requiredNumber(value.sequenceNumber, "sequenceNumber"),
    customerId: requiredString(value.customerId, "customerId"),
    customerName: requiredString(value.customerName, "customerName"),
    customerNumber: optionalString(value.customerNumber),
    linkedPromiseId: optionalString(value.linkedPromiseId),
    taskType: requiredString(value.taskType, "taskType") as DailyPlanItem["taskType"],
    priorityLevel: requiredString(value.priorityLevel, "priorityLevel") as DailyPlanItem["priorityLevel"],
    priorityScore: requiredNumber(value.priorityScore, "priorityScore"),
    selectionReason: requiredString(value.selectionReason, "selectionReason"),
    objective: requiredString(value.objective, "objective"),
    expectedResult: requiredString(value.expectedResult, "expectedResult"),
    targetCollectionSrMinor: requiredNumber(value.targetCollectionSrMinor, "targetCollectionSrMinor"),
    targetCollectionRgMinor: requiredNumber(value.targetCollectionRgMinor, "targetCollectionRgMinor"),
    targetSalesSrMinor: requiredNumber(value.targetSalesSrMinor, "targetSalesSrMinor"),
    targetSalesRgMinor: requiredNumber(value.targetSalesRgMinor, "targetSalesRgMinor"),
    areaId: optionalString(value.areaId),
    areaName: optionalString(value.areaName),
    routeId: optionalString(value.routeId),
    routeName: optionalString(value.routeName),
    estimatedVisitMinutes: requiredNumber(value.estimatedVisitMinutes, "estimatedVisitMinutes"),
    estimatedTravelMinutes: requiredNumber(value.estimatedTravelMinutes, "estimatedTravelMinutes"),
    manualOverride: value.manualOverride === true,
    version: requiredNumber(value.version, "version"),
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
    targetCollectionSrMinor: safeInteger(row.target_collection_sr_minor, "collection SR"),
    targetCollectionRgMinor: safeInteger(row.target_collection_rg_minor, "collection RG"),
    targetSalesSrMinor: safeInteger(row.target_sales_sr_minor, "sales SR"),
    targetSalesRgMinor: safeInteger(row.target_sales_rg_minor, "sales RG"),
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

function safeInteger(value: string | number, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${label} is outside the safe integer range`);
  }
  return number;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is missing from item snapshot`);
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is invalid in item snapshot`);
  }
  return value;
}

function postgresCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}
