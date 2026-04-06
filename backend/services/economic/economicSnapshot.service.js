/**
 * economic_snapshots — Version-scope uniquement.
 * Un snapshot par study_version_id. Plus de is_active ni de logique "actif par étude".
 */

import { pool } from "../../config/db.js";
import { withTx } from "../../db/tx.js";

export const ERROR_CODES = {
  NO_CALPINAGE_SNAPSHOT: "NO_CALPINAGE_SNAPSHOT",
  NOT_DRAFT: "NOT_DRAFT",
};

/**
 * Supprime tous les economic_snapshots pour une version (reset devis technique).
 * CP-AUDIT-004 : vérification version avant suppression.
 * @throws {Error} VERSION_NOT_FOUND si la version est absente
 * @returns {Promise<number>} Nombre de lignes supprimées
 */
export async function resetQuoteForVersion(studyVersionId, organizationId) {
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
    `DELETE FROM economic_snapshots
     WHERE study_version_id = $1 AND organization_id = $2`,
    [studyVersionId, organizationId]
  );
  return res.rowCount ?? 0;
}

/**
 * Récupère l'economic snapshot pour une version (study_version_id).
 * @returns {Promise<{ id: string, version_number: number, status: string, config_json: object } | null>}
 */
export async function getEconomicSnapshotForVersion(studyVersionId, organizationId) {
  const res = await pool.query(
    `SELECT id, study_version_id, version_number, status, config_json
     FROM economic_snapshots
     WHERE study_version_id = $1 AND organization_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [studyVersionId, organizationId]
  );
  return res.rows[0] ?? null;
}

/**
 * Crée un economic snapshot pour une version (config vide).
 * @returns {{ snapshotId: string, version_number: number, status: string }}
 */
export async function createEconomicSnapshotForVersion({
  studyId,
  studyVersionId,
  organizationId,
  userId = null,
  config = {},
}) {
  const configStr = typeof config === "object" && config !== null ? JSON.stringify(config) : "{}";
  const maxRes = await pool.query(
    `SELECT COALESCE(MAX(version_number), 0) AS max_version FROM economic_snapshots WHERE study_id = $1`,
    [studyId]
  );
  const nextVersion = (maxRes.rows[0]?.max_version ?? 0) + 1;
  const insertRes = await pool.query(
    `INSERT INTO economic_snapshots (study_id, study_version_id, organization_id, version_number, status, config_json, created_by)
     VALUES ($1, $2, $3, $4, 'DRAFT', $5::jsonb, $6)
     RETURNING id, version_number, status`,
    [studyId, studyVersionId, organizationId, nextVersion, configStr, userId]
  );
  const row = insertRes.rows[0];
  return {
    snapshotId: row.id,
    version_number: row.version_number,
    status: row.status || "DRAFT",
  };
}

/**
 * createOrUpdateEconomicSnapshot — Version-scope : un snapshot par study_version_id.
 * Si un snapshot existe pour cette version → UPDATE (si DRAFT). Sinon INSERT.
 * @returns {{ snapshotId: string, version_number: number, status: string }}
 */
export async function createOrUpdateEconomicSnapshot({
  studyId,
  studyVersionId,
  organizationId,
  userId = null,
  config,
}) {
  const err = (code, message) => {
    const e = new Error(message);
    e.code = code;
    return e;
  };

  const configPayload = config != null && typeof config === "object" ? config : {};
  const configStr = JSON.stringify(configPayload);

  return withTx(pool, async (client) => {
    const versionRes = await client.query(
      `SELECT id, study_id FROM study_versions WHERE id = $1 AND organization_id = $2`,
      [studyVersionId, organizationId]
    );
    if (versionRes.rows.length === 0) {
      throw err("NOT_FOUND", "Étude ou version non trouvée");
    }
    if (versionRes.rows[0].study_id !== studyId) {
      throw err("NOT_FOUND", "studyVersionId ne correspond pas à studyId");
    }

    const existingRes = await client.query(
      `SELECT id, version_number, status FROM economic_snapshots
       WHERE study_version_id = $1 AND organization_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [studyVersionId, organizationId]
    );

    if (existingRes.rows.length > 0) {
      const row = existingRes.rows[0];
      if (row.status !== "DRAFT") {
        throw err(ERROR_CODES.NOT_DRAFT, "Modification interdite : le snapshot n'est pas en brouillon");
      }
      await client.query(
        `UPDATE economic_snapshots SET config_json = $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [configStr, row.id]
      );
      return {
        snapshotId: row.id,
        version_number: row.version_number,
        status: "DRAFT",
      };
    }

    const maxRes = await client.query(
      `SELECT COALESCE(MAX(version_number), 0) AS max_version FROM economic_snapshots WHERE study_id = $1`,
      [studyId]
    );
    const nextVersion = (maxRes.rows[0]?.max_version ?? 0) + 1;
    const insertRes = await client.query(
      `INSERT INTO economic_snapshots (study_id, study_version_id, organization_id, version_number, status, config_json, created_by)
       VALUES ($1, $2, $3, $4, 'DRAFT', $5::jsonb, $6)
       RETURNING id, version_number, status`,
      [studyId, studyVersionId, organizationId, nextVersion, configStr, userId]
    );
    const newRow = insertRes.rows[0];
    return {
      snapshotId: newRow.id,
      version_number: newRow.version_number,
      status: newRow.status || "DRAFT",
    };
  });
}

/**
 * Valide la préparation : passe le snapshot de cette version (DRAFT) en READY_FOR_STUDY.
 * Version-scope : on cible le snapshot dont study_version_id = versionId.
 */
export async function validateQuotePrep({
  studyId,
  versionId,
  organizationId,
  userId = null,
}) {
  const err = (code, message) => {
    const e = new Error(message);
    e.code = code;
    return e;
  };

  return withTx(pool, async (client) => {
    const studyLock = await client.query(
      `SELECT id FROM studies WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [studyId, organizationId]
    );
    if (studyLock.rows.length === 0) throw err("NOT_FOUND", "Étude non trouvée");

    const versionRes = await client.query(
      `SELECT id FROM study_versions WHERE id = $1 AND study_id = $2 AND organization_id = $3`,
      [versionId, studyId, organizationId]
    );
    if (versionRes.rows.length === 0) throw err("NOT_FOUND", "Version non trouvée");

    const snapshotRes = await client.query(
      `SELECT id, version_number, status FROM economic_snapshots
       WHERE study_version_id = $1 AND organization_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [versionId, organizationId]
    );
    if (snapshotRes.rows.length === 0) {
      throw err("NOT_FOUND", "Aucun snapshot économique pour cette version à valider");
    }
    const row = snapshotRes.rows[0];
    if (row.status !== "DRAFT") {
      throw err(ERROR_CODES.NOT_DRAFT, "Seul un brouillon peut être validé");
    }

    await client.query(
      `UPDATE economic_snapshots SET status = 'READY_FOR_STUDY', updated_at = NOW() WHERE id = $1`,
      [row.id]
    );
    return {
      snapshotId: row.id,
      version_number: row.version_number,
      status: "READY_FOR_STUDY",
    };
  });
}

/**
 * Fork : crée un nouveau snapshot DRAFT pour la même version (config copiée depuis le snapshot validé).
 * Plusieurs snapshots peuvent exister par study_version_id ; on lit le dernier (ORDER BY created_at DESC).
 */
export async function forkQuotePrep({
  studyId,
  versionId,
  organizationId,
  userId = null,
}) {
  const err = (code, message) => {
    const e = new Error(message);
    e.code = code;
    return e;
  };

  return withTx(pool, async (client) => {
    const versionRes = await client.query(
      `SELECT id FROM study_versions WHERE id = $1 AND study_id = $2 AND organization_id = $3`,
      [versionId, studyId, organizationId]
    );
    if (versionRes.rows.length === 0) throw err("NOT_FOUND", "Version non trouvée");

    const snapshotRes = await client.query(
      `SELECT id, version_number, status, config_json FROM economic_snapshots
       WHERE study_version_id = $1 AND organization_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [versionId, organizationId]
    );
    if (snapshotRes.rows.length === 0) throw err("NOT_FOUND", "Aucun snapshot économique pour cette version");
    const row = snapshotRes.rows[0];
    if (row.status !== "READY_FOR_STUDY") {
      throw err("NOT_READY", "Créer une nouvelle version possible uniquement sur un snapshot validé (READY_FOR_STUDY)");
    }

    const maxRes = await client.query(
      `SELECT COALESCE(MAX(version_number), 0) AS max_version FROM economic_snapshots WHERE study_id = $1`,
      [studyId]
    );
    const nextVersion = (maxRes.rows[0]?.max_version ?? 0) + 1;
    const configStr =
      row.config_json != null && typeof row.config_json === "object"
        ? JSON.stringify(row.config_json)
        : "{}";
    const insertRes = await client.query(
      `INSERT INTO economic_snapshots (study_id, study_version_id, organization_id, version_number, status, config_json, created_by)
       VALUES ($1, $2, $3, $4, 'DRAFT', $5::jsonb, $6)
       RETURNING id, version_number, status`,
      [studyId, versionId, organizationId, nextVersion, configStr, userId]
    );
    const newRow = insertRes.rows[0];
    return {
      snapshotId: newRow.id,
      version_number: newRow.version_number,
      status: newRow.status || "DRAFT",
    };
  });
}
