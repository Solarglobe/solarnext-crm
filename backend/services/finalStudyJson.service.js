/**
 * ONE_TRUE_FINAL_STUDY_JSON — Consolidation après validation + calcul backend.
 * Ne modifie pas les moteurs shading/production. Wiring uniquement.
 */

const STUDY_VERSION = "study_v1_final";
const CALPINAGE_VERSION = "calpinage_v1_final";

function safeNum(v, fallback) {
  if (typeof v === "number" && Number.isFinite(v) && !Number.isNaN(v)) return v;
  return fallback != null ? fallback : 0;
}

/**
 * Dérive le bloc "geometry" (schéma FINAL_JSON V1) depuis geometry_json.
 * @param {object} geometryJson - geometry_json (buildGeometryForExport)
 * @returns {object|null} geometry block ou null si invalide
 */
export function deriveGeometryFromGeometryJson(geometryJson) {
  if (!geometryJson || typeof geometryJson !== "object") return null;
  const vrd = geometryJson.validatedRoofData;
  if (!vrd || !Array.isArray(vrd.pans)) return null;

  const rawPans = vrd.pans;
  const pansOfficial = rawPans.map((p) => ({
    id: p.id,
    azimuth: safeNum(p.azimuth, p.orientationDeg ?? 180),
    tilt: safeNum(p.tilt, p.tiltDeg ?? 0),
    panelCount: Math.max(0, Math.floor(safeNum(p.panelCount, 0))),
    surface: safeNum(p.surface, p.surfaceM2 ?? 0),
    geometryRef: p.geometryRef ?? p.id,
    shadingNearPct: safeNum(p.shadingNearPct, 0),
    shadingFarPct: safeNum(p.shadingFarPct, 0),
    shadingCombinedPct: safeNum(p.shadingCombinedPct, 0),
  }));

  const panels = [];
  const frozenBlocks = geometryJson.frozenBlocks || [];
  for (const bl of frozenBlocks) {
    const list = bl.panels || [];
    for (let idx = 0; idx < list.length; idx++) {
      const p = list[idx];
      panels.push({
        id: `${bl.id}_${idx}`,
        panId: bl.panId ?? null,
        position:
          p && p.center && typeof p.center === "object"
            ? { x: safeNum(p.center.x, 0), y: safeNum(p.center.y, 0) }
            : null,
        orientation: bl.orientation ?? null,
        state: p && p.state != null ? p.state : null,
      });
    }
  }

  const norm = geometryJson.shading && typeof geometryJson.shading === "object" ? geometryJson.shading : null;
  const shadingExport = norm
    ? {
        near: norm.near && typeof norm.near === "object" ? { ...norm.near } : { totalLossPct: safeNum(norm.nearLossPct, 0) },
        far:
          norm.far && typeof norm.far === "object"
            ? { ...norm.far }
            : {
                totalLossPct: norm.farLossPct === null ? null : safeNum(norm.farLossPct, 0),
                source: norm.farSource ?? "RELIEF_ONLY",
              },
        combined:
          norm.combined && typeof norm.combined === "object"
            ? { ...norm.combined }
            : {
                totalLossPct: (() => {
                  const v = norm.combined?.totalLossPct ?? norm.totalLossPct;
                  if (v === null) return null;
                  return safeNum(v, 0);
                })(),
              },
        totalLossPct: (() => {
          const v = norm.combined?.totalLossPct ?? norm.totalLossPct;
          if (v === null) return null;
          return safeNum(v, 0);
        })(),
        confidence: norm.shadingQuality?.confidence ?? norm.far?.confidenceLevel ?? "UNKNOWN",
        source: norm.far?.source ?? norm.farSource ?? "RELIEF_ONLY",
        farHorizonKind: norm.shadingQuality?.farHorizonKind ?? norm.far?.farHorizonKind ?? "SYNTHETIC",
        computedAt:
          norm.computedAt != null
            ? typeof norm.computedAt === "number"
              ? new Date(norm.computedAt).toISOString()
              : String(norm.computedAt)
            : new Date().toISOString(),
      }
    : null;
  if (norm && Array.isArray(norm.perPanel)) shadingExport.perPanel = norm.perPanel;
  if (norm && norm.horizonMask != null && typeof norm.horizonMask === "object") shadingExport.horizonMask = norm.horizonMask;
  if (norm && norm.shadingQuality != null && typeof norm.shadingQuality === "object") shadingExport.shadingQuality = norm.shadingQuality;

  const panel = geometryJson.panel && typeof geometryJson.panel === "object" ? geometryJson.panel : null;
  const panelSpec = panel
    ? {
        id: panel.id ?? panel.panel_id ?? null,
        panel_id: panel.panel_id ?? panel.id ?? null,
        brand: panel.brand ?? null,
        model: panel.model ?? panel.model_ref ?? null,
        reference: panel.model_ref ?? panel.reference ?? null,
        powerWc: safeNum(panel.power_wc, 0),
        widthM: safeNum(panel.width_mm, 0) / 1000,
        heightM: safeNum(panel.height_mm, 0) / 1000,
        technology: panel.technology ?? null,
        efficiency: panel.efficiency_pct ?? panel.efficiency ?? null,
      }
    : { module: "unknown" };

  return {
    meta: {
      version: geometryJson.meta?.version ?? CALPINAGE_VERSION,
      generatedAt: geometryJson.meta?.generatedAt ?? new Date().toISOString(),
      engine: geometryJson.meta?.engine ?? { shading: "near+far+HD", production: "multi-pan" },
    },
    roof: {
      scale: vrd.scale ?? null,
      north: vrd.north ?? null,
      pans: pansOfficial,
    },
    pans: pansOfficial,
    panels,
    panelSpec,
    shading: shadingExport,
    production: null,
    geometry3d: geometryJson.geometry3d && typeof geometryJson.geometry3d === "object" ? geometryJson.geometry3d : null,
  };
}

/**
 * Construit le bloc hardware depuis geometry_json (et geometry déjà dérivé).
 * Source unique : geometry_json. Aucun recalcul moteur.
 */
function buildHardwareFromGeometryJson(geometryJson, geometry) {
  const panel = geometry && geometry.panelSpec && typeof geometry.panelSpec === "object"
    ? { ...geometry.panelSpec }
    : null;

  let inverter = null;
  const invSrc = geometryJson.inverter && typeof geometryJson.inverter === "object" ? geometryJson.inverter : null;
  if (invSrc) {
    inverter = {
      id: invSrc.id ?? invSrc.inverter_id ?? null,
      inverter_id: invSrc.inverter_id ?? invSrc.id ?? null,
      brand: invSrc.brand ?? null,
      name: invSrc.name ?? null,
      model_ref: invSrc.model_ref ?? null,
      inverter_type: invSrc.inverter_type ?? null,
      inverter_family: invSrc.inverter_family ?? null,
      nominal_power_kw: safeNum(invSrc.nominal_power_kw, null),
      nominal_va: safeNum(invSrc.nominal_va, null),
      max_dc_power_kw: invSrc.max_dc_power_kw != null ? safeNum(invSrc.max_dc_power_kw, null) : null,
      modules_per_inverter: invSrc.modules_per_inverter != null ? safeNum(invSrc.modules_per_inverter, null) : null,
      euro_efficiency_pct:
        invSrc.euro_efficiency_pct != null ? safeNum(invSrc.euro_efficiency_pct, null) : null,
    };
  }

  let inverterTotals = null;
  const totSrc = geometryJson.inverter_totals && typeof geometryJson.inverter_totals === "object" ? geometryJson.inverter_totals : null;
  if (totSrc) {
    inverterTotals = {
      units_required: typeof totSrc.units_required === "number" && Number.isFinite(totSrc.units_required) ? totSrc.units_required : null,
      isDcPowerOk: totSrc.isDcPowerOk === true,
      isCurrentOk: totSrc.isCurrentOk === true,
      isMpptOk: totSrc.isMpptOk === true,
      isVoltageOk: totSrc.isVoltageOk === true,
      warnings: Array.isArray(totSrc.warnings) ? totSrc.warnings : [],
    };
  }

  let layoutRules = null;
  const pvParams = geometryJson.pvParams && typeof geometryJson.pvParams === "object" ? geometryJson.pvParams : null;
  if (pvParams) {
    const dist = pvParams.distanceLimitesCm ?? pvParams.marginOuterCm;
    const espH = pvParams.espacementHorizontalCm ?? pvParams.spacingXcm;
    const espV = pvParams.espacementVerticalCm ?? pvParams.spacingYcm;
    layoutRules = {
      distanceLimitesCm: typeof dist === "number" && Number.isFinite(dist) ? dist : null,
      espacementHorizontalCm: typeof espH === "number" && Number.isFinite(espH) ? espH : null,
      espacementVerticalCm: typeof espV === "number" && Number.isFinite(espV) ? espV : null,
      orientationPanneaux: typeof pvParams.orientationPanneaux === "string" ? pvParams.orientationPanneaux : null,
    };
  }

  return {
    panel,
    inverter,
    inverterTotals,
    layoutRules,
  };
}

/**
 * Construit le bloc electrical depuis geometry + hardware (lecture seule, pas de recalcul moteur).
 */
function buildElectricalFromGeometry(geometry, hardware) {
  const totalPanels = Array.isArray(geometry.pans)
    ? geometry.pans.reduce((s, p) => s + (typeof p.panelCount === "number" ? Math.max(0, p.panelCount) : 0), 0)
    : 0;
  const powerWc = hardware && hardware.panel && typeof hardware.panel.powerWc === "number" && Number.isFinite(hardware.panel.powerWc)
    ? hardware.panel.powerWc
    : 0;
  const totalDcKw = totalPanels > 0 && powerWc > 0 ? (totalPanels * powerWc) / 1000 : 0;

  let totalAcKw = null;
  const inv = hardware && hardware.inverter;
  const tot = hardware && hardware.inverterTotals;
  if (inv && tot != null && typeof tot.units_required === "number" && Number.isFinite(tot.units_required)) {
    const nominalKw = safeNum(inv.nominal_power_kw, inv.nominal_va != null ? inv.nominal_va / 1000 : null);
    if (nominalKw != null && nominalKw > 0) {
      totalAcKw = nominalKw * Math.max(0, tot.units_required);
    }
  }

  let dcAcRatio = null;
  if (totalAcKw != null && totalAcKw > 0 && totalDcKw >= 0) {
    dcAcRatio = totalDcKw / totalAcKw;
  }

  return {
    totalPanels,
    totalDcKw: Number.isFinite(totalDcKw) ? totalDcKw : 0,
    totalAcKw,
    dcAcRatio,
  };
}

/**
 * Construit ONE_TRUE_FINAL_STUDY_JSON.
 * @param {object} opts
 * @param {object} opts.geometryJson - geometry_json (obligatoire)
 * @param {object} opts.calcResult - { summary, computed_at } (obligatoire pour construire)
 * @param {object} [opts.production] - { byPan, annualKwh, monthlyKwh } depuis ctxFinal.production
 * @returns {object|null} finalStudyJson ou null si geometry ou calc_result absent
 */
export function buildFinalStudyJson({ geometryJson, calcResult, production }) {
  if (!geometryJson || typeof geometryJson !== "object") return null;
  if (!calcResult || typeof calcResult !== "object") return null;

  const geometry = deriveGeometryFromGeometryJson(geometryJson);
  if (!geometry) return null;

  const norm = geometryJson.shading && typeof geometryJson.shading === "object" ? geometryJson.shading : null;
  const shading = norm
    ? {
        near: norm.near && typeof norm.near === "object" ? { ...norm.near } : { totalLossPct: safeNum(norm.nearLossPct, 0) },
        far:
          norm.far && typeof norm.far === "object"
            ? { ...norm.far }
            : {
                totalLossPct: norm.farLossPct === null ? null : safeNum(norm.farLossPct, 0),
                source: norm.farSource ?? "RELIEF_ONLY",
              },
        combined:
          norm.combined && typeof norm.combined === "object"
            ? { ...norm.combined }
            : {
                totalLossPct: (() => {
                  const v = norm.combined?.totalLossPct ?? norm.totalLossPct;
                  if (v === null) return null;
                  return safeNum(v, 0);
                })(),
              },
        totalLossPct: (() => {
          const v = norm.combined?.totalLossPct ?? norm.totalLossPct;
          if (v === null) return null;
          return safeNum(v, 0);
        })(),
        confidence: norm.shadingQuality?.confidence ?? norm.far?.confidenceLevel ?? "UNKNOWN",
        source: norm.far?.source ?? norm.farSource ?? "RELIEF_ONLY",
        farHorizonKind: norm.shadingQuality?.farHorizonKind ?? norm.far?.farHorizonKind ?? "SYNTHETIC",
        computedAt:
          norm.computedAt != null
            ? typeof norm.computedAt === "number"
              ? new Date(norm.computedAt).toISOString()
              : String(norm.computedAt)
            : new Date().toISOString(),
      }
    : null;
  if (norm && Array.isArray(norm.perPanel)) shading.perPanel = norm.perPanel;
  if (norm && norm.coverage != null) shading.coverage = norm.coverage;

  const summary = calcResult.summary && typeof calcResult.summary === "object" ? calcResult.summary : {};
  const computedAt = calcResult.computed_at ?? new Date().toISOString();
  const calcSummary = {
    annual_kwh: summary.annual_kwh ?? null,
    capex_ttc: summary.capex_ttc ?? null,
    roi_years: summary.roi_years ?? null,
    scenarios: summary.scenarios ?? null,
    computed_at: computedAt,
  };

  let productionBlock = null;
  if (production && typeof production === "object") {
    const byPan = Array.isArray(production.byPan) ? production.byPan : [];
    const annualKwh = typeof production.annualKwh === "number" && Number.isFinite(production.annualKwh) ? production.annualKwh : null;
    const monthlyKwh = Array.isArray(production.monthlyKwh) && production.monthlyKwh.length === 12 ? production.monthlyKwh : null;
    productionBlock = { byPan, annualKwh, monthlyKwh };
  }

  const hardware = buildHardwareFromGeometryJson(geometryJson, geometry);
  const electrical = buildElectricalFromGeometry(geometry, hardware);

  const finalStudyJson = {
    meta: {
      version: STUDY_VERSION,
      generatedAt: new Date().toISOString(),
      calpinageVersion: CALPINAGE_VERSION,
      engine: { shading: "near+far+HD", production: "multi-pan" },
    },
    geometry,
    hardware,
    electrical,
    shading,
    production: productionBlock,
    calcSummary,
  };

  if (
    productionBlock &&
    Array.isArray(productionBlock.byPan) &&
    productionBlock.byPan.length > 0 &&
    Array.isArray(geometry.pans) &&
    geometry.pans.length > 0 &&
    productionBlock.byPan.length !== geometry.pans.length
  ) {
    return null;
  }

  return finalStudyJson;
}
