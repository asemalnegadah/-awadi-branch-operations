"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { FieldVisitDetails } from "@/lib/visits/types";

interface Props {
  readonly details: FieldVisitDetails;
  readonly canManage: boolean;
  readonly canVerify: boolean;
  readonly canExecutePlan: boolean;
}

export function VisitActionPanel({ details, canManage, canVerify, canExecutePlan }: Props) {
  const router = useRouter();
  const visit = details.visit;
  const [summary, setSummary] = useState(visit.outcomeSummary ?? "");
  const [reason, setReason] = useState("");
  const [outcomeSummary, setOutcomeSummary] = useState("");
  const [outcomeType, setOutcomeType] = useState("CUSTOMER_DATA_UPDATE");
  const [uploadedFileId, setUploadedFileId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(path: string, body: unknown) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `visit-action-${crypto.randomUUID()}`,
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { readonly success: boolean; readonly error?: { readonly message?: string } };
      if (!response.ok || !payload.success) throw new Error(payload.error?.message ?? "تعذر تنفيذ العملية.");
      setMessage("تم تنفيذ العملية بنجاح.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تنفيذ العملية.");
    } finally {
      setBusy(false);
    }
  }

  async function currentLocation() {
    if (!navigator.geolocation) return {};
    return new Promise<{ latitude: number; longitude: number; accuracyMeters: number; deviceAt: string; syncStatus: "SYNCED" }>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          deviceAt: new Date(position.timestamp).toISOString(),
          syncStatus: "SYNCED",
        }),
        reject,
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
      );
    }).catch(() => ({}));
  }

  async function checkIn() {
    await call(`/api/v1/visits/${visit.id}/check-in`, await currentLocation());
  }

  async function checkOut() {
    await call(`/api/v1/visits/${visit.id}/check-out`, {
      ...(await currentLocation()),
      version: visit.version,
    });
  }

  const canAddRecords = canManage && ["CHECKED_IN", "CHECKED_OUT", "RETURNED"].includes(visit.state);

  return (
    <section className="panel">
      <h2>إجراءات الزيارة</h2>
      {message ? <p className={message.includes("نجاح") ? "form-success" : "form-error"} role="status">{message}</p> : null}

      {canManage && visit.state === "DRAFT" ? (
        <button className="primary-button" type="button" onClick={checkIn} disabled={busy}>تسجيل الوصول بوقت الخادم والموقع المتاح</button>
      ) : null}

      {canAddRecords ? (
        <div className="promise-form">
          <div className="promise-field">
            <label htmlFor="outcome-type">نوع النتيجة</label>
            <select id="outcome-type" value={outcomeType} onChange={(event) => setOutcomeType(event.target.value)}>
              <option value="CUSTOMER_DATA_UPDATE">تحديث بيانات</option>
              <option value="PROBLEM_RESOLUTION">حل مشكلة</option>
              <option value="RECONCILIATION">مطابقة</option>
              <option value="SALES_ORDER">طلب بيع</option>
              <option value="NO_RESULT">لا توجد نتيجة</option>
            </select>
          </div>
          <div className="promise-field full-width"><label htmlFor="outcome-summary">وصف النتيجة</label><textarea id="outcome-summary" value={outcomeSummary} onChange={(event) => setOutcomeSummary(event.target.value)} /></div>
          <button className="secondary-button" type="button" disabled={busy || outcomeSummary.trim().length < 2} onClick={() => call(`/api/v1/visits/${visit.id}/outcomes`, { outcomeType, summary: outcomeSummary, details: {} })}>إضافة النتيجة</button>
        </div>
      ) : null}

      {canAddRecords ? (
        <div className="promise-form">
          <div className="promise-field"><label htmlFor="uploaded-file-id">معرف ملف الدليل المرفوع</label><input id="uploaded-file-id" value={uploadedFileId} onChange={(event) => setUploadedFileId(event.target.value)} placeholder="UUID" /></div>
          <button className="secondary-button" type="button" disabled={busy || uploadedFileId.length < 30} onClick={() => call(`/api/v1/visits/${visit.id}/evidence`, { uploadedFileId, evidenceType: "DOCUMENT", caption: "دليل تنفيذ الزيارة" })}>ربط الدليل</button>
        </div>
      ) : null}

      {canManage && visit.state === "CHECKED_IN" ? (
        <button className="primary-button" type="button" onClick={checkOut} disabled={busy}>تسجيل المغادرة</button>
      ) : null}

      {canManage && ["CHECKED_OUT", "RETURNED"].includes(visit.state) ? (
        <div className="promise-form">
          <div className="promise-field"><label htmlFor="visit-result">النتيجة العامة</label><select id="visit-result" defaultValue="SUCCESS"><option value="SUCCESS">ناجحة</option><option value="PARTIAL">جزئية</option><option value="FAILED">غير ناجحة</option><option value="NO_CONTACT">تعذر التواصل</option></select></div>
          <div className="promise-field full-width"><label htmlFor="visit-summary">الخلاصة</label><textarea id="visit-summary" value={summary} onChange={(event) => setSummary(event.target.value)} /></div>
          <button className="primary-button" type="button" disabled={busy || summary.trim().length < 2} onClick={() => {
            const result = (document.getElementById("visit-result") as HTMLSelectElement | null)?.value ?? "SUCCESS";
            void call(`/api/v1/visits/${visit.id}/submit`, { version: visit.version, result, summary });
          }}>إرسال للتحقق</button>
        </div>
      ) : null}

      {canVerify && visit.state === "SUBMITTED" ? (
        <div className="filter-actions">
          <button className="primary-button" type="button" disabled={busy} onClick={() => call(`/api/v1/visits/${visit.id}/verify`, { version: visit.version })}>اعتماد الزيارة</button>
          <input aria-label="سبب الإعادة" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="سبب الإعادة" />
          <button className="secondary-button" type="button" disabled={busy || reason.trim().length < 2} onClick={() => call(`/api/v1/visits/${visit.id}/return`, { version: visit.version, reason })}>إعادة للاستكمال</button>
        </div>
      ) : null}

      {canExecutePlan && visit.state === "VERIFIED" && visit.planItemId && !details.planItemResult ? (
        <div className="filter-actions">
          <button className="primary-button" type="button" disabled={busy} onClick={() => call("/api/v1/visits/plan-item-results", {
            planItemId: visit.planItemId,
            visitId: visit.id,
            resultType: visit.declaredResult === "SUCCESS" ? "VISITED_SUCCESS" : visit.declaredResult === "PARTIAL" ? "VISITED_PARTIAL" : "VISITED_FAILED",
            reason: visit.outcomeSummary ?? "نتيجة زيارة متحقق منها.",
          })}>تثبيت نتيجة عنصر الخطة</button>
        </div>
      ) : null}

      {(canManage || canVerify) && !["VERIFIED", "CANCELLED"].includes(visit.state) ? (
        <div className="filter-actions">
          <input aria-label="سبب الإلغاء" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="سبب الإلغاء" />
          <button className="secondary-button" type="button" disabled={busy || reason.trim().length < 2} onClick={() => call(`/api/v1/visits/${visit.id}/cancel`, { version: visit.version, reason })}>إلغاء الزيارة</button>
        </div>
      ) : null}
    </section>
  );
}
