#!/usr/bin/env node
/**
 * Diagnostic lecture seule — clients vs leads (contexte facturation / liste select).
 * Aucune modification de données.
 *
 * Usage :
 *   cd backend && node scripts/diagnose-clients-invoice-context.mjs
 *   cd backend && node scripts/diagnose-clients-invoice-context.mjs <ORGANIZATION_UUID>
 *
 * Connexion : même chargement .env que les autres scripts (db.js).
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env.dev"), override: false });
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: false });

import { applyResolvedDatabaseUrl } from "../config/database-url.js";
applyResolvedDatabaseUrl();

const { pool } = await import("../config/db.js");

const orgFilter = (process.argv[2] || "").trim();

function displayName(row) {
  const c = (row.company_name || "").trim();
  if (c) return c;
  const n = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  if (n) return n;
  return (row.email || "").trim() || row.id;
}

try {
  const byOrg = await pool.query(
    `SELECT organization_id::text, count(*)::int AS n
     FROM clients
     GROUP BY organization_id
     ORDER BY n DESC`
  );

  const archivedSplit = await pool.query(
    `SELECT
       count(*) FILTER (WHERE archived_at IS NULL)::int AS actifs,
       count(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archives,
       count(*)::int AS total
     FROM clients
     ${orgFilter ? "WHERE organization_id = $1::uuid" : ""}`,
    orgFilter ? [orgFilter] : []
  );

  const last30 = await pool.query(
    `SELECT id::text,
            organization_id::text,
            client_number,
            company_name,
            first_name,
            last_name,
            email,
            archived_at,
            created_at,
            updated_at
     FROM clients
     ${orgFilter ? "WHERE organization_id = $1::uuid" : ""}
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT 30`,
    orgFilter ? [orgFilter] : []
  );

  const leadsNoClient = await pool.query(
    `SELECT count(*)::int AS n
     FROM leads
     WHERE archived_at IS NULL
       AND client_id IS NULL
       ${orgFilter ? "AND organization_id = $1::uuid" : ""}`,
    orgFilter ? [orgFilter] : []
  );

  const rows = last30.rows.map((r) => ({
    ...r,
    display_name: displayName(r),
  }));

  const out = {
    organization_filter: orgFilter || null,
    clients_count_by_organization: byOrg.rows,
    clients_archived_split: archivedSplit.rows[0],
    last_30_clients_by_updated_at: rows,
    leads_active_without_client_id: leadsNoClient.rows[0]?.n ?? 0,
  };

  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error(e?.message || e);
  process.exit(1);
} finally {
  await pool.end();
}
