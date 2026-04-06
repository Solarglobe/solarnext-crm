/**
 * Empreinte géométrique du plan calpinage (visuel) — exclut layout_snapshot, shading, métadonnées.
 * Utilisée pour invalider layout_snapshot si la géométrie change après validation.
 */

import crypto from "crypto";
import { pool } from "../../config/db.js";

/** Clés de geometry_json qui définissent le plan affiché (hors snapshot / ombrage). */
const HASH_KEYS = [
  "roofState",
  "validatedRoofData",
  "frozenBlocks",
  "pvParams",
  "panels",
  "obstacles",
  "gps",
];

function normalizeValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 1e6) / 1e6;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => normalizeValue(v));
  }
  const out = {};
  for (const k of Object.keys(value).sort()) {
    out[k] = normalizeValue(value[k]);
  }
  return out;
}

/**
 * Extrait uniquement les champs pris en compte pour l’empreinte (pas tout le JSON).
 * @param {object|null|undefined} geometryJson
 * @returns {object}
 */
export function pickHashPayload(geometryJson) {
  if (!geometryJson || typeof geometryJson !== "object") return {};
  const out = {};
  for (const k of HASH_KEYS) {
    if (geometryJson[k] !== undefined) {
      out[k] = geometryJson[k];
    }
  }
  return out;
}

/**
 * SHA-256 hex sur une représentation JSON stable (clés triées, flottants arrondis).
 * @param {object|null|undefined} geometryJson - geometry_json complet (layout_snapshot ignoré)
 * @returns {string}
 */
export function computeCalpinageGeometryHash(geometryJson) {
  const payload = pickHashPayload(geometryJson);
  const normalized = normalizeValue(payload);
  const str = JSON.stringify(normalized);
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

/**
 * Recalcule geometry_hash depuis le geometry_json actuel en base et le persiste.
 * À appeler après validate / capture snapshot lorsque geometry_json est à jour.
 * @param {string} studyVersionId
 * @param {string} organizationId
 * @param {import("pg").Pool|import("pg").PoolClient} [db] — client transactionnel si fourni (même transaction que le verrou calpinage).
 */
export async function persistGeometryHashForStudyVersion(studyVersionId, organizationId, db = pool) {
  const r = await db.query(
    `SELECT geometry_json FROM calpinage_data WHERE study_version_id = $1 AND organization_id = $2`,
    [studyVersionId, organizationId]
  );
  const gj = r.rows[0]?.geometry_json;
  if (!gj || typeof gj !== "object") return;

  const hash = computeCalpinageGeometryHash(gj);
  await db.query(
    `UPDATE calpinage_data
     SET geometry_json = jsonb_set(COALESCE(geometry_json, '{}'::jsonb), '{geometry_hash}', to_jsonb($1::text))
     WHERE study_version_id = $2 AND organization_id = $3`,
    [hash, studyVersionId, organizationId]
  );
}
