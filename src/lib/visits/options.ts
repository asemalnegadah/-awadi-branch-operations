import type { Sql } from "postgres";

export interface FieldVisitPlanItemOption {
  readonly id: string;
  readonly planId: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly representativeId: string;
  readonly representativeName: string;
  readonly taskType: string;
  readonly objective: string;
}

export interface FieldVisitCustomerOption {
  readonly id: string;
  readonly name: string;
  readonly number: string | null;
}

export async function getFieldVisitFormOptionsPostgres(
  sql: Sql,
  representativeScopeId?: string,
) {
  const [planRows, customerRows] = await Promise.all([
    sql.unsafe<{
      id: string;
      plan_id: string;
      customer_id: string;
      customer_name: string;
      representative_id: string;
      representative_name: string;
      task_type: string;
      objective: string;
    }[]>(
      `SELECT item.id, item.plan_id, item.customer_id,
              customer.trade_name_ar AS customer_name,
              plan.representative_id,
              representative.full_name_ar AS representative_name,
              item.task_type, item.objective
       FROM daily_plan_items AS item
       JOIN daily_plans AS plan ON plan.id = item.plan_id
       JOIN customers AS customer ON customer.id = item.customer_id
       JOIN sales_representatives AS representative ON representative.id = plan.representative_id
       WHERE plan.state IN ('APPROVED', 'IN_PROGRESS')
         AND plan.plan_date = (now() AT TIME ZONE 'Asia/Aden')::date
         AND ($1::uuid IS NULL OR plan.representative_id = $1::uuid)
         AND NOT EXISTS (
           SELECT 1 FROM field_visits AS visit
           WHERE visit.plan_item_id = item.id
             AND visit.state <> 'CANCELLED'
         )
       ORDER BY representative.full_name_ar, item.sequence_number`,
      [representativeScopeId ?? null],
    ),
    sql.unsafe<{ id: string; name: string; number: string | null }[]>(
      `SELECT customer.id, customer.trade_name_ar AS name, customer.customer_number AS number
       FROM customers AS customer
       WHERE customer.deleted_at IS NULL
         AND customer.merged_into_customer_id IS NULL
         AND customer.lifecycle_status NOT IN ('PERMANENTLY_CLOSED', 'BANKRUPT')
         AND (
           $1::uuid IS NULL
           OR EXISTS (
             SELECT 1 FROM customer_rep_assignments AS assignment
             WHERE assignment.customer_id = customer.id
               AND assignment.representative_id = $1::uuid
               AND assignment.valid_from <= now()
               AND (assignment.valid_until IS NULL OR assignment.valid_until > now())
           )
         )
       ORDER BY customer.trade_name_ar
       LIMIT 500`,
      [representativeScopeId ?? null],
    ),
  ]);
  return Object.freeze({
    planItems: Object.freeze(planRows.map((row) => Object.freeze({
      id: row.id,
      planId: row.plan_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      representativeId: row.representative_id,
      representativeName: row.representative_name,
      taskType: row.task_type,
      objective: row.objective,
    }))),
    customers: Object.freeze(customerRows.map((row) => Object.freeze({
      id: row.id,
      name: row.name,
      number: row.number,
    }))),
  });
}
