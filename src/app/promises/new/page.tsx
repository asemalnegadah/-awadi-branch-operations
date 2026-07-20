import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requireCurrentSession } from "@/lib/auth/current-session";
import { getDatabaseClient } from "@/lib/db/client";
import { getPromiseFormOptions } from "@/lib/promises/service";

import { CreatePromiseForm } from "./promise-form";

export const metadata: Metadata = { title: "إنشاء وعد سداد" };
export const dynamic = "force-dynamic";

export default async function NewPromisePage() {
  const session = await requireCurrentSession();
  if (session.user.mustChangePassword) redirect("/settings/security");
  const options = await getPromiseFormOptions(getDatabaseClient(), { actor: session.user });

  return (
    <main className="shell promises-shell promise-form-page">
      <header className="promises-header">
        <div><p className="eyebrow dark-eyebrow">فرع عدن الواحد</p><h1>إنشاء وعد سداد</h1><p className="dashboard-welcome">المبلغ والعملة يثبتان على حساب العميل المحدد، والتنفيذ لاحقًا لا يتم إلا بتحصيل مؤكد.</p></div>
        <Link className="secondary-button button-link" href="/promises">العودة</Link>
      </header>
      {options.accounts.length === 0 || options.representatives.length === 0 ? (
        <section className="promise-empty"><h2>لا تتوفر بيانات مرجعية</h2><p>يلزم حساب عميل نشط ومندوب نشط قبل إنشاء وعد.</p></section>
      ) : <CreatePromiseForm options={options} />}
    </main>
  );
}
