import { resolveGeoEntityHeightM } from "../catalog/roofObstacleRuntime";

/**
 * GeoEntity3D — Schéma unifié et normalisation 3D-ready pour le calpinage.
 * Convertit toutes les entités géométriques (pans, obstacles, panneaux, shadow volumes, contours)
 * vers une forme normalisée avec footprintPx, baseZWorldM, heightM.
 *
 * Rétrocompatibilité : aucun flux existant ne doit casser (PV placement, shading proche, export).
 *
 * GEOM3D_DEBUG : Dans la console navigateur, exécuter `window.GEOM3D_DEBUG = true` avant
 * d'appeler normalizeCalpinageGeometry3DReady pour afficher un résumé (counts par type, nb sans baseZ/height).
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export interface Point2D {
  x: number;
  y: number;
}

export type GeoEntityType =
  | "PAN_SURFACE"
  | "PV_PANEL"
  | "OBSTACLE"
  | "SHADOW_VOLUME"
  | "BUILDING_CONTOUR"
  | "ROOF_CONTOUR"
  | "ROOF_EXTENSION";

export interface GeoEntity3D {
  id: string;
  type: GeoEntityType;
  footprintPx: Point2D[];
  baseZWorldM: number;
  heightM: number;
  meta?: Record<string, unknown>;
}

/** Contexte pour récupérer la hauteur Z world au point (x,y) en pixels image. */
export interface GeoEntity3DContext {
  /**
   * Résolveur de hauteur enrichi (moteur canonique heightResolver.ts).
   * Priorité maximale si présent — retourne toujours un number fini.
   * Construit via buildRuntimeContext() ou injection directe en test.
   */
  resolveHeight?: (xPx: number, yPx: number) => number;
  /** Compatibilité legacy : même contrat que window.getHeightAtXY sans panId (résolution par hit-test interne). */
  getZWorldAtXY?: (xPx: number, yPx: number) => number;
  getHeightAtXY?: (xPx: number, yPx: number) => number;
  getHeightAtImagePoint?: (xPx: number, yPx: number) => number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const CIRCLE_SEGMENTS = 16;

/**
 * Calcule le centroïde d'un polygone (footprint).
 */
export function computeCentroidPx(footprintPx: Point2D[]): Point2D {
  if (!footprintPx || footprintPx.length < 3) return { x: 0, y: 0 };
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < footprintPx.length; i++) {
    const p = footprintPx[i];
    sumX += typeof p.x === "number" ? p.x : 0;
    sumY += typeof p.y === "number" ? p.y : 0;
  }
  return { x: sumX / footprintPx.length, y: sumY / footprintPx.length };
}

/**
 * Assure que le polygone est fermé (premier point = dernier point).
 */
export function ensureClosedPolygon(pts: Point2D[]): Point2D[] {
  if (!pts || pts.length < 2) return pts || [];
  const first = pts[0];
  const last = pts[pts.length - 1];
  const dx = (last?.x ?? 0) - (first?.x ?? 0);
  const dy = (last?.y ?? 0) - (first?.y ?? 0);
  if (Math.hypot(dx, dy) < 1e-9) return pts;
  return [...pts, { x: first.x, y: first.y }];
}

function circleToPolygon(cx: number, cy: number, radius: number, n: number): Point2D[] {
  const pts: Point2D[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return pts;
}

function rectCenterToPolygon(cx: number, cy: number, width: number, height: number, angleRad: number): Point2D[] {
  const hw = width / 2;
  const hh = height / 2;
  const c = Math.cos(angleRad || 0);
  const s = Math.sin(angleRad || 0);
  const corners = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
  return corners.map((p) => ({
    x: cx + p.x * c - p.y * s,
    y: cy + p.x * s + p.y * c,
  }));
}

function toPoint2D(p: unknown): Point2D | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  const x = o.x ?? o[0];
  const y = o.y ?? o[1];
  if (typeof x !== "number" || typeof y !== "number") return null;
  return { x, y };
}

/**
 * Extrait un footprint Point2D[] depuis une entité quelconque.
 * Accepte: polygonPx, polygon, points, contour.points, projection.points, shape(circle/rect).
 */
export function toFootprintPx(entity: unknown): Point2D[] | null {
  if (!entity || typeof entity !== "object") return null;
  const e = entity as Record<string, unknown>;

  const shapeMeta = e.shapeMeta as Record<string, unknown> | undefined;
  if (shapeMeta && typeof shapeMeta === "object") {
    const originalType = shapeMeta.originalType;
    const cx = shapeMeta.centerX;
    const cy = shapeMeta.centerY;
    if (
      originalType === "circle" &&
      typeof cx === "number" &&
      typeof cy === "number" &&
      typeof shapeMeta.radius === "number" &&
      shapeMeta.radius > 0
    ) {
      return ensureClosedPolygon(circleToPolygon(cx, cy, shapeMeta.radius, CIRCLE_SEGMENTS));
    }
    if (
      originalType === "rect" &&
      typeof cx === "number" &&
      typeof cy === "number" &&
      typeof shapeMeta.width === "number" &&
      typeof shapeMeta.height === "number" &&
      shapeMeta.width > 0 &&
      shapeMeta.height > 0
    ) {
      const angle = typeof shapeMeta.angle === "number" ? shapeMeta.angle : 0;
      return ensureClosedPolygon(rectCenterToPolygon(cx, cy, shapeMeta.width, shapeMeta.height, angle));
    }
  }

  // polygonPx / polygon / points
  const poly = e.polygonPx ?? e.polygon ?? e.points;
  if (Array.isArray(poly) && poly.length >= 3) {
    const pts = poly.map((p) => toPoint2D(p)).filter((p): p is Point2D => p !== null);
    if (pts.length >= 3) return ensureClosedPolygon(pts);
  }

  // contour.points
  const contour = e.contour as Record<string, unknown> | undefined;
  if (contour && Array.isArray(contour.points) && contour.points.length >= 3) {
    const pts = (contour.points as unknown[]).map((p) => toPoint2D(p)).filter((p): p is Point2D => p !== null);
    if (pts.length >= 3) return ensureClosedPolygon(pts);
  }

  // projection.points (panneau PV)
  const proj = e.projection as Record<string, unknown> | undefined;
  if (proj && Array.isArray(proj.points) && proj.points.length >= 3) {
    const pts = (proj.points as unknown[]).map((p) => toPoint2D(p)).filter((p): p is Point2D => p !== null);
    if (pts.length >= 3) return ensureClosedPolygon(pts);
  }

  // shape circle: x, y, r (ou radius)
  const shape = e.shape as string | undefined;
  const cx = e.x as number | undefined;
  const cy = e.y as number | undefined;
  const r = (e.r ?? e.radius) as number | undefined;
  if ((shape === "circle" || shape === "tube") && typeof cx === "number" && typeof cy === "number" && typeof r === "number" && r > 0) {
    return circleToPolygon(cx, cy, r, CIRCLE_SEGMENTS);
  }

  // Obstacle circle (RoofObstacle legacy): type circle, x, y, r
  if (e.type === "circle" && typeof cx === "number" && typeof cy === "number" && typeof r === "number" && r > 0) {
    return circleToPolygon(cx, cy, r, CIRCLE_SEGMENTS);
  }

  // Obstacle rect (RoofObstacle legacy): type rect, x, y, w, h
  if (e.type === "rect") {
    const x = (e.x as number) ?? 0;
    const y = (e.y as number) ?? 0;
    const w = (e.w as number) ?? 0;
    const h = (e.h as number) ?? 0;
    if (w > 0 && h > 0) {
      return ensureClosedPolygon([
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ]);
    }
  }

  // Shadow volume cube: x, y, width, depth, rotation
  if (e.type === "shadow_volume" && typeof cx === "number" && typeof cy === "number") {
    const wM = (e.width as number) ?? 0.6;
    const dM = (e.depth as number) ?? 0.6;
    const mpp = (e.metersPerPixel as number) ?? 1;
    const wPx = wM / mpp;
    const dPx = dM / mpp;
    const rotDeg = (e.rotation as number) ?? 0;
    const rotRad = (rotDeg * Math.PI) / 180;
    const cos = Math.cos(rotRad);
    const sin = Math.sin(rotRad);
    const rotPt = (lx: number, ly: number) => ({
      x: cx + lx * cos - ly * sin,
      y: cy + lx * sin + ly * cos,
    });
    const hw = wPx / 2;
    const hd = dPx / 2;
    return [rotPt(-hw, -hd), rotPt(hw, -hd), rotPt(hw, hd), rotPt(-hw, hd)];
  }

  // planes[].points (pan legacy)
  if (e.points && Array.isArray(e.points) && e.points.length >= 3) {
    const pts = (e.points as unknown[]).map((p) => toPoint2D(p)).filter((p): p is Point2D => p !== null);
    if (pts.length >= 3) return ensureClosedPolygon(pts);
  }

  return null;
}

// ─── baseZWorldM ────────────────────────────────────────────────────────────

/**
 * Z « base » monde (m) sans imposer 0 comme vérité métier : `null` = signal absent.
 * Préférer ce helper dans le nouveau code ; `getBaseZWorldM` conserve le pont legacy (0).
 */
export function tryGetBaseZWorldM(xPx: number, yPx: number, ctx?: GeoEntity3DContext | null): number | null {
  if (!ctx) return null;
  if (typeof ctx.resolveHeight === "function") {
    const z = ctx.resolveHeight(xPx, yPx);
    if (typeof z === "number" && Number.isFinite(z)) return z;
  }
  const fn = ctx.getZWorldAtXY ?? ctx.getHeightAtXY ?? ctx.getHeightAtImagePoint;
  if (typeof fn !== "function") return null;
  const z = fn(xPx, yPx);
  return typeof z === "number" && Number.isFinite(z) ? z : null;
}

/**
 * Règle unique pour baseZWorldM (pont legacy).
 *
 * Ordre de lecture (priorité décroissante) :
 *   1. ctx.resolveHeight   — moteur canonique heightResolver.ts (enrichi : P1 explicite + P3 fitPlane)
 *   2. ctx.getZWorldAtXY   — compatibilité legacy (même contrat, hit-test interne)
 *   3. ctx.getHeightAtXY   — compatibilité legacy
 *   4. ctx.getHeightAtImagePoint — compatibilité legacy
 *   5. 0                   — **compatibilité uniquement** : ne pas confondre avec une cote mesurée
 *
 * Préférer `tryGetBaseZWorldM` pour distinguer absence de signal.
 */
export function getBaseZWorldM(xPx: number, yPx: number, ctx?: GeoEntity3DContext | null): number {
  return tryGetBaseZWorldM(xPx, yPx, ctx) ?? 0;
}

// ─── heightM ────────────────────────────────────────────────────────────────

function extractHeightM(entity: Record<string, unknown>, type: GeoEntityType): number {
  return resolveGeoEntityHeightM(entity, type);
}

// ─── normalizeToGeoEntity3D ────────────────────────────────────────────────

/**
 * Normalise une entité brute vers GeoEntity3D.
 * Pure : ne modifie pas l'objet d'origine.
 * Retourne null si impossible (footprint invalide).
 */
export function normalizeToGeoEntity3D(
  input: unknown,
  ctx: GeoEntity3DContext | null | undefined,
  typeHint?: GeoEntityType
): GeoEntity3D | null {
  if (!input || typeof input !== "object") return null;
  const e = input as Record<string, unknown>;

  const footprintPx = toFootprintPx(input);
  if (!footprintPx || footprintPx.length < 3) return null;

  const centroid = computeCentroidPx(footprintPx);
  const baseZWorldM = getBaseZWorldM(centroid.x, centroid.y, ctx ?? undefined);

  let type: GeoEntityType = typeHint ?? "OBSTACLE";
  let heightM = 0;

  // Détection du type si pas de hint
  if (!typeHint) {
    if (e.type === "shadow_volume") type = "SHADOW_VOLUME";
    else if (e.panId != null || (e.projection && (e as { projection?: { points?: unknown[] } }).projection?.points)) type = "PV_PANEL";
    else if (e.polygon && !e.contour && Array.isArray((e as { planes?: unknown[] }).planes)) type = "PAN_SURFACE";
    else if (e.roofRole === "contour" || (e as { roofRole?: string }).roofRole === undefined && e.points) type = "BUILDING_CONTOUR";
    else if (e.stage === "CONTOUR" && e.contour) type = "ROOF_EXTENSION";
    else type = "OBSTACLE";
  }

  heightM = extractHeightM(e, type);

  const id = (e.id != null && String(e.id)) || `entity-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const meta: Record<string, unknown> = {};
  if (e.panId != null) meta.panId = e.panId;
  if (e.orientation != null) meta.orientation = e.orientation;
  if (e.tiltDeg != null) meta.tiltDeg = e.tiltDeg;
  if (e.azimuthDeg != null) meta.azimuthDeg = e.azimuthDeg;
  if (e.name != null) meta.name = e.name;
  if (e.roofRole != null) meta.roofRole = e.roofRole;
  if (e.shape != null) meta.shape = e.shape;
  if (e.enabled != null) meta.enabled = e.enabled;
  if (e.state != null) meta.state = e.state;
  if (e.rotationDeg != null) meta.rotationDeg = e.rotationDeg;
  if (e.rotation != null) meta.rotation = e.rotation;
  if (e.kind != null) meta.kind = e.kind;
  if (e.shapeMeta != null && typeof e.shapeMeta === "object") meta.shapeMeta = e.shapeMeta;
  if (e.physical != null && typeof e.physical === "object") {
    const ph = e.physical as Record<string, unknown>;
    if (ph.slope && typeof ph.slope === "object") {
      const sl = ph.slope as Record<string, unknown>;
      if (sl.valueDeg != null) meta.tiltDeg = sl.valueDeg;
      else if (sl.computedDeg != null) meta.tiltDeg = sl.computedDeg;
    }
    if (ph.orientation && typeof ph.orientation === "object") {
      const or = ph.orientation as Record<string, unknown>;
      if (or.azimuthDeg != null) meta.azimuthDeg = or.azimuthDeg;
    }
  }
  if (e.points != null && Array.isArray(e.points) && e.points.some((p: unknown) => p && typeof p === "object" && "h" in (p as object))) {
    meta.pointsWithHeights = (e.points as Array<{ x?: number; y?: number; h?: number }>).map((p) => ({ x: p.x, y: p.y, h: p.h }));
  }

  return {
    id,
    type,
    footprintPx: footprintPx.map((p) => ({ x: p.x, y: p.y })),
    baseZWorldM,
    heightM,
    meta: Object.keys(meta).length > 0 ? meta : undefined,
  };
}

// ─── normalizeCalpinageGeometry3DReady ─────────────────────────────────────

/** État calpinage legacy (structure minimale attendue). */
export interface CalpinageStateLike {
  obstacles?: unknown[];
  shadowVolumes?: unknown[];
  roofExtensions?: unknown[];
  contours?: unknown[];
  pans?: unknown[];
  planes?: unknown[];
  roof?: { scale?: { metersPerPixel?: number } };
}

/** Résultat de la normalisation globale. */
export interface NormalizedCalpinage3D {
  entities: GeoEntity3D[];
  index: { byType: Partial<Record<GeoEntityType, GeoEntity3D[]>> };
}

/**
 * Collecte et normalise toutes les entités géométriques du calpinage vers GeoEntity3D.
 */
export function normalizeCalpinageGeometry3DReady(
  calpinageState: CalpinageStateLike,
  ctx: GeoEntity3DContext | null | undefined,
  options?: {
    getAllPanels?: () => unknown[];
    computePansFromGeometryCore?: (state: CalpinageStateLike, opts?: { excludeChienAssis?: boolean }) => void;
  }
): NormalizedCalpinage3D {
  const entities: GeoEntity3D[] = [];
  const index: Partial<Record<GeoEntityType, GeoEntity3D[]>> = {};

  const push = (entity: GeoEntity3D) => {
    entities.push(entity);
    const arr = index[entity.type] ?? [];
    arr.push(entity);
    index[entity.type] = arr;
  };

  const mpp = calpinageState.roof?.scale?.metersPerPixel ?? 1;
  const ctxWithMpp = ctx
    ? { ...ctx }
    : undefined;

  // Obstacles
  const obstacles = calpinageState.obstacles ?? [];
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    const norm = normalizeToGeoEntity3D(o, ctxWithMpp, "OBSTACLE");
    if (norm) push(norm);
  }

  // Shadow volumes
  const shadowVolumes = calpinageState.shadowVolumes ?? [];
  for (let i = 0; i < shadowVolumes.length; i++) {
    const sv = shadowVolumes[i] as Record<string, unknown>;
    const withMpp = { ...sv, metersPerPixel: mpp };
    const norm = normalizeToGeoEntity3D(withMpp, ctxWithMpp, "SHADOW_VOLUME");
    if (norm) push(norm);
  }

  // Roof extensions (chiens assis, etc.)
  const roofExtensions = calpinageState.roofExtensions ?? [];
  for (let i = 0; i < roofExtensions.length; i++) {
    const rx = roofExtensions[i];
    const norm = normalizeToGeoEntity3D(rx, ctxWithMpp, "ROOF_EXTENSION");
    if (norm) push(norm);
  }

  // Placed panels (getAllPanels)
  const getAllPanels = options?.getAllPanels ?? (typeof window !== "undefined" && (window as unknown as { pvPlacementEngine?: { getAllPanels?: () => unknown[] } }).pvPlacementEngine?.getAllPanels);
  if (typeof getAllPanels === "function") {
    const panels = getAllPanels() ?? [];
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i] as Record<string, unknown>;
      if (p.enabled === false) continue;
      const norm = normalizeToGeoEntity3D(p, ctxWithMpp, "PV_PANEL");
      if (norm) push(norm);
    }
  }

  // Pans (computePansFromGeometryCore — vérité topologique dérivée ; `planes` legacy alignés via phase2RoofDerivedModel côté module)
  let pans = calpinageState.pans ?? [];
  if (options?.computePansFromGeometryCore && !pans.length) {
    const stateCopy = { ...calpinageState } as CalpinageStateLike & { pans?: unknown[] };
    options.computePansFromGeometryCore(stateCopy, { excludeChienAssis: true });
    pans = stateCopy.pans ?? [];
  }
  for (let i = 0; i < pans.length; i++) {
    const pan = pans[i] as Record<string, unknown>;
    const norm = normalizeToGeoEntity3D(pan, ctxWithMpp, "PAN_SURFACE");
    if (norm) push(norm);
  }

  // Building contours
  const contours = calpinageState.contours ?? [];
  for (let i = 0; i < contours.length; i++) {
    const c = contours[i] as Record<string, unknown>;
    if (c.roofRole === "chienAssis") continue;
    const norm = normalizeToGeoEntity3D(c, ctxWithMpp, "BUILDING_CONTOUR");
    if (norm) push(norm);
  }

  // GEOM3D_DEBUG
  if (typeof window !== "undefined" && (window as unknown as { GEOM3D_DEBUG?: boolean }).GEOM3D_DEBUG) {
    const counts: Record<string, number> = {};
    let noBaseZ = 0;
    let noHeight = 0;
    for (const ent of entities) {
      counts[ent.type] = (counts[ent.type] ?? 0) + 1;
      if (ent.baseZWorldM === 0 && ctxWithMpp) noBaseZ++;
      if (ent.heightM === 0 && (ent.type === "OBSTACLE" || ent.type === "SHADOW_VOLUME")) noHeight++;
    }
    console.log("[GEOM3D] normalizeCalpinageGeometry3DReady", {
      total: entities.length,
      byType: counts,
      entitiesWithoutBaseZ: noBaseZ,
      obstaclesWithoutHeight: noHeight,
    });
  }

  return { entities, index: { byType: index } };
}

/**
 * Construit la section geometry3d pour l'export JSON.
 * entities = sortie normalisée (footprintPx canonique, baseZWorldM, heightM, type, id, meta).
 */
export function buildGeometry3DExportSection(
  normalized: NormalizedCalpinage3D,
  ctx: GeoEntity3DContext | null | undefined
): {
  version: string;
  computedAt: string;
  entities: GeoEntity3D[];
  stats: {
    countsByType: Record<string, number>;
    fallbackBaseZCount: number;
    missingHeightCount: number;
  };
} {
  const { entities, } = normalized;
  const countsByType: Record<string, number> = {};
  let fallbackBaseZCount = 0;
  let missingHeightCount = 0;
  const hadCtx = !!ctx && (!!ctx.getZWorldAtXY || !!ctx.getHeightAtXY || !!ctx.getHeightAtImagePoint);

  for (const ent of entities) {
    countsByType[ent.type] = (countsByType[ent.type] ?? 0) + 1;
    if (hadCtx && ent.baseZWorldM === 0) fallbackBaseZCount++;
    if ((ent.type === "OBSTACLE" || ent.type === "SHADOW_VOLUME") && ent.heightM === 0) missingHeightCount++;
  }

  return {
    version: "1",
    computedAt: new Date().toISOString(),
    entities: entities.map((e) => ({
      id: e.id,
      type: e.type,
      footprintPx: e.footprintPx,
      baseZWorldM: e.baseZWorldM,
      heightM: e.heightM,
      meta: e.meta,
    })),
    stats: {
      countsByType,
      fallbackBaseZCount,
      missingHeightCount,
    },
  };
}
