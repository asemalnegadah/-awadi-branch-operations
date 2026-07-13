import type { CustomerIdentityInput } from "./duplicate-screening";
import type { CustomerRecord, NewCustomerRecord } from "./types";

export interface CustomerRegistrationRepository {
  findByIdempotencyKey(idempotencyKey: string): Promise<CustomerRecord | null>;

  findIdentityCandidates(
    identity: CustomerIdentityInput,
  ): Promise<readonly CustomerRecord[]>;

  createWithIdempotency(
    customer: NewCustomerRecord,
    idempotencyKey: string,
  ): Promise<CustomerRecord>;
}
