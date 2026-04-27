/**
 * Suppression définitive (hard delete) de clients ciblés + cascade métier complète.
 *
 * Périmètre :
 * - leads où leads.client_id est dans la liste
 * - études / devis / factures liés au client ou à ces leads (client_id, lead_id, study_id, study_version_id)
 * - mail (threads / messages lead_id ou client_id)
 * - missions (client_id ou project_id = étude)
 * - calendrier (study_version_id ou client_id)
 * - entity_documents (client + entités rattachées)
 * - client_contacts
 * - clients
 *
 * audit_logs : option --purge-audit (désactive audit_logs_no_delete le temps du DELETE).
 *
 * Usage:
 *   node scripts/delete-clients-hard.mjs --dry-run --ids=uuid1,uuid2
 *   node scripts/delete-clients-hard.mjs --dry-run --name="Cp077 Test" [--org=uuid]
 *   node scripts/delete-clients-hard.mjs --force --ids=... [--purge-audit]
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const force = argv.includes("--force");
  const purgeAudit = argv.includes("--purge-audit");
  let name = "";
  const nameArg = argv.find((a) => a.startsWith("--name="));
  if (nameArg) name = nameArg.slice("--name=".length).trim();
  let org = "";
  const orgArg = argv.find((a) => a.startsWith("--org="));
  if (orgArg) org = orgArg.slice("--org=".length).trim();
  let ids = [];
  const idsArg = argv.find((a) => a.startsWith("--ids="));
  if (idsArg) {
    ids = idsArg
      .slice("--ids=".length)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return { dryRun, force, purgeAudit, name, org, ids };
}

function assertUuid(id, label) {
  if (!id || !UUID_RE.test(String(id))) {
    throw new Error(`${label} invalide : ${JSON.stringify(id)}`);
  }
}

async function resolveClientsByName(pg, displayName, orgId) {
  const n = displayName.trim().toLowerCase();
  if (!n) return [];
  const params = [n];
  let orgSql = "";
  if (orgId) {
    assertUuid(orgId, "--org");
    orgSql = " AND organization_id = $2 ";
    params.push(orgId);
  }
  const r = await pg.query(
    `SELECT id, organization_id, company_name, first_name, last_name, email, created_at
     FROM clients
     WHERE (
       lower(trim(coalesce(company_name, ''))) = $1
       OR lower(trim(trim(coalesce(first_name, '')) || ' ' || trim(coalesce(last_name, '')))) = $1
     )
     ${orgSql}
     ORDER BY created_at`,
    params
  );
  return r.rows;
}

async function tableExists(pg, tableName) {
  const r = await pg.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  return r.rowCount > 0;
}

function displayClientRow(r) {
  const label =
    (r.company_name && String(r.company_name).trim()) ||
    [r.first_name, r.last_name].filter(Boolean).join(" ").trim() ||
    r.email ||
    "(sans nom)";
  return `${r.id} | org=${r.organization_id} | ${label} | ${r.email || "-"} | créé ${r.created_at}`;
}

async function previewCounts(pg, clientIds, leadIds) {
  if (clientIds.length === 0) return;
  const q = async (label, sql, params) => {
    try {
      const r = await pg.query(sql, params);
      const n = Number(r.rows[0]?.n ?? 0);
      console.log(`  [preview] ${label}: ${n}`);
    } catch (e) {
      console.warn(`  [preview] ${label}: (skip) ${e.message}`);
    }
  };

  await q("clients", `SELECT count(*)::int AS n FROM clients WHERE id = ANY($1::uuid[])`, [clientIds]);
  await q("leads (client_id)", `SELECT count(*)::int AS n FROM leads WHERE client_id = ANY($1::uuid[])`, [
    clientIds,
  ]);
  await q(
    "studies (client ou lead)",
    `SELECT count(*)::int AS n FROM studies
     WHERE client_id = ANY($1::uuid[])
        OR ($2::uuid[] IS NOT NULL AND cardinality($2::uuid[]) > 0 AND lead_id = ANY($2::uuid[]))`,
    [clientIds, leadIds]
  );
  await q(
    "quotes (client ou lead)",
    `SELECT count(*)::int AS n FROM quotes
     WHERE client_id = ANY($1::uuid[])
        OR ($2::uuid[] IS NOT NULL AND cardinality($2::uuid[]) > 0 AND lead_id = ANY($2::uuid[]))`,
    [clientIds, leadIds]
  );
  await q(
    "invoices (client ou lead)",
    `SELECT count(*)::int AS n FROM invoices
     WHERE client_id = ANY($1::uuid[])
        OR ($2::uuid[] IS NOT NULL AND cardinality($2::uuid[]) > 0 AND lead_id = ANY($2::uuid[]))`,
    [clientIds, leadIds]
  );
  await q("mail_threads (client_id)", `SELECT count(*)::int AS n FROM mail_threads WHERE client_id = ANY($1::uuid[])`, [
    clientIds,
  ]);
  await q(
    "entity_documents (client)",
    `SELECT count(*)::int AS n FROM entity_documents WHERE entity_type = 'client' AND entity_id = ANY($1::uuid[])`,
    [clientIds]
  );
  await q(
    "client_contacts",
    `SELECT count(*)::int AS n FROM client_contacts WHERE client_id = ANY($1::uuid[])`,
    [clientIds]
  );
}

/**
 * @param {import("pg").PoolClient} tx
 * @param {string[]} clientIds
 * @param {{ purgeAudit: boolean }} opts
 */
export async function hardDeleteClientsTx(tx, clientIds, opts) {
  const logDel = (label, n) => {
    console.log(`  [delete] ${label}: ${n} ligne(s)`);
  };
  const runDel = async (label, sql, params) => {
    const r = await tx.query(sql, params);
    logDel(label, r.rowCount ?? 0);
  };

  if (clientIds.length === 0) return;

  const leadRows = await tx.query(`SELECT id FROM leads WHERE client_id = ANY($1::uuid[])`, [clientIds]);
  const leadIds = leadRows.rows.map((x) => x.id);

  let studyIds = [];
  if (leadIds.length) {
    const s1 = await tx.query(
      `SELECT id FROM studies WHERE client_id = ANY($1::uuid[]) OR lead_id = ANY($2::uuid[])`,
      [clientIds, leadIds]
    );
    studyIds = [...new Set(s1.rows.map((x) => x.id))];
  } else {
    const s0 = await tx.query(`SELECT id FROM studies WHERE client_id = ANY($1::uuid[])`, [clientIds]);
    studyIds = s0.rows.map((x) => x.id);
  }

  let versionIds = [];
  if (studyIds.length) {
    const vRes = await tx.query(`SELECT id FROM study_versions WHERE study_id = ANY($1::uuid[])`, [studyIds]);
    versionIds = vRes.rows.map((x) => x.id);
  }

  const quoteIdsRes = await tx.query(
    `SELECT id FROM quotes WHERE client_id = ANY($1::uuid[])
     UNION
     SELECT id FROM quotes WHERE lead_id = ANY($2::uuid[])
     UNION
     SELECT id FROM quotes WHERE study_id = ANY($3::uuid[])
     UNION
     SELECT id FROM quotes WHERE study_version_id = ANY($4::uuid[])`,
    [clientIds, leadIds, studyIds, versionIds]
  );
  const quoteIds = quoteIdsRes.rows.map((x) => x.id);

  const invRes = await tx.query(
    `SELECT id FROM invoices WHERE client_id = ANY($1::uuid[])
     UNION
     SELECT id FROM invoices WHERE lead_id = ANY($2::uuid[])`,
    [clientIds, leadIds]
  );
  const invoiceIds = invRes.rows.map((x) => x.id);

  const creditNotesRes = await tx.query(
    `SELECT id FROM credit_notes WHERE invoice_id = ANY($1::uuid[])`,
    [invoiceIds.length ? invoiceIds : []]
  );
  const creditNoteIds = creditNotesRes.rows.map((x) => x.id);

  const paymentsRes = await tx.query(`SELECT id FROM payments WHERE invoice_id = ANY($1::uuid[])`, [
    invoiceIds.length ? invoiceIds : [],
  ]);
  const paymentIds = paymentsRes.rows.map((x) => x.id);

  // --- Mail ---
  await runDel(
    "mail_outbox (messages liés)",
    `DELETE FROM mail_outbox WHERE mail_message_id IN (
       SELECT id FROM mail_messages WHERE lead_id = ANY($1::uuid[]) OR client_id = ANY($2::uuid[])
       UNION
       SELECT id FROM mail_messages WHERE mail_thread_id IN (
         SELECT id FROM mail_threads WHERE lead_id = ANY($1::uuid[]) OR client_id = ANY($2::uuid[])
       )
     )`,
    [leadIds, clientIds]
  );
  await runDel(
    "mail_tracking_events",
    `DELETE FROM mail_tracking_events WHERE mail_message_id IN (
       SELECT id FROM mail_messages WHERE lead_id = ANY($1::uuid[]) OR client_id = ANY($2::uuid[])
       UNION
       SELECT id FROM mail_messages WHERE mail_thread_id IN (
         SELECT id FROM mail_threads WHERE lead_id = ANY($1::uuid[]) OR client_id = ANY($2::uuid[])
       )
     )`,
    [leadIds, clientIds]
  );
  await runDel(
    "mail_threads (lead_id ou client_id)",
    `DELETE FROM mail_threads WHERE lead_id = ANY($1::uuid[]) OR client_id = ANY($2::uuid[])`,
    [leadIds, clientIds]
  );
  await runDel(
    "mail_messages (résiduel)",
    `DELETE FROM mail_messages WHERE lead_id = ANY($1::uuid[]) OR client_id = ANY($2::uuid[])`,
    [leadIds, clientIds]
  );

  // Module email historique (si présent) — CASCADE attachments
  if (await tableExists(tx, "emails")) {
    await runDel(
      "emails (legacy client_id)",
      `DELETE FROM emails WHERE client_id = ANY($1::uuid[])`,
      [clientIds]
    );
  }

  // --- entity_documents (avant factures) ---
  await runDel(
    "entity_documents",
    `DELETE FROM entity_documents ed
     WHERE (ed.entity_type = 'client' AND ed.entity_id = ANY($1::uuid[]))
        OR (ed.entity_type = 'lead' AND ed.entity_id = ANY($2::uuid[]))
        OR (ed.entity_type = 'quote' AND ed.entity_id = ANY($3::uuid[]))
        OR (ed.entity_type = 'study' AND ed.entity_id = ANY($4::uuid[]))
        OR (ed.entity_type = 'study_version' AND ed.entity_id = ANY($5::uuid[]))
        OR (ed.entity_type = 'invoice' AND ed.entity_id = ANY($6::uuid[]))
        OR (ed.entity_type = 'credit_note' AND ed.entity_id = ANY($7::uuid[]))`,
    [clientIds, leadIds, quoteIds, studyIds, versionIds, invoiceIds, creditNoteIds]
  );

  // --- Facturation ---
  await runDel(
    "invoice_reminders",
    `DELETE FROM invoice_reminders WHERE invoice_id = ANY($1::uuid[])`,
    [invoiceIds.length ? invoiceIds : []]
  );
  await runDel(
    "credit_note_lines",
    `DELETE FROM credit_note_lines WHERE credit_note_id = ANY($1::uuid[])`,
    [creditNoteIds.length ? creditNoteIds : []]
  );
  await runDel(
    "credit_notes",
    `DELETE FROM credit_notes WHERE id = ANY($1::uuid[])`,
    [creditNoteIds.length ? creditNoteIds : []]
  );
  await runDel(
    "invoice_lines",
    `DELETE FROM invoice_lines WHERE invoice_id = ANY($1::uuid[])`,
    [invoiceIds.length ? invoiceIds : []]
  );
  await runDel("payments", `DELETE FROM payments WHERE invoice_id = ANY($1::uuid[])`, [
    invoiceIds.length ? invoiceIds : [],
  ]);
  await runDel("invoices", `DELETE FROM invoices WHERE id = ANY($1::uuid[])`, [
    invoiceIds.length ? invoiceIds : [],
  ]);

  // --- Calendrier ---
  await runDel(
    "calendar_events",
    `DELETE FROM calendar_events
     WHERE client_id = ANY($1::uuid[])
        OR ($2::uuid[] IS NOT NULL AND cardinality($2::uuid[]) > 0 AND study_version_id = ANY($2::uuid[]))`,
    [clientIds, versionIds]
  );

  // --- Missions ---
  await runDel(
    "mission_assignments",
    `DELETE FROM mission_assignments WHERE mission_id IN (
       SELECT id FROM missions
       WHERE client_id = ANY($1::uuid[])
          OR ($2::uuid[] IS NOT NULL AND cardinality($2::uuid[]) > 0 AND project_id = ANY($2::uuid[]))
     )`,
    [clientIds, studyIds]
  );
  await runDel(
    "missions",
    `DELETE FROM missions
     WHERE client_id = ANY($1::uuid[])
        OR ($2::uuid[] IS NOT NULL AND cardinality($2::uuid[]) > 0 AND project_id = ANY($2::uuid[]))`,
    [clientIds, studyIds]
  );

  if (versionIds.length) {
    await runDel(
      "economic_snapshots",
      `DELETE FROM economic_snapshots WHERE study_version_id = ANY($1::uuid[])`,
      [versionIds]
    );
  }

  if (studyIds.length || versionIds.length) {
    await runDel(
      "calpinage_snapshots",
      `DELETE FROM calpinage_snapshots WHERE study_id = ANY($1::uuid[]) OR study_version_id = ANY($2::uuid[])`,
      [studyIds, versionIds]
    );
  }

  if (versionIds.length) {
    await runDel("calpinage_data", `DELETE FROM calpinage_data WHERE study_version_id = ANY($1::uuid[])`, [
      versionIds,
    ]);
    await runDel("study_data", `DELETE FROM study_data WHERE study_version_id = ANY($1::uuid[])`, [versionIds]);
  }

  if (await tableExists(tx, "documents")) {
    await runDel(
      "documents (legacy)",
      `DELETE FROM documents
       WHERE client_id = ANY($1::uuid[])
          OR ($2::uuid[] IS NOT NULL AND cardinality($2::uuid[]) > 0 AND study_version_id = ANY($2::uuid[]))`,
      [clientIds, versionIds]
    );
  }

  if (quoteIds.length) {
    await runDel("quote_lines", `DELETE FROM quote_lines WHERE quote_id = ANY($1::uuid[])`, [quoteIds]);
    await runDel("quotes", `DELETE FROM quotes WHERE id = ANY($1::uuid[])`, [quoteIds]);
  } else {
    await runDel(
      "quote_lines",
      `DELETE FROM quote_lines WHERE quote_id IN (
         SELECT id FROM quotes WHERE client_id = ANY($1::uuid[]) OR lead_id = ANY($2::uuid[])
       )`,
      [clientIds, leadIds]
    );
    await runDel(
      "quotes",
      `DELETE FROM quotes WHERE client_id = ANY($1::uuid[]) OR lead_id = ANY($2::uuid[])`,
      [clientIds, leadIds]
    );
  }

  if (versionIds.length) {
    await runDel("study_versions", `DELETE FROM study_versions WHERE id = ANY($1::uuid[])`, [versionIds]);
  }
  if (studyIds.length) {
    await runDel("studies", `DELETE FROM studies WHERE id = ANY($1::uuid[])`, [studyIds]);
  }

  await runDel(
    "lead_consumption_monthly",
    `DELETE FROM lead_consumption_monthly WHERE lead_id = ANY($1::uuid[])`,
    [leadIds]
  );
  await runDel("lead_activities", `DELETE FROM lead_activities WHERE lead_id = ANY($1::uuid[])`, [leadIds]);
  await runDel("lead_dp", `DELETE FROM lead_dp WHERE lead_id = ANY($1::uuid[])`, [leadIds]);
  await runDel("client_portal_tokens", `DELETE FROM client_portal_tokens WHERE lead_id = ANY($1::uuid[])`, [
    leadIds,
  ]);
  if (await tableExists(tx, "lead_meters")) {
    await runDel("lead_meters", `DELETE FROM lead_meters WHERE lead_id = ANY($1::uuid[])`, [leadIds]);
  }
  await runDel("lead_stage_history", `DELETE FROM lead_stage_history WHERE lead_id = ANY($1::uuid[])`, [leadIds]);

  // Adresses orphelines (leads uniquement — pas de FK addresses sur clients)
  if (leadIds.length) {
    const addrRes = await tx.query(
      `SELECT DISTINCT a.id
       FROM (
         SELECT site_address_id AS aid FROM leads WHERE id = ANY($1::uuid[]) AND site_address_id IS NOT NULL
         UNION
         SELECT billing_address_id FROM leads WHERE id = ANY($1::uuid[]) AND billing_address_id IS NOT NULL
       ) x
       JOIN addresses a ON a.id = x.aid
       WHERE NOT EXISTS (
         SELECT 1 FROM leads l
         WHERE l.id <> ALL($1::uuid[])
           AND (l.site_address_id = a.id OR l.billing_address_id = a.id)
       )`,
      [leadIds]
    );
    const addrIds = addrRes.rows.map((r) => r.id);
    if (addrIds.length) {
      await runDel("addresses (orphelines)", `DELETE FROM addresses WHERE id = ANY($1::uuid[])`, [addrIds]);
    } else {
      logDel("addresses (orphelines)", 0);
    }
  } else {
    logDel("addresses (orphelines)", 0);
  }

  if (opts.purgeAudit) {
    const allEntityIds = [
      ...new Set([
        ...clientIds,
        ...leadIds,
        ...quoteIds,
        ...studyIds,
        ...versionIds,
        ...invoiceIds,
        ...creditNoteIds,
        ...paymentIds,
      ]),
    ];
    await tx.query(`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete`);
    try {
      await runDel(
        "audit_logs (entités liées)",
        `DELETE FROM audit_logs
         WHERE entity_id = ANY($1::uuid[])
           AND entity_type IN (
             'client','lead','quote','study','study_version','invoice','credit_note',
             'calpinage','document','entity_document','payment'
           )`,
        [allEntityIds]
      );
    } finally {
      await tx.query(`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete`);
    }
  }

  await runDel("leads (client_id)", `DELETE FROM leads WHERE client_id = ANY($1::uuid[])`, [clientIds]);
  await runDel("client_contacts", `DELETE FROM client_contacts WHERE client_id = ANY($1::uuid[])`, [clientIds]);
  await runDel("clients", `DELETE FROM clients WHERE id = ANY($1::uuid[])`, [clientIds]);
}

async function postVerify(pg, clientIds) {
  if (clientIds.length === 0) return;
  const checks = [
    ["clients restants", `SELECT count(*)::int AS n FROM clients WHERE id = ANY($1::uuid[])`, [clientIds]],
    ["leads client_id", `SELECT count(*)::int AS n FROM leads WHERE client_id = ANY($1::uuid[])`, [clientIds]],
    ["quotes client_id", `SELECT count(*)::int AS n FROM quotes WHERE client_id = ANY($1::uuid[])`, [clientIds]],
    ["studies client_id", `SELECT count(*)::int AS n FROM studies WHERE client_id = ANY($1::uuid[])`, [clientIds]],
    ["invoices client_id", `SELECT count(*)::int AS n FROM invoices WHERE client_id = ANY($1::uuid[])`, [clientIds]],
  ];
  console.log("\n[verify] Contrôles post-suppression :");
  for (const [label, sql, params] of checks) {
    const r = await pg.query(sql, params);
    console.log(`  ${label}: ${r.rows[0].n} (attendu 0)`);
  }
}

async function main() {
  const { dryRun, force, purgeAudit, name, org, ids: rawIds } = parseArgs(process.argv.slice(2));

  if (!name && rawIds.length === 0) {
    console.error(
      "Usage: node scripts/delete-clients-hard.mjs --dry-run|--force --ids=uuid1,uuid2 [--purge-audit]\n" +
        "       node scripts/delete-clients-hard.mjs --dry-run|--force --name=\"…\" [--org=uuid] [--purge-audit]"
    );
    process.exit(1);
  }

  const pg = await pool.connect();
  try {
    let clientRows = [];
    if (rawIds.length) {
      for (const id of rawIds) assertUuid(id, "client id");
      const r = await pg.query(
        `SELECT id, organization_id, company_name, first_name, last_name, email, created_at
         FROM clients WHERE id = ANY($1::uuid[])`,
        [rawIds]
      );
      clientRows = r.rows;
      if (clientRows.length !== rawIds.length) {
        const found = new Set(clientRows.map((x) => x.id));
        const missing = rawIds.filter((id) => !found.has(id));
        console.warn("[warn] IDs clients non trouvés :", missing.join(", "));
      }
    } else {
      clientRows = await resolveClientsByName(pg, name, org);
    }

    if (clientRows.length === 0) {
      console.log("[delete-clients-hard] Aucun client ciblé. Arrêt.");
      return;
    }

    console.log(`\n[delete-clients-hard] ${clientRows.length} client(s) ciblé(s) :\n`);
    for (const r of clientRows) {
      console.log(`  • ${displayClientRow(r)}`);
    }

    const clientIds = clientRows.map((r) => r.id);
    const leadRowsForPreview = await pg.query(`SELECT id FROM leads WHERE client_id = ANY($1::uuid[])`, [
      clientIds,
    ]);
    const leadIdsPreview = leadRowsForPreview.rows.map((x) => x.id);

    console.log("\n[delete-clients-hard] Prévisualisation des volumes :\n");
    await previewCounts(pg, clientIds, leadIdsPreview);

    if (dryRun) {
      console.log("\n[delete-clients-hard] --dry-run : aucune écriture. Ajoutez --force pour supprimer sans invite.");
      return;
    }

    if (!force) {
      const rl = readline.createInterface({ input, output });
      const ans = await rl.question(
        "\nTaper OUI pour confirmer la suppression définitive des clients et de toutes leurs données : "
      );
      await rl.close();
      if (String(ans).trim() !== "OUI") {
        console.log("Annulé.");
        return;
      }
    }

    console.log("\n[delete-clients-hard] Transaction BEGIN…");
    const leadIdsForFs = [...leadIdsPreview];
    await pg.query("BEGIN");
    try {
      await hardDeleteClientsTx(pg, clientIds, { purgeAudit });
      await pg.query("COMMIT");
      console.log("\n[delete-clients-hard] COMMIT OK.");
    } catch (e) {
      await pg.query("ROLLBACK");
      console.error("\n[delete-clients-hard] ROLLBACK :", e.message);
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

    await postVerify(pg, clientIds);
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
