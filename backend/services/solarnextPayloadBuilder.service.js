/**
 * CP-3 — SolarNext Payload Builder
 * Construit solarnext_payload depuis DB (Study, Lead, Calpinage, Org params)
 * CP-FAR-003 : shading (near + far) calculé côté backend.
 * CP-FAR-004 : structure JSON shading { near, far, combined }.
 */

import { pool } from "../config/db.js";
import { resolveVirtualBatteryActivationFeeTtcFromOrgDb } from "./virtualBatteryQuoteCalculator.service.js";
import * as studiesService from "../routes/studies/service.js";
import { computeCalpinageShading } from "./shading/calpinageShading.service.js";
import {
  buildStructuredShading,
  hasPanelsInGeometry,
} from "./shading/shadingStructureBuilder.js";
import { normalizeCalpinageShading } from "./calpinage/calpinageShadingNormalizer.js";
import {
  buildOfficialShadingFromComputeResult,
  computeShadingOfficialDiff,
  logShadingOfficialDriftIfNeeded,
  isUseOfficialShadingEnabled,
} from "./calpinage/officialShading.service.js";
import {
  computeUiVsOfficialShadingDiff,
  logShadingUiServerDriftIfNeeded,
  parityStatusFromDiff,
  slimOfficialForParityDebug,
  slimUiForParityDebug,
} from "./calpinage/shadingParity.service.js";
import { computeWeightedShadingCombinedPct } from "./shading/weightedShadingKpi.js";
import { resolveConsumptionCsv } from "./consumptionCsvResolver.service.js";
import { extractPvInverterFromCalpinagePayload } from "./pv/inverterFinanceContext.js";
import { resolvePvInverterEngineFields } from "./pv/resolveInverterFromDb.service.js";
import {
  METER_FIELDS_FROM_LEAD,
  ensureDefaultLeadMeter,
  getDefaultMeterRow,
} from "./leadMeters.service.js";
import {
  resolvePanelPowerWc,
  isInstalledKwcDivergent,
  computeInstalledKwcRounded3,
} from "../utils/resolvePanelPowerWc.js";
import { applyPanelPowerFromCatalog } from "./pv/resolvePanelFromDb.service.js";
import { applyPhysicalBatteryTechnicalFromCatalog } from "./pv/resolveBatteryFromDb.service.js";
import {
  resolveVirtualBatteryMonthlyFromGrid,
  vbHasExploitableProviderGrid,
} from "./pv/virtualBatteryGridResolve.service.js";
import {
  DEFAULT_ECONOMICS_FALLBACK,
  mergeOrgEconomicsPartial,
  pickExplicitProjectTariffKwh,
} from "./economicsResolve.service.js";

// ======================================================================
// FALLBACK PARAMÈTRES (CP-5 — valeurs minimales pour tester)
// ======================================================================
const FALLBACK_PARAMS = {
  pricing: {
    kit_panel_power_w: 485,
    kit_price_lt_4_5: 180,
    kit_price_gt_4_5: 170,
    coffret_mono_ht: 450,
    coffret_tri_ht: 650,
    install_tiers: [
      { kwc: 3, price_ht: 1200 },
      { kwc: 6, price_ht: 1800 },
      { kwc: 9, price_ht: 2400 },
    ],
    battery_atmoce_unit_price_ht: 450,
  },
  economics: DEFAULT_ECONOMICS_FALLBACK,
  economics_raw: null,
  /** Enveloppe `settings_json.pvtech` (héritage) — voir `orgSettingsDeprecated.js` ; hypothèses effectives = catalogues + étude. */
  pvtech: {
    system_yield_pct: 85,
    longi_lowlight_gain_pct: 0,
    fallback_prod: null,
  },
  components: {
    standard_loss_pct: 14,
    micro_eff_pct: 96.5,
    micro_mppt_pct: 99.5,
  },
};

function mapConsumptionMode(mode) {
  if (!mode) return "annuelle";
  if (mode === "ANNUAL") return "annuelle";
  if (mode === "MONTHLY") return "mensuelle";
  return "annuelle";
}

function mapConsumptionProfile(profile) {
  if (!profile) return "active";
  const p = (profile || "").toLowerCase();
  if (p === "remote_work" || p === "teletravail") return "teletravail";
  if (p === "retired" || p === "retraite") return "retraite";
  if (p === "pro_day") return "pro";
  return "active";
}

/** Conso / profil / équipements : priorité compteur choisi, sinon colonnes leads (legacy). */
function buildEnergyLeadRow(baseLead, meterRow) {
  if (!meterRow) return baseLead;
  const out = { ...baseLead };
  for (const key of METER_FIELDS_FROM_LEAD) {
    if (!Object.prototype.hasOwnProperty.call(meterRow, key)) continue;
    const v = meterRow[key];
    if (v === null || v === undefined) continue;
    out[key] = v;
  }
  return out;
}

/**
 * Résolution lead + compteur pour une version numérotée (même règles que buildSolarNextPayload).
 * Exporté pour snapshot calcul / tests / alignement validation.
 * @returns {Promise<null | { version: object, studyData: object, leadId: string, baseLead: object, meterRow: object | null, energyLead: object, resolvedSelectedMeterId: string | null }>}
 */
export async function resolveStudyVersionMeterContext(pool, { studyId, versionNumber, orgId }) {
  const versionNum =
    typeof versionNumber === "number" ? versionNumber : parseInt(String(versionNumber), 10);
  if (isNaN(versionNum) || versionNum < 1) return null;

  const version = await studiesService.getVersion(studyId, versionNum, orgId);
  if (!version) return null;

  const studyData = version.data && typeof version.data === "object" ? version.data : {};

  const studyRes = await pool.query(
    `SELECT id, lead_id FROM studies
     WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [studyId, orgId]
  );
  if (studyRes.rows.length === 0) return null;
  const leadId = studyRes.rows[0].lead_id;
  if (!leadId) return null;

  const leadRes = await pool.query(
    `SELECT l.id, l.full_name, l.first_name, l.last_name, l.site_address_id,
            l.consumption_mode, l.consumption_annual_kwh, l.consumption_annual_calculated_kwh,
            l.consumption_profile, l.grid_type, l.meter_power_kva, l.energy_profile,
            l.equipement_actuel, l.equipement_actuel_params, l.equipements_a_venir
     FROM leads l
     WHERE l.id = $1 AND l.organization_id = $2 AND (l.archived_at IS NULL)`,
    [leadId, orgId]
  );
  if (leadRes.rows.length === 0) return null;
  const baseLead = leadRes.rows[0];

  await ensureDefaultLeadMeter(pool, leadId, orgId);

  let meterRow = null;
  const requestedMeterId =
    typeof studyData.selected_meter_id === "string"
      ? studyData.selected_meter_id.trim()
      : null;
  if (requestedMeterId) {
    const mRes = await pool.query(
      `SELECT * FROM lead_meters
       WHERE id = $1 AND lead_id = $2 AND organization_id = $3`,
      [requestedMeterId, leadId, orgId]
    );
    meterRow = mRes.rows[0] ?? null;
  }
  if (!meterRow) {
    meterRow = await getDefaultMeterRow(pool, leadId, orgId);
  }

  const energyLead = buildEnergyLeadRow(baseLead, meterRow);
  const resolvedSelectedMeterId = meterRow?.id ?? null;

  return {
    version,
    studyData,
    leadId,
    baseLead,
    meterRow,
    energyLead,
    resolvedSelectedMeterId,
  };
}

/**
 * Charge les paramètres org (pricing, economics, pvtech, components)
 * Fallback si absents (CP-5)
 */
async function loadOrgParams(organizationId) {
  const r = await pool.query(
    "SELECT settings_json FROM organizations WHERE id = $1",
    [organizationId]
  );
  if (r.rows.length === 0) return FALLBACK_PARAMS;

  const settings = r.rows[0].settings_json || {};
  const rawEconomics =
    settings.economics && typeof settings.economics === "object" ? settings.economics : null;
  const basePricing =
    settings.pricing && typeof settings.pricing === "object"
      ? { ...FALLBACK_PARAMS.pricing, ...settings.pricing }
      : FALLBACK_PARAMS.pricing;
  // Mapping rétrocompatible : battery_unit_price_ht (CRM) > battery_atmoce_unit_price_ht > 450
  const batteryPrice =
    basePricing.battery_unit_price_ht ??
    basePricing.battery_atmoce_unit_price_ht ??
    450;
  const pricing = { ...basePricing, battery_atmoce_unit_price_ht: batteryPrice };
  return {
    pricing,
    economics: mergeOrgEconomicsPartial(rawEconomics),
    economics_raw: rawEconomics,
    pvtech: settings.pvtech && typeof settings.pvtech === "object"
      ? { ...FALLBACK_PARAMS.pvtech, ...settings.pvtech }
      : FALLBACK_PARAMS.pvtech,
    components: settings.components && typeof settings.components === "object"
      ? { ...FALLBACK_PARAMS.components, ...settings.components }
      : FALLBACK_PARAMS.components,
    pv: settings.pv && typeof settings.pv === "object" ? settings.pv : undefined,
  };
}

/**
 * Construit solarnext_payload pour buildLegacyPayloadFromSolarNext
 * @param {{ studyId: string, versionId: number, orgId: string, shadingUiSnapshot?: object|null }}
 * @returns {Promise<object>} solarnext_payload
 * @throws {Error} CALPINAGE_REQUIRED si calpinage absent
 */
export async function buildSolarNextPayload({ studyId, versionId, orgId, shadingUiSnapshot = null }) {
  const versionNum = typeof versionId === "number" ? versionId : parseInt(versionId, 10);
  if (isNaN(versionNum) || versionNum < 1) {
    throw new Error("Numéro de version invalide");
  }

  const ctx = await resolveStudyVersionMeterContext(pool, {
    studyId,
    versionNumber: versionNum,
    orgId,
  });
  if (!ctx) {
    throw new Error("Version non trouvée");
  }
  const { version, studyData, leadId, baseLead, energyLead, meterRow } = ctx;

  let siteAddress = null;
  if (baseLead.site_address_id) {
    const addrRes = await pool.query(
      "SELECT id, city, lat, lon FROM addresses WHERE id = $1 AND organization_id = $2",
      [baseLead.site_address_id, orgId]
    );
    siteAddress = addrRes.rows[0] || null;
  }

  const calpinageRes = await pool.query(
    `SELECT geometry_json, total_panels, total_power_kwc, annual_production_kwh, total_loss_pct
     FROM calpinage_data
     WHERE study_version_id = $1 AND organization_id = $2`,
    [version.id, orgId]
  );

  if (calpinageRes.rows.length === 0) {
    throw new Error("CALPINAGE_REQUIRED");
  }

  const calpinage = calpinageRes.rows[0];
  const geometry = calpinage.geometry_json || {};
  if (!hasPanelsInGeometry(geometry)) {
    throw new Error("CALPINAGE_REQUIRED");
  }
  const roofState = geometry.roofState || {};
  const roof = geometry.roof || {};
  const pans = roof.pans || geometry.validatedRoofData?.pans || [];

  let lat = null;
  let lon = null;
  if (roofState.gps && typeof roofState.gps === "object") {
    lat = Number(roofState.gps.lat);
    lon = Number(roofState.gps.lon);
  }
  if ((lat == null || lon == null || isNaN(lat) || isNaN(lon)) && roof.gps) {
    lat = Number(roof.gps.lat);
    lon = Number(roof.gps.lon);
  }
  if ((lat == null || lon == null || isNaN(lat) || isNaN(lon)) && siteAddress) {
    lat = siteAddress.lat != null ? Number(siteAddress.lat) : null;
    lon = siteAddress.lon != null ? Number(siteAddress.lon) : null;
  }
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) {
    throw new Error("Adresse non géolocalisée (lat/lon requis)");
  }

  let orientationDeg = 180;
  let tiltDeg = 30;
  if (Array.isArray(pans) && pans.length > 0) {
    const valid = pans.filter((p) => typeof p.orientationDeg === "number" || typeof p.azimuthDeg === "number");
    if (valid.length > 0) {
      orientationDeg =
        valid.reduce((s, p) => s + (p.orientationDeg ?? p.azimuthDeg ?? 180), 0) / valid.length;
    }
    const validTilt = pans.filter((p) => typeof p.tiltDeg === "number" || typeof p.slopeDeg === "number");
    if (validTilt.length > 0) {
      tiltDeg =
        validTilt.reduce((s, p) => s + (p.tiltDeg ?? p.slopeDeg ?? 30), 0) / validTilt.length;
    }
  }

  const totalPanels = calpinage.total_panels ?? geometry.panels?.count ?? 0;
  const storedNearLossPct = calpinage.total_loss_pct != null
    ? Number(calpinage.total_loss_pct)
    : (geometry.shading?.totalLossPct ?? 0);

  const shadingResult = await computeCalpinageShading({
    lat,
    lon,
    geometry,
    storedNearLossPct,
    options: { includePerPanelBreakdown: true },
  });
  const hasGps =
    lat != null &&
    lon != null &&
    !isNaN(lat) &&
    !isNaN(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180;
  const hasPanels = hasPanelsInGeometry(geometry);
  const existingShading = geometry?.shading && typeof geometry.shading === "object" ? geometry.shading : {};
  const rawShading = buildStructuredShading(shadingResult, hasGps, hasPanels, existingShading);
  const meta = shadingResult.farMetadata
    ? { step_deg: shadingResult.farMetadata.step_deg, resolution_m: shadingResult.farMetadata.resolution_m, algorithm: shadingResult.farMetadata.meta?.algorithm }
    : {};
  let shading = normalizeCalpinageShading(rawShading, meta);

  /**
   * Dès qu’il existe des pans avec au moins un module, la vérité production pour l’ombrage
   * est roof_pans[].shadingCombinedPct (voir computeProductionMultiPan). On aligne :
   * - installation.shading_loss_pct
   * - shading.combined.totalLossPct (KPI documentaire / PDF / cohérence avec le moteur)
   * sur la moyenne pondérée par nombre de modules — sans toucher au moteur (pas de double perte).
   * Mono-pan API (pas de pans ou pas de modules sur les pans) : reste le total raycast shadingResult.totalLossPct.
   *
   * @see docs/shading-kpi-contract.md §2.4 (KPI pondéré multi-pans vs combined moteur).
   */
  const roofPansForKpi = Array.isArray(pans)
    ? pans.map((p) => ({
        id: p.id,
        azimuth: typeof p.azimuth === "number" ? p.azimuth : (p.orientationDeg ?? 180),
        tilt: typeof p.tilt === "number" ? p.tilt : (p.tiltDeg ?? 30),
        panelCount: Math.max(0, Math.floor(Number(p.panelCount ?? p.panel_count) || 0)),
        shadingCombinedPct: Math.max(0, Math.min(100, Number(p.shadingCombinedPct ?? p.shading_combined_pct) || 0)),
      }))
    : [];
  const weightedCombinedKpi = computeWeightedShadingCombinedPct(roofPansForKpi);
  let shadingLossPct = shadingResult.totalLossPct;
  if (weightedCombinedKpi != null) {
    shadingLossPct = weightedCombinedKpi;
    shading = {
      ...shading,
      combined: { ...shading.combined, totalLossPct: weightedCombinedKpi },
      /** Miroir obligatoire de la vérité officielle (combined.totalLossPct) — évite divergences lecteurs legacy. */
      totalLossPct: weightedCombinedKpi,
    };
  }

  const officialShading = buildOfficialShadingFromComputeResult(shadingResult, hasGps, hasPanels);
  const legacyShadingSnapshot = {
    totalLossPct: shadingLossPct,
    near: shading.near,
    far: shading.far,
    combined: shading.combined,
    perPanel: shading.perPanel ?? [],
  };
  const shadingOfficialDiff = computeShadingOfficialDiff(legacyShadingSnapshot, officialShading);
  logShadingOfficialDriftIfNeeded(shadingOfficialDiff, { studyId, versionId: versionNum });

  const params = await loadOrgParams(orgId);

  const calpinageSnapRes = await pool.query(
    `SELECT snapshot_json FROM calpinage_snapshots
     WHERE study_version_id = $1 AND organization_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [version.id, orgId]
  );
  const calpinagePayload =
    calpinageSnapRes.rows[0]?.snapshot_json?.payload &&
    typeof calpinageSnapRes.rows[0].snapshot_json.payload === "object"
      ? calpinageSnapRes.rows[0].snapshot_json.payload
      : null;
  const payloadForInverter =
    calpinagePayload && typeof calpinagePayload === "object"
      ? calpinagePayload
      : geometry && typeof geometry === "object" && (geometry.inverter || geometry.inverter_totals)
        ? {
            inverter: geometry.inverter,
            inverter_totals: geometry.inverter_totals,
            pvParams: geometry.pvParams,
            inverter_family: geometry.inverter_family,
          }
        : null;
  let pv_inverter = extractPvInverterFromCalpinagePayload(payloadForInverter);
  if (payloadForInverter && pv_inverter) {
    pv_inverter = await resolvePvInverterEngineFields(pool, payloadForInverter, pv_inverter);
  }

  // Panneau sélectionné — snapshot prioritaire, sinon géométrie persistée (tolérance legacy)
  const _rawPanel =
    calpinagePayload?.panelSpec ??
    calpinagePayload?.panel ??
    geometry?.panelSpec ??
    geometry?.panel ??
    null;
  const _panelPowerWc = resolvePanelPowerWc(_rawPanel);
  const _panelTempCoeff     = _rawPanel != null ? (Number(_rawPanel.temp_coeff_pct_per_deg   ?? null) || null) : null;
  const _panelDegAnnual     = _rawPanel != null ? (Number(_rawPanel.degradation_annual_pct    ?? null) || null) : null;
  const _panelDegFirstYear  = _rawPanel != null ? (Number(_rawPanel.degradation_first_year_pct ?? null) || null) : null;

  let panel_input = null;
  if (_rawPanel && typeof _rawPanel === "object") {
    const baseInput = {
      id: _rawPanel.id ?? _rawPanel.panel_id ?? null,
      panel_id: _rawPanel.panel_id ?? _rawPanel.id ?? null,
      power_wc: _panelPowerWc,
      brand: _rawPanel.brand ?? null,
      model: _rawPanel.model ?? _rawPanel.model_ref ?? null,
      temp_coeff_pct_per_deg: _panelTempCoeff,
      degradation_annual_pct: _panelDegAnnual,
      degradation_first_year_pct: _panelDegFirstYear,
    };
    panel_input = await applyPanelPowerFromCatalog(pool, baseInput);
    if (
      panel_input &&
      (panel_input.power_wc == null || !Number.isFinite(Number(panel_input.power_wc))) &&
      _panelPowerWc != null
    ) {
      panel_input = { ...panel_input, power_wc: _panelPowerWc };
    }
    if (
      panel_input &&
      (panel_input.power_wc == null || !Number.isFinite(Number(panel_input.power_wc)))
    ) {
      panel_input = null;
    }
  } else if (_panelPowerWc != null) {
    panel_input = {
      power_wc: _panelPowerWc,
      brand: null,
      model: null,
      temp_coeff_pct_per_deg: null,
      degradation_annual_pct: null,
      degradation_first_year_pct: null,
    };
  }

  if (process.env.NODE_ENV !== "production") {
    console.log("[solarnextPayloadBuilder] panel_input =", panel_input ?? "absent (fallback kit_panel_power_w)");
  }

  const economicSnapshotRes = await pool.query(
    `SELECT config_json FROM economic_snapshots
     WHERE study_version_id = $1 AND organization_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [version.id, orgId]
  );
  const economicSnapshot = economicSnapshotRes.rows[0]?.config_json ?? null;
  const capexTotalTtc =
    economicSnapshot?.capex_total_ttc ??
    economicSnapshot?.totals?.ttc ??
    null;

  const energyProfileEarly =
    energyLead.energy_profile && typeof energyLead.energy_profile === "object"
      ? energyLead.energy_profile
      : null;
  const explicitTariffKwh = pickExplicitProjectTariffKwh({
    energyProfile: energyProfileEarly,
    economicSnapshot,
    studyData,
  });
  const tarifKwh =
    explicitTariffKwh != null
      ? explicitTariffKwh
      : (params.economics?.price_eur_kwh ?? DEFAULT_ECONOMICS_FALLBACK.price_eur_kwh);

  // Prix batterie physique : uniquement depuis config_json (devis technique), jamais settings.pricing
  const batteryPhysicalConfig = economicSnapshot?.battery_physical ?? economicSnapshot?.batteries?.physical;
  const configKeyUsed = economicSnapshot?.battery_physical != null ? "battery_physical" : (economicSnapshot?.batteries?.physical != null ? "batteries.physical" : null);
  if (configKeyUsed && process.env.NODE_ENV !== "production") {
    console.log("[solarnextPayloadBuilder] battery physical price source:", configKeyUsed);
  }
  const pickPriceTtc = (cfg) => {
    if (!cfg || typeof cfg !== "object") return null;
    const v = cfg.price_ttc ?? cfg.priceTtc ?? cfg.total_ttc ?? cfg.totalTtc;
    if (v != null && Number.isFinite(Number(v))) return Number(v);
    if (cfg.price != null && Number.isFinite(Number(cfg.price)))
      return Number(cfg.price) * (Number(cfg.qty) ?? 1);
    return null;
  };
  const batteryPhysicalPriceTtcRaw = pickPriceTtc(batteryPhysicalConfig);
  const batteryPhysicalPriceTtc =
    batteryPhysicalPriceTtcRaw != null && Number.isFinite(batteryPhysicalPriceTtcRaw) ? batteryPhysicalPriceTtcRaw : 0;

  const nom =
    baseLead.full_name ||
    [baseLead.first_name, baseLead.last_name].filter(Boolean).join(" ").trim() ||
    "Client";
  const ville = siteAddress?.city || "";

  const energyProfile =
    energyLead.energy_profile && typeof energyLead.energy_profile === "object"
      ? energyLead.energy_profile
      : null;
  const engine =
    energyProfile?.engine && typeof energyProfile.engine === "object" ? energyProfile.engine : null;
  const hourlyFromEngine =
    engine?.hourly && Array.isArray(engine.hourly) && engine.hourly.length >= 8760
      ? engine.hourly.slice(0, 8760)
      : null;
  const hourlyLegacy =
    energyProfile?.hourly && Array.isArray(energyProfile.hourly) && energyProfile.hourly.length >= 8760
      ? energyProfile.hourly.slice(0, 8760)
      : null;
  const profileHourly = hourlyFromEngine ?? hourlyLegacy;
  const profileAnnualKwh =
    (typeof engine?.annual_kwh === "number" && Number.isFinite(engine.annual_kwh)
      ? engine.annual_kwh
      : null) ?? energyProfile?.summary?.annual_kwh;

  let annuelleKwh =
    energyLead.consumption_annual_kwh ?? energyLead.consumption_annual_calculated_kwh ?? 0;
  let mensuelle = null;
  if (profileHourly) {
    annuelleKwh = profileAnnualKwh ?? profileHourly.reduce((a, b) => a + (Number(b) || 0), 0);
  } else if (energyLead.consumption_mode === "MONTHLY") {
    const cmRes =
      meterRow?.id != null
        ? await pool.query(
            `SELECT month, kwh FROM lead_consumption_monthly
             WHERE meter_id = $1 AND year = extract(year from now())::int ORDER BY month`,
            [meterRow.id]
          )
        : await pool.query(
            `SELECT month, kwh FROM lead_consumption_monthly
             WHERE lead_id = $1 AND year = extract(year from now())::int ORDER BY month`,
            [leadId]
          );
    const byMonth = {};
    cmRes.rows.forEach((r) => { byMonth[r.month] = r.kwh; });
    mensuelle = [];
    for (let m = 1; m <= 12; m++) {
      mensuelle.push(Number(byMonth[m]) || 0);
    }
    annuelleKwh = mensuelle.reduce((a, b) => a + b, 0);
  }

  const options = studyData.options || {};

  // Source officielle devis technique : economic_snapshot.config_json (format quote-prep)
  const config = economicSnapshot && typeof economicSnapshot === "object" ? economicSnapshot : {};
  const batteriesConfig = config.batteries;

  // Batterie physique : même union que le prix (battery_physical | batteries.physical) pour ne pas perdre l’UUID / technique en legacy.
  const physicalConfig = batteriesConfig?.physical ?? economicSnapshot?.battery_physical ?? null;
  const batterySection = economicSnapshot?.battery ?? economicSnapshot?.batterie ?? null;
  const optionsBatterie = options?.batterie === true || options?.batterie === "oui";
  const capacityFromPhysical =
    physicalConfig?.enabled === true
      ? Number(physicalConfig.capacity_kwh ?? physicalConfig.product_snapshot?.usable_kwh ?? 0) || null
      : null;
  const capacityFromSnapshot = batterySection?.capacity_kwh ?? batterySection?.capacite_kwh ?? null;
  const capacityFromOptions = options?.capacite_batterie_kwh != null ? Number(options.capacite_batterie_kwh) : null;
  const batteryEnabledFromPhysical =
    physicalConfig?.enabled === true && (capacityFromPhysical != null ? capacityFromPhysical > 0 : true);
  const batteryEnabledLegacy = batterySection
    ? (capacityFromSnapshot != null && capacityFromSnapshot > 0) || (capacityFromOptions != null && capacityFromOptions > 0)
    : optionsBatterie;
  let batteryEnabled = batteryEnabledFromPhysical || batteryEnabledLegacy;
  const capacityKwh =
    capacityFromPhysical ??
    capacityFromSnapshot ??
    (physicalConfig?.enabled === true ? capacityFromOptions : null) ??
    (batterySection ? (capacityFromSnapshot ?? capacityFromOptions) : null) ??
    (batteryEnabled ? capacityFromOptions : null);

  // Si l'UI a une batterie sélectionnée (physical.enabled) mais capacity_kwh absente → config invalide
  if (physicalConfig?.enabled === true && (capacityKwh == null || !Number.isFinite(capacityKwh) || capacityKwh <= 0)) {
    console.error(
      "[solarnextPayloadBuilder] CONFIG BATTERIE PHYSIQUE INVALIDE: batteries.physical.enabled=true mais capacity_kwh absent ou invalide. " +
      "Vérifier que le devis enregistre capacity_kwh ou product_snapshot.usable_kwh (sélection catalogue PV)."
    );
    batteryEnabled = false;
  }

  const capacityFinal = capacityKwh != null && Number.isFinite(capacityKwh) && capacityKwh > 0
    ? capacityKwh
    : (batteryEnabled ? capacityFromOptions : null) ?? null;

  let battery_input = {
    enabled: !!batteryEnabled && capacityFinal != null && capacityFinal > 0,
    capacity_kwh: capacityFinal,
    roundtrip_efficiency:
      physicalConfig?.product_snapshot?.roundtrip_efficiency_pct != null
        ? Number(physicalConfig.product_snapshot.roundtrip_efficiency_pct) / 100
        : batterySection?.roundtrip_efficiency ?? batterySection?.efficiency ?? null,
    max_charge_kw:
      physicalConfig?.product_snapshot?.max_charge_kw ??
      batterySection?.max_charge_kw ??
      batterySection?.charge_kw ??
      null,
    max_discharge_kw:
      physicalConfig?.product_snapshot?.max_discharge_kw ??
      batterySection?.max_discharge_kw ??
      batterySection?.discharge_kw ??
      null,
  };

  // Catalogue pv_batteries = vérité technique (capacité, rendement, puissances) si UUID actif.
  // Prix / finance_input.battery_physical_price_ttc reste figé sur le snapshot devis (non modifié ici).
  battery_input = await applyPhysicalBatteryTechnicalFromCatalog(pool, physicalConfig, battery_input);

  if (battery_input.capacity_kwh != null && Number(battery_input.capacity_kwh) <= 0) {
    battery_input.enabled = false;
    battery_input.capacity_kwh = null;
  }
  // Valeurs par défaut raisonnables si puissance non fournie (pour simulateBattery8760)
  if (battery_input.enabled && battery_input.capacity_kwh != null) {
    if (battery_input.max_charge_kw == null || !Number.isFinite(Number(battery_input.max_charge_kw))) {
      battery_input.max_charge_kw = Math.max(1, battery_input.capacity_kwh / 2);
    }
    if (battery_input.max_discharge_kw == null || !Number.isFinite(Number(battery_input.max_discharge_kw))) {
      battery_input.max_discharge_kw = Math.max(1, battery_input.capacity_kwh / 2);
    }
    if (battery_input.roundtrip_efficiency == null || !Number.isFinite(Number(battery_input.roundtrip_efficiency))) {
      battery_input.roundtrip_efficiency = 0.9;
    }
  }

  // ── MULTI-BATTERIES PHYSIQUES — V2 power-scaling ─────────────────────────
  // qty > 1 = N batteries identiques couplées en parallèle.
  // Le prix est déjà multiplié dans pickPriceTtc (ligne ~496).
  // Ici on multiplie les grandeurs PHYSIQUES (capacité, puissances) transmises
  // au moteur 8760h, APRÈS que le catalogue a fourni les valeurs unitaires et
  // APRÈS que les defaults ont été calculés à partir de la capacité unitaire.
  // NE PAS multiplier : roundtrip_efficiency, ratios, pourcentages.
  //
  // Modèle V2 de puissance (champs lus depuis catalogue via resolveBatteryFromDb) :
  //   scalable = false  → puissance totale = puissance unitaire (onduleur unique, BMS figé)
  //   scalable = true   → puissance totale = min(qty × unit_kw, max_system_*_kw ?? +∞)
  //
  // _catalog_merged = true : marqueur qui indique que ce bloc a déjà été exécuté.
  // calc.controller appelle applyPhysicalBatteryTechnicalFromCatalog une 2e fois ;
  // si ce flag est présent, calc.controller skip ce re-merge (qui écraserait les
  // valeurs multipliées par qty avec les valeurs unitaires du catalogue).
  if (battery_input.enabled && battery_input.capacity_kwh != null) {
    const physicalQty = Math.max(1, Math.round(Number(physicalConfig?.qty ?? 1) || 1));
    if (physicalQty > 1) {
      // ── Capacité : toujours proportionnelle à qty ──
      battery_input.capacity_kwh = battery_input.capacity_kwh * physicalQty;
      battery_input.usable_kwh   = battery_input.usable_kwh != null
        ? battery_input.usable_kwh * physicalQty
        : battery_input.capacity_kwh;

      // ── Puissance : modèle V2 scalable/capped ──
      // Lire les valeurs UNITAIRES AVANT tout scaling.
      const unitChargeKw    = Number(battery_input.max_charge_kw)    || 0;
      const unitDischargeKw = Number(battery_input.max_discharge_kw) || 0;
      // scalable vient du catalogue via mergeBatteryInputWithCatalogRow ; défaut = true (compat)
      const scalable = battery_input.scalable !== false; // false strict seulement si catalogue dit false

      if (!scalable) {
        // Puissance FIGÉE : l'onduleur hybride ou le BMS ne permet pas d'additionner les unités.
        // La puissance système reste égale à la puissance d'UNE unité, quel que soit qty.
        // max_charge_kw / max_discharge_kw restent inchangés (valeurs unitaires déjà dans battery_input).
        battery_input.battery_power_capped = physicalQty > 1; // toujours vrai ici (physicalQty > 1)
      } else {
        // Puissance SCALABLE : parallèle réel, éventuellement capée par max_system_*_kw.
        const rawCharge    = unitChargeKw    * physicalQty;
        const rawDischarge = unitDischargeKw * physicalQty;

        const capCharge    = battery_input.max_system_charge_kw    != null
          ? Number(battery_input.max_system_charge_kw)    : null;
        const capDischarge = battery_input.max_system_discharge_kw != null
          ? Number(battery_input.max_system_discharge_kw) : null;

        battery_input.max_charge_kw    = (capCharge    != null && Number.isFinite(capCharge)    && capCharge    > 0)
          ? Math.min(rawCharge,    capCharge)    : rawCharge;
        battery_input.max_discharge_kw = (capDischarge != null && Number.isFinite(capDischarge) && capDischarge > 0)
          ? Math.min(rawDischarge, capDischarge) : rawDischarge;

        battery_input.battery_power_capped =
          (capCharge    != null && Number.isFinite(capCharge)    && rawCharge    > capCharge)    ||
          (capDischarge != null && Number.isFinite(capDischarge) && rawDischarge > capDischarge);
      }
    } else {
      // qty = 1 : pas de scaling, pas de capping
      battery_input.battery_power_capped = false;
    }

    // Alias puissances (moteur 8760h + traçabilité)
    battery_input.charge_power_kw    = battery_input.max_charge_kw;
    battery_input.discharge_power_kw = battery_input.max_discharge_kw;

    // Toujours exposer battery_units (= 1 si mono, N si multi) pour le mapper scénario / PDF
    battery_input.battery_units = physicalQty;
    // Flag : catalogue déjà mergé + qty déjà appliqué → calc.controller doit sauter son re-merge
    battery_input._catalog_merged = true;
  }
  // ── FIN MULTI-BATTERIES ───────────────────────────────────────────────────

  // Batterie virtuelle : priorité config_json.virtualBattery (grilles) puis battery_virtual / batteries.virtual
  const vbNew = economicSnapshot?.virtualBattery;
  const meterPowerKva = Number(energyLead.meter_power_kva) || 9;
  const installPanels = Number(totalPanels) || 0;
  const geomResolvedWc =
    panel_input &&
    panel_input.power_wc != null &&
    Number.isFinite(Number(panel_input.power_wc)) &&
    Number(panel_input.power_wc) > 0
      ? Number(panel_input.power_wc)
      : resolvePanelPowerWc(geometry?.panelSpec ?? geometry?.panel ?? null);
  let pvPowerKwc = Number(calpinage.total_power_kwc);
  if (!Number.isFinite(pvPowerKwc) || pvPowerKwc <= 0) pvPowerKwc = 0;
  if (installPanels > 0 && geomResolvedWc != null) {
    const recomputedPv = computeInstalledKwcRounded3(installPanels, geomResolvedWc);
    if (
      recomputedPv != null &&
      (pvPowerKwc <= 0 || isInstalledKwcDivergent(pvPowerKwc, recomputedPv))
    ) {
      pvPowerKwc = recomputedPv;
    }
  }
  let virtual_battery_input;

  /** Capacité virtuelle : uniquement si explicitement > 0 dans la config (aucun défaut arbitraire). */
  const pickExplicitVirtualCapacityKwh = (src) => {
    if (!src || typeof src !== "object") return null;
    for (const v of [src.capacity_kwh, src.capacityKwh, src.credit_cap_kwh]) {
      if (v != null && Number.isFinite(Number(v)) && Number(v) > 0) return Number(v);
    }
    return null;
  };

  // Grille org : uniquement si providers non vide (sinon fallback snapshot / legacy, pas d’abonnement 0 € ambigu).
  const vbOrgSettings = params.pv?.virtual_battery;
  const vbOrgGridOk = Boolean(
    vbNew?.provider && vbOrgSettings && vbHasExploitableProviderGrid(vbOrgSettings)
  );
  let vbMonthlyHtFromOrgGrid = 0;
  if (vbOrgGridOk) {
    vbMonthlyHtFromOrgGrid = resolveVirtualBatteryMonthlyFromGrid(vbOrgSettings, {
      provider: vbNew.provider,
      contractType: vbNew.contractType || "BASE",
      meterPowerKva,
      pvPowerKwc,
      capacityKwh: vbNew.capacityKwh,
    });
  }

  if (vbOrgGridOk && vbMonthlyHtFromOrgGrid > 0) {
    const annualTtc = vbMonthlyHtFromOrgGrid * 12 * 1.2;
    const capVbNew = pickExplicitVirtualCapacityKwh(vbNew);
    virtual_battery_input = {
      enabled: true,
      provider_code: vbNew.provider,
      contract_type: vbNew.contractType || "BASE",
      annual_subscription_ttc: annualTtc,
      ...(capVbNew != null ? { capacity_kwh: capVbNew } : {}),
      cost_per_kwh_storage_ttc: null,
      cost_per_kwh_storage: null,
      fee_fixed_ttc: null,
      fee_fixed: null,
      vat_rate: 20,
      estimated_savings_annual: null,
      credit_ratio: 1,
      credit_cap_kwh: null,
      cost_basis: "credited",
    };
  } else {
    const virtualConfig = economicSnapshot?.battery_virtual ?? batteriesConfig?.virtual;
    const vbConfig =
      virtualConfig?.enabled === true
        ? {
            enabled: true,
            annual_subscription_ttc:
              virtualConfig.annual_subscription_ttc ??
              (Number(virtualConfig.price ?? 0) * Number(virtualConfig.qty ?? 1)),
            cost_per_kwh_storage_ttc: virtualConfig.cost_per_kwh_storage_ttc ?? virtualConfig.cost_per_kwh_storage,
            cost_per_kwh_storage: virtualConfig.cost_per_kwh_storage_ttc ?? virtualConfig.cost_per_kwh_storage,
            fee_fixed_ttc: virtualConfig.fee_fixed_ttc ?? virtualConfig.fee_fixed,
            fee_fixed: virtualConfig.fee_fixed_ttc ?? virtualConfig.fee_fixed,
            vat_rate: virtualConfig.vat_rate,
            estimated_savings_annual: virtualConfig.estimated_savings_annual,
            capacity_kwh: virtualConfig.capacity_kwh,
            capacityKwh: virtualConfig.capacityKwh,
            credit_cap_kwh: virtualConfig.credit_cap_kwh,
            cost_basis: virtualConfig.cost_basis,
          }
        : economicSnapshot?.virtual_battery ?? options?.batterie_virtuelle ?? null;
    virtual_battery_input =
      vbConfig && (vbConfig.enabled === true || vbConfig.enabled === "oui")
        ? {
            enabled: true,
            annual_subscription_ttc: vbConfig.annual_subscription_ttc,
            capacity_kwh: pickExplicitVirtualCapacityKwh(vbConfig),
            cost_per_kwh_storage_ttc: vbConfig.cost_per_kwh_storage_ttc ?? vbConfig.cost_per_kwh_storage,
            cost_per_kwh_storage: vbConfig.cost_per_kwh_storage_ttc ?? vbConfig.cost_per_kwh_storage,
            fee_fixed_ttc: vbConfig.fee_fixed_ttc ?? vbConfig.fee_fixed,
            fee_fixed: vbConfig.fee_fixed_ttc ?? vbConfig.fee_fixed,
            vat_rate: vbConfig.vat_rate,
            estimated_savings_annual: vbConfig.estimated_savings_annual,
            credit_ratio: 1,
            credit_cap_kwh: vbConfig.credit_cap_kwh ?? null,
            cost_basis: vbConfig.cost_basis ?? "credited",
          }
        : { enabled: false };
  }
  if (
    virtual_battery_input.enabled &&
    (virtual_battery_input.annual_subscription_ttc == null ||
      !Number.isFinite(Number(virtual_battery_input.annual_subscription_ttc)))
  ) {
    virtual_battery_input.annual_subscription_ttc = 0;
  }

  if (
    virtual_battery_input.enabled &&
    virtual_battery_input.provider_code &&
    (virtual_battery_input.activation_cost_ttc == null ||
      !Number.isFinite(Number(virtual_battery_input.activation_cost_ttc)))
  ) {
    const actTtc = await resolveVirtualBatteryActivationFeeTtcFromOrgDb(
      orgId,
      virtual_battery_input.provider_code,
      virtual_battery_input.contract_type ?? "BASE",
      meterPowerKva
    );
    if (actTtc != null && actTtc > 0) {
      virtual_battery_input.activation_cost_ttc = actTtc;
    }
  }

  const roofPans = roofPansForKpi;

  // CSV prioritaire : résolution via entity_documents (lead puis study). On ne dépend PAS de form.conso.csv_path frontend.
  const { csvPath: resolvedCsvPath } = await resolveConsumptionCsv({
    db: pool,
    organizationId: orgId,
    leadId,
    studyId,
  });
  const csvPath = resolvedCsvPath ?? null;

  // Log temporaire — décision source conso (sera affiché avant calc)
  if (process.env.NODE_ENV !== "production") {
    console.log(JSON.stringify({
      tag: "CONSO_SOURCE_DECISION",
      source: csvPath ? "CSV" : "SYNTHETIC",
      csvPath: csvPath ?? null,
    }));
  } else {
    console.log(JSON.stringify({
      tag: "CONSO_SOURCE_DECISION",
      source: csvPath ? "CSV" : "SYNTHETIC",
    }));
  }

  const payload = {
    studyId,
    versionId: versionNum,
    leadId,
    lead: {
      nom,
      ville,
      lat,
      lon,
      puissance_kva: Number(energyLead.meter_power_kva) || 9,
      tarif_kwh: tarifKwh,
    },
    consommation: {
      mode: mapConsumptionMode(energyLead.consumption_mode),
      annuelle_kwh: annuelleKwh,
      mensuelle: mensuelle,
      profil: mapConsumptionProfile(energyLead.consumption_profile),
      csv_path: csvPath,
      ...(profileHourly && !csvPath ? { hourly: profileHourly } : {}),
      // Équipements énergétiques (V8)
      equipement_actuel: energyLead.equipement_actuel ?? null,
      equipement_actuel_params:
        energyLead.equipement_actuel_params &&
        typeof energyLead.equipement_actuel_params === "object"
          ? energyLead.equipement_actuel_params
          : null,
      equipements_a_venir:
        energyLead.equipements_a_venir && typeof energyLead.equipements_a_venir === "object"
          ? energyLead.equipements_a_venir
          : null,
    },
    installation: {
      orientation_deg: Math.round(orientationDeg * 10) / 10,
      tilt_deg: Math.round(tiltDeg * 10) / 10,
      panneaux_count: totalPanels,
      reseau_type: (energyLead.grid_type || "mono").toLowerCase() === "tri" ? "tri" : "mono",
      shading_loss_pct: shadingLossPct,
      shading,
      roof_pans: roofPans,
    },
    options: {
      remise: options.remise || null,
      batterie: options.batterie || false,
      capacite_batterie_kwh: options.capacite_batterie_kwh ?? null,
    },
    parameters_snapshot: {
      pricing: params.pricing,
      economics: params.economics,
      pvtech: params.pvtech,
      components: params.components,
      pv: params.pv ?? null,
    },
    finance_input: {
      capex_ttc: capexTotalTtc,
      battery_physical_price_ttc: Number(batteryPhysicalPriceTtc) || 0,
    },
    /** Onduleur réel (snapshot calpinage) — moteur finance (remplacement année N). */
    pv_inverter,
    /** Panneau réel sélectionné (snapshot calpinage) — power_wc injecté dans calcul production.
     *  Obligatoire pour le moteur : sans panel_input valide (power_wc), le calcul lève une erreur bloquante. */
    panel_input,
    battery_input,
    virtual_battery_input,
  };

  if (isUseOfficialShadingEnabled()) {
    payload.shading_official = {
      totalLossPct: officialShading.totalLossPct,
      near: officialShading.near,
      far: officialShading.far,
      combined: officialShading.combined,
      perPanel: officialShading.perPanel,
      meta: officialShading.meta,
    };
    payload.shading_debug = {
      legacy: legacyShadingSnapshot,
      official: {
        totalLossPct: officialShading.totalLossPct,
        near: officialShading.near,
        far: officialShading.far,
        combined: officialShading.combined,
        perPanel: officialShading.perPanel,
        meta: officialShading.meta,
      },
      diff: shadingOfficialDiff,
    };
  }

  if (shadingUiSnapshot != null && typeof shadingUiSnapshot === "object") {
    const diffUiOfficial = computeUiVsOfficialShadingDiff(shadingUiSnapshot, officialShading);
    logShadingUiServerDriftIfNeeded(diffUiOfficial, { studyId, versionId: versionNum });
    payload.shading_parity_debug = {
      ui: slimUiForParityDebug(shadingUiSnapshot),
      official: slimOfficialForParityDebug(officialShading),
      diff: {
        totalLossPctDiff: diffUiOfficial.totalLossPctDiff,
        nearDiff: diffUiOfficial.nearDiff,
        farDiff: diffUiOfficial.farDiff,
        combinedDiff: diffUiOfficial.combinedDiff,
        maxPanelDiff: diffUiOfficial.maxPanelDiff,
        panelDiffCount: diffUiOfficial.panelDiffCount,
        isWithinTolerance: diffUiOfficial.isWithinTolerance,
      },
      checkedAt: new Date().toISOString(),
      parityStatus: parityStatusFromDiff(diffUiOfficial, shadingUiSnapshot, officialShading),
      trace: {
        payload_installation_shading_loss_pct: shadingLossPct,
        payload_installation_shading_combined_totalLossPct:
          shading?.combined && typeof shading.combined === "object"
            ? shading.combined.totalLossPct ?? null
            : null,
        calc_form_shadingLossPct_source:
          "buildLegacyPayloadFromSolarNext : installation.shading_loss_pct → form.shadingLossPct (inchangé)",
      },
    };
  }

  // LOG 4 — CSV injecté dans le payload (sera form.conso.csv_path après adaptation)
  if (process.env.NODE_ENV !== "production") {
    console.log(JSON.stringify({
      tag: "DEBUG CSV IN PAYLOAD",
      "payload.consommation.csv_path": payload.consommation?.csv_path ?? null,
    }));
  }

  if (process.env.NODE_ENV !== "production") {
    console.log("[C1] CAPEX injection =", {
      capex_total_ttc: economicSnapshot?.capex_total_ttc,
      totals_ttc: economicSnapshot?.totals?.ttc,
      injected_capex_ttc: capexTotalTtc,
    });
  }

  return payload;
}
