import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import pg from "pg";
import { CANONICAL_SOURCES, OLD, SQL, TARGET, currentReference, reconcileLeadSources } from "../services/system/reconciliation/leadSourcesReconciliation.js";
import { parseArgs, connectionOptions, writePrivateJson } from "../scripts/reconcile-lead-sources-checksum.mjs";
import { inspectMigrationHistory, prepareMigrationRun } from "../services/system/migrationIntegrity.js";

const url = process.env.MIGRATION_RECONCILIATION_TEST_DATABASE_URL;
const run = (name, fn) => test(name, { skip: !url }, fn);
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/migrations/production-history-2026-09-15.json", import.meta.url)));
const directory = path.resolve(import.meta.dirname, "../migrations");
let client, organization;
const connect = async () => { const c = new pg.Client({ connectionString: url }); await c.connect(); return c; };
const meta = async () => ({ applied: (await client.query(SQL.applied)).rows[0].rows, checksums: (await client.query(SQL.checksums)).rows[0].rows });
const options = extra => ({ client, confirmDatabase: "rc3_reconciliation", ...extra });
before(async () => {
  if (!url) return;
  const u = new URL(url); assert.ok(["127.0.0.1", "localhost"].includes(u.hostname)); assert.equal(u.pathname, "/rc3_reconciliation");
  client = await connect();
  assert.equal((await client.query(SQL.identity)).rows[0].version, 140024);
  assert.deepEqual(await meta(), { applied: fixture.applied, checksums: fixture.checksums });
  assert.equal((await client.query("SELECT count(*)::int AS n FROM organizations")).rows[0].n, 0, "Empty business fixture required; never run on real data");
  organization = (await client.query("INSERT INTO organizations(name) VALUES ('RC3 FICTION ONLY') RETURNING id")).rows[0].id;
  for (const source of CANONICAL_SOURCES) await client.query("INSERT INTO lead_sources(organization_id,name,slug,sort_order) VALUES($1,$2,$3,$4)", [organization, source.name, source.slug, source.sort_order]);
});
beforeEach(async () => { if (client) await client.query("UPDATE migration_checksums SET checksum=$2,checksum_normalized=$3 WHERE migration_name=$1", [TARGET, OLD.checksum, OLD.checksum_normalized]); });
after(async () => {
  if (!client) return;
  try {
  await client.query("UPDATE migration_checksums SET checksum=$2,checksum_normalized=$3 WHERE migration_name=$1", [TARGET, OLD.checksum, OLD.checksum_normalized]);
  // Database name and emptiness are guarded before setup; all rows here are ours.
  await client.query("TRUNCATE organizations CASCADE");
  } finally { await client.end(); }
});

test("CLI is dry-run by default and requires the exact name; apply is never inferred", () => {
  const args = ["--confirm-database", "fixture", "--confirm-migration", TARGET, "--report", "fixture.json"];
  assert.equal(parseArgs(args).mode, "dry-run");
  assert.throws(() => parseArgs([...args, "--apply"]));
  assert.throws(() => parseArgs(args.map(x => x === TARGET ? "1776600000000_leads_archived_at_ensure" : x)));
  assert.throws(() => parseArgs([...args, "--auto-repair"]));
  assert.throws(() => connectionOptions({ DATABASE_URL: "postgres://fake@127.0.0.1/fixture" }, "apply"));
});
run("default dry-run is read-only, checks the entire recorded history and changes nothing", async () => {
  const beforeState = await meta(), statements = [];
  const db = { query: (...args) => { statements.push(args[0]); return client.query(...args); } };
  const result = await reconcileLeadSources(options({ client: db }));
  assert.equal(result.changed, 0); assert.equal(result.sources_checked, 14);
  assert.deepEqual(await meta(), beforeState);
  assert.match(statements[0], /READ ONLY/);
  assert.ok(statements.every(s => !/^(?:UPDATE|INSERT|DELETE|ALTER|CREATE)|FOR UPDATE|pg_advisory/.test(s)));
});
run("apply saves the complete previous row before UPDATE, changes one reference and verifies after reconnect", async () => {
  const beforeState = await meta(), statements = []; let receipt;
  const db = { query: (...args) => { statements.push(args[0]); if (args[0] === SQL.update) assert.ok(receipt); return client.query(...args); } };
  const result = await reconcileLeadSources(options({ client: db, mode: "apply", writersStopped: true, receipt: value => { receipt = value; } }));
  assert.equal(result.changed, 1);
  assert.deepEqual(receipt.previous, fixture.checksums.find(r => r.migration_name === TARGET));
  const afterState = await meta();
  assert.deepEqual(afterState.applied, beforeState.applied);
  assert.deepEqual(afterState.checksums, beforeState.checksums.map(row => row.migration_name === TARGET ? { ...row, ...currentReference() } : row));
  assert.equal(statements.filter(s => /FOR UPDATE/.test(s)).length, 1);
  assert.equal(statements.filter(s => /^UPDATE/.test(s)).length, 1);
  const other = await connect();
  try { assert.equal((await reconcileLeadSources(options({ client: other, mode: "verify", priorReceipt: receipt }))).status, "COMPATIBLE"); } finally { await other.end(); }
  assert.equal((await prepareMigrationRun(client, directory)).comparison.some(r => r.status === "substantive_mismatch"), false);
  await assert.rejects(reconcileLeadSources(options({ mode: "apply", writersStopped: true, receipt: () => {} })), { code: "RECONCILIATION_OLD_REFERENCE_DIFFERENT" });
});
run("a changed old fingerprint refuses even with otherwise valid schema", async () => {
  await client.query("UPDATE migration_checksums SET checksum='fictional-mismatch' WHERE migration_name=$1", [TARGET]);
  await assert.rejects(reconcileLeadSources(options()), { code: "RECONCILIATION_CHECKSUM_HISTORY_CHANGED" });
});
run("69 missing references and the missing historical file are preserved, not repaired", async () => {
  const beforeState = await meta();
  assert.equal(fixture.applied.length - fixture.checksums.length, 70); // One pending reference relationship is also represented in the recorded fixture.
  await reconcileLeadSources(options({ mode: "apply", writersStopped: true, receipt: () => {} }));
  const report = await inspectMigrationHistory(client, directory);
  assert.equal(report.comparison.filter(r => r.status === "checksum_unregistered").length, 69);
  assert.deepEqual(report.comparison.filter(r => r.status === "applied_file_missing").map(r => r.name), ["1788900000000_add_long_term_follow_up_stage"]);
  assert.equal((await meta()).checksums.length, beforeState.checksums.length);
});
// Each fixture mutation is restored in finally on the dedicated local clone.
for (const [name, change, restore, code] of [
  ["nullable slug", "ALTER TABLE lead_sources ALTER COLUMN slug DROP NOT NULL", "ALTER TABLE lead_sources ALTER COLUMN slug SET NOT NULL", "RECONCILIATION_SCHEMA_COLUMNS"],
  ["wrong slug type", "DROP TRIGGER trg_fill_lead_source_defaults ON lead_sources; ALTER TABLE lead_sources ALTER COLUMN slug TYPE varchar(65); CREATE TRIGGER trg_fill_lead_source_defaults BEFORE INSERT OR UPDATE OF name,slug,sort_order ON lead_sources FOR EACH ROW EXECUTE FUNCTION sg_fill_lead_source_defaults()", "DROP TRIGGER trg_fill_lead_source_defaults ON lead_sources; ALTER TABLE lead_sources ALTER COLUMN slug TYPE varchar(64); CREATE TRIGGER trg_fill_lead_source_defaults BEFORE INSERT OR UPDATE OF name,slug,sort_order ON lead_sources FOR EACH ROW EXECUTE FUNCTION sg_fill_lead_source_defaults()", "RECONCILIATION_SCHEMA_COLUMNS"],
  ["wrong default", "ALTER TABLE lead_sources ALTER COLUMN sort_order SET DEFAULT 15", "ALTER TABLE lead_sources ALTER COLUMN sort_order SET DEFAULT 99", "RECONCILIATION_SCHEMA_COLUMNS"],
  ["extra constraint", "ALTER TABLE lead_sources ADD CONSTRAINT rc3_unexpected CHECK(sort_order>0)", "ALTER TABLE lead_sources DROP CONSTRAINT rc3_unexpected", "RECONCILIATION_SCHEMA_CONSTRAINTS"],
  ["extra index", "CREATE INDEX rc3_unexpected ON lead_sources(name)", "DROP INDEX rc3_unexpected", "RECONCILIATION_SCHEMA_INDEXES"],
  ["missing uniqueness", "DROP INDEX lead_sources_organization_id_slug_uidx", "CREATE UNIQUE INDEX lead_sources_organization_id_slug_uidx ON lead_sources(organization_id,slug)", "RECONCILIATION_SCHEMA_INDEXES"],
  ["unvalidated ownership constraint", "ALTER TABLE lead_sources DROP CONSTRAINT lead_sources_organization_id_fkey; ALTER TABLE lead_sources ADD CONSTRAINT lead_sources_organization_id_fkey FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE NOT VALID", "ALTER TABLE lead_sources VALIDATE CONSTRAINT lead_sources_organization_id_fkey", "RECONCILIATION_SCHEMA_CONSTRAINTS"],
  ["disabled source trigger", "ALTER TABLE lead_sources DISABLE TRIGGER trg_fill_lead_source_defaults", "ALTER TABLE lead_sources ENABLE TRIGGER trg_fill_lead_source_defaults", "RECONCILIATION_SCHEMA_TRIGGERS"],
  ["RLS hiding rows", "ALTER TABLE lead_sources ENABLE ROW LEVEL SECURITY", "ALTER TABLE lead_sources DISABLE ROW LEVEL SECURITY", "RECONCILIATION_UNSAFE_RELATION"],
  ["unknown slug", "UPDATE lead_sources SET slug='fictional_unknown' WHERE slug='seo'", "UPDATE lead_sources SET slug='seo' WHERE slug='fictional_unknown'", "RECONCILIATION_DATA_DIFFERENT"],
  ["changed canonical order", "UPDATE lead_sources SET sort_order=99 WHERE slug='seo'", "UPDATE lead_sources SET sort_order=5 WHERE slug='seo'", "RECONCILIATION_DATA_DIFFERENT"],
  ["changed canonical name", "UPDATE lead_sources SET name='FICTITIOUS DRIFT' WHERE slug='seo'", "UPDATE lead_sources SET name='SEO (référencement naturel)' WHERE slug='seo'", "RECONCILIATION_DATA_DIFFERENT"],
]) run(`one differing precondition refuses: ${name}`, async () => {
  const beforeState = await meta(); await client.query(change);
  try { await assert.rejects(reconcileLeadSources(options({ mode: "apply", writersStopped: true, receipt: () => { assert.fail("Receipt must not be written"); } })), { code }); assert.deepEqual(await meta(), beforeState); }
  finally { await client.query(restore); }
});
run("a lead linked to another organization is refused without changing any business row", async () => {
  const org2 = (await client.query("INSERT INTO organizations(name) VALUES('RC3 SECOND FICTION') RETURNING id")).rows[0].id;
  for (const s of CANONICAL_SOURCES) await client.query("INSERT INTO lead_sources(organization_id,name,slug,sort_order) VALUES($1,$2,$3,$4)", [org2, s.name, s.slug, s.sort_order]);
  const stage = (await client.query("INSERT INTO pipeline_stages(organization_id,name,position,is_closed) VALUES($1,'FICTION',0,false) RETURNING id", [org2])).rows[0].id;
  const source = (await client.query("SELECT id FROM lead_sources WHERE organization_id=$1 AND slug='seo'", [organization])).rows[0].id;
  const lead = (await client.query("INSERT INTO leads(organization_id,stage_id,source_id,full_name) VALUES($1,$2,$3,'RC3 FICTION') RETURNING id", [org2, stage, source])).rows[0].id;
  try {
    await assert.rejects(reconcileLeadSources(options()), { code: "RECONCILIATION_DATA_DIFFERENT" });
    assert.equal((await client.query("SELECT source_id FROM leads WHERE id=$1", [lead])).rows[0].source_id, source);
  } finally {
    await client.query("DELETE FROM leads WHERE id=$1", [lead]);
    await client.query("DELETE FROM pipeline_stages WHERE id=$1", [stage]);
    await client.query("DELETE FROM lead_sources WHERE organization_id=$1", [org2]);
    await client.query("DELETE FROM organizations WHERE id=$1", [org2]);
  }
});
run("an extra checksum UPDATE trigger is refused before it can touch another reference", async () => {
  const beforeState = await meta();
  await client.query("CREATE FUNCTION rc3_refuse_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FICTION'; END $$; CREATE TRIGGER rc3_refuse BEFORE UPDATE ON migration_checksums FOR EACH ROW EXECUTE FUNCTION rc3_refuse_trigger()");
  try { await assert.rejects(reconcileLeadSources(options({ mode: "apply", writersStopped: true, receipt: () => assert.fail("No receipt before validation") })), { code: "RECONCILIATION_SCHEMA_METADATA_TRIGGERS" }); assert.deepEqual(await meta(), beforeState); }
  finally { await client.query("DROP TRIGGER rc3_refuse ON migration_checksums; DROP FUNCTION rc3_refuse_trigger()"); }
});
run("a prepared receipt cannot authorize a different database or different source revision", async () => {
  let receipt;
  await reconcileLeadSources(options({ mode: "apply", writersStopped: true, receipt: value => { receipt = value; } }));
  await assert.rejects(reconcileLeadSources(options({ mode: "verify", priorReceipt: { ...receipt, target: { ...receipt.target, database: "not-this-fixture" } } })), { code: "RECONCILIATION_RECEIPT_TARGET_DIFFERENT" });
  await assert.rejects(reconcileLeadSources(options({ mode: "verify", priorReceipt: { ...receipt, next: OLD } })), { code: "RECONCILIATION_RECEIPT_NEXT_DIFFERENT" });
});
run("target row contention refuses; an unrelated locked checksum does not block the apply", async () => {
  const other = await connect();
  try {
    await other.query("BEGIN"); await other.query(SQL.lock, [TARGET]);
    await assert.rejects(reconcileLeadSources(options({ mode: "apply", writersStopped: true, receipt: () => {} })), { code: "RECONCILIATION_TRANSACTION_REFUSED" });
    await other.query("ROLLBACK"); await other.query("BEGIN");
    await other.query(SQL.lock, [fixture.checksums[0].migration_name]);
    assert.equal((await reconcileLeadSources(options({ mode: "apply", writersStopped: true, receipt: () => {} }))).changed, 1);
  } finally { await other.query("ROLLBACK"); await other.end(); }
});
run("interruption after UPDATE rolls back; retry retains the original reference until commit", async () => {
  const beforeState = await meta(), controller = new AbortController(); let receipt;
  const db = { query: async (...args) => { const result = await client.query(...args); if (args[0] === SQL.update) controller.abort(); return result; } };
  await assert.rejects(reconcileLeadSources(options({ client: db, mode: "apply", writersStopped: true, signal: controller.signal, receipt: value => { receipt = value; } })), { code: "RECONCILIATION_INTERRUPTED" });
  assert.ok(receipt); assert.deepEqual(await meta(), beforeState);
  assert.equal((await reconcileLeadSources(options({ mode: "apply", writersStopped: true, receipt: () => {} }))).changed, 1);
});
run("receipt failure leaves the database untouched", async () => {
  const beforeState = await meta();
  await assert.rejects(reconcileLeadSources(options({ mode: "apply", writersStopped: true, receipt: () => { throw Error("fixture IO error"); } })));
  assert.deepEqual(await meta(), beforeState);
});
run("lost COMMIT acknowledgement is resolved by reconnecting and verifying the saved PREPARED receipt", async () => {
  let receipt;
  const db = { query: async (...args) => { const result = await client.query(...args); if (args[0] === "COMMIT") throw Error("fixture dropped acknowledgement"); return result; } };
  await assert.rejects(reconcileLeadSources(options({ client: db, mode: "apply", writersStopped: true, receipt: value => { receipt = value; } })));
  const other = await connect();
  try { assert.equal((await reconcileLeadSources(options({ client: other, mode: "verify", priorReceipt: receipt }))).changed, 0); }
  finally { await other.end(); }
});
run("actual CLI dry-run, explicit apply, private receipt and postcheck pass without logging row values", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc3-fictitious-reconcile-"));
  const preflight = path.join(dir, "dry.json"), receipt = path.join(dir, "receipt.json");
  const invoke = args => new Promise(resolve => {
    const p = spawn(process.execPath, [path.resolve(import.meta.dirname, "../scripts/reconcile-lead-sources-checksum.mjs"), "--confirm-database", "rc3_reconciliation", "--confirm-migration", TARGET, ...args], { env: { ...process.env, MIGRATION_RECONCILIATION_DATABASE_URL: url }, windowsHide: true });
    let output = ""; p.stdout.on("data", b => { output += b; }); p.stderr.on("data", b => { output += b; }); p.on("close", code => resolve({ code, output }));
  });
  const dry = await invoke(["--report", preflight]); assert.equal(dry.code, 0, dry.output);
  const apply = await invoke(["--apply", "--confirm-writers-stopped", "--preflight", preflight, "--receipt", receipt]); assert.equal(apply.code, 0, apply.output);
  const verify = await invoke(["--verify", "--receipt", receipt]); assert.equal(verify.code, 0, verify.output);
  for (const result of [dry, apply, verify]) { assert.ok(!result.output.includes(OLD.checksum)); assert.ok(!result.output.includes(organization)); assert.ok(!result.output.includes(url)); }
  assert.equal(JSON.parse(fs.readFileSync(receipt)).previous.checksum, OLD.checksum);
  assert.throws(() => writePrivateJson(receipt, {}), { code: "EEXIST" });
  if (process.platform !== "win32") assert.equal(fs.statSync(receipt).mode & 0o077, 0);
});
