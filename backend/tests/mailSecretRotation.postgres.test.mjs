import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import pg from "pg";
import { createMailCipher } from "../services/security/encryption.service.js";
import { rotateMailSecrets } from "../services/security/mailSecretRotation.js";

const url = process.env.MAIL_ROTATION_TEST_DATABASE_URL;
const run = (name, fn) => test(name, { skip: !url }, fn);
const oldKey = Buffer.alloc(32, 51), newKey = Buffer.alloc(32, 68);
const env = { MAIL_ENCRYPTION_KEYS: JSON.stringify({ retired: oldKey.toString("hex"), active: newKey.toString("hex") }), MAIL_ENCRYPTION_ACTIVE_KEY_ID: "active", MAIL_ENCRYPTION_LEGACY_KEY_ID: "retired" };
const cipher = createMailCipher(env);
const activeOnly = createMailCipher({ MAIL_ENCRYPTION_KEYS: JSON.stringify({ active: newKey.toString("hex") }), MAIL_ENCRYPTION_ACTIVE_KEY_ID: "active" });
let client;
function legacy(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", oldKey, iv);
  const data = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return { v: 1, alg: "aes-256-gcm", iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
}
const insert = async value => client.query("INSERT INTO mail_accounts(id,encrypted_credentials) VALUES($1,$2)", [crypto.randomUUID(), value]);
const rows = async () => (await client.query("SELECT id,encrypted_credentials FROM mail_accounts ORDER BY id")).rows;
before(async () => {
  if (!url) return;
  const u = new URL(url);
  assert.ok(["127.0.0.1", "localhost"].includes(u.hostname));
  assert.equal(u.pathname, "/rc2_mail_rotation", "Dedicated disposable DB only");
  client = new pg.Client({ connectionString: url }); await client.connect();
  assert.equal((await client.query("SELECT current_database() AS db")).rows[0].db, "rc2_mail_rotation");
  await client.query(`CREATE TABLE IF NOT EXISTS mail_accounts(id uuid PRIMARY KEY,encrypted_credentials jsonb);
    CREATE TABLE IF NOT EXISTS mail_account_oauth_states(id uuid PRIMARY KEY,code_verifier_encrypted jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS email_accounts(id uuid PRIMARY KEY,encrypted_password text NOT NULL)`);
});
beforeEach(async () => { if (client) await client.query("TRUNCATE mail_accounts, mail_account_oauth_states, email_accounts"); });
after(async () => { if (client) await client.end(); });

run("dry-run is PostgreSQL read-only and leaves every original byte unchanged", async () => {
  await insert(legacy(JSON.stringify({ password: "fixture-private" }))); await insert(null); await insert(cipher.encryptJson({ password: "active" }));
  const before = await rows(), statements = [];
  const db = { query: (...args) => { statements.push(args[0]); return client.query(...args); } };
  const result = await rotateMailSecrets({ client: db, cipher });
  assert.equal(result.completed, true); assert.equal(result.totals.found, 3); assert.equal(result.totals.eligible, 1); assert.equal(result.totals.migrated, 0); assert.equal(result.totals.ignored, 2);
  assert.deepEqual(await rows(), before);
  assert.equal(statements.some(sql => /^(?:UPDATE|INSERT|DELETE|CREATE|ALTER|TRUNCATE)|pg_advisory/i.test(sql)), false);
});
run("dry-run counts invalid ciphertext, unknown keys and invalid legacy formats", async () => {
  await insert(legacy(JSON.stringify({ password: "valid" }))); await insert({ v: 2, alg: "aes-256-gcm", kid: "missing" });
  await client.query("INSERT INTO mail_accounts VALUES($1,'null'::jsonb)", [crypto.randomUUID()]);
  await client.query("INSERT INTO email_accounts VALUES($1,$2)", [crypto.randomUUID(), "unsupported-old-format"]);
  const result = await rotateMailSecrets({ client, cipher });
  assert.equal(result.completed, false); assert.equal(result.totals.found, 4); assert.equal(result.totals.errors, 3); assert.equal(result.totals.migrated, 0);
});
run("all protected sources migrate and remain readable with only the new key", async () => {
  await insert(legacy(JSON.stringify({ password: "account", smtp_password: "smtp" })));
  await client.query("INSERT INTO mail_account_oauth_states VALUES($1,$2)", [crypto.randomUUID(), legacy(JSON.stringify({ codeVerifier: "pkce-fixture" }))]);
  await client.query("INSERT INTO email_accounts VALUES($1,$2)", [crypto.randomUUID(), JSON.stringify(legacy("legacy-text-password"))]);
  const result = await rotateMailSecrets({ client, cipher, mode: "apply", batchSize: 1 });
  assert.equal(result.completed, true); assert.equal(result.totals.migrated, 3); assert.equal(result.final_verification.completed, true);
  assert.equal(activeOnly.decryptJson((await rows())[0].encrypted_credentials).smtp_password, "smtp");
  assert.equal((await rotateMailSecrets({ client, cipher: activeOnly, mode: "verify-active-only" })).completed, true);
  const again = await rotateMailSecrets({ client, cipher, mode: "apply" });
  assert.equal(again.totals.migrated, 0); assert.equal(again.totals.ignored, 3);
});
run("apply runs its own complete preflight and writes nothing if any source fails", async () => {
  await insert(legacy(JSON.stringify({ password: "keep" })));
  await client.query("INSERT INTO email_accounts VALUES($1,$2)", [crypto.randomUUID(), "unknown"]);
  const before = await rows(), result = await rotateMailSecrets({ client, cipher, mode: "apply" });
  assert.equal(result.preflight_blocked, true); assert.deepEqual(await rows(), before);
});
run("interruption within a batch rolls back updates and retains the original", async () => {
  await insert(legacy(JSON.stringify({ password: "keep" }))); const before = await rows(), stop = new AbortController();
  const db = { async query(...args) { const result = await client.query(...args); if (args[0].startsWith("UPDATE public.mail_accounts")) stop.abort(); return result; } };
  const result = await rotateMailSecrets({ client: db, cipher, mode: "apply", signal: stop.signal });
  assert.equal(result.interrupted, true); assert.equal(result.totals.migrated, 0); assert.deepEqual(await rows(), before);
});
run("restart preserves committed batches and resumes by skipping verified active rows", async () => {
  for (let i = 0; i < 3; i++) await insert(legacy(JSON.stringify({ password: "fixture-" + i })));
  const stop = new AbortController();
  const first = await rotateMailSecrets({ client, cipher, mode: "apply", batchSize: 1, signal: stop.signal, onBatch(event) { if (event.mode === "apply" && event.migrated === 1) stop.abort(); } });
  assert.equal(first.interrupted, true); assert.equal(first.totals.migrated, 1);
  const resumed = await rotateMailSecrets({ client, cipher, mode: "apply", batchSize: 1 });
  assert.equal(resumed.completed, true); assert.equal(resumed.totals.migrated, 2);
});
run("readback detects an AFTER trigger corrupting ciphertext and rolls back", async () => {
  await insert(legacy(JSON.stringify({ password: "must-survive" }))); const before = await rows();
  await client.query(`CREATE FUNCTION rc2_corrupt_cipher() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF pg_trigger_depth()=1 THEN UPDATE mail_accounts SET encrypted_credentials=jsonb_set(NEW.encrypted_credentials,'{kid}','"unknown"'::jsonb) WHERE id=NEW.id; END IF; RETURN NEW; END $$;
    CREATE TRIGGER rc2_corrupt AFTER UPDATE ON mail_accounts FOR EACH ROW EXECUTE FUNCTION rc2_corrupt_cipher()`);
  try {
    const result = await rotateMailSecrets({ client, cipher, mode: "apply" });
    assert.equal(result.completed, false); assert.equal(result.totals.migrated, 0); assert.deepEqual(await rows(), before);
  } finally { await client.query("DROP TRIGGER rc2_corrupt ON mail_accounts; DROP FUNCTION rc2_corrupt_cipher()"); }
});
run("rotation does not overwrite credentials changed after preflight", async () => {
  await insert(legacy(JSON.stringify({ password: "old" }))); let replaced = false;
  const db = { async query(...args) {
    if (args[0] === "BEGIN" && !replaced) { replaced = true; await client.query("UPDATE mail_accounts SET encrypted_credentials=$1", [cipher.encryptJson({ password: "new-concurrent-credential" })]); }
    return client.query(...args);
  } };
  const result = await rotateMailSecrets({ client: db, cipher, mode: "apply" });
  assert.equal(result.completed, true); assert.equal(result.totals.migrated, 0);
  assert.equal(cipher.decryptJson((await rows())[0].encrypted_credentials).password, "new-concurrent-credential");
});
run("concurrent rotation and locked records fail safely", async () => {
  await insert(legacy(JSON.stringify({ password: "locked" }))); const before = await rows();
  const other = new pg.Client({ connectionString: url }); await other.connect();
  try {
    await other.query("SELECT pg_advisory_lock(210221,1)");
    await assert.rejects(rotateMailSecrets({ client, cipher, mode: "apply" }), { code: "MAIL_ROTATION_ALREADY_RUNNING" });
    await other.query("SELECT pg_advisory_unlock(210221,1)");
    await other.query("BEGIN"); await other.query("SELECT id FROM mail_accounts FOR UPDATE");
    const result = await rotateMailSecrets({ client, cipher, mode: "apply" });
    assert.equal(result.completed, false); assert.equal(result.totals.migrated, 0);
    await other.query("ROLLBACK"); assert.deepEqual(await rows(), before);
  } finally { await other.end(); }
});
run("damaged active data prevents key retirement", async () => {
  const value = cipher.encryptJson({ password: "bad-active" }); value.tag = Buffer.alloc(16).toString("base64"); await insert(value);
  const result = await rotateMailSecrets({ client, cipher: activeOnly, mode: "verify-active-only" });
  assert.equal(result.completed, false); assert.equal(result.totals.errors, 1);
});
run("real CLI dry-run, apply and active-only verification produce secret-free receipts", async () => {
  const fixtureSecret = "FICTIONAL_PRIVATE_CREDENTIAL_DO_NOT_LOG";
  const ciphertext = legacy(JSON.stringify({ password: fixtureSecret })); await insert(ciphertext);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc2-mail-rotation-")), receipt = path.join(dir, "dry-run.json");
  const invoke = args => new Promise(resolve => {
    const child = spawn(process.execPath, ["backend/scripts/rotate-mail-encryption-key.mjs", ...args, "--confirm-database", "rc2_mail_rotation", "--confirm-active-key", "active"], {
      cwd: path.resolve(import.meta.dirname, "../.."), env: { ...process.env, ...env, MAIL_ENCRYPTION_KEY: "", MAIL_ROTATION_DATABASE_URL: url, DATABASE_URL: "postgres://wrong@production.invalid/forbidden" }, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = ""; child.stdout.on("data", b => { output += b; }); child.stderr.on("data", b => { output += b; }); child.on("close", code => resolve({ code, output }));
  });
  for (const args of [["--dry-run", "--report", receipt], ["--apply", "--dry-run-report", receipt], ["--verify-active-only"]]) {
    const result = await invoke(args); assert.equal(result.code, 0, result.output);
    for (const forbidden of [fixtureSecret, oldKey.toString("hex"), newKey.toString("hex"), ciphertext.data, ciphertext.tag]) assert.equal(result.output.includes(forbidden), false);
  }
  const failed = await invoke(["--apply", "--dry-run-report", path.join(dir, "missing.json")]);
  assert.equal(failed.code, 1); assert.equal(failed.output.includes("production.invalid"), false);
});
