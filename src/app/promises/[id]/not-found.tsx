import Link from "next/link";

export default function PromiseNotFound() {
  return <main className="shell promise-error panel"><h1>وعد السداد غير موجود</h1><p>قد يكون المعرف غير صالح أو السجل غير متاح.</p><Link className="primary-button button-link" href="/promises">العودة إلى القائمة</Link></main>;
}
