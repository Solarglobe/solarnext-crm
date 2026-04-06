/**
 * Diagnostic CSV consommation — entity_documents (lead puis study).
 * Usage: node backend/scripts/debug-consumption-csv.js --org <uuid> --lead <uuid> --study <uuid>
 * Affiche les 20 derniers docs de l'org, les candidats CSV lead/study, et le WINNER ou NONE.
 */

import fs from "fs";
import { pool } from "../config/db.js";
import { getAbsolutePath } from "../services/localStorage.service.js";

function parseArgs() {
  const args = process.argv.slice(2);
  let orgId = null;
  let leadId = null;
  let studyId = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--org" && args[i + 1]) orgId = args[++i].trim();
    else if (args[i] === "--lead" && args[i + 1]) leadId = args[++i].trim();
    else if (args[i] === "--study" && args[i + 1]) studyId = args[++i].trim();
  }
  return { orgId, leadId, studyId };
}

async function main() {
  const { orgId, leadId, studyId } = parseArgs();
  if (!orgId) {
    console.error("Usage: node backend/scripts/debug-consumption-csv.js --org <uuid> [--lead <uuid>] [--study <uuid>]");
    process.exit(1);
  }

  console.log("=== DEBUG CONSUMPTION CSV ===\n");
  console.log("organizationId:", orgId);
  console.log("leadId:", leadId ?? "(non fourni)");
  console.log("studyId:", studyId ?? "(non fourni)\n");

  // 20 derniers entity_documents de l'org
  const recent = await pool.query(
    `SELECT id, created_at, document_type, entity_type, entity_id, file_name, storage_key, archived_at
     FROM entity_documents
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [orgId]
  );

  console.log("--- 20 derniers entity_documents (org) ---");
  if (recent.rows.length === 0) {
    console.log("(aucun document)");
  } else {
    for (const r of recent.rows) {
      console.log({
        id: r.id,
        created_at: r.created_at,
        document_type: r.document_type ?? "(null)",
        entity_type: r.entity_type,
        entity_id: r.entity_id,
        file_name: r.file_name,
        storage_key: r.storage_key ? r.storage_key.slice(0, 60) + "…" : "(null)",
        archived_at: r.archived_at ?? "(null)",
      });
    }
  }
  console.log("");

  const isCsvDoc = (row) => {
    if (row.document_type === "consumption_csv") return { score: 2, reason: "document_type=consumption_csv" };
    const fn = (row.file_name || "").toLowerCase();
    if (fn.endsWith(".csv")) return { score: 1, reason: "file_name ends with .csv" };
    return null;
  };

  let winner = null;
  let winnerScope = null;

  // Candidats LEAD
  if (leadId) {
    console.log("--- Candidats CSV LEAD (entity_type=lead, entity_id=leadId) ---");
    const leadDocs = await pool.query(
      `SELECT id, created_at, document_type, entity_type, entity_id, file_name, storage_key, archived_at
       FROM entity_documents
       WHERE organization_id = $1 AND entity_type = 'lead' AND entity_id = $2
       ORDER BY created_at DESC`,
      [orgId, leadId]
    );
    for (const row of leadDocs.rows) {
      if (row.archived_at != null) {
        console.log({ scope: "lead", docId: row.id, reason: "archived_at non null", archived_at: row.archived_at });
        continue;
      }
      const csvInfo = isCsvDoc(row);
      if (!csvInfo) {
        console.log({ scope: "lead", docId: row.id, reason: "ni consumption_csv ni .csv", document_type: row.document_type, file_name: row.file_name });
        continue;
      }
      const absPath = row.storage_key ? getAbsolutePath(row.storage_key) : null;
      const exists = absPath ? fs.existsSync(absPath) : false;
      console.log({
        scope: "lead",
        docId: row.id,
        document_type: row.document_type,
        file_name: row.file_name,
        storage_key: row.storage_key ? row.storage_key.slice(0, 50) + "…" : null,
        exists,
        score: csvInfo.score,
        reason: csvInfo.reason,
      });
      if (exists && row.storage_key && !winner) {
        winner = absPath;
        winnerScope = "lead";
      }
    }
    if (leadDocs.rows.length === 0) console.log("(aucun document lead)");
    console.log("");
  }

  // Candidats STUDY (fallback)
  if (studyId && !winner) {
    console.log("--- Candidats CSV STUDY (entity_type=study, entity_id=studyId) ---");
    const studyDocs = await pool.query(
      `SELECT id, created_at, document_type, entity_type, entity_id, file_name, storage_key, archived_at
       FROM entity_documents
       WHERE organization_id = $1 AND entity_type = 'study' AND entity_id = $2
       ORDER BY created_at DESC`,
      [orgId, studyId]
    );
    for (const row of studyDocs.rows) {
      if (row.archived_at != null) {
        console.log({ scope: "study", docId: row.id, reason: "archived_at non null", archived_at: row.archived_at });
        continue;
      }
      const csvInfo = isCsvDoc(row);
      if (!csvInfo) {
        console.log({ scope: "study", docId: row.id, reason: "ni consumption_csv ni .csv", document_type: row.document_type, file_name: row.file_name });
        continue;
      }
      const absPath = row.storage_key ? getAbsolutePath(row.storage_key) : null;
      const exists = absPath ? fs.existsSync(absPath) : false;
      console.log({
        scope: "study",
        docId: row.id,
        document_type: row.document_type,
        file_name: row.file_name,
        storage_key: row.storage_key ? row.storage_key.slice(0, 50) + "…" : null,
        exists,
        score: csvInfo.score,
        reason: csvInfo.reason,
      });
      if (exists && row.storage_key && !winner) {
        winner = absPath;
        winnerScope = "study";
      }
    }
    if (studyDocs.rows.length === 0) console.log("(aucun document study)");
    console.log("");
  }

  console.log("--- Résultat ---");
  if (winner) {
    console.log("WINNER:", winnerScope, winner);
  } else {
    console.log("NONE");
    if (!leadId && !studyId) console.log("Raison: --lead et --study non fournis.");
    else console.log("Raison possible: aucun doc non archivé avec document_type=consumption_csv ou file_name en .csv, ou storage_key absent, ou fichier manquant sur disque.");
  }

  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
