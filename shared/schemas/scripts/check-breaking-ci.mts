/**
 * check-breaking-ci.mts
 * Usage: npx tsx check-breaking-ci.mts <currentSnapshotsDir>
 *
 * Version CI du comparateur : recoit le repertoire des snapshots actuels en argument
 * et compare avec COMMITTED_SNAPSHOTS (env var) ou shared/schemas/snapshots/.
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const currentDir = process.argv[2];
const committedDir =
  process.env.COMMITTED_SNAPSHOTS ?? resolve(__dirname, "../snapshots");

if (!currentDir) {
  console.error("Usage: npx tsx check-breaking-ci.mts <currentSnapshotsDir>");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JsonSchemaField {
  type?: string | string[];
  format?: string;
  enum?: string[];
  $ref?: string;
  [key: string]: unknown;
}

interface JsonSchemaObject {
  properties?: Record<string, JsonSchemaField>;
  required?: string[];
}

interface SnapshotFile {
  _meta: { version: string; entity: string };
  schemas: Record<string, JsonSchemaObject>;
}

function fieldSignature(f: JsonSchemaField): string {
  if (f.$ref) return `$ref:${f.$ref}`;
  const t = Array.isArray(f.type) ? f.type.sort().join("|") : (f.type ?? "any");
  const fmt = f.format ? `:${f.format}` : "";
  const enm = f.enum ? `[${f.enum.sort().join(",")}]` : "";
  return `${t}${fmt}${enm}`;
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

const breakingChanges: string[] = [];
const warnings: string[] = [];
let totalChecked = 0;

const entities = readdirSync(committedDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => basename(f, ".json"));

for (const entity of entities) {
  const committedPath = resolve(committedDir, `${entity}.json`);
  const currentPath = resolve(currentDir, `${entity}.json`);

  if (!existsSync(currentPath)) {
    breakingChanges.push(`BREAKING [${entity}] Snapshot file missing from current build`);
    continue;
  }

  const committed: SnapshotFile = JSON.parse(readFileSync(committedPath, "utf-8"));
  const current: SnapshotFile = JSON.parse(readFileSync(currentPath, "utf-8"));

  for (const schemaName of Object.keys(committed.schemas)) {
    const old = committed.schemas[schemaName];
    const now = current.schemas[schemaName];
    totalChecked++;

    if (!now) {
      breakingChanges.push(`BREAKING [${entity}.${schemaName}] Schema REMOVED`);
      continue;
    }

    const oldProps = old.properties ?? {};
    const nowProps = now.properties ?? {};
    const oldRequired = new Set(old.required ?? []);
    const nowRequired = new Set(now.required ?? []);

    // Field removed
    for (const field of Object.keys(oldProps)) {
      if (!(field in nowProps)) {
        breakingChanges.push(`BREAKING [${entity}.${schemaName}] Field "${field}" REMOVED`);
      }
    }

    // Type changed
    for (const field of Object.keys(oldProps)) {
      if (!(field in nowProps)) continue;
      const os = fieldSignature(oldProps[field]);
      const ns = fieldSignature(nowProps[field]);
      if (os !== ns) {
        if (oldRequired.has(field)) {
          breakingChanges.push(
            `BREAKING [${entity}.${schemaName}] Required field "${field}" type changed: ${os} -> ${ns}`
          );
        } else {
          warnings.push(
            `[${entity}.${schemaName}] Optional field "${field}" type changed: ${os} -> ${ns}`
          );
        }
      }
    }

    // Optional -> required
    for (const field of Array.from(nowRequired)) {
      if (!oldRequired.has(field) && field in oldProps) {
        breakingChanges.push(
          `BREAKING [${entity}.${schemaName}] Field "${field}" changed optional -> REQUIRED`
        );
      }
    }

    // New required field
    for (const field of Array.from(nowRequired)) {
      if (!(field in oldProps)) {
        breakingChanges.push(
          `BREAKING [${entity}.${schemaName}] New REQUIRED field "${field}" added`
        );
      }
    }

    // New optional field (non-breaking)
    for (const field of Object.keys(nowProps)) {
      if (!(field in oldProps) && !nowRequired.has(field)) {
        warnings.push(`[${entity}.${schemaName}] New optional field "${field}" added (non-breaking)`);
      }
    }
  }

  // New schemas (non-breaking)
  for (const schemaName of Object.keys(current.schemas)) {
    if (!(schemaName in committed.schemas)) {
      warnings.push(`[${entity}.${schemaName}] New schema added (non-breaking)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(`Schema check: ${totalChecked} schema(s) across ${entities.length} entities.\n`);

if (warnings.length > 0) {
  console.log(`Warnings (${warnings.length}):`);
  warnings.forEach((w) => console.log("  " + w));
  console.log();
}

if (breakingChanges.length > 0) {
  console.error(`BREAKING CHANGES DETECTED (${breakingChanges.length}):`);
  breakingChanges.forEach((b) => console.error("  " + b));
  console.error(
    "\nTo resolve:\n" +
    "  1. Document the change in shared/schemas/CHANGELOG.md\n" +
    "  2. Bump SCHEMA_VERSION in shared/schemas/version.ts (MAJOR bump)\n" +
    "  3. Create the SQL migration if a DB column is affected\n" +
    "  4. Regenerate snapshots: cd frontend && npx tsx ../shared/schemas/scripts/generate-snapshots.mts\n" +
    "  5. Commit the updated snapshots alongside your schema changes"
  );
  process.exit(1);
} else {
  console.log("OK — no breaking changes.");
  process.exit(0);
}
