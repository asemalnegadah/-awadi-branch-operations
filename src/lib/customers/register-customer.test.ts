import { describe, expect, it } from "vitest";

import type { CustomerIdentityInput } from "./duplicate-screening";
import { createRegisterCustomerService } from "./register-customer";
import type { CustomerRegistrationRepository } from "./repository";
import type { CustomerRecord, NewCustomerRecord } from "./types";

const actorUserId = "11111111-1111-4111-8111-111111111111";
const generatedCustomerId = "22222222-2222-4222-8222-222222222222";

class InMemoryCustomerRepository implements CustomerRegistrationRepository {
  readonly customers: CustomerRecord[] = [];
  readonly registrations = new Map<string, string>();
  createCount = 0;

  async findByIdempotencyKey(key: string): Promise<CustomerRecord | null> {
    const customerId = this.registrations.get(key);
    return this.customers.find((customer) => customer.id === customerId) ?? null;
  }

  async findIdentityCandidates(
    _identity: CustomerIdentityInput,
  ): Promise<readonly CustomerRecord[]> {
    return this.customers;
  }

  async createWithIdempotency(
    customer: NewCustomerRecord,
    idempotencyKey: string,
  ): Promise<CustomerRecord> {
    this.createCount += 1;
    const stored = Object.freeze({ ...customer });
    this.customers.push(stored);
    this.registrations.set(idempotencyKey, stored.id);
    return stored;
  }
}

function existingCustomer(overrides: Partial<CustomerRecord> = {}): CustomerRecord {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    customerNumber: "60001",
    tradeNameAr: "متجر النور",
    ownerNameAr: undefined,
    customerType: "RETAIL",
    lifecycleStatus: "ACTIVE",
    creditStatus: "ALLOWED",
    notes: undefined,
    phones: ["967777111222"],
    externalIdentifiers: [
      { sourceSystem: "ONYX", externalIdentifier: "60001" },
    ],
    createdAt: "2026-07-13T00:00:00.000Z",
    createdBy: actorUserId,
    ...overrides,
  };
}

describe("Register customer service", () => {
  it("ينشئ عميلًا جديدًا عند عدم وجود مرشح تكرار", async () => {
    const repository = new InMemoryCustomerRepository();
    const register = createRegisterCustomerService({
      repository,
      generateId: () => generatedCustomerId,
      now: () => new Date("2026-07-13T12:00:00.000Z"),
    });

    const result = await register(
      { tradeNameAr: "متجر جديد", phones: ["777000111"] },
      { idempotencyKey: "customer-create-001", actorUserId },
    );

    expect(result.status).toBe("CREATED");
    expect(repository.createCount).toBe(1);

    if (result.status === "CREATED") {
      expect(result.customer.id).toBe(generatedCustomerId);
      expect(result.customer.createdAt).toBe("2026-07-13T12:00:00.000Z");
    }
  });

  it("يعيد النتيجة السابقة عند تكرار idempotency key", async () => {
    const repository = new InMemoryCustomerRepository();
    const register = createRegisterCustomerService({
      repository,
      generateId: () => generatedCustomerId,
    });
    const input = { tradeNameAr: "متجر جديد" };
    const context = { idempotencyKey: "customer-create-002", actorUserId };

    const first = await register(input, context);
    const second = await register(input, context);

    expect(first.status).toBe("CREATED");
    expect(second.status).toBe("REPLAYED");
    expect(repository.createCount).toBe(1);
  });

  it("يوقف الإنشاء عند وجود اسم مطابق ويطلب مراجعة بشرية", async () => {
    const repository = new InMemoryCustomerRepository();
    repository.customers.push(existingCustomer());
    const register = createRegisterCustomerService({ repository });

    const result = await register(
      { tradeNameAr: "متجر النور" },
      { idempotencyKey: "customer-create-003", actorUserId },
    );

    expect(result.status).toBe("DUPLICATE_REVIEW_REQUIRED");
    expect(repository.createCount).toBe(0);

    if (result.status === "DUPLICATE_REVIEW_REQUIRED") {
      expect(result.candidates[0]?.score).toBeGreaterThanOrEqual(30);
    }
  });

  it("يرفع المعرف الخارجي المطابق بأعلى أولوية", async () => {
    const repository = new InMemoryCustomerRepository();
    repository.customers.push(existingCustomer());
    const register = createRegisterCustomerService({ repository });

    const result = await register(
      {
        tradeNameAr: "اسم مختلف",
        externalIdentifiers: [
          { sourceSystem: "onyx", externalIdentifier: "60001" },
        ],
      },
      { idempotencyKey: "customer-create-004", actorUserId },
    );

    expect(result.status).toBe("DUPLICATE_REVIEW_REQUIRED");

    if (result.status === "DUPLICATE_REVIEW_REQUIRED") {
      expect(result.candidates[0]?.score).toBe(100);
      expect(result.candidates[0]?.signals).toContain(
        "EXACT_EXTERNAL_IDENTIFIER",
      );
    }
  });

  it("يرفض سياقًا بلا مستخدم صالح", async () => {
    const repository = new InMemoryCustomerRepository();
    const register = createRegisterCustomerService({ repository });

    await expect(
      register(
        { tradeNameAr: "متجر جديد" },
        { idempotencyKey: "customer-create-005", actorUserId: "invalid" },
      ),
    ).rejects.toThrow();
  });
});
