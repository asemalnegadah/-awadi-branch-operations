import { z } from "zod";

export const customerTypes = [
  "RETAIL",
  "SUPERMARKET",
  "WHOLESALE",
  "STRATEGIC",
  "OTHER",
] as const;

export const customerLifecycleStatuses = [
  "ACTIVE",
  "TEMPORARILY_CLOSED",
  "PERMANENTLY_CLOSED",
  "BANKRUPT",
  "SUSPENDED",
  "UNDER_REVIEW",
] as const;

export const customerCreditStatuses = [
  "ALLOWED",
  "BLOCKED",
  "EXCEPTION_REQUIRED",
] as const;

const optionalTrimmedText = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

export const createCustomerSchema = z.object({
  customerNumber: optionalTrimmedText,
  tradeNameAr: z.string().trim().min(2).max(200),
  ownerNameAr: optionalTrimmedText,
  customerType: z.enum(customerTypes).default("RETAIL"),
  lifecycleStatus: z.enum(customerLifecycleStatuses).default("ACTIVE"),
  creditStatus: z.enum(customerCreditStatuses).default("ALLOWED"),
  notes: z.string().trim().max(2000).optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export function parseCreateCustomerInput(input: unknown): CreateCustomerInput {
  return createCustomerSchema.parse(input);
}
