#!/usr/bin/env node
/**
 * Nettoyage des fiches clients contenant « TEST » (dry-run par défaut).
 *
 * - Filtre UNIQUEMENT sur %test% (pas anonymized/snap) — demande explicite Benoit.
 * - Pas besoin de --org : traite toutes les organisations.
 * - Garde-fous : ne supprime JAMAIS une fiche ayant une facture,
 *   un lead actif (archived_at IS NULL) ou un devis non archivé.
 *
 * Connexion : lit l'adresse de la base dans le fichier « connexion-prod.txt »
 * placé à la racine du projet (la 1re ligne commençant par postgresql://).
 * Sinon, retombe sur la configuration locale (.env.dev).
 *
 * Usage :
 *   node scripts/cleanup-test-clients-auto.mjs            (liste seule)
 *   node scripts/cleanup-test-clients-auto.mjs --apply    (supprime les fiches SAFE)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 1) Adresse de connexion prod fournie via connexion-prod.txt (racine projet)
const prodUrlFile = path.resolve(__dirname, "../../connexion-prod.txt");
let prodUrlProvided = false;
if (!process.env.DATABASE_URL && fs.existsSync(prodUrlFile)) {
  const line = fs
    .readFileSync(prodUrlFile, "utf8")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => /^postgres(ql)?:\/\//i.test(s) && !/EXEMPLE|REMPLACE/i.test(s));
  if (line) {
    process.env.DATABASE_URL = line;
    prodUrlProvided = true;
  } else {
    // Le fichier existe mais l'adresse n'a pas encore ete collee.
    console.error("");
    console.error("===================================================");
    console.error("  L'ADRESSE DE TA BASE N'A PAS ENCORE ETE COLLEE");
    console.error("===================================================");
    console.error("  Ouvre le fichier  connexion-prod.txt  (a cote de ce");
    console.error("  bouton), remplace la ligne d'exemple par l'adresse");
    console.error("  DATABASE_PUBLIC_URL de Railway (elle commence par");
    console.error("  postgresql:// ), enregistre, puis relance ce bouton.");
    console.error("===================================================");
    console.error("");
    process.exit(1);
  }
}

// 2) Chargement env APRÈS avoir éventuellement fixé DATABASE_URL (imports dynamiques)
await import("../config/register-local-env.js");
const { applyResolvedDatabaseUrl } = await import("../config/database-url.js");
applyResolvedDatabaseUrl();

const NAME_PATTERNS = ["%test%"];

const MATCH_SQL = `(
  COALESCE(c.company_name, '') ILIKE ANY($1::text[])
  OR COALESCE(c.first_name, '') ILIKE ANY($1::text[])
  OR COALESCE(c.last_name, '') ILIKE ANY($1::text[])
  OR COALESCE(c.email, '') ILIKE ANY($1::text[])
  OR concat_ws(' ', c.first_name, c.last_name, c.company_name) ILIKE ANY($1::text[])
)`;

function displayName(row) {
  const c = (row.company_name || "").trim();
  if (c) return c;
  const n = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  if (n) return n;
  return (row.email || "").trim() || row.id;
}

async function main() {
  const apply = process.argv.slice(2).includes("--apply");
  const { pool } = await import("../config/db.js");

  try {
    const listSql = `
      SELECT
        c.id, c.organization_id, c.company_name, c.first_name, c.last_name, c.email, c.created_at,
        (SELECT count(*)::int FROM invoices i
         WHERE i.client_id = c.id AND i.organization_id = c.organization_id) AS invoice_count,
        (SELECT count(*)::int FROM leads l
         WHERE l.client_id = c.id AND l.organization_id = c.organization_id AND l.archived_at IS NULL) AS active_lead_count,
        (SELECT count(*)::int FROM quotes q
         WHERE q.client_id = c.id AND q.organization_id = c.organization_id AND (q.archived_at IS NULL)) AS active_quote_count
      FROM clients c
      WHERE (c.archived_at IS NULL) AND ${MATCH_SQL}
      ORDER BY c.created_at DESC
    `;
    const res = await pool.query(listSql, [NAME_PATTERNS]);
    const rows = res.rows;

    const mode = apply ? "SUPPRESSION" : "APERCU (rien n'est supprime)";
    console.log("");
    console.log("===================================================");
    console.log("  Nettoyage des fiches clients contenant TEST");
    console.log("  Base : " + (prodUrlProvided ? "PRODUCTION (en ligne)" : "configuration locale"));
    console.log("  Mode : " + mode);
    console.log("===================================================");
    console.log("  Fiches trouvees : " + rows.length);
    console.log("");

    const safe = [];
    for (const r of rows) {
      const name = displayName(r);
      const inv = Number(r.invoice_count) || 0;
      const activeLeads = Number(r.active_lead_count) || 0;
      const quotes = Number(r.active_quote_count) || 0;
      const reasons = [];
      if (inv > 0) reasons.push(inv + " facture(s)");
      if (activeLeads > 0) reasons.push(activeLeads + " lead(s) actif(s)");
      if (quotes > 0) reasons.push(quotes + " devis actif(s)");
      const isSafe = reasons.length === 0;
      if (isSafe) {
        console.log("  [A SUPPRIMER] " + name + "   (" + (r.email || "sans email") + ")");
        safe.push(r.id);
      } else {
        console.log("  [PROTEGEE  ] " + name + "   -> conservee : " + reasons.join(", "));
      }
    }

    console.log("");
    console.log("---------------------------------------------------");
    console.log("  A supprimer : " + safe.length + "   |   Protegees : " + (rows.length - safe.length));
    console.log("---------------------------------------------------");
    console.log("");

    if (!apply) {
      console.log("  >> Ceci n'etait qu'un APERCU. Rien n'a ete supprime.");
      return;
    }
    if (safe.length === 0) {
      console.log("  >> Aucune fiche a supprimer.");
      return;
    }

    const pg = await pool.connect();
    try {
      await pg.query("BEGIN");
      const del = await pg.query(
        `DELETE FROM clients c
         WHERE c.id = ANY($1::uuid[]) AND (c.archived_at IS NULL)
         RETURNING c.id`,
        [safe]
      );
      await pg.query("COMMIT");
      console.log("  >> SUPPRESSION REUSSIE : " + del.rowCount + " fiche(s) supprimee(s).");
    } catch (e) {
      await pg.query("ROLLBACK");
      console.error("  >> ERREUR — rien n'a ete supprime : " + (e?.message || e));
      process.exitCode = 1;
    } finally {
      pg.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  const inner = Array.isArray(e?.errors) ? e.errors.map((x) => x?.code || x?.message).join(", ") : "";
  const msg = [e?.message, e?.code, inner].filter(Boolean).join(" | ") || String(e);
  console.error("");
  if (/ECONNREFUSED|ENOTFOUND|timeout|password|authentification|authentication|ETIMEDOUT/i.test(msg)) {
    console.error("  >> Impossible de se connecter a la base de donnees.");
    console.error("     Verifie le fichier connexion-prod.txt (adresse Railway publique,");
    console.error("     commencant par postgresql://). Detail technique : " + msg);
  } else {
    console.error("  Erreur : " + msg);
  }
  process.exit(1);
});
