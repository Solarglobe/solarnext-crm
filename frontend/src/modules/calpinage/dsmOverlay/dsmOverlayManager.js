/**
 * CP-DSM-016 — DSM Visual Overlay Manager (singleton)
 * Pure visualisation, non destructif. enable/disable/toggle.
 * Fetch on-demand: si pas de horizonMask local, appelle /api/horizon-mask.
 *
 * DSM OVERLAY ONLY — not the official shading source of truth (docs/dsm-overlay-governance.md).
 * Affiche et résume le shading déjà fourni par le backend / l’état calpinage ; ne gouverne pas le JSON métier.
 */

import { normalizeHorizonData, drawHorizonRadar, getHoverPoint } from "./horizonRadar.js";
import { getDominantDirection } from "./dominantDirection.js";
import {
  formatSensitivePeriodLabel,
  getUxGlobalLevelBadge,
  getUxImpactLevel,
  getUxNarrativeLine,
} from "./shadingUxLabels.js";
import { drawRoofHeatmap } from "./roofHeatmap.js";
import { buildShadingSummary, getTotalLossPctFromShading } from "./buildShadingSummary.js";
import {
  getGlobalShadingLossPctForCalpinageShadingState,
  getOfficialGlobalShadingLossPct,
} from "../shading/officialGlobalShadingLoss.js";
import {
  formatHorizonConfidenceLineHtml,
  formatHorizonQualityBadgeText,
  getFarHorizonLineLabel,
  isFarHorizonRealTerrain,
} from "./farHorizonTruth.js";
import { computeSolarScore } from "./solarScore.js";
import { createDsmInteractionLayer } from "./dsmInteractionLayer.js";
import { createDsmSolarAnimationControls } from "./dsmSolarAnimationControls.js";
import { getCrmApiBaseWithWindowFallback } from "../../../config/crmApiBase";
import { apiFetch } from "../../../services/api";

let instance = null;

const HORIZON_FETCH_TIMEOUT_MS = 10000;

function getState() {
  return typeof window !== "undefined" && window.CALPINAGE_STATE ? window.CALPINAGE_STATE : null;
}

/** Retourne le message "Calcul impossible : <reason>" si lastAbortReason est défini, sinon null. Utilisé par l'UI et les tests. */
export function getShadingAbortMessage(state) {
  const reason = state?.shading?.lastAbortReason;
  return typeof reason === "string" && reason.length > 0 ? `Calcul impossible : ${reason}` : null;
}

/**
 * Résolution GPS pour l’overlay DSM (aucune coordonnée implicite / fictive).
 * @returns {{ lat: number, lon: number, resolved: true, quality: "exact"|"approximate", source: string } | { resolved: false, quality: "none", source: "missing", lat: null, lon: null }}
 */
export function resolveGpsForDsmOverlay() {
  const state = getState();
  if (!state) {
    return { resolved: false, quality: "none", source: "missing", lat: null, lon: null };
  }

  const roof = state.roof;
  const vrd = state.validatedRoofData;

  const okPair = (lat, lon) =>
    typeof lat === "number" &&
    typeof lon === "number" &&
    !Number.isNaN(lat) &&
    !Number.isNaN(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180;

  if (roof?.gps && typeof roof.gps.lat === "number" && typeof roof.gps.lon === "number" && okPair(roof.gps.lat, roof.gps.lon)) {
    return { lat: roof.gps.lat, lon: roof.gps.lon, resolved: true, quality: "exact", source: "roof" };
  }

  const vrdGps = vrd?.roofState?.gps || vrd?.gps;
  if (vrdGps && typeof vrdGps.lat === "number" && typeof vrdGps.lon === "number" && okPair(vrdGps.lat, vrdGps.lon)) {
    return { lat: vrdGps.lat, lon: vrdGps.lon, resolved: true, quality: "exact", source: "roof" };
  }

  const mapCenter = roof?.map?.centerLatLng || vrd?.roofState?.map?.centerLatLng;
  if (mapCenter && typeof mapCenter.lat === "number" && typeof mapCenter.lng === "number") {
    const lon = mapCenter.lng;
    if (okPair(mapCenter.lat, lon)) {
      return { lat: mapCenter.lat, lon, resolved: true, quality: "approximate", source: "map_center" };
    }
  }

  const geom = typeof window !== "undefined" && window.geometry_json;
  const geomCenter = geom?.mapCenter;
  if (geomCenter && typeof geomCenter.lat === "number" && typeof geomCenter.lng === "number" && okPair(geomCenter.lat, geomCenter.lng)) {
    return { lat: geomCenter.lat, lon: geomCenter.lng, resolved: true, quality: "approximate", source: "geometry_map_center" };
  }

  const mapApi = typeof window !== "undefined" && window.calpinageMap;
  const mapState = mapApi?.getState?.();
  const liveCenter = mapState?.centerLatLng;
  if (liveCenter && typeof liveCenter.lat === "number" && typeof liveCenter.lng === "number") {
    const lon = liveCenter.lng;
    if (okPair(liveCenter.lat, lon)) {
      return { lat: liveCenter.lat, lon, resolved: true, quality: "approximate", source: "map_live" };
    }
  }

  console.warn("[DSM] resolveGpsForDsmOverlay: aucune source GPS exploitable — pas de calcul lointain / soleil sur coordonnées par défaut");
  return { resolved: false, quality: "none", source: "missing", lat: null, lon: null };
}

/**
 * { lat, lon } | null — pour fetch horizon, soleil, etc. Jamais de coordonnées fictives.
 */
function getBestGps() {
  const r = resolveGpsForDsmOverlay();
  return r.resolved ? { lat: r.lat, lon: r.lon } : null;
}

/**
 * Données horizon: local (state.horizonMask.data) ou fetch (manager._horizonMask).
 * Cache fetch valide uniquement si GPS inchangé.
 */
function getHorizonData(manager) {
  const state = getState();
  const local = state?.horizonMask?.data;
  const hasLocal =
    (Array.isArray(local?.mask) && local.mask.length > 0) ||
    (Array.isArray(local?.horizon) && local.horizon.length > 0);
  if (local && hasLocal) return local;
  if (manager?._horizonMask) {
    const gps = getBestGps();
    const gpsKey = gps ? `${gps.lat.toFixed(6)}_${gps.lon.toFixed(6)}` : null;
    if (gpsKey && manager._horizonGpsKey === gpsKey) return manager._horizonMask;
  }
  return null;
}

/** Même périmètre que getHorizonData + dataCoverage pour la vérité produit (6B). */
function getHorizonProductData(manager) {
  const state = getState();
  const local = state?.horizonMask?.data;
  const hasLocal =
    (Array.isArray(local?.mask) && local.mask.length > 0) ||
    (Array.isArray(local?.horizon) && local.horizon.length > 0);
  if (local && hasLocal) return local;
  if (manager?._horizonMask) {
    const gps = getBestGps();
    const gpsKey = gps ? `${gps.lat.toFixed(6)}_${gps.lon.toFixed(6)}` : null;
    if (gpsKey && manager._horizonGpsKey === gpsKey) {
      return {
        mask: manager._horizonMask.mask,
        meta: manager._horizonMeta || manager._horizonMask.meta || {},
        dataCoverage: manager._horizonMask.dataCoverage ?? null,
      };
    }
  }
  return null;
}

function getShadingData() {
  const state = getState();
  if (!state?.shading?.normalized) return null;
  return state.shading.normalized;
}

function getPanels() {
  const eng = typeof window !== "undefined" && window.pvPlacementEngine;
  if (!eng?.getAllPanels) return [];
  const panels = eng.getAllPanels() || [];
  return panels.filter((p) => p.enabled !== false && Array.isArray(p.polygonPx) && p.polygonPx.length >= 3);
}

function buildPanelsWithLoss() {
  const shading = getShadingData();
  const panels = getPanels();
  if (panels.length === 0) return [];
  const globalLoss = getTotalLossPctFromShading(shading);
  if (!shading?.perPanel?.length) {
    return panels.map((p) => ({ polygonPx: p.polygonPx, lossPct: globalLoss }));
  }
  const byId = new Map();
  for (const p of shading.perPanel) {
    const id = p.panelId ?? p.id;
    if (id != null) byId.set(String(id), p.lossPct ?? 0);
  }
  return panels.map((p) => ({
    polygonPx: p.polygonPx,
    lossPct: byId.get(String(p.id)) ?? globalLoss,
  }));
}

/** Réf. DC kWh/kWp/an — aligné sur backend/services/pvgisService.js (FALLBACK_NATIONAL_ANNUAL_DC_REF). */
const OVERLAY_FALLBACK_NATIONAL_ANNUAL_DC_REF = 1218;
/**
 * DC kWh/kWp/an — mêmes zones que pvgisService.getFallbackAnnualDcKwhPerKwp (overlay uniquement, pas d’appel API).
 */
function getFallbackAnnualDcKwhPerKwpOverlay(lat, lon) {
  const ref = OVERLAY_FALLBACK_NATIONAL_ANNUAL_DC_REF;
  if (typeof lat !== "number" || !Number.isFinite(lat)) return ref;
  if (lat < 41 || lat > 51.5) return ref;
  const lonN = typeof lon === "number" && Number.isFinite(lon) ? lon : 2.5;
  if (lonN < -5.5 || lonN > 10.5) return ref;
  if (lat >= 41 && lat <= 43.5 && lonN >= 8 && lonN <= 10) return 1340;
  if (lat >= 49.2) return 1020;
  if (lat >= 48.0) return 1080;
  if (lat >= 45.5) return 1180;
  if (lat < 45.5 && lonN < 3.5) return 1200;
  if (lat < 45.5) return 1280;
  return ref;
}
/** Ancien affichage ~1100 kWh/kWc AC pour la France « moyenne » quand DC ref = 1218 — cohérent moteur. */
const OVERLAY_AC_KWH_PER_KWC_FROM_DC = 1100 / OVERLAY_FALLBACK_NATIONAL_ANNUAL_DC_REF;

/**
 * Production annuelle (kWh) pour l’estimation financière ombrage — pas un recalcul PV complet.
 * 1) kWh persistés calpinage (API) si présents
 * 2) sinon total_kWc × rendement AC/kWc dérivé du DC zoné (GPS) comme le fallback PVGIS backend
 */
export function resolveAnnualProductionKwhForShadingOverlay(totalPowerKwc) {
  if (typeof totalPowerKwc !== "number" || !Number.isFinite(totalPowerKwc) || totalPowerKwc <= 0) return null;
  const state = getState();
  const persisted = state?.calpinageAnnualProductionKwh;
  if (typeof persisted === "number" && persisted > 0 && Number.isFinite(persisted)) {
    return persisted;
  }
  const gps = getBestGps();
  const dcPerKwp = getFallbackAnnualDcKwhPerKwpOverlay(gps?.lat, gps?.lon);
  const acKwhPerKwc = dcPerKwp * OVERLAY_AC_KWH_PER_KWC_FROM_DC;
  return totalPowerKwc * acKwhPerKwc;
}

/**
 * Retourne { orientation_deg, tilt_deg } depuis state (roof, pans, validatedRoofData).
 */
function getOrientationTilt() {
  const state = getState();
  const roof = state?.roof;
  const vrd = state?.validatedRoofData;
  const pans = vrd?.pans ?? roof?.pans;
  if (pans && pans.length > 0) {
    const p = pans[0];
    const orient =
      p.physical?.orientation?.azimuthDeg ?? p.orientationDeg ?? p.orientation_deg ?? p.azimuthDeg ?? null;
    const tilt = p.physical?.slope?.valueDeg ?? p.tiltDeg ?? p.tilt_deg ?? null;
    if (orient != null || tilt != null) return { orientation_deg: orient, tilt_deg: tilt };
  }
  const orient = roof?.orientation_deg ?? roof?.orientationDeg ?? null;
  const tilt = roof?.tilt_deg ?? roof?.tiltDeg ?? null;
  return { orientation_deg: orient, tilt_deg: tilt };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Accent carte synthèse (UX uniquement, aligné badges produit). */
function getUxTierClass(lossPct) {
  const { tier } = getUxGlobalLevelBadge(lossPct);
  if (tier === "excellent") return "dsm-shade-tier-excellent";
  if (tier === "bon") return "dsm-shade-tier-bon";
  if (tier === "surveiller") return "dsm-shade-tier-surveiller";
  if (tier === "penalisant") return "dsm-shade-tier-penalisant";
  return "dsm-shade-tier-unknown";
}

function getUxProjectStance(lossPct) {
  if (lossPct == null || typeof lossPct !== "number" || Number.isNaN(lossPct)) return "—";
  if (lossPct <= 8) return "Projet compatible sous réserve du dimensionnement habituel.";
  if (lossPct <= 15) return "À intégrer explicitement dans l’argumentaire et le dimensionnement.";
  return "Impact majeur : arbitrage technique recommandé avant engagement client.";
}

function computeShadingSummaryForOverlay(manager) {
  const state = getState();
  const shading = state?.shading?.normalized;
  const totalLossPct = getTotalLossPctFromShading(shading);
  const horizonData = getHorizonProductData(manager) || {};
  const horizonMeta = horizonData.meta || {};
  const qualityScore = typeof horizonMeta.qualityScore === "number" ? horizonMeta.qualityScore : null;
  const source = typeof horizonMeta.source === "string" ? horizonMeta.source : null;

  let totalPowerKwc = 0;
  const eng = typeof window !== "undefined" && window.pvPlacementEngine;
  if (eng?.getAllPanels) {
    const panels = eng.getAllPanels() || [];
    const p = window.PV_SELECTED_PANEL;
    const powerWc = (p && (p.power_wc ?? p.powerWc) != null) ? Number(p.power_wc ?? p.powerWc) : 0;
    if (panels.length > 0 && powerWc > 0) totalPowerKwc = (panels.length * powerWc) / 1000;
  }
  const annualProductionKwh = resolveAnnualProductionKwhForShadingOverlay(totalPowerKwc);

  return buildShadingSummary({
    totalLossPct,
    annualProductionKwh,
    pricePerKwh: 0.2,
    qualityScore,
    source,
  });
}

function updateShadingSummaryBlock(overlayRoot, manager) {
  const block = overlayRoot?.querySelector("#dsm-shading-summary");
  if (!block) return;

  block.style.display = "block";
  block.classList.remove(
    "dsm-shade-tier-excellent",
    "dsm-shade-tier-bon",
    "dsm-shade-tier-surveiller",
    "dsm-shade-tier-penalisant",
    "dsm-shade-tier-unknown",
  );

  if (manager._fetchLoading) {
    block.innerHTML =
      '<div class="dsm-shade-card"><div class="dsm-shade-card-title">Analyse d’ombrage</div><div class="dsm-summary-loading">Calcul en cours…</div></div>';
    block.classList.add("dsm-shade-tier-unknown");
    return;
  }

  const horizonData = getHorizonData(manager);
  const shading = getShadingData();
  const state = getState();
  const abortMsg = getShadingAbortMessage(state);
  if (abortMsg) {
    block.innerHTML = `<div class="dsm-shade-card"><div class="dsm-shade-card-title">Analyse d’ombrage</div><p class="dsm-shade-error">${escapeHtml(abortMsg)}</p></div>`;
    block.classList.add("dsm-shade-tier-unknown");
    return;
  }
  if (!horizonData && !shading) {
    block.innerHTML =
      '<div class="dsm-shade-card"><div class="dsm-shade-card-title">Analyse d’ombrage</div><div class="dsm-summary-loading">Calcul en cours…</div></div>';
    block.classList.add("dsm-shade-tier-unknown");
    return;
  }

  const summary = computeShadingSummaryForOverlay(manager);
  const horizonProduct = getHorizonProductData(manager) ?? horizonData;
  const horizonMeta = horizonProduct?.meta || horizonData?.meta || {};
  const qualityScore = typeof horizonMeta.qualityScore === "number" ? horizonMeta.qualityScore : null;
  const gpsRes = resolveGpsForDsmOverlay();
  const farBlocked =
    !gpsRes.resolved ||
    shading?.far?.source === "UNAVAILABLE_NO_GPS" ||
    shading?.shadingQuality?.blockingReason === "missing_gps";
  const lectureTerrainLine =
    farBlocked ? "" : formatHorizonConfidenceLineHtml(horizonProduct, qualityScore);

  const nearPct =
    typeof shading?.near?.totalLossPct === "number"
      ? shading.near.totalLossPct
      : typeof shading?.nearLossPct === "number"
        ? shading.nearLossPct
        : null;
  const farPct =
    typeof shading?.far?.totalLossPct === "number"
      ? shading.far.totalLossPct
      : typeof shading?.farLossPct === "number"
        ? shading.farLossPct
        : null;
  const totalPct =
    getOfficialGlobalShadingLossPct(shading) ??
    (typeof summary.totalLossPct === "number" ? summary.totalLossPct : null);

  const zMode = state?.shading?.zMode;
  const nearLabel = zMode === "FLAT" ? "Obstacles proches (toiture, mode simplifié)" : "Obstacles proches (toit)";
  const farLineLabel = farBlocked
    ? "Relief / horizon (indisponible — localisation)"
    : getFarHorizonLineLabel(isFarHorizonRealTerrain(horizonProduct));
  const nearPctStr = nearPct == null ? "—" : Number(nearPct).toFixed(1);
  const farPctStr = farBlocked ? "—" : farPct == null ? "—" : Number(farPct).toFixed(1);
  const totalPctStr = totalPct == null || Number.isNaN(Number(totalPct)) ? "—" : Number(totalPct).toFixed(1);

  const gps = getBestGps();
  const dominant = farBlocked ? null : getDominantDirection(horizonData, gps?.lat, gps?.lon);

  const dominantSource =
    dominant && !farBlocked && typeof farPct === "number" && farPct > 0
      ? dominant.energyLossSharePct != null
        ? `Direction la plus pénalisante (relief lointain) : ${dominant.cardinalDirection} — ${dominant.energyLossSharePct} % des pertes liées au lointain`
        : `Direction la plus pénalisante (relief lointain) : ${dominant.cardinalDirection}`
      : "";
  const seasonPct =
    dominant?.dominantSeasonLossPct != null && !Number.isNaN(dominant.dominantSeasonLossPct)
      ? ` (jusqu’à ${dominant.dominantSeasonLossPct} %)`
      : "";
  const dominantImpact =
    dominant && !farBlocked && typeof farPct === "number" && farPct > 0
      ? `Période la plus sensible côté horizon lointain : ${dominant.season}${seasonPct} — ${dominant.period}`
      : "";

  const { orientation_deg, tilt_deg } = getOrientationTilt();
  const solarScore = computeSolarScore({
    totalLossPct: summary.totalLossPct,
    orientation_deg,
    tilt_deg,
  });
  const solarScoreLine = `<div class="dsm-tech-line">Lecture exposition (modèle) : ${solarScore.label}</div>`;
  const solarScoreHint = solarScore.hasOrientationTilt
    ? `<div class="dsm-tech-line dsm-tech-muted">Comparatif orientation / inclinaison / ombrage modélisé — pas une mesure terrain ni un engagement de performance.</div>`
    : `<div class="dsm-tech-line dsm-tech-muted">Renseigner orientation et inclinaison du toit pour affiner cette lecture indicative.</div>`;

  const winterPct = dominant?.winterLossPct;
  const summerPct = dominant?.summerLossPct;
  const seasonalLine =
    winterPct != null && summerPct != null && !Number.isNaN(winterPct) && !Number.isNaN(summerPct)
      ? `<div class="dsm-tech-line">Hiver : jusqu’à ${winterPct} % · Été : jusqu’à ${summerPct} %</div>`
      : "";

  const dominantLines =
    dominantSource && dominantImpact
      ? `<div class="dsm-tech-line">${dominantSource}</div><div class="dsm-tech-line">${dominantImpact}</div>`
      : "";

  const farUnavailableMsg = farBlocked
    ? `<div class="dsm-tech-line">Relief à l’horizon non calculé : géolocalisation du toit absente ou incomplète — la composante lointaine peut être absente du devis.</div>`
    : "";
  const pedagogyLine = `<div class="dsm-tech-line dsm-tech-muted">Lecture : <strong>proche</strong> = ombrage local sur le toit · <strong>lointain</strong> = masque d’horizon au-delà du bâtiment · <strong>global</strong> = perte retenue pour l’étude / export (réf. officielle).</div>`;
  const nearFarTotalLines =
    pedagogyLine +
    `<div class="dsm-tech-line">${nearLabel} : ${nearPctStr} %</div>` +
    `<div class="dsm-tech-line">${farLineLabel} : ${farPctStr} %</div>` +
    `<div class="dsm-tech-line">Perte globale retenue (étude) : ${totalPctStr} %</div>` +
    farUnavailableMsg;

  const impactLabel = getUxImpactLevel(totalPct);
  const levelBadge = getUxGlobalLevelBadge(totalPct);
  const tierClass = getUxTierClass(totalPct);
  block.classList.add(tierClass);

  const lossPctDisplay = totalPctStr;
  const periodLabel = formatSensitivePeriodLabel(dominant, farBlocked);
  const narrative = getUxNarrativeLine({
    totalPct,
    nearPct,
    farPct,
    farBlocked,
  });
  const stance = getUxProjectStance(totalPct);

  const kwhBlock =
    summary.totalLossPct != null &&
    summary.totalLossPct >= 0.5 &&
    typeof summary.annualLossKwh === "number" &&
    summary.annualLossKwh > 0
      ? `<div class="dsm-tech-line">Estimation énergétique : −${summary.annualLossKwh.toLocaleString("fr-FR")} kWh/an (ordre de grandeur)</div>
         <div class="dsm-tech-line">Équivalent indicatif : −${Math.round(summary.annualLossEuro).toLocaleString("fr-FR")} €/an (0,20 €/kWh, non contractuel)</div>
         <div class="dsm-tech-line dsm-tech-muted">Basé sur une production annuelle estimée du projet — ne remplace pas le chiffrage du devis.</div>`
      : summary.totalLossPct != null && summary.totalLossPct < 0.5
        ? `<div class="dsm-tech-line">Baisse de production estimée &lt; 0,5 % sur le modèle actuel.</div>`
        : "";

  const qualityBadgeText = formatHorizonQualityBadgeText(horizonProduct, horizonMeta);

  block.innerHTML = `
    <div class="dsm-shade-card">
      <div class="dsm-shade-card-head">
        <div class="dsm-shade-card-title">Analyse d’ombrage</div>
        <span class="dsm-shade-pill dsm-shade-pill--${levelBadge.tier}" title="Indicateur visuel — seuils UX">${escapeHtml(levelBadge.label)}</span>
      </div>
      <p class="dsm-shade-lead">
        Impact estimé : <strong>${impactLabel}</strong>
        <span class="dsm-shade-dot">·</span>
        Perte annuelle estimée : <strong>${lossPctDisplay === "—" ? "—" : `${lossPctDisplay} %`}</strong>
      </p>
      <p class="dsm-shade-stance">${escapeHtml(stance)}</p>
      <div class="dsm-shade-metrics" role="list">
        <div class="dsm-shade-metric" role="listitem">
          <span class="dsm-shade-metric-label">Ombrage local (toit)</span>
          <span class="dsm-shade-metric-value">${nearPctStr} %</span>
        </div>
        <div class="dsm-shade-metric" role="listitem">
          <span class="dsm-shade-metric-label">Relief &amp; horizon</span>
          <span class="dsm-shade-metric-value">${farPctStr === "—" ? "—" : `${farPctStr} %`}</span>
        </div>
        <div class="dsm-shade-metric" role="listitem">
          <span class="dsm-shade-metric-label">Période sensible</span>
          <span class="dsm-shade-metric-value dsm-shade-metric-value--wrap">${escapeHtml(periodLabel)}</span>
        </div>
        <div class="dsm-shade-metric" role="listitem">
          <span class="dsm-shade-metric-label">Niveau global (lecture)</span>
          <span class="dsm-shade-metric-value">${escapeHtml(levelBadge.label)}</span>
        </div>
      </div>
      <p class="dsm-shade-narrative">${escapeHtml(narrative)}</p>
      <details class="dsm-shade-tech">
        <summary>Voir les détails techniques</summary>
        <div class="dsm-shade-tech-inner">
          ${nearFarTotalLines}
          ${kwhBlock}
          ${solarScoreLine}
          ${solarScoreHint}
          ${lectureTerrainLine ? lectureTerrainLine.replace(/class="dsm-summary-line"/g, 'class="dsm-tech-line"') : ""}
          <div class="dsm-tech-line dsm-tech-muted">Lecture du masque d’horizon : ${escapeHtml(qualityBadgeText)}</div>
          ${dominantLines}
          ${seasonalLine}
        </div>
      </details>
    </div>
  `;
}

const DSM_CONTAINER_RETRY_MAX = 5;

function createOverlayDOM(container) {
  if (!container || !container.isConnected) {
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[DSM] container not found or not connected — overlay skipped");
    }
    return null;
  }
  const canvasEl = container.querySelector("#calpinage-canvas-el");
  const wrapper =
    container.querySelector("#canvas-wrapper") ||
    canvasEl?.parentElement ||
    container.querySelector("#zone-c") ||
    container.querySelector("#calpinage-body");
  if (!wrapper) {
    console.error("[DSM] canvas wrapper not found (#canvas-wrapper, canvas parent, #zone-c, #calpinage-body) — overlay aborted");
    return null;
  }
  if (getComputedStyle(wrapper).position === "static") {
    wrapper.style.position = "relative";
  }

  let root = wrapper.querySelector("#dsm-overlay-container");
  if (root) return root;

  root = document.createElement("div");
  root.id = "dsm-overlay-container";
  root.className = "dsm-overlay-container";

  const canvas = document.createElement("canvas");
  canvas.id = "dsm-overlay-canvas";
  canvas.style.position = "absolute";
  canvas.style.top = "0";
  canvas.style.left = "0";
  canvas.style.zIndex = "999";
  canvas.style.pointerEvents = "none";

  const radarWrap = document.createElement("div");
  radarWrap.className = "dsm-horizon-radar";
  radarWrap.setAttribute(
    "aria-label",
    "Masque d’horizon — lecture directionnelle (estimation selon les données disponibles, sans valeur contractuelle)"
  );
  const radarCanvas = document.createElement("canvas");
  radarCanvas.width = 120;
  radarCanvas.height = 120;
  const tooltipEl = document.createElement("span");
  tooltipEl.className = "dsm-radar-tooltip";
  tooltipEl.style.display = "none";
  const dominantTextEl = document.createElement("div");
  dominantTextEl.className = "dsm-radar-dominant-text";
  dominantTextEl.id = "dsm-radar-dominant-text";
  const radarLegendEl = document.createElement("div");
  radarLegendEl.className = "dsm-radar-legend";
  radarLegendEl.setAttribute("aria-hidden", "true");
  radarLegendEl.innerHTML = `
    <div class="dsm-radar-legend-row"><span class="dsm-radar-legend-swatch dsm-radar-legend-swatch--sun"></span> Soleil simulé</div>
    <div class="dsm-radar-legend-row"><span class="dsm-radar-legend-swatch dsm-radar-legend-swatch--zone"></span> Zone rouge = relief pénalisant</div>
  `;
  radarWrap.appendChild(radarCanvas);
  radarWrap.appendChild(tooltipEl);
  radarWrap.appendChild(dominantTextEl);
  radarWrap.appendChild(radarLegendEl);

  const rightStack = document.createElement("div");
  rightStack.className = "dsm-overlay-right-stack";

  const summaryBlock = document.createElement("div");
  summaryBlock.className = "dsm-shading-summary";
  summaryBlock.id = "dsm-shading-summary";
  summaryBlock.setAttribute("aria-label", "Résumé analyse ombrage");

  const statusEl = document.createElement("div");
  statusEl.className = "dsm-no-data";
  statusEl.id = "dsm-status";
  statusEl.textContent = "Aucune donnée horizon";
  statusEl.style.display = "none";

  rightStack.appendChild(radarWrap);

  root.appendChild(canvas);
  root.appendChild(rightStack);
  root.appendChild(summaryBlock);
  root.appendChild(statusEl);
  wrapper.appendChild(root);

  return root;
}

function setStatus(overlayRoot, mode, message) {
  const statusEl = overlayRoot?.querySelector("#dsm-status");
  if (!statusEl) return;
  statusEl.className = "dsm-no-data";
  if (mode === "loading") statusEl.className = "dsm-loading";
  else if (mode === "error") statusEl.className = "dsm-error";
  statusEl.textContent = message || "Aucune donnée DSM";
  statusEl.style.display = "block";
}

function hideStatus(overlayRoot) {
  const statusEl = overlayRoot?.querySelector("#dsm-status");
  if (statusEl) {
    statusEl.style.display = "none";
    statusEl.textContent = "";
  }
}

function redraw(manager) {
  const container = manager._container;
  if (!container || !manager._enabled) return;

  const mainCanvas = container.querySelector("#calpinage-canvas-el");
  const overlayRoot = container.querySelector("#dsm-overlay-container");
  const overlayCanvas = overlayRoot?.querySelector("#dsm-overlay-canvas");
  const radarCanvas = overlayRoot?.querySelector(".dsm-horizon-radar canvas");

  if (!overlayRoot || !overlayCanvas || !radarCanvas) return;

  const horizonData = getHorizonData(manager);
  const shading = getShadingData();

  overlayRoot.classList.add("dsm-overlay-visible");

  if (manager._fetchLoading) {
    setStatus(overlayRoot, "loading", "Chargement horizon…");
    if (typeof manager._refreshTemporal === "function") {
      manager._refreshTemporal({
        horizonData: null,
        gps: getBestGps(),
        farBlocked: true,
        dominant: null,
        nearPct: null,
        farPct: null,
      });
    }
    updateShadingSummaryBlock(overlayRoot, manager);
    overlayCanvas.width = Math.max(1, Math.round((mainCanvas?.getBoundingClientRect?.()?.width) || 800));
    overlayCanvas.height = Math.max(1, Math.round((mainCanvas?.getBoundingClientRect?.()?.height) || 600));
    overlayCanvas.style.width = overlayCanvas.width + "px";
    overlayCanvas.style.height = overlayCanvas.height + "px";
    return;
  }

  if (!horizonData && !shading) {
    setStatus(overlayRoot, "nodata", "Aucune donnée horizon");
    if (typeof manager._refreshTemporal === "function") {
      manager._refreshTemporal({
        horizonData: null,
        gps: getBestGps(),
        farBlocked: true,
        dominant: null,
        nearPct: null,
        farPct: null,
      });
    }
    updateShadingSummaryBlock(overlayRoot, manager);
    overlayCanvas.width = Math.max(1, Math.round((mainCanvas?.getBoundingClientRect?.()?.width) || 800));
    overlayCanvas.height = Math.max(1, Math.round((mainCanvas?.getBoundingClientRect?.()?.height) || 600));
    overlayCanvas.style.width = overlayCanvas.width + "px";
    overlayCanvas.style.height = overlayCanvas.height + "px";
    console.log("[DSM] canvas size (no data):", overlayCanvas.width, overlayCanvas.height);
    return;
  }

  hideStatus(overlayRoot);

  const points = normalizeHorizonData(horizonData);
  const gps = getBestGps();
  const farBlockedRadar =
    !gps ||
    shading?.far?.source === "UNAVAILABLE_NO_GPS" ||
    shading?.shadingQuality?.blockingReason === "missing_gps";
  const dominant = farBlockedRadar ? null : getDominantDirection(horizonData, gps?.lat, gps?.lon);
  console.log("[DSM] drawRadar called, points:", points.length, "dominant:", dominant?.cardinalDirection);
  drawHorizonRadar(radarCanvas, points, manager._hoverPoint, dominant ? { az: dominant.az, elev: dominant.elev } : null, manager._solarPosition);

  const dominantTextEl = overlayRoot.querySelector("#dsm-radar-dominant-text");
  if (dominantTextEl) {
    if (dominant && !farBlockedRadar) {
      const shareStr = dominant.energyLossSharePct != null ? ` — ${dominant.energyLossSharePct} % des pertes liées au relief lointain` : "";
      dominantTextEl.innerHTML = `
        <div class="dsm-radar-dominant-title">Relief lointain</div>
        <div class="dsm-radar-dominant-direction">${dominant.cardinalDirection}${shareStr}</div>
        <div class="dsm-radar-dominant-period">${dominant.season} · ${dominant.period}</div>
      `;
      dominantTextEl.style.display = "block";
    } else {
      dominantTextEl.style.display = "none";
    }
  }

  const horizonProduct = getHorizonProductData(manager) ?? horizonData;

  const rect = mainCanvas ? mainCanvas.getBoundingClientRect() : { width: 800, height: 600 };
  const cw = Math.max(1, Math.round(rect.width));
  const ch = Math.max(1, Math.round(rect.height));
  overlayCanvas.width = cw;
  overlayCanvas.height = ch;
  overlayCanvas.style.width = cw + "px";
  overlayCanvas.style.height = ch + "px";
  overlayCanvas.style.position = "absolute";
  overlayCanvas.style.top = "0";
  overlayCanvas.style.left = "0";
  overlayCanvas.style.zIndex = "999";
  overlayCanvas.style.pointerEvents = "none";
  console.log("[DSM] canvas size:", overlayCanvas.width, overlayCanvas.height);

  const ctx = overlayCanvas.getContext("2d");
  if (ctx) {
    const panelsWithLoss = buildPanelsWithLoss();
    const globalLoss = getTotalLossPctFromShading(shading ?? null);
    drawRoofHeatmap(ctx, {
      canvasWidth: cw,
      canvasHeight: ch,
      globalLossPct: globalLoss,
      panelsWithLoss,
    });
  }

  const nearPctR =
    shading && typeof shading.near?.totalLossPct === "number"
      ? shading.near.totalLossPct
      : shading && typeof shading.nearLossPct === "number"
        ? shading.nearLossPct
        : null;
  const farPctR =
    shading && typeof shading.far?.totalLossPct === "number"
      ? shading.far.totalLossPct
      : shading && typeof shading.farLossPct === "number"
        ? shading.farLossPct
        : null;

  if (typeof manager._refreshTemporal === "function") {
    manager._refreshTemporal({
      horizonData,
      gps,
      farBlocked: farBlockedRadar,
      dominant,
      nearPct: nearPctR,
      farPct: farPctR,
    });
  }

  updateShadingSummaryBlock(overlayRoot, manager);
}

function scheduleRedraw(manager) {
  if (manager._raf) return;
  manager._raf = requestAnimationFrame(() => {
    manager._raf = null;
    redraw(manager);
  });
}

function getApiBase() {
  const w = typeof window !== "undefined" && window.CALPINAGE_API_BASE;
  if (w) {
    return String(w).replace(/\/$/, "");
  }
  return getCrmApiBaseWithWindowFallback();
}

async function fetchHorizonOnDemand(manager, lat, lon) {
  const gpsKey = `${lat.toFixed(6)}_${lon.toFixed(6)}`;
  if (manager._horizonGpsKey === gpsKey && manager._horizonMask) {
    console.log("[DSM] cache hit, reusing horizon for", gpsKey);
    scheduleRedraw(manager);
    return;
  }

  manager._fetchAbortController?.abort();
  manager._fetchAbortController = new AbortController();
  manager._fetchLoading = true;
  scheduleRedraw(manager);

  const apiBase = getApiBase();
  const url = `${apiBase}/api/horizon-mask?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&radius=500&step=2`;
  console.log("[DSM] fetching horizon…", url);

  const timeoutId = setTimeout(() => manager._fetchAbortController?.abort(), HORIZON_FETCH_TIMEOUT_MS);

  try {
    const res = await apiFetch(url, { signal: manager._fetchAbortController.signal });
    clearTimeout(timeoutId);
    if (!manager._enabled) return;

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = errBody?.error?.message || res.statusText || `HTTP ${res.status}`;
      console.log("[DSM] horizon fail:", msg);
      manager._fetchLoading = false;
      manager._horizonMask = null;
      manager._horizonMeta = null;
      if (typeof window.computeCalpinageShading === "function") {
        const shadingRes = window.computeCalpinageShading();
        if (shadingRes && typeof window.normalizeCalpinageShading === "function") window.normalizeCalpinageShading();
      }
      if (manager._enabled) {
        setStatus(manager._container?.querySelector("#dsm-overlay-container"), "error", `Horizon indisponible : ${msg}`);
      }
      scheduleRedraw(manager);
      return;
    }

    const result = await res.json();
    const mask = result?.mask;
    if (!Array.isArray(mask) || mask.length === 0) {
      console.log("[DSM] horizon fail: mask vide");
      manager._fetchLoading = false;
      manager._horizonMask = null;
      if (typeof window.computeCalpinageShading === "function") {
        const shadingRes = window.computeCalpinageShading();
        if (shadingRes && typeof window.normalizeCalpinageShading === "function") window.normalizeCalpinageShading();
      }
      if (manager._enabled) {
        setStatus(manager._container?.querySelector("#dsm-overlay-container"), "error", "Horizon indisponible : masque vide");
      }
      scheduleRedraw(manager);
      return;
    }

    manager._horizonMask = {
      mask,
      meta: result?.meta || {},
      dataCoverage: result?.dataCoverage ?? null,
    };
    manager._horizonMeta = result?.meta;
    manager._horizonGpsKey = gpsKey;
    manager._fetchLoading = false;

    const state = getState();
    if (state && state.horizonMask) {
      state.horizonMask.data = {
        mask,
        horizon: mask.map((m) => ({ azimuth: m.az ?? 0, elevation_deg: m.elev ?? 0 })),
        meta: result?.meta || {},
        dataCoverage: result?.dataCoverage ?? null,
      };
      state.horizonMask.loadedAt = Date.now();
      if (typeof window.computeCalpinageShading === "function") {
        const res = window.computeCalpinageShading();
        if (res && typeof window.normalizeCalpinageShading === "function") {
          window.normalizeCalpinageShading();
        }
      }
    }

    const maskSource = result?.dataCoverage?.provider ?? result?.source ?? result?.meta?.source ?? "—";
    console.log("[DSM] horizon ok: len=" + mask.length + " meta.source=" + (result?.meta?.source || "—"));
    if (mask.length > 0 && maskSource) {
      const state2 = getState();
      const rawLoss = getGlobalShadingLossPctForCalpinageShadingState(state2?.shading);
      const lossPct = rawLoss == null ? "—" : rawLoss;
      const norm = state2?.shading?.normalized;
      const farSrc = norm?.far?.source ?? norm?.farSource ?? "—";
      const fhKind = norm?.far?.farHorizonKind ?? norm?.shadingQuality?.farHorizonKind ?? "—";
      const fb = norm?.far?.horizonMeta?.fallbackReason ?? "—";
      console.log("HORIZON VISUAL READY");
      console.log("MASK SOURCE: " + maskSource);
      console.log("SHADING NORMALIZED far.source: " + farSrc + " farHorizonKind: " + fhKind + " fallbackReason: " + fb);
      console.log("SHADING LOSS: " + (typeof lossPct === "number" ? lossPct.toFixed(2) + "%" : lossPct));
      console.log("VERDICT: 🟢 PASS");
    }
    scheduleRedraw(manager);
  } catch (err) {
    clearTimeout(timeoutId);
    if (err?.name === "AbortError") {
      console.log("[DSM] horizon fetch aborted");
      manager._fetchLoading = false;
      scheduleRedraw(manager);
      return;
    }
    console.log("[DSM] horizon fail:", err?.message || err);
    manager._fetchLoading = false;
    manager._horizonMask = null;
    if (typeof window.computeCalpinageShading === "function") {
      const shadingRes = window.computeCalpinageShading();
      if (shadingRes && typeof window.normalizeCalpinageShading === "function") window.normalizeCalpinageShading();
    }
    if (manager._enabled) {
      setStatus(manager._container?.querySelector("#dsm-overlay-container"), "error", `Horizon indisponible : ${err?.message || "erreur réseau"}`);
    }
    scheduleRedraw(manager);
  }
}

export function createDsmOverlayManager(container) {
  if (instance) {
    instance._container = container;
    return instance;
  }

  const manager = {
    _container: container,
    _enabled: false,
    _raf: null,
    _hoverPoint: null,
    _resizeObserver: null,
    _listeners: [],
    _horizonMask: null,
    _horizonMeta: null,
    _horizonGpsKey: null,
    _fetchAbortController: null,
    _fetchLoading: false,
    _interactionLayerDestroy: null,
    _solarPosition: null,
    _solarControlsDestroy: null,
    _refreshTemporal: null,
  };

  function onCalpinageChange() {
    if (manager._enabled) scheduleRedraw(manager);
  }

  manager.enable = function () {
    if (manager._enabled) return;
    const container = manager._container;
    if (!container || !container.isConnected) {
      let attempts = 0;
      const tryEnable = () => {
        const c = manager._container;
        if (c && c.isConnected) {
          if (typeof console !== "undefined" && console.log) {
            console.log("[DSM] enable at", typeof performance !== "undefined" ? performance.now() : Date.now(), "container resolved after", attempts, "rAF");
          }
          doEnable(manager, c);
          return;
        }
        attempts++;
        if (attempts < DSM_CONTAINER_RETRY_MAX && typeof requestAnimationFrame !== "undefined") {
          requestAnimationFrame(tryEnable);
        } else {
          if (typeof console !== "undefined" && console.warn) {
            console.warn("[DSM] container not found after", DSM_CONTAINER_RETRY_MAX, "attempts — overlay skipped (enable when CalpinageApp is mounted)");
          }
        }
      };
      if (typeof requestAnimationFrame !== "undefined") {
        requestAnimationFrame(tryEnable);
      } else {
        tryEnable();
      }
      return;
    }
    if (typeof console !== "undefined" && console.log) {
      console.log("[DSM] enable at", typeof performance !== "undefined" ? performance.now() : Date.now(), "container", !!container);
    }
    doEnable(manager, container);
  };

  function doEnable(manager, container) {
    if (manager._enabled) return;
    manager._enabled = true;
    const root = createOverlayDOM(container);
    if (!root) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[DSM] enable: createOverlayDOM returned null — overlay skipped");
      }
      manager._enabled = false;
      return;
    }
    const overlayCanvas = root.querySelector("#dsm-overlay-canvas");
    const wrapper = root.parentElement;
    if (!overlayCanvas) console.warn("[DSM] enable: #dsm-overlay-canvas not found");
    if (wrapper) {
      const style = window.getComputedStyle(wrapper);
      if (style.display === "none") console.warn("[DSM] enable: overlay parent is display:none");
    }

    const rightStack = root.querySelector(".dsm-overlay-right-stack");
    const { destroy: destroySolar, refreshTemporal } = createDsmSolarAnimationControls(root, {
      mountParent: rightStack || root,
      insertFirst: true,
      getGps: getBestGps,
      onSolarUpdate: () => scheduleRedraw(manager),
      setSolarPosition: (pos) => {
        manager._solarPosition = pos;
      },
    });
    manager._refreshTemporal = refreshTemporal;
    manager._solarControlsDestroy = destroySolar;

    redraw(manager);

    const state = getState();
    const roof = state?.roof;
    const vrd = state?.validatedRoofData;
    const gps = getBestGps();
    const horizonDataBefore = getHorizonData(manager);
    /** Pas de premier compute si un fetch horizon va suivre : évite far/normalized transitoires sans masque. */
    const willFetchHorizon = Boolean(gps && !horizonDataBefore);

    if (!willFetchHorizon && typeof window.computeCalpinageShading === "function") {
      const shadingRes = window.computeCalpinageShading();
      if (shadingRes && typeof window.normalizeCalpinageShading === "function") window.normalizeCalpinageShading();
    }
    scheduleRedraw(manager);

    console.log("[DSM] gps raw:", {
      state: !!state,
      roof: roof ? { gps: roof.gps, mapCenter: roof?.map?.centerLatLng } : null,
      validatedRoofData: vrd ? { gps: vrd?.roofState?.gps || vrd?.gps, mapCenter: vrd?.roofState?.map?.centerLatLng } : null,
      getBestGps: gps ? { lat: gps.lat, lon: gps.lon } : null,
      willFetchHorizon,
    });

    const horizonData = getHorizonData(manager);
    if (!horizonData) {
      if (!gps) {
        setStatus(root, "error", "GPS manquant — impossible d'analyser l'ombre");
        console.log("[DSM] no GPS, cannot fetch horizon");
      } else {
        fetchHorizonOnDemand(manager, gps.lat, gps.lon);
      }
    }

    const mainCanvas = container.querySelector("#calpinage-canvas-el");
    if (mainCanvas && typeof ResizeObserver !== "undefined") {
      manager._resizeObserver = new ResizeObserver(() => scheduleRedraw(manager));
      manager._resizeObserver.observe(mainCanvas);
    }

    const { destroy: destroyInteraction } = createDsmInteractionLayer(root);
    manager._interactionLayerDestroy = destroyInteraction;

    const radarWrap = container.querySelector(".dsm-horizon-radar");
    const tooltipEl = radarWrap?.querySelector(".dsm-radar-tooltip");
    if (radarWrap) {
      const moveHandler = (e) => {
        const rect = radarWrap.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 120;
        const y = ((e.clientY - rect.top) / rect.height) * 120;
        const horizonData = getHorizonData(manager);
        const points = normalizeHorizonData(horizonData);
        manager._hoverPoint = getHoverPoint(points, x, y);
        if (tooltipEl) {
          if (manager._hoverPoint) {
            tooltipEl.textContent = `az: ${Math.round(manager._hoverPoint.az)}° elev: ${manager._hoverPoint.elev.toFixed(1)}°`;
            tooltipEl.style.display = "block";
          } else {
            tooltipEl.style.display = "none";
          }
        }
        scheduleRedraw(manager);
      };
      const leaveHandler = () => {
        manager._hoverPoint = null;
        if (tooltipEl) tooltipEl.style.display = "none";
        scheduleRedraw(manager);
      };
      radarWrap.addEventListener("mousemove", moveHandler);
      radarWrap.addEventListener("mouseleave", leaveHandler);
      manager._listeners.push({ el: radarWrap, type: "mousemove", handler: moveHandler });
      manager._listeners.push({ el: radarWrap, type: "mouseleave", handler: leaveHandler });
    }
  };

  manager.disable = function () {
    if (!manager._enabled) return;
    console.log("[DSM] disable");
    manager._enabled = false;
    manager._fetchAbortController?.abort();
    manager._fetchAbortController = null;
    manager._fetchLoading = false;
    if (typeof manager._interactionLayerDestroy === "function") {
      manager._interactionLayerDestroy();
      manager._interactionLayerDestroy = null;
    }
    if (typeof manager._solarControlsDestroy === "function") {
      manager._solarControlsDestroy();
      manager._solarControlsDestroy = null;
    }
    manager._refreshTemporal = null;
    manager._solarPosition = null;
    const cont = manager._container;
    const root = cont?.querySelector?.("#dsm-overlay-container");
    if (root) {
      root.classList.remove("dsm-overlay-visible");
      const overlayCanvas = root.querySelector("#dsm-overlay-canvas");
      if (overlayCanvas && overlayCanvas.getContext) {
        const ctx = overlayCanvas.getContext("2d");
        if (ctx && overlayCanvas.width && overlayCanvas.height) {
          ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        }
      }
    }

    manager._resizeObserver?.disconnect();
    manager._resizeObserver = null;
    manager._listeners.forEach(({ el, type, handler }) => {
      try {
        el.removeEventListener(type, handler);
      } catch (_) {}
    });
    manager._listeners = [];
  };

  manager.toggle = function () {
    manager._enabled ? manager.disable() : manager.enable();
    return manager._enabled;
  };

  manager.isEnabled = function () {
    return manager._enabled;
  };

  manager.destroy = function () {
    manager.disable();
    const cont = manager._container;
    const root = cont?.querySelector?.("#dsm-overlay-container");
    if (root) root.remove();
    instance = null;
  };

  instance = manager;
  return manager;
}

export function getDsmOverlayManager() {
  return instance;
}
