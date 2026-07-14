# تشغيل النظام على Cloudflare Workers

## الهدف

تشغيل نسخة إنتاج واحدة للنظام على Cloudflare Workers، مرتبطة بقاعدة Neon الحقيقية وبحاوية R2 خاصة، دون حفظ أي سر داخل GitHub.

## المكونات المعتمدة

- الكود: GitHub، الفرع `main` فقط بعد نجاح CI والموافقة.
- التطبيق: Cloudflare Workers باستخدام OpenNext.
- قاعدة البيانات: Neon PostgreSQL، قاعدة `neondb` في مشروع `awadi-branch-db`.
- الملفات: حاوية R2 خاصة باسم `awadi-branch-files` مرتبطة بالاسم `AWADI_FILES`.
- البريد: Resend لإرسال روابط التفعيل واستعادة كلمة المرور.

## 1. إنشاء حاوية الملفات

داخل Cloudflare افتح R2 وأنشئ حاوية باسم:

```text
awadi-branch-files
```

تبقى الحاوية خاصة. لا تفعل النطاق العام ولا تجعل الملفات متاحة مباشرة عبر رابط عام.

## 2. ربط مستودع GitHub

أنشئ Worker من المستودع:

```text
asemalnegadah/-awadi-branch-operations
```

الإعدادات:

```text
Production branch: main
Install command: npm ci --no-audit --no-fund
Build command: npm run cf:build
Deploy command: npx wrangler deploy
Root directory: /
Node.js: 22
```

لا تسمح بنشر فرع Pull Request إلى الإنتاج.

## 3. متغيرات البناء والتشغيل

أضف القيم التالية من لوحة Cloudflare بوصفها Secrets أو متغيرات محمية. لا تضعها في `wrangler.jsonc` ولا في GitHub:

```text
DATABASE_URL
AUTH_SECRET
APP_BASE_URL
RESEND_API_KEY
EMAIL_FROM
INITIAL_MANAGER_EMAIL
INITIAL_MANAGER_NAME
```

القيم غير السرية الافتراضية موجودة في `wrangler.jsonc`، ومنها مدة الجلسة وحدود استعادة كلمة المرور.

### قواعد القيم

- `DATABASE_URL`: رابط Neon المشفر مع `sslmode=require`. استخدم الاتصال المجمع الخاص بالإنتاج.
- `AUTH_SECRET`: قيمة عشوائية طويلة لا تقل عن 32 حرفًا، ولا تعاد استخدامها في أي نظام آخر.
- `APP_BASE_URL`: رابط HTTPS النهائي للـWorker دون شرطة مائلة في النهاية.
- `RESEND_API_KEY`: مفتاح خادم محدود لخدمة إرسال البريد.
- `EMAIL_FROM`: مرسل موثق، مثال: `مجموعة العوادي التجارية <security@your-domain.example>`.
- `INITIAL_MANAGER_EMAIL`: البريد الوحيد المسموح له بإنشاء أول حساب مدير.
- `INITIAL_MANAGER_NAME`: الاسم الكامل لمدير الفرع.

## 4. تفعيل المدير الأول

قبل أول تفعيل فقط، غيّر متغير Worker التالي مؤقتًا إلى:

```text
ALLOW_INITIAL_MANAGER_EMAIL_BOOTSTRAP=true
```

بعد نجاح النشر:

1. افتح `/forgot-password` في رابط النظام.
2. أدخل البريد المحدد في `INITIAL_MANAGER_EMAIL`.
3. افتح رسالة التفعيل واختر كلمة مرور جديدة لم تُرسل في أي محادثة ولم تستخدم في حساب آخر.
4. سجل الدخول وتحقق من ظهور لوحة مدير الفرع.
5. أعد المتغير فورًا إلى:

```text
ALLOW_INITIAL_MANAGER_EMAIL_BOOTSTRAP=false
```

ثم أعد نشر الإعداد أو احفظه من لوحة Cloudflare. لا يبقى مسار إنشاء المدير الأول مفتوحًا بعد نجاح التفعيل.

## 5. فحوص ما قبل النشر

تشغل محليًا أو داخل CI:

```bash
npm ci --no-audit --no-fund
npm run verify:cloudflare
npm run check
npm run cf:build
npm run cf:dry-run:built
```

يجب أن تنجح جميعها قبل أي نشر.

## 6. فحوص ما بعد النشر

- الصفحة الرئيسية تحول غير المسجل إلى `/login`.
- `/api/v1/health` يعيد حالة سليمة ويتصل بقاعدة Neon.
- لا يمكن فتح `/dashboard` دون جلسة.
- طلب الاستعادة يعطي رسالة عامة سواء كان البريد موجودًا أم لا.
- رابط التفعيل يعمل مرة واحدة فقط.
- بعد تعيين كلمة المرور يصبح الحساب `ACTIVE` ويحمل دور `BRANCH_MANAGER`.
- حاوية R2 غير عامة ولا يمكن استعراض ملفاتها دون صلاحية من التطبيق.
- لا تظهر أسرار في السجلات أو HTML أو استجابات API.

## 7. التراجع

عند فشل النسخة الجديدة:

1. استخدم Rollback في Cloudflare Workers للعودة إلى آخر Version سليمة.
2. لا تحذف جداول Neon ولا تنفذ Migration عكسية تلقائيًا.
3. عطّل `ALLOW_INITIAL_MANAGER_EMAIL_BOOTSTRAP` فورًا.
4. ألغ مفاتيح البريد أو أي سر يشتبه في انكشافه، ثم أنشئ بديلًا.
5. سجل سبب الفشل ورقم إصدار Worker وCommit GitHub قبل أي محاولة جديدة.
