import { z } from "zod";

import type {
  ConsumeCreditExceptionInput,
  ReverseCreditExceptionUsageInput,
} from "./usage-types";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const sourceText = requiredText(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);

const consumeSchema = z
  .object({
    exceptionId: z.string().uuid(),
    amountMinor: z.number().int().safe().positive(),
    sourceType: sourceText,
    sourceId: sourceText,
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const reverseSchema = z
  .object({
    usageId: z.string().uuid(),
    reason: requiredText(1000),
  })
  .strict();

export function parseConsumeCreditExceptionInput(input: unknown): ConsumeCreditExceptionInput {
  return consumeSchema.parse(input);
}

export function parseReverseCreditExceptionUsageInput(
  input: unknown,
): ReverseCreditExceptionUsageInput {
  return reverseSchema.parse(input);
}
