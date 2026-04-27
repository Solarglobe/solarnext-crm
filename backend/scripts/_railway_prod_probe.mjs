/**
 * Sonde DATABASE_URL (hôte) + première organization — pour railway run.
 * Fichier utilitaire ponctuel.
 */
import pg from "pg";

const u = process.env.DATABASE_URL || "";
if (!u) {
  console.error("DATABASE_URL absent");
  process.exit(1);
}
let host = "?";
try {
  host = new URL(u.replace(/^postgres/i, "http")).hostname;
} catch {
  /* ignore */
}
const railwayLike = /railway|rlwy\.net/i.test(u);
console.log("DATABASE_URL_host:", host);
console.log("railway_like:", railwayLike);

const pool = new pg.Pool({
  connectionString: u,
  ...(railwayLike ? { ssl: { rejectUnauthorized: false } } : {}),
});
const r = await pool.query(
  `SELECT id::text, name, created_at FROM organizations ORDER BY created_at ASC NULLS LAST LIMIT 3`
);
console.log("organizations_sample:", JSON.stringify(r.rows));
await pool.end();
