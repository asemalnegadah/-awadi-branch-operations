export function safeErrorMetadata(error: unknown): Readonly<Record<string, string>> {
  if (error instanceof Error) {
    return Object.freeze({ errorType: sanitizeCode(error.name) });
  }

  return Object.freeze({ errorType: "UnknownError" });
}

function sanitizeCode(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_.-]/gu, "").slice(0, 80);
  return sanitized || "Error";
}
