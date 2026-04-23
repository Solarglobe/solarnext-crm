/**
 * Audit rapide catalogue sur la DB (sans charger .env — évite d'écraser l'URL passée).
 * Usage : node scripts/audit-catalog-online-once.mjs "postgresql://..."
 */
import pg from "pg";

const raw = process.argv[2] || process.env.RAILWAY_PROBE_DATABASE_URL || process.env.DATABASE_URL;
if (!raw) {
  console.error("DATABASE_URL ou argv[1] requis");
  process.exit(1);
}
const url = String(raw).trim().replace(/[?&]sslmode=[^&]*/gi, "").replace(/[?&]ssl=[^&]*/gi, "").replace(/[?&]$/g, "");
const ssl = /proxy\.rlwy\.net|rlwy\.net/i.test(url);
const pool = new pg.Pool({ connectionString: url, ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}) });

async function safeCount(sql) {
  try {
    const r = await pool.query(sql);
    return r.rows[0]?.n ?? r.rows[0];
  } catch (e) {
    return { error: e.code || e.message };
  }
}

try {
  const host = (() => {
    try {
      return new URL(url.replace(/^postgresql:\/\//, "http://")).host;
    } catch {
      return "?";
    }
  })();
  console.log(JSON.stringify({ target_host: host }, null, 2));

  const orgs = await safeCount("SELECT count(*)::int AS n FROM organizations");
  const qci = await safeCount("SELECT count(*)::int AS n FROM quote_catalog_items");
  const qciByCat = await pool
    .query(
      `SELECT category::text AS category, count(*)::int AS n
       FROM quote_catalog_items GROUP BY category ORDER BY category`
    )
    .then((r) => r.rows)
    .catch((e) => [{ error: e.message }]);
  const pvi = await safeCount("SELECT count(*)::int AS n FROM pv_inverters");
  const pvPanels = await safeCount("SELECT count(*)::int AS n FROM pv_panels");

  const tabs = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND (table_name ILIKE '%catalog%' OR table_name ILIKE '%inverter%'
            OR table_name ILIKE '%module%' OR table_name ILIKE '%panel%' OR table_name ILIKE '%pv_%')
     ORDER BY 1`
  );

  console.log(
    JSON.stringify(
      {
        organizations: orgs,
        quote_catalog_items: qci,
        quote_catalog_items_by_category: qciByCat,
        pv_inverters: pvi,
        pv_panels: pvPanels,
        matching_tables: tabs.rows.map((r) => r.table_name),
      },
      null,
      2
    )
  );
} finally {
  await pool.end();
}
