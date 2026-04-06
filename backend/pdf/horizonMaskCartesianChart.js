/**
 * DEPRECATED — REMOVED FROM PIPELINE (CP-FAR-C-11).
 * Remplacé par backend/pdf/horizonMaskPremiumChart.js pour l'export PDF/PDS.
 * Ce fichier est conservé pour référence ; aucun callsite ne doit l'utiliser pour le rendu.
 *
 * CP-DSM-PDF-007 — Sun-path chart (style Solteo)
 * X = azimut Solteo [-135°, +135°], Y = élévation 0–70° (0 en bas).
 */

import { computeSunPosition } from "../services/shading/solarPosition.js";
import { getHorizonElevationAtAzimuth } from "../services/horizon/horizonInterpolation.js";

const W = 520;
const H = 340;
const MARGIN_LEFT = 50;
const MARGIN_RIGHT = 85;
const MARGIN_TOP = 30;
const MARGIN_BOTTOM = 40;
const PLOT_W = W - MARGIN_LEFT - MARGIN_RIGHT;
const PLOT_H = H - MARGIN_TOP - MARGIN_BOTTOM;

const AZ_MIN = -135;
const AZ_MAX = 135;
const ELEV_MIN = 0;
const ELEV_MAX = 70;

/** Groupes de mois (dates représentatives = 21, année = param year). Ordre = étiquette à droite (haut → bas). */
const GROUPS = [
  { key: "MAI_JUIN_JUIL", label: "Mai/Juin/Juil", month: 5 },
  { key: "AVR_AOUT", label: "Avr/Août", month: 3 },
  { key: "MAR_SEP", label: "Mar/Sep", month: 2 },
  { key: "FEV_OCT", label: "Fév/Oct", month: 1 },
  { key: "NOV_JAN", label: "Nov/Jan", month: 10 },
  { key: "DEC", label: "Déc", month: 11 },
];

const REF_DAY = 21;

/** Europe/Paris : offset UTC en heures (1 hiver, 2 été). DST = dernier dimanche mars → dernier dimanche octobre */
function getParisOffsetHours(year, month, day) {
  const lastSunday = (y, m) => {
    const last = new Date(Date.UTC(y, m + 1, 0));
    const d = last.getUTCDay();
    return last.getUTCDate() - d;
  };
  const marLast = lastSunday(year, 2);
  const octLast = lastSunday(year, 9);
  const d = new Date(Date.UTC(year, month, day));
  const dayOfMonth = d.getUTCDate();
  if (month < 2) return 1;
  if (month > 9) return 1;
  if (month === 2) return dayOfMonth < marLast ? 1 : 2;
  if (month === 9) return dayOfMonth < octLast ? 2 : 1;
  return 2;
}

/** Crée une Date UTC représentant heure locale Paris */
function createParisDate(year, month, day, hour, min = 0, sec = 0) {
  const offset = getParisOffsetHours(year, month, day);
  const utcHour = hour - offset;
  return new Date(Date.UTC(year, month, day, utcHour, min, sec));
}

function elevToSvgY(elevDeg) {
  const e = Math.max(ELEV_MIN, Math.min(ELEV_MAX, elevDeg));
  return MARGIN_TOP + PLOT_H - (e / ELEV_MAX) * PLOT_H;
}

/** Chart x [-135,+135] → SVG x */
function chartXToSvgX(azChart) {
  return MARGIN_LEFT + ((azChart - AZ_MIN) / (AZ_MAX - AZ_MIN)) * PLOT_W;
}

/** Azimut chart (convention Solteo) : az réel → x chart [-135, +135] */
function azRealToChartX(azDeg) {
  let x = azDeg - 180;
  if (x < -180) x += 360;
  if (x > 180) x -= 360;
  return x;
}

/** xChart → azimut réel (0–360) */
function xChartToAzReal(xChart) {
  return ((xChart + 180) % 360 + 360) % 360;
}

const HORIZON_FILL_OPACITY = 0.08;
const MASK_FULL_OPACITY = 0.25;
const MASK_MIXED_OPACITY = 0.15;

/** CP-FAR-IGN-05: Courbes mois fines, gris clair (style Solteo premium) */
const MONTH_CURVE_COLOR = "#9ca3af";
const HOUR_LINE_STROKE_WIDTH = "0.5";
const HOUR_LINE_COLOR = "#eab308";
const HOUR_LINE_OPACITY = "0.85";
const MASK_FILL_COLOR = "rgba(100,100,100,0.25)";

/** B) Trajectoire journée type : h=6..21 (entiers), date (year, group.month, 21) Paris. elev>0, dans domaine X. */
function getTrajectoryPoints(lat, lon, group, year = 2025) {
  const points = [];
  for (let h = 6; h <= 21; h++) {
    const d = createParisDate(year, group.month, REF_DAY, h, 0, 0);
    const pos = computeSunPosition(d, lat, lon);
    if (!pos || pos.elevationDeg <= 0) continue;
    const azChart = azRealToChartX(pos.azimuthDeg);
    if (azChart < AZ_MIN || azChart > AZ_MAX) continue;
    const x = chartXToSvgX(azChart);
    const y = elevToSvgY(pos.elevationDeg);
    points.push({ x, y, az: pos.azimuthDeg, elev: pos.elevationDeg, hour: h });
  }
  return points;
}

/** Données par groupe (trajectoire + maxElevation) pour les arcs et labels. */
function getGroupsData(lat, lon, year = 2025) {
  return GROUPS.map((g) => {
    const pathPoints = getTrajectoryPoints(lat, lon, g, year);
    let maxElevation = 0;
    for (const p of pathPoints) {
      if (p.elev > maxElevation) maxElevation = p.elev;
    }
    return { ...g, pathPoints, maxElevation };
  });
}

/** Trouve t ∈ [0,1] où elev(t) = horizon(az(t)) sur le segment A→B */
function findPathHorizonIntersection(prev, p, mask) {
  const t = findHorizonIntersectionT(prev.az, prev.elev, p.az, p.elev, mask);
  if (t == null || t <= 0 || t >= 1) return null;
  return {
    x: prev.x + t * (p.x - prev.x),
    y: prev.y + t * (p.y - prev.y),
    az: prev.az + t * (p.az - prev.az),
    elev: prev.elev + t * (p.elev - prev.elev),
  };
}

/** Découpe une trajectoire en segments consécutifs (visible / masqué). Règle : masked = (elev<=0) OR (elev<=horizonElev). */
function splitPathByMask(pts, mask) {
  const runs = [];
  let current = [];
  let currentShadow = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const horizonElev = getHorizonElevationAtAzimuth(mask, p.az);
    const inShadow = p.elev <= 0 || p.elev <= horizonElev;
    if (currentShadow !== inShadow && current.length > 0) {
      const prev = current[current.length - 1];
      const inter = findPathHorizonIntersection(prev, p, mask);
      if (inter) {
        current.push(inter);
        runs.push({ points: current, inShadow: currentShadow });
        current = [inter, p];
      } else {
        runs.push({ points: current, inShadow: currentShadow });
        current = [p];
      }
    } else {
      current.push(p);
    }
    currentShadow = inShadow;
  }
  if (current.length > 0) runs.push({ points: current, inShadow: currentShadow });
  return runs;
}

/** Trouve t ∈ [0,1] où elev(t) = horizon(az(t)) sur le segment A→B (az-elev) */
function findHorizonIntersectionT(aAz, aElev, bAz, bElev, mask) {
  const horizonA = getHorizonElevationAtAzimuth(mask, aAz);
  const horizonB = getHorizonElevationAtAzimuth(mask, bAz);
  const aVisible = aElev > horizonA;
  const bVisible = bElev > horizonB;
  if (aVisible === bVisible) return null;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 25; i++) {
    const t = (lo + hi) / 2;
    const az = aAz + t * (bAz - aAz);
    const elev = aElev + t * (bElev - aElev);
    const horizon = getHorizonElevationAtAzimuth(mask, az);
    const visible = elev > horizon;
    if (visible === aVisible) lo = t;
    else hi = t;
  }
  return (lo + hi) / 2;
}

/** Profil horizon (optionnel, opacité ultra faible ; ne pas utiliser comme zone grise principale). */
function buildHorizonFillPath(mask) {
  const pts = [];
  for (let azChart = AZ_MIN; azChart <= AZ_MAX; azChart += 0.5) {
    const azReal = xChartToAzReal(azChart);
    const horizonElev = Array.isArray(mask) && mask.length > 0
      ? getHorizonElevationAtAzimuth(mask, azReal)
      : 0;
    const y = elevToSvgY(Math.max(0, horizonElev));
    const x = chartXToSvgX(azChart);
    pts.push({ x, y });
  }
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`;
  const yBase = elevToSvgY(0);
  d += ` L ${pts[pts.length - 1].x} ${yBase} L ${pts[0].x} ${yBase} Z`;
  return d;
}

/** D) Point du maillage (groupe gIndex, heure h). masked = (elev<=0) OR (elev<=horizonElev). inDomain = X et Y dans le plot (pas de clamp). */
function sampleMeshPoint(lat, lon, year, gIndex, hour, mask) {
  const group = GROUPS[gIndex];
  const d = createParisDate(year, group.month, REF_DAY, hour, 0, 0);
  const pos = computeSunPosition(d, lat, lon);
  const elev = pos ? pos.elevationDeg : -1;
  const azReal = pos ? pos.azimuthDeg : 180;
  const azChart = azRealToChartX(azReal);
  const x = chartXToSvgX(azChart);
  const y = elevToSvgY(elev);
  const inDomain = pos != null && azChart >= AZ_MIN && azChart <= AZ_MAX && elev >= ELEV_MIN && elev <= ELEV_MAX;
  const horizonElev = Array.isArray(mask) && mask.length > 0 ? getHorizonElevationAtAzimuth(mask, azReal) : 0;
  const masked = elev <= 0 || elev <= horizonElev;
  return { x, y, masked, inDomain };
}

/** Heures du maillage [6..21] */
const HOURS_GRID = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

/**
 * D) Masque gris principal : quads (g,h)-(g+1,h+1). P00,P10,P11,P01.
 * 4/4 masked => rgba 0.22 ; mixte => 0.12 ; 0/4 => rien. Skip si un point hors domaine.
 */
function buildVisibilityMeshLayer(lat, lon, year, mask) {
  const paths = [];
  for (let g = 0; g < GROUPS.length - 1; g++) {
    for (let hi = 0; hi < HOURS_GRID.length - 1; hi++) {
      const h0 = HOURS_GRID[hi];
      const h1 = HOURS_GRID[hi + 1];
      const P00 = sampleMeshPoint(lat, lon, year, g, h0, mask);
      const P10 = sampleMeshPoint(lat, lon, year, g, h1, mask);
      const P11 = sampleMeshPoint(lat, lon, year, g + 1, h1, mask);
      const P01 = sampleMeshPoint(lat, lon, year, g + 1, h0, mask);
      if (!P00.inDomain || !P10.inDomain || !P11.inDomain || !P01.inDomain) continue;
      const nMasked = [P00, P10, P11, P01].filter((p) => p.masked).length;
      if (nMasked === 0) continue;
      const opacity = nMasked === 4 ? MASK_FULL_OPACITY : MASK_MIXED_OPACITY;
      const d = `M ${P00.x} ${P00.y} L ${P10.x} ${P10.y} L ${P11.x} ${P11.y} L ${P01.x} ${P01.y} Z`;
      paths.push(`<path class="visibility-cell" d="${d}" fill="${MASK_FILL_COLOR.replace("0.25", String(opacity))}" stroke="none"/>`);
    }
  }
  return paths;
}

/** C) Hour-lines orange : un point par groupe dans l’ordre GROUPS (pas de tri). Polyline, label près du groupe le plus haut avec elev>0. */
function buildHourLinePaths(lat, lon, year) {
  const paths = [];
  const labels = [];
  for (let H = 6; H <= 21; H++) {
    const points = [];
    for (let gi = 0; gi < GROUPS.length; gi++) {
      const group = GROUPS[gi];
      const d = createParisDate(year, group.month, REF_DAY, H, 0, 0);
      const pos = computeSunPosition(d, lat, lon);
      const elev = pos ? pos.elevationDeg : -1;
      const azReal = pos ? pos.azimuthDeg : 180;
      const azChart = azRealToChartX(azReal);
      const x = chartXToSvgX(azChart);
      const y = elevToSvgY(elev);
      points.push({ x, y, elev, night: elev <= 0 });
    }
    if (points.length < 2) continue;
    const d = points.map((p, j) => (j === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");
    paths.push(`<path class="hour-line" data-hour="${H}" d="${d}" fill="none" stroke="${HOUR_LINE_COLOR}" stroke-width="${HOUR_LINE_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round" opacity="${HOUR_LINE_OPACITY}"/>`);
    const firstAbove = points.findIndex((p) => p.elev > 0);
    if (firstAbove >= 0) {
      const lab = points[firstAbove];
      labels.push(`<text x="${lab.x + 6}" y="${lab.y - 2}" text-anchor="start" font-size="9" fill="${HOUR_LINE_COLOR}" font-weight="500" opacity="${HOUR_LINE_OPACITY}">${H}h</text>`);
    }
  }
  return { paths, labels };
}

/** Export pour tests */
export { createParisDate, getGroupsData };

/** Alias compatibilité */
export function getMonthGroupsData(lat, lon, year = 2025) {
  return getGroupsData(lat, lon, year);
}

/** Compatibilité tests : 12 mois → groupe (0=MAI_JUIN_JUIL .. 5=DEC) */
const MONTH_TO_GROUP = [4, 3, 2, 1, 0, 0, 0, 1, 2, 3, 4, 5];

export function getSortedMonthsData(lat, lon, year = 2025) {
  const groups = getGroupsData(lat, lon, year);
  const result = [];
  for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
    const g = groups[MONTH_TO_GROUP[monthIndex]];
    result.push({ monthIndex, maxElevation: g.maxElevation, pathPoints: g.pathPoints });
  }
  result.sort((a, b) => a.maxElevation - b.maxElevation);
  return result;
}

export function getMonthData(lat, lon, monthIndex, year = 2025) {
  const groupIdx = MONTH_TO_GROUP[monthIndex];
  const groups = getGroupsData(lat, lon, year);
  const g = groups[groupIdx];
  return g ? { monthIndex, maxElevation: g.maxElevation, pathPoints: g.pathPoints } : null;
}

/** Stats du masque sur le domaine chart (min/max élévation bloquante) */
export function getVisibilityMaskStats(mask) {
  const m = mask || [];
  let minBlockingDeg = Infinity;
  let maxBlockingDeg = -Infinity;
  for (let azChart = AZ_MIN; azChart <= AZ_MAX; azChart += 5) {
    const azReal = xChartToAzReal(azChart);
    const h = Array.isArray(m) && m.length > 0
      ? getHorizonElevationAtAzimuth(m, azReal)
      : 0;
    const blocking = Math.max(0, h);
    minBlockingDeg = Math.min(minBlockingDeg, blocking);
    maxBlockingDeg = Math.max(maxBlockingDeg, blocking);
  }
  return {
    minBlockingDeg: minBlockingDeg === Infinity ? 0 : minBlockingDeg,
    maxBlockingDeg: maxBlockingDeg === -Infinity ? 0 : maxBlockingDeg,
  };
}

/**
 * Construit le SVG du graphe cartésien.
 * E) Ordre : background → visibility-mesh-layer (gris) → sun-layer (arcs) → hour-layer → labels.
 */
export function buildHorizonCartesianSvg({ lat, lon, horizonMask }) {
  const mask = horizonMask?.mask || horizonMask || [];
  const source = horizonMask?.source ?? "RELIEF_ONLY";
  const resolutionM = horizonMask?.dataCoverage?.gridResolutionMeters ?? null;
  const latNum = typeof lat === "number" && !isNaN(lat) ? lat : null;
  const lonNum = typeof lon === "number" && !isNaN(lon) ? lon : null;
  const year = 2025;

  if (latNum == null || lonNum == null) {
    return `<svg viewBox="0 0 ${W} ${H}" class="horizon-cartesian-chart"><text x="${W/2}" y="${H/2}" text-anchor="middle" fill="#6b7280">Coordonnées GPS non disponibles</text></svg>`;
  }

  const groupsData = getGroupsData(latNum, lonNum, year);
  const visibilityMeshPaths = buildVisibilityMeshLayer(latNum, lonNum, year, mask);
  const { paths: hourPaths, labels: hourLabels } = buildHourLinePaths(latNum, lonNum, year);

  const sourceLabel =
    source === "IGN_RGE_ALTI"
      ? `Ombrage lointain : IGN RGE ALTI${resolutionM != null ? ` (${resolutionM} m)` : ""}`
      : source === "HTTP_GEOTIFF"
        ? `Ombrage lointain : GeoTIFF${resolutionM != null ? ` (${resolutionM} m)` : ""}`
        : `Ombrage lointain : ${source}`;

  const gridStroke = "#e5e7eb";
  const gridStrokeWidth = "0.5";
  const bgParts = [];
  bgParts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
  for (let e = 10; e <= 60; e += 10) {
    const y = elevToSvgY(e);
    bgParts.push(`<line x1="${MARGIN_LEFT}" y1="${y}" x2="${MARGIN_LEFT + PLOT_W}" y2="${y}" stroke="${gridStroke}" stroke-width="${gridStrokeWidth}"/>`);
  }
  for (let az = -135; az <= 135; az += 45) {
    const x = MARGIN_LEFT + ((az - AZ_MIN) / (AZ_MAX - AZ_MIN)) * PLOT_W;
    bgParts.push(`<line x1="${x}" y1="${MARGIN_TOP}" x2="${x}" y2="${MARGIN_TOP + PLOT_H}" stroke="${gridStroke}" stroke-width="${gridStrokeWidth}"/>`);
  }

  const horizonFillD = buildHorizonFillPath(mask);
  const horizonFillPart = horizonFillD
    ? `<path class="horizon-fill" d="${horizonFillD}" fill="rgba(100,100,100,${HORIZON_FILL_OPACITY})" stroke="none"/>`
    : "";

  const sunParts = [];
  const monthLabelParts = [];
  groupsData.forEach((group, i) => {
    const pts = group.pathPoints;
    const runs = splitPathByMask(pts, mask);
    for (const run of runs) {
      if (run.points.length < 2) continue;
      const d = run.points.map((p, j) => (j === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");
      if (run.inShadow) {
        sunParts.push(`<path class="sun-masked" d="${d}" fill="none" stroke="rgba(100,116,139,0.4)" stroke-width="0.8"/>`);
      } else {
        sunParts.push(`<path class="sun-visible" d="${d}" fill="none" stroke="${MONTH_CURVE_COLOR}" stroke-width="1" opacity="0.9"/>`);
      }
    }
    monthLabelParts.push({ y: elevToSvgY(group.maxElevation), label: group.label });
  });

  const mergedLabels = [];
  for (const { y, label } of monthLabelParts) {
    const existing = mergedLabels.find((g) => Math.abs(g.y - y) < 3);
    if (existing) existing.labels.push(label);
    else mergedLabels.push({ y, labels: [label] });
  }
  const monthLabelEls = [];
  for (const g of mergedLabels) {
    monthLabelEls.push(`<line x1="${MARGIN_LEFT}" y1="${g.y}" x2="${MARGIN_LEFT + PLOT_W}" y2="${g.y}" stroke="#64748b" stroke-width="0.8"/>`);
    monthLabelEls.push(`<text x="${MARGIN_LEFT + PLOT_W + 8}" y="${g.y + 3}" text-anchor="start" font-size="9" fill="#475569" font-weight="600">${g.labels.join(" / ")}</text>`);
  }

  const labelParts = [];
  [[-135, "-135°"], [-90, "E"], [-45, "-45°"], [0, "S"], [45, "+45°"], [90, "O"], [135, "+135°"]].forEach(([az, label]) => {
    const x = MARGIN_LEFT + ((az - AZ_MIN) / (AZ_MAX - AZ_MIN)) * PLOT_W;
    labelParts.push(`<text x="${x}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#6b7280">${label}</text>`);
  });
  for (let e = 0; e <= 70; e += 10) {
    const y = elevToSvgY(e);
    labelParts.push(`<text x="${MARGIN_LEFT - 6}" y="${y + 4}" text-anchor="end" font-size="9" fill="#6b7280">${e}°</text>`);
  }

  const sourceLabelEl = `<text x="${MARGIN_LEFT}" y="${MARGIN_TOP - 8}" text-anchor="start" font-size="10" fill="#64748b">${sourceLabel}</text>`;

  const parts = [];
  parts.push(`<g id="background-layer">\n${bgParts.join("\n")}\n</g>`);
  parts.push(`<g id="visibility-mesh-layer">\n${visibilityMeshPaths.join("\n")}\n</g>`);
  if (horizonFillPart) parts.push(`<g id="horizon-fill-layer">\n${horizonFillPart}\n</g>`);
  parts.push(`<g id="sun-layer">\n${sunParts.join("\n")}\n</g>`);
  parts.push(`<g id="hour-layer">\n${hourPaths.join("\n")}\n${hourLabels.join("\n")}\n</g>`);
  parts.push(`<g id="month-labels-layer">\n${monthLabelEls.join("\n")}\n</g>`);
  parts.push(sourceLabelEl);
  parts.push(...labelParts);

  return `<svg viewBox="0 0 ${W} ${H}" class="horizon-cartesian-chart" preserveAspectRatio="xMidYMid meet">
${parts.join("\n")}
</svg>`;
}
