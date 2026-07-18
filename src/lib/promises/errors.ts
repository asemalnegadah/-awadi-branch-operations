export class PromiseNotFoundError extends Error {
  constructor() {
    super("وعد السداد غير موجود أو غير متاح.");
    this.name = "PromiseNotFoundError";
  }
}

export class PromiseConflictError extends Error {
  constructor(message = "تم تعديل وعد السداد من عملية أخرى. حدّث الصفحة وحاول مجددًا.") {
    super(message);
    this.name = "PromiseConflictError";
  }
}

export class PromiseIdempotencyConflictError extends Error {
  constructor() {
    super("تم استخدام مفتاح منع التكرار نفسه لطلب مختلف.");
    this.name = "PromiseIdempotencyConflictError";
  }
}

export class PromiseBusinessRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromiseBusinessRuleError";
  }
}

export class PromiseInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromiseInputError";
  }
}
