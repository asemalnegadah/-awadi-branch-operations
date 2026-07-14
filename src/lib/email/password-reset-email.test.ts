import { describe, expect, it, vi } from "vitest";

import { ResendPasswordResetEmailSender } from "./password-reset-email";

describe("ResendPasswordResetEmailSender", () => {
  it("sends an Arabic reset email without exposing provider credentials", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "email-123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const sender = new ResendPasswordResetEmailSender(
      "re_test_key",
      "العوادي <security@example.com>",
      fetchMock,
    );

    const delivery = await sender.send({
      to: "manager@example.com",
      fullName: "مدير الفرع",
      resetUrl: "https://example.com/reset-password#token=token-value",
      purpose: "RESET",
      expiresInMinutes: 30,
      idempotencyKey: "password-reset-test-1",
    });

    expect(delivery).toEqual({ provider: "RESEND", messageId: "email-123" });
    expect(fetchMock).toHaveBeenCalledOnce();

    const [, request] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(request?.body)) as {
      subject: string;
      html: string;
      text: string;
    };

    expect(body.subject).toContain("استعادة كلمة مرور");
    expect(body.html).toContain("reset-password#token=token-value");
    expect(body.text).toContain("30 دقيقة");
    expect(String(request?.headers)).not.toContain("re_test_key");
  });

  it("fails closed when the provider rejects delivery", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "rejected" }), {
        status: 422,
        headers: { "content-type": "application/json" },
      }),
    );
    const sender = new ResendPasswordResetEmailSender(
      "re_test_key",
      "security@example.com",
      fetchMock,
    );

    await expect(
      sender.send({
        to: "manager@example.com",
        fullName: "مدير الفرع",
        resetUrl: "https://example.com/reset-password#token=token-value",
        purpose: "INVITE",
        expiresInMinutes: 30,
        idempotencyKey: "password-reset-test-2",
      }),
    ).rejects.toThrow("Email provider rejected");
  });
});
