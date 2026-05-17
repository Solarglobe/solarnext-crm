/**
 * Structure officielle multi-pente : pans[] comme SOURCE UNIQUE pour
 * orientation, tilt, panelCount, surface, shading, production future.
 * Aucun recalcul moteur shading ; agrégation des données existantes uniquement.
 */

import { getOfficialGlobalShadingLossPctOr } from "../shading/officialGlobalShadingLoss.js";

/**
 * Calcule les champs officiels par pan à partir des pans existants,
 * des panneaux posés et du shading normalisé (données existantes, pas de raycast).
 *
 * @param {Array<{ id: string, orientationDeg?: number|null, tiltDeg?: number|null, surfaceM2?: number }>} pans - Pans (validatedRoofData.pans ou équivalent)
 * @param {() => Array<{ id: string, panId: string|null }>} getAllPanels - Fournisseur des panneaux (ex: pvPlacementEngine.getAllPanels)
 * @param {object|null} shadingNormalized - state.shading.normalized (near/far/combined, perPanel optionnel)
 * @returns {Array<{ id: string, azimuth: number, tilt: number, panelCount: number, surface: number, geometryRef: string, shadingNearPct: number, shadingFarPct: number, shadingCombinedPct: number }>}
 */
function buildOfficialPans(pans, getAllPanels, shadingNormalized) {
  if (!Array.isArray(pans) || pans.length === 0) {
    return [];
  }

  const panels = typeof getAllPanels === "function" ? getAllPanels() : [];
  const perPanelLoss = new Map();
  if (shadingNormalized && Array.isArray(shadingNormalized.perPanel)) {
    for (const p of shadingNormalized.perPanel) {
      const id = p.panelId ?? p.id;
      if (id != null && typeof p.lossPct === "number" && !Number.isNaN(p.lossPct)) {
        perPanelLoss.set(String(id), p.lossPct);
      }
    }
  }

  const gpsBlocked =
    shadingNormalized?.shadingQuality?.blockingReason === "missing_gps" ||
    shadingNormalized?.far?.source === "UNAVAILABLE_NO_GPS";
  // null = near non calculé (moteur absent) — distinguer de 0 % (perte calculée légale)
  const globalNear = gpsBlocked
    ? null
    : (shadingNormalized && shadingNormalized.near && typeof shadingNormalized.near.totalLossPct === "number")
        ? shadingNormalized.near.totalLossPct
        : (typeof shadingNormalized?.nearLossPct === "number" ? shadingNormalized.nearLossPct : null);
  const globalFar = gpsBlocked
    ? null
    : (shadingNormalized && shadingNormalized.far && typeof shadingNormalized.far.totalLossPct === "number")
        ? shadingNormalized.far.totalLossPct
        : (typeof shadingNormalized?.farLossPct === "number" ? shadingNormalized.farLossPct : 0);
  const globalCombined = gpsBlocked ? null : getOfficialGlobalShadingLossPctOr(shadingNormalized, 0);

  const panelsByPanId = new Map();
  for (const panel of panels) {
    const panId = panel.panId ?? panel.pan_id ?? null;
    if (panId == null) continue;
    if (!panelsByPanId.has(panId)) panelsByPanId.set(panId, []);
    panelsByPanId.get(panId).push(panel);
  }

  function safeNum(v, fallback) {
    return typeof v === "number" && Number.isFinite(v) && !Number.isNaN(v) ? v : fallback;
  }

  /** FLAT uniquement : azimut de pose (axe pente image) depuis les projections moteur ; null si aucun panneau. */
  function tryFlatAzimuthDegFromPlacedPanelsForPan(panId) {
    const g = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : null;
    const ENG = g && g.pvPlacementEngine;
    if (!ENG || typeof ENG.getEffectivePanelProjection !== "function" || panId == null || String(panId) === "") {
      return null;
    }
    const pid = String(panId);
    function degFromBlock(block) {
      if (!block || String(block.panId || "") !== pid || !Array.isArray(block.panels)) return null;
      for (let i = 0; i < block.panels.length; i++) {
        const panP = block.panels[i];
        if (panP && panP.enabled === false) continue;
        const proj = ENG.getEffectivePanelProjection(block, i);
        if (!proj || typeof proj.slopeAxis?.x !== "number" || typeof proj.slopeAxis?.y !== "number") continue;
        const ns = Math.hypot(proj.slopeAxis.x, proj.slopeAxis.y);
        if (ns < 1e-9) continue;
        const tsx = proj.slopeAxis.x / ns;
        const tsy = proj.slopeAxis.y / ns;
        let deg = (Math.atan2(tsx, -tsy) * 180) / Math.PI;
        deg = ((deg % 360) + 360) % 360;
        return deg;
      }
      return null;
    }
    let out = degFromBlock(ENG.getFocusBlock && ENG.getFocusBlock());
    if (out != null) return out;
    const focus = ENG.getFocusBlock && ENG.getFocusBlock();
    const active = ENG.getActiveBlock && ENG.getActiveBlock();
    if (active && (!focus || active.id !== focus.id)) {
      out = degFromBlock(active);
      if (out != null) return out;
    }
    const frozen = ENG.getFrozenBlocks && ENG.getFrozenBlocks();
    if (Array.isArray(frozen)) {
      for (const bl of frozen) {
        out = degFromBlock(bl);
        if (out != null) return out;
      }
    }
    return null;
  }

  return pans.map((p) => {
    const panId = p.id;
    const panelList = panelsByPanId.get(panId) || [];
    const panelCount = panelList.length;

    let shadingCombinedPct = globalCombined;
    if (panelList.length > 0 && perPanelLoss.size > 0) {
      let sum = 0;
      let n = 0;
      for (const panel of panelList) {
        const loss = perPanelLoss.get(String(panel.id));
        if (typeof loss === "number") {
          sum += loss;
          n += 1;
        }
      }
      if (n > 0) shadingCombinedPct = sum / n;
    }

    let azimuthOut = safeNum(p.orientationDeg ?? p.azimuth ?? p.azimuthDeg, 180);
    if (p.roofType === "FLAT") {
      const fromPlaced = tryFlatAzimuthDegFromPlacedPanelsForPan(panId);
      if (fromPlaced != null) azimuthOut = fromPlaced;
    }
    return {
      id: panId,
      azimuth: azimuthOut,
      tilt: safeNum(p.tiltDeg ?? p.tilt, 0),
      panelCount,
      surface: safeNum(p.surfaceM2 ?? p.surface, 0),
      geometryRef: panId,
      shadingNearPct: globalNear,
      shadingFarPct: globalFar,
      shadingCombinedPct,
    };
  });
}

/**
 * Enrichit un tableau de pans (validatedRoofData.pans) avec les champs officiels.
 * Ne mute pas les objets existants ; retourne un nouveau tableau dont chaque élément
 * contient les champs d’origine plus les champs officiels (azimuth, tilt, panelCount, surface, geometryRef, shading*).
 *
 * @param {Array<object>} pans - Pans avec au moins id, orientationDeg/tiltDeg/surfaceM2 (optionnels)
 * @param {() => Array<{ id: string, panId: string|null }>} getAllPanels
 * @param {object|null} shadingNormalized
 * @returns {Array<object>}
 */
function enrichPansWithOfficialFields(pans, getAllPanels, shadingNormalized) {
  const official = buildOfficialPans(pans, getAllPanels, shadingNormalized);
  if (official.length === 0) return Array.isArray(pans) ? pans.map((p) => ({ ...p })) : [];

  const byId = new Map();
  official.forEach((o) => byId.set(o.id, o));

  return pans.map((p) => {
    const o = byId.get(p.id);
    if (!o) return { ...p };
    return {
      ...p,
      azimuth: o.azimuth,
      tilt: o.tilt,
      panelCount: o.panelCount,
      surface: o.surface,
      geometryRef: o.geometryRef,
      shadingNearPct: o.shadingNearPct,
      shadingFarPct: o.shadingFarPct,
      shadingCombinedPct: o.shadingCombinedPct,
    };
  });
}

export { buildOfficialPans, enrichPansWithOfficialFields };
