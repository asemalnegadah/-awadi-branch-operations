const encoder = new TextEncoder();

export function createRandomToken(byteLength = 32): string {
  if (!Number.isInteger(byteLength) || byteLength < 16 || byteLength > 128) {
    throw new Error("Invalid random token length.");
  }

  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export async function hmacSha256Hex(
  secret: string,
  domain: string,
  value: string,
): Promise<string> {
  if (secret.length < 32) {
    throw new Error("AUTH_SECRET must contain at least 32 characters.");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${domain}\0${value}`),
  );

  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
