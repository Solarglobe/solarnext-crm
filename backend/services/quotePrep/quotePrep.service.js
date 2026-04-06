/**
 * quote-prep — Préparation du devis technique.
 * Version-scope : agrège calpinage (snapshot ou calpinage_data) + economic_snapshot pour study_version_id.
 */

import { pool } from "../../config/db.js";
import {
  createOrUpdateEconomicSnapshot,
  validateQuotePrep as validateEconomicSnapshot,
  forkQuotePrep as forkEconomicSnapshot,
  ERROR_CODES as ECONOMIC_ERROR_CODES,
} from "../economic/economicSnapshot.service.js";
import { resolveShadingTotalLossPct } from "../shading/resolveShadingTotalLossPct.js";
import {
  resolvePanelPowerWc,
  isInstalledKwcDivergent,
  computeInstalledKwcRounded3,
} from "../../utils/resolvePanelPowerWc.js";
import { fetchPvPanelRowById } from "../pv/resolvePanelFromDb.service.js";
import { fetchPvInverterRowById } from "../pv/resolveInverterFromDb.service.js";

const err = (code, message) => {
  const e = new Error(message);
  e.code = code;
  return e;
};

const DEBUG_QUOTE_PREP = process.env.DEBUG_QUOTE_PREP === "1";

/**
 * Construit le résumé technique à partir du snapshot (prioritaire) et calpinage_data.
 * Source: (a) calpinage_snapshots.snapshot_json.payload, (b) sinon calpinage_data.geometry_json,
 * (c) complété par colonnes calpinage_data (total_panels, total_power_kwc, annual_production_kwh, total_loss_pct).
 * Ne recalcule pas shading/production, lit les valeurs existantes.
 */
async function buildTechnicalSummary(calpinageRow, calpinageDataRow = null) {
  const payload =
    calpinageRow?.snapshot_json?.payload ??
    (calpinageDataRow?.geometry_json && typeof calpinageDataRow.geometry_json === "object"
      ? calpinageDataRow.geometry_json
      : null);

  const empty = {
    nb_panels: 0,
    power_kwc: 0,
    total_panels: 0,
    total_power_kwc: null,
    production_annual_kwh: null,
    shading_pct: null,
    total_loss_pct: null,
    orientation_deg: null,
    tilt_deg: null,
    orientation_mean_deg: null,
    tilt_mean_deg: null,
    inverter_family: null,
    dc_ac_ratio: null,
    gps: null,
    snapshot_version: calpinageRow?.version_number ?? null,
    calpinage_snapshot_id: calpinageRow?.id ?? null,
  };

  if (!payload || typeof payload !== "object") {
    if (calpinageDataRow) {
      empty.total_panels = calpinageDataRow.total_panels ?? 0;
      empty.total_power_kwc =
        calpinageDataRow.total_power_kwc != null ? Number(calpinageDataRow.total_power_kwc) : null;
      empty.nb_panels = empty.total_panels;
      empty.power_kwc =
        empty.total_power_kwc != null ? Math.round(empty.total_power_kwc * 1000) / 1000 : 0;
      empty.annual_production_kwh =
        calpinageDataRow.annual_production_kwh != null
          ? Number(calpinageDataRow.annual_production_kwh)
          : null;
      empty.shading_pct =
        calpinageDataRow.total_loss_pct != null ? Number(calpinageDataRow.total_loss_pct) : null;
      empty.total_loss_pct = empty.shading_pct;
    }
    return empty;
  }

  let panelCount = 0;
  if (calpinageDataRow?.total_panels != null && calpinageDataRow.total_panels >= 0) {
    panelCount = Number(calpinageDataRow.total_panels);
  }
  if (panelCount === 0) {
    const frozenBlocks = payload.frozenBlocks;
    if (Array.isArray(frozenBlocks)) {
      panelCount = frozenBlocks.reduce((s, b) => s + (b.panels?.length ?? 0), 0);
    }
    if (panelCount === 0 && payload.totals?.panels_count != null) {
      panelCount = Number(payload.totals.panels_count) || 0;
    }
    if (panelCount === 0 && payload.validatedRoofData?.pans) {
      const pans = payload.validatedRoofData.pans;
      panelCount = pans.reduce((s, p) => s + (p.panelCount ?? p.panel_count ?? 0), 0);
    }
  }

  const panelSpec = payload.panelSpec || payload.panel;
  let resolvedUnitWc = resolvePanelPowerWc(panelSpec);
  const panelCatalogId =
    panelSpec?.panel_id != null && String(panelSpec.panel_id).trim() !== ""
      ? String(panelSpec.panel_id).trim()
      : panelSpec?.id != null && String(panelSpec.id).trim() !== ""
        ? String(panelSpec.id).trim()
        : null;
  let dbPanelRow = null;
  if (panelCatalogId) {
    dbPanelRow = await fetchPvPanelRowById(pool, panelCatalogId);
    if (dbPanelRow && dbPanelRow.power_wc != null) {
      const pw = Number(dbPanelRow.power_wc);
      if (Number.isFinite(pw) && pw > 50) resolvedUnitWc = pw;
    }
  }

  let powerKwc = null;
  if (calpinageDataRow?.total_power_kwc != null) {
    const v = Number(calpinageDataRow.total_power_kwc);
    if (Number.isFinite(v)) powerKwc = v;
  }

  const recomputedKwc =
    resolvedUnitWc != null && panelCount > 0
      ? computeInstalledKwcRounded3(panelCount, resolvedUnitWc)
      : null;

  if (recomputedKwc != null) {
    if (
      powerKwc == null ||
      !Number.isFinite(powerKwc) ||
      isInstalledKwcDivergent(powerKwc, recomputedKwc)
    ) {
      powerKwc = recomputedKwc;
    }
  } else if (powerKwc == null || !Number.isFinite(powerKwc)) {
    powerKwc = 0;
  }
  powerKwc = Math.round(powerKwc * 1000) / 1000;

  const pans = payload.validatedRoofData?.pans;
  const pansArray = Array.isArray(pans) ? pans : [];
  const firstPan = pansArray[0];
  const orientationDeg =
    firstPan?.orientationDeg ?? firstPan?.orientation_deg ?? firstPan?.azimuth ?? null;
  const tiltDeg = firstPan?.tiltDeg ?? firstPan?.tilt_deg ?? firstPan?.tilt ?? null;

  let orientationMean = null;
  let tiltMean = null;
  if (pansArray.length > 0) {
    const orients = pansArray
      .map((p) => p.orientationDeg ?? p.orientation_deg ?? p.azimuth)
      .filter((v) => v != null && !Number.isNaN(Number(v)));
    const tilts = pansArray
      .map((p) => p.tiltDeg ?? p.tilt_deg ?? p.tilt)
      .filter((v) => v != null && !Number.isNaN(Number(v)));
    if (orients.length > 0) {
      orientationMean = orients.reduce((a, b) => a + Number(b), 0) / orients.length;
    }
    if (tilts.length > 0) {
      tiltMean = tilts.reduce((a, b) => a + Number(b), 0) / tilts.length;
    }
  }

  let totalLossPct = resolveShadingTotalLossPct(payload.shading, {
    installation: payload.installation,
    shadingLossPct: payload.shadingLossPct,
  });
  if (totalLossPct == null && calpinageDataRow?.total_loss_pct != null) {
    const fromDb = Number(calpinageDataRow.total_loss_pct);
    totalLossPct = Number.isFinite(fromDb) ? fromDb : null;
  }
  if (DEBUG_QUOTE_PREP && totalLossPct == null && (payload.shading || calpinageDataRow?.total_loss_pct != null)) {
    console.warn("[quote-prep] total_loss_pct introuvable dans payload.shading ni calpinage_data");
  }

  let productionKwh = null;
  if (calpinageDataRow?.annual_production_kwh != null) {
    productionKwh = Number(calpinageDataRow.annual_production_kwh);
  }
  if (productionKwh == null || Number.isNaN(productionKwh)) {
    const v =
      payload.annual_production_kwh ??
      payload.totals?.annual_production_kwh ??
      payload.production_annual_kwh;
    productionKwh = v != null ? Number(v) : null;
  }
  if (DEBUG_QUOTE_PREP && productionKwh == null && calpinageDataRow?.annual_production_kwh == null) {
    console.warn("[quote-prep] annual_production_kwh absent (calpinage_data + payload)");
  }

  const inverterFamily =
    payload.pvParams?.inverter_family ??
    payload.inverter_family ??
    payload.inverter?.family ??
    null;
  if (DEBUG_QUOTE_PREP && inverterFamily == null && (payload.pvParams || payload.inverter)) {
    console.warn("[quote-prep] inverter_family introuvable dans payload");
  }

  const dcAcRatio =
    payload.pvParams?.dc_ac_ratio ?? payload.dc_ac_ratio ?? payload.ratio_dc_ac ?? null;
  const dcAcNum = dcAcRatio != null ? Number(dcAcRatio) : null;
  if (DEBUG_QUOTE_PREP && dcAcNum == null && (payload.pvParams || payload.dc_ac_ratio != null)) {
    console.warn("[quote-prep] dc_ac_ratio introuvable dans payload");
  }

  const gpsRaw = payload.roofState?.gps ?? payload.gps ?? null;
  const gps =
    gpsRaw &&
    typeof gpsRaw.lat !== "undefined" &&
    typeof gpsRaw.lon !== "undefined" &&
    !Number.isNaN(Number(gpsRaw.lat)) &&
    !Number.isNaN(Number(gpsRaw.lon))
      ? { lat: Number(gpsRaw.lat), lon: Number(gpsRaw.lon) }
      : null;
  if (DEBUG_QUOTE_PREP && !gps && (payload.roofState?.gps || payload.gps)) {
    console.warn("[quote-prep] gps (lat/lon) invalide ou absent dans payload");
  }

  // Marque/modèle panneaux et onduleurs (résumé technique) — source: payload calpinage
  const panel =
    panelSpec && typeof panelSpec === "object"
      ? {
          id: dbPanelRow?.id ?? panelCatalogId ?? (panelSpec.id != null ? String(panelSpec.id) : null),
          panel_id: dbPanelRow?.id ?? panelCatalogId ?? null,
          brand: dbPanelRow?.brand ?? panelSpec.brand ?? null,
          model:
            dbPanelRow?.model_ref ??
            dbPanelRow?.name ??
            panelSpec.model ??
            panelSpec.model_ref ??
            null,
          power_wc: resolvedUnitWc,
          ...(dbPanelRow?.width_mm != null &&
          Number.isFinite(Number(dbPanelRow.width_mm)) &&
          Number(dbPanelRow.width_mm) > 0
            ? { width_mm: Number(dbPanelRow.width_mm) }
            : {}),
          ...(dbPanelRow?.height_mm != null &&
          Number.isFinite(Number(dbPanelRow.height_mm)) &&
          Number(dbPanelRow.height_mm) > 0
            ? { height_mm: Number(dbPanelRow.height_mm) }
            : {}),
        }
      : null;
  const inv = payload.inverter;
  const inverterCatalogId =
    inv?.inverter_id != null && String(inv.inverter_id).trim() !== ""
      ? String(inv.inverter_id).trim()
      : inv?.id != null && String(inv.id).trim() !== ""
        ? String(inv.id).trim()
        : null;
  let dbInvRow = null;
  if (inverterCatalogId) {
    dbInvRow = await fetchPvInverterRowById(pool, inverterCatalogId);
  }
  const inverter =
    inv && typeof inv === "object"
      ? {
          id: dbInvRow?.id ?? inverterCatalogId ?? (inv.id != null ? String(inv.id) : null),
          inverter_id: dbInvRow?.id ?? inverterCatalogId ?? null,
          brand: dbInvRow?.brand ?? inv.brand ?? null,
          name: dbInvRow?.name ?? inv.name ?? null,
          model_ref: dbInvRow?.model_ref ?? inv.model_ref ?? null,
          inverter_type: dbInvRow?.inverter_type ?? inv.inverter_type ?? null,
          inverter_family: dbInvRow?.inverter_family ?? inv.inverter_family ?? null,
          nominal_power_kw:
            dbInvRow?.nominal_power_kw != null && Number.isFinite(Number(dbInvRow.nominal_power_kw))
              ? Number(dbInvRow.nominal_power_kw)
              : inv.nominal_power_kw ?? null,
          nominal_va:
            dbInvRow?.nominal_va != null && Number.isFinite(Number(dbInvRow.nominal_va))
              ? Number(dbInvRow.nominal_va)
              : inv.nominal_va ?? null,
          euro_efficiency_pct:
            dbInvRow?.euro_efficiency_pct != null &&
            Number.isFinite(Number(dbInvRow.euro_efficiency_pct)) &&
            Number(dbInvRow.euro_efficiency_pct) > 50
              ? Number(dbInvRow.euro_efficiency_pct)
              : inv.euro_efficiency_pct ?? null,
          modules_per_inverter:
            dbInvRow?.modules_per_inverter != null &&
            Number.isFinite(Number(dbInvRow.modules_per_inverter))
              ? Number(dbInvRow.modules_per_inverter)
              : inv.modules_per_inverter ?? null,
        }
      : null;
  const inverter_totals =
    payload.inverter_totals && typeof payload.inverter_totals === "object"
      ? { units_required: payload.inverter_totals.units_required ?? null }
      : null;

  return {
    nb_panels: panelCount,
    total_panels: panelCount,
    power_kwc: powerKwc,
    total_power_kwc: powerKwc,
    production_annual_kwh: productionKwh,
    shading_pct: totalLossPct,
    total_loss_pct: totalLossPct,
    orientation_deg: orientationDeg != null ? Number(orientationDeg) : null,
    tilt_deg: tiltDeg != null ? Number(tiltDeg) : null,
    orientation_mean_deg: orientationMean != null ? Math.round(orientationMean * 10) / 10 : null,
    tilt_mean_deg: tiltMean != null ? Math.round(tiltMean * 10) / 10 : null,
    inverter_family: inverterFamily ?? null,
    dc_ac_ratio: dcAcNum,
    gps,
    snapshot_version: calpinageRow?.version_number ?? null,
    calpinage_snapshot_id: calpinageRow?.id ?? null,
    panel: panel ?? undefined,
    inverter: inverter ?? undefined,
    inverter_totals: inverter_totals ?? undefined,
  };
}

/**
 * GET quote-prep : résumé technique (calpinage pour cette version) + état économique (economic_snapshot pour cette version).
 * Version-scope : tout filtré par study_version_id (versionId).
 * @param {{ studyId: string, versionId: string, organizationId: string }}
 */
export async function getQuotePrep({ studyId, versionId, organizationId }) {
  const studyCheck = await pool.query(
    `SELECT id FROM studies WHERE id = $1 AND organization_id = $2`,
    [studyId, organizationId]
  );
  if (studyCheck.rows.length === 0) {
    throw err("NOT_FOUND", "Étude non trouvée");
  }

  const versionCheck = await pool.query(
    `SELECT id, study_id FROM study_versions WHERE id = $1 AND organization_id = $2`,
    [versionId, organizationId]
  );
  if (versionCheck.rows.length === 0 || versionCheck.rows[0].study_id !== studyId) {
    throw err("NOT_FOUND", "Version non trouvée ou ne correspond pas à l'étude");
  }

  // Calpinage : snapshot le plus récent pour cette version, sinon calpinage_data
  let calpinageRow = null;
  const calpinageSnapshotRes = await pool.query(
    `SELECT id, study_version_id, version_number, snapshot_json FROM calpinage_snapshots
     WHERE study_version_id = $1 AND organization_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [versionId, organizationId]
  );
  if (calpinageSnapshotRes.rows.length > 0) {
    calpinageRow = calpinageSnapshotRes.rows[0];
  }

  let calpinageDataRow = null;
  const calpinageDataRes = await pool.query(
    `SELECT total_panels, total_power_kwc, annual_production_kwh, total_loss_pct, geometry_json
     FROM calpinage_data WHERE study_version_id = $1 AND organization_id = $2 LIMIT 1`,
    [versionId, organizationId]
  );
  if (calpinageDataRes.rows.length > 0) {
    calpinageDataRow = calpinageDataRes.rows[0];
  }

  if (!calpinageRow && !calpinageDataRow) {
    throw err("NO_CALPINAGE", "Aucun calpinage pour cette version (ni snapshot ni calpinage_data)");
  }

  const technical_snapshot_summary = await buildTechnicalSummary(calpinageRow, calpinageDataRow);

  const economicRes = await pool.query(
    `SELECT id, study_version_id, version_number, status, config_json FROM economic_snapshots
     WHERE study_version_id = $1 AND organization_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [versionId, organizationId]
  );

  let economic_state = null;
  if (economicRes.rows.length > 0) {
    const row = economicRes.rows[0];
    economic_state = {
      snapshot_id: row.id,
      study_version_id: row.study_version_id,
      snapshot_version: row.version_number,
      status: row.status,
      data: row.config_json || {},
    };
  }

  // Contexte batterie virtuelle : grilles org + kVA lead (pour résolution tarifaire frontend)
  let lead_meter_power_kva = 9;
  let lead_customer_type = "PERSON";
  let lead_siret = null;
  const studyRow = await pool.query(
    "SELECT lead_id FROM studies WHERE id = $1 AND organization_id = $2",
    [studyId, organizationId]
  );
  if (studyRow.rows.length > 0 && studyRow.rows[0].lead_id) {
    const leadRow = await pool.query(
      "SELECT meter_power_kva, customer_type, siret FROM leads WHERE id = $1 AND organization_id = $2",
      [studyRow.rows[0].lead_id, organizationId]
    );
    if (leadRow.rows.length > 0) {
      if (leadRow.rows[0].meter_power_kva != null) {
        lead_meter_power_kva = Number(leadRow.rows[0].meter_power_kva) || 9;
      }
      lead_customer_type = leadRow.rows[0].customer_type ?? "PERSON";
      lead_siret = leadRow.rows[0].siret ?? null;
    }
  }

  let organization_pv_virtual_battery = null;
  const orgSettingsRes = await pool.query(
    "SELECT settings_json FROM organizations WHERE id = $1",
    [organizationId]
  );
  if (orgSettingsRes.rows.length > 0 && orgSettingsRes.rows[0].settings_json?.pv?.virtual_battery) {
    organization_pv_virtual_battery = orgSettingsRes.rows[0].settings_json.pv.virtual_battery;
  }

  return {
    technical_snapshot_summary,
    economic_state,
    study_version_id: versionId,
    lead_meter_power_kva,
    lead_customer_type,
    lead_siret,
    organization_pv_virtual_battery,
  };
}

/**
 * PUT quote-prep : sauvegarde brouillon (idempotent).
 * Délègue à createOrUpdateEconomicSnapshot. Si le snapshot actif est READY_FOR_STUDY, renvoie une erreur
 * (il faut d'abord créer une nouvelle version via POST .../quote-prep/fork ou via param create_new_version).
 */
export async function saveQuotePrepDraft({
  studyId,
  versionId,
  organizationId,
  userId = null,
  data,
}) {
  return createOrUpdateEconomicSnapshot({
    studyId,
    studyVersionId: versionId,
    organizationId,
    userId,
    config: data || {},
  });
}

/**
 * POST quote-prep/validate : fige le snapshot actif (DRAFT → READY_FOR_STUDY).
 */
export async function validateQuotePrep({ studyId, versionId, organizationId, userId = null }) {
  return validateEconomicSnapshot({
    studyId,
    versionId,
    organizationId,
    userId,
  });
}

/**
 * POST quote-prep/fork : crée une nouvelle version DRAFT (v+1) à partir du READY_FOR_STUDY actif.
 */
export async function forkQuotePrep({ studyId, versionId, organizationId, userId = null }) {
  return forkEconomicSnapshot({
    studyId,
    versionId,
    organizationId,
    userId,
  });
}

export { ECONOMIC_ERROR_CODES as ERROR_CODES };
