/**
 * Géométrie de pose « pro » : ancrage coin / extrémité de diamètre, défauts catalogue.
 * Plancher de taille = technique (~1 cm terrain) pour éviter NaN / géométrie dégénérée — plus de fraction catalogue.
 * Les obstacles persistés restent centre + dimensions (shapeMeta) — compatible moteur existant.
 */

import { getRoofObstacleCatalogEntry } from "./roofObstacleCatalog";

/** Largeur / hauteur / diamètre plancher (m) — invisible en usage normal, évite dégénérescence. */
export const TECH_MIN_DIM_M = 0.01;

/** Rayon plancher (m) pour cercles / tubes : demi-diamètre technique. */
const TECH_MIN_RADIUS_M = TECH_MIN_DIM_M / 2;

/**
 * Minima en pixels image (axes w/h et rayon), dérivés de TECH_MIN_DIM_M.
 */
export function technicalMinObstaclePixels(metersPerPixel: number): {
  minW: number;
  minH: number;
  minR: number;
} {
  const mpp = metersPerPixel > 0 ? metersPerPixel : 1;
  const minW = Math.max(2, TECH_MIN_DIM_M / mpp);
  const minH = Math.max(2, TECH_MIN_DIM_M / mpp);
  const minR = Math.max(1, TECH_MIN_RADIUS_M / mpp);
  return { minW, minH, minR };
}

function fallbackBusinessIdRect(businessId: string | null | undefined): string {
  if (businessId && getRoofObstacleCatalogEntry(businessId)?.geometryShape === "rect") {
    return businessId;
  }
  return "keepout_zone";
}

function fallbackBusinessIdCircle(businessId: string | null | undefined): string {
  if (businessId && getRoofObstacleCatalogEntry(businessId)?.geometryShape === "circle") {
    return businessId;
  }
  return "chimney_round";
}

export interface PlacementDefaults2D {
  defaultWidthPx: number;
  defaultHeightPx: number;
  defaultRadiusPx: number;
  minWidthPx: number;
  minHeightPx: number;
  minRadiusPx: number;
}

export function getPlacementDefaults2D(
  businessId: string | null | undefined,
  metersPerPixel: number
): PlacementDefaults2D {
  const mpp = metersPerPixel > 0 ? metersPerPixel : 1;
  const bidR = fallbackBusinessIdRect(businessId);
  const bidC = fallbackBusinessIdCircle(businessId);
  const entryR = getRoofObstacleCatalogEntry(bidR);
  const entryC = getRoofObstacleCatalogEntry(bidC);

  const wM = entryR?.defaultWidthM ?? 1;
  const hM = entryR?.defaultDepthM ?? 1;
  const dM = entryC?.defaultDiameterM ?? 0.35;

  const defaultWidthPx = wM / mpp;
  const defaultHeightPx = hM / mpp;
  const defaultRadiusPx = (dM / mpp) / 2;

  const t = technicalMinObstaclePixels(mpp);
  const minWidthPx = t.minW;
  const minHeightPx = t.minH;
  const minRadiusPx = t.minR;

  return {
    defaultWidthPx,
    defaultHeightPx,
    defaultRadiusPx,
    minWidthPx,
    minHeightPx,
    minRadiusPx,
  };
}

/** Rectangle axis-aligné : ancrage (ax,ay) + coin opposé (mx,my), plancher technique. */
export function computeRectShapeMetaFromAnchorDrag(
  ax: number,
  ay: number,
  mx: number,
  my: number,
  metersPerPixel: number,
  businessId: string | null | undefined
): { centerX: number; centerY: number; width: number; height: number; angle: number } {
  const def = getPlacementDefaults2D(businessId, metersPerPixel);
  const dx = mx - ax;
  const dy = my - ay;
  let w = Math.abs(dx);
  let h = Math.abs(dy);
  w = Math.max(def.minWidthPx, w);
  h = Math.max(def.minHeightPx, h);
  const sx = dx >= 0 ? 1 : -1;
  const sy = dy >= 0 ? 1 : -1;
  const x2 = ax + sx * w;
  const y2 = ay + sy * h;
  return {
    centerX: (ax + x2) / 2,
    centerY: (ay + y2) / 2,
    width: w,
    height: h,
    angle: 0,
  };
}

/** Cercle : premier point = une extrémité du diamètre ; le curseur définit l’autre (milieu = centre). */
export function computeCircleShapeMetaFromAnchorDrag(
  ax: number,
  ay: number,
  mx: number,
  my: number,
  metersPerPixel: number,
  businessId: string | null | undefined
): { centerX: number; centerY: number; radius: number } {
  const def = getPlacementDefaults2D(businessId, metersPerPixel);
  const dx = mx - ax;
  const dy = my - ay;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) {
    const r = def.defaultRadiusPx;
    return { centerX: ax + r, centerY: ay, radius: r };
  }
  const r = Math.max(def.minRadiusPx, dist / 2);
  return {
    centerX: (ax + mx) / 2,
    centerY: (ay + my) / 2,
    radius: r,
  };
}

/** Plancher largeur / profondeur (m) pour volumes ombrants — aligné sur TECH_MIN_DIM_M. */
export function shadowMinsM(_businessId: string | null | undefined): { minWM: number; minDM: number } {
  return { minWM: TECH_MIN_DIM_M, minDM: TECH_MIN_DIM_M };
}

/** Volume ombrant prismatique : coin d’ancrage → boîte axis-alignée (m). */
export function computeShadowCubeMetersFromAnchor(
  ax: number,
  ay: number,
  mx: number,
  my: number,
  metersPerPixel: number,
  businessId: string | null | undefined
): { cx: number; cy: number; widthM: number; depthM: number } {
  const mpp = metersPerPixel > 0 ? metersPerPixel : 1;
  const mins = shadowMinsM(businessId);
  const dx = mx - ax;
  const dy = my - ay;
  let wPx = Math.abs(dx);
  let dPx = Math.abs(dy);
  wPx = Math.max(mins.minWM / mpp, wPx);
  dPx = Math.max(mins.minDM / mpp, dPx);
  const sx = dx >= 0 ? 1 : -1;
  const sy = dy >= 0 ? 1 : -1;
  const x2 = ax + sx * wPx;
  const y2 = ay + sy * dPx;
  const widthM = wPx * mpp;
  const depthM = dPx * mpp;
  return {
    cx: (ax + x2) / 2,
    cy: (ay + y2) / 2,
    widthM,
    depthM,
  };
}

/** Volume cylindrique : diamètre = segment ancrage → curseur (m). */
export function computeShadowTubeMetersFromAnchor(
  ax: number,
  ay: number,
  mx: number,
  my: number,
  metersPerPixel: number,
  businessId: string | null | undefined
): { cx: number; cy: number; diameterM: number } {
  const mpp = metersPerPixel > 0 ? metersPerPixel : 1;
  const mins = shadowMinsM(businessId);
  const minDiamM = mins.minWM;
  const entry = getRoofObstacleCatalogEntry(businessId || "chimney_round");
  const defaultDiamM = entry?.defaultDiameterM ?? 0.35;
  const dx = mx - ax;
  const dy = my - ay;
  const dist = Math.hypot(dx, dy);
  const distM = dist * mpp;
  let diameterM: number;
  if (dist < 1e-6) {
    diameterM = defaultDiamM;
  } else {
    diameterM = Math.max(minDiamM, distM);
  }
  const rM = diameterM / 2;
  const rPx = rM / mpp;
  if (dist < 1e-6) {
    return { cx: ax + rPx, cy: ay, diameterM };
  }
  const ux = dx / dist;
  const uy = dy / dist;
  return {
    cx: ax + ux * rPx,
    cy: ay + uy * rPx,
    diameterM,
  };
}

/** Texte HUD sélection (2D). */
export function formatObstacle2DSelectionHud(
  obstacle: {
    shapeMeta?: { originalType?: string; width?: number; height?: number; radius?: number };
    meta?: Record<string, unknown>;
  },
  metersPerPixel: number
): string {
  const mpp = metersPerPixel > 0 ? metersPerPixel : 1;
  const meta = obstacle.meta || {};
  const bid =
    (typeof meta.businessObstacleId === "string" ? meta.businessObstacleId : "") ||
    (typeof (meta as { catalogId?: string }).catalogId === "string"
      ? (meta as { catalogId: string }).catalogId
      : "");
  const entry = getRoofObstacleCatalogEntry(bid);
  const label = (typeof meta.label === "string" ? meta.label : null) || entry?.label || "Obstacle";
  const sh =
    meta.isShadingObstacle === true
      ? "Ombrant"
      : meta.isShadingObstacle === false
        ? "Non ombrant (keepout)"
        : "—";
  const sm = obstacle.shapeMeta;
  let dim = "";
  if (sm && sm.originalType === "circle" && typeof sm.radius === "number") {
    const d = sm.radius * 2 * mpp;
    dim = "Ø " + d.toFixed(2) + " m";
  } else if (sm && sm.originalType === "rect" && typeof sm.width === "number" && typeof sm.height === "number") {
    dim = (sm.width * mpp).toFixed(2) + " × " + (sm.height * mpp).toFixed(2) + " m";
  }
  return dim ? label + " · " + dim + " · " + sh : label + " · " + sh;
}
