import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const normalizeMigrationContent = content => String(content).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(line => line.trim() && !/^\/\//.test(line.trim())).map(line => line.replace(/\s+$/g, "")).join("\n").trim();
export const hashMigration = content => crypto.createHash("sha256").update(content).digest("hex");
const error = code => Object.assign(new Error(code), { code });

/** Catalog/SELECT only. No checksum registration, repair, bootstrap or migrations. */
export async function inspectMigrationHistory(db, directory) {
  const state = (await db.query("SELECT to_regclass('public.pgmigrations') AS applied, to_regclass('public.migration_checksums') AS checksums")).rows[0];
  const applied = state.applied ? (await db.query("SELECT name FROM public.pgmigrations ORDER BY id")).rows.map(row => row.name) : [];
  const stored = state.checksums ? (await db.query("SELECT migration_name, checksum, checksum_normalized FROM public.migration_checksums")).rows : [];
  const files = fs.readdirSync(directory).filter(file => file.endsWith(".js")).map(file => file.slice(0, -3)).sort();
  const checksums = new Map(stored.map(row => [row.migration_name, row]));
  const comparison = applied.map(name => {
    if (!/^[0-9]+_[A-Za-z0-9_-]+$/.test(name)) throw error("MIGRATION_NAME_INVALID");
    if (!files.includes(name)) return { name, status: "applied_file_missing" };
    const content = fs.readFileSync(path.join(directory, name + ".js"), "utf8"), reference = checksums.get(name);
    if (!reference) return { name, status: "checksum_unregistered" };
    if (reference.checksum === hashMigration(content)) return { name, status: "raw_match" };
    if (!reference.checksum_normalized) return { name, status: "legacy_reference_unverifiable" };
    return { name, status: reference.checksum_normalized === hashMigration(normalizeMigrationContent(content)) ? "normalized_match" : "substantive_mismatch" };
  });
  return { applied, pending: files.filter(name => !applied.includes(name)), comparison, checksumTableExists: Boolean(state.checksums) };
}

export function assertMigrationIntegrity(report, env = process.env) {
  if (env.MIGRATION_AUTO_REPAIR_CHECKSUMS) throw error("MIGRATION_CHECKSUM_REPAIR_FORBIDDEN");
  if (report.applied.length && !report.checksumTableExists) throw error("MIGRATION_CHECKSUM_HISTORY_MISSING");
  if (report.comparison.some(row => row.status === "substantive_mismatch")) throw error("MIGRATION_TAMPERED_SUBSTANTIVE");
}

/** Explicit migration runner only: initialize metadata on a genuinely empty DB. */
export async function prepareMigrationRun(db, directory) {
  const report = await inspectMigrationHistory(db, directory);
  assertMigrationIntegrity(report);
  if (!report.applied.length && !report.checksumTableExists) {
    await db.query(`CREATE TABLE public.migration_checksums (
      migration_name text PRIMARY KEY, checksum text NOT NULL,
      created_at timestamptz DEFAULT now(), checksum_normalized text NULL
    )`);
  }
  return report;
}

/** Register only migrations actually applied by this run; never rewrite history. */
export async function recordNewMigrationChecksums(db, directory, before) {
  const after = await inspectMigrationHistory(db, directory);
  for (const name of after.applied.filter(name => !before.applied.includes(name))) {
    const content = fs.readFileSync(path.join(directory, name + ".js"), "utf8");
    await db.query(`INSERT INTO public.migration_checksums (migration_name, checksum, checksum_normalized)
      VALUES ($1, $2, $3) ON CONFLICT (migration_name) DO NOTHING`,
    [name, hashMigration(content), hashMigration(normalizeMigrationContent(content))]);
  }
  assertMigrationIntegrity(await inspectMigrationHistory(db, directory));
}
