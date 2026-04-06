/**
 * IGN Dynamic Tile Loader — Locks distribués Postgres (advisory locks).
 * Hash stable lockName → bigint pour pg_try_advisory_lock / pg_advisory_unlock.
 */

import crypto from "crypto";

const POLL_MS = 250;

function getSalt() {
  return process.env.IGN_PG_LOCK_KEY_SALT ?? "solarnext-ign";
}

/**
 * Hash lockName → bigint 64-bit (stable, même entre process).
 * @param {string} lockName
 * @returns {bigint}
 */
function lockNameToBigInt(lockName) {
  const salt = getSalt();
  const hash = crypto.createHash("sha1").update(salt + lockName).digest();
  const buf = hash.subarray(0, 8);
  return buf.readBigInt64BE(0);
}

/** Bigint → deux int32 pour pg_try_advisory_lock(key1, key2) (compat node-pg). */
function bigintToKeyPair(key) {
  const k = BigInt.asUintN(64, key);
  const key1 = Number((k >> 32n) & 0xffffffffn);
  const key2 = Number(k & 0xffffffffn);
  return [key1, key2];
}

/**
 * Acquiert un advisory lock Postgres (session-level).
 * Boucle pg_try_advisory_lock jusqu'à timeoutMs (poll 250ms).
 * @param {string} lockName - identifiant stable (ex: ign:DTEST)
 * @param {number} timeoutMs - 0 = un seul essai
 * @returns {Promise<{ release: () => Promise<void> } | null>} handle avec release(), ou null si timeout
 */
export async function acquirePgAdvisoryLock(lockName, timeoutMs = 0) {
  const { pool } = await import("../../config/db.js");
  const key = lockNameToBigInt(lockName);
  const [key1, key2] = bigintToKeyPair(key);
  const client = await pool.connect();
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const row = await client.query("SELECT pg_try_advisory_lock($1::int, $2::int) AS ok", [key1, key2]);
    if (row.rows[0]?.ok === true) {
      return {
        release: async () => {
          try {
            await client.query("SELECT pg_advisory_unlock($1::int, $2::int)", [key1, key2]);
          } finally {
            client.release();
          }
        },
      };
    }
    if (timeoutMs === 0 || Date.now() >= deadline) {
      client.release();
      return null;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/**
 * Libère un advisory lock (à appeler via le handle retourné par acquirePgAdvisoryLock).
 * @param {{ release: () => Promise<void> }} handle
 */
export async function releasePgAdvisoryLock(handle) {
  if (handle && typeof handle.release === "function") await handle.release();
}
