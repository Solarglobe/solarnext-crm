/**
 * CP-032A — Service d'archivage global (Soft Delete)
 * archiveEntity / restoreEntity — non destructif
 */

import { pool } from "../config/db.js";

const ARCHIVABLE_TABLES = [
  "leads",
  "clients",
  "studies",
  "quotes",
  "invoices",
  "calendar_events",
  "entity_documents",
];

/**
 * Archive une entité (soft delete)
 * @param {string} tableName - Nom de la table
 * @param {string} entityId - UUID de l'entité
 * @param {string} organizationId - UUID de l'organisation
 * @param {string} userId - UUID de l'utilisateur
 * @returns {Promise<object|null>} Entité archivée ou null si non trouvée
 */
export async function archiveEntity(tableName, entityId, organizationId, userId) {
  if (!ARCHIVABLE_TABLES.includes(tableName)) {
    throw new Error(`Table non archivable: ${tableName}`);
  }

  const r = await pool.query(
    `SELECT id, archived_at FROM ${tableName} WHERE id = $1 AND organization_id = $2`,
    [entityId, organizationId]
  );

  if (r.rows.length === 0) {
    return null;
  }

  if (r.rows[0].archived_at) {
    throw new Error("Entité déjà archivée");
  }

  await pool.query(
    `UPDATE ${tableName} SET archived_at = now(), archived_by = $1 WHERE id = $2 AND organization_id = $3`,
    [userId, entityId, organizationId]
  );

  const updated = await pool.query(
    `SELECT * FROM ${tableName} WHERE id = $1`,
    [entityId]
  );
  return updated.rows[0] || null;
}

/**
 * Restaure une entité archivée
 * @param {string} tableName - Nom de la table
 * @param {string} entityId - UUID de l'entité
 * @param {string} organizationId - UUID de l'organisation
 * @returns {Promise<object|null>} Entité restaurée ou null si non trouvée
 */
export async function restoreEntity(tableName, entityId, organizationId) {
  if (!ARCHIVABLE_TABLES.includes(tableName)) {
    throw new Error(`Table non archivable: ${tableName}`);
  }

  const r = await pool.query(
    `SELECT id, archived_at FROM ${tableName} WHERE id = $1 AND organization_id = $2`,
    [entityId, organizationId]
  );

  if (r.rows.length === 0) {
    return null;
  }

  // CP-AUTO-CONVERT-ARCHIVE-08 : pour leads, remettre archived=false, archived_reason=NULL
  const leadCols = tableName === "leads" ? ", archived = false, archived_reason = NULL" : "";
  await pool.query(
    `UPDATE ${tableName} SET archived_at = NULL, archived_by = NULL${leadCols} WHERE id = $1 AND organization_id = $2`,
    [entityId, organizationId]
  );

  const updated = await pool.query(
    `SELECT * FROM ${tableName} WHERE id = $1`,
    [entityId]
  );
  return updated.rows[0] || null;
}
