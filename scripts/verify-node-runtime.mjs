import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = process.cwd();
const expectedMajor = 24;
const expectedPinnedVersion = "24.18.0";

const packageJson = JSON.parse(
  await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
);

assertEqual(packageJson.engines?.node, "24.x", "package.json engines.node");
assertMajor(packageJson.devDependencies?.["@types/node"], expectedMajor, "@types/node");
assertEqual(
  (await readFile(path.join(repositoryRoot, ".nvmrc"), "utf8")).trim(),
  expectedPinnedVersion,
  ".nvmrc",
);
assertEqual(
  (await readFile(path.join(repositoryRoot, ".node-version"), "utf8")).trim(),
  expectedPinnedVersion,
  ".node-version",
);
assertMajor(process.versions.node, expectedMajor, "executing Node.js runtime");

const workflowDirectory = path.join(repositoryRoot, ".github", "workflows");
const workflowFiles = (await readdir(workflowDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name))
  .map((entry) => path.join(workflowDirectory, entry.name));

let setupNodeReferences = 0;
for (const workflowFile of workflowFiles) {
  const content = await readFile(workflowFile, "utf8");
  for (const match of content.matchAll(/node-version:\s*["']?([^\s"']+)/gu)) {
    setupNodeReferences += 1;
    assertMajor(match[1], expectedMajor, path.relative(repositoryRoot, workflowFile));
  }
}
if (setupNodeReferences === 0) {
  throw new Error("No GitHub Actions node-version declarations were found.");
}

for (const dockerFile of await findDockerFiles(repositoryRoot)) {
  const content = await readFile(dockerFile, "utf8");
  for (const match of content.matchAll(/^FROM\s+node:([^\s-]+)/gimu)) {
    assertMajor(match[1], expectedMajor, path.relative(repositoryRoot, dockerFile));
  }
}

console.log(
  `Node.js runtime verified: ${expectedPinnedVersion}; ${setupNodeReferences} workflow declarations aligned.`,
);

async function findDockerFiles(directory) {
  const results = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if ([".git", "node_modules", ".next", ".open-next", ".wrangler"].includes(entry.name)) {
      continue;
    }
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...await findDockerFiles(absolutePath));
    } else if (/^Dockerfile(?:\..+)?$/u.test(entry.name)) {
      results.push(absolutePath);
    }
  }
  return results;
}

function assertMajor(value, expected, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} is missing or is not a string.`);
  }
  const major = Number.parseInt(value.match(/\d+/u)?.[0] ?? "", 10);
  if (major !== expected) {
    throw new Error(`${label} must use Node.js major ${expected}; received ${value}.`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} must equal ${expected}; received ${String(actual)}.`);
  }
}
