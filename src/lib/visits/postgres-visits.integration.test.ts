import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AuthorizationError, type AuthenticatedUser } from "@/lib/auth/types";

import { FieldVisitNotFoundError } from "./errors";
import {
  createFieldVisitPostgres,
  listFieldVisitsPostgres,
} from "./postgres-repository";
import {
  addFieldVisitOutcome,
  checkInFieldVisit,
  checkOutFieldVisit,
  createFieldVisit,
  getFieldVisitDetails,
  recordDailyPlanItemResult,
  returnFieldVisit,
  submitFieldVisit,
  verifyFieldVisit,
} from "./service";
import type { FieldVisitCommandContext } from "./types";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres("PostgreSQL field visits repository", () => {
  const sql = postgres(databaseUrl as string, { max: 8 });
  let manager: AuthenticatedUser;
  let representative: AuthenticatedUser;
  let otherRepresentative: AuthenticatedUser;
  let representativeId = "";
  let otherRepresentativeId = "";
  let customerId = "";
  let planId = "";
  let planItemId = "";

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8);
    const [managerRow] = await sql<{ id: string }[]>`
      INSERT INTO users (email, full_name, status)
      VALUES (${`visits.manager.${suffix}@example.test`}, 'مدير تكامل الزيارات', 'ACTIVE')
      RETURNING id
    `;
    const [repRow] = await sql<{ id: string }[]>`
      INSERT INTO users (email, full_name, status)
      VALUES (${`visits.rep.${suffix}@example.test`}, 'مندوب تكامل الزيارات', 'ACTIVE')
      RETURNING id
    `;
    const [otherUserRow] = await sql<{ id: string }[]>`
      INSERT INTO users (email, full_name, status)
      VALUES (${`visits.other.${suffix}@example.test`}, 'مندوب آخر للزيارات', 'ACTIVE')
      RETURNING id
    `;
    if (!managerRow || !repRow || !otherUserRow) throw new Error("visit test users were not created");

    await sql`
      UPDATE organization_settings
      SET operating_mode = 'SINGLE_MANAGER'
      WHERE singleton_id = 1
    `;
    await sql`
      INSERT INTO user_roles (user_id, role_id, granted_by)
      SELECT ${managerRow.id}, id, ${managerRow.id} FROM roles WHERE code = 'BRANCH_MANAGER'
    `;
    await sql`
      INSERT INTO user_roles (user_id, role_id, granted_by)
      SELECT ${repRow.id}, id, ${managerRow.id} FROM roles WHERE code = 'SALES_REP'
    `;
    await sql`
      INSERT INTO user_roles (user_id, role_id, granted_by)
      SELECT ${otherUserRow.id}, id, ${managerRow.id} FROM roles WHERE code = 'SALES_REP'
    `;

    const [representativeRow] = await sql<{ id: string }[]>`
      INSERT INTO sales_representatives (
        employee_code, full_name_ar, user_id, representative_type,
        status, created_by, updated_by
      ) VALUES (
        ${`VISIT-INT-${suffix}`}, 'مندوب تكامل الزيارات', ${repRow.id},
        'RETAIL', 'ACTIVE', ${managerRow.id}, ${managerRow.id}
      ) RETURNING id
    `;
    const [otherRepresentativeRow] = await sql<{ id: string }[]>`
      INSERT INTO sales_representatives (
        employee_code, full_name_ar, user_id, representative_type,
        status, created_by, updated_by
      ) VALUES (
        ${`VISIT-OTHER-${suffix}`}, 'مندوب آخر للزيارات', ${otherUserRow.id},
        'RETAIL', 'ACTIVE', ${managerRow.id}, ${managerRow.id}
      ) RETURNING id
    `;
    if (!representativeRow || !otherRepresentativeRow) throw new Error("visit representatives were not created");
    representativeId = representativeRow.id;
    otherRepresentativeId = otherRepresentativeRow.id;

    const [area] = await sql<{ id: string }[]>`
      INSERT INTO areas (code, name_ar)
      VALUES (${`VISIT-INT-AREA-${suffix}`}, 'منطقة تكامل الزيارات')
      RETURNING id
    `;
    if (!area) throw new Error("visit area was not created");
    const [route] = await sql<{ id: string }[]>`
      INSERT INTO routes (
        code, name_ar, area_id, estimated_travel_minutes,
        default_visit_minutes, created_by, updated_by
      ) VALUES (
        ${`VISIT-INT-ROUTE-${suffix}`}, 'مسار تكامل الزيارات', ${area.id},
        10, 25, ${managerRow.id}, ${managerRow.id}
      ) RETURNING id
    `;
    if (!route) throw new Error("visit route was not created");
    const [customer] = await sql<{ id: string }[]>`
      INSERT INTO customers (customer_number, trade_name_ar, created_by, updated_by)
      VALUES (${`VISIT-INT-C-${suffix}`}, 'عميل تكامل الزيارات', ${managerRow.id}, ${managerRow.id})
      RETURNING id
    `;
    if (!customer) throw new Error("visit customer was not created");
    customerId = customer.id;

    await sql`
      INSERT INTO customer_rep_assignments (
        customer_id, representative_id, reason, approved_by, created_by
      ) VALUES (
        ${customerId}, ${representativeId}, 'تكليف اختبار التكامل',
        ${managerRow.id}, ${managerRow.id}
      )
    `;
    await sql`
      INSERT INTO customer_route_assignments (
        customer_id, route_id, reason, approved_by, created_by
      ) VALUES (
        ${customerId}, ${route.id}, 'مسار اختبار التكامل',
        ${managerRow.id}, ${managerRow.id}
      )
    `;

    const [plan] = await sql<{ id: string }[]>`
      INSERT INTO daily_plans (
        representative_id, plan_date, cutoff_at, ruleset_version,
        source_snapshot, input_fingerprint, created_by, idempotency_key
      ) VALUES (
        ${representativeId}, (now() AT TIME ZONE 'Asia/Aden')::date, now(),
        'daily-plan-v1', '{}'::jsonb, ${"c".repeat(64)},
        ${managerRow.id}, ${`visit-integration-plan-${suffix}`}
      ) RETURNING id
    `;
    if (!plan) throw new Error("visit plan was not created");
    planId = plan.id;
    const [item] = await sql<{ id: string }[]>`
      INSERT INTO daily_plan_items (
        plan_id, sequence_number, customer_id, task_type, priority_level,
        priority_score, selection_reason, objective, expected_result,
        area_id, route_id, estimated_visit_minutes, estimated_travel_minutes,
        created_by, updated_by
      ) VALUES (
        ${planId}, 1, ${customerId}, 'DATA_UPDATE', 'HIGH', 600,
        'اختبار دورة تنفيذ الزيارة.', 'تحديث بيانات العميل.', 'نتيجة موثقة.',
        ${area.id}, ${route.id}, 25, 10, ${managerRow.id}, ${managerRow.id}
      ) RETURNING id
    `;
    if (!item) throw new Error("visit plan item was not created");
    planItemId = item.id;

    await sql`
      UPDATE daily_plans
      SET state = 'PENDING_APPROVAL', submitted_by = ${managerRow.id}, submitted_at = now()
      WHERE id = ${planId}
    `;
    await sql`
      UPDATE daily_plans
      SET state = 'APPROVED', approved_by = ${managerRow.id}, approved_at = now()
      WHERE id = ${planId}
    `;
    await sql`
      UPDATE daily_plans
      SET state = 'IN_PROGRESS', started_by = ${repRow.id}, started_at = now()
      WHERE id = ${planId}
    `;

    manager = actor(managerRow.id, "BRANCH_MANAGER", [
      "visits.read_own", "visits.read_all", "visits.create", "visits.manage",
      "visits.verify", "visits.view_history", "plans.execute",
    ]);
    representative = actor(repRow.id, "SALES_REP", [
      "visits.read_own", "visits.create", "visits.manage",
      "visits.view_history", "plans.execute",
    ]);
    otherRepresentative = actor(otherUserRow.id, "SALES_REP", [
      "visits.read_own", "visits.create", "visits.manage",
      "visits.view_history", "plans.execute",
    ]);
  }, 30_000);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("executes the planned visit lifecycle atomically and preserves first submission identity", async () => {
    const createContext = command(representative, "visit-integration-create");
    const created = await createFieldVisit(sql, {
      customerId,
      planId,
      planItemId,
      visitType: "DATA_UPDATE",
      objective: "تحديث بيانات العميل وموقعه.",
    }, createContext);
    expect(created.replayed).toBe(false);

    const replay = await createFieldVisit(sql, {
      customerId,
      planId,
      planItemId,
      visitType: "DATA_UPDATE",
      objective: "تحديث بيانات العميل وموقعه.",
    }, createContext);
    expect(replay.replayed).toBe(true);
    expect(replay.visit.id).toBe(created.visit.id);

    const checkedIn = await checkInFieldVisit(sql, created.visit.id, {
      latitude: 12.7855,
      longitude: 45.0182,
      accuracyMeters: 8,
      deviceAt: new Date().toISOString(),
      syncStatus: "SYNCED",
    }, command(representative, "visit-integration-check-in"));
    expect(checkedIn.visit.state).toBe("CHECKED_IN");

    await addFieldVisitOutcome(sql, created.visit.id, {
      outcomeType: "CUSTOMER_DATA_UPDATE",
      summary: "تم توثيق رقم الهاتف والموقع.",
      details: { fields: ["phone", "location"] },
    }, command(representative, "visit-integration-outcome"));

    const checkedOut = await checkOutFieldVisit(sql, created.visit.id, {
      version: checkedIn.visit.version,
      latitude: 12.7856,
      longitude: 45.0183,
      accuracyMeters: 7,
      deviceAt: new Date().toISOString(),
      syncStatus: "SYNCED",
    }, command(representative, "visit-integration-check-out"));
    expect(checkedOut.visit.state).toBe("CHECKED_OUT");

    const submitted = await submitFieldVisit(sql, created.visit.id, {
      version: checkedOut.visit.version,
      result: "SUCCESS",
      summary: "اكتملت الزيارة بنتيجة موثقة.",
    }, command(representative, "visit-integration-submit-first"));
    const firstSubmittedBy = submitted.visit.submittedBy;
    const firstSubmittedAt = submitted.visit.submittedAt;
    expect(firstSubmittedBy).toBe(representative.id);
    expect(firstSubmittedAt).not.toBeNull();

    const returned = await returnFieldVisit(sql, created.visit.id, {
      version: submitted.visit.version,
      reason: "أضف وصفًا أدق للنتيجة.",
    }, command(manager, "visit-integration-return"));
    expect(returned.visit.state).toBe("RETURNED");

    const resubmitted = await submitFieldVisit(sql, created.visit.id, {
      version: returned.visit.version,
      result: "SUCCESS",
      summary: "تم تحديث الوصف وإثبات النتيجة كاملة.",
    }, command(representative, "visit-integration-submit-second"));
    expect(resubmitted.visit.submittedBy).toBe(firstSubmittedBy);
    expect(resubmitted.visit.submittedAt).toBe(firstSubmittedAt);

    const verified = await verifyFieldVisit(sql, created.visit.id, {
      version: resubmitted.visit.version,
    }, command(manager, "visit-integration-verify"));
    expect(verified.visit.state).toBe("VERIFIED");

    const result = await recordDailyPlanItemResult(sql, {
      planItemId,
      visitId: created.visit.id,
      resultType: "VISITED_SUCCESS",
      reason: "زيارة ناجحة متحقق منها.",
    }, command(representative, "visit-integration-plan-result"));
    expect(result.result.resultType).toBe("VISITED_SUCCESS");

    await sql`
      UPDATE daily_plans
      SET state = 'COMPLETED', completed_by = ${representative.id}, completed_at = now()
      WHERE id = ${planId}
    `;
    const [completed] = await sql<{ state: string }[]>`
      SELECT state FROM daily_plans WHERE id = ${planId}
    `;
    expect(completed?.state).toBe("COMPLETED");
  }, 30_000);

  it("enforces representative scope and stable pagination without duplicates", async () => {
    await expect(getFieldVisitDetails(sql, (
      await sql<{ id: string }[]>`SELECT id FROM field_visits WHERE plan_item_id = ${planItemId} LIMIT 1`
    )[0]?.id ?? randomUUID(), { actor: otherRepresentative })).rejects.toBeInstanceOf(FieldVisitNotFoundError);

    const first = await createFieldVisitPostgres(sql, representativeId, {
      customerId,
      visitType: "PROBLEM_RESOLUTION",
      objective: "متابعة طارئة أولى.",
      outOfPlanReason: "تكليف ميداني موثق أول.",
    }, command(manager, `visit-page-first-${randomUUID()}`));
    const second = await createFieldVisitPostgres(sql, representativeId, {
      customerId,
      visitType: "PROBLEM_RESOLUTION",
      objective: "متابعة طارئة ثانية.",
      outOfPlanReason: "تكليف ميداني موثق ثانٍ.",
    }, command(manager, `visit-page-second-${randomUUID()}`));

    const pageOne = await listFieldVisitsPostgres(sql, { limit: 1 }, representativeId);
    expect(pageOne.items).toHaveLength(1);
    expect(pageOne.nextCursor).not.toBeNull();
    const pageTwo = await listFieldVisitsPostgres(sql, {
      limit: 10,
      cursor: pageOne.nextCursor ?? undefined,
    }, representativeId);
    expect(pageTwo.items.some((visit) => visit.id === pageOne.items[0]?.id)).toBe(false);
    expect(new Set([first.visit.id, second.visit.id, ...pageOne.items.map((visit) => visit.id), ...pageTwo.items.map((visit) => visit.id)]).size).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it("lets the manager assign an out-of-plan visit only to an active representative", async () => {
    const assigned = await createFieldVisit(sql, {
      customerId,
      representativeId: otherRepresentativeId,
      visitType: "PROBLEM_RESOLUTION",
      objective: "تكليف مندوب آخر بمعالجة مشكلة عاجلة.",
      outOfPlanReason: "تكليف استثنائي موثق من مدير الفرع.",
    }, command(manager, `visit-manager-assignment-${randomUUID()}`));
    expect(assigned.visit.representativeId).toBe(otherRepresentativeId);

    await expect(createFieldVisit(sql, {
      customerId,
      representativeId: otherRepresentativeId,
      visitType: "PROBLEM_RESOLUTION",
      objective: "محاولة إسناد غير مصرح بها.",
      outOfPlanReason: "يجب رفض نقل النطاق من المندوب.",
    }, command(representative, `visit-foreign-assignment-${randomUUID()}`))).rejects.toBeInstanceOf(AuthorizationError);

    await sql`UPDATE sales_representatives SET status = 'INACTIVE' WHERE id = ${otherRepresentativeId}`;
    try {
      await expect(createFieldVisit(sql, {
        customerId,
        representativeId: otherRepresentativeId,
        visitType: "PROBLEM_RESOLUTION",
        objective: "محاولة إسناد لمندوب غير نشط.",
        outOfPlanReason: "اختبار التحقق الخادمي من نشاط المندوب.",
      }, command(manager, `visit-inactive-assignment-${randomUUID()}`))).rejects.toThrow(
        "المندوب المحدد غير موجود أو غير نشط",
      );
    } finally {
      await sql`UPDATE sales_representatives SET status = 'ACTIVE' WHERE id = ${otherRepresentativeId}`;
    }
  }, 30_000);
});

function actor(
  id: string,
  role: "BRANCH_MANAGER" | "SALES_REP",
  permissions: readonly string[],
): AuthenticatedUser {
  return Object.freeze({
    id,
    email: `${id}@example.test`,
    fullName: role,
    roles: Object.freeze([role]),
    permissions: new Set(permissions) as AuthenticatedUser["permissions"],
    operatingMode: "SINGLE_MANAGER",
    mustChangePassword: false,
  });
}

function command(actorValue: AuthenticatedUser, idempotencyKey: string): FieldVisitCommandContext {
  return Object.freeze({
    actor: actorValue,
    request: Object.freeze({
      requestId: randomUUID(),
      ipAddress: "127.0.0.1",
      userAgent: "vitest-field-visits",
    }),
    idempotencyKey,
    sessionId: randomUUID(),
  });
}
