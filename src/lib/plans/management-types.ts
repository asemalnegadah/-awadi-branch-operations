import type { DailyPlanTaskType } from "./types";

export interface UpdateDailyPlanItemInput {
  readonly version: number;
  readonly reason: string;
  readonly taskType?: DailyPlanTaskType | undefined;
  readonly objective?: string | undefined;
  readonly expectedResult?: string | undefined;
  readonly targetCollectionSrMinor?: number | undefined;
  readonly targetCollectionRgMinor?: number | undefined;
  readonly targetSalesSrMinor?: number | undefined;
  readonly targetSalesRgMinor?: number | undefined;
  readonly routeId?: string | null | undefined;
  readonly estimatedVisitMinutes?: number | undefined;
  readonly estimatedTravelMinutes?: number | undefined;
}

export interface DeleteDailyPlanItemInput {
  readonly version: number;
  readonly reason: string;
}
