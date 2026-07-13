import type { CreateCustomerInput } from "./schema";

export interface CustomerExternalIdentifier {
  readonly sourceSystem: string;
  readonly externalIdentifier: string;
}

export interface CustomerRecord extends CreateCustomerInput {
  readonly id: string;
  readonly phones: readonly string[];
  readonly externalIdentifiers: readonly CustomerExternalIdentifier[];
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface NewCustomerRecord extends CreateCustomerInput {
  readonly id: string;
  readonly phones: readonly string[];
  readonly externalIdentifiers: readonly CustomerExternalIdentifier[];
  readonly createdAt: string;
  readonly createdBy: string;
}
