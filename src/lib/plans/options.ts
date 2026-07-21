import type { Sql } from "postgres";

export interface DailyPlanRepresentativeOption {
  readonly id: string;
  readonly name: string;
  readonly employeeCode: string | null;
}

export interface DailyPlanRouteOption {
  readonly id: string;
  readonly name: string;
  readonly areaId: string;
  readonly areaName: string;
  readonly estimatedTravelMinutes: number;
  readonly defaultVisitMinutes: number;
}

export interface DailyPlanFormOptions {
  readonly representatives: readonly DailyPlanRepresentativeOption[];
  readonly routes: readonly DailyPlanRouteOption[];
}

export async function getDailyPlanFormOptionsPostgres(
  sql: Sql,
): Promise<DailyPlanFormOptions> {
  const [representativeRows, routeRows] = await Promise.all([
    sql.unsafe<Array<{
      id: string;
      name: string;
      employee_code: string | null;
    }>>(
      `
        SELECT id, full_name_ar AS name, employee_code
        FROM sales_representatives
        WHERE status = 'ACTIVE' AND deleted_at IS NULL
        ORDER BY full_name_ar, id
      `,
    ),
    sql.unsafe<Array<{
      id: string;
      name: string;
      area_id: string;
      area_name: string;
      estimated_travel_minutes: string | number;
      default_visit_minutes: string | number;
    }>>(
      `
        SELECT
          route.id,
          route.name_ar AS name,
          route.area_id,
          area.name_ar AS area_name,
          route.estimated_travel_minutes,
          route.default_visit_minutes
        FROM routes AS route
        JOIN areas AS area ON area.id = route.area_id
        WHERE route.is_active = true
        ORDER BY area.name_ar, route.name_ar, route.id
      `,
    ),
  ]);

  return Object.freeze({
    representatives: Object.freeze(representativeRows.map((row) => Object.freeze({
      id: row.id,
      name: row.name,
      employeeCode: row.employee_code,
    }))),
    routes: Object.freeze(routeRows.map((row) => Object.freeze({
      id: row.id,
      name: row.name,
      areaId: row.area_id,
      areaName: row.area_name,
      estimatedTravelMinutes: safeInteger(row.estimated_travel_minutes),
      defaultVisitMinutes: safeInteger(row.default_visit_minutes),
    }))),
  });
}

function safeInteger(value: string | number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("daily plan option value is outside the safe integer range");
  }
  return number;
}
