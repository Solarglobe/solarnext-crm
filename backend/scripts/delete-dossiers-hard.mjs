/**
 * Suppression définitive « dossiers » : IDs tels qu’affichés dans la liste CRM
 * (onglet leads ou clients) peuvent être des UUID de la table `clients` OU `leads`.
 *
 * Pour chaque ID :
 * - si présent dans `clients` → cascade `hardDeleteClientsTx`
 * - sinon si présent dans `leads` → cascade `hardDeleteLeadsTx`
 *   (sauf si le lead est déjà couvert par un client ciblé : même transaction client)
 *
 * Usage:
 *   node scripts/delete-dossiers-hard.mjs --dry-run --ids=uuid1,uuid2,...
 *   node scripts/delete-dossiers-hard.mjs --force --ids=... [--purge-audit]
 */

import "../config/register-local-env.js";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { applyResolvedDatabaseUrl } from "../config/database-url.js";
applyResolvedDatabaseUrl();

const { pool } = await import("../config/db.js");
const { deleteCalpinage } = await import("../calpinage/storage/fileStore.js");
import { hardDeleteLeadsTx } from "./delete-leads-hard.mjs";
import { hardDeleteClientsTx } from "./delete-clients-hard.mjs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");
  const purgeAudit = argv.includes("--purge-audit");
  let ids = [];
  const idsArg = argv.find((a) => a.startsWith("--ids="));
  if (idsArg) {
    ids = idsArg
      .slice("--ids=".length)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return { dryRun, force, purgeAudit, ids };
}

function assertUuid(id, label) {
  if (!id || !UUID_RE.test(String(id))) {
    throw new Error(`${label} invalide : ${JSON.stringify(id)}`);
  }
}

/**
 * @param {import("pg").PoolClient} pg
 * @param {string[]} rawIds
 */
async function resolveDossierIds(pg, rawIds) {
  const unique = [...new Set(rawIds)];
  if (unique.length === 0) {
    return {
      clientRows: [],
      leadRows: [],
      clientIds: [],
      leadIdsAfterClients: [],
      unknownIds: [],
      rowsByInputOrder: [],
    };
  }

  const cr = await pg.query(
    `SELECT id, organization_id, company_name, first_name, last_name, email, created_at
     FROM clients WHERE id = ANY($1::uuid[])`,
    [unique]
  );
  const lr = await pg.query(
    `SELECT id, organization_id, client_id, full_name, company_name, email, address, created_at
     FROM leads WHERE id = ANY($1::uuid[])`,
    [unique]
  );

  const clientById = new Map(cr.rows.map((r) => [r.id, r]));
  const leadById = new Map(lr.rows.map((r) => [r.id, r]));
  const clientIdSet = new Set(cr.rows.map((r) => r.id));

  const unknownIds = [];
  const rowsByInputOrder = [];

  for (const id of unique) {
    if (clientById.has(id)) {
      const r = clientById.get(id);
      rowsByInputOrder.push({
        id,
        type: "client",
        organization_id: r.organization_id,
        label:
          (r.company_name && String(r.company_name).trim()) ||
          [r.first_name, r.last_name].filter(Boolean).join(" ").trim() ||
          r.email ||
          id,
      });
    } else if (leadById.has(id)) {
      const r = leadById.get(id);
      rowsByInputOrder.push({
        id,
        type: "lead",
        organization_id: r.organization_id,
        label: r.full_name || r.company_name || r.email || id,
        client_id: r.client_id,
      });
    } else {
      unknownIds.push(id);
    }
  }

  const clientIds = cr.rows.map((r) => r.id);
  const leadIdsAfterClients = lr.rows
    .filter((r) => !r.client_id || !clientIdSet.has(r.client_id))
    .map((r) => r.id);

  return {
    clientRows: cr.rows,
    leadRows: lr.rows,
    clientIds,
    leadIdsAfterClients,
    unknownIds,
    rowsByInputOrder,
  };
}

function labelClientRow(r) {
  const name =
    (r.company_name && String(r.company_name).trim()) ||
    [r.first_name, r.last_name].filter(Boolean).join(" ").trim() ||
    r.email ||
    "(sans nom)";
  return `${r.id} | org=${r.organization_id} | ${name}`;
}

function labelLeadRow(r) {
  return `${r.id} | org=${r.organization_id} | ${r.full_name || r.company_name || "(sans nom)"} | ${r.email || "-"} | client_id=${r.client_id || "—"}`;
}

async function verifyInputIdsAbsent(pg, inputIds) {
  if (inputIds.length === 0) return;
  const r = await pg.query(
    `SELECT count(*)::int AS n FROM (
       SELECT id FROM clients WHERE id = ANY($1::uuid[])
       UNION ALL
       SELECT id FROM leads WHERE id = ANY($1::uuid[])
     ) sub`,
    [inputIds]
  );
  console.log(`\n[verify] IDs d’entrée encore présents (clients ∪ leads) : ${r.rows[0].n} (attendu 0)`);
}

async function main() {
  const { dryRun, force, purgeAudit, ids: rawIds } = parseArgs(process.argv.slice(2));

  if (rawIds.length === 0) {
    console.error(
      "Usage: node scripts/delete-dossiers-hard.mjs --dry-run|--force --ids=uuid1,uuid2,... [--purge-audit]"
    );
    process.exit(1);
  }

  for (const id of rawIds) assertUuid(id, "id dossier");

  const pg = await pool.connect();
  try {
    const resolved = await resolveDossierIds(pg, rawIds);

    if (resolved.unknownIds.length > 0) {
      console.error(
        "[delete-dossiers-hard] IDs inconnus (ni client ni lead) :",
        resolved.unknownIds.join(", ")
      );
      console.error("Corrigez la liste ou retirez ces UUID. Arrêt sans écriture.");
      process.exit(1);
    }

    if (resolved.rowsByInputOrder.length === 0) {
      console.log("[delete-dossiers-hard] Aucun ID à traiter.");
      return;
    }

    console.log(`\n[delete-dossiers-hard] ${resolved.rowsByInputOrder.length} ligne(s) résolue(s) :\n`);
    for (const row of resolved.rowsByInputOrder) {
      console.log(`  • [${row.type.toUpperCase()}] ${row.id} | org=${row.organization_id} | ${row.label}`);
    }

    const skippedLeads = resolved.leadRows.filter(
      (r) => r.client_id && resolved.clientIds.includes(r.client_id)
    );
    if (skippedLeads.length > 0) {
      console.log(
        `\n[delete-dossiers-hard] ${skippedLeads.length} lead(s) déjà couvert(s) par un client ciblé (suppression via client uniquement) :`
      );
      for (const r of skippedLeads) {
        console.log(`    - ${r.id} (client_id=${r.client_id})`);
      }
    }

    console.log(
      `\n[delete-dossiers-hard] Résumé : ${resolved.clientIds.length} client(s) à traiter, ${resolved.leadIdsAfterClients.length} lead(s) additionnel(s) (hors périmètre client ci-dessus).`
    );

    if (dryRun) {
      console.log("\n[delete-dossiers-hard] --dry-run : aucune écriture. Ajoutez --force pour supprimer.");
      return;
    }

    if (!force) {
      const rl = readline.createInterface({ input, output });
      const ans = await rl.question(
        "\nTaper OUI pour confirmer la suppression définitive de ces dossiers : "
      );
      await rl.close();
      if (String(ans).trim() !== "OUI") {
        console.log("Annulé.");
        return;
      }
    }

    const leadsUnderClientsRes =
      resolved.clientIds.length > 0
        ? await pg.query(`SELECT id FROM leads WHERE client_id = ANY($1::uuid[])`, [resolved.clientIds])
        : { rows: [] };
    const leadIdsForFs = [
      ...new Set([
        ...leadsUnderClientsRes.rows.map((x) => x.id),
        ...resolved.leadIdsAfterClients,
      ]),
    ];

    const inputIdsUnique = [...new Set(rawIds)];

    console.log("\n[delete-dossiers-hard] Transaction BEGIN…");
    await pg.query("BEGIN");
    try {
      if (resolved.clientIds.length > 0) {
        console.log("\n--- Phase clients (hardDeleteClientsTx) ---");
        await hardDeleteClientsTx(pg, resolved.clientIds, { purgeAudit });
      }
      if (resolved.leadIdsAfterClients.length > 0) {
        console.log("\n--- Phase leads (hardDeleteLeadsTx) ---");
        await hardDeleteLeadsTx(pg, resolved.leadIdsAfterClients, { purgeAudit });
      }
      await pg.query("COMMIT");
      console.log("\n[delete-dossiers-hard] COMMIT OK.");
    } catch (e) {
      await pg.query("ROLLBACK");
      console.error("\n[delete-dossiers-hard] ROLLBACK :", e.message);
      throw e;
    }

    for (const id of leadIdsForFs) {
      try {
        deleteCalpinage(id);
        console.log(`  [fs] calpinage JSON supprimé pour lead ${id}`);
      } catch (e) {
        console.warn(`  [fs] calpinage lead ${id}:`, e.message);
      }
    }

    await verifyInputIdsAbsent(pg, inputIdsUnique);
  } finally {
    pg.release();
    await pool.end();
  }
}

function isExecutedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isExecutedDirectly()) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
