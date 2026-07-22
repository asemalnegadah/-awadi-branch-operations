export class FieldVisitInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldVisitInputError";
  }
}

export class FieldVisitNotFoundError extends Error {
  constructor(message = "الزيارة المطلوبة غير موجودة.") {
    super(message);
    this.name = "FieldVisitNotFoundError";
  }
}

export class FieldVisitConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldVisitConflictError";
  }
}

export class FieldVisitIdempotencyConflictError extends Error {
  constructor(message = "مفتاح منع التكرار مستخدم لعملية مختلفة.") {
    super(message);
    this.name = "FieldVisitIdempotencyConflictError";
  }
}

export class FieldVisitBusinessRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldVisitBusinessRuleError";
  }
}
