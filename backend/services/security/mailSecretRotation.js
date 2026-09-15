import { timingSafeEqual } from "node:crypto";
import { mailCryptoError } from "./mailKeyring.js";

// Fixed allowlist: no table, column or SQL supplied by an operator is executed.
export const MAIL_SECRET_SOURCES = Object.freeze([
  Object.freeze({ table: "mail_accounts", column: "encrypted_credentials", type: "jsonb" }),
  Object.freeze({ table: "mail_account_oauth_states", column: "code_verifier_encrypted", type: "jsonb" }),
  Object.freeze({ table: "email_accounts", column: "encrypted_password", type: "text" }),
]);
const counts = () => ({ found: 0, eligible: 0, migrated: 0, ignored: 0, verified: 0, errors: 0 });
const equal = (a, b) => {
  const left = Buffer.from(a, "utf8"), right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
};
function envelope(value, source) {
  let payload = value;
  if (source.type === "text") {
    try { payload = JSON.parse(value); } catch { throw mailCryptoError("MAIL_ROTATION_LEGACY_FORMAT_UNKNOWN"); }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some(k => !["v", "alg", "kid", "iv", "tag", "data"].includes(k))) {
    throw mailCryptoError("MAIL_ROTATION_FORMAT_UNKNOWN");
  }
  return payload;
}
function validateJson(text, source) {
  if (source.type === "text") return;
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
  } catch { throw mailCryptoError("MAIL_ROTATION_JSON_INVALID"); }
}

/** No app/bootstrap/worker imports. The caller supplies a dedicated connection.
 * Each apply batch commits only after authenticated readback from PostgreSQL.
 * Restart from the beginning: already-active values are reverified and skipped.
 * No ciphertext, plaintext, row ID or key fingerprint appears in the result.
 */
async function rotate({ client, cipher, mode = "dry-run", batchSize = 100, signal, onBatch = () => {} }) {
  if (!["dry-run", "apply", "verify-active-only"].includes(mode) || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw mailCryptoError("MAIL_ROTATION_OPTIONS_INVALID");
  if (!cipher.explicit || !cipher.rotationReady) throw mailCryptoError("MAIL_ROTATION_EXPLICIT_NEW_KEY_REQUIRED");
  const result = { mode, completed: false, interrupted: false, totals: counts(), sources: [], failure_code: null };
  // An apply always runs a fresh, read-only preflight, even when called outside CLI.
  if (mode === "apply") {
    const preflight = await rotate({ client, cipher, mode: "dry-run", batchSize, signal });
    if (!preflight.completed) return { ...preflight, mode, preflight_blocked: true };
  }
  const finish = () => {
    result.totals = counts();
    for (const entry of result.sources) for (const key of Object.keys(result.totals)) result.totals[key] += entry[key];
    result.completed = !result.interrupted && !result.failure_code && result.totals.errors === 0;
    return result;
  };
  for (const source of MAIL_SECRET_SOURCES) {
    const stats = { source: source.table + "." + source.column, ...counts() };
    result.sources.push(stats);
    let cursor = null;
    for (;;) {
      if (signal?.aborted) { result.interrupted = true; return finish(); }
      let inTransaction = false;
      try {
        await client.query(mode === "apply" ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        inTransaction = true;
        await client.query("SET LOCAL lock_timeout = '1s'");
        await client.query("SET LOCAL statement_timeout = '15s'");
        await client.query("SET LOCAL idle_in_transaction_session_timeout = '20s'");
        if (mode !== "apply") {
          const state = await client.query("SHOW transaction_read_only");
          if (state.rows[0]?.transaction_read_only !== "on") throw mailCryptoError("MAIL_ROTATION_READ_ONLY_REQUIRED");
        }
        const rows = await client.query(
          `SELECT id, ${source.column} AS value, ${source.column} IS NULL AS is_null FROM public.${source.table}
           WHERE ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT $2${mode === "apply" ? " FOR UPDATE" : ""}`,
          [cursor, batchSize],
        );
        if (!rows.rows.length) { await client.query("ROLLBACK"); inTransaction = false; break; }
        let batchMigrated = 0;
        for (const row of rows.rows) {
          if (signal?.aborted) throw mailCryptoError("MAIL_ROTATION_INTERRUPTED");
          stats.found++;
          if (row.is_null) { stats.ignored++; continue; }
          try {
            const previous = envelope(row.value, source);
            const clear = cipher.decrypt(previous, { activeOnly: mode === "verify-active-only" });
            validateJson(clear, source);
            if (previous.v === 2 && previous.kid === cipher.activeId) { stats.ignored++; stats.verified++; continue; }
            stats.eligible++;
            const replacement = cipher.encrypt(clear);
            if (!equal(clear, cipher.decrypt(replacement, { activeOnly: true }))) throw mailCryptoError("MAIL_ROTATION_VERIFICATION_FAILED");
            if (mode === "apply") {
              const next = JSON.stringify(replacement), before = source.type === "text" ? row.value : JSON.stringify(row.value);
              const changed = await client.query(
                `UPDATE public.${source.table} SET ${source.column} = $2::${source.type}
                 WHERE id = $1 AND ${source.column} = $3::${source.type} RETURNING ${source.column} AS value`,
                [row.id, next, before],
              );
              if (changed.rowCount !== 1) throw mailCryptoError("MAIL_ROTATION_CONCURRENT_CHANGE");
              // Read again: includes modifications made by AFTER triggers.
              const stored = await client.query(`SELECT ${source.column} AS value FROM public.${source.table} WHERE id = $1`, [row.id]);
              if (stored.rowCount !== 1 || !equal(clear, cipher.decrypt(envelope(stored.rows[0].value, source), { activeOnly: true }))) throw mailCryptoError("MAIL_ROTATION_VERIFICATION_FAILED");
              batchMigrated++;
            }
            stats.verified++;
          } catch (error) {
            stats.errors++;
            if (mode === "apply") throw error;
            // Continue the dry run to count all errors; never expose error text.
          }
        }
        if (signal?.aborted) throw mailCryptoError("MAIL_ROTATION_INTERRUPTED");
        await client.query(mode === "apply" ? "COMMIT" : "ROLLBACK");
        inTransaction = false;
        stats.migrated += batchMigrated;
        cursor = rows.rows.at(-1).id;
        onBatch({ mode, source: stats.source, migrated: stats.migrated });
      } catch (error) {
        if (inTransaction) { try { await client.query("ROLLBACK"); } catch { /* Connection loss also rolls back server-side. */ } }
        if (error?.code === "MAIL_ROTATION_INTERRUPTED") result.interrupted = true;
        else {
          result.failure_code = "MAIL_ROTATION_BATCH_FAILED";
          if (!stats.errors) stats.errors++;
        }
        return finish();
      }
    }
  }
  return finish();
}

export async function rotateMailSecrets(options) {
  if (options.mode !== "apply") return rotate(options);
  const lock = await options.client.query("SELECT pg_try_advisory_lock(210221, 1) AS acquired");
  if (!lock.rows[0]?.acquired) throw mailCryptoError("MAIL_ROTATION_ALREADY_RUNNING");
  try {
    const result = await rotate(options);
    if (result.completed) {
      result.final_verification = await rotate({ ...options, mode: "verify-active-only" });
      result.completed = result.final_verification.completed;
      if (!result.completed) result.failure_code = "MAIL_ROTATION_FINAL_VERIFICATION_FAILED";
    }
    return result;
  } finally {
    await options.client.query("SELECT pg_advisory_unlock(210221, 1)");
  }
}
