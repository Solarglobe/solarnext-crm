/**
 * Audit multi-org en lecture seule — à lancer avec DATABASE_URL (proxy TCP public Railway).
 * Usage : $env:DATABASE_URL='postgresql://...'; node scripts/railway-org-audit-once.mjs
 */
import pg from "pg";

const url =
  process.env.DATABASE_URL ||
  process.env.AUDIT_DATABASE_URL ||
  "";
if (!url) {
  console.error("DATABASE_URL manquant");
  process.exit(1);
}

const useTlsInsecure =
  /rlwy\.net|proxy\.rlwy|railway\.app/i.test(url) || process.env.AUDIT_PG_SSL_INSECURE === "1";
const pool = new pg.Pool({
  connectionString: url.replace(/[?&]sslmode=[^&]*/g, ""),
  ssl: useTlsInsecure ? { rejectUnauthorized: false } : undefined,
});

async function q(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows;
}

try {
  console.log("=== 1) Organisations SolarGlobe (candidats) ===\n");
  const solar = await q(`
    SELECT id, name, trade_name, legal_name, created_at
    FROM organizations
    WHERE name ILIKE '%solar%globe%'
       OR COALESCE(trade_name, '') ILIKE '%solar%globe%'
       OR COALESCE(legal_name, '') ILIKE '%solar%globe%'
    ORDER BY created_at
  `);
  console.table(solar);

  console.log("\n=== 2) Toutes les organisations ===\n");
  const allOrgs = await q(`
    SELECT id, name, created_at
    FROM organizations
    ORDER BY name
  `);
  console.table(allOrgs);

  console.log("\n=== 3) Comptages par organization_id ===\n");
  const tables = [
    "leads",
    "clients",
    "quotes",
    "studies",
    "study_versions",
    "calpinage_data",
    "documents",
    "invoices",
    "payments",
    "addresses",
  ];
  /** @type {Record<string, { organization_id: string, n: string }[]>} */
  const byTable = {};
  for (const t of tables) {
    const rows = await q(
      `SELECT organization_id::text, COUNT(*)::text AS n FROM ${t} GROUP BY organization_id ORDER BY COUNT(*) DESC`
    );
    byTable[t] = rows;
  }

  const orgNames = Object.fromEntries(allOrgs.map((o) => [o.id, o.name]));

  for (const t of tables) {
    console.log(`--- ${t} ---`);
    const rows = byTable[t].map((r) => ({
      organization_id: r.organization_id,
      name: orgNames[r.organization_id] ?? "(inconnue)",
      n: r.n,
    }));
    console.table(rows);
  }

  const totalsByOrg = {};
  for (const o of allOrgs) {
    totalsByOrg[o.id] = { name: o.name, score: 0 };
  }
  for (const t of tables) {
    for (const r of byTable[t]) {
      const id = r.organization_id;
      if (!totalsByOrg[id]) totalsByOrg[id] = { name: orgNames[id] ?? "?", score: 0 };
      totalsByOrg[id].score += Number(r.n);
    }
  }
  console.log("\n=== Score brut (somme des lignes sur les 10 tables) ===\n");
  console.table(
    Object.entries(totalsByOrg)
      .map(([id, v]) => ({ organization_id: id, name: v.name, total_rows: v.score }))
      .sort((a, b) => b.total_rows - a.total_rows)
  );
} finally {
  await pool.end();
}
