/**
 * Suppression définitive (hard delete) de leads ciblés + cascade métier complète.
 *
 * Tables couvertes (ordre d’exécution interne) :
 * - mail_outbox, mail_tracking_events (liées aux messages / fils du lead)
 * - mail_threads (lead_id) → CASCADE messages, participants, attachments, notes, tag_links
 * - mail_messages (lead_id orphelin éventuel)
 * - entity_documents (lead, quote, study, study_version, invoice, credit_note — avant factures)
 * - invoice_reminders, credit_note_lines, credit_notes, invoice_lines, payments, invoices (lead_id)
 * - calendar_events (study_version_id)
 * - mission_assignments + missions (project_id = study_id)
 * - economic_snapshots, calpinage_snapshots, calpinage_data, study_data
 * - documents (legacy, si table présente)
 * - quote_lines, quotes
 * - study_versions, studies
 * - lead_consumption_monthly, lead_activities, lead_dp, client_portal_tokens, lead_meters (si table)
 * - lead_stage_history
 * - addresses (site/billing : orphelines si aucun autre lead ne référence l’id — clients n’ont pas de FK addresses)
 * - leads
 * - fichiers JSON calpinage local (fileStore)
 *
 * audit_logs : immuable par trigger — option --purge-audit (désactive le trigger le temps du DELETE).
 *
 * Usage:
 *   node scripts/delete-leads-hard.mjs --dry-run --name="Quote Cp077"
 *   node scripts/delete-leads-hard.mjs --dry-run --ids=uuid1,uuid2
 *   node scripts/delete-leads-hard.mjs --force --name="Quote Cp077" [--org=uuid]
 *   node scripts/delete-leads-hard.mjs --force --ids=... [--purge-audit]
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

/**
 * Résolution leads : noms exacts (full_name, company_name, prénom+nom) insensible à la casse.
 */
async function resolveLeadIdsByName(client, displayName, orgId) {
  const n = displayName.trim().toLowerCase();
  if (!n) return [];
  const params = [n];
  let orgSql = "";
  if (orgId) {
    assertUuid(orgId, "--org");
    orgSql = " AND organization_id = $2 ";
    params.push(orgId);
  }
  const r = await client.query(
    `SELECT id, organization_id, full_name, company_name, email, address, created_at
     FROM leads
     WHERE (
       lower(trim(coalesce(full_name, ''))) = $1
       OR lower(trim(coalesce(company_name, ''))) = $1
       OR lower(trim(trim(coalesce(first_name, '')) || ' ' || trim(coalesce(last_name, '')))) = $1
     )
     ${orgSql}
     ORDER BY created_at`,
    params
  );
  return r.rows;
}

async function tableExists(client, tableName) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  return r.rowCount > 0;
}

async function previewCounts(client, leadIds) {
  if (leadIds.length === 0) return;
  const q = async (label, sql, params = [leadIds]) => {
    try {
      const r = await client.query(sql, params);
      const n = Number(r.rows[0]?.n ?? 0);
      console.log(`  [preview] ${label}: ${n}`);
    } catch (e) {
      console.warn(`  [preview] ${label}: (skip) ${e.message}`);
    }
  };

  await q("leads", `SELECT count(*)::int AS n FROM leads WHERE id = ANY($1::uuid[])`, [leadIds]);
  await q("quotes", `SELECT count(*)::int AS n FROM quotes WHERE lead_id = ANY($1::uuid[])`, [leadIds]);
  await q(
    "quotes (via studies)",
    `SELECT count(*)::int AS n FROM quotes q
     JOIN studies s ON s.id = q.study_id WHERE s.lead_id = ANY($1::uuid[])`,
    [leadIds]
  );
  await q(
    "studies",
    `SELECT count(*)::int AS n FROM studies WHERE lead_id = ANY($1::uuid[])`,
    [leadIds]
  );
  await q(
    "study_versions",
    `SELECT count(*)::int AS n FROM study_versions sv
     JOIN studies s ON s.id = sv.study_id WHERE s.lead_id = ANY($1::uuid[])`,
    [leadIds]
  );
  await q("invoices (lead_id)", `SELECT count(*)::int AS n FROM invoices WHERE lead_id = ANY($1::uuid[])`, [leadIds]);
  await q(
    "calpinage_data",
    `SELECT count(*)::int AS n FROM calpinage_data cd
     JOIN study_versions sv ON sv.id = cd.study_version_id
     JOIN studies s ON s.id = sv.study_id WHERE s.lead_id = ANY($1::uuid[])`,
    [leadIds]
  );
  await q(
    "entity_documents (lead/quote/study/version/invoice/credit_note)",
    `SELECT count(*)::int AS n FROM entity_documents ed
     WHERE (ed.entity_type = 'lead' AND ed.entity_id = ANY($1::uuid[]))
        OR (ed.entity_type = 'quote' AND ed.entity_id IN (SELECT id FROM quotes WHERE lead_id = ANY($1::uuid[])))
        OR (ed.entity_type = 'study' AND ed.entity_id IN (SELECT id FROM studies WHERE lead_id = ANY($1::uuid[])))
        OR (ed.entity_type = 'study_version' AND ed.entity_id IN (
             SELECT sv.id FROM study_versions sv
             JOIN studies s ON s.id = sv.study_id WHERE s.lead_id = ANY($1::uuid[])
           ))
        OR (ed.entity_type = 'invoice' AND ed.entity_id IN (SELECT id FROM invoices WHERE lead_id = ANY($1::uuid[])))
        OR (ed.entity_type = 'credit_note' AND ed.entity_id IN (
             SELECT cn.id FROM credit_notes cn
             INNER JOIN invoices i ON i.id = cn.invoice_id
             WHERE i.lead_id = ANY($1::uuid[])
           ))`,
    [leadIds]
  );
  await q("mail_threads (lead_id)", `SELECT count(*)::int AS n FROM mail_threads WHERE lead_id = ANY($1::uuid[])`, [
    leadIds,
  ]);
  await q("lead_stage_history", `SELECT count(*)::int AS n FROM lead_stage_history WHERE lead_id = ANY($1::uuid[])`, [
    leadIds,
  ]);
  if (await tableExists(client, "lead_meters")) {
    await q("lead_meters", `SELECT count(*)::int AS n FROM lead_meters WHERE lead_id = ANY($1::uuid[])`, [leadIds]);
  }
}

/**
 * @param {import("pg").PoolClient} client
 * @param {string[]} leadIds
 * @param {{ purgeAudit: boolean }} opts
 */
export async function hardDeleteLeadsTx(client, leadIds, opts) {
  const stats = {};
  const logDel = (label, n) => {
    stats[label] = n;
    console.log(`  [delete] ${label}: ${n} ligne(s)`);
  };

  const runDel = async (label, sql, params) => {
    const r = await client.query(sql, params);
    logDel(label, r.rowCount ?? 0);
  };

  if (leadIds.length === 0) return stats;

  const studiesRes = await client.query(`SELECT id FROM studies WHERE lead_id = ANY($1::uuid[])`, [leadIds]);
  const studyIds = studiesRes.rows.map((x) => x.id);
  let versionIds = [];
  if (studyIds.length) {
    const vRes = await client.query(`SELECT id FROM study_versions WHERE study_id = ANY($1::uuid[])`, [studyIds]);
    versionIds = vRes.rows.map((x) => x.id);
  }

  const quoteIdsRes = await client.query(
    `SELECT id FROM quotes WHERE lead_id = ANY($1::uuid[])
     UNION
     SELECT id FROM quotes WHERE study_id = ANY($2::uuid[])
     UNION
     SELECT id FROM quotes WHERE study_version_id = ANY($3::uuid[])`,
    [leadIds, studyIds, versionIds]
  );
  const quoteIds = quoteIdsRes.rows.map((x) => x.id);

  const invSub = `SELECT id FROM invoices WHERE lead_id = ANY($1::uuid[])`;
  const invoicesRes = await client.query(invSub, [leadIds]);
  const invoiceIds = invoicesRes.rows.map((x) => x.id);
  const creditNotesRes = await client.query(
    `SELECT id FROM credit_notes WHERE invoice_id IN (${invSub})`,
    [leadIds]
  );
  const creditNoteIds = creditNotesRes.rows.map((x) => x.id);
  const paymentsRes = await client.query(
    `SELECT id FROM payments WHERE invoice_id IN (${invSub})`,
    [leadIds]
  );
  const paymentIds = paymentsRes.rows.map((x) => x.id);

  // --- Mail : outbox / tracking puis fils ---
  await runDel(
    "mail_outbox (messages liés au lead)",
    `DELETE FROM mail_outbox WHERE mail_message_id IN (
       SELECT id FROM mail_messages WHERE lead_id = ANY($1::uuid[])
       UNION
       SELECT id FROM mail_messages WHERE mail_thread_id IN (
         SELECT id FROM mail_threads WHERE lead_id = ANY($1::uuid[])
       )
     )`,
    [leadIds]
  );
  await runDel(
    "mail_tracking_events",
    `DELETE FROM mail_tracking_events WHERE mail_message_id IN (
       SELECT id FROM mail_messages WHERE lead_id = ANY($1::uuid[])
       UNION
       SELECT id FROM mail_messages WHERE mail_thread_id IN (
         SELECT id FROM mail_threads WHERE lead_id = ANY($1::uuid[])
       )
     )`,
    [leadIds]
  );
  await runDel("mail_threads (lead_id)", `DELETE FROM mail_threads WHERE lead_id = ANY($1::uuid[])`, [leadIds]);
  await runDel("mail_messages (lead_id résiduel)", `DELETE FROM mail_messages WHERE lead_id = ANY($1::uuid[])`, [
    leadIds,
  ]);

  // --- Documents polymorphes AVANT factures / quotes (PDF facture, avoir, devis, etc.) ---
  await runDel(
    "entity_documents",
    `DELETE FROM entity_documents ed
     WHERE (ed.entity_type = 'lead' AND ed.entity_id = ANY($1::uuid[]))
        OR (ed.entity_type = 'quote' AND ed.entity_id = ANY($2::uuid[]))
        OR (ed.entity_type = 'study' AND ed.entity_id = ANY($3::uuid[]))
        OR (ed.entity_type = 'study_version' AND ed.entity_id = ANY($4::uuid[]))
        OR (ed.entity_type = 'invoice' AND ed.entity_id IN (SELECT id FROM invoices WHERE lead_id = ANY($1::uuid[])))
        OR (ed.entity_type = 'credit_note' AND ed.entity_id IN (
             SELECT cn.id FROM credit_notes cn
             INNER JOIN invoices i ON i.id = cn.invoice_id
             WHERE i.lead_id = ANY($1::uuid[])
           ))`,
    [leadIds, quoteIds, studyIds, versionIds]
  );

  // --- Facturation ---
  await runDel(
    "invoice_reminders",
    `DELETE FROM invoice_reminders WHERE invoice_id IN (${invSub})`,
    [leadIds]
  );
  await runDel(
    "credit_note_lines",
    `DELETE FROM credit_note_lines WHERE credit_note_id IN (
       SELECT id FROM credit_notes WHERE invoice_id IN (${invSub})
     )`,
    [leadIds]
  );
  await runDel(
    "credit_notes",
    `DELETE FROM credit_notes WHERE invoice_id IN (${invSub})`,
    [leadIds]
  );
  await runDel(
    "invoice_lines",
    `DELETE FROM invoice_lines WHERE invoice_id IN (${invSub})`,
    [leadIds]
  );
  await runDel(
    "payments",
    `DELETE FROM payments WHERE invoice_id IN (${invSub})`,
    [leadIds]
  );
  await runDel("invoices", `DELETE FROM invoices WHERE lead_id = ANY($1::uuid[])`, [leadIds]);

  if (versionIds.length) {
    await runDel(
      "calendar_events",
      `DELETE FROM calendar_events WHERE study_version_id = ANY($1::uuid[])`,
      [versionIds]
    );
  }

  if (studyIds.length) {
    await runDel(
      "mission_assignments (missions liées aux études)",
      `DELETE FROM mission_assignments WHERE mission_id IN (
         SELECT id FROM missions WHERE project_id = ANY($1::uuid[])
       )`,
      [studyIds]
    );
    await runDel("missions (project_id = study)", `DELETE FROM missions WHERE project_id = ANY($1::uuid[])`, [
      studyIds,
    ]);
  }

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

  if (await tableExists(client, "documents")) {
    if (versionIds.length) {
      await runDel("documents (legacy)", `DELETE FROM documents WHERE study_version_id = ANY($1::uuid[])`, [
        versionIds,
      ]);
    }
  }

  if (quoteIds.length) {
    await runDel("quote_lines", `DELETE FROM quote_lines WHERE quote_id = ANY($1::uuid[])`, [quoteIds]);
    await runDel("quotes", `DELETE FROM quotes WHERE id = ANY($1::uuid[])`, [quoteIds]);
  } else {
    await runDel("quote_lines", `DELETE FROM quote_lines WHERE quote_id IN (SELECT id FROM quotes WHERE lead_id = ANY($1::uuid[]))`, [leadIds]);
    await runDel("quotes", `DELETE FROM quotes WHERE lead_id = ANY($1::uuid[])`, [leadIds]);
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
  if (await tableExists(client, "lead_meters")) {
    await runDel("lead_meters", `DELETE FROM lead_meters WHERE lead_id = ANY($1::uuid[])`, [leadIds]);
  }
  await runDel("lead_stage_history", `DELETE FROM lead_stage_history WHERE lead_id = ANY($1::uuid[])`, [leadIds]);

  // Adresses uniquement pointées par ces leads et non utilisées ailleurs
  const addrRes = await client.query(
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

  if (opts.purgeAudit) {
    const allEntityIds = [
      ...new Set([
        ...leadIds,
        ...quoteIds,
        ...studyIds,
        ...versionIds,
        ...invoiceIds,
        ...creditNoteIds,
        ...paymentIds,
      ]),
    ];
    await client.query(`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete`);
    try {
      await runDel(
        "audit_logs (entités liées)",
        `DELETE FROM audit_logs
         WHERE entity_id = ANY($1::uuid[])
           AND entity_type IN (
             'lead','quote','study','study_version','invoice','credit_note',
             'calpinage','document','entity_document','payment'
           )`,
        [allEntityIds]
      );
    } finally {
      await client.query(`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete`);
    }
  }

  await runDel("leads", `DELETE FROM leads WHERE id = ANY($1::uuid[])`, [leadIds]);

  return stats;
}

async function postVerify(client, leadIds) {
  if (leadIds.length === 0) return;
  const checks = [
    ["leads restants", `SELECT count(*)::int AS n FROM leads WHERE id = ANY($1::uuid[])`, [leadIds]],
    ["quotes lead_id", `SELECT count(*)::int AS n FROM quotes WHERE lead_id = ANY($1::uuid[])`, [leadIds]],
    ["studies lead_id", `SELECT count(*)::int AS n FROM studies WHERE lead_id = ANY($1::uuid[])`, [leadIds]],
    ["invoices lead_id", `SELECT count(*)::int AS n FROM invoices WHERE lead_id = ANY($1::uuid[])`, [leadIds]],
  ];
  console.log("\n[verify] Contrôles post-suppression :");
  for (const [label, sql, params] of checks) {
    const r = await client.query(sql, params);
    console.log(`  ${label}: ${r.rows[0].n} (attendu 0)`);
  }
}

async function main() {
  const { dryRun, force, purgeAudit, name, org, ids: rawIds } = parseArgs(process.argv.slice(2));

  if (!name && rawIds.length === 0) {
    console.error(
      "Usage: node scripts/delete-leads-hard.mjs --dry-run|--force --name=\"…\" | --ids=uuid1,uuid2 [--org=uuid] [--purge-audit]"
    );
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    let leadRows = [];
    if (rawIds.length) {
      for (const id of rawIds) assertUuid(id, "lead id");
      const r = await client.query(
        `SELECT id, organization_id, full_name, company_name, email, address, created_at
         FROM leads WHERE id = ANY($1::uuid[])`,
        [rawIds]
      );
      leadRows = r.rows;
      if (leadRows.length !== rawIds.length) {
        const found = new Set(leadRows.map((x) => x.id));
        const missing = rawIds.filter((id) => !found.has(id));
        console.warn("[warn] IDs non trouvés en base :", missing.join(", "));
      }
    } else {
      leadRows = await resolveLeadIdsByName(client, name, org);
    }

    if (leadRows.length === 0) {
      console.log("[delete-leads-hard] Aucun lead ciblé. Arrêt.");
      return;
    }

    console.log(`\n[delete-leads-hard] ${leadRows.length} lead(s) ciblé(s) :\n`);
    for (const r of leadRows) {
      console.log(
        `  • ${r.id} | org=${r.organization_id} | ${r.full_name || r.company_name || "(sans nom)"} | ${r.email || "-"} | créé ${r.created_at}`
      );
      if (r.address) console.log(`      adresse texte: ${String(r.address).slice(0, 120)}${String(r.address).length > 120 ? "…" : ""}`);
    }

    const leadIds = leadRows.map((r) => r.id);

    console.log("\n[delete-leads-hard] Prévisualisation des volumes :\n");
    await previewCounts(client, leadIds);

    if (dryRun) {
      console.log("\n[delete-leads-hard] --dry-run : aucune écriture. Ajoutez --force pour supprimer sans invite.");
      return;
    }

    if (!force) {
      const rl = readline.createInterface({ input, output });
      const ans = await rl.question(
        "\nTaper OUI pour confirmer la suppression définitive (sinon annuler) : "
      );
      await rl.close();
      if (String(ans).trim() !== "OUI") {
        console.log("Annulé.");
        return;
      }
    }

    console.log("\n[delete-leads-hard] Transaction BEGIN…");
    await client.query("BEGIN");
    try {
      await hardDeleteLeadsTx(client, leadIds, { purgeAudit });
      await client.query("COMMIT");
      console.log("\n[delete-leads-hard] COMMIT OK.");
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("\n[delete-leads-hard] ROLLBACK :", e.message);
      throw e;
    }

    for (const id of leadIds) {
      try {
        deleteCalpinage(id);
        console.log(`  [fs] calpinage JSON supprimé pour ${id}`);
      } catch (e) {
        console.warn(`  [fs] calpinage ${id}:`, e.message);
      }
    }

    await postVerify(client, leadIds);
  } finally {
    client.release();
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
