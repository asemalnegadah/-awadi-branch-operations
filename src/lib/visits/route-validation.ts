import { z } from "zod";

import { FieldVisitInputError } from "./errors";
import { parseFieldVisitLocation } from "./validation";

const uuidSchema = z.string().uuid();

export function parseFieldVisitId(value: string): string {
  const result = uuidSchema.safeParse(value);
  if (!result.success) throw new FieldVisitInputError("معرف الزيارة غير صالح.");
  return result.data;
}

export function parseFieldVisitCheckout(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FieldVisitInputError("بيانات المغادرة غير صالحة.");
  }
  const record = value as Record<string, unknown>;
  const version = z.number().int().positive().parse(record.version);
  const location = parseFieldVisitLocation({
    latitude: record.latitude,
    longitude: record.longitude,
    accuracyMeters: record.accuracyMeters,
    deviceAt: record.deviceAt,
    syncStatus: record.syncStatus,
  });
  return Object.freeze({ ...location, version });
}
