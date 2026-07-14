import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

const migrationDirectory = resolve(process.cwd(), "db/migrations");
const testDirectory = resolve(process.cwd(), "db/tests");
const migrationPattern = /^(\d{4})_[a-z0-9][a-z0-9_]*\.sql$/;
const testPattern = /^(\d{4})_[a-z0-9][a-z0-9_]*\.sql$/;

const errors = [];

const migrationFiles = await readSqlFiles(migrationDirectory, "migration");
const migrations = parseNumberedFiles(
  migrationFiles,
  migrationPattern,
  "migration",
);

if (migrations.length === 0) {
  errors.push("No SQL migrations were found in db/migrations.");
} else {
  verifyUniqueNumbers(migrations, "migration");
  verifyContiguousNumbers(migrations);
  verifyLexicalOrder(migrationFiles, migrations, "migration");
}

const testFiles = await readSqlFiles(testDirectory, "database test", true);
const tests = parseNumberedFiles(testFiles, testPattern, "database test");
verifyUniqueNames(testFiles, "database test");
verifyLexicalOrder(testFiles, tests, "database test");

const migrationNumbers = new Set(migrations.map((entry) => entry.number));
for (const test of tests) {
  if (!migrationNumbers.has(test.number)) {
    errors.push(
      `Database test ${test.file} targets migration ${formatNumber(test.number)}, ` +
        "but that migration does not exist.",
    );
  }
}

if (errors.length > 0) {
  console.error("Migration verification failed:\n");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  const first = migrations[0];
  const last = migrations.at(-1);
  console.log(
    `Verified ${migrations.length} migrations ` +
      `(${first?.file} through ${last?.file}) and ${tests.length} database tests.`,
  );
}

async function readSqlFiles(directory, label, allowMissing = false) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => entry.name)
      .sort(compareFileNames);
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") {
      return [];
    }
    errors.push(`Unable to read ${label} directory: ${String(error)}`);
    return [];
  }
}

function parseNumberedFiles(files, pattern, label) {
  const parsed = [];
  for (const file of files) {
    const match = pattern.exec(file);
    if (!match) {
      errors.push(
        `${label} file ${file} must match NNNN_lowercase_snake_case.sql.`,
      );
      continue;
    }
    parsed.push({ file, number: Number.parseInt(match[1], 10) });
  }
  return parsed;
}

function verifyUniqueNumbers(entries, label) {
  const seen = new Map();
  for (const entry of entries) {
    const previous = seen.get(entry.number);
    if (previous) {
      errors.push(
        `Duplicate ${label} number ${formatNumber(entry.number)}: ` +
          `${previous} and ${entry.file}.`,
      );
    } else {
      seen.set(entry.number, entry.file);
    }
  }
}

function verifyUniqueNames(files, label) {
  const seen = new Set();
  for (const file of files) {
    if (seen.has(file)) {
      errors.push(`Duplicate ${label} filename: ${file}.`);
    }
    seen.add(file);
  }
}

function verifyContiguousNumbers(entries) {
  const ordered = [...entries].sort((left, right) => left.number - right.number);
  for (let index = 0; index < ordered.length; index += 1) {
    const expected = index + 1;
    const actual = ordered[index]?.number;
    if (actual !== expected) {
      errors.push(
        `Migration sequence must be contiguous from 0001; expected ` +
          `${formatNumber(expected)} but found ${formatNumber(actual)}.`,
      );
      return;
    }
  }
}

function verifyLexicalOrder(files, entries, label) {
  if (files.length !== entries.length) {
    return;
  }
  const numericOrder = [...entries]
    .sort((left, right) => left.number - right.number)
    .map((entry) => entry.file);
  if (files.some((file, index) => file !== numericOrder[index])) {
    errors.push(`${label} filenames do not sort in numeric execution order.`);
  }
}

function compareFileNames(left, right) {
  return left.localeCompare(right, "en", { numeric: false });
}

function formatNumber(value) {
  if (!Number.isInteger(value)) {
    return String(value);
  }
  return String(value).padStart(4, "0");
}
