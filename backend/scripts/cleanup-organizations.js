/**
 * Conserve « SolarGlobe » et les 2 organisations de test les plus récentes (nom ILIKE %test%),
 * archive toutes les autres.
 *
 * @example
 *   node scripts/cleanup-organizations.js
 *   (depuis backend/, avec DATABASE_URL ou .env)
 */
import "../config/register-local-env.js";
import "../config/script-env-tail.js";
import { pool } from "../config/db.js";
import { ORG_NAME_SOLAR_GLOBE } from "../services/admin/adminOrganizations.service.js";

async function main() {
  const client = await pool.connect();
  try {
    const all = await client.query(
      `SELECT id, name, is_archived, created_at
       FROM organizations
       ORDER BY created_at DESC NULLS LAST, name ASC`
    );

    const solar = all.rows.find((r) => String(r.name || "").trim() === ORG_NAME_SOLAR_GLOBE);
    const testLatest = await client.query(
      `SELECT id, name, created_at
       FROM organizations
       WHERE name ILIKE '%test%'
       ORDER BY created_at DESC NULLS LAST
       LIMIT 2`
    );
    const keep = new Set();
    if (solar) keep.add(solar.id);
    for (const t of testLatest.rows) {
      keep.add(t.id);
    }

    console.log(
      "[cleanup-organizations] conservation :",
      "SolarGlobe" + (solar ? `=${solar.id}` : " (aucune ligne exacte)"),
      "| orgs test (2 max) :",
      testLatest.rows.map((r) => `${r.name}=${r.id}`).join(", ") || "—"
    );

    for (const row of all.rows) {
      if (keep.has(row.id)) continue;
      if (row.is_archived) {
        console.log("[cleanup-organizations] skip déjà archivé", row.name, row.id);
        continue;
      }
      await client.query(
        `UPDATE organizations SET is_archived = true, archived_at = now() WHERE id = $1`,
        [row.id]
      );
      console.log("[cleanup-organizations] archivé", { id: row.id, name: row.name });
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
