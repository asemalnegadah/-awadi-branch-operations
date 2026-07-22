import { z } from "zod";

import type { CreateFieldVisitInput } from "./types";

export interface CreateFieldVisitCommandInput extends CreateFieldVisitInput {
  readonly representativeId?: string | null | undefined;
}

const schema = z.object({
  representativeId: z.string().uuid("معرف المندوب غير صالح.").nullable().optional(),
  customerId: z.string().uuid("معرف العميل غير صالح."),
  planId: z.string().uuid("معرف الخطة غير صالح.").nullable().optional(),
  planItemId: z.string().uuid("معرف عنصر الخطة غير صالح.").nullable().optional(),
  visitType: z.enum([
    "COLLECTION",
    "SALES",
    "PROMISE_FOLLOWUP",
    "RECONCILIATION",
    "DATA_UPDATE",
    "PROBLEM_RESOLUTION",
    "MIXED",
  ]),
  objective: z.string().trim().min(2, "هدف الزيارة مطلوب.").max(2_000),
  outOfPlanReason: z.string().trim().min(2).max(2_000).nullable().optional(),
}).strict().superRefine((value, context) => {
  const hasPlan = value.planId !== null && value.planId !== undefined;
  const hasItem = value.planItemId !== null && value.planItemId !== undefined;
  if (hasPlan !== hasItem) {
    context.addIssue({
      code: "custom",
      path: ["planItemId"],
      message: "يجب إرسال معرف الخطة وعنصرها معًا أو تركهما معًا.",
    });
  }
  if (!hasPlan && !value.outOfPlanReason) {
    context.addIssue({
      code: "custom",
      path: ["outOfPlanReason"],
      message: "سبب الزيارة خارج الخطة مطلوب.",
    });
  }
  if (hasPlan && value.outOfPlanReason) {
    context.addIssue({
      code: "custom",
      path: ["outOfPlanReason"],
      message: "الزيارة المرتبطة بالخطة لا تقبل سببًا خارج الخطة.",
    });
  }
});

export function parseCreateFieldVisitCommand(value: unknown): CreateFieldVisitCommandInput {
  return schema.parse(value);
}
