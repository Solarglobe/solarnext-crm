#!/usr/bin/env node
/**
 * Nettoyage des fiches clients « test / anonymized / snap » (dry-run par défaut).
 *
 * Filtre (organization_id obligatoire) — champs : company_name, first_name, last_name, email
 * et concat nom, avec ILIKE %test%, %anonymized%, %snap% (faux positifs possibles sur « test » dans un mot).
 *
 * NE supprime jamais (--apply) si :
 *   - au moins une facture (invoices) pour ce client
 *   - au moins un lead actif (archived_at IS NULL) avec client_id = ce client
 *   - au moins un devis non archivé (quotes) avec client_id = ce client (évite RESTRICT / données réelles)
 *
 * Les leads archivés seuls : le DELETE client mettra client_id à NULL (FK) — on ne supprime pas si lead actif.
 * Aucune modification des tables invoices / leads / quotes : uniquement DELETE clients sur lignes sans dépendances bloquantes.
 *
 * Usage :
 *   cd backend && node scripts/cleanup-test-clients.mjs --org=<ORGANIZATION_UUID>
 *   cd backend && node scripts/cleanup-test-clients.mjs --org=<UUID> --apply
 */
import "../config/register-local-env.js";
import { writeSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/** Sortie immédiate (stdout non-TTY / SSH peut bufferiser console.log). */
writeSync(1, `[cleanup-test-clients] SCRIPT START ${new Date().toISOString()}\n`);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { applyResolvedDatabaseUrl } from "../config/database-url.js";
applyResolvedDatabaseUrl();
writeSync(1, "[cleanup-test-clients] after applyResolvedDatabaseUrl\n");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const NAME_PATTERNS = ["%test%", "%anonymized%", "%snap%"];

/** Motifs sur les champs « nom » CRM + email. */
const MATCH_SQL = `(
  COALESCE(c.company_name, '') ILIKE ANY($2::text[])
  OR COALESCE(c.first_name, '') ILIKE ANY($2::text[])
  OR COALESCE(c.last_name, '') ILIKE ANY($2::text[])
  OR COALESCE(c.email, '') ILIKE ANY($2::text[])
  OR concat_ws(' ', c.first_name, c.last_name, c.company_name) ILIKE ANY($2::text[])
)`;

function parseArgs(argv) {
  const apply = argv.includes("--apply");
  let org = "";
  const orgArg = argv.find((a) => a.startsWith("--org="));
  if (orgArg) org = orgArg.slice("--org=".length).trim();
  return { apply, org };
}

function displayName(row) {
  const c = (row.company_name || "").trim();
  if (c) return c;
  const n = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  if (n) return n;
  return (row.email || "").trim() || row.id;
}

async function main() {
  const argv = process.argv.slice(2);
  const { apply, org } = parseArgs(argv);

  if (!org) {
    console.error("Erreur : --org=<ORGANIZATION_UUID> est obligatoire (périmètre unique).");
    console.error("Exemple dry-run : node scripts/cleanup-test-clients.mjs --org=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx");
    process.exit(1);
  }
  if (!UUID_RE.test(org)) {
    console.error(`Erreur : --org invalide (UUID attendu) : ${org}`);
    process.exit(1);
  }

  const { pool } = await import("../config/db.js");
  writeSync(1, "[cleanup-test-clients] pool module loaded\n");

  try {
    const baseFrom = `
      FROM clients c
      WHERE c.organization_id = $1::uuid
        AND (c.archived_at IS NULL)
        AND ${MATCH_SQL}
    `;

    const statsSelect = `
      SELECT
        c.id,
        c.company_name,
        c.first_name,
        c.last_name,
        c.email,
        c.created_at,
        (SELECT count(*)::int FROM invoices i
         WHERE i.client_id = c.id AND i.organization_id = c.organization_id) AS invoice_count,
        (SELECT count(*)::int FROM leads l
         WHERE l.client_id = c.id AND l.organization_id = c.organization_id AND l.archived_at IS NULL) AS active_lead_count,
        (SELECT count(*)::int FROM leads l
         WHERE l.client_id = c.id AND l.organization_id = c.organization_id) AS lead_link_total,
        (SELECT count(*)::int FROM quotes q
         WHERE q.client_id = c.id AND q.organization_id = c.organization_id AND (q.archived_at IS NULL)) AS active_quote_count
    `;

    const listSql = `${statsSelect} ${baseFrom} ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC`;

    const res = await pool.query(listSql, [org, NAME_PATTERNS]);
    const rows = res.rows;

    const mode = apply ? "APPLY" : "DRY-RUN";
    console.log(`\n[cleanup-test-clients] mode=${mode} organization_id=${org}`);
    console.log(`[cleanup-test-clients] motifs ILIKE : ${NAME_PATTERNS.join(", ")}`);
    console.log(`[cleanup-test-clients] candidats : ${rows.length}\n`);

    const safe = [];

    for (const r of rows) {
      const name = displayName(r);
      const inv = Number(r.invoice_count) || 0;
      const activeLeads = Number(r.active_lead_count) || 0;
      const ql = Number(r.lead_link_total) || 0;
      const quotes = Number(r.active_quote_count) || 0;
      const reasons = [];
      if (inv > 0) reasons.push(`${inv} facture(s)`);
      if (activeLeads > 0) reasons.push(`${activeLeads} lead(s) actif(s)`);
      if (quotes > 0) reasons.push(`${quotes} devis non archivé(s)`);
      const isSafe = reasons.length === 0;
      const flag = isSafe ? "SAFE" : "SKIP";
      console.log(
        `[${flag}] id=${r.id} | name=${JSON.stringify(name)} | email=${r.email || "—"} | créé=${r.created_at} | factures=${inv} | leads_actifs=${activeLeads} | leads_liés_total=${ql} | devis_actifs=${quotes}${reasons.length ? ` | refus: ${reasons.join(", ")}` : ""}`
      );
      if (isSafe) {
        safe.push(r.id);
      }
    }

    console.log(`\n--- Résumé ---`);
    console.log(`Supprimables (aucune facture, aucun lead actif, aucun devis actif) : ${safe.length}`);
    console.log(`Ignorés : ${rows.length - safe.length}`);

    if (!apply) {
      console.log(
        `\n[DRY-RUN] Aucune suppression. Relancer avec --apply pour exécuter (uniquement les fiches SAFE, ${safe.length} ligne(s)).`
      );
      return;
    }

    if (safe.length === 0) {
      console.log("\n[APPLY] Rien à supprimer.");
      return;
    }

    const pg = await pool.connect();
    try {
      await pg.query("BEGIN");
      const del = await pg.query(
        `DELETE FROM clients c
         WHERE c.organization_id = $1::uuid
           AND c.id = ANY($2::uuid[])
           AND (c.archived_at IS NULL)
         RETURNING c.id`,
        [org, safe]
      );
      await pg.query("COMMIT");
      console.log(`\n[APPLY] Suppression réussie : ${del.rowCount} ligne(s) clients.`);
      for (const row of del.rows) {
        console.log(`  [deleted] id=${row.id}`);
      }
    } catch (e) {
      await pg.query("ROLLBACK");
      console.error("\n[APPLY] ERREUR — transaction annulée :", e?.message || e);
      process.exitCode = 1;
    } finally {
      pg.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
