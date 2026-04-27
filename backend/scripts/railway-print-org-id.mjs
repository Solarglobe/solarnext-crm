#!/usr/bin/env node
/**
 * Affiche le premier organization_id (ORDER BY created_at) — utile avec `railway run`.
 * Ne logue pas DATABASE_URL.
 */
import pg from "pg";

const u = process.env.DATABASE_URL;
if (!u) {
  console.error("DATABASE_URL absent.");
  process.exit(1);
}
const needsInsecureSsl =
  /\brailway\.app\b/i.test(u) || /proxy\.rlwy\.net/i.test(u) || /railway\.internal/i.test(u) || String(process.env.PGSSLMODE || "").toLowerCase() === "require";
const pool = new pg.Pool({
  connectionString: u,
  ...(needsInsecureSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});
const r = await pool.query(
  `SELECT id::text, name FROM organizations ORDER BY created_at ASC NULLS LAST LIMIT 1`
);
if (!r.rows[0]) {
  console.error("Aucune organization.");
  process.exit(1);
}
console.log(r.rows[0].id);
await pool.end();
