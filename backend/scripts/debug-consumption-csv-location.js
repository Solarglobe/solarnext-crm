/**
 * Diagnostic complet : où est stocké le CSV conso (entity_documents + autres tables).
 * Usage: node backend/scripts/debug-consumption-csv-location.js --org <uuid> --lead <uuid> --study <uuid>
 *
 * Affiche toutes les lignes candidates pour leadId et studyId, absPath, existsSync, file size,
 * LEAD_CANDIDATES_COUNT, STUDY_CANDIDATES_COUNT, WINNER ou NO_CSV_FOUND_IN_DB.
 * Interroge aussi la table "documents" (legacy) si elle existe.
 */

import "../config/register-local-env.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import fs from "fs";
const { pool } = await import("../config/db.js");
import { getAbsolutePath } from "../services/localStorage.service.js";

function parseArgs() {
  const args = process.argv.slice(2);
  let orgId = null;
  let leadId = null;
  let studyId = null;
  let auto = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--org" && args[i + 1]) orgId = args[++i].trim();
    else if (args[i] === "--lead" && args[i + 1]) leadId = args[++i].trim();
    else if (args[i] === "--study" && args[i + 1]) studyId = args[++i].trim();
    else if (args[i] === "--auto") auto = true;
  }
  return { orgId, leadId, studyId, auto };
}

function isCsvCandidate(row) {
  if (row.document_type === "consumption_csv") return true;
  const fn = (row.file_name || "").toLowerCase();
  return fn.endsWith(".csv");
}

async function main() {
  let { orgId, leadId, studyId, auto } = parseArgs();
  if (auto && !orgId) {
    const studyRow = await pool.query(
      `SELECT s.id AS study_id, s.lead_id, s.organization_id
       FROM studies s
       WHERE s.lead_id IS NOT NULL
       ORDER BY s.created_at DESC NULLS LAST
       LIMIT 1`
    );
    if (studyRow.rows.length > 0) {
      orgId = studyRow.rows[0].organization_id;
      studyId = studyRow.rows[0].study_id;
      leadId = studyRow.rows[0].lead_id;
    } else {
      const orgRow = await pool.query("SELECT id FROM organizations LIMIT 1");
      if (orgRow.rows.length === 0) {
        console.error("Aucune organisation trouvée en base.");
        process.exit(1);
      }
      orgId = orgRow.rows[0].id;
      const leadRow = await pool.query(
        "SELECT id FROM leads WHERE organization_id = $1 LIMIT 1",
        [orgId]
      );
      if (leadRow.rows.length > 0) leadId = leadRow.rows[0].id;
    }
    console.log("(--auto) orgId=" + orgId + " leadId=" + (leadId ?? "null") + " studyId=" + (studyId ?? "null") + "\n");
  }
  if (!orgId) {
    console.error("Usage: node backend/scripts/debug-consumption-csv-location.js --org <uuid> [--lead <uuid>] [--study <uuid>] | --auto");
    process.exit(1);
  }

  console.log("=== DEBUG CONSUMPTION CSV LOCATION ===\n");
  console.log("organizationId:", orgId);
  console.log("leadId:", leadId ?? "(non fourni)");
  console.log("studyId:", studyId ?? "(non fourni)\n");

  const leadRows = [];
  const studyRows = [];

  if (leadId) {
    const r = await pool.query(
      `SELECT id, entity_type, entity_id, document_type, storage_key, file_name, created_at, archived_at
       FROM entity_documents
       WHERE organization_id = $1 AND entity_type = 'lead' AND entity_id = $2
       ORDER BY created_at DESC`,
      [orgId, leadId]
    );
    leadRows.push(...r.rows);
  }

  if (studyId) {
    const r = await pool.query(
      `SELECT id, entity_type, entity_id, document_type, storage_key, file_name, created_at, archived_at
       FROM entity_documents
       WHERE organization_id = $1 AND entity_type = 'study' AND entity_id = $2
       ORDER BY created_at DESC`,
      [orgId, studyId]
    );
    studyRows.push(...r.rows);
  }

  const leadCandidates = leadRows.filter((row) => !row.archived_at && isCsvCandidate(row));
  const studyCandidates = studyRows.filter((row) => !row.archived_at && isCsvCandidate(row));

  console.log("--- entity_documents (lead) ---");
  for (const row of leadRows) {
    let absPath = null;
    let exists = false;
    let fileSize = null;
    try {
      if (row.storage_key) {
        absPath = getAbsolutePath(row.storage_key);
        exists = fs.existsSync(absPath);
        if (exists) fileSize = fs.statSync(absPath).size;
      }
    } catch (err) {
      absPath = "(error: " + err.message + ")";
    }
    console.log(JSON.stringify({
      id: row.id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      document_type: row.document_type ?? "(null)",
      storage_key: row.storage_key ? row.storage_key.slice(0, 70) + (row.storage_key.length > 70 ? "…" : "") : "(null)",
      original_name: row.file_name ?? "(null)",
      created_at: row.created_at,
      archived_at: row.archived_at ?? "(null)",
      absPath: absPath && typeof absPath === "string" ? absPath.slice(0, 80) + "…" : absPath,
      existsSync: exists,
      file_size_bytes: fileSize,
      is_csv_candidate: !row.archived_at && isCsvCandidate(row),
    }));
  }
  if (leadRows.length === 0) console.log("(aucune ligne)");
  console.log("");

  console.log("--- entity_documents (study) ---");
  for (const row of studyRows) {
    let absPath = null;
    let exists = false;
    let fileSize = null;
    try {
      if (row.storage_key) {
        absPath = getAbsolutePath(row.storage_key);
        exists = fs.existsSync(absPath);
        if (exists) fileSize = fs.statSync(absPath).size;
      }
    } catch (err) {
      absPath = "(error: " + err.message + ")";
    }
    console.log(JSON.stringify({
      id: row.id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      document_type: row.document_type ?? "(null)",
      storage_key: row.storage_key ? row.storage_key.slice(0, 70) + (row.storage_key.length > 70 ? "…" : "") : "(null)",
      original_name: row.file_name ?? "(null)",
      created_at: row.created_at,
      archived_at: row.archived_at ?? "(null)",
      absPath: absPath && typeof absPath === "string" ? absPath.slice(0, 80) + "…" : absPath,
      existsSync: exists,
      file_size_bytes: fileSize,
      is_csv_candidate: !row.archived_at && isCsvCandidate(row),
    }));
  }
  if (studyRows.length === 0) console.log("(aucune ligne)");
  console.log("");

  console.log("LEAD_CANDIDATES_COUNT", leadCandidates.length);
  console.log("STUDY_CANDIDATES_COUNT", studyCandidates.length);

  // WINNER: first valid (storage_key present + file exists) in order lead then study, most recent first
  let winner = null;
  let winnerScope = null;
  for (const row of leadCandidates) {
    if (!row.storage_key) continue;
    try {
      const absPath = getAbsolutePath(row.storage_key);
      if (fs.existsSync(absPath)) {
        winner = absPath;
        winnerScope = "lead";
        break;
      }
    } catch (_) {}
  }
  if (!winner && studyCandidates.length > 0) {
    for (const row of studyCandidates) {
      if (!row.storage_key) continue;
      try {
        const absPath = getAbsolutePath(row.storage_key);
        if (fs.existsSync(absPath)) {
          winner = absPath;
          winnerScope = "study";
          break;
        }
      } catch (_) {}
    }
  }

  if (winner) {
    console.log("WINNER", winnerScope, winner);
  } else {
    console.log("NO_CSV_FOUND_IN_DB");
    if (leadRows.length === 0 && studyRows.length === 0) {
      console.log("(Raison: aucune ligne entity_documents pour ce lead/study dans cette org)");
    } else if (leadCandidates.length === 0 && studyCandidates.length === 0) {
      console.log("(Raison: pas de document CSV candidat non archivé avec document_type=consumption_csv ou file_name en .csv)");
    } else {
      console.log("(Raison: candidats présents mais storage_key absent ou fichier manquant sur disque)");
    }
  }

  // Autres tables éventuelles (documents legacy)
  console.log("\n--- Autres tables (documents, etc.) ---");
  try {
    const docTable = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'documents'
      ORDER BY ordinal_position
    `);
    if (docTable.rows.length > 0) {
      const cols = docTable.rows.map((r) => r.column_name).join(", ");
      const docRows = await pool.query(
        `SELECT id, study_version_id, client_id, document_type, file_name, file_url, file_path, created_at
         FROM documents
         WHERE organization_id = $1
         AND (document_type::text ILIKE '%csv%' OR document_type = 'consumption_csv' OR file_name ILIKE '%.csv')
         ORDER BY created_at DESC
         LIMIT 10`,
        [orgId]
      );
      console.log("Table 'documents' existe. Colonnes:", cols);
      if (docRows.rows.length > 0) {
        console.log("Lignes potentiellement CSV (max 10):", JSON.stringify(docRows.rows, null, 2));
      } else {
        console.log("(aucune ligne CSV trouvée dans documents pour cette org)");
      }
    } else {
      console.log("(table 'documents' absente)");
    }
  } catch (e) {
    console.log("(erreur lecture table documents:", e.message, ")");
  }

  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
