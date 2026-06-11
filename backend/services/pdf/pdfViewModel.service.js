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
import {
  repairScenarioV2DisplayKpis,
  repairVirtualScenarioDisplayKpis,
} from "../scenarioV2DisplayRepair.service.js";

async function resolveLivePdfClient(studyId, organizationId) {
  const res = await pool.query(
    `SELECT
       s.lead_id,
       s.client_id,
       l.customer_type AS lead_customer_type,
       l.company_name AS lead_company_name,
       l.first_name AS lead_first_name,
       l.last_name AS lead_last_name,
       l.contact_first_name AS lead_contact_first_name,
       l.contact_last_name AS lead_contact_last_name,
       a.formatted_address AS lead_formatted_address,
       a.address_line1 AS lead_address_line1,
       a.address_line2 AS lead_address_line2,
       a.postal_code AS lead_postal_code,
       a.city AS lead_city,
       c.company_name AS client_company_name,
       c.first_name AS client_first_name,
       c.last_name AS client_last_name
     FROM studies s
     LEFT JOIN leads l
       ON l.id = s.lead_id
      AND l.organization_id = s.organization_id
      AND (l.archived_at IS NULL)
     LEFT JOIN addresses a
       ON a.id = l.site_address_id
      AND a.organization_id = l.organization_id
     LEFT JOIN clients c
       ON c.id = s.client_id
      AND c.organization_id = s.organization_id
     WHERE s.id = $1
       AND s.organization_id = $2
       AND (s.archived_at IS NULL)
       AND (s.deleted_at IS NULL)
     LIMIT 1`,
    [studyId, organizationId]
  );
  const row = res.rows[0];
  if (!row) return null;

  if (row.lead_id && (row.lead_first_name != null || row.lead_last_name != null || row.lead_company_name != null)) {
    const isProLead = (row.lead_customer_type ?? "PERSON") === "PRO";
    return {
      nom: isProLead ? row.lead_company_name ?? null : row.lead_last_name ?? null,
      prenom: isProLead
        ? [row.lead_contact_first_name, row.lead_contact_last_name].filter(Boolean).join(" ") || null
        : row.lead_first_name ?? null,
      adresse:
        row.lead_formatted_address ||
        [row.lead_address_line1, row.lead_address_line2].filter(Boolean).join(", ") ||
        null,
      cp: row.lead_postal_code ?? null,
      ville: row.lead_city ?? null,
    };
  }

  if (row.client_id) {
    if (row.client_company_name != null) {
      return {
        nom: row.client_company_name,
        prenom: [row.client_first_name, row.client_last_name].filter(Boolean).join(" ") || null,
      };
    }
    return {
      nom: row.client_last_name ?? null,
      prenom: row.client_first_name ?? null,
    };
  }

  return null;
}

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
  let repairedSnapshot = repairVirtualScenarioDisplayKpis(snapshot);
  const liveClient = await resolveLivePdfClient(studyId, organizationId);
  if (liveClient) {
    repairedSnapshot = {
      ...repairedSnapshot,
      client: {
        ...(repairedSnapshot.client && typeof repairedSnapshot.client === "object" ? repairedSnapshot.client : {}),
        ...liveClient,
      },
    };
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
  const repairedScenariosV2 = repairScenarioV2DisplayKpis(dj.scenarios_v2 ?? null);
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

  const viewModel = mapSelectedScenarioSnapshotToPdfViewModel(repairedSnapshot, {
    studyId,
    versionId,
    studyNumber,
    scenarios_v2: repairedScenariosV2,
    selected_scenario_id: selectedScenarioIdForMap ?? null,
    calpinage_layout_snapshot: calpinageLayoutSnapshot,
    economic_snapshot_config: economicSnapshotConfig,
    org_economics: orgEconomics,
    ...p5HourlyOpts,
  });

  viewModel.selected_scenario_snapshot = repairedSnapshot;
  viewModel.calculation_confidence = dj.calculation_confidence ?? null;

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
