export class DailyPlanInputError extends Error {
  constructor(message = "بيانات الخطة اليومية غير صالحة.") {
    super(message);
    this.name = "DailyPlanInputError";
  }
}

export class DailyPlanNotFoundError extends Error {
  constructor(message = "لم يتم العثور على الخطة اليومية المطلوبة.") {
    super(message);
    this.name = "DailyPlanNotFoundError";
  }
}

export class DailyPlanConflictError extends Error {
  constructor(message = "تعارضت العملية مع الحالة الحالية للخطة.") {
    super(message);
    this.name = "DailyPlanConflictError";
  }
}

export class DailyPlanIdempotencyConflictError extends Error {
  constructor(message = "استخدم مفتاح منع التكرار نفسه لعملية مختلفة.") {
    super(message);
    this.name = "DailyPlanIdempotencyConflictError";
  }
}

export class DailyPlanBusinessRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DailyPlanBusinessRuleError";
  }
}
