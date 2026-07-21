import { FieldVisitInputError } from "./errors";

export interface FieldVisitCursor {
  readonly createdAt: string;
  readonly id: string;
}

export function encodeFieldVisitCursor(cursor: FieldVisitCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeFieldVisitCursor(value: string | undefined): FieldVisitCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.createdAt !== "string"
      || !Number.isFinite(Date.parse(record.createdAt))
      || typeof record.id !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.id)
    ) {
      throw new Error();
    }
    return Object.freeze({
      createdAt: new Date(record.createdAt).toISOString(),
      id: record.id,
    });
  } catch {
    throw new FieldVisitInputError("مؤشر صفحة الزيارات غير صالح.");
  }
}
