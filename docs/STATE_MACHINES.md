# مخططات حالات العمليات

**الحالة:** مسودة تنفيذية أولى

## 1. قواعد عامة

- كل انتقال حالة ينفذ عبر أمر صريح في طبقة الأعمال.
- لا تعدل الحالة مباشرة من الواجهة أو SQL التشغيلي.
- كل انتقال يسجل المستخدم والسبب والوقت ونتيجة التحقق.
- الانتقال غير المسموح يرفض حتى لو كان المستخدم يملك صلاحية عامة.
- العمليات المالية المعتمدة لا تعاد إلى مسودة؛ تستخدم حركة عكسية أو مسار تصحيح.

---

## 2. التحصيل

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> SUBMITTED: إرسال المندوب
  DRAFT --> CANCELLED: إلغاء قبل الإرسال
  SUBMITTED --> UNDER_REVIEW: بدء مراجعة الحسابات
  SUBMITTED --> RETURNED: نقص أو خطأ
  UNDER_REVIEW --> REVIEWED: صحة السند والبيانات
  UNDER_REVIEW --> RETURNED: يحتاج تصحيحًا
  UNDER_REVIEW --> REJECTED: غير صحيح
  RETURNED --> DRAFT: تصحيح المنشئ
  REVIEWED --> HANDED_OVER: إدراج في دفعة تسليم
  HANDED_OVER --> CASH_RECEIVED: استلام الصندوق
  CASH_RECEIVED --> RECONCILED: مطابقة النقدية والسند
  RECONCILED --> POSTED: ترحيل دفتر الحركة
  POSTED --> REVERSED: حركة عكسية معتمدة
  REJECTED --> [*]
  CANCELLED --> [*]
  REVERSED --> [*]
```

### أقفال المراحل

- بعد `SUBMITTED`: لا يغير المندوب المبلغ أو العملة مباشرة.
- بعد `REVIEWED`: لا يستبدل الإثبات.
- بعد `CASH_RECEIVED`: لا يخرج التحصيل من دفعة التسليم دون قرار موثق.
- بعد `POSTED`: التصحيح بالعكس فقط.

---

## 3. وعد السداد

```mermaid
stateDiagram-v2
  [*] --> OPEN
  OPEN --> DUE_TODAY: حلول الاستحقاق
  OPEN --> FULFILLED: سداد مبكر كامل
  OPEN --> PARTIALLY_FULFILLED: سداد جزئي
  DUE_TODAY --> FULFILLED: سداد كامل
  DUE_TODAY --> PARTIALLY_FULFILLED: سداد جزئي
  DUE_TODAY --> BROKEN: انتهاء اليوم دون وفاء
  PARTIALLY_FULFILLED --> FULFILLED: استكمال السداد
  PARTIALLY_FULFILLED --> BROKEN: انقضاء الموعد
  OPEN --> RESCHEDULED: اعتماد موعد جديد
  DUE_TODAY --> RESCHEDULED: اعتماد موعد جديد
  BROKEN --> RESCHEDULED: قرار متابعة جديد
  OPEN --> CANCELLED: قرار موثق
  RESCHEDULED --> [*]
  FULFILLED --> [*]
  CANCELLED --> [*]
```

إعادة الجدولة تنشئ وعدًا جديدًا مرتبطًا بالقديم، ولا تمحو حالة الوعد السابق.

---

## 4. خطة المندوب

```mermaid
stateDiagram-v2
  [*] --> GENERATED_DRAFT
  GENERATED_DRAFT --> UNDER_REVIEW: إرسال للمدير
  UNDER_REVIEW --> APPROVED: اعتماد
  UNDER_REVIEW --> GENERATED_DRAFT: إعادة للتعديل
  APPROVED --> PUBLISHED: إتاحة للمندوب
  PUBLISHED --> IN_PROGRESS: بدء اليوم
  IN_PROGRESS --> COMPLETED: انتهاء العناصر
  IN_PROGRESS --> CLOSED_WITH_GAPS: إغلاق مع نواقص معتمدة
  APPROVED --> SUPERSEDED: إصدار خطة بديلة
  PUBLISHED --> SUPERSEDED: إصدار بديل قبل البدء
  COMPLETED --> [*]
  CLOSED_WITH_GAPS --> [*]
  SUPERSEDED --> [*]
```

كل إصدار يحتفظ بوقت قطع البيانات وإصدار قواعد التخطيط.

---

## 5. المطابقة

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> ACCOUNTING_REVIEW
  ACCOUNTING_REVIEW --> REP_RESPONSE_REQUIRED
  ACCOUNTING_REVIEW --> MANAGER_DECISION
  REP_RESPONSE_REQUIRED --> MANAGER_DECISION
  MANAGER_DECISION --> APPROVED
  MANAGER_DECISION --> RETURNED
  RETURNED --> ACCOUNTING_REVIEW
  APPROVED --> ADJUSTMENT_CREATED
  ADJUSTMENT_CREATED --> POSTED
  POSTED --> CLOSED
  CLOSED --> [*]
```

لا يؤثر الفرق في الرصيد قبل `POSTED`.

---

## 6. دفعة الاستيراد

```mermaid
stateDiagram-v2
  [*] --> RECEIVED
  RECEIVED --> HASHED
  HASHED --> DUPLICATE_REJECTED: بصمة موجودة
  HASHED --> CLASSIFIED
  CLASSIFIED --> EXTRACTED
  EXTRACTED --> VALIDATED
  VALIDATED --> QUARANTINED: أخطاء حرجة
  VALIDATED --> PREVIEW_READY
  QUARANTINED --> VALIDATED: بعد المعالجة
  PREVIEW_READY --> APPROVED
  PREVIEW_READY --> REJECTED
  APPROVED --> COMMITTING
  COMMITTING --> COMMITTED
  COMMITTING --> FAILED
  FAILED --> PREVIEW_READY: إعادة آمنة
  COMMITTED --> [*]
  REJECTED --> [*]
  DUPLICATE_REJECTED --> [*]
```

---

## 7. الإغلاق اليومي

```mermaid
stateDiagram-v2
  [*] --> OPEN
  OPEN --> READY_FOR_REVIEW
  READY_FOR_REVIEW --> INCOMPLETE: نواقص
  INCOMPLETE --> OPEN: استكمال
  READY_FOR_REVIEW --> COMPLETE
  COMPLETE --> APPROVED
  APPROVED --> REOPEN_REQUESTED: اكتشاف خطأ
  REOPEN_REQUESTED --> REOPENED: موافقة وتحقق إضافي
  REOPEN_REQUESTED --> APPROVED: رفض الطلب
  REOPENED --> READY_FOR_REVIEW
  APPROVED --> [*]
```

إعادة الإغلاق تنشئ إصدارًا جديدًا وتحفظ التقرير السابق.

---

## 8. معايير القبول العامة

- يرفض كل انتقال غير معرف.
- يرفض اعتماد المنشئ لحركته الحساسة.
- لا يمكن تجاوز مرحلة مطلوبة باستدعاء API مباشر.
- يسجل سبب الإرجاع والرفض والعكس وإعادة الفتح.
- تحفظ الحالات السابقة في سجل أحداث مستقل.
