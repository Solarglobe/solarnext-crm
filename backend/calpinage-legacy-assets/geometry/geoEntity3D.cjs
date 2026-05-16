"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/modules/calpinage/geometry/index.ts
var index_exports = {};
__export(index_exports, {
  buildGeometry3DExportSection: () => buildGeometry3DExportSection,
  computeCentroidPx: () => computeCentroidPx,
  ensureClosedPolygon: () => ensureClosedPolygon,
  getBaseZWorldM: () => getBaseZWorldM,
  houseModelV2: () => houseModelV2,
  normalizeCalpinageGeometry3DReady: () => normalizeCalpinageGeometry3DReady,
  normalizeToGeoEntity3D: () => normalizeToGeoEntity3D,
  toFootprintPx: () => toFootprintPx,
  tryGetBaseZWorldM: () => tryGetBaseZWorldM
});
module.exports = __toCommonJS(index_exports);

// src/modules/calpinage/catalog/roofObstacleCatalog.ts
var ROOF_OBSTACLE_CATALOG = {
  chimney_square: {
    id: "chimney_square",
    label: "Chemin\xE9e carr\xE9e",
    category: "opaque_shading",
    isShadingObstacle: true,
    geometryShape: "rect",
    defaultWidthM: 0.6,
    defaultDepthM: 0.6,
    defaultDiameterM: null,
    defaultHeightM: 1.8,
    description: "Prisme rectangulaire \u2014 ombrage opaque.",
    iconKey: "cube"
  },
  chimney_round: {
    id: "chimney_round",
    label: "Chemin\xE9e ronde",
    category: "opaque_shading",
    isShadingObstacle: true,
    geometryShape: "circle",
    defaultWidthM: null,
    defaultDepthM: null,
    defaultDiameterM: 0.35,
    defaultHeightM: 2,
    description: "Volume cylindrique \u2014 ombrage opaque.",
    iconKey: "tube"
  },
  vmc_round: {
    id: "vmc_round",
    label: "VMC",
    category: "opaque_shading",
    isShadingObstacle: true,
    geometryShape: "circle",
    defaultWidthM: null,
    defaultDepthM: null,
    defaultDiameterM: 0.25,
    defaultHeightM: 0.3,
    description: "Sortie VMC \u2014 ombrage opaque.",
    iconKey: "tube"
  },
  antenna: {
    id: "antenna",
    label: "Antenne",
    category: "opaque_shading",
    isShadingObstacle: true,
    geometryShape: "circle",
    defaultWidthM: null,
    defaultDepthM: null,
    defaultDiameterM: 0.35,
    defaultHeightM: 1.5,
    description: "Antenne \u2014 simplification cylindrique.",
    iconKey: "tube"
  },
  roof_window: {
    id: "roof_window",
    label: "Velux",
    category: "non_shading_keepout",
    isShadingObstacle: false,
    geometryShape: "rect",
    defaultWidthM: 0.78,
    defaultDepthM: 0.98,
    defaultDiameterM: null,
    defaultHeightM: null,
    description: "Fen\xEAtre de toit \u2014 zone non posable uniquement.",
    iconKey: "rect"
  },
  dormer_keepout: {
    id: "dormer_keepout",
    label: "Lucarne",
    category: "non_shading_keepout",
    isShadingObstacle: false,
    geometryShape: "rect",
    defaultWidthM: 1.2,
    defaultDepthM: 1,
    defaultDiameterM: null,
    defaultHeightM: null,
    description: "Lucarne \u2014 zone non posable uniquement.",
    iconKey: "rect"
  },
  keepout_zone: {
    id: "keepout_zone",
    label: "Zone non posable",
    category: "non_shading_keepout",
    isShadingObstacle: false,
    geometryShape: "rect",
    defaultWidthM: 1,
    defaultDepthM: 1,
    defaultDiameterM: null,
    defaultHeightM: null,
    description: "Surface interdite au posage PV.",
    iconKey: "rect"
  },
  generic_polygon_keepout: {
    id: "generic_polygon_keepout",
    label: "Zone libre",
    category: "non_shading_keepout",
    isShadingObstacle: false,
    geometryShape: "polygon",
    defaultWidthM: null,
    defaultDepthM: null,
    defaultDiameterM: null,
    defaultHeightM: null,
    description: "Contour libre \u2014 zone non posable.",
    iconKey: "polygon"
  },
  /** Fallback affichage / compat pour anciens volumes ombrants shape=cube sans meta métier. */
  tree_shadow: {
    id: "tree_shadow",
    label: "Arbre / ombre",
    category: "opaque_shading",
    isShadingObstacle: true,
    geometryShape: "circle",
    defaultWidthM: null,
    defaultDepthM: null,
    defaultDiameterM: 2.5,
    defaultHeightM: 4,
    description: "Volume proxy pour ombrage d'arbre ou ombre distante.",
    iconKey: "tree"
  },
  parapet: {
    id: "parapet",
    label: "Acrotere",
    category: "opaque_shading",
    isShadingObstacle: true,
    geometryShape: "rect",
    defaultWidthM: 2,
    defaultDepthM: 0.25,
    defaultDiameterM: null,
    defaultHeightM: 0.45,
    description: "Acrotere ou releve de toiture - ombrage opaque.",
    iconKey: "rect"
  },
  roof_drain: {
    id: "roof_drain",
    label: "Evacuation",
    category: "opaque_shading",
    isShadingObstacle: true,
    geometryShape: "circle",
    defaultWidthM: null,
    defaultDepthM: null,
    defaultDiameterM: 0.18,
    defaultHeightM: 0.12,
    description: "Evacuation toiture - petit obstacle technique.",
    iconKey: "tube"
  },
  legacy_shadow_cube: {
    id: "legacy_shadow_cube",
    label: "Volume ombrant (ancien)",
    category: "opaque_shading",
    isShadingObstacle: true,
    geometryShape: "rect",
    defaultWidthM: 0.6,
    defaultDepthM: 0.6,
    defaultDiameterM: null,
    defaultHeightM: 1,
    description: "Compatibilit\xE9 donn\xE9es historiques.",
    iconKey: "cube"
  },
  /** Fallback pour anciens volumes shape=tube sans meta métier. */
  legacy_shadow_tube: {
    id: "legacy_shadow_tube",
    label: "Volume ombrant cylindrique (ancien)",
    category: "opaque_shading",
    isShadingObstacle: true,
    geometryShape: "circle",
    defaultWidthM: null,
    defaultDepthM: null,
    defaultDiameterM: 0.6,
    defaultHeightM: 1,
    description: "Compatibilit\xE9 donn\xE9es historiques.",
    iconKey: "tube"
  }
};
function getRoofObstacleCatalogEntry(id) {
  if (!id || typeof id !== "string") return null;
  return ROOF_OBSTACLE_CATALOG[id] ?? null;
}
var LEGACY_2D_OBSTACLE_NEAR_SHADING_HEIGHT_M = 1;
var LEGACY_SHADOW_VOLUME_DEFAULT_HEIGHT_M = 1;

// src/modules/calpinage/catalog/roofObstacleRuntime.ts
var META_KEY = "businessObstacleId";
function readMeta(o) {
  const m = o.meta;
  if (m && typeof m === "object" && !Array.isArray(m)) return m;
  return null;
}
function resolveBusinessObstacleId(o) {
  const meta = readMeta(o);
  return (meta && typeof meta[META_KEY] === "string" ? meta[META_KEY] : null) || (typeof o[META_KEY] === "string" ? o[META_KEY] : null);
}
function isKeepoutNonShadingObstacle(entity) {
  if (!entity || typeof entity !== "object") return false;
  const o = entity;
  const meta = readMeta(o);
  if (meta && meta.isShadingObstacle === false) return true;
  const bid = resolveBusinessObstacleId(o);
  const entry = getRoofObstacleCatalogEntry(bid);
  return !!(entry && entry.isShadingObstacle === false);
}
function readExplicitHeightM(entity) {
  const h = entity.height;
  if (h && typeof h === "object" && typeof h.heightM === "number") {
    const hm = h.heightM;
    if (hm >= 0) return hm;
  }
  if (typeof entity.heightM === "number" && entity.heightM >= 0) return entity.heightM;
  if (typeof entity.heightRelM === "number" && entity.heightRelM >= 0) return entity.heightRelM;
  if (typeof entity.height === "number" && entity.height >= 0) return entity.height;
  if (entity.ridgeHeightRelM != null && typeof entity.ridgeHeightRelM === "number") {
    return entity.ridgeHeightRelM >= 0 ? entity.ridgeHeightRelM : null;
  }
  return null;
}
function resolveCatalogDefaultHeightM(entry) {
  if (!entry) return null;
  if (entry.isShadingObstacle && typeof entry.defaultHeightM === "number") return entry.defaultHeightM;
  return null;
}
function resolveGeoEntityHeightM(entity, type) {
  if (type === "OBSTACLE" && isKeepoutNonShadingObstacle(entity)) return 0;
  const explicit = readExplicitHeightM(entity);
  if (explicit !== null) return explicit;
  const meta = readMeta(entity);
  if (type === "OBSTACLE") {
    const bid = resolveBusinessObstacleId(entity);
    if (bid) {
      const entry = getRoofObstacleCatalogEntry(bid);
      const dh = resolveCatalogDefaultHeightM(entry);
      if (dh !== null) return dh;
    }
    return LEGACY_2D_OBSTACLE_NEAR_SHADING_HEIGHT_M;
  }
  if (type === "SHADOW_VOLUME") {
    const bid = typeof meta?.[META_KEY] === "string" ? meta[META_KEY] : null;
    if (bid) {
      const entry = getRoofObstacleCatalogEntry(bid);
      const dh = resolveCatalogDefaultHeightM(entry);
      if (dh !== null) return dh;
    }
    return LEGACY_SHADOW_VOLUME_DEFAULT_HEIGHT_M;
  }
  if (type === "PV_PANEL" || type === "PAN_SURFACE" || type === "BUILDING_CONTOUR" || type === "ROOF_CONTOUR" || type === "ROOF_EXTENSION") {
    return 0;
  }
  return 0;
}

// src/modules/calpinage/geometry/geoEntity3D.ts
var CIRCLE_SEGMENTS = 16;
function computeCentroidPx(footprintPx) {
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
function ensureClosedPolygon(pts) {
  if (!pts || pts.length < 2) return pts || [];
  const first = pts[0];
  const last = pts[pts.length - 1];
  const dx = (last?.x ?? 0) - (first?.x ?? 0);
  const dy = (last?.y ?? 0) - (first?.y ?? 0);
  if (Math.hypot(dx, dy) < 1e-9) return pts;
  return [...pts, { x: first.x, y: first.y }];
}
function circleToPolygon(cx, cy, radius, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return pts;
}
function rectCenterToPolygon(cx, cy, width, height, angleRad) {
  const hw = width / 2;
  const hh = height / 2;
  const c = Math.cos(angleRad || 0);
  const s = Math.sin(angleRad || 0);
  const corners = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh }
  ];
  return corners.map((p) => ({
    x: cx + p.x * c - p.y * s,
    y: cy + p.x * s + p.y * c
  }));
}
function toPoint2D(p) {
  if (!p || typeof p !== "object") return null;
  const o = p;
  const x = o.x ?? o[0];
  const y = o.y ?? o[1];
  if (typeof x !== "number" || typeof y !== "number") return null;
  return { x, y };
}
function toFootprintPx(entity) {
  if (!entity || typeof entity !== "object") return null;
  const e = entity;
  const shapeMeta = e.shapeMeta;
  if (shapeMeta && typeof shapeMeta === "object") {
    const originalType = shapeMeta.originalType;
    const cx2 = shapeMeta.centerX;
    const cy2 = shapeMeta.centerY;
    if (originalType === "circle" && typeof cx2 === "number" && typeof cy2 === "number" && typeof shapeMeta.radius === "number" && shapeMeta.radius > 0) {
      return ensureClosedPolygon(circleToPolygon(cx2, cy2, shapeMeta.radius, CIRCLE_SEGMENTS));
    }
    if (originalType === "rect" && typeof cx2 === "number" && typeof cy2 === "number" && typeof shapeMeta.width === "number" && typeof shapeMeta.height === "number" && shapeMeta.width > 0 && shapeMeta.height > 0) {
      const angle = typeof shapeMeta.angle === "number" ? shapeMeta.angle : 0;
      return ensureClosedPolygon(rectCenterToPolygon(cx2, cy2, shapeMeta.width, shapeMeta.height, angle));
    }
  }
  const poly = e.polygonPx ?? e.polygon ?? e.points;
  if (Array.isArray(poly) && poly.length >= 3) {
    const pts = poly.map((p) => toPoint2D(p)).filter((p) => p !== null);
    if (pts.length >= 3) return ensureClosedPolygon(pts);
  }
  const contour = e.contour;
  if (contour && Array.isArray(contour.points) && contour.points.length >= 3) {
    const pts = contour.points.map((p) => toPoint2D(p)).filter((p) => p !== null);
    if (pts.length >= 3) return ensureClosedPolygon(pts);
  }
  const proj = e.projection;
  if (proj && Array.isArray(proj.points) && proj.points.length >= 3) {
    const pts = proj.points.map((p) => toPoint2D(p)).filter((p) => p !== null);
    if (pts.length >= 3) return ensureClosedPolygon(pts);
  }
  const shape = e.shape;
  const cx = e.x;
  const cy = e.y;
  const r = e.r ?? e.radius;
  if ((shape === "circle" || shape === "tube") && typeof cx === "number" && typeof cy === "number" && typeof r === "number" && r > 0) {
    return circleToPolygon(cx, cy, r, CIRCLE_SEGMENTS);
  }
  if (e.type === "circle" && typeof cx === "number" && typeof cy === "number" && typeof r === "number" && r > 0) {
    return circleToPolygon(cx, cy, r, CIRCLE_SEGMENTS);
  }
  if (e.type === "rect") {
    const x = e.x ?? 0;
    const y = e.y ?? 0;
    const w = e.w ?? 0;
    const h = e.h ?? 0;
    if (w > 0 && h > 0) {
      return ensureClosedPolygon([
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h }
      ]);
    }
  }
  if (e.type === "shadow_volume" && typeof cx === "number" && typeof cy === "number") {
    const wM = e.width ?? 0.6;
    const dM = e.depth ?? 0.6;
    const mpp = e.metersPerPixel ?? 1;
    const wPx = wM / mpp;
    const dPx = dM / mpp;
    const rotDeg = e.rotation ?? 0;
    const rotRad = rotDeg * Math.PI / 180;
    const cos = Math.cos(rotRad);
    const sin = Math.sin(rotRad);
    const rotPt = (lx, ly) => ({
      x: cx + lx * cos - ly * sin,
      y: cy + lx * sin + ly * cos
    });
    const hw = wPx / 2;
    const hd = dPx / 2;
    return [rotPt(-hw, -hd), rotPt(hw, -hd), rotPt(hw, hd), rotPt(-hw, hd)];
  }
  if (e.points && Array.isArray(e.points) && e.points.length >= 3) {
    const pts = e.points.map((p) => toPoint2D(p)).filter((p) => p !== null);
    if (pts.length >= 3) return ensureClosedPolygon(pts);
  }
  return null;
}
function tryGetBaseZWorldM(xPx, yPx, ctx) {
  if (!ctx) return null;
  if (typeof ctx.resolveHeight === "function") {
    const z2 = ctx.resolveHeight(xPx, yPx);
    if (typeof z2 === "number" && Number.isFinite(z2)) return z2;
  }
  const fn = ctx.getZWorldAtXY ?? ctx.getHeightAtXY ?? ctx.getHeightAtImagePoint;
  if (typeof fn !== "function") return null;
  const z = fn(xPx, yPx);
  return typeof z === "number" && Number.isFinite(z) ? z : null;
}
function getBaseZWorldM(xPx, yPx, ctx) {
  return tryGetBaseZWorldM(xPx, yPx, ctx) ?? 0;
}
function extractHeightM(entity, type) {
  return resolveGeoEntityHeightM(entity, type);
}
function normalizeToGeoEntity3D(input, ctx, typeHint) {
  if (!input || typeof input !== "object") return null;
  const e = input;
  const footprintPx = toFootprintPx(input);
  if (!footprintPx || footprintPx.length < 3) return null;
  const centroid = computeCentroidPx(footprintPx);
  const baseZWorldM = getBaseZWorldM(centroid.x, centroid.y, ctx ?? void 0);
  let type = typeHint ?? "OBSTACLE";
  let heightM = 0;
  if (!typeHint) {
    if (e.type === "shadow_volume") type = "SHADOW_VOLUME";
    else if (e.panId != null || e.projection && e.projection?.points) type = "PV_PANEL";
    else if (e.polygon && !e.contour && Array.isArray(e.planes)) type = "PAN_SURFACE";
    else if (e.roofRole === "contour" || e.roofRole === void 0 && e.points) type = "BUILDING_CONTOUR";
    else if (e.stage === "CONTOUR" && e.contour) type = "ROOF_EXTENSION";
    else type = "OBSTACLE";
  }
  heightM = extractHeightM(e, type);
  const id = e.id != null && String(e.id) || `entity-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const meta = {};
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
    const ph = e.physical;
    if (ph.slope && typeof ph.slope === "object") {
      const sl = ph.slope;
      if (sl.valueDeg != null) meta.tiltDeg = sl.valueDeg;
      else if (sl.computedDeg != null) meta.tiltDeg = sl.computedDeg;
    }
    if (ph.orientation && typeof ph.orientation === "object") {
      const or = ph.orientation;
      if (or.azimuthDeg != null) meta.azimuthDeg = or.azimuthDeg;
    }
  }
  if (e.points != null && Array.isArray(e.points) && e.points.some((p) => p && typeof p === "object" && "h" in p)) {
    meta.pointsWithHeights = e.points.map((p) => ({ x: p.x, y: p.y, h: p.h }));
  }
  return {
    id,
    type,
    footprintPx: footprintPx.map((p) => ({ x: p.x, y: p.y })),
    baseZWorldM,
    heightM,
    meta: Object.keys(meta).length > 0 ? meta : void 0
  };
}
function normalizeCalpinageGeometry3DReady(calpinageState, ctx, options) {
  const entities = [];
  const index = {};
  const push = (entity) => {
    entities.push(entity);
    const arr = index[entity.type] ?? [];
    arr.push(entity);
    index[entity.type] = arr;
  };
  const mpp = calpinageState.roof?.scale?.metersPerPixel ?? 1;
  const ctxWithMpp = ctx ? { ...ctx } : void 0;
  const obstacles = calpinageState.obstacles ?? [];
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    const norm = normalizeToGeoEntity3D(o, ctxWithMpp, "OBSTACLE");
    if (norm) push(norm);
  }
  const shadowVolumes = calpinageState.shadowVolumes ?? [];
  for (let i = 0; i < shadowVolumes.length; i++) {
    const sv = shadowVolumes[i];
    const withMpp = { ...sv, metersPerPixel: mpp };
    const norm = normalizeToGeoEntity3D(withMpp, ctxWithMpp, "SHADOW_VOLUME");
    if (norm) push(norm);
  }
  const roofExtensions = calpinageState.roofExtensions ?? [];
  for (let i = 0; i < roofExtensions.length; i++) {
    const rx = roofExtensions[i];
    const norm = normalizeToGeoEntity3D(rx, ctxWithMpp, "ROOF_EXTENSION");
    if (norm) push(norm);
  }
  const getAllPanels = options?.getAllPanels ?? (typeof window !== "undefined" && window.pvPlacementEngine?.getAllPanels);
  if (typeof getAllPanels === "function") {
    const panels = getAllPanels() ?? [];
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i];
      if (p.enabled === false) continue;
      const norm = normalizeToGeoEntity3D(p, ctxWithMpp, "PV_PANEL");
      if (norm) push(norm);
    }
  }
  let pans = calpinageState.pans ?? [];
  if (options?.computePansFromGeometryCore && !pans.length) {
    const stateCopy = { ...calpinageState };
    options.computePansFromGeometryCore(stateCopy, { excludeChienAssis: true });
    pans = stateCopy.pans ?? [];
  }
  for (let i = 0; i < pans.length; i++) {
    const pan = pans[i];
    const norm = normalizeToGeoEntity3D(pan, ctxWithMpp, "PAN_SURFACE");
    if (norm) push(norm);
  }
  const contours = calpinageState.contours ?? [];
  for (let i = 0; i < contours.length; i++) {
    const c = contours[i];
    if (c.roofRole === "chienAssis") continue;
    const norm = normalizeToGeoEntity3D(c, ctxWithMpp, "BUILDING_CONTOUR");
    if (norm) push(norm);
  }
  if (typeof window !== "undefined" && window.GEOM3D_DEBUG) {
    const counts = {};
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
      obstaclesWithoutHeight: noHeight
    });
  }
  return { entities, index: { byType: index } };
}
function buildGeometry3DExportSection(normalized, ctx) {
  const { entities } = normalized;
  const countsByType = {};
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
    computedAt: (/* @__PURE__ */ new Date()).toISOString(),
    entities: entities.map((e) => ({
      id: e.id,
      type: e.type,
      footprintPx: e.footprintPx,
      baseZWorldM: e.baseZWorldM,
      heightM: e.heightM,
      meta: e.meta
    })),
    stats: {
      countsByType,
      fallbackBaseZCount,
      missingHeightCount
    }
  };
}

// src/modules/calpinage/geometry/houseModelV2.ts
function fanTriangulate(contour) {
  const n = contour.length;
  if (n < 3) return [];
  const indices = [];
  for (let i = 1; i < n - 1; i++) {
    indices.push(0, i, i + 1);
  }
  return indices;
}
function triangulatePolygon(contour) {
  if (!contour || contour.length < 3) return [];
  return fanTriangulate(contour);
}
function pxToWorld(footprintPx, mpp, originPx) {
  return footprintPx.map((p) => ({
    x: (p.x - originPx.x) * mpp,
    z: (p.y - originPx.y) * mpp
  }));
}
function houseModelV2(entities, ctx) {
  const walls = [];
  const roofMeshes = [];
  const mpp = ctx.metersPerPixel > 0 ? ctx.metersPerPixel : 1;
  const originPx = ctx.originPx ?? { x: 0, y: 0 };
  for (const e of entities) {
    if (!e.footprintPx || e.footprintPx.length < 3) continue;
    const contour = pxToWorld(e.footprintPx, mpp, originPx);
    switch (e.type) {
      case "OBSTACLE":
      case "SHADOW_VOLUME":
        if (e.heightM > 0) {
          walls.push({
            type: "extruded",
            contour: contour.map((p) => ({ x: p.x, y: p.z })),
            height: e.heightM,
            baseZ: e.baseZWorldM
          });
        }
        break;
      case "BUILDING_CONTOUR":
      case "ROOF_CONTOUR":
      case "ROOF_EXTENSION":
        if (e.heightM >= 0) {
          const z = e.baseZWorldM;
          const verts = [];
          for (const p of contour) {
            verts.push(p.x, p.z, z);
          }
          const inds = triangulatePolygon(contour);
          if (inds.length >= 3) {
            roofMeshes.push({ vertices: verts, indices: inds });
          }
        }
        break;
      case "PV_PANEL":
      case "PAN_SURFACE":
        {
          const z = e.baseZWorldM;
          const verts = [];
          for (const p of contour) {
            verts.push(p.x, p.z, z);
          }
          const inds = triangulatePolygon(contour);
          if (inds.length >= 3) {
            roofMeshes.push({ vertices: verts, indices: inds });
          }
        }
        break;
      default:
        break;
    }
  }
  return { walls, roofMeshes };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildGeometry3DExportSection,
  computeCentroidPx,
  ensureClosedPolygon,
  getBaseZWorldM,
  houseModelV2,
  normalizeCalpinageGeometry3DReady,
  normalizeToGeoEntity3D,
  toFootprintPx,
  tryGetBaseZWorldM
});
