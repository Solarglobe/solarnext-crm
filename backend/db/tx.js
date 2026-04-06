/**
 * CP-032C — Helper Transaction Standard
 * withTx(pool, fn) : BEGIN → fn(client) → COMMIT | ROLLBACK on error
 */

export async function withTx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
