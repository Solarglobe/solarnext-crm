/**
 * Usage: node scripts/query-leads-by-display-name.mjs "Quote Cp077"
 * Affiche id, created_at, address, organization_id (+ colonnes nom pour audit).
 */
import "../config/register-local-env.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { applyResolvedDatabaseUrl } from "../config/database-url.js";
applyResolvedDatabaseUrl();

const { pool } = await import("../config/db.js");

const displayName = (process.argv[2] || "").trim();
if (!displayName) {
  console.error("Usage: node scripts/query-leads-by-display-name.mjs \"Nom affiché\"");
  process.exit(1);
}

const n = displayName.toLowerCase();
const r = await pool.query(
  `SELECT id, created_at, address, organization_id,
          full_name, company_name, first_name, last_name
   FROM leads
   WHERE (
     lower(trim(coalesce(full_name, ''))) = $1
     OR lower(trim(coalesce(company_name, ''))) = $1
     OR lower(trim(trim(coalesce(first_name, '')) || ' ' || trim(coalesce(last_name, '')))) = $1
   )
   ORDER BY created_at`,
  [n]
);

console.log(JSON.stringify(r.rows, null, 2));
console.log("count:", r.rowCount);
await pool.end();
