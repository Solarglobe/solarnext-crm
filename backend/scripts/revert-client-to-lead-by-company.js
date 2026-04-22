/**
 * Remet un lead converti par erreur en statut LEAD (API : impossible via PATCH).
 *
 * - Met leads.status = 'LEAD', client_id = NULL, project_status = NULL
 * - Cas fréquent : status = CLIENT mais client_id NULL (erreur UI) → simple UPDATE
 * - Si client_id renseigné : détache quotes/studies/missions, supprime clients si pas de factures
 *
 * Usage (dry-run par défaut) :
 *   node scripts/revert-client-to-lead-by-company.js "CONSULT'TRANSPORT"
 *   node scripts/revert-client-to-lead-by-company.js --pattern "%consult%transport%"
 *   node scripts/revert-client-to-lead-by-company.js --find transport
 *
 * Appliquer :
 *   node scripts/revert-client-to-lead-by-company.js --execute "CONSULT'TRANSPORT"
 *
 * Prérequis : .env.dev ou DATABASE_URL (voir seed-virtual-batteries.js)
 */

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import dotenv from "dotenv";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
dotenv.config({ path: resolve(ROOT, "..", ".env.dev"), override: false });
dotenv.config({ path: resolve(ROOT, ".env.dev"), override: false });

let databaseUrl = process.env.DATABASE_URL || "";
if (databaseUrl && databaseUrl.includes("@db:")) {
  databaseUrl = databaseUrl.replace("@db:", "@localhost:");
}
if (databaseUrl && databaseUrl.includes("//db/")) {
  databaseUrl = databaseUrl.replace("//db/", "//localhost/");
}

function parseArgs(argv) {
  const execute = argv.includes("--execute");
  const rest = argv.filter((a) => a !== "--execute");
  let pattern = null;
  let exact = null;
  let find = null;
  const pIdx = rest.indexOf("--pattern");
  if (pIdx !== -1 && rest[pIdx + 1]) {
    pattern = rest[pIdx + 1];
    rest.splice(pIdx, 2);
  }
  const fIdx = rest.indexOf("--find");
  if (fIdx !== -1 && rest[fIdx + 1]) {
    find = rest[fIdx + 1];
    rest.splice(fIdx, 2);
  }
  const positional = rest.filter((a) => !a.startsWith("--"));
  if (!pattern && !find && positional[0]) exact = positional[0];
  return { execute, pattern, exact, find };
}

async function main() {
  const { execute, pattern, exact, find } = parseArgs(process.argv.slice(2));

  if (!databaseUrl) {
    console.error("DATABASE_URL manquant (.env.dev ou environnement).");
    process.exit(1);
  }
  if (!pattern && !exact && !find) {
    console.error(
      "Indiquez le nom entreprise, --pattern ou --find. Exemple :\n" +
        '  node scripts/revert-client-to-lead-by-company.js "CONSULT\'TRANSPORT"\n' +
        "  node scripts/revert-client-to-lead-by-company.js --pattern \"%consult%transport%\"\n" +
        "  node scripts/revert-client-to-lead-by-company.js --find transport"
    );
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    if (find) {
      const like = `%${find}%`;
      const r = await client.query(
        `SELECT l.id, l.status, l.client_id, l.company_name, l.full_name,
                c.company_name AS client_company_name, c.client_number
         FROM leads l
         LEFT JOIN clients c ON c.id = l.client_id
         WHERE l.company_name ILIKE $1 OR l.full_name ILIKE $1
            OR c.company_name ILIKE $1
         ORDER BY l.updated_at DESC
         LIMIT 50`,
        [like]
      );
      console.table(r.rows);
      return;
    }

    let candidates;
    if (pattern) {
      const r = await client.query(
        `SELECT l.id AS lead_id, l.organization_id, l.status, l.client_id, l.company_name,
                c.company_name AS client_company_name, c.client_number
         FROM leads l
         LEFT JOIN clients c ON c.id = l.client_id
         WHERE l.company_name ILIKE $1 OR l.full_name ILIKE $1 OR c.company_name ILIKE $1`,
        [pattern]
      );
      candidates = r.rows;
    } else {
      const r = await client.query(
        `SELECT l.id AS lead_id, l.organization_id, l.status, l.client_id, l.company_name,
                c.company_name AS client_company_name, c.client_number
         FROM leads l
         LEFT JOIN clients c ON c.id = l.client_id
         WHERE l.company_name = $1 OR l.full_name = $1 OR c.company_name = $1`,
        [exact]
      );
      candidates = r.rows;
    }

    if (candidates.length === 0) {
      console.log("Aucun lead ne correspond à ce nom.");
      return;
    }

    const needsFix = (r) => !(r.status === "LEAD" && r.client_id == null);
    const rows = candidates.filter(needsFix);

    if (rows.length === 0) {
      console.log("Déjà en lead (status=LEAD, sans client_id) — rien à faire.");
      return;
    }
    if (rows.length > 1) {
      console.log("Plusieurs correspondances à corriger — affinez le nom ou utilisez --pattern :");
      for (const row of rows) {
        console.log(
          `  lead_id=${row.lead_id} status=${row.status} company_name=${row.company_name} client=${row.client_company_name} ${row.client_number || ""}`
        );
      }
      process.exit(1);
    }

    const row = rows[0];
    const { lead_id, client_id, company_name, client_company_name } = row;

    let nInv = 0;
    let nCn = 0;
    if (client_id) {
      const inv = await client.query(
        `SELECT COUNT(*)::int AS n FROM invoices WHERE client_id = $1`,
        [client_id]
      );
      nInv = inv.rows[0].n;
      const cn = await client.query(
        `SELECT COUNT(*)::int AS n FROM credit_notes WHERE client_id = $1`,
        [client_id]
      );
      nCn = cn.rows[0].n;
    }

    console.log(
      JSON.stringify(
        {
          lead_id,
          client_id,
          company_name,
          client_company_name,
          mode: client_id ? "avec fiche clients" : "statut CLIENT sans client_id",
          invoices: nInv,
          credit_notes: nCn,
        },
        null,
        2
      )
    );

    if (!execute) {
      console.log("\nDry-run : relancez avec --execute pour appliquer.");
      return;
    }

    if (client_id && (nInv > 0 || nCn > 0)) {
      console.error(
        `Refus : données financières liées (factures: ${nInv}, avoirs: ${nCn}). Suppression client impossible.`
      );
      process.exit(1);
    }

    await client.query("BEGIN");

    if (client_id) {
      await client.query(`UPDATE quotes SET client_id = NULL WHERE lead_id = $1`, [lead_id]);
      await client.query(`UPDATE studies SET client_id = NULL WHERE lead_id = $1`, [lead_id]);
      await client.query(`UPDATE missions SET client_id = NULL WHERE client_id = $1`, [client_id]);
    }

    await client.query(
      `UPDATE leads
       SET status = 'LEAD', client_id = NULL, project_status = NULL, updated_at = now()
       WHERE id = $1`,
      [lead_id]
    );

    if (client_id) {
      await client.query(`DELETE FROM clients WHERE id = $1`, [client_id]);
    }

    await client.query("COMMIT");
    console.log(
      client_id
        ? "OK : lead remis en LEAD, fiche client supprimée, références nettoyées."
        : "OK : lead remis en LEAD (pas de fiche client à supprimer)."
    );
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(e);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
