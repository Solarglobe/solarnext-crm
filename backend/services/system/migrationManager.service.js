/**
 * Validate existing migration history BEFORE any bootstrap or pending migration.
 * Existing unregistered/legacy references are reported; never silently repaired.
 */
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pool } from "../../config/db.js";
import { inspectMigrationHistory, assertMigrationIntegrity } from "./migrationIntegrity.js";

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS_DIR = path.join(BACKEND_ROOT, "migrations");

export async function runMigrationsSafely() {
  const before = await inspectMigrationHistory(pool, MIGRATIONS_DIR);
  assertMigrationIntegrity(before);
  if (before.pending.length) {
    console.log("[MigrationManager] Migrations en attente :", before.pending.length);
    execFileSync(process.execPath, ["scripts/run-pg-migrate.cjs", "up"], { stdio: "inherit", cwd: BACKEND_ROOT });
  }
  const after = await inspectMigrationHistory(pool, MIGRATIONS_DIR);
  assertMigrationIntegrity(after);
  const missing = after.comparison.filter(row => ["checksum_unregistered", "legacy_reference_unverifiable", "applied_file_missing"].includes(row.status));
  if (missing.length) console.warn("[MigrationManager] Références historiques à documenter, conservées sans modification :", missing.length);
  console.log("[MigrationManager] Contrôle terminé sans réparation des empreintes historiques.");
}
