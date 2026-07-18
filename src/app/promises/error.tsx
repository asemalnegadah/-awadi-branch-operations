"use client";

export default function PromisesError({ reset }: Readonly<{ reset: () => void }>) {
  return (
    <main className="shell promise-error panel" role="alert">
      <h1>تعذر تحميل وعود السداد</h1>
      <p>حدث خطأ غير متوقع. لم تُعرض أي تفاصيل داخلية أو معلومات قاعدة البيانات.</p>
      <button className="primary-button" type="button" onClick={reset}>إعادة المحاولة</button>
    </main>
  );
}
