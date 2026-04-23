#!/usr/bin/env node
/**
 * Vérification post-import : COUNT sur tables clés.
 * Usage :
 *   node scripts/verify-db-counts.mjs "postgresql://user:pass@host:port/db"
 * ou DATABASE_URL déjà défini (sans argument).
 */
import pg from "pg";

let url = process.argv[2] || process.env.DATABASE_URL;
if (!url || !String(url).trim()) {
  console.error("Usage: node scripts/verify-db-counts.mjs <DATABASE_URL>");
  process.exit(1);
}
url = String(url).trim();
const needsInsecureSsl =
  /\brailway\.app\b/i.test(url) ||
  /proxy\.rlwy\.net/i.test(url) ||
  String(process.env.PGSSLMODE || "").toLowerCase() === "require";
let connectionString = url;
if (needsInsecureSsl) {
  connectionString = url
    .replace(/([?&])sslmode=[^&]*/gi, "$1")
    .replace(/([?&])ssl=[^&]*/gi, "$1")
    .replace(/\?&/g, "?")
    .replace(/[?&]$/g, "");
}
const pool = new pg.Pool({
  connectionString,
  ...(needsInsecureSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});
const tables = ["leads", "quotes", "entity_documents", "clients"];

try {
  const out = {};
  for (const t of tables) {
    const r = await pool.query(`SELECT count(*)::text AS c FROM ${t}`);
    out[t] = r.rows[0].c;
  }
  const types = await pool.query(
    `SELECT document_type, count(*)::text AS c
     FROM entity_documents
     GROUP BY document_type
     ORDER BY document_type`
  );
  console.log(JSON.stringify({ counts: out, entity_documents_by_type: types.rows }, null, 2));
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
} finally {
  await pool.end();
}
