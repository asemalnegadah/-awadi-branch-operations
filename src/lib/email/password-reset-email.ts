export type PasswordResetPurpose = "INVITE" | "RESET";

export interface PasswordResetEmailMessage {
  readonly to: string;
  readonly fullName: string;
  readonly resetUrl: string;
  readonly purpose: PasswordResetPurpose;
  readonly expiresInMinutes: number;
  readonly idempotencyKey: string;
}

export interface PasswordResetEmailDelivery {
  readonly provider: string;
  readonly messageId: string | null;
}

export interface PasswordResetEmailSender {
  send(message: PasswordResetEmailMessage): Promise<PasswordResetEmailDelivery>;
}

interface ResendResponse {
  readonly id?: string;
  readonly message?: string;
}

export class ResendPasswordResetEmailSender implements PasswordResetEmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    if (!apiKey.trim()) {
      throw new Error("RESEND_API_KEY is required.");
    }

    if (!from.includes("@")) {
      throw new Error("EMAIL_FROM must contain a valid sender address.");
    }
  }

  async send(
    message: PasswordResetEmailMessage,
  ): Promise<PasswordResetEmailDelivery> {
    const subject =
      message.purpose === "INVITE"
        ? "تفعيل حساب مدير فرع العوادي"
        : "استعادة كلمة مرور نظام فرع العوادي";

    const actionLabel =
      message.purpose === "INVITE" ? "تفعيل الحساب" : "تعيين كلمة مرور جديدة";

    const response = await this.fetchImplementation("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": message.idempotencyKey,
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject,
        text: buildTextMessage(message, actionLabel),
        html: buildHtmlMessage(message, actionLabel),
        tags: [
          { name: "category", value: "password-recovery" },
          { name: "purpose", value: message.purpose.toLowerCase() },
        ],
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as ResendResponse;

    if (!response.ok) {
      throw new Error(
        `Email provider rejected the request (${response.status}): ${payload.message ?? "unknown error"}`,
      );
    }

    return Object.freeze({
      provider: "RESEND",
      messageId: payload.id ?? null,
    });
  }
}

function buildTextMessage(
  message: PasswordResetEmailMessage,
  actionLabel: string,
): string {
  return [
    `مرحبًا ${message.fullName}،`,
    "",
    `استخدم الرابط التالي لإكمال ${actionLabel}:`,
    message.resetUrl,
    "",
    `تنتهي صلاحية الرابط خلال ${message.expiresInMinutes} دقيقة.`,
    "إذا لم تطلب هذه العملية، تجاهل الرسالة ولا تشارك الرابط مع أي شخص.",
  ].join("\n");
}

function buildHtmlMessage(
  message: PasswordResetEmailMessage,
  actionLabel: string,
): string {
  const safeName = escapeHtml(message.fullName);
  const safeUrl = escapeHtml(message.resetUrl);

  return `<!doctype html>
<html lang="ar" dir="rtl">
  <body style="margin:0;background:#f4f7fb;font-family:Tahoma,Arial,sans-serif;color:#172033">
    <div style="max-width:620px;margin:0 auto;padding:32px 16px">
      <div style="background:#ffffff;border:1px solid #dfe5ee;border-radius:18px;padding:32px">
        <p style="margin:0 0 8px;color:#475467;font-weight:700">مجموعة العوادي التجارية – فرع عدن</p>
        <h1 style="margin:0 0 18px;font-size:26px">${escapeHtml(actionLabel)}</h1>
        <p style="line-height:1.9">مرحبًا ${safeName}،</p>
        <p style="line-height:1.9">اضغط الزر التالي لإكمال العملية بصورة آمنة:</p>
        <p style="margin:26px 0">
          <a href="${safeUrl}" style="display:inline-block;background:#175cd3;color:#ffffff;text-decoration:none;border-radius:10px;padding:13px 22px;font-weight:700">${escapeHtml(actionLabel)}</a>
        </p>
        <p style="line-height:1.9;color:#475467">تنتهي صلاحية الرابط خلال ${message.expiresInMinutes} دقيقة. الرابط يستخدم مرة واحدة فقط.</p>
        <p style="line-height:1.9;color:#475467">إذا لم تطلب هذه العملية، تجاهل الرسالة ولا تشارك الرابط مع أي شخص.</p>
      </div>
    </div>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "'":
        return "&#39;";
      case '"':
        return "&quot;";
      default:
        return character;
    }
  });
}
