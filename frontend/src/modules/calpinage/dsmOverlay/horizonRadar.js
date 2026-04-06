/**
 * CP-DSM-016 — Horizon Mask Radar (cercle 120px, 0–360°, courbe élévation)
 *
 * DSM OVERLAY ONLY — canvas / UI. Not the official shading source of truth.
 */

const RADIUS = 54;
const CENTER = 60;
const GOLD = "#d4af37";
const GOLD_FINE = "rgba(212, 175, 55, 0.9)";

/**
 * Azimut géographique (0° = Nord, 90° = Est, horaire) → angle canvas aligné sur les rayons 45° :
 * Nord en haut, Est à droite (même convention que les lignes radiales du fond).
 */
function geoAzToCanvasRad(azDeg) {
  return ((azDeg - 90) * Math.PI) / 180;
}

/** Point sur le radar : x = cos(azRad), y = +sin(azRad) — le « −sin » historique inversait N/S vs le quadrillage. */
function pointOnRadar(cx, cy, dist, azRad) {
  return {
    x: cx + dist * Math.cos(azRad),
    y: cy + dist * Math.sin(azRad),
  };
}

/** Secteur ±22,5° autour de l’azimut centre (géo), arc canvas court (gère le passage par 0°). */
function dominantSectorArcAngles(azCenterDeg) {
  const start = geoAzToCanvasRad(azCenterDeg - 22.5);
  let end = geoAzToCanvasRad(azCenterDeg + 22.5);
  if (end < start) end += 2 * Math.PI;
  return { start, end };
}

function drawCardinalLabels(ctx, cx, cy) {
  ctx.save();
  ctx.font = '600 7.5px system-ui, "Segoe UI", sans-serif';
  ctx.fillStyle = "rgba(148, 163, 184, 0.7)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const rLab = RADIUS - 10;
  const marks = [
    { t: "N", az: 0 },
    { t: "E", az: 90 },
    { t: "S", az: 180 },
    { t: "O", az: 270 },
  ];
  for (const { t, az } of marks) {
    const rad = geoAzToCanvasRad(az);
    const x = cx + rLab * Math.cos(rad);
    const y = cy + rLab * Math.sin(rad);
    ctx.fillText(t, x, y);
  }
  ctx.restore();
}

/**
 * Normalise horizon data: supporte { mask: [{az, elev}] } ou { horizon: [{azimuth, elevation_deg}] }
 * @param {object} data
 * @returns {{ az: number, elev: number }[]}
 */
export function normalizeHorizonData(data) {
  if (!data) return [];
  if (Array.isArray(data.mask) && data.mask.length > 0) {
    return data.mask.map((m) => ({
      az: typeof m.az === "number" ? m.az : 0,
      elev: typeof m.elev === "number" ? m.elev : 0,
    }));
  }
  if (Array.isArray(data.horizon) && data.horizon.length > 0) {
    return data.horizon.map((h) => ({
      az: typeof h.azimuth === "number" ? h.azimuth : 0,
      elev: typeof h.elevation_deg === "number" ? h.elevation_deg : 0,
    }));
  }
  return [];
}

/**
 * Dessine le radar horizon sur le canvas
 * @param {HTMLCanvasElement} canvas
 * @param {{ az: number, elev: number }[]} points
 * @param {{ az?: number, elev?: number } | null} hoverPoint - point sous le curseur pour tooltip
 * @param {{ az: number, elev: number } | null} dominantDirection - direction dominante (flèche + zone rouge)
 * @param {{ azimuthDeg?: number, elevationDeg?: number } | null} sunPosition - position soleil (CP-DSM-UI-003)
 */
export function drawHorizonRadar(canvas, points, hoverPoint = null, dominantDirection = null, sunPosition = null) {
  if (typeof window !== "undefined") {
    (window.__DSM_DRAW_RADAR_CALLS__ = window.__DSM_DRAW_RADAR_CALLS__ || []).push({ pointsLength: points?.length ?? 0, ts: Date.now() });
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = 120;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + "px";
  canvas.style.height = size + "px";
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, size, size);

  const cx = CENTER;
  const cy = CENTER;
  const r = RADIUS;
  const maxElev = 90;

  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 0.5;
  for (let a = 0; a < 360; a += 45) {
    const rad = (a * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + r * Math.cos(rad), cy - r * Math.sin(rad));
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r / 2, 0, Math.PI * 2);
  ctx.stroke();

  drawCardinalLabels(ctx, cx, cy);

  if (points.length < 2) return;

  ctx.strokeStyle = GOLD_FINE;
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const azRad = geoAzToCanvasRad(p.az);
    const elevNorm = Math.min(1, Math.max(0, p.elev / maxElev));
    const dist = r * (1 - elevNorm * 0.85);
    const { x, y } = pointOnRadar(cx, cy, dist, azRad);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();

  if (dominantDirection && points.length >= 2) {
    const azRad = geoAzToCanvasRad(dominantDirection.az);
    const elevNorm = Math.min(1, Math.max(0, dominantDirection.elev / maxElev));
    const dist = r * (1 - elevNorm * 0.85);
    const { start: arcStart, end: arcEnd } = dominantSectorArcAngles(dominantDirection.az);
    ctx.fillStyle = "rgba(255, 80, 80, 0.25)";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, arcStart, arcEnd, false);
    ctx.closePath();
    ctx.fill();
    const arrowLen = 18;
    const { x: tipX, y: tipY } = pointOnRadar(cx, cy, dist + arrowLen, azRad);
    ctx.strokeStyle = "#f87171";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    const headLen = 6;
    const angle = Math.atan2(cy - tipY, tipX - cx);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - headLen * Math.cos(angle - 0.4), tipY + headLen * Math.sin(angle - 0.4));
    ctx.lineTo(tipX - headLen * Math.cos(angle + 0.4), tipY + headLen * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fillStyle = "#f87171";
    ctx.fill();
  }

  if (hoverPoint) {
    const azRad = geoAzToCanvasRad(hoverPoint.az);
    const elevNorm = Math.min(1, Math.max(0, (hoverPoint.elev || 0) / maxElev));
    const dist = r * (1 - elevNorm * 0.85);
    const { x: hx, y: hy } = pointOnRadar(cx, cy, dist, azRad);
    ctx.fillStyle = GOLD_FINE;
    ctx.beginPath();
    ctx.arc(hx, hy, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  if (sunPosition && (typeof sunPosition.azimuthDeg === "number" || typeof sunPosition.elevationDeg === "number")) {
    const az = sunPosition.azimuthDeg ?? 0;
    const elev = sunPosition.elevationDeg ?? 0;
    const azRad = geoAzToCanvasRad(az);
    const elevNorm = Math.min(1, Math.max(0, elev / maxElev));
    const dist = r * (1 - elevNorm * 0.85);
    const { x: sx, y: sy } = pointOnRadar(cx, cy, dist, azRad);
    const haloRadius = 8 + elevNorm * 4;
    const gradient = ctx.createRadialGradient(sx, sy, 0, sx, sy, haloRadius);
    gradient.addColorStop(0, "rgba(255, 220, 100, 0.9)");
    gradient.addColorStop(0.5, "rgba(255, 180, 50, 0.4)");
    gradient.addColorStop(1, "rgba(255, 140, 0, 0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(sx, sy, haloRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffd700";
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/**
 * Trouve le point le plus proche du curseur (en coordonnées canvas)
 * @param {{ az: number, elev: number }[]} points
 * @param {number} mouseX
 * @param {number} mouseY
 * @returns {{ az: number, elev: number } | null}
 */
export function getHoverPoint(points, mouseX, mouseY) {
  if (points.length === 0) return null;
  const cx = CENTER;
  const cy = CENTER;
  const r = RADIUS;
  const maxElev = 90;

  let best = null;
  let bestD = 20;

  for (const p of points) {
    const azRad = geoAzToCanvasRad(p.az);
    const elevNorm = Math.min(1, Math.max(0, p.elev / maxElev));
    const dist = r * (1 - elevNorm * 0.85);
    const { x, y } = pointOnRadar(cx, cy, dist, azRad);
    const d = Math.hypot(mouseX - x, mouseY - y);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
