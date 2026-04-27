/**
 * Nettoyage organisations de test — DRY-RUN par défaut.
 *
 * Supprime uniquement les lignes organizations sans aucune donnée métier
 * (leads, clients, studies, quotes, entity_documents, invoices, calpinage_snapshots,
 *  lead_meters, lead_dp, client_portal_tokens, mail_accounts).
 * Ne supprime jamais l’org identifiée comme PROD (score métier max / SolarGlobe).
 *
 * Usage:
 *   node scripts/org-cleanup.mjs                    # dry-run
 *   node scripts/org-cleanup.mjs --apply          # exécution (transaction)
 *   node scripts/org-cleanup.mjs --apply --i-understand-delete-test-orgs
 *
 * Backup avant toute suppression : utiliser les scripts existants (ex. scripts/db-backup.js
 * ou npm run équivalent selon votre procédure interne) — aucun backup automatique ici.
 */

import "../config/register-local-env.js";
import "../config/script-env-tail.js";
import pg from "pg";

const METIER_SUM_SQL = `
  (SELECT count(*)::int FROM leads WHERE organization_id = o.id)
+ (SELECT count(*)::int FROM clients WHERE organization_id = o.id)
+ (SELECT count(*)::int FROM studies WHERE organization_id = o.id)
+ (SELECT count(*)::int FROM quotes WHERE organization_id = o.id)
+ (SELECT count(*)::int FROM entity_documents WHERE organization_id = o.id)
+ (SELECT count(*)::int FROM invoices WHERE organization_id = o.id)
+ (SELECT count(*)::int FROM calpinage_snapshots WHERE organization_id = o.id)
+ (SELECT count(*)::int FROM lead_meters WHERE organization_id = o.id)
+ (SELECT count(*)::int FROM lead_dp WHERE organization_id = o.id)
+ (SELECT count(*)::int FROM client_portal_tokens WHERE organization_id = o.id)
+ (SELECT count(*)::int FROM mail_accounts WHERE organization_id = o.id)
`;

async function resolveProdOrgId(client) {
  const r = await client.query(`
    SELECT o.id, o.name,
           (${METIER_SUM_SQL})::int AS metier_score
    FROM organizations o
    ORDER BY metier_score DESC, o.created_at ASC
  `);
  if (r.rows.length === 0) return null;
  const top = r.rows[0];
  const sg = r.rows.find((x) => /solarglobe/i.test(String(x.name || "")));
  if (sg && Number(sg.metier_score) === Number(top.metier_score)) {
    return sg.id;
  }
  return top.id;
}

async function main() {
  const apply =
    process.argv.includes("--apply") &&
    process.argv.includes("--i-understand-delete-test-orgs");

  const dryRun = !apply;

  if (process.argv.includes("--apply") && !process.argv.includes("--i-understand-delete-test-orgs")) {
    console.error(
      "Refus : pour appliquer, ajoutez --i-understand-delete-test-orgs (sécurité anti-suppression accidentelle)."
    );
    process.exit(2);
  }

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL manquant");
    process.exit(2);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    const prodId = await resolveProdOrgId(client);
    const all = await client.query(`
      SELECT o.id, o.name, o.created_at,
             (${METIER_SUM_SQL})::int AS metier_score,
             (SELECT count(*)::int FROM users WHERE organization_id = o.id) AS users_n
      FROM organizations o
      ORDER BY metier_score ASC, o.created_at ASC
    `);

    const deletable = [];
    const manual = [];

    for (const row of all.rows) {
      if (row.id === prodId) {
        manual.push({ ...row, reason: "PROD_ORG (ne jamais supprimer)" });
        continue;
      }
      if (Number(row.metier_score) === 0) {
        deletable.push(row);
      } else {
        manual.push({ ...row, reason: "Données métier présentes — revue manuelle" });
      }
    }

    console.log("=== ORG CLEANUP === mode:", dryRun ? "DRY-RUN" : "APPLY", "\n");
    console.log("PROD_ORG (protégée) :", prodId);
    console.log("\n--- Supprimables (métier_score = 0, hors PROD) ---\n");
    console.table(
      deletable.map((r) => ({
        id: r.id,
        name: r.name,
        users: r.users_n,
        metier: r.metier_score,
      }))
    );

    console.log("\n--- À traiter manuellement (données métier ou PROD) ---\n");
    console.table(
      manual.map((r) => ({
        id: r.id,
        name: r.name,
        metier: r.metier_score,
        reason: r.reason,
      }))
    );

    if (dryRun) {
      console.log("\nAucune suppression (dry-run). Pour appliquer :");
      console.log(
        "  node scripts/org-cleanup.mjs --apply --i-understand-delete-test-orgs"
      );
      return;
    }

    if (deletable.length === 0) {
      console.log("\nRien à supprimer.");
      return;
    }

    await client.query("BEGIN");
    const ids = deletable.map((r) => r.id);
    const del = await client.query(
      `DELETE FROM organizations WHERE id = ANY($1::uuid[]) RETURNING id, name`,
      [ids]
    );
    await client.query("COMMIT");
    console.log("\nSupprimé :", del.rows.length, "organisation(s)");
    console.table(del.rows);
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
