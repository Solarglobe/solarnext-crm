/**
 * CP-DSM-PDF-005/007 — Page 1 "Masque d'horizon technique"
 * Graphe cartésien : axe X = azimut (E -90°, S 0°, O +90°), axe Y = hauteur solaire (0–70°).
 * 6 trajectoires représentatives (journées types par groupe de mois).
 * Bleu = visible, gris foncé = masqué, zone grise = profil horizon.
 */

import {
  buildPremiumHorizonMaskSvg,
  computeDirectionalLoss,
  computeSeasonalDominant,
  renderDirectionalHeatmapSvg,
} from "./horizonMaskPremiumChart.js";

function getTimezoneFromLon(lon) {
  const offset = Math.round(lon / 15);
  const sign = offset >= 0 ? "+" : "";
  return `UTC${sign}${offset}`;
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(n) {
  if (typeof n !== "number" || isNaN(n)) return "—";
  return n.toFixed(2);
}

/**
 * Construit le HTML de la page 1 (Masque d'horizon).
 * @param {object} data - { lat, lon, orientationDeg, tiltDeg, horizonMask, horizonMeta, address, ... }
 */
export function buildHorizonMaskPageHtml(data) {
  const {
    lat = null,
    lon = null,
    orientationDeg = null,
    tiltDeg = null,
    horizonMask = null,
    horizonMeta = {},
    address = "—",
  } = data || {};

  const source = horizonMeta?.source ?? horizonMask?.source ?? "RELIEF_ONLY";

  const latNum = typeof lat === "number" && !isNaN(lat) ? lat : null;
  const lonNum = typeof lon === "number" && !isNaN(lon) ? lon : null;
  const orient = typeof orientationDeg === "number" ? orientationDeg : null;
  const tilt = typeof tiltDeg === "number" ? tiltDeg : null;

  const tz = lonNum != null ? getTimezoneFromLon(lonNum) : "Non disponible";

  let svgContent = "";
  let directionalBlock = "";
  if (latNum != null && lonNum != null) {
    const maskArr = horizonMask?.elevations ?? horizonMask?.mask;
    if (!horizonMask || (!maskArr && !Array.isArray(horizonMask)) || ((maskArr?.length === 0) && horizonMask.length === 0)) {
      svgContent = '<div class="diagram-placeholder">Masque indisponible</div>';
    } else {
      svgContent = buildPremiumHorizonMaskSvg({ lat: latNum, lon: lonNum, horizonMask });
      try {
        const mask = horizonMask?.elevations ?? horizonMask?.mask ?? horizonMask;
        const { directionLoss } = computeDirectionalLoss(mask, latNum, lonNum);
        const seasonInfo = computeSeasonalDominant(mask, latNum, lonNum);
        const radarSvg = renderDirectionalHeatmapSvg(directionLoss, seasonInfo);
        directionalBlock = `
      <div class="directional-section">
        <h2 class="directional-title">Perte par direction et dominante saison</h2>
        <div class="diagram-block diagram-block-radar">${radarSvg}</div>
      </div>`;
      } catch (_) {
        directionalBlock = "";
      }
    }
  } else {
    svgContent = '<div class="diagram-placeholder">Coordonnées GPS non disponibles</div>';
  }

  return `
    <section class="page a4">
      <header class="page-header">
        <h1>Masque d'horizon technique</h1>
        <div class="subtitle">${escapeHtml(address)}</div>
      </header>

      <div class="diagram-block">
        ${svgContent}
      </div>
      ${directionalBlock}

      <div class="info-grid">
        <div class="info-item"><span class="label">Latitude</span><span class="value">${latNum != null ? fmt(latNum) : "Non disponible"}</span></div>
        <div class="info-item"><span class="label">Longitude</span><span class="value">${lonNum != null ? fmt(lonNum) : "Non disponible"}</span></div>
        <div class="info-item"><span class="label">Fuseau</span><span class="value">${escapeHtml(tz)}</span></div>
        <div class="info-item"><span class="label">Azimut pan</span><span class="value">${orient != null ? orient + "°" : "Non disponible"}</span></div>
        <div class="info-item"><span class="label">Inclinaison</span><span class="value">${tilt != null ? tilt + "°" : "Non disponible"}</span></div>
        <div class="info-item"><span class="label">Source</span><span class="value">${escapeHtml(source)}</span></div>
      </div>

      <div class="legend-block">
        <div class="legend-title">Comprendre le diagramme</div>
        <div class="legend-curves">Bleu : trajectoire du soleil (visible)</div>
        <div class="legend-shadow">Zone grise : soleil bloqué par l'horizon / obstacles</div>
        <div class="legend-masked">Gris foncé : portions masquées des trajectoires</div>
        <div class="legend-hours">Traits orange : heures (6h→21h) traversant les arcs</div>
        <div class="legend-horizon">Zone sous l'horizon : ombrage réel (calculé)</div>
        <div class="legend-bands">Bandes à droite : groupes de mois (Déc, Nov/Jan, etc.)</div>
      </div>

      <div class="pedagogical-block">
        <div class="pedagogical-title">Lecture du masque d'horizon</div>
        <p class="pedagogical-text">Les zones grisées représentent les obstacles (relief, bâtiments, végétation) qui masquent le soleil lorsqu'il est bas sur l'horizon.</p>
        <p class="pedagogical-text">Lorsque les trajectoires solaires passent sous cette zone, le soleil est occulté.</p>
        <p class="pedagogical-text">Dans ce cas, le masque est faible : les obstacles n'impactent l'ensoleillement qu'aux heures de lever et de coucher du soleil, principalement en période hivernale.</p>
      </div>
    </section>
  `;
}
