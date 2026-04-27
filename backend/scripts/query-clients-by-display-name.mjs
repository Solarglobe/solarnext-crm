/**
 * Usage: node scripts/query-clients-by-display-name.mjs "Nom affiché"
 * Même logique de matching que delete-clients-hard (--name).
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
  console.error('Usage: node scripts/query-clients-by-display-name.mjs "Nom affiché"');
  process.exit(1);
}

const n = displayName.toLowerCase();
const r = await pool.query(
  `SELECT id, created_at, organization_id, company_name, first_name, last_name, email
   FROM clients
   WHERE (
     lower(trim(coalesce(company_name, ''))) = $1
     OR lower(trim(trim(coalesce(first_name, '')) || ' ' || trim(coalesce(last_name, '')))) = $1
   )
   ORDER BY created_at`,
  [n]
);

console.log(JSON.stringify(r.rows, null, 2));
console.log("count:", r.rowCount);
await pool.end();
