import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createMailCipher } from "../services/security/encryption.service.js";
import { parseRotationArgs, connectionOptions, validatePreflight } from "../scripts/rotate-mail-encryption-key.mjs";

const oldKey = Buffer.alloc(32, 17), newKey = Buffer.alloc(32, 34);
const ring = (extra = {}) => ({ MAIL_ENCRYPTION_KEYS: JSON.stringify({ retired: oldKey.toString("hex"), current: newKey.toString("base64") }), MAIL_ENCRYPTION_ACTIVE_KEY_ID: "current", MAIL_ENCRYPTION_LEGACY_KEY_ID: "retired", ...extra });
function legacy(text) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", oldKey, iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return { v: 1, alg: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}
const codesOnly = error => /^MAIL_[A-Z_]+$/.test(error.message) && error.code === error.message;

test("editing an account with unreadable credentials never replaces stored secrets", async t => {
  const saved = Object.fromEntries(["DATABASE_URL", "MAIL_ENCRYPTION_KEYS", "MAIL_ENCRYPTION_ACTIVE_KEY_ID", "MAIL_ENCRYPTION_LEGACY_KEY_ID", "MAIL_ENCRYPTION_KEY"].map(k => [k, process.env[k]]));
  Object.assign(process.env, ring(), { DATABASE_URL: "postgres://fixture@127.0.0.1:1/unused" });
  delete process.env.MAIL_ENCRYPTION_KEY;
  try {
    const { pool } = await import("../config/db.js");
    const { updateMailAccount } = await import("../services/mail/imap.service.js");
    const unreadable = createMailCipher(ring()).encryptJson({ password: "fictional-password" });
    unreadable.tag = Buffer.alloc(16).toString("base64");
    const calls = [];
    t.mock.method(pool, "query", async sql => {
      calls.push(String(sql));
      assert.match(String(sql), /^SELECT/);
      return { rows: [{ encrypted_credentials: unreadable }] };
    });
    await assert.rejects(updateMailAccount({ organizationId: "fixture-org", mailAccountId: "fixture-account", display_name: "edited" }), { code: "MAIL_CIPHERTEXT_AUTH_FAILED" });
    assert.equal(calls.length, 1);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("new envelopes use the active key ID and preserve UTF-8 JSON", () => {
  const cipher = createMailCipher(ring()), clear = { smtp_password: "fictif-é漢🙂", oauth_refresh_token: "fixture-only" };
  const result = cipher.encryptJson(clear);
  assert.equal(result.v, 2); assert.equal(result.kid, "current");
  assert.deepEqual(cipher.decryptJson(result), clear);
});
test("independent encryption uses different random IVs", () => {
  const c = createMailCipher(ring()), a = c.encrypt("same"), b = c.encrypt("same");
  assert.notEqual(a.iv, b.iv); assert.notEqual(a.data, b.data);
});
test("legacy v1 decrypts through its explicit legacy key", () => {
  assert.equal(createMailCipher(ring()).decrypt(legacy("old-fixture")), "old-fixture");
});
test("legacy single-key config still works, but writes identified v2 envelopes", () => {
  const c = createMailCipher({ MAIL_ENCRYPTION_KEY: oldKey.toString("hex") });
  assert.equal(c.decrypt(legacy("old")), "old");
  assert.equal(c.encrypt("new").kid, "legacy"); assert.equal(c.rotationReady, false);
});
test("previous unpadded and base64url key encodings remain readable", () => {
  const bytes = Buffer.alloc(32, 251);
  for (const key of [bytes.toString("base64"), bytes.toString("base64").replace(/=+$/, ""), bytes.toString("base64url")]) {
    const c = createMailCipher({ MAIL_ENCRYPTION_KEY: key });
    assert.equal(c.decrypt(c.encrypt("legacy-encoding-fixture")), "legacy-encoding-fixture");
  }
});
test("old and active v2 envelopes coexist while only the active key writes", () => {
  const a = createMailCipher(ring({ MAIL_ENCRYPTION_ACTIVE_KEY_ID: "retired" }));
  const b = createMailCipher(ring());
  assert.equal(b.decrypt(a.encrypt("first")), "first");
  assert.equal(b.encrypt("second").kid, "current");
});
test("new key alone reads migrated data after old key removal", () => {
  const both = createMailCipher(ring()), migrated = both.encrypt(both.decrypt(legacy("persisted")));
  const onlyNew = createMailCipher({ MAIL_ENCRYPTION_KEYS: JSON.stringify({ current: newKey.toString("hex") }), MAIL_ENCRYPTION_ACTIVE_KEY_ID: "current" });
  assert.equal(onlyNew.decrypt(migrated), "persisted");
  assert.throws(() => onlyNew.decrypt(legacy("old")), codesOnly);
});
test("active-only verification refuses all legacy references", () => {
  const c = createMailCipher(ring());
  assert.throws(() => c.decrypt(legacy("old"), { activeOnly: true }), codesOnly);
  const oldV2 = createMailCipher(ring({ MAIL_ENCRYPTION_ACTIVE_KEY_ID: "retired" })).encrypt("old");
  assert.throws(() => c.decrypt(oldV2, { activeOnly: true }), codesOnly);
  assert.equal(c.decrypt(c.encrypt("new"), { activeOnly: true }), "new");
});
test("changing an authenticated key ID fails without trying other keys", () => {
  const c = createMailCipher(ring()), value = c.encrypt("private-fixture");
  assert.throws(() => c.decrypt({ ...value, kid: "retired" }), codesOnly);
  assert.throws(() => c.decrypt({ ...value, kid: "unknown" }), codesOnly);
});
test("downgrading v2 to legacy cannot bypass authenticated metadata", () => {
  const c = createMailCipher(ring({ MAIL_ENCRYPTION_ACTIVE_KEY_ID: "retired" })), value = c.encrypt("value");
  delete value.kid; value.v = 1;
  assert.throws(() => c.decrypt(value), codesOnly);
});
test("authentication detects changed ciphertext, IV and tag", () => {
  const c = createMailCipher(ring()), value = c.encrypt("do-not-print-this");
  for (const field of ["iv", "tag", "data"]) {
    const bytes = Buffer.from(value[field], "base64"); bytes[0] ^= 1;
    assert.throws(() => c.decrypt({ ...value, [field]: bytes.toString("base64") }), codesOnly);
  }
});
test("malformed envelopes and noncanonical base64 fail closed", () => {
  const c = createMailCipher(ring()), value = c.encrypt("example");
  for (const invalid of [null, "invalid", [], { ...value, v: 3 }, { ...value, alg: "aes-128-gcm" }, { ...value, kid: "../key" }, { ...value, iv: "AA==" }, { ...value, tag: value.tag + "!" }, { ...value, data: "%%%" }]) assert.throws(() => c.decrypt(invalid), codesOnly);
});
test("empty plaintext is authenticated; malformed JSON never leaks its text", () => {
  const c = createMailCipher(ring()); assert.equal(c.decrypt(c.encrypt("")), "");
  assert.throws(() => c.decryptJson(c.encrypt("sensitive-invalid-json-fixture")), codesOnly);
});
test("missing, invalid, duplicate and ambiguous key configurations are refused", () => {
  for (const env of [{}, { MAIL_ENCRYPTION_KEY: "invalid" }, ring({ MAIL_ENCRYPTION_ACTIVE_KEY_ID: "absent" }), ring({ MAIL_ENCRYPTION_LEGACY_KEY_ID: "absent" }), ring({ MAIL_ENCRYPTION_KEYS: "not-json" }), ring({ MAIL_ENCRYPTION_KEYS: JSON.stringify({ current: oldKey.toString("hex"), retired: oldKey.toString("hex") }) }), ring({ MAIL_ENCRYPTION_KEY: newKey.toString("hex") }), ring({ MAIL_ENCRYPTION_KEYS: '{"current":"a","current":"b"}' })]) assert.throws(() => createMailCipher(env), codesOnly);
});
test("keyring snapshots cannot change midway through a rotation", () => {
  const env = ring(), c = createMailCipher(env); env.MAIL_ENCRYPTION_KEYS = "changed";
  assert.equal(c.decrypt(c.encrypt("value")), "value");
});
test("CLI defaults to dry-run and requires explicit target confirmation", () => {
  assert.equal(parseRotationArgs(["--confirm-database", "fixture", "--confirm-active-key", "current"]).mode, "dry-run");
  for (const args of [[], ["--apply"], ["--dry-run", "--apply"], ["--secret", "never-allowed"], ["--confirm-database", "fixture", "--confirm-active-key", "current", "--batch-size", "0"]]) assert.throws(() => parseRotationArgs(args), codesOnly);
});
test("apply requires a prior successful dry-run report", () => {
  assert.throws(() => parseRotationArgs(["--apply", "--confirm-database", "fixture", "--confirm-active-key", "current"]), codesOnly);
  assert.equal(parseRotationArgs(["--apply", "--confirm-database", "fixture", "--confirm-active-key", "current", "--dry-run-report", "receipt.json"]).mode, "apply");
});
test("rotation DB configuration never inherits production application variables", () => {
  const env = { MAIL_ROTATION_DATABASE_URL: "postgres://fixture@127.0.0.1:55437/fixture", DATABASE_URL: "postgres://wrong@prod.invalid/prod", PGHOST: "prod.invalid", PGOPTIONS: "unsafe" };
  const config = connectionOptions(env, "dry-run");
  assert.equal(config.host, "127.0.0.1"); assert.equal(config.port, 55437); assert.match(config.options, /read_only=on/);
  assert.throws(() => connectionOptions({ DATABASE_URL: env.DATABASE_URL }, "dry-run"), codesOnly);
  assert.throws(() => connectionOptions({ MAIL_ROTATION_DATABASE_URL: env.MAIL_ROTATION_DATABASE_URL + "?options=unsafe" }, "dry-run"), codesOnly);
});
test("preflight receipts are bound to the target, key ID and one-hour window", () => {
  const now = Date.now(), target = { database: "fixture" }, report = { version: 1, at: new Date(now).toISOString(), mode: "dry-run", target, active_key_id: "current", result: { completed: true, totals: { errors: 0 } } };
  validatePreflight(report, target, "current", now);
  for (const bad of [{ ...report, mode: "apply" }, { ...report, active_key_id: "old" }, { ...report, target: { database: "other" } }, { ...report, at: new Date(now - 3600001).toISOString() }, { ...report, result: { completed: false, totals: { errors: 1 } } }]) assert.throws(() => validatePreflight(bad, target, "current", now), codesOnly);
});
