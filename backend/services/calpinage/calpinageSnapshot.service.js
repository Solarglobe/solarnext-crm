/**
 * CP-SNAPSHOT — Service snapshots versionnés du calpinage (transactionnel, immuable).
 * Ne modifie pas calpinage_data ni buildFinalCalpinageJSON.
 */

import { pool } from "../../config/db.js";
import { withTx } from "../../db/tx.js";

export const ERROR_CODES = {
  NO_CALPINAGE_DATA: "NO_CALPINAGE_DATA",
  CALPINAGE_INCOMPLETE: "CALPINAGE_INCOMPLETE",
  SHADING_NOT_COMPUTED: "SHADING_NOT_COMPUTED",
  SNAPSHOT_TOO_RECENT: "SNAPSHOT_TOO_RECENT",
  CALPINAGE_INVALID_JSON: "CALPINAGE_INVALID_JSON",
};

function hasGps(geometryJson) {
  const gps = geometryJson?.roofState?.gps ?? geometryJson?.gps;
  return gps && typeof gps.lat === "number" && typeof gps.lon === "number";
}

function hasValidatedRoofData(geometryJson) {
  const vrd = geometryJson?.validatedRoofData;
  return vrd && typeof vrd === "object" && Array.isArray(vrd.pans);
}

function hasPvParams(geometryJson) {
  const pv = geometryJson?.pvParams;
  return pv && typeof pv === "object";
}

function hasFrozenBlocks(geometryJson) {
  const blocks = geometryJson?.frozenBlocks;
  return Array.isArray(blocks);
}

/**
 * Ombrage « calculé » au sens snapshot : soit legacy (normalized / KPIs numériques),
 * soit enveloppe V2 complète (near/far/combined/shadingQuality) telle que sortie
 * normalizeCalpinageShading — y compris lorsque combined.totalLossPct est null
 * (GPS manquant, masque indisponible : KPI non chiffrable mais pipeline exécuté).
 */
export function hasShadingNormalized(geometryJson) {
  const shading = geometryJson?.shading;
  if (!shading || typeof shading !== "object") return false;
  if (shading.normalized != null) return true;
  if (typeof shading.totalLossPct === "number") return true;
  if (shading.combined && typeof shading.combined.totalLossPct === "number") return true;
  // V2 : présence de l'enveloppe produit même si les pertes globales sont null
  if (
    shading.near &&
    typeof shading.near === "object" &&
    shading.far &&
    typeof shading.far === "object" &&
    shading.combined &&
    typeof shading.combined === "object" &&
    Object.prototype.hasOwnProperty.call(shading.combined, "totalLossPct") &&
    shading.shadingQuality &&
    typeof shading.shadingQuality === "object"
  ) {
    return true;
  }
  return false;
}

/**
 * Crée un snapshot versionné du calpinage (transaction complète).
 *
 * @param {string} studyId - UUID de l'étude
 * @param {string} studyVersionId - UUID de la version (study_versions.id)
 * @param {string} organizationId - UUID de l'organisation
 * @param {string|null} userId - UUID de l'utilisateur (optionnel)
 * @param {{ geometryJson?: object }} [options] - Si `geometryJson` est fourni (ex. validate après COMMIT du calpinage),
 *   le snapshot versionné est construit **uniquement** à partir de cet objet — **aucune** lecture de
 *   `calpinage_data.geometry_json` pour le contenu géométrique (évite un drift post-commit).
 *   Sinon : comportement historique (SELECT `geometry_json` en base).
 * @returns {Promise<{ snapshotId: string, version_number: number }>}
 */
export async function createCalpinageSnapshot(studyId, studyVersionId, organizationId, userId = null, options = {}) {
  const err = (code, message) => {
    const e = new Error(message);
    e.code = code;
    return e;
  };

  try {
    return await withTx(pool, async (client) => {
      // 1) BEGIN (déjà fait par withTx) — premier accès DB = lock pessimiste
      const studyLock = await client.query(
        `SELECT id FROM studies WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [studyId, organizationId]
      );
      if (studyLock.rows.length === 0) {
        throw err("NOT_FOUND", "Étude non trouvée");
      }

      // 2) Anti double-clic : dernier snapshot (actif ou non), créé il y a < 2 s → bloquer (ne pas tester is_active)
      const lastRes = await client.query(
        `SELECT created_at FROM calpinage_snapshots WHERE study_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [studyId]
      );
      if (lastRes.rows.length > 0) {
        const lastCreated = lastRes.rows[0].created_at;
        const recentCheck = await client.query(
          `SELECT (NOW() - $1::timestamptz) < INTERVAL '2 seconds' AS too_recent`,
          [lastCreated]
        );
        if (recentCheck.rows[0]?.too_recent === true) {
          console.warn("[calpinageSnapshot] Snapshot blocked (too recent)");
          throw err(ERROR_CODES.SNAPSHOT_TOO_RECENT, "Un snapshot a déjà été créé à l'instant. Veuillez patienter.");
        }
      }

      // 3) Vérifier que study_version existe et appartient à organizationId + studyId
      const versionRes = await client.query(
        `SELECT id, study_id FROM study_versions WHERE id = $1 AND organization_id = $2`,
        [studyVersionId, organizationId]
      );
      if (versionRes.rows.length === 0) {
        throw err("NOT_FOUND", "Étude ou version non trouvée");
      }
      if (versionRes.rows[0].study_id !== studyId) {
        throw err("MISMATCH", "studyVersionId ne correspond pas à studyId");
      }

      // 4) geometry_json : soit fourni (validate — aligné sur l’état persisté sans relire le JSON en base), soit SELECT historique
      const geometryJsonOverride = options?.geometryJson;
      let geometryJson;
      if (geometryJsonOverride != null && typeof geometryJsonOverride === "object") {
        geometryJson = geometryJsonOverride;
      } else {
        const calpinageRes = await client.query(
          `SELECT geometry_json FROM calpinage_data
           WHERE study_version_id = $1 AND organization_id = $2`,
          [studyVersionId, organizationId]
        );
        if (calpinageRes.rows.length === 0 || calpinageRes.rows[0].geometry_json == null) {
          throw err(ERROR_CODES.NO_CALPINAGE_DATA, "Calpinage non enregistré pour cette version");
        }

        geometryJson = calpinageRes.rows[0].geometry_json;
        if (geometryJson != null && typeof geometryJson === "string") {
          try {
            geometryJson = JSON.parse(geometryJson);
          } catch {
            throw err(ERROR_CODES.CALPINAGE_INVALID_JSON, "geometry_json invalide (JSON non parsable)");
          }
        }
        if (!geometryJson || typeof geometryJson !== "object") {
          throw err(ERROR_CODES.NO_CALPINAGE_DATA, "Calpinage non enregistré pour cette version");
        }
      }

      // 5) Vérifier structure minimale
      if (!hasGps(geometryJson) || !hasValidatedRoofData(geometryJson) || !hasPvParams(geometryJson) || !hasFrozenBlocks(geometryJson)) {
        throw err(ERROR_CODES.CALPINAGE_INCOMPLETE, "Données calpinage incomplètes (gps, validatedRoofData, pvParams ou frozenBlocks manquants)");
      }

      // 6) Shading : accepté null/absent (validation sans Analyse Ombres). Rejet uniquement si shading présent mais invalide.
      if (geometryJson.shading !== null && geometryJson.shading !== undefined && !hasShadingNormalized(geometryJson)) {
        throw err(ERROR_CODES.SHADING_NOT_COMPUTED, "Ombrage non calculé (shading.normalized manquant)");
      }

      // 7) MAX(version_number) pour cette étude (unicité study_id + version_number)
      const maxRes = await client.query(
        `SELECT COALESCE(MAX(version_number), 0) AS max_version FROM calpinage_snapshots WHERE study_id = $1`,
        [studyId]
      );
      const maxVersion = maxRes.rows[0]?.max_version ?? 0;
      const nextVersionNumber = maxVersion + 1;

      // 8) Construire snapshot_json V1 — copie stricte, pas de transformation (évite 500 si geometry_json non sérialisable)
      let payloadCopy;
      try {
        payloadCopy = JSON.parse(JSON.stringify(geometryJson));
      } catch (serialErr) {
        throw err(
          ERROR_CODES.CALPINAGE_INVALID_JSON,
          "geometry_json non sérialisable (référence circulaire ou type non supporté)"
        );
      }
      const snapshotJson = {
        meta: {
          snapshotSchemaVersion: 1,
          createdAt: new Date().toISOString(),
          studyId,
          studyVersionId,
          organizationId,
          createdBy: userId ?? null,
        },
        payload: payloadCopy,
      };

      // 9) INSERT (version-scope : un snapshot par version, pas de is_active)
      const insertRes = await client.query(
        `INSERT INTO calpinage_snapshots (study_id, study_version_id, organization_id, version_number, snapshot_json, created_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         RETURNING id, version_number`,
        [studyId, studyVersionId, organizationId, nextVersionNumber, JSON.stringify(snapshotJson), userId]
      );

      const row = insertRes.rows[0];
      return {
        snapshotId: row.id,
        version_number: row.version_number,
      };
    });
  } catch (error) {
    if (error?.code !== ERROR_CODES.SNAPSHOT_TOO_RECENT) {
      console.error("[calpinageSnapshot] TX ERROR:", error);
    }
    throw error;
  }
}
