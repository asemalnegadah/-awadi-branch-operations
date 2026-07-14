import type { CurrencyCode } from "@/lib/domain/currency";

import {
  normalizeArabicName,
  normalizeCustomerNumber,
  normalizeExternalIdentifier,
  normalizePhone,
} from "./identity";

export interface ExtractedCustomerIdentity {
  /** رقم حساب/كود العميل، وليس رقم الهاتف. */
  readonly customerNumber?: string | undefined;
  readonly currency?: CurrencyCode | undefined;
  readonly customerName: string;
  readonly phones?: readonly string[] | undefined;
  readonly sourceSystem?: string | undefined;
  readonly externalIdentifier?: string | undefined;
  readonly representativeName?: string | undefined;
  readonly areaName?: string | undefined;
}

export interface CustomerAccountIdentity {
  /** رقم العميل المحاسبي داخل العملة المحددة. */
  readonly customerNumber: string;
  readonly currency: CurrencyCode;
}

export interface CustomerIdentityCandidate {
  readonly id: string;
  readonly tradeNameAr: string;
  readonly accountIdentities: readonly CustomerAccountIdentity[];
  readonly phones?: readonly string[] | undefined;
  readonly externalIdentifiers?:
    | readonly {
        sourceSystem: string;
        externalIdentifier: string;
      }[]
    | undefined;
  readonly representativeName?: string | undefined;
  readonly areaName?: string | undefined;
}

export type CustomerMatchSignal =
  | "EXACT_CUSTOMER_NUMBER"
  | "EXACT_CUSTOMER_NUMBER_AND_CURRENCY"
  | "EXACT_EXTERNAL_IDENTIFIER"
  | "EXACT_PHONE"
  | "EXACT_NAME"
  | "TRUNCATED_NAME_PREFIX"
  | "REPRESENTATIVE_MATCH"
  | "AREA_MATCH";

export type CustomerNameRelationship =
  | "EXACT"
  | "TRUNCATED_PREFIX"
  | "DIFFERENT";

export type CustomerResolutionStatus =
  | "MATCHED_BY_CUSTOMER_NUMBER"
  | "MATCHED_BY_EXTERNAL_IDENTIFIER"
  | "REVIEW_REQUIRED"
  | "AMBIGUOUS"
  | "CONFLICT"
  | "UNMATCHED";

export interface CustomerResolutionCandidate {
  readonly customerId: string;
  readonly canonicalName: string;
  readonly nameRelationship: CustomerNameRelationship;
  readonly signals: readonly CustomerMatchSignal[];
  readonly confidence: number;
}

export interface CustomerResolutionResult {
  readonly status: CustomerResolutionStatus;
  readonly matchedCustomerId?: string | undefined;
  readonly canonicalCustomerName?: string | undefined;
  readonly extractedCustomerName: string;
  readonly nameRelationship?: CustomerNameRelationship | undefined;
  readonly autoLinkAllowed: boolean;
  readonly confidence: number;
  readonly candidates: readonly CustomerResolutionCandidate[];
  readonly warnings: readonly string[];
}

export function resolveExtractedCustomer(
  extracted: ExtractedCustomerIdentity,
  candidates: readonly CustomerIdentityCandidate[],
): CustomerResolutionResult {
  const extractedName = extracted.customerName.trim();
  if (!extractedName) {
    throw new Error("اسم العميل المستخرج إلزامي لعملية المطابقة.");
  }

  const scored = candidates
    .map((candidate) => scoreCandidate(extracted, candidate))
    .filter((candidate) => candidate.signals.length > 0)
    .sort((left, right) => right.confidence - left.confidence);

  const accountMatches = scored.filter((candidate) =>
    candidate.signals.some(
      (signal) =>
        signal === "EXACT_CUSTOMER_NUMBER" ||
        signal === "EXACT_CUSTOMER_NUMBER_AND_CURRENCY",
    ),
  );

  if (accountMatches.length > 0) {
    const uniqueCustomerIds = new Set(
      accountMatches.map((candidate) => candidate.customerId),
    );

    if (uniqueCustomerIds.size > 1) {
      return freezeResult({
        status: "CONFLICT",
        extractedCustomerName: extractedName,
        autoLinkAllowed: false,
        confidence: 0,
        candidates: accountMatches,
        warnings: [
          "رقم العميل المحاسبي مرتبط بأكثر من عميل؛ يمنع الربط حتى تصحيح السجل الرئيسي.",
        ],
      });
    }

    const winner = accountMatches[0];
    if (!winner) {
      throw new Error("تعذر تحديد العميل المطابق برقم العميل.");
    }

    const conflictingPhoneCandidate = scored.find(
      (candidate) =>
        candidate.customerId !== winner.customerId &&
        candidate.signals.includes("EXACT_PHONE"),
    );

    if (conflictingPhoneCandidate) {
      return freezeResult({
        status: "CONFLICT",
        extractedCustomerName: extractedName,
        autoLinkAllowed: false,
        confidence: winner.confidence,
        candidates: [winner, conflictingPhoneCandidate],
        warnings: [
          "رقم العميل يشير إلى عميل، بينما الهاتف يشير إلى عميل آخر؛ يجب مراجعة الصف.",
        ],
      });
    }

    if (winner.nameRelationship === "DIFFERENT") {
      return freezeResult({
        status: "CONFLICT",
        extractedCustomerName: extractedName,
        autoLinkAllowed: false,
        confidence: winner.confidence,
        candidates: [winner],
        warnings: [
          "رقم العميل مطابق لكن الاسم المستخرج مختلف وليس مجرد اسم مقطوع.",
        ],
      });
    }

    return freezeResult({
      status: "MATCHED_BY_CUSTOMER_NUMBER",
      matchedCustomerId: winner.customerId,
      canonicalCustomerName: winner.canonicalName,
      extractedCustomerName: extractedName,
      nameRelationship: winner.nameRelationship,
      autoLinkAllowed: true,
      confidence: winner.confidence,
      candidates: [winner],
      warnings: nameWarnings(winner.nameRelationship),
    });
  }

  const externalMatches = scored.filter((candidate) =>
    candidate.signals.includes("EXACT_EXTERNAL_IDENTIFIER"),
  );

  if (externalMatches.length === 1) {
    const winner = externalMatches[0];
    if (!winner) {
      throw new Error("تعذر تحديد العميل بالمعرف الخارجي.");
    }

    if (winner.nameRelationship === "DIFFERENT") {
      return freezeResult({
        status: "CONFLICT",
        extractedCustomerName: extractedName,
        autoLinkAllowed: false,
        confidence: winner.confidence,
        candidates: [winner],
        warnings: ["المعرف الخارجي مطابق لكن اسم العميل مختلف."],
      });
    }

    return freezeResult({
      status: "MATCHED_BY_EXTERNAL_IDENTIFIER",
      matchedCustomerId: winner.customerId,
      canonicalCustomerName: winner.canonicalName,
      extractedCustomerName: extractedName,
      nameRelationship: winner.nameRelationship,
      autoLinkAllowed: true,
      confidence: winner.confidence,
      candidates: [winner],
      warnings: nameWarnings(winner.nameRelationship),
    });
  }

  if (externalMatches.length > 1) {
    return freezeResult({
      status: "CONFLICT",
      extractedCustomerName: extractedName,
      autoLinkAllowed: false,
      confidence: 0,
      candidates: externalMatches,
      warnings: ["المعرف الخارجي مرتبط بأكثر من عميل."],
    });
  }

  const supportingMatches = scored.filter(
    (candidate) =>
      candidate.signals.includes("EXACT_PHONE") ||
      candidate.signals.includes("EXACT_NAME") ||
      candidate.signals.includes("TRUNCATED_NAME_PREFIX"),
  );

  if (supportingMatches.length === 1) {
    const candidate = supportingMatches[0];
    if (!candidate) {
      throw new Error("تعذر تحديد مرشح المطابقة.");
    }

    return freezeResult({
      status: "REVIEW_REQUIRED",
      extractedCustomerName: extractedName,
      nameRelationship: candidate.nameRelationship,
      autoLinkAllowed: false,
      confidence: candidate.confidence,
      candidates: [candidate],
      warnings: [
        ...nameWarnings(candidate.nameRelationship),
        "الهاتف أو الاسم إشارات مساعدة فقط، وليسا بديلًا عن رقم العميل المحاسبي.",
      ],
    });
  }

  if (supportingMatches.length > 1) {
    return freezeResult({
      status: "AMBIGUOUS",
      extractedCustomerName: extractedName,
      autoLinkAllowed: false,
      confidence: supportingMatches[0]?.confidence ?? 0,
      candidates: supportingMatches.slice(0, 10),
      warnings: [
        "وجد أكثر من مرشح بالاسم أو الهاتف، ويجب تحديد رقم العميل الصحيح.",
      ],
    });
  }

  return freezeResult({
    status: "UNMATCHED",
    extractedCustomerName: extractedName,
    autoLinkAllowed: false,
    confidence: 0,
    candidates: [],
    warnings: ["لم يتم العثور على عميل مطابق في السجل الرئيسي."],
  });
}

export function detectCustomerNameRelationship(
  extractedName: string,
  canonicalName: string,
): CustomerNameRelationship {
  const extracted = normalizeArabicName(extractedName);
  const canonical = normalizeArabicName(canonicalName);

  if (extracted === canonical) {
    return "EXACT";
  }

  if (isLikelyTruncatedPrefix(extracted, canonical)) {
    return "TRUNCATED_PREFIX";
  }

  return "DIFFERENT";
}

function scoreCandidate(
  extracted: ExtractedCustomerIdentity,
  candidate: CustomerIdentityCandidate,
): CustomerResolutionCandidate {
  const signals: CustomerMatchSignal[] = [];
  const nameRelationship = detectCustomerNameRelationship(
    extracted.customerName,
    candidate.tradeNameAr,
  );

  if (matchesCustomerAccountNumber(extracted, candidate)) {
    signals.push(
      extracted.currency
        ? "EXACT_CUSTOMER_NUMBER_AND_CURRENCY"
        : "EXACT_CUSTOMER_NUMBER",
    );
  }

  if (matchesExternalIdentifier(extracted, candidate)) {
    signals.push("EXACT_EXTERNAL_IDENTIFIER");
  }

  if (matchesPhone(extracted.phones, candidate.phones)) {
    signals.push("EXACT_PHONE");
  }

  if (nameRelationship === "EXACT") {
    signals.push("EXACT_NAME");
  } else if (nameRelationship === "TRUNCATED_PREFIX") {
    signals.push("TRUNCATED_NAME_PREFIX");
  }

  if (
    normalizedOptional(extracted.representativeName) &&
    normalizedOptional(extracted.representativeName) ===
      normalizedOptional(candidate.representativeName)
  ) {
    signals.push("REPRESENTATIVE_MATCH");
  }

  if (
    normalizedOptional(extracted.areaName) &&
    normalizedOptional(extracted.areaName) === normalizedOptional(candidate.areaName)
  ) {
    signals.push("AREA_MATCH");
  }

  return Object.freeze({
    customerId: candidate.id,
    canonicalName: candidate.tradeNameAr,
    nameRelationship,
    signals: Object.freeze(signals),
    confidence: calculateConfidence(signals),
  });
}

function matchesCustomerAccountNumber(
  extracted: ExtractedCustomerIdentity,
  candidate: CustomerIdentityCandidate,
): boolean {
  if (!extracted.customerNumber) {
    return false;
  }

  const number = normalizeCustomerNumber(extracted.customerNumber);

  return candidate.accountIdentities.some(
    (identity) =>
      normalizeCustomerNumber(identity.customerNumber) === number &&
      (!extracted.currency || identity.currency === extracted.currency),
  );
}

function matchesExternalIdentifier(
  extracted: ExtractedCustomerIdentity,
  candidate: CustomerIdentityCandidate,
): boolean {
  if (
    !extracted.sourceSystem ||
    !extracted.externalIdentifier ||
    !candidate.externalIdentifiers?.length
  ) {
    return false;
  }

  const sourceSystem = normalizeExternalIdentifier(extracted.sourceSystem);
  const externalIdentifier = normalizeExternalIdentifier(
    extracted.externalIdentifier,
  );

  return candidate.externalIdentifiers.some(
    (identifier) =>
      normalizeExternalIdentifier(identifier.sourceSystem) === sourceSystem &&
      normalizeExternalIdentifier(identifier.externalIdentifier) ===
        externalIdentifier,
  );
}

function matchesPhone(
  extractedPhones: readonly string[] | undefined,
  candidatePhones: readonly string[] | undefined,
): boolean {
  if (!extractedPhones?.length || !candidatePhones?.length) {
    return false;
  }

  const candidateSet = new Set(
    candidatePhones.map(normalizePhone).filter(Boolean),
  );

  return extractedPhones
    .map(normalizePhone)
    .some((phone) => phone.length > 0 && candidateSet.has(phone));
}

function isLikelyTruncatedPrefix(
  extractedNormalized: string,
  canonicalNormalized: string,
): boolean {
  if (
    extractedNormalized.length < 4 ||
    extractedNormalized.length >= canonicalNormalized.length
  ) {
    return false;
  }

  if (!canonicalNormalized.startsWith(extractedNormalized)) {
    return false;
  }

  const nextCharacter = canonicalNormalized.at(extractedNormalized.length);
  const extractedTokenCount = extractedNormalized.split(" ").filter(Boolean).length;

  return nextCharacter === " " || extractedTokenCount >= 2;
}

function calculateConfidence(signals: readonly CustomerMatchSignal[]): number {
  let score = 0;

  for (const signal of signals) {
    switch (signal) {
      case "EXACT_CUSTOMER_NUMBER_AND_CURRENCY":
        score += 0.98;
        break;
      case "EXACT_CUSTOMER_NUMBER":
        score += 0.95;
        break;
      case "EXACT_EXTERNAL_IDENTIFIER":
        score += 0.94;
        break;
      case "EXACT_PHONE":
        score += 0.45;
        break;
      case "EXACT_NAME":
        score += 0.35;
        break;
      case "TRUNCATED_NAME_PREFIX":
        score += 0.25;
        break;
      case "REPRESENTATIVE_MATCH":
        score += 0.08;
        break;
      case "AREA_MATCH":
        score += 0.05;
        break;
    }
  }

  return Math.min(1, Math.round(score * 10_000) / 10_000);
}

function normalizedOptional(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  return normalizeArabicName(value);
}

function nameWarnings(
  relationship: CustomerNameRelationship,
): readonly string[] {
  if (relationship === "TRUNCATED_PREFIX") {
    return [
      "اسم العميل في PDF مقطوع؛ تم الربط برقم العميل واستخدام الاسم الكامل من السجل الرئيسي.",
    ];
  }

  return [];
}

function freezeResult(
  result: Omit<CustomerResolutionResult, "candidates" | "warnings"> & {
    readonly candidates: readonly CustomerResolutionCandidate[];
    readonly warnings: readonly string[];
  },
): CustomerResolutionResult {
  return Object.freeze({
    ...result,
    candidates: Object.freeze([...result.candidates]),
    warnings: Object.freeze([...result.warnings]),
  });
}
