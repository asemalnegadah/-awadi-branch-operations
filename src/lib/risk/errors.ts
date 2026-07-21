export class CreditRiskInputError extends Error {
  constructor(message = "بيانات المخاطر غير صالحة.") {
    super(message);
    this.name = "CreditRiskInputError";
  }
}

export class CreditRiskNotFoundError extends Error {
  constructor(message = "لم يتم العثور على سجل المخاطر المطلوب.") {
    super(message);
    this.name = "CreditRiskNotFoundError";
  }
}

export class CreditRiskConflictError extends Error {
  constructor(message = "تعارضت العملية مع الحالة الحالية للسجل.") {
    super(message);
    this.name = "CreditRiskConflictError";
  }
}

export class CreditRiskIdempotencyConflictError extends Error {
  constructor(message = "استخدم مفتاح منع التكرار نفسه لعملية مختلفة.") {
    super(message);
    this.name = "CreditRiskIdempotencyConflictError";
  }
}

export class CreditRiskBusinessRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditRiskBusinessRuleError";
  }
}
