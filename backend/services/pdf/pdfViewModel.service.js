/**
 * PDF V2 — Service lecture snapshot + mapping ViewModel
 * Source unique : study_versions.selected_scenario_snapshot.
 */

import logger from "../../app/core/logger.js";
import { pool } from "../../config/db.js";
import { getPdfViewModelRow } from "../../routes/studies/service.js";
import { getLogoPath } from "../orgLogo.service.js";
import { mapSelectedScenarioSnapshotToPdfViewModel } from "./pdfViewModel.mapper.js";

/**
 * Récupère le ViewModel PDF pour une version d'étude.
 * @param {string} studyId
 * @param {string} versionId
 * @param {string} organizationId
 * @param {{ snapshot?: object, scenarioId?: string } | null} [previewOptions] — snapshot éphémère (PDF sans persistance en base)
 * @returns {Promise<{ viewModel: object } | { error: string, orgActual?: string }>}
 */
export async function getPdfViewModelForVersion(studyId, versionId, organizationId, previewOptions = null) {
  const row = await getPdfViewModelRow(versionId);

  if (!row) {
    return { error: "STUDY_VERSION_NOT_FOUND" };
  }

  if (row.organization_id !== organizationId) {
    return {
      error: "FORBIDDEN_CROSS_ORG",
      orgActual: row.organization_id,
    };
  }

  if (row.study_id !== studyId) {
    return { error: "STUDY_VERSION_NOT_FOUND" };
  }

  const snapshot =
    previewOptions && previewOptions.snapshot != null && typeof previewOptions.snapshot === "object"
      ? previewOptions.snapshot
      : row.selected_scenario_snapshot;
  if (snapshot == null || typeof snapshot !== "object") {
    return { error: "SNAPSHOT_NOT_FOUND" };
  }

  const selectedScenarioIdForMap =
    previewOptions && previewOptions.scenarioId != null ? previewOptions.scenarioId : row.selected_scenario_id;

  const studyRes = await pool.query(
    "SELECT study_number FROM studies WHERE id = $1",
    [row.study_id]
  );
  const studyNumber = studyRes.rows[0]?.study_number ?? null;

  let calpinageLayoutSnapshot = null;
  const calpinageRes = await pool.query(
    `SELECT geometry_json FROM calpinage_data WHERE study_version_id = $1`,
    [versionId]
  );
  const geometry_json = calpinageRes.rows[0]?.geometry_json;
  if (calpinageRes.rows.length > 0 && geometry_json?.layout_snapshot) {
    calpinageLayoutSnapshot = geometry_json.layout_snapshot;
  }

  /** Devis technique / quote-prep : financing + totals (même source que StudyQuoteBuilder). */
  let economicSnapshotConfig = null;
  try {
    const econRes = await pool.query(
      `SELECT config_json FROM economic_snapshots
       WHERE study_version_id = $1 AND organization_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [versionId, organizationId]
    );
    if (econRes.rows.length > 0 && econRes.rows[0].config_json != null) {
      const cj = econRes.rows[0].config_json;
      economicSnapshotConfig = typeof cj === "object" ? cj : null;
    }
  } catch (_) {
    economicSnapshotConfig = null;
  }

  const viewModel = mapSelectedScenarioSnapshotToPdfViewModel(snapshot, {
    studyId,
    versionId,
    studyNumber,
    scenarios_v2: row.data_json?.scenarios_v2 ?? null,
    selected_scenario_id: selectedScenarioIdForMap ?? null,
    calpinage_layout_snapshot: calpinageLayoutSnapshot,
    economic_snapshot_config: economicSnapshotConfig,
  });

  viewModel.selected_scenario_snapshot = snapshot;

  const orgRes = await pool.query(
    "SELECT settings_json, pdf_cover_image_key FROM organizations WHERE id = $1",
    [organizationId]
  );
  const settings = orgRes.rows[0]?.settings_json ?? {};
  const pdfCoverKey = settings.pdf_cover_image_key || orgRes.rows[0]?.pdf_cover_image_key;
  const logoKey = settings.logo_image_key || null;
  const hasLegacyLogo = !logoKey && (await getLogoPath(organizationId));

  viewModel.organization = {
    id: organizationId,
    logo_image_key: logoKey || (hasLegacyLogo ? "legacy" : null),
    pdf_cover_image_key: pdfCoverKey || null,
  };

  if (process.env.NODE_ENV !== "production") {
    logger.info("PDF_VM_ORG_ASSETS", {
      orgId: organizationId,
      logo_image_key: viewModel.organization.logo_image_key || null,
      pdf_cover_image_key: viewModel.organization.pdf_cover_image_key || null,
    });
  }

  return { viewModel };
}
