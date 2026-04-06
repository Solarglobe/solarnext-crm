/**
 * CP-FAR-C-11 — Masque horizon premium visuel (type Solteo)
 * CP-FAR-C-12 — Heatmap directionnelle (perte par azimut + dominante saison + radar).
 * Dôme heure × élévation : X = heure locale, Y = élévation (0→90).
 * Ombre physique : blocked = (elev<=0) OR (elev<=horizonElev(azimuth)).
 */

import { computeSunPosition } from "../services/shading/solarPosition.js";
import { getHorizonElevationAtAzimuth } from "../services/horizon/horizonInterpolation.js";

// ——— CP-FAR-C-12 : directionnel (bins 10°) ———
const DIR_AZ_BINS = 36;
const DIR_STEP_DEG = 360 / DIR_AZ_BINS;
const DIR_YEAR = 2026;
const DIR_STEP_MINUTES = 60;
const DIR_MIN_SUN_ELEV_DEG = 3;

/** Mois par saison (index 0–11). */
const SEASON_WINTER = [10, 11, 0, 1];   // Nov–Feb
const SEASON_MID = [2, 3, 8, 9];        // Mar–Apr, Sep–Oct
const SEASON_SUMMER = [4, 5, 6, 7];     // May–Aug

function clamp01(x) {
  return Math.max(0, Math.min(1, Number(x)));
}

const W = 520;
const H = 340;
const MARGIN_LEFT = 50;
const MARGIN_RIGHT = 85;
const MARGIN_TOP = 30;
const MARGIN_BOTTOM = 40;
const PLOT_W = W - MARGIN_LEFT - MARGIN_RIGHT;
const PLOT_H = H - MARGIN_TOP - MARGIN_BOTTOM;

const H_MIN = 6;
const H_MAX = 20;
const R = Math.min(PLOT_W / 2, PLOT_H / 2);
const CX = MARGIN_LEFT + PLOT_W / 2;
const CY = MARGIN_TOP + R;

/** Heure locale → Date UTC (offset approximatif depuis longitude). */
function createLocalDate(year, month, day, hour, min, lon) {
  const offset = Math.round((lon ?? 0) / 15);
  const utcHour = hour - offset;
  return new Date(Date.UTC(year, month, day, utcHour, min || 0, 0));
}

/**
 * Élévation horizon à un azimut (wrap 0/360, clamp 0..90).
 * @param {Array|object} mask - horizonMask.mask ou array [{az, elev}]
 * @param {number} azimuthDeg - degrés 0–360
 * @returns {number} degrés 0..90
 */
export function horizonElevation(mask, azimuthDeg) {
  if (!Array.isArray(mask) || mask.length === 0) return 0;
  const az = ((azimuthDeg % 360) + 360) % 360;
  const elev = getHorizonElevationAtAzimuth(mask, az);
  return Math.max(0, Math.min(90, elev));
}

/**
 * Point (heure, élévation) → (x, y) dans le dôme.
 * t = (hour - hMin)/(hMax - hMin), theta = π*(1-t), r = R*(1 - elev/90).
 */
function domeProject(hour, elevDeg) {
  const t = (hour - H_MIN) / (H_MAX - H_MIN);
  const theta = Math.PI * (1 - t);
  const elev = Math.max(0, Math.min(90, elevDeg));
  const r = R * (1 - elev / 90);
  const x = CX + r * Math.cos(theta);
  const y = CY + r * Math.sin(theta);
  return { x, y };
}

/** smoothstep(edge0, edge1, x) */
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0 || 1e-6)));
  return t * t * (3 - 2 * t);
}

const MARGIN_DEG = 4;
const ALPHA_MAX = 0.45;
const BRUSH_RADIUS = 8;

/** Jours représentatifs : 21 de chaque mois (12 jours). */
const REPRESENTATIVE_DAYS = [
  [0, 21], [1, 21], [2, 21], [3, 21], [4, 21], [5, 21],
  [6, 21], [7, 21], [8, 21], [9, 21], [10, 21], [11, 21],
];

/** Pas horaire en minutes. */
const HOUR_STEP_MIN = 10;

/**
 * Échantillonne les points ombragés (sun-path) pour tous les jours représentatifs.
 * blocked = (elev<=0) OR (elev<=horizonElev(azimuth)).
 */
function sampleShadowPoints(lat, lon, mask, year = 2025) {
  const rawMask = mask?.mask ?? mask ?? [];
  const points = [];
  for (const [month, day] of REPRESENTATIVE_DAYS) {
    for (let h = H_MIN; h <= H_MAX; h++) {
      for (let m = 0; m < 60; m += HOUR_STEP_MIN) {
        const d = createLocalDate(year, month, day, h, m, lon);
        const pos = computeSunPosition(d, lat, lon);
        if (!pos) continue;
        const { azimuthDeg, elevationDeg } = pos;
        const horizonElev = horizonElevation(rawMask, azimuthDeg);
        const blocked = elevationDeg <= 0 || elevationDeg <= horizonElev;
        const hour = h + m / 60;
        const { x, y } = domeProject(hour, elevationDeg);
        const delta = horizonElev - elevationDeg;
        const alpha = blocked ? smoothstep(0, MARGIN_DEG, delta) * ALPHA_MAX : 0;
        points.push({ x, y, blocked, alpha, elevationDeg, horizonElev });
      }
    }
  }
  return points;
}

/** Construit la couche heatmap (cercles doux + segments pour continuité). */
function buildHeatmapLayer(lat, lon, mask) {
  const pts = sampleShadowPoints(lat, lon, mask).filter((p) => p.blocked && p.alpha > 0);
  const circles = pts.map(
    (p) => `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${BRUSH_RADIUS}" fill="rgba(80,80,80,${p.alpha.toFixed(3)})" stroke="none"/>`
  );
  return circles.join("\n");
}

/** Lignes d'heures (rayons) : heure entière, r de 0 à R (elev 0→90 par pas 5°). */
function buildHourRays() {
  const strokes = [];
  for (let h = H_MIN; h <= H_MAX; h++) {
    const segs = [];
    for (let e = 0; e <= 90; e += 5) {
      const { x, y } = domeProject(h, e);
      segs.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    if (segs.length < 2) continue;
    strokes.push(
      `<path d="M ${segs.join(" L ")}" fill="none" stroke="#d4a84b" stroke-width="1" stroke-linecap="round" opacity="0.7"/>`
    );
  }
  return strokes.join("\n");
}

/** Courbes saisonnières : 21/03, 21/06, 21/09, 21/12. */
const SEASONAL_DAYS = [
  [2, 21, "équinoxe mars"],
  [5, 21, "solstice juin"],
  [8, 21, "équinoxe sept"],
  [11, 21, "solstice déc"],
];

function buildSeasonalCurves(lat, lon, year = 2025) {
  const paths = [];
  for (const [month, day] of SEASONAL_DAYS) {
    const segs = [];
    for (let h = H_MIN; h <= H_MAX; h++) {
      for (let m = 0; m < 60; m += 15) {
        const hour = h + m / 60;
        const d = createLocalDate(year, month, day, h, m, lon);
        const pos = computeSunPosition(d, lat, lon);
        if (!pos || pos.elevationDeg < 0) continue;
        const { x, y } = domeProject(hour, pos.elevationDeg);
        segs.push(`${x.toFixed(2)},${y.toFixed(2)}`);
      }
    }
    if (segs.length >= 2) {
      paths.push(
        `<path d="M ${segs.join(" L ")}" fill="none" stroke="#6b7280" stroke-width="1.5" stroke-linecap="round" opacity="0.85"/>`
      );
    }
  }
  return paths.join("\n");
}

/** Clip path demi-disque (dôme = ciel, arc en bas). */
function getDomeClipPath() {
  const cx = CX;
  const cy = CY;
  return `M ${cx - R} ${cy} A ${R} ${R} 0 0 0 ${cx + R} ${cy} L ${cx - R} ${cy} Z`;
}

/** Labels axe Y (élévation) le long du rayon gauche, axe X (heures) le long de l'arc. */
function buildAxisLabels() {
  const yLabels = [];
  for (const e of [0, 15, 30, 45, 60, 75, 90]) {
    const r = R * (1 - e / 90);
    const x = CX - r - 8;
    const y = CY + 4;
    yLabels.push(`<text x="${x.toFixed(0)}" y="${y.toFixed(0)}" text-anchor="end" font-size="9" fill="#6b7280">${e}°</text>`);
  }
  const xLabels = [];
  for (let h = H_MIN; h <= H_MAX; h += 2) {
    const { x, y } = domeProject(h, 0);
    xLabels.push(`<text x="${x.toFixed(0)}" y="${(CY + R + 18).toFixed(0)}" text-anchor="middle" font-size="9" fill="#6b7280">${h}h</text>`);
  }
  return yLabels.join("\n") + "\n" + xLabels.join("\n");
}

// ——— CP-FAR-C-12 : échantillons annuels (pondération solaire, sans moteur shading) ———
function generateAnnualSamplesForDirectional(lat, lon) {
  const samples = [];
  const startMs = new Date(DIR_YEAR, 0, 1, 0, 0, 0).getTime();
  const endMs = new Date(DIR_YEAR, 11, 31, 23, 59, 0).getTime();
  const stepMs = DIR_STEP_MINUTES * 60 * 1000;
  for (let t = startMs; t <= endMs; t += stepMs) {
    const date = new Date(t);
    const sunPos = computeSunPosition(date, lat, lon);
    if (!sunPos || sunPos.elevationDeg < DIR_MIN_SUN_ELEV_DEG) continue;
    samples.push({
      date,
      azimuthDeg: sunPos.azimuthDeg,
      elevationDeg: sunPos.elevationDeg,
    });
  }
  return samples;
}

/** Poids solaire = composante verticale (aligné far shading). */
function solarWeight(elevationDeg) {
  const elRad = (elevationDeg * Math.PI) / 180;
  return Math.max(0, Math.sin(elRad));
}

/**
 * Perte directionnelle par azimut (bins 10°).
 * @param {Array} mask - horizonMask.mask [{az, elev}]
 * @param {number} lat
 * @param {number} lon
 * @returns {{ directionLoss: Array<{az: number, lossPct: number}>, totalEnergy: number }}
 */
export function computeDirectionalLoss(mask, lat, lon) {
  const rawMask = Array.isArray(mask) ? mask : (mask?.mask ?? []);
  const samples = generateAnnualSamplesForDirectional(lat, lon);
  const totalByBin = new Array(DIR_AZ_BINS).fill(0);
  const lostByBin = new Array(DIR_AZ_BINS).fill(0);

  let totalEnergy = 0;
  for (const s of samples) {
    const az = ((s.azimuthDeg % 360) + 360) % 360;
    const bin = Math.min(DIR_AZ_BINS - 1, Math.floor(az / DIR_STEP_DEG));
    const w = solarWeight(s.elevationDeg);
    if (w <= 0) continue;
    totalByBin[bin] += w;
    totalEnergy += w;
    const horizonElev = rawMask.length > 0 ? getHorizonElevationAtAzimuth(rawMask, az) : 0;
    const blocked = s.elevationDeg <= 0 || s.elevationDeg <= horizonElev;
    if (blocked) lostByBin[bin] += w;
  }

  const directionLoss = [];
  for (let i = 0; i < DIR_AZ_BINS; i++) {
    const az = i * DIR_STEP_DEG + DIR_STEP_DEG / 2;
    const total = totalByBin[i] || 0;
    const lost = lostByBin[i] || 0;
    const lossPct = total > 0 ? clamp01(lost / total) : 0;
    directionLoss.push({ az, lossPct });
  }
  return { directionLoss, totalEnergy };
}

/**
 * Dominante saison (hiver / été / intermédiaire).
 * @returns {{ winterLossPct: number, summerLossPct: number, midSeasonLossPct: number, dominantSeason: "WINTER"|"SUMMER"|"MID" }}
 */
export function computeSeasonalDominant(mask, lat, lon) {
  const rawMask = Array.isArray(mask) ? mask : (mask?.mask ?? []);
  const samples = generateAnnualSamplesForDirectional(lat, lon);

  const add = (acc, s, lost) => {
    const w = solarWeight(s.elevationDeg);
    if (w <= 0) return;
    acc.total += w;
    if (lost) acc.lost += w;
  };

  const winter = { total: 0, lost: 0 };
  const summer = { total: 0, lost: 0 };
  const mid = { total: 0, lost: 0 };

  for (const s of samples) {
    const month = s.date.getMonth();
    const az = ((s.azimuthDeg % 360) + 360) % 360;
    const horizonElev = rawMask.length > 0 ? getHorizonElevationAtAzimuth(rawMask, az) : 0;
    const blocked = s.elevationDeg <= 0 || s.elevationDeg <= horizonElev;

    if (SEASON_WINTER.includes(month)) add(winter, s, blocked);
    else if (SEASON_SUMMER.includes(month)) add(summer, s, blocked);
    else if (SEASON_MID.includes(month)) add(mid, s, blocked);
  }

  const winterLossPct = winter.total > 0 ? clamp01(winter.lost / winter.total) : 0;
  const summerLossPct = summer.total > 0 ? clamp01(summer.lost / summer.total) : 0;
  const midSeasonLossPct = mid.total > 0 ? clamp01(mid.lost / mid.total) : 0;

  const arr = [
    { key: "WINTER", pct: winterLossPct },
    { key: "SUMMER", pct: summerLossPct },
    { key: "MID", pct: midSeasonLossPct },
  ];
  arr.sort((a, b) => b.pct - a.pct);
  const dominantSeason = arr[0].key;

  return {
    winterLossPct,
    summerLossPct,
    midSeasonLossPct,
    dominantSeason,
  };
}

/** CP-FAR-C-12 : radar 360° + légende dominante. */
const RADAR_SIZE = 200;
const RADAR_CX = RADAR_SIZE / 2;
const RADAR_CY = RADAR_SIZE / 2;
const RADAR_R = (RADAR_SIZE / 2) - 24;

/**
 * Rendu SVG heatmap directionnelle + radar premium.
 * @param {Array<{az: number, lossPct: number}>} directionLoss
 * @param {{ dominantSeason: string, winterLossPct?: number, summerLossPct?: number, midSeasonLossPct?: number }} seasonInfo
 * @returns {string} SVG
 */
export function renderDirectionalHeatmapSvg(directionLoss, seasonInfo = {}) {
  const dir = Array.isArray(directionLoss) && directionLoss.length >= DIR_AZ_BINS
    ? directionLoss
    : Array.from({ length: DIR_AZ_BINS }, (_, i) => ({ az: i * DIR_STEP_DEG + DIR_STEP_DEG / 2, lossPct: 0 }));
  const dominant = seasonInfo.dominantSeason ?? "MID";

  let maxLoss = 0;
  let maxAz = 0;
  for (const d of dir) {
    if (d.lossPct > maxLoss) {
      maxLoss = d.lossPct;
      maxAz = d.az;
    }
  }

  const arrowheadDef = `<marker id="dir-arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="#b91c1c"/></marker>`;
  const defsBlock = `<defs>${arrowheadDef}</defs>`;

  const wedges = [];
  for (let i = 0; i < dir.length; i++) {
    const { az, lossPct } = dir[i];
    const angleStart = (az - DIR_STEP_DEG / 2) * (Math.PI / 180);
    const angleEnd = (az + DIR_STEP_DEG / 2) * (Math.PI / 180);
    const r = RADAR_R * Math.max(0.05, lossPct);
    const x2 = RADAR_CX + r * Math.sin(angleStart);
    const y2 = RADAR_CY - r * Math.cos(angleStart);
    const x3 = RADAR_CX + r * Math.sin(angleEnd);
    const y3 = RADAR_CY - r * Math.cos(angleEnd);
    const fill = lossPct < 0.5 ? `#e5e7eb` : (lossPct < 0.8 ? `#9ca3af` : `#b91c1c`);
    wedges.push(`<path d="M ${RADAR_CX} ${RADAR_CY} L ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} Z" fill="${fill}" stroke="#fff" stroke-width="0.5" opacity="${(0.4 + 0.6 * lossPct).toFixed(2)}"/>`);
  }

  const circleBg = `<circle cx="${RADAR_CX}" cy="${RADAR_CY}" r="${RADAR_R}" fill="none" stroke="#d1d5db" stroke-width="1"/>`;
  const cardinals = [
    { a: 0, t: "N" },
    { a: 90, t: "E" },
    { a: 180, t: "S" },
    { a: 270, t: "O" },
  ];
  const cardinalLabels = cardinals.map(({ a, t }) => {
    const rad = (a * Math.PI) / 180;
    const x = RADAR_CX + (RADAR_R + 12) * Math.sin(rad);
    const y = RADAR_CY - (RADAR_R + 12) * Math.cos(rad);
    return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#6b7280">${t}</text>`;
  }).join("\n");

  const arrowLen = 14;
  const arrowAngle = (maxAz * Math.PI) / 180;
  const ax1 = RADAR_CX + (RADAR_R + 8) * Math.sin(arrowAngle);
  const ay1 = RADAR_CY - (RADAR_R + 8) * Math.cos(arrowAngle);
  const ax2 = RADAR_CX + (RADAR_R + 8 + arrowLen) * Math.sin(arrowAngle);
  const ay2 = RADAR_CY - (RADAR_R + 8 + arrowLen) * Math.cos(arrowAngle);
  const arrow = maxLoss > 0.01
    ? `<line x1="${ax1.toFixed(2)}" y1="${ay1.toFixed(2)}" x2="${ax2.toFixed(2)}" y2="${ay2.toFixed(2)}" stroke="#b91c1c" stroke-width="2" marker-end="url(#dir-arrowhead)"/>
       <text x="${(RADAR_CX + (RADAR_R + 8 + arrowLen + 6) * Math.sin(arrowAngle)).toFixed(0)}" y="${(RADAR_CY - (RADAR_R + 8 + arrowLen + 6) * Math.cos(arrowAngle)).toFixed(0)}" text-anchor="middle" font-size="9" fill="#374151">${Math.round(maxAz)}°</text>`
    : "";

  const legendSeason = {
    WINTER: "Hiver (Nov–Fév)",
    SUMMER: "Été (Mai–Août)",
    MID: "Intermédiaire (Mar–Avr, Sep–Oct)",
  };
  const seasonLabel = legendSeason[dominant] || dominant;
  const legendY = RADAR_SIZE - 8;
  const legend = `<text x="${RADAR_CX}" y="${legendY}" text-anchor="middle" font-size="10" fill="#374151" font-weight="600">Dominante : ${seasonLabel}</text>`;

  const parts = [
    defsBlock,
    `<g id="radar-bg">${circleBg}</g>`,
    `<g id="radar-wedges">${wedges.join("\n")}</g>`,
    `<g id="radar-cardinals">${cardinalLabels}</g>`,
    arrow ? `<g id="radar-arrow">${arrow}</g>` : "",
    `<g id="radar-legend">${legend}</g>`,
  ].filter(Boolean);

  return `<svg viewBox="0 0 ${RADAR_SIZE} ${RADAR_SIZE}" class="horizon-directional-radar" preserveAspectRatio="xMidYMid meet">
${parts.join("\n")}
</svg>`;
}

/**
 * Point d'entrée unique — rendu SVG du masque horizon premium.
 * Ordre : clip dôme → fond → heatmap ombre → rayons heures → courbes saisonnières → labels.
 * @param {{ lat: number, lon: number, horizonMask?: object|Array }} params
 * @returns {string} SVG
 */
export function renderPremiumHorizonMaskChart({ lat, lon, horizonMask }) {
  const mask = horizonMask?.elevations ?? horizonMask?.mask ?? (Array.isArray(horizonMask) ? horizonMask : []);
  const latNum = typeof lat === "number" && !isNaN(lat) ? lat : null;
  const lonNum = typeof lon === "number" && !isNaN(lon) ? lon : null;

  if (latNum == null || lonNum == null) {
    return `<svg viewBox="0 0 ${W} ${H}" class="horizon-premium-chart"><text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="#6b7280">Coordonnées GPS non disponibles</text></svg>`;
  }

  const clipId = "dome-clip-premium";
  const clipPath = getDomeClipPath();
  const heatmap = buildHeatmapLayer(latNum, lonNum, { mask });
  const hourRays = buildHourRays();
  const seasonalCurves = buildSeasonalCurves(latNum, lonNum);
  const axisLabels = buildAxisLabels();

  const bgRect = `<rect x="${MARGIN_LEFT}" y="${MARGIN_TOP}" width="${PLOT_W}" height="${PLOT_H}" fill="#fafafa" stroke="#e5e7eb" stroke-width="0.5"/>`;

  const defs = `<defs><clipPath id="${clipId}"><path d="${clipPath}"/></clipPath></defs>`;

  const layers = [
    `<g clip-path="url(#${clipId})">`,
    bgRect,
    `<g id="heatmap-layer">${heatmap}</g>`,
    `<g id="hour-rays-layer">${hourRays}</g>`,
    `<g id="seasonal-layer">${seasonalCurves}</g>`,
    "</g>",
    `<g id="axis-labels">${axisLabels}</g>`,
  ].join("\n");

  return `<svg viewBox="0 0 ${W} ${H}" class="horizon-premium-chart" preserveAspectRatio="xMidYMid meet">
${defs}
${layers}
</svg>`;
}

/** Stats du masque (min/max élévation bloquante) pour tests/audit. */
export function getVisibilityMaskStats(mask) {
  const m = mask ?? [];
  if (!Array.isArray(m) || m.length === 0) return { minBlockingDeg: 0, maxBlockingDeg: 0 };
  let minB = Infinity;
  let maxB = -Infinity;
  for (let az = 0; az < 360; az += 5) {
    const h = horizonElevation(m, az);
    minB = Math.min(minB, h);
    maxB = Math.max(maxB, h);
  }
  return {
    minBlockingDeg: minB === Infinity ? 0 : minB,
    maxBlockingDeg: maxB === -Infinity ? 0 : maxB,
  };
}

/** Alias pour compatibilité buildHorizonMaskPageHtml : même signature que buildHorizonCartesianSvg. */
export function buildPremiumHorizonMaskSvg({ lat, lon, horizonMask }) {
  return renderPremiumHorizonMaskChart({ lat, lon, horizonMask });
}
