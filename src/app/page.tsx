const indicators = [
  { label: "تحصيلات SR اليوم", value: "—" },
  { label: "تحصيلات RG اليوم", value: "—" },
  { label: "الوعود المستحقة", value: "—" },
  { label: "الزيارات المنفذة", value: "—" },
  { label: "الحالات التي تحتاج قرارًا", value: "—" },
  { label: "جودة البيانات", value: "—" },
] as const;

export default function HomePage() {
  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">مجموعة العوادي التجارية – فرع عدن</p>
        <h1>نظام التشغيل والرقابة</h1>
        <p className="hero-copy">
          النسخة التأسيسية قيد البناء وفق المرجع التنفيذي المعتمد، مع فصل كامل
          بين SR وRG وسجل تدقيق لجميع العمليات الحساسة.
        </p>
      </header>

      <section aria-labelledby="status-heading" className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">الحالة الحالية</p>
            <h2 id="status-heading">لوحة التحكم التأسيسية</h2>
          </div>
          <span className="status-badge">مرحلة التأسيس</span>
        </div>

        <div className="indicator-grid">
          {indicators.map((indicator) => (
            <article className="indicator-card" key={indicator.label}>
              <span>{indicator.label}</span>
              <strong>{indicator.value}</strong>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="rules-heading" className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">قواعد حاكمة</p>
            <h2 id="rules-heading">ما لن يسمح النظام بتجاوزه</h2>
          </div>
        </div>

        <ol className="rule-list">
          <li>لا دمج بين SR وRG في حركة مالية واحدة.</li>
          <li>لا تعديل مباشر على رصيد العميل.</li>
          <li>لا حذف لحركة مالية معتمدة.</li>
          <li>لا ترحيل دون مراجعة واعتماد.</li>
          <li>لا خطة من بيانات غير معتمدة.</li>
        </ol>
      </section>
    </main>
  );
}
