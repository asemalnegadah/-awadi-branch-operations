const readinessItems = [
  { label: "المواصفة التنفيذية", status: "معتمدة" },
  { label: "النطاق", status: "فرع عدن فقط" },
  { label: "دفتر الحركات", status: "قيد التصميم" },
  { label: "قاعدة البيانات", status: "قيد التأسيس" },
];

const principles = [
  "فصل SR عن RG في جميع الحركات والتقارير.",
  "الرصيد نتيجة دفتر حركات وليس رقمًا قابلًا للتعديل.",
  "لا ترحيل دون معاينة واعتماد.",
  "لا حذف للحركات المالية المعتمدة.",
];

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">مجموعة العوادي التجارية – فرع عدن</p>
        <h1 id="page-title">نظام التشغيل والرقابة</h1>
        <p className="lead">
          تم تأسيس المشروع وفق المرجع التنفيذي المعتمد. هذه واجهة البداية وليست
          بيانات تشغيلية حقيقية.
        </p>
        <div className="badge-row" aria-label="حالة المشروع">
          <span className="badge badge-success">بدأ التنفيذ</span>
          <span className="badge">بيئة تأسيس آمنة</span>
          <span className="badge">RTL / PWA</span>
        </div>
      </section>

      <section className="grid" aria-label="جاهزية مكونات النظام">
        {readinessItems.map((item) => (
          <article className="card" key={item.label}>
            <span className="card-label">{item.label}</span>
            <strong>{item.status}</strong>
          </article>
        ))}
      </section>

      <section className="panel" aria-labelledby="principles-title">
        <h2 id="principles-title">القواعد الحاكمة</h2>
        <ol>
          {principles.map((principle) => (
            <li key={principle}>{principle}</li>
          ))}
        </ol>
      </section>

      <footer>
        <span>الإصدار التأسيسي 0.1.0</span>
        <span>لا توجد بيانات عملاء داخل المستودع</span>
      </footer>
    </main>
  );
}
