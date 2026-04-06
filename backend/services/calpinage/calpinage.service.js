/**
 * Calpinage — opérations sur calpinage_data (reset par version).
 * CP-AUDIT-004 : vérification version avant suppression.
 */

import { pool } from "../../config/db.js";

/**
 * Supprime les données calpinage pour une version (study_version_id).
 * Vérifie que la version existe et appartient à l'organisation avant suppression.
 * @throws {Error} VERSION_NOT_FOUND si la version est absente
 * @returns {Promise<number>} Nombre de lignes supprimées
 */
export async function resetCalpinageForVersion(studyVersionId, organizationId) {
  const versionRes = await pool.query(
    `SELECT id FROM study_versions WHERE id = $1 AND organization_id = $2`,
    [studyVersionId, organizationId]
  );
  if (versionRes.rows.length === 0) {
    const err = new Error("VERSION_NOT_FOUND");
    err.code = "VERSION_NOT_FOUND";
    throw err;
  }
  const res = await pool.query(
    `DELETE FROM calpinage_data
     WHERE study_version_id = $1 AND organization_id = $2`,
    [studyVersionId, organizationId]
  );
  return res.rowCount ?? 0;
}
