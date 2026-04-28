/**
 * PDF V2 — Service lecture snapshot + mapping ViewModel
 * Source unique : study_versions.selected_scenario_snapshot.
 */

import { readFileSync } from "fs";
import path from "path";
import logger from "../../app/core/logger.js";
import { pool } from "../../config/db.js";
import { getPdfViewModelRow } from "../../routes/studies/service.js";
import { getLogoPath } from "../orgLogo.service.js";
import { getAbsolutePath } from "../localStorage.service.js";
import { mapSelectedScenarioSnapshotToPdfViewModel } from "./pdfViewModel.mapper.js";
import { getLegalCgvForPdfRender } from "../legalCgv.service.js";

/** Première série ≥ 8760 points trouvée sous les clés données (kW ou kWc selon le champ). */
function firstHourlyArray8760(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v) && v.length >= 8760) {
      return v.map((x) => (Number.isFinite(Number(x)) ? Number(x) : 0));
    }
  }
  return null;
}

/**
 * Récupère le ViewModel PDF pour une version d'étude.
 * @param {string} studyId
 * @param {string} versionId
 * @param {string} organizationId
 * @param {{ snapshot?: object, scenarioId?: string } | null} [previewOptions] — snapshot éphémère (PDF sans persistance en base)
 * @returns {Promise<{ viewModel: object } | { error: string, orgActual?: string }>}
 */
export async function getPdfViewModelForVersion(studyId, versionId, organizationId, previewOptions = null) {
  const row = await getPdfViewModelRow(versionId, organizationId);

  if (!row) {
    return { error: "STUDY_VERSION_NOT_FOUND" };
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

  const orgRowForPdf = await pool.query(
    `SELECT settings_json, pdf_cover_image_key, name, legal_name, trade_name, pdf_primary_color
     FROM organizations WHERE id = $1`,
    [organizationId]
  );
  const orgRowPdf = orgRowForPdf.rows[0] ?? {};
  const settingsJson =
    orgRowPdf.settings_json && typeof orgRowPdf.settings_json === "object" ? orgRowPdf.settings_json : {};
  const orgEconomics =
    settingsJson.economics && typeof settingsJson.economics === "object" ? settingsJson.economics : null;

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

  const dj = row.data_json && typeof row.data_json === "object" ? row.data_json : {};
  const p5HourlyOpts = {
    p5_pv_hourly_kw_8760: firstHourlyArray8760(dj, ["pv_hourly_kw"]),
    p5_pv_hourly_shape_per_kwc_8760: firstHourlyArray8760(dj, [
      "pv_hourly_shape_per_kwc",
      "pv_hourly_1kwc",
      "pv_hourly_shape_1kwc",
    ]),
    p5_conso_hourly_kw_8760: firstHourlyArray8760(dj, [
      "conso_hourly_kw",
      "conso_p_pilotee_hourly",
      "conso_hourly",
    ]),
  };

  const viewModel = mapSelectedScenarioSnapshotToPdfViewModel(snapshot, {
    studyId,
    versionId,
    studyNumber,
    scenarios_v2: row.data_json?.scenarios_v2 ?? null,
    selected_scenario_id: selectedScenarioIdForMap ?? null,
    calpinage_layout_snapshot: calpinageLayoutSnapshot,
    economic_snapshot_config: economicSnapshotConfig,
    org_economics: orgEconomics,
    ...p5HourlyOpts,
  });

  viewModel.selected_scenario_snapshot = snapshot;

  const orgRow = orgRowPdf;
  const settings = settingsJson;
  const pdfCoverKey = settings.pdf_cover_image_key || orgRow.pdf_cover_image_key;
  const logoKey = settings.logo_image_key || null;
  const hasLegacyLogo = !logoKey && (await getLogoPath(organizationId));

  // Encode le logo en data URL pour éviter toute requête réseau depuis Playwright.
  // Sans ça, Playwright peut capturer le PDF avant que les img tags aient fini de charger.
  let logoDataUrl = null;
  try {
    let logoFilePath = null;
    if (logoKey) {
      logoFilePath = path.resolve(getAbsolutePath(logoKey));
    } else if (hasLegacyLogo) {
      const legacyPath = await getLogoPath(organizationId);
      if (legacyPath) logoFilePath = path.resolve(legacyPath);
    }
    if (logoFilePath) {
      const ext = path.extname(logoFilePath).toLowerCase();
      const mime =
        ext === ".png" ? "image/png"
        : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
        : ext === ".svg" ? "image/svg+xml"
        : ext === ".webp" ? "image/webp"
        : "image/png";
      const buf = readFileSync(logoFilePath);
      logoDataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    }
  } catch (_) {
    logoDataUrl = null;
  }

  let legal_cgv = null;
  try {
    legal_cgv = await getLegalCgvForPdfRender(organizationId);
  } catch {
    legal_cgv = null;
  }

  viewModel.organization = {
    id: organizationId,
    name: orgRow.name ?? null,
    legal_name: orgRow.legal_name ?? null,
    trade_name: orgRow.trade_name ?? null,
    pdf_primary_color: orgRow.pdf_primary_color ?? null,
    logo_image_key: logoKey || (hasLegacyLogo ? "legacy" : null),
    logo_url: logoDataUrl,
    pdf_cover_image_key: pdfCoverKey || null,
    legal_cgv,
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
