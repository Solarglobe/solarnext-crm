import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { inspectMigrationHistory, assertMigrationIntegrity, prepareMigrationRun, normalizeMigrationContent, hashMigration } from "../services/system/migrationIntegrity.js";

const directory = path.resolve(import.meta.dirname, "../migrations");
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/migrations/production-history-2026-09-15.json", import.meta.url)));
test("recovered long-term migration retains exact deployed bytes without inventing a historical checksum", () => {
  const name = "1788900000000_add_long_term_follow_up_stage";
  assert.equal(hashMigration(fs.readFileSync(path.join(directory, name + ".js"))), "a543afac496938ca79e9f92a091e43083e15a4163202b3b4f384a867094c3737");
  assert.ok(fixture.applied.some(row => row.name === name));
  assert.equal(fixture.checksums.some(row => row.migration_name === name), false);
});
function snapshotDb(data = fixture) {
  const statements = [];
  return { statements, async query(sql) {
    statements.push(sql);
    if (sql.includes("to_regclass")) return { rows: [{ applied: "pgmigrations", checksums: "migration_checksums" }] };
    if (sql.includes("FROM public.pgmigrations")) return { rows: data.applied };
    if (sql.includes("FROM public.migration_checksums")) return { rows: data.checksums };
    throw new Error("Unexpected write or query");
  } };
}
test("the exact production history retains only the unresolved fourth mismatch", async () => {
  const db = snapshotDb(), report = await inspectMigrationHistory(db, directory);
  assert.equal(report.applied.length, 215);
  assert.deepEqual(report.comparison.filter(x => x.status === "substantive_mismatch").map(x => x.name), ["1776600000000_lead_sources_acquisition_canonical"]);
  assert.deepEqual(report.pending, ["1790400200000_monthly_consumption_meter_scope"]);
  assert.equal(db.statements.every(sql => sql.startsWith("SELECT")), true);
});
test("three restored versions match historical normalized references without rewriting raw checksums", () => {
  for (const name of ["1775930001000_reconcile_mail_fulltext_migration_checksum", "1775930002000_sync_mail_fulltext_migration_checksum_refs", "1776300001000_sync_leads_assigned_user_source_normalize_checksum"]) {
    const original = fixture.checksums.find(row => row.migration_name === name);
    assert.equal(hashMigration(normalizeMigrationContent(fs.readFileSync(path.join(directory, name + ".js"), "utf8"))), original.checksum_normalized);
  }
});
test("unresolved history prevents even bootstrap DDL and pending migration execution", async () => {
  const db = snapshotDb();
  await assert.rejects(prepareMigrationRun(db, directory), { code: "MIGRATION_TAMPERED_SUBSTANTIVE" });
  assert.equal(db.statements.every(sql => sql.startsWith("SELECT")), true);
});
test("development mode cannot bypass substantive drift", async () => {
  const report = await inspectMigrationHistory(snapshotDb(), directory);
  for (const NODE_ENV of ["test", "development", "production"]) assert.throws(() => assertMigrationIntegrity(report, { NODE_ENV }), { code: "MIGRATION_TAMPERED_SUBSTANTIVE" });
});
test("automatic repair is explicitly forbidden even with otherwise matching history", () => {
  assert.throws(() => assertMigrationIntegrity({ applied: [], comparison: [] }, { MIGRATION_AUTO_REPAIR_CHECKSUMS: "1" }), { code: "MIGRATION_CHECKSUM_REPAIR_FORBIDDEN" });
});
test("missing historical metadata is not silently generated for an existing database", () => {
  assert.throws(() => assertMigrationIntegrity({ applied: ["existing"], comparison: [], checksumTableExists: false }, {}), { code: "MIGRATION_CHECKSUM_HISTORY_MISSING" });
});
test("unknown and missing references are reported, never registered by inspection", async () => {
  const db = snapshotDb(), report = await inspectMigrationHistory(db, directory);
  assert.equal(report.comparison.filter(x => x.status === "checksum_unregistered").length, 70);
  assert.deepEqual(report.comparison.filter(x => x.status === "applied_file_missing").map(x => x.name), []);
  assert.equal(db.statements.some(sql => /INSERT|UPDATE|ALTER|CREATE/.test(sql)), false);
});
test("fresh databases alone receive the metadata table before historical migrations", async () => {
  const statements = [], db = { async query(sql) { statements.push(sql); return { rows: sql.startsWith("SELECT") ? [{ applied: null, checksums: null }] : [] }; } };
  const report = await prepareMigrationRun(db, directory);
  assert.equal(report.applied.length, 0); assert.equal(report.pending.length, 216);
  assert.equal(statements.filter(sql => sql.startsWith("CREATE TABLE")).length, 1);
});
