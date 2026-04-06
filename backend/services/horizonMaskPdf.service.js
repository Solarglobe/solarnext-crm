/**
 * CP-DSM-PDF-006 — Service export PDF "Masque d'ombrage" (1 page, site-level)
 * Aucune dépendance aux panneaux ni à calpinage_data.
 * Entrées : studyId, versionId, orgId.
 * Sortie : données compatibles buildHorizonMaskPageHtml.
 */

import { pool } from "../config/db.js";
import * as studiesService from "../routes/studies/service.js";
import { getOrComputeHorizonMask } from "./horizon/horizonMaskCache.js";
import { computeHorizonMaskAuto } from "./horizon/providers/horizonProviderSelector.js";

/**
 * Récupère les données pour le PDF Masque d'horizon (1 page).
 * @param {{ studyId: string, versionId: number, orgId: string }}
 * @returns {Promise<object>} data pour buildHorizonMaskPageHtml
 * @throws {Error} BUSINESS : "Étude non trouvée", "Version non trouvée", "Adresse non géolocalisée (lat/lon requis)"
 */
export async function getHorizonMaskPdfData({ studyId, versionId, orgId }) {
  const versionNum = typeof versionId === "number" ? versionId : parseInt(versionId, 10);
  if (isNaN(versionNum) || versionNum < 1) {
    throw new Error("Numéro de version invalide");
  }

  const studyRes = await pool.query(
    `SELECT id, lead_id FROM studies
     WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [studyId, orgId]
  );
  if (studyRes.rows.length === 0) {
    throw new Error("Étude non trouvée");
  }
  const study = studyRes.rows[0];
  const leadId = study.lead_id;

  const version = await studiesService.getVersion(studyId, versionNum, orgId);
  if (!version) {
    throw new Error("Version non trouvée");
  }

  let lat = null;
  let lon = null;
  let address = "—";

  if (leadId) {
    const leadRes = await pool.query(
      `SELECT site_address_id FROM leads WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
      [leadId, orgId]
    );
    if (leadRes.rows.length > 0 && leadRes.rows[0].site_address_id) {
      const addrRes = await pool.query(
        `SELECT lat, lon, address_line1, postal_code, city, formatted_address
         FROM addresses WHERE id = $1 AND organization_id = $2`,
        [leadRes.rows[0].site_address_id, orgId]
      );
      if (addrRes.rows.length > 0) {
        const a = addrRes.rows[0];
        lat = a.lat != null ? Number(a.lat) : null;
        lon = a.lon != null ? Number(a.lon) : null;
        address =
          a.formatted_address ||
          [a.address_line1, a.postal_code, a.city].filter(Boolean).join(", ") ||
          a.city ||
          "—";
      }
    }
  }

  if ((lat == null || lon == null || isNaN(lat) || isNaN(lon)) && version?.id) {
    const calpinageRes = await pool.query(
      `SELECT geometry_json FROM calpinage_data
       WHERE study_version_id = $1 AND organization_id = $2`,
      [version.id, orgId]
    );
    if (calpinageRes.rows.length > 0) {
      const geom = calpinageRes.rows[0].geometry_json || {};
      const roofState = geom.roofState || {};
      const roof = geom.roof || {};
      const gps = roofState.gps || roof.gps;
      if (gps && typeof gps.lat === "number" && typeof gps.lon === "number") {
        if (!isNaN(gps.lat) && !isNaN(gps.lon)) {
          lat = gps.lat;
          lon = gps.lon;
        }
      }
    }
  }

  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) {
    throw new Error("Adresse non géolocalisée (lat/lon requis)");
  }

  let orientationDeg = 180;
  let tiltDeg = 30;

  if (version?.id) {
    const calpinageRes = await pool.query(
      `SELECT geometry_json FROM calpinage_data
       WHERE study_version_id = $1 AND organization_id = $2`,
      [version.id, orgId]
    );
    if (calpinageRes.rows.length > 0) {
      const geom = calpinageRes.rows[0].geometry_json || {};
      const roof = geom.roof || {};
      const pans = roof.pans || geom.validatedRoofData?.pans || [];
      if (Array.isArray(pans) && pans.length > 0) {
        const p = pans[0];
        const orient = p.orientationDeg ?? p.azimuthDeg ?? p.orientation_deg ?? p.azimuth_deg;
        const tilt = p.tiltDeg ?? p.slopeDeg ?? p.tilt_deg ?? p.slope_deg;
        if (typeof orient === "number" && !isNaN(orient)) orientationDeg = orient;
        if (typeof tilt === "number" && !isNaN(tilt)) tiltDeg = tilt;
      }
    }
  }

  let horizonMask = null;
  let horizonMeta = {};

  try {
    const { value } = await getOrComputeHorizonMask(
      { tenantKey: orgId, lat, lon, radius_m: 500, step_deg: 2 },
      () => computeHorizonMaskAuto({ organizationId: orgId, lat, lon, radius_m: 500, step_deg: 2 })
    );
    horizonMask = value;
    horizonMeta = {
      source: value?.source ?? "RELIEF_ONLY",
      confidence: value?.confidence ?? null,
      qualityScore: value?.meta?.qualityScore ?? value?.confidence ?? null,
    };
  } catch (_) {
    horizonMask = { mask: [], source: "RELIEF_ONLY" };
  }

  const date = new Date().toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return {
    address: (address || "—").trim(),
    date,
    lat,
    lon,
    orientationDeg,
    tiltDeg,
    horizonMask,
    horizonMeta,
    generatedAt: new Date().toISOString(),
  };
}
