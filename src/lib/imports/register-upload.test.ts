import { describe, expect, it } from "vitest";

import {
  createRegisterUploadService,
  sanitizeFileName,
  type UploadRegistrationRecord,
  type UploadRegistrationRepository,
} from "./register-upload";

const actorUserId = "11111111-1111-4111-8111-111111111111";
const generatedId = "22222222-2222-4222-8222-222222222222";
const sha256 = "a".repeat(64);

class InMemoryUploadRepository implements UploadRegistrationRepository {
  readonly byIdempotency = new Map<string, UploadRegistrationRecord>();
  readonly bySha256 = new Map<string, UploadRegistrationRecord>();
  createCount = 0;

  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<UploadRegistrationRecord | null> {
    return this.byIdempotency.get(idempotencyKey) ?? null;
  }

  async findBySha256(value: string): Promise<UploadRegistrationRecord | null> {
    return this.bySha256.get(value) ?? null;
  }

  async create(
    record: UploadRegistrationRecord,
    idempotencyKey: string,
  ): Promise<UploadRegistrationRecord> {
    this.createCount += 1;
    this.byIdempotency.set(idempotencyKey, record);
    this.bySha256.set(record.sha256, record);
    return record;
  }
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    originalName: "كشف أعمار الديون - يوليو.pdf",
    mediaType: "application/pdf",
    sizeBytes: 1_250_000,
    sha256,
    ...overrides,
  };
}

describe("Upload registration", () => {
  it("يسجل ملف PDF بمسار تخزين آمن", async () => {
    const repository = new InMemoryUploadRepository();
    const register = createRegisterUploadService({
      repository,
      generateId: () => generatedId,
      now: () => new Date("2026-07-14T16:30:00.000Z"),
    });

    const result = await register(request(), {
      actorUserId,
      idempotencyKey: "upload-register-001",
    });

    expect(result.status).toBe("REGISTERED");
    expect(result.file.safeName).toBe("كشف-أعمار-الديون-يوليو.pdf");
    expect(result.file.storageKey).toBe(
      `uploads/2026-07-14/${generatedId}/كشف-أعمار-الديون-يوليو.pdf`,
    );
    expect(repository.createCount).toBe(1);
  });

  it("يعيد التسجيل السابق عند تكرار مفتاح الطلب", async () => {
    const repository = new InMemoryUploadRepository();
    const register = createRegisterUploadService({
      repository,
      generateId: () => generatedId,
    });
    const context = {
      actorUserId,
      idempotencyKey: "upload-register-002",
    };

    const first = await register(request(), context);
    const second = await register(request(), context);

    expect(first.status).toBe("REGISTERED");
    expect(second.status).toBe("REPLAYED");
    expect(repository.createCount).toBe(1);
  });

  it("يكشف الملف المكرر ببصمة SHA-256", async () => {
    const repository = new InMemoryUploadRepository();
    const register = createRegisterUploadService({
      repository,
      generateId: () => generatedId,
    });

    await register(request(), {
      actorUserId,
      idempotencyKey: "upload-register-003",
    });

    const duplicate = await register(
      request({ originalName: "نسخة ثانية.pdf" }),
      {
        actorUserId,
        idempotencyKey: "upload-register-004",
      },
    );

    expect(duplicate.status).toBe("DUPLICATE_FILE");
    expect(duplicate.file.id).toBe(generatedId);
    expect(repository.createCount).toBe(1);
  });

  it("يرفض النوع غير المسموح والحجم الأكبر من 25 ميجابايت", async () => {
    const repository = new InMemoryUploadRepository();
    const register = createRegisterUploadService({ repository });
    const context = {
      actorUserId,
      idempotencyKey: "upload-register-005",
    };

    await expect(
      register(request({ mediaType: "application/x-msdownload" }), context),
    ).rejects.toThrow();

    await expect(
      register(request({ sizeBytes: 25 * 1024 * 1024 + 1 }), context),
    ).rejects.toThrow();
  });

  it("ينظف أسماء الملفات الخطرة", () => {
    expect(sanitizeFileName('../كشف:ديون?.PDF')).toBe("كشف-ديون.pdf");
  });
});
