# مخططات حالات العمليات

**الحالة:** مسودة تنفيذية أولى  
**المبدأ:** كل انتقال حالة يحتاج صلاحية، سببًا عند الرفض أو الإرجاع، وسجل تدقيق.

## 1. التحصيل

المسار الأساسي:

`DRAFT → SUBMITTED → REVIEWED → APPROVED → CASH_RECEIVED → RECONCILED → CLOSED`

المسارات الجانبية:

- `SUBMITTED → RETURNED`
- `SUBMITTED → CONFLICTED`
- `SUBMITTED → REJECTED`
- `REVIEWED → RETURNED`
- `REVIEWED → CONFLICTED`
- `REVIEWED → REJECTED`
- `APPROVED → REVERSED`
- `CASH_RECEIVED → CONFLICTED`
- `CASH_RECEIVED → REVERSED`
- `RECONCILED → CONFLICTED`
- `RECONCILED → REVERSED`
- `CLOSED → REVERSED`

قواعد:

- لا يعتمد التحصيل من `DRAFT` مباشرة.
- لا يغلق قبل استلام النقدية والمطابقة.
- لا يعدل التحصيل بعد `APPROVED`؛ التصحيح بالعكس.
- `REJECTED` و`REVERSED` حالتان نهائيتان.

## 2. الوعد

`DRAFT → OPEN → DUE → FULFILLED`

مسارات إضافية:

- `DUE → PARTIALLY_FULFILLED`
- `DUE → BROKEN`
- `OPEN → RESCHEDULED`
- `BROKEN → RESCHEDULED`
- `OPEN → CANCELLED_BY_DECISION`

قواعد:

- إعادة الجدولة تنشئ إصدارًا جديدًا مرتبطًا بالوعد السابق.
- الوفاء يرتبط بتحصيل أو دليل معتمد.
- الكسر يحسب آليًا بعد تجاوز وقت الاستحقاق وفق وقت الخادم.

## 3. الخطة اليومية

`DRAFT → UNDER_REVIEW → APPROVED → ACTIVE → COMPLETED`

مسارات إضافية:

- `UNDER_REVIEW → RETURNED`
- `APPROVED → SUPERSEDED`
- `ACTIVE → PARTIALLY_COMPLETED`
- `ACTIVE → CANCELLED_BY_DECISION`

قواعد:

- الخطة المعتمدة لا تعدل؛ ينشأ إصدار جديد.
- لا تنتقل إلى `ACTIVE` قبل وقت بدء العمل.
- كل عنصر خطة يحتفظ بسبب اختياره وإصدار قواعد التخطيط.

## 4. الزيارة

`PLANNED → STARTED → RESULT_RECORDED → VERIFIED → CLOSED`

مسارات إضافية:

- `PLANNED → SKIPPED_WITH_REASON`
- `STARTED → FAILED`
- `RESULT_RECORDED → RETURNED_FOR_EVIDENCE`
- زيارة خارج الخطة تبدأ من `UNPLANNED_REQUIRES_JUSTIFICATION`.

قواعد:

- لا تعتبر الزيارة ناجحة لمجرد بدءها.
- النتيجة الموثقة شرط للإغلاق.
- الموقع والصورة يخضعان لسياسة الخصوصية والاتصال.

## 5. المطابقة

`DRAFT → ACCOUNTING_REVIEW → REP_STATEMENT → MANAGER_DECISION → APPROVED → POSTED`

مسارات إضافية:

- أي مرحلة مراجعة يمكن أن تعيد العملية إلى `RETURNED`.
- التعارض غير المحلول ينتقل إلى `CONFLICTED`.
- بعد `POSTED` لا تعدل المطابقة؛ ينشأ تصحيح جديد.

## 6. الاستيراد والبوابات

`UPLOADED → HASHED → CLASSIFIED → EXTRACTED → GATE1_REGISTERED → GATE2_VALIDATED → GATE3_PREVIEWED → APPROVED_FOR_COMMIT → COMMITTED → GATE4_ACTIONS_CREATED → GATE5_PLANS_CREATED`

مسارات إضافية:

- `DUPLICATE_REJECTED`
- `QUARANTINED`
- `VALIDATION_FAILED`
- `COMMIT_FAILED`
- `ROLLED_BACK`

قواعد:

- لا يوجد Commit تلقائي بمجرد الرفع.
- فشل صف لا يخفيه؛ يسجل في الحجر مع السبب.
- إعادة المحاولة تستخدم نفس هوية الدفعة لمنع التكرار.

## 7. الإغلاق اليومي

`OPEN → READY_FOR_REVIEW → INCOMPLETE → COMPLETE → APPROVED`

إعادة الفتح:

`APPROVED → REOPEN_REQUESTED → REOPEN_APPROVED → REOPENED → COMPLETE_V2 → APPROVED_V2`

قواعد:

- يحتفظ النظام بكل إصدار إغلاق.
- لا تعدل النسخة السابقة بعد إعادة الفتح.
- سبب إعادة الفتح وموافقته إلزاميان.

## 8. المتطلبات التقنية العامة

كل انتقال يسجل:

- الحالة السابقة والجديدة.
- المستخدم.
- وقت الخادم.
- السبب.
- معرف الطلب.
- الصلاحية المستخدمة.
- الموافقة الإضافية إن وجدت.
- القيم المتغيرة.

يمنع تنفيذ انتقال غير معرف حتى لو سمحت الواجهة به خطأً.
