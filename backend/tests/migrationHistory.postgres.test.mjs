import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import pg from "pg";
import { inspectMigrationHistory, prepareMigrationRun } from "../services/system/migrationIntegrity.js";

const historyUrl = process.env.MIGRATION_HISTORY_TEST_DATABASE_URL;
const freshUrl = process.env.MIGRATION_FRESH_TEST_DATABASE_URL;
const root = path.resolve(import.meta.dirname, "../.."), directory = path.join(root, "backend/migrations");
const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/migrations/production-history-2026-09-15.json", import.meta.url)));
async function connect(url, name) {
  const parsed = new URL(url);
  assert.ok(["127.0.0.1", "localhost"].includes(parsed.hostname)); assert.equal(parsed.pathname, "/" + name);
  const client = new pg.Client({ connectionString: url, options: "-c default_transaction_read_only=on" });
  await client.connect(); assert.equal((await client.query("SELECT current_database() AS db")).rows[0].db, name);
  return client;
}
async function snapshot(client) {
  return {
    applied: (await client.query("SELECT json_agg(to_jsonb(m) ORDER BY id) AS rows FROM pgmigrations m")).rows[0].rows,
    checksums: (await client.query("SELECT json_agg(to_jsonb(m) ORDER BY migration_name) AS rows FROM migration_checksums m")).rows[0].rows,
    ownership: (await client.query("SELECT conname FROM pg_constraint WHERE conname='lcm_v21_meter_ownership_fk'")).rows,
  };
}
const invoke = (args, env) => new Promise(resolve => {
  const child = spawn(process.execPath, args, { cwd: path.join(root, "backend"), env, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", b => { output += b; }); child.stderr.on("data", b => { output += b; });
  child.on("close", code => resolve({ code, output }));
});
test("local PostgreSQL fixture reproduces all 215 migration rows and 145 references exactly", { skip: !historyUrl }, async () => {
  const client = await connect(historyUrl, "rc2_history_fixture");
  try {
    const current = await snapshot(client); assert.deepEqual(current.applied, fixture.applied); assert.deepEqual(current.checksums, fixture.checksums); assert.deepEqual(current.ownership, []);
    const report = await inspectMigrationHistory(client, directory);
    assert.deepEqual(report.comparison.filter(x => x.status === "substantive_mismatch").map(x => x.name), ["1776600000000_lead_sources_acquisition_canonical"]);
  } finally { await client.end(); }
});
test("read-only preflight refuses historical drift without changing metadata or schema", { skip: !historyUrl }, async () => {
  const client = await connect(historyUrl, "rc2_history_fixture");
  try {
    const before = await snapshot(client);
    await assert.rejects(prepareMigrationRun(client, directory), { code: "MIGRATION_TAMPERED_SUBSTANTIVE" });
    assert.deepEqual(await snapshot(client), before);
  } finally { await client.end(); }
});
test("real migration CLI refuses the pending V21 migration before any write", { skip: !historyUrl }, async () => {
  const client = await connect(historyUrl, "rc2_history_fixture");
  try {
    const before = await snapshot(client);
    const result = await invoke(["scripts/run-pg-migrate.cjs", "up"], { ...process.env, DATABASE_URL: historyUrl, DB_HOST: "127.0.0.1", PGHOST: "127.0.0.1", NODE_ENV: "production", MIGRATION_AUTO_REPAIR_CHECKSUMS: "" });
    assert.equal(result.code, 1); assert.match(result.output, /MIGRATION_RUN_REFUSED/); assert.deepEqual(await snapshot(client), before);
  } finally { await client.end(); }
});
test("real startup checks the existing history before launching pending migrations", { skip: !historyUrl }, async () => {
  const client = await connect(historyUrl, "rc2_history_fixture");
  try {
    const before = await snapshot(client);
    const code = 'import {runMigrationsSafely} from "./services/system/migrationManager.service.js"; import {pool} from "./config/db.js"; try { await runMigrationsSafely(); process.exitCode=2; } catch(e) { if(e.code!=="MIGRATION_TAMPERED_SUBSTANTIVE")process.exitCode=3; } finally { await pool.end(); }';
    const result = await invoke(["--input-type=module", "-e", code], { ...process.env, DATABASE_URL: historyUrl, DB_HOST: "127.0.0.1", PGHOST: "127.0.0.1", NODE_ENV: "production", MIGRATION_AUTO_REPAIR_CHECKSUMS: "" });
    assert.equal(result.code, 0, result.output); assert.deepEqual(await snapshot(client), before);
  } finally { await client.end(); }
});
test("a genuinely fresh database runs all historical migrations and registers only their actual versions", { skip: !freshUrl }, async () => {
  const client = await connect(freshUrl, "rc2_fresh");
  try {
    const report = await inspectMigrationHistory(client, directory);
    assert.equal(report.applied.length, 216); assert.equal(report.pending.length, 0);
    assert.equal(report.comparison.every(row => ["raw_match", "normalized_match"].includes(row.status)), true);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM migration_checksums")).rows[0].n, 216);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_constraint WHERE conname='lcm_v21_meter_ownership_fk' AND convalidated")).rows[0].n, 1);
  } finally { await client.end(); }
});
