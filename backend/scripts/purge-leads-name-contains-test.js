/**
 * Suppression définitive des leads dont un champ « nom » contient le motif (défaut: test, insensible à la casse).
 * Nettoie les dépendances financières, devis, études, documents CRM et fichiers calpinage locaux.
 *
 * Usage:
 *   node scripts/purge-leads-name-contains-test.js --dry-run
 *   node scripts/purge-leads-name-contains-test.js --execute
 *   node scripts/purge-leads-name-contains-test.js --execute --pattern=demo
 *   node scripts/purge-leads-name-contains-test.js --execute --include-email   (ajoute la colonne email au filtre)
 *   node scripts/purge-leads-name-contains-test.js --execute --exact-names="BENOIT LETREN,SARL AUDIT PRO"
 */

import "../config/register-local-env.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { applyResolvedDatabaseUrl } = await import("../config/database-url.js");
applyResolvedDatabaseUrl();

const { pool } = await import("../config/db.js");
const { deleteCalpinage } = await import("../calpinage/storage/fileStore.js");

function parseArgs() {
  const argv = process.argv.slice(2);
  const execute = argv.includes("--execute");
  const dryRun = argv.includes("--dry-run") || !execute;
  const includeEmail = argv.includes("--include-email");
  let pattern = "test";
  const pArg = argv.find((a) => a.startsWith("--pattern="));
  if (pArg) pattern = pArg.slice("--pattern=".length).trim() || "test";
  const exactArg = argv.find((a) => a.startsWith("--exact-names="));
  const exactNames = exactArg
    ? exactArg
        .slice("--exact-names=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  return { execute, dryRun, pattern, includeEmail, exactNames };
}

function nameMatchSql(includeEmail) {
  const names = `
    COALESCE(full_name, '') ILIKE $1
    OR COALESCE(first_name, '') ILIKE $1
    OR COALESCE(last_name, '') ILIKE $1
    OR COALESCE(company_name, '') ILIKE $1
    OR COALESCE(contact_first_name, '') ILIKE $1
    OR COALESCE(contact_last_name, '') ILIKE $1
  `;
  if (includeEmail) {
    return `(${names} OR COALESCE(email, '') ILIKE $1)`;
  }
  return `(${names})`;
}

async function listTargetLeads(likePattern, includeEmail) {
  const r = await pool.query(
    `SELECT id, organization_id, full_name, email, company_name, first_name, last_name
     FROM leads
     WHERE ${nameMatchSql(includeEmail)}
     ORDER BY created_at`,
    [likePattern]
  );
  return r.rows;
}

/** Correspondance stricte (trim + insensible à la casse) sur full_name, company_name ou prénom+nom. */
async function listExactNameLeads(names) {
  const byId = new Map();
  for (const raw of names) {
    const n = raw.trim().toLowerCase();
    if (!n) continue;
    const r = await pool.query(
      `SELECT id, organization_id, full_name, email, company_name, first_name, last_name, created_at
       FROM leads
       WHERE lower(trim(coalesce(full_name, ''))) = $1
          OR lower(trim(coalesce(company_name, ''))) = $1
          OR lower(trim(trim(coalesce(first_name, '')) || ' ' || trim(coalesce(last_name, '')))) = $1`,
      [n]
    );
    for (const row of r.rows) byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

async function purgeForLeadIds(client, ids) {
  if (ids.length === 0) return;

  const L = `SELECT id FROM invoices WHERE lead_id = ANY($1::uuid[])`;

  await client.query(`DELETE FROM invoice_reminders WHERE invoice_id IN (${L})`, [ids]);

  await client.query(
    `DELETE FROM credit_note_lines WHERE credit_note_id IN (
       SELECT id FROM credit_notes WHERE invoice_id IN (${L})
     )`,
    [ids]
  );

  await client.query(`DELETE FROM credit_notes WHERE invoice_id IN (${L})`, [ids]);

  await client.query(`DELETE FROM invoice_lines WHERE invoice_id IN (${L})`, [ids]);

  await client.query(`DELETE FROM payments WHERE invoice_id IN (${L})`, [ids]);

  await client.query(`DELETE FROM invoices WHERE lead_id = ANY($1::uuid[])`, [ids]);

  const quoteIdsRes = await client.query(`SELECT id FROM quotes WHERE lead_id = ANY($1::uuid[])`, [ids]);
  const quoteIds = quoteIdsRes.rows.map((x) => x.id);
  if (quoteIds.length > 0) {
    await client.query(`DELETE FROM entity_documents WHERE entity_type = 'quote' AND entity_id = ANY($1::uuid[])`, [quoteIds]);
  }

  await client.query(`DELETE FROM quote_lines WHERE quote_id IN (SELECT id FROM quotes WHERE lead_id = ANY($1::uuid[]))`, [ids]);

  await client.query(`DELETE FROM quotes WHERE lead_id = ANY($1::uuid[])`, [ids]);

  await client.query(`DELETE FROM entity_documents WHERE entity_type = 'lead' AND entity_id = ANY($1::uuid[])`, [ids]);

  await client.query(`DELETE FROM studies WHERE lead_id = ANY($1::uuid[])`, [ids]);

  await client.query(`DELETE FROM leads WHERE id = ANY($1::uuid[])`, [ids]);
}

async function main() {
  const { execute, dryRun, pattern, includeEmail, exactNames } = parseArgs();
  const likePattern = `%${pattern}%`;

  const rows =
    exactNames.length > 0
      ? await listExactNameLeads(exactNames)
      : await listTargetLeads(likePattern, includeEmail);

  if (exactNames.length > 0) {
    console.log(`[purge-leads] mode noms exacts: ${exactNames.map((n) => JSON.stringify(n)).join(", ")}`);
  } else {
    console.log(`[purge-leads] motif ILIKE (insensible à la casse): ${JSON.stringify(likePattern)}`);
    console.log(`[purge-leads] filtre email: ${includeEmail ? "oui (--include-email)" : "non (champs nom uniquement)"}`);
  }
  console.log(`[purge-leads] leads correspondants: ${rows.length}`);
  for (const r of rows.slice(0, 50)) {
    console.log(`  - ${r.id} | org=${r.organization_id} | ${r.full_name || r.company_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() || "(sans nom)"} | ${r.email || ""}`);
  }
  if (rows.length > 50) console.log(`  ... et ${rows.length - 50} autre(s)`);

  if (dryRun || !execute) {
    console.log("[purge-leads] mode dry-run — aucune suppression. Relancer avec --execute pour appliquer.");
    await pool.end();
    process.exit(0);
  }

  const ids = rows.map((r) => r.id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await purgeForLeadIds(client, ids);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  for (const id of ids) {
    try {
      deleteCalpinage(id);
    } catch (e) {
      console.warn(`[purge-leads] fichier calpinage ${id}:`, e.message);
    }
  }

  console.log(`[purge-leads] terminé — ${ids.length} lead(s) supprimé(s) en base + fichiers calpinage locaux.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
