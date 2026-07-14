import fs from "node:fs";
import path from "node:path";

const configPath = path.resolve("wrangler.jsonc");
const raw = fs.readFileSync(configPath, "utf8");
const config = JSON.parse(raw);

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

assert(config.name === "awadi-branch-operations", "Worker name must remain stable.");
assert(config.main === ".open-next/worker.js", "Worker entry must be the OpenNext output.");
assert(
  Array.isArray(config.compatibility_flags) &&
    config.compatibility_flags.includes("nodejs_compat"),
  "nodejs_compat is required for Next.js and process.env secrets.",
);
assert(
  typeof config.compatibility_date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(config.compatibility_date),
  "A valid Cloudflare compatibility date is required.",
);
assert(
  config.assets?.directory === ".open-next/assets" &&
    config.assets?.binding === "ASSETS",
  "OpenNext static assets binding is invalid.",
);

const r2Bindings = Array.isArray(config.r2_buckets) ? config.r2_buckets : [];
const fileBucket = r2Bindings.find((entry) => entry.binding === "AWADI_FILES");
assert(Boolean(fileBucket), "Private AWADI_FILES R2 binding is required.");
assert(
  fileBucket?.bucket_name === "awadi-branch-files",
  "AWADI_FILES must target the production bucket name awadi-branch-files.",
);

const requiredSecrets = new Set(config.secrets?.required ?? []);
for (const secretName of [
  "DATABASE_URL",
  "AUTH_SECRET",
  "APP_BASE_URL",
  "RESEND_API_KEY",
  "EMAIL_FROM",
]) {
  assert(requiredSecrets.has(secretName), `Missing required secret declaration: ${secretName}`);
}

const serialized = JSON.stringify(config);
for (const forbiddenPattern of [
  "postgresql://",
  "postgres://",
  "re_",
  "npg_",
  "BEGIN PRIVATE KEY",
]) {
  assert(
    !serialized.includes(forbiddenPattern),
    `wrangler.jsonc appears to contain a secret-like value: ${forbiddenPattern}`,
  );
}

assert(
  config.vars?.ALLOW_INITIAL_MANAGER_EMAIL_BOOTSTRAP === "false",
  "Initial manager bootstrap must be disabled in committed configuration.",
);

if (failures.length > 0) {
  console.error("Cloudflare configuration verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Cloudflare configuration verification passed.");
