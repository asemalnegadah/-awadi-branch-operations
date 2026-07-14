export const documentTypes = [
  "CUSTOMER_LIST",
  "DEBT_AGING",
  "COLLECTIONS",
  "SALES",
  "PROMISES",
  "INVENTORY",
  "RECONCILIATION",
  "UNKNOWN",
] as const;

export type DocumentType = (typeof documentTypes)[number];

export const extractedRowTypes = [
  "CUSTOMER",
  "DEBT_AGING",
  "COLLECTION",
  "SALE",
  "PROMISE",
  "INVENTORY",
  "RECONCILIATION",
  "UNKNOWN",
] as const;

export type ExtractedRowType = (typeof extractedRowTypes)[number];

export interface DocumentClassification {
  readonly documentType: DocumentType;
  readonly confidence: number;
  readonly matchedSignals: readonly string[];
}
