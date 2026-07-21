import { z } from "zod";

import {
  dailyPlanTaskTypes,
} from "./types";
import type {
  DeleteDailyPlanItemInput,
  UpdateDailyPlanItemInput,
} from "./management-types";

const uuidSchema = z.string().uuid();
const versionSchema = z.number().int().safe().positive();
const nonnegativeMinorSchema = z.number().int().safe().nonnegative();
const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);

const updateSchema = z
  .object({
    version: versionSchema,
    reason: requiredText(1000),
    taskType: z.enum(dailyPlanTaskTypes).optional(),
    objective: requiredText(2000).optional(),
    expectedResult: requiredText(2000).optional(),
    targetCollectionSrMinor: nonnegativeMinorSchema.optional(),
    targetCollectionRgMinor: nonnegativeMinorSchema.optional(),
    targetSalesSrMinor: nonnegativeMinorSchema.optional(),
    targetSalesRgMinor: nonnegativeMinorSchema.optional(),
    routeId: uuidSchema.nullable().optional(),
    estimatedVisitMinutes: z.number().int().min(5).max(480).optional(),
    estimatedTravelMinutes: z.number().int().min(0).max(1440).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const changeKeys = Object.keys(value).filter(
      (key) => key !== "version" && key !== "reason",
    );
    if (changeKeys.length === 0) {
      context.addIssue({ code: "custom", message: "لا توجد حقول لتعديل عنصر الخطة." });
    }
  });

const deleteSchema = z
  .object({ version: versionSchema, reason: requiredText(1000) })
  .strict();

export function parseUpdateDailyPlanItemInput(input: unknown): UpdateDailyPlanItemInput {
  return updateSchema.parse(input);
}

export function parseDeleteDailyPlanItemInput(input: unknown): DeleteDailyPlanItemInput {
  return deleteSchema.parse(input);
}

export function parseDailyPlanItemId(value: string): string {
  return uuidSchema.parse(value);
}
