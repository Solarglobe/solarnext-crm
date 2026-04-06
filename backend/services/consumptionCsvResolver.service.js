/**
 * Résolution du CSV de consommation pour le calcul.
 * Règle : si un CSV existe pour le lead (ou study en fallback), le calcul DOIT l'utiliser en priorité.
 * Source : entity_documents (backend uniquement, pas form.conso.csv_path frontend).
 */

import fs from "fs";
import { getAbsolutePath } from "./localStorage.service.js";

const CSV_FILTER = `AND (archived_at IS NULL)
  AND (document_type = 'consumption_csv' OR LOWER(file_name) LIKE '%.csv')`;

/**
 * Résout le CSV de conso : d'abord lead, puis study. Retourne le premier doc valide (fichier présent sur disque).
 * @param {{ db: import("pg").Pool, organizationId: string, leadId: string|null, studyId: string|null }}
 * @returns {Promise<{ csvPath: string|null, docId: string|null, reason: string }>}
 */
export async function resolveConsumptionCsv({ db, organizationId, leadId, studyId }) {
  const orgId = organizationId != null ? String(organizationId).trim() : null;
  const leadIdStr = leadId != null ? String(leadId).trim() : null;
  const studyIdStr = studyId != null ? String(studyId).trim() : null;

  // Log temporaire (tag unique pour retrait facile)
  console.log(JSON.stringify({
    tag: "CSV_RESOLVE_START",
    orgId: orgId ?? null,
    leadId: leadIdStr ?? null,
    studyId: studyIdStr ?? null,
  }));

  if (!db || !orgId || (!leadIdStr && !studyIdStr)) {
    console.log(JSON.stringify({ tag: "CSV_RESOLVE_NONE", reason: "missing_org_or_entity_ids" }));
    return { csvPath: null, docId: null, reason: "missing_org_or_entity_ids" };
  }

  const tryCandidates = async (scope, entityId) => {
    const sql = `SELECT id, storage_key, file_name, document_type, created_at
      FROM entity_documents
      WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 ${CSV_FILTER}
      ORDER BY (CASE WHEN document_type = 'consumption_csv' THEN 0 ELSE 1 END), created_at DESC`;
    const r = await db.query(sql, [orgId, scope, entityId]);
    for (const row of r.rows) {
      const storage_key = row.storage_key;
      if (!storage_key) {
        console.warn("CSV_DOCUMENT_NO_STORAGE_KEY", { scope, docId: row.id, file_name: row.file_name });
        continue;
      }
      let absPath = null;
      let exists = false;
      try {
        absPath = getAbsolutePath(storage_key);
        exists = fs.existsSync(absPath);
      } catch (err) {
        // path invalide
      }
      if (!exists) {
        console.warn("CSV_FILE_MISSING", { scope, docId: row.id, storage_key: storage_key.slice(0, 80) });
        continue;
      }
      console.log(JSON.stringify({
        tag: "CSV_RESOLVE_CANDIDATE",
        scope,
        docId: row.id,
        document_type: row.document_type ?? null,
        file_name: row.file_name ?? null,
        storage_key: storage_key.slice(0, 80),
        exists,
      }));
      return { csvPath: absPath, docId: row.id, scope };
    }
    return null;
  };

  if (leadIdStr) {
    const result = await tryCandidates("lead", leadIdStr);
    if (result) {
      console.log(JSON.stringify({
        tag: "CSV_RESOLVE_WINNER",
        scope: result.scope,
        docId: result.docId,
        absPath: result.csvPath,
      }));
      return { csvPath: result.csvPath, docId: result.docId, reason: `lead:${result.docId}` };
    }
  }

  if (studyIdStr) {
    const result = await tryCandidates("study", studyIdStr);
    if (result) {
      console.log(JSON.stringify({
        tag: "CSV_RESOLVE_WINNER",
        scope: result.scope,
        docId: result.docId,
        absPath: result.csvPath,
      }));
      return { csvPath: result.csvPath, docId: result.docId, reason: `study:${result.docId}` };
    }
  }

  console.log(JSON.stringify({ tag: "CSV_RESOLVE_NONE", reason: "no_valid_document" }));
  return { csvPath: null, docId: null, reason: "no_valid_document" };
}
