/**
 * Résout le chemin serveur du CSV de consommation (lead puis étude).
 * 1) Cherche sur le lead (entity_type = 'lead', entity_id = leadId)
 * 2) Si aucun trouvé, cherche sur l'étude (entity_type = 'study', entity_id = studyId)
 * Filtre : archived_at IS NULL ET (document_type = 'consumption_csv' OR LOWER(file_name) LIKE '%.csv')
 * Vérification physique : fs.existsSync(absPath). Sinon ignoré.
 * Stockage : storage_key = orgId/entityType/entityId/uuid_file.csv → isolation par entité.
 */

import fs from "fs";
import { getAbsolutePath } from "./localStorage.service.js";

const CSV_FILTER = `AND archived_at IS NULL
  AND (document_type = 'consumption_csv' OR LOWER(file_name) LIKE '%.csv')`;

/**
 * Résout le chemin du CSV de conso : d'abord sur le lead, sinon sur l'étude.
 * @param {{ db: import("pg").Pool, leadId: string, studyId: string|null, organizationId: string }}
 * @returns {Promise<string|null>} Chemin absolu du fichier CSV ou null
 */
export async function resolveConsumptionCsvPath({ db, leadId, studyId, organizationId }) {
  if (!db || !organizationId) return null;
  if (!leadId && !studyId) return null;

  const log = (source, path) => {
    console.log(JSON.stringify({
      tag: "CSV_RESOLUTION",
      leadId: leadId ?? null,
      studyId: studyId ?? null,
      source,
      path: path ?? null,
    }));
  };

  // 1) Chercher sur le lead
  if (leadId) {
    const r = await db.query(
      `SELECT storage_key FROM entity_documents
       WHERE organization_id = $1
         AND entity_type = 'lead'
         AND entity_id = $2
         ${CSV_FILTER}
       ORDER BY created_at DESC
       LIMIT 1`,
      [organizationId, leadId]
    );

    if (r.rows.length > 0) {
      const row = r.rows[0];
      if (row.storage_key) {
        try {
          const absPath = getAbsolutePath(row.storage_key);
          if (fs.existsSync(absPath)) {
            log("lead", absPath);
            return absPath;
          }
          console.warn("CSV_DOCUMENT_MISSING", row.storage_key);
        } catch (err) {
          console.warn("CSV_PATH_ERROR", err);
        }
      } else {
        console.warn("CSV_DOCUMENT_NO_STORAGE_KEY", row);
      }
    }
  }

  // 2) Si aucun trouvé, chercher sur l'étude
  if (studyId) {
    let r = await db.query(
      `SELECT storage_key FROM entity_documents
       WHERE organization_id = $1
         AND entity_type = 'study'
         AND entity_id = $2
         ${CSV_FILTER}
       ORDER BY created_at DESC
       LIMIT 1`,
      [organizationId, studyId]
    );

    if (r.rows.length > 0) {
      const row = r.rows[0];
      if (row.storage_key) {
        try {
          const absPath = getAbsolutePath(row.storage_key);
          if (fs.existsSync(absPath)) {
            log("study", absPath);
            return absPath;
          }
          console.warn("CSV_DOCUMENT_MISSING", row.storage_key);
        } catch (err) {
          console.warn("CSV_PATH_ERROR", err);
        }
      } else {
        console.warn("CSV_DOCUMENT_NO_STORAGE_KEY", row);
      }
    }
  }

  log("none", null);
  return null;
}

/**
 * @deprecated Préférer resolveConsumptionCsvPath({ db, leadId, studyId, organizationId })
 * Résout le chemin CSV uniquement sur le lead (rétrocompat scripts/tests).
 * @param {{ db: import("pg").Pool, leadId: string, organizationId: string }}
 * @returns {Promise<string|null>}
 */
export async function resolveLeadConsumptionCsvPath({ db, leadId, organizationId }) {
  return resolveConsumptionCsvPath({
    db,
    leadId: leadId ?? null,
    studyId: null,
    organizationId,
  });
}
