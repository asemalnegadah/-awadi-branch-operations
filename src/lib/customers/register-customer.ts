import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  screenPotentialDuplicate,
  type DuplicateSignal,
} from "./duplicate-screening";
import type { CustomerRegistrationRepository } from "./repository";
import { createCustomerSchema } from "./schema";
import type { CustomerRecord } from "./types";

const externalIdentifierSchema = z.object({
  sourceSystem: z.string().trim().min(1).max(100),
  externalIdentifier: z.string().trim().min(1).max(200),
});

export const registerCustomerInputSchema = createCustomerSchema.extend({
  phones: z.array(z.string().trim().min(5).max(30)).max(10).default([]),
  externalIdentifiers: z.array(externalIdentifierSchema).max(20).default([]),
});

const registrationContextSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  actorUserId: z.string().uuid(),
});

export type RegisterCustomerInput = z.infer<typeof registerCustomerInputSchema>;

export interface DuplicateCandidateResult {
  readonly customerId: string;
  readonly tradeNameAr: string;
  readonly score: number;
  readonly signals: readonly DuplicateSignal[];
}

export type RegisterCustomerResult =
  | {
      readonly status: "CREATED";
      readonly customer: CustomerRecord;
      readonly replayed: false;
    }
  | {
      readonly status: "REPLAYED";
      readonly customer: CustomerRecord;
      readonly replayed: true;
    }
  | {
      readonly status: "DUPLICATE_REVIEW_REQUIRED";
      readonly candidates: readonly DuplicateCandidateResult[];
      readonly replayed: false;
    };

interface RegisterCustomerDependencies {
  readonly repository: CustomerRegistrationRepository;
  readonly generateId?: () => string;
  readonly now?: () => Date;
}

export function createRegisterCustomerService({
  repository,
  generateId = randomUUID,
  now = () => new Date(),
}: RegisterCustomerDependencies) {
  return async function registerCustomer(
    rawInput: unknown,
    rawContext: unknown,
  ): Promise<RegisterCustomerResult> {
    const input = registerCustomerInputSchema.parse(rawInput);
    const context = registrationContextSchema.parse(rawContext);

    const replayedCustomer = await repository.findByIdempotencyKey(
      context.idempotencyKey,
    );

    if (replayedCustomer) {
      return Object.freeze({
        status: "REPLAYED" as const,
        customer: replayedCustomer,
        replayed: true as const,
      });
    }

    const identityCandidates = await repository.findIdentityCandidates(input);

    const duplicateCandidates = identityCandidates
      .map((candidate) => {
        const screening = screenPotentialDuplicate(input, candidate);

        return {
          customerId: candidate.id,
          tradeNameAr: candidate.tradeNameAr,
          score: screening.score,
          signals: screening.signals,
          requiresHumanReview: screening.requiresHumanReview,
        };
      })
      .filter((candidate) => candidate.requiresHumanReview)
      .sort((left, right) => right.score - left.score)
      .map(({ requiresHumanReview: _requiresHumanReview, ...candidate }) =>
        Object.freeze(candidate),
      );

    if (duplicateCandidates.length > 0) {
      return Object.freeze({
        status: "DUPLICATE_REVIEW_REQUIRED" as const,
        candidates: Object.freeze(duplicateCandidates),
        replayed: false as const,
      });
    }

    const customer = await repository.createWithIdempotency(
      {
        ...input,
        id: generateId(),
        createdAt: now().toISOString(),
        createdBy: context.actorUserId,
      },
      context.idempotencyKey,
    );

    return Object.freeze({
      status: "CREATED" as const,
      customer,
      replayed: false as const,
    });
  };
}
