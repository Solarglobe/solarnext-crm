/**
 * Inventaire multi-org : comptages par organisation + classification (PROD / TEST_*).
 * Sortie console + JSON dans backend/reports/
 *
 * Usage : node scripts/org-audit-report.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "../config/load-env.js";
import pg from "pg";
import { applyResolvedDatabaseUrl } from "../config/database-url.js";

applyResolvedDatabaseUrl();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = path.join(__dirname, "..", "reports");

const METIER_TABLES = [
  { key: "users", table: "users" },
  { key: "leads", table: "leads" },
  { key: "clients", table: "clients" },
  { key: "studies", table: "studies" },
  { key: "quotes", table: "quotes" },
  { key: "entity_documents", table: "entity_documents" },
  { key: "invoices", table: "invoices" },
  { key: "calpinage_snapshots", table: "calpinage_snapshots" },
  { key: "lead_meters", table: "lead_meters" },
  { key: "lead_dp", table: "lead_dp" },
  { key: "client_portal_tokens", table: "client_portal_tokens" },
];

function scoreMetier(counts) {
  return (
    (counts.leads || 0) +
    (counts.clients || 0) +
    (counts.studies || 0) +
    (counts.quotes || 0) +
    (counts.entity_documents || 0) +
    (counts.invoices || 0) +
    (counts.calpinage_snapshots || 0) +
    (counts.lead_meters || 0) +
    (counts.lead_dp || 0) +
    (counts.client_portal_tokens || 0)
  );
}

function classifyOrg(row, prodId, maxScore) {
  const name = String(row.name || "");
  const oid = row.organization_id;
  const suspect =
    /test|cp-\d|org\d|cross/i.test(name) || /^Test\b/i.test(name.trim());
  const s = Number(row.metier_score) || 0;
  const hasClientOrQuotes = (row.clients || 0) > 0 || (row.quotes || 0) > 0;

  if (prodId && oid === prodId) return "PROD_ORG";
  if (s === 0) return "TEST_ORG_EMPTY";
  if (hasClientOrQuotes && oid !== prodId) return "TEST_ORG_WITH_DATA";
  if (s > 0 && s <= 8 && suspect) return "TEST_ORG_LIGHT";
  if (s > 0 && s < maxScore && suspect) return "TEST_ORG_LIGHT";
  if (oid !== prodId && s > 0) return "TEST_ORG_WITH_DATA";
  return "OTHER_ORG";
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL manquant");
    process.exit(2);
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  const orgsRes = await pool.query(
    `SELECT id, name, created_at FROM organizations ORDER BY created_at ASC`
  );
  const orgs = [];

  for (const o of orgsRes.rows) {
    const counts = { organization_id: o.id, name: o.name, created_at: o.created_at };
    for (const { key, table } of METIER_TABLES) {
      try {
        const r = await pool.query(
          `SELECT count(*)::int AS n FROM "${table}" WHERE organization_id = $1`,
          [o.id]
        );
        counts[key] = r.rows[0].n;
      } catch {
        counts[key] = null;
      }
    }
    counts.metier_score = scoreMetier(counts);
    orgs.push(counts);
  }

  let prodId = null;
  let maxScore = -1;
  for (const o of orgs) {
    const s = Number(o.metier_score) || 0;
    if (s > maxScore) {
      maxScore = s;
      prodId = o.organization_id;
    }
  }
  const solarGlobe = orgs.find((o) => /solarglobe/i.test(String(o.name || "")));
  if (solarGlobe && (Number(solarGlobe.metier_score) || 0) === maxScore) {
    prodId = solarGlobe.organization_id;
  }

  for (const o of orgs) {
    o.classification = classifyOrg(o, prodId, maxScore);
    o.is_prod_candidate = o.organization_id === prodId;
  }

  const report = {
    generated_at: new Date().toISOString(),
    prod_organization_id: prodId ?? null,
    max_metier_score: maxScore,
    organizations: orgs,
  };

  await fs.promises.mkdir(REPORT_DIR, { recursive: true });
  const outPath = path.join(REPORT_DIR, "org-audit-report-latest.json");
  await fs.promises.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log("=== ORG AUDIT REPORT ===\n");
  console.log("PROD (max métier ou nom SolarGlobe) :", prodId);
  console.log("Score métier max :", maxScore);
  console.log("JSON :", outPath);
  console.log("\n--- Résumé ---\n");
  console.table(
    orgs.map((o) => ({
      name: o.name?.slice(0, 28),
      class: o.classification,
      metier: o.metier_score,
      users: o.users,
      leads: o.leads,
      clients: o.clients,
      studies: o.studies,
      quotes: o.quotes,
      docs: o.entity_documents,
    }))
  );

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
