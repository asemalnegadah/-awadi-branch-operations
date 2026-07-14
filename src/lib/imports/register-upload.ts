import { randomUUID } from "node:crypto";

import { z } from "zod";

const allowedMediaTypes = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/csv",
  "text/tab-separated-values",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "application/json",
] as const;

export type AllowedMediaType = (typeof allowedMediaTypes)[number];

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

const registerUploadRequestSchema = z.object({
  originalName: z.string().trim().min(1).max(255),
  mediaType: z.enum(allowedMediaTypes),
  sizeBytes: z.number().int().positive().max(MAX_FILE_SIZE_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export interface UploadRegistrationContext {
  readonly actorUserId: string;
  readonly idempotencyKey: string;
}

export interface UploadRegistrationRecord {
  readonly id: string;
  readonly originalName: string;
  readonly safeName: string;
  readonly mediaType: AllowedMediaType;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly storageKey: string;
  readonly status: "REGISTERED";
  readonly createdAt: string;
  readonly uploadedBy: string;
}

export interface UploadRegistrationRepository {
  findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<UploadRegistrationRecord | null>;
  findBySha256(sha256: string): Promise<UploadRegistrationRecord | null>;
  create(
    record: UploadRegistrationRecord,
    idempotencyKey: string,
  ): Promise<UploadRegistrationRecord>;
}

export type RegisterUploadResult =
  | {
      readonly status: "REGISTERED";
      readonly file: UploadRegistrationRecord;
      readonly replayed: false;
      readonly duplicate: false;
    }
  | {
      readonly status: "REPLAYED";
      readonly file: UploadRegistrationRecord;
      readonly replayed: true;
      readonly duplicate: false;
    }
  | {
      readonly status: "DUPLICATE_FILE";
      readonly file: UploadRegistrationRecord;
      readonly replayed: false;
      readonly duplicate: true;
    };

interface RegisterUploadDependencies {
  readonly repository: UploadRegistrationRepository;
  readonly generateId?: () => string;
  readonly now?: () => Date;
}

export function createRegisterUploadService({
  repository,
  generateId = randomUUID,
  now = () => new Date(),
}: RegisterUploadDependencies) {
  return async function registerUpload(
    rawRequest: unknown,
    context: UploadRegistrationContext,
  ): Promise<RegisterUploadResult> {
    assertContext(context);
    const request = registerUploadRequestSchema.parse(rawRequest);

    const replayed = await repository.findByIdempotencyKey(
      context.idempotencyKey,
    );

    if (replayed) {
      return Object.freeze({
        status: "REPLAYED" as const,
        file: replayed,
        replayed: true as const,
        duplicate: false as const,
      });
    }

    const duplicate = await repository.findBySha256(request.sha256);
    if (duplicate) {
      return Object.freeze({
        status: "DUPLICATE_FILE" as const,
        file: duplicate,
        replayed: false as const,
        duplicate: true as const,
      });
    }

    const id = generateId();
    const safeName = sanitizeFileName(request.originalName);
    const createdAt = now().toISOString();
    const storageKey = buildStorageKey(id, safeName, createdAt);

    const file = await repository.create(
      Object.freeze({
        id,
        originalName: request.originalName,
        safeName,
        mediaType: request.mediaType,
        sizeBytes: request.sizeBytes,
        sha256: request.sha256,
        storageKey,
        status: "REGISTERED" as const,
        createdAt,
        uploadedBy: context.actorUserId,
      }),
      context.idempotencyKey,
    );

    return Object.freeze({
      status: "REGISTERED" as const,
      file,
      replayed: false as const,
      duplicate: false as const,
    });
  };
}

export function sanitizeFileName(value: string): string {
  const trimmed = value.normalize("NFKC").trim();
  const lastDot = trimmed.lastIndexOf(".");
  const extension = lastDot > 0 ? trimmed.slice(lastDot).toLowerCase() : "";
  const base = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const safeBase = base
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 180);

  if (!safeBase) {
    throw new Error("اسم الملف غير صالح بعد التنظيف.");
  }

  return `${safeBase}${extension}`;
}

function buildStorageKey(
  fileId: string,
  safeName: string,
  createdAt: string,
): string {
  const date = createdAt.slice(0, 10);
  return `uploads/${date}/${fileId}/${safeName}`;
}

function assertContext(context: UploadRegistrationContext): void {
  if (!z.string().uuid().safeParse(context.actorUserId).success) {
    throw new Error("معرف المستخدم غير صالح.");
  }

  if (context.idempotencyKey.trim().length < 8) {
    throw new Error("مفتاح منع التكرار غير صالح.");
  }
}
