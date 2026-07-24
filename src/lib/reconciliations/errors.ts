export class ReconciliationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconciliationInputError";
  }
}

export class ReconciliationNotFoundError extends Error {
  constructor(message = "لم يتم العثور على المطابقة المطلوبة.") {
    super(message);
    this.name = "ReconciliationNotFoundError";
  }
}

export class ReconciliationConflictError extends Error {
  constructor(message = "تغيرت المطابقة أو لم تعد حالتها تسمح بالعملية.") {
    super(message);
    this.name = "ReconciliationConflictError";
  }
}

export class ReconciliationIdempotencyConflictError extends Error {
  constructor() {
    super("تم استخدام مفتاح منع التكرار نفسه لطلب مختلف.");
    this.name = "ReconciliationIdempotencyConflictError";
  }
}

export class ReconciliationBusinessRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconciliationBusinessRuleError";
  }
}
