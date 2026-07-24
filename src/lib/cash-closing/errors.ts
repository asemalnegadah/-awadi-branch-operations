export class CashClosingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CashClosingInputError";
  }
}

export class CashClosingNotFoundError extends Error {
  constructor(message = "الإغلاق النقدي اليومي غير موجود.") {
    super(message);
    this.name = "CashClosingNotFoundError";
  }
}

export class CashClosingConflictError extends Error {
  constructor(message = "تغير الإغلاق النقدي بواسطة عملية أخرى. حدّث البيانات وأعد المحاولة.") {
    super(message);
    this.name = "CashClosingConflictError";
  }
}

export class CashClosingIdempotencyConflictError extends Error {
  constructor() {
    super("تم استخدام مفتاح منع التكرار نفسه لطلب نقدي مختلف.");
    this.name = "CashClosingIdempotencyConflictError";
  }
}

export class CashClosingBusinessRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CashClosingBusinessRuleError";
  }
}
