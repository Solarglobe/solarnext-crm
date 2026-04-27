/**
 * Backfill lecture seule puis option --apply : quotes ACCEPTED avec client_id NULL
 * alors que leads.client_id est renseigné (même organization_id).
 *
 * Usage :
 *   node scripts/backfill-quote-client-from-lead.mjs
 *   node scripts/backfill-quote-client-from-lead.mjs --apply
 *
 * Aucun DELETE. Avec --apply uniquement : UPDATE quotes SET client_id = lead.client_id …
 */

import pg from "pg";

const APPLY = process.argv.includes("--apply");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL requis (ex. proxy Railway ou base locale).");
    process.exit(1);
  }
  const client = new pg.Client({
    connectionString,
    ssl: process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  const sel = `
SELECT q.id AS quote_id, q.quote_number, q.organization_id::text AS org_id,
       q.lead_id::text AS lead_id, l.client_id::text AS lead_client_id
FROM quotes q
INNER JOIN leads l ON l.id = q.lead_id AND l.organization_id = q.organization_id AND (l.archived_at IS NULL)
WHERE q.archived_at IS NULL
  AND UPPER(COALESCE(q.status, '')) = 'ACCEPTED'
  AND q.client_id IS NULL
  AND l.client_id IS NOT NULL
ORDER BY q.organization_id, q.quote_number
`.trim();

  const rows = (await client.query(sel)).rows;
  console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", count: rows.length, rows }, null, 2));

  if (!APPLY || rows.length === 0) {
    await client.end();
    return;
  }

  await client.query("BEGIN");
  try {
    for (const r of rows) {
      const ok = await client.query(
        `UPDATE quotes q
         SET client_id = l.client_id, updated_at = now()
         FROM leads l
         WHERE q.id = $1
           AND q.organization_id = $2::uuid
           AND l.id = q.lead_id
           AND l.organization_id = q.organization_id
           AND q.client_id IS NULL
           AND l.client_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM clients c
             WHERE c.id = l.client_id AND c.organization_id = q.organization_id AND (c.archived_at IS NULL)
           )`,
        [r.quote_id, r.org_id]
      );
      if (ok.rowCount !== 1) {
        throw new Error(`UPDATE inattendu quote_id=${r.quote_id} rowCount=${ok.rowCount}`);
      }
    }
    await client.query("COMMIT");
    console.log("COMMIT OK");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("ROLLBACK", e);
    process.exit(1);
  }
  await client.end();
}

await main();
