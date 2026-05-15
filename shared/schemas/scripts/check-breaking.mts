/**
 * check-breaking.mts
 * Usage (from repo root) : cd frontend && npx tsx ../shared/schemas/scripts/check-breaking.mts
 *
 * Compare les snapshots ACTUELS (generes a la volee) avec les snapshots COMMITES.
 * Echoue (exit 1) si un breaking change est detecte, avec un message explicite.
 *
 * Breaking changes detectes :
 *   - Champ present dans l'ancien snapshot mais absent du nouveau         → SUPPRESSION
 *   - Type d'un champ requis change entre deux versions                   → TYPE CHANGE
 *   - Champ qui etait optionnel devient requis                            → OPTIONNEL->REQUIS
 *   - Nouveau champ requis ajoute                                         → AJOUT REQUIS
 *
 * Non-breaking (warning seulement) :
 *   - Nouveau champ optionnel ajoute
 *   - Contrainte plus stricte sur un champ optionnel
 */

import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "../../..");
const snapshotsDir = resolve(__dirname, "../snapshots");
const entities = ["lead", "study", "quote", "invoice", "scenario", "geometry"];

// ---------------------------------------------------------------------------
// Helpers
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
  [key: string]: unknown;
}

interface SnapshotFile {
  _meta: { version: string; entity: string };
  schemas: Record<string, JsonSchemaObject>;
}

function fieldSignature(field: JsonSchemaField): string {
  if (field.$ref) return `$ref:${field.$ref}`;
  const type = Array.isArray(field.type) ? field.type.sort().join("|") : (field.type ?? "any");
  const format = field.format ? `:${field.format}` : "";
  const enumVals = field.enum ? `[${field.enum.sort().join(",")}]` : "";
  return `${type}${format}${enumVals}`;
}

// ---------------------------------------------------------------------------
// Generate current snapshots into a temp buffer (dont write to disk)
// ---------------------------------------------------------------------------

// Re-generate snapshots to a temp dir
import { mkdirSync, cpSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const tmpSnapshotsDir = join(tmpdir(), `schema-check-${Date.now()}`);
mkdirSync(tmpSnapshotsDir, { recursive: true });

// Copy current snapshots to compare against committed ones
// Then regenerate into tmpSnapshotsDir
try {
  execSync(
    `cd "${resolve(root, "frontend")}" && npx tsx ../shared/schemas/scripts/generate-snapshots-to.mts "${tmpSnapshotsDir}"`,
    { stdio: "pipe" }
  );
} catch (err) {
  console.error("Failed to generate current snapshots:", (err as Error).message);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

const breakingChanges: string[] = [];
const warnings: string[] = [];
let totalChecked = 0;

for (const entity of entities) {
  const committedPath = resolve(snapshotsDir, `${entity}.json`);
  const currentPath = resolve(tmpSnapshotsDir, `${entity}.json`);

  if (!existsSync(committedPath)) {
    warnings.push(`[${entity}] No committed snapshot — skipping (first run?)`);
    continue;
  }
  if (!existsSync(currentPath)) {
    breakingChanges.push(`[${entity}] Current snapshot not generated — schema file may be broken`);
    continue;
  }

  const committed: SnapshotFile = JSON.parse(readFileSync(committedPath, "utf-8"));
  const current: SnapshotFile = JSON.parse(readFileSync(currentPath, "utf-8"));

  for (const schemaName of Object.keys(committed.schemas)) {
    const old = committed.schemas[schemaName];
    const now = current.schemas[schemaName];
    totalChecked++;

    if (!now) {
      breakingChanges.push(
        `BREAKING [${entity}.${schemaName}] Schema REMOVED entirely`
      );
      continue;
    }

    const oldProps = old.properties ?? {};
    const nowProps = now.properties ?? {};
    const oldRequired = new Set(old.required ?? []);
    const nowRequired = new Set(now.required ?? []);

    // Champs supprimes
    for (const field of Object.keys(oldProps)) {
      if (!(field in nowProps)) {
        breakingChanges.push(
          `BREAKING [${entity}.${schemaName}] Field "${field}" REMOVED`
        );
      }
    }

    // Champs dont le type change (seulement ceux qui etaient requis)
    for (const field of Object.keys(oldProps)) {
      if (!(field in nowProps)) continue; // deja signale ci-dessus
      const oldSig = fieldSignature(oldProps[field]);
      const nowSig = fieldSignature(nowProps[field]);
      if (oldSig !== nowSig) {
        if (oldRequired.has(field)) {
          breakingChanges.push(
            `BREAKING [${entity}.${schemaName}] Required field "${field}" type changed: ${oldSig} → ${nowSig}`
          );
        } else {
          warnings.push(
            `[${entity}.${schemaName}] Optional field "${field}" type changed: ${oldSig} → ${nowSig}`
          );
        }
      }
    }

    // Champs optionnels devenus requis
    for (const field of Array.from(nowRequired)) {
      if (!oldRequired.has(field) && field in oldProps) {
        breakingChanges.push(
          `BREAKING [${entity}.${schemaName}] Field "${field}" changed from optional to REQUIRED`
        );
      }
    }

    // Nouveau champ requis
    for (const field of Array.from(nowRequired)) {
      if (!(field in oldProps)) {
        breakingChanges.push(
          `BREAKING [${entity}.${schemaName}] New REQUIRED field "${field}" added`
        );
      }
    }

    // Nouveau champ optionnel (non-breaking)
    for (const field of Object.keys(nowProps)) {
      if (!(field in oldProps) && !nowRequired.has(field)) {
        warnings.push(
          `[${entity}.${schemaName}] New optional field "${field}" added (non-breaking)`
        );
      }
    }
  }

  // Schemas nouveaux dans current (non-breaking)
  for (const schemaName of Object.keys(current.schemas)) {
    if (!(schemaName in committed.schemas)) {
      warnings.push(
        `[${entity}.${schemaName}] New schema added (non-breaking)`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(`\nSchema check: ${totalChecked} schema(s) compared across ${entities.length} entities.\n`);

if (warnings.length > 0) {
  console.log(`WARNINGS (${warnings.length}):`);
  warnings.forEach((w) => console.log("  " + w));
  console.log();
}

if (breakingChanges.length > 0) {
  console.error(`BREAKING CHANGES DETECTED (${breakingChanges.length}):`);
  breakingChanges.forEach((b) => console.error("  " + b));
  console.error(
    "\nAction required:\n" +
    "  1. Document the breaking change in shared/schemas/CHANGELOG.md\n" +
    "  2. Bump SCHEMA_VERSION in shared/schemas/version.ts (MAJOR)\n" +
    "  3. Create the corresponding SQL migration if a DB column is affected\n" +
    "  4. Re-run: cd frontend && npx tsx ../shared/schemas/scripts/generate-snapshots.mts\n" +
    "  5. Commit the updated snapshots"
  );
  process.exit(1);
} else {
  console.log("No breaking changes detected.");
  process.exit(0);
}
