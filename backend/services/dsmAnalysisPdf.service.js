/**
 * CP-DSM-PDF-004/005 — Service export PDF "Analyse Ombres" Premium
 * Données backend uniquement : installation.shading V2, perPanel, horizon mask.
 * Ne modifie pas moteur shading ni normalizer.
 */

import logger from "../app/core/logger.js";
import { pool } from "../config/db.js";
import * as studiesService from "../routes/studies/service.js";
import { buildSolarNextPayload } from "./solarnextPayloadBuilder.service.js";
import { getOrComputeHorizonMask } from "./horizon/horizonMaskCache.js";
import { computeHorizonMaskAuto } from "./horizon/providers/horizonProviderSelector.js";
import { hasPanelsInGeometry } from "./shading/shadingStructureBuilder.js";

/**
 * Récupère les données nécessaires pour le PDF Analyse Ombres (2 pages).
 * @param {{ studyId: string, versionId: number, orgId: string }}
 * @returns {Promise<object>}
 */
export async function getDsmAnalysisData({ studyId, versionId, orgId }) {
  const versionNum = typeof versionId === "number" ? versionId : parseInt(versionId, 10);
  if (isNaN(versionNum) || versionNum < 1) {
    throw new Error("Numéro de version invalide");
  }

  const payload = await buildSolarNextPayload({ studyId, versionId: versionNum, orgId });
  const installation = payload.installation || {};
  const shading = installation.shading || {};
  const lat = payload.lead?.lat ?? null;
  const lon = payload.lead?.lon ?? null;
  const orientationDeg = installation.orientation_deg ?? null;
  const tiltDeg = installation.tilt_deg ?? null;

  const version = await studiesService.getVersion(studyId, versionNum, orgId);
  if (!version) {
    throw new Error("Version non trouvée");
  }

  const calpinageRes = await pool.query(
    `SELECT geometry_json, total_panels FROM calpinage_data
     WHERE study_version_id = $1 AND organization_id = $2`,
    [version.id, orgId]
  );
  if (calpinageRes.rows.length === 0) {
    logger.warn("DSM_CALPINAGE_REQUIRED", {
      studyId,
      versionId: versionNum,
      orgId,
      reason: "no_calpinage_row",
      total_panels: null,
      frozenBlocks_present: false,
      panels_detected: 0,
    });
    throw new Error("CALPINAGE_REQUIRED");
  }
  const geometry = calpinageRes.rows[0].geometry_json || {};
  const totalPanels = calpinageRes.rows[0].total_panels ?? null;
  const blocks = geometry.frozenBlocks || [];
  const panelsDetected = blocks.reduce((s, b) => s + (b.panels?.length ?? 0), 0);
  if (!hasPanelsInGeometry(geometry)) {
    logger.warn("DSM_CALPINAGE_REQUIRED", {
      studyId,
      versionId: versionNum,
      orgId,
      reason: "no_panels_in_geometry",
      total_panels: totalPanels,
      frozenBlocks_present: blocks.length > 0,
      panels_detected: panelsDetected,
    });
    throw new Error("CALPINAGE_REQUIRED");
  }

  const studyRes = await pool.query(
    `SELECT lead_id FROM studies WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [studyId, orgId]
  );
  let address = "";
  if (studyRes.rows.length > 0 && studyRes.rows[0].lead_id) {
    const leadRes = await pool.query(
      `SELECT site_address_id FROM leads WHERE id = $1 AND organization_id = $2`,
      [studyRes.rows[0].lead_id, orgId]
    );
    if (leadRes.rows.length > 0 && leadRes.rows[0].site_address_id) {
      const addrRes = await pool.query(
        `SELECT address_line1, postal_code, city, formatted_address
         FROM addresses WHERE id = $1 AND organization_id = $2`,
        [leadRes.rows[0].site_address_id, orgId]
      );
      if (addrRes.rows.length > 0) {
        const a = addrRes.rows[0];
        address =
          a.formatted_address ||
          [a.address_line1, a.postal_code, a.city].filter(Boolean).join(", ") ||
          a.city ||
          "";
      }
    }
  }

  let horizonMask = null;
  let horizonMeta = {};
  if (typeof lat === "number" && typeof lon === "number" && !isNaN(lat) && !isNaN(lon)) {
    try {
      const { value } = await getOrComputeHorizonMask(
        { tenantKey: orgId, lat, lon, radius_m: 500, step_deg: 2 },
        () => computeHorizonMaskAuto({ organizationId: orgId, lat, lon, radius_m: 500, step_deg: 2 })
      );
      horizonMask = value;
      horizonMeta = {
        source: value?.source ?? "RELIEF_ONLY",
        confidence: value?.confidence ?? null,
      };
    } catch (_) {
      horizonMask = { mask: [], source: "RELIEF_ONLY" };
    }
  }

  const orgRes = await pool.query(
    `SELECT name, settings_json FROM organizations WHERE id = $1`,
    [orgId]
  );
  const org = orgRes.rows[0] || {};
  const orgSettings = org.settings_json || {};

  const date = new Date().toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return {
    address: address.trim() || "—",
    date,
    installation,
    geometry,
    shading,
    lat,
    lon,
    orientationDeg,
    tiltDeg,
    horizonMask,
    horizonMeta,
    org: {
      name: org.name || "—",
      address: orgSettings.address || "Non disponible",
      email: orgSettings.email || "Non disponible",
      phone: orgSettings.phone || "Non disponible",
    },
    lead: payload.lead || {},
  };
}
