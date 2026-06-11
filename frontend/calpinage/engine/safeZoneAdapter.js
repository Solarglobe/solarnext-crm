/**
 * CP-PV-014 — Adaptateur pour Safe Zone Engine
 * CP-PV-015 — Safe Zone Visual + Panel Validation
 *
 * Mappe les structures calpinage (state.pans, state.obstacles, shadowVolumes, roofExtensions canonicalV1)
 * vers le format attendu par computeSafeZones. Fournit drawSafeZoneOverlay et isPanelInsideSafeZone.
 *
 * @module safeZoneAdapter
 */

import { computeSafeZones, polygonAreaAbs } from "@shared/geometry/safeZoneEngine.js";

const TUBE_SEGMENTS = 24;

/* ── SAFE-ZONE-V2 — marges par role d'arete ──────────────────────────────
 * Roles : "faitage" | "aretier" | "egout" | "rive" | "bord" (contour non classifiable).
 * Classification geometrique a posteriori : les faces de pans (phase 2) sont
 * construites A PARTIR des segments contour/faitage/trait, donc une arete de pan
 * issue d'un faitage/trait reste a distance quasi nulle du segment source.
 * Couvre aussi les anciens dossiers sans edgeRoles persistes.
 */
const EDGE_ROLE_DIST_EPS_PX = 3;
const EDGE_ROLE_COLLINEAR_COS = 0.94; /* ~20 deg */
const EGOUT_PARALLEL_COS = 0.7; /* ~45 deg : arete contour ~parallele au faitage -> egout */

function finiteXY(p) {
  return !!p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y));
}

const MARGES_CM_KEYS = ["faitageCm", "aretierCm", "egoutCm", "riveCm", "obstacleCm"];

/** Retourne les cles valides (>= 0) de margesCm, ou null si aucune. */
function sanitizeMargesCmPartial(m) {
  if (!m || typeof m !== "object") return null;
  const out = {};
  let any = false;
  for (const k of MARGES_CM_KEYS) {
    const v = Number(m[k]);
    if (Number.isFinite(v) && v >= 0) {
      out[k] = v;
      any = true;
    }
  }
  return any ? out : null;
}

/** Complete les cles manquantes avec fallbackCm (retrocompat distanceLimitesCm). */
function completeMargesCm(partial, fallbackCm) {
  const fb = Number.isFinite(Number(fallbackCm)) && Number(fallbackCm) >= 0 ? Number(fallbackCm) : 0;
  const out = {};
  for (const k of MARGES_CM_KEYS) {
    out[k] = partial && Number.isFinite(partial[k]) ? partial[k] : fb;
  }
  return out;
}

function marginCmForRole(role, m) {
  if (role === "faitage") return m.faitageCm;
  if (role === "aretier") return m.aretierCm;
  if (role === "egout") return m.egoutCm;
  if (role === "rive") return m.riveCm;
  /* "bord" : contour sans faitage de reference -> marge la plus contraignante */
  return Math.max(m.egoutCm, m.riveCm);
}

/** Fusionne ridges (role faitage) + traits (role aretier) en segments structurels. */
function collectStructuralSegments(ridges, traits) {
  const out = [];
  const push = (seg, role) => {
    if (!seg || !finiteXY(seg.a) || !finiteXY(seg.b)) return;
    const a = { x: Number(seg.a.x), y: Number(seg.a.y) };
    const b = { x: Number(seg.b.x), y: Number(seg.b.y) };
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) return;
    out.push({ a, b, role });
  };
  for (const r of ridges || []) push(r, "faitage");
  for (const t of traits || []) push(t, "aretier");
  return out;
}

function distPointToSegmentPx(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Classifie chaque arete du polygone de pan (ouvert, index i = arete [i]->[i+1]).
 * 1) arete a distance <= eps d'un segment structurel colineaire -> role du segment ;
 * 2) sinon contour : ~parallele au faitage de reference -> "egout", sinon "rive" ;
 * 3) sans faitage de reference -> "bord" (marge max egout/rive).
 * @returns {{ roles: Array<string>, faitageDir: {x,y}|null }}
 */
function classifyPanEdgesV2(polygonPx, structSegs) {
  let verts = (polygonPx || [])
    .map((p) => ({ x: Number(p && p.x), y: Number(p && p.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (verts.length >= 2) {
    const f = verts[0];
    const l = verts[verts.length - 1];
    if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.y - l.y) < 1e-9) verts = verts.slice(0, -1);
  }
  const n = verts.length;
  const roles = [];
  if (n < 3) return { roles, faitageDir: null };

  let cx = 0;
  let cy = 0;
  for (const v of verts) {
    cx += v.x;
    cy += v.y;
  }
  cx /= n;
  cy /= n;

  /* Faitage de reference du pan : le plus long / le plus proche du centroide. */
  let faitageDir = null;
  let bestScore = -Infinity;
  for (const s of structSegs || []) {
    if (s.role !== "faitage") continue;
    const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    const d = distPointToSegmentPx({ x: cx, y: cy }, s.a, s.b);
    const score = len - d;
    if (score > bestScore) {
      bestScore = score;
      faitageDir = { x: (s.b.x - s.a.x) / len, y: (s.b.y - s.a.y) / len };
    }
  }

  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const elen = Math.hypot(ex, ey);
    if (elen < 1e-9) {
      roles.push("rive");
      continue;
    }
    const dir = { x: ex / elen, y: ey / elen };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let role = null;
    let bestD = EDGE_ROLE_DIST_EPS_PX;
    for (const s of structSegs || []) {
      const slen = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
      if (slen < 1e-9) continue;
      const sdir = { x: (s.b.x - s.a.x) / slen, y: (s.b.y - s.a.y) / slen };
      const cosA = Math.abs(dir.x * sdir.x + dir.y * sdir.y);
      if (cosA < EDGE_ROLE_COLLINEAR_COS) continue;
      const dMid = distPointToSegmentPx(mid, s.a, s.b);
      if (dMid <= bestD) {
        bestD = dMid;
        role = s.role;
      }
    }
    if (!role) {
      if (faitageDir) {
        const cosF = Math.abs(dir.x * faitageDir.x + dir.y * faitageDir.y);
        role = cosF >= EGOUT_PARALLEL_COS ? "egout" : "rive";
      } else {
        role = "bord";
      }
    }
    roles.push(role);
  }
  return { roles, faitageDir };
}

/**
 * Convertit un shadow volume en polygonPx (obstacle-like).
 * @param {Object} sv - { id, type, x, y, width, depth, rotation, shape }
 * @param {number} mpp - meters per pixel
 * @returns {{ id: string, polygonPx: Array<{x,y}> }|null}
 */
function shadowVolumeToObstacle(sv, mpp) {
  if (!sv || sv.type !== "shadow_volume") return null;
  const cx = Number(sv.x) || 0;
  const cy = Number(sv.y) || 0;
  const wM = Number(sv.width) || 0.6;
  const dM = Number(sv.depth) || 0.6;
  const wPx = wM / mpp;
  const dPx = dM / mpp;
  const rotDeg = typeof sv.rotation === "number" ? sv.rotation : 0;
  const rotRad = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rotRad);
  const sin = Math.sin(rotRad);
  function rotPt(lx, ly) {
    return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
  }
  let polygonPx;
  if (sv.shape === "tube") {
    const r = wPx / 2;
    polygonPx = [];
    for (let i = 0; i < TUBE_SEGMENTS; i++) {
      const a = (i / TUBE_SEGMENTS) * Math.PI * 2;
      polygonPx.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  } else {
    const hw = wPx / 2;
    const hd = dPx / 2;
    polygonPx = [
      rotPt(-hw, -hd),
      rotPt(hw, -hd),
      rotPt(hw, hd),
      rotPt(-hw, hd),
    ];
  }
  if (!polygonPx || polygonPx.length < 3) return null;
  return {
    id: "sv:" + (sv.id != null ? String(sv.id) : "sv"),
    polygonPx: polygonPx.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 })),
  };
}

function readClosedPointPolygonPx(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const polygonPx = points
    .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (polygonPx.length < 3) return null;
  const first = polygonPx[0];
  const last = polygonPx[polygonPx.length - 1];
  if (first.x !== last.x || first.y !== last.y) {
    polygonPx.push({ x: first.x, y: first.y });
  }
  return polygonPx;
}

/**
 * Convertit une roof extension en obstacle safe-zone.
 * Source prioritaire : canonicalV1.footprintPx. Le contour legacy reste un pont UX
 * pour les anciens dossiers et les drafts encore incomplets.
 * @param {Object} rx - { id, canonicalV1?: { footprintPx }, contour?: { points } }
 * @returns {{ id: string, polygonPx: Array<{x,y}> }|null}
 */
function roofExtensionToObstacle(rx) {
  if (!rx) return null;
  const canonical = rx.canonicalV1 && rx.canonicalV1.version === "roof_extension_v1" ? rx.canonicalV1 : null;
  const polygonPx =
    readClosedPointPolygonPx(canonical?.footprintPx) ??
    readClosedPointPolygonPx(rx.contour?.points);
  if (!polygonPx) return null;
  return {
    id: (canonical ? "rxv1:" : "rx:") + (rx.id != null ? String(rx.id) : "rx"),
    polygonPx,
  };
}

/** Point-in-polygon (ray casting). */
function pointInPolygon(pt, poly) {
  if (!poly || poly.length < 3) return false;
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (yi === yj) continue;
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Segment intersection (strict, no endpoint touch). */
function segmentIntersect(a1, a2, b1, b2) {
  const ax = a2.x - a1.x, ay = a2.y - a1.y;
  const bx = b2.x - b1.x, by = b2.y - b1.y;
  const denom = ax * by - ay * bx;
  if (Math.abs(denom) < 1e-10) return false;
  const cx = b1.x - a1.x, cy = b1.y - a1.y;
  const t = (cx * by - cy * bx) / denom;
  const s = (cx * ay - cy * ax) / denom;
  return t > 1e-9 && t < 1 - 1e-9 && s > 1e-9 && s < 1 - 1e-9;
}

/** Centroid of polygon. */
function polygonCentroid(poly) {
  if (!poly || poly.length < 2) return null;
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    cx += poly[i].x;
    cy += poly[i].y;
  }
  return { x: cx / poly.length, y: cy / poly.length };
}

/**
 * Teste si un point est à l'intérieur de la safe zone (multi-polygone avec trous).
 * Les trous sont inférés : polygone dont le centroïde est dans un polygone plus grand.
 */
function isPointInSafeZone(pt, safeZonePolygonsPx) {
  if (!safeZonePolygonsPx || safeZonePolygonsPx.length === 0) return false;
  const byArea = [...safeZonePolygonsPx].sort((a, b) => polygonAreaAbs(b) - polygonAreaAbs(a));
  const outers = [];
  const holes = [];
  for (const poly of byArea) {
    const c = polygonCentroid(poly);
    const insideLarger = outers.some((o) => pointInPolygon(c, o));
    if (insideLarger) holes.push(poly);
    else outers.push(poly);
  }
  const insideAnyOuter = outers.some((o) => pointInPolygon(pt, o));
  const insideAnyHole = holes.some((h) => pointInPolygon(pt, h));
  return insideAnyOuter && !insideAnyHole;
}

/**
 * Pré-calcule les arêtes des polygones safe zone pour validation rapide.
 * @param {Array<Array<{x: number, y: number}>>} safeZonePolygonsPx
 * @returns {Array<{a: {x,y}, b: {x,y}}>}
 */
export function buildSafeZoneEdgesCache(safeZonePolygonsPx) {
  const p = window.__SAFE_ZONE_PROF__;
  const t0 = p ? performance.now() : 0;
  if (!safeZonePolygonsPx || safeZonePolygonsPx.length === 0) return [];
  const edges = [];
  for (const poly of safeZonePolygonsPx) {
    if (!poly || poly.length < 2) continue;
    const m = poly.length;
    for (let j = 0; j < m; j++) {
      edges.push({ a: poly[j], b: poly[(j + 1) % m] });
    }
  }
  if (p) {
    p.buildEdgesCalls++;
    const dt = performance.now() - t0;
    p.buildEdgesTimes.push(dt);
  }
  return edges;
}

/**
 * Vérifie si un panneau est entièrement dans la safe zone.
 * Règles : tous les sommets dedans ET aucune intersection segmentaire avec le bord.
 * Si edgesCache est fourni, évite de recalculer les segments à chaque appel.
 *
 * @param {Array<{x: number, y: number}>} panelPolygonPx
 * @param {Array<Array<{x: number, y: number}>>} safeZonePolygonsPx
 * @param {Array<{a: {x,y}, b: {x,y}}>} [edgesCache] - optionnel, pré-calculé par buildSafeZoneEdgesCache
 * @returns {boolean}
 */
export function isPanelInsideSafeZone(panelPolygonPx, safeZonePolygonsPx, edgesCache) {
  const prof = window.__SAFE_ZONE_PROF__;
  const t0 = prof ? performance.now() : 0;
  if (!panelPolygonPx || panelPolygonPx.length < 3 || !safeZonePolygonsPx || safeZonePolygonsPx.length === 0) return false;
  for (let i = 0; i < panelPolygonPx.length; i++) {
    if (!isPointInSafeZone(panelPolygonPx[i], safeZonePolygonsPx)) return false;
  }
  const n = panelPolygonPx.length;
  const edges = edgesCache && edgesCache.length > 0 ? edgesCache : buildSafeZoneEdgesCache(safeZonePolygonsPx);
  for (let i = 0; i < n; i++) {
    const a1 = panelPolygonPx[i];
    const a2 = panelPolygonPx[(i + 1) % n];
    for (const { a: b1, b: b2 } of edges) {
      if (segmentIntersect(a1, a2, b1, b2)) return false;
    }
  }
  if (prof) {
    prof.isPanelCalls++;
    const dt = performance.now() - t0;
    prof.isPanelTimes.push(dt);
  }
  return true;
}

/**
 * Construit un Path2D pour l'overlay safe zone (réutilisable pour dessin rapide).
 * @param {Array<Array<{x: number, y: number}>>} polygonsPx
 * @param {function({x: number, y: number}): {x: number, y: number}} imageToScreen
 * @returns {Path2D|null}
 */
export function buildSafeZonePath2D(polygonsPx, imageToScreen) {
  if (!polygonsPx || polygonsPx.length === 0 || typeof imageToScreen !== "function") return null;
  const path = new Path2D();
  for (const poly of polygonsPx) {
    if (!poly || poly.length < 2) continue;
    const sp0 = imageToScreen(poly[0]);
    path.moveTo(sp0.x, sp0.y);
    for (let i = 1; i < poly.length; i++) {
      const sp = imageToScreen(poly[i]);
      path.lineTo(sp.x, sp.y);
    }
    path.closePath();
  }
  return path;
}

/**
 * Dessine l'overlay safe zone (contours uniquement, stroke rouge).
 * Si path2dCache est fourni, utilise ctx.stroke(path2d) pour un dessin rapide.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<Array<{x: number, y: number}>>} polygonsPx
 * @param {function({x: number, y: number}): {x: number, y: number}} imageToScreen
 * @param {Path2D|null} [path2dCache] - optionnel, pré-calculé par buildSafeZonePath2D
 */
export function drawSafeZoneOverlay(ctx, polygonsPx, imageToScreen, path2dCache) {
  const prof = window.__SAFE_ZONE_PROF__;
  const t0 = prof ? performance.now() : 0;
  if (!ctx || !polygonsPx || polygonsPx.length === 0 || typeof imageToScreen !== "function") return;
  ctx.save();
  ctx.strokeStyle = "rgba(255,0,0,0.9)";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  if (path2dCache) {
    ctx.stroke(path2dCache);
  } else {
    ctx.beginPath();
    for (const poly of polygonsPx) {
      if (!poly || poly.length < 2) continue;
      const sp0 = imageToScreen(poly[0]);
      ctx.moveTo(sp0.x, sp0.y);
      for (let i = 1; i < poly.length; i++) {
        const sp = imageToScreen(poly[i]);
        ctx.lineTo(sp.x, sp.y);
      }
      ctx.closePath();
    }
    ctx.stroke();
  }
  ctx.restore();
  if (prof) {
    prof.drawOverlayCalls++;
    const dt = performance.now() - t0;
    prof.drawOverlayTimes.push(dt);
  }
}

/**
 * Extrait polygonPx d'un pan (accepte polygon, polygonPx, points).
 * @param {Object} pan
 * @returns {Array<{x: number, y: number}>|null}
 */
function getPanPolygonPx(pan) {
  const pts = pan?.polygonPx ?? pan?.polygon ?? pan?.points;
  if (!Array.isArray(pts) || pts.length < 3) return null;
  return pts.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));
}

/**
 * Extrait polygonPx d'un obstacle (accepte polygonPx, polygon, points).
 * @param {Object} obstacle
 * @returns {Array<{x: number, y: number}>|null}
 */
function getObstaclePolygonPx(obstacle) {
  const pts = obstacle?.polygonPx ?? obstacle?.polygon ?? obstacle?.points;
  if (!Array.isArray(pts) || pts.length < 3) return null;
  return pts.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));
}

/**
 * Adapte state calpinage et appelle computeSafeZones.
 * Fusionne obstacles + shadowVolumes (convertis) + roofExtensions (canonicalV1.footprintPx prioritaire, contour legacy en repli).
 *
 * @param {{
 *   pans: Array<Object>,
 *   obstacles?: Array<Object>,
 *   shadowVolumes?: Array<Object>,
 *   roofExtensions?: Array<Object>,
 *   marginOuterCm?: number,
 *   metersPerPixel?: number,
 *   marginPxOverride?: number
 * }} opts
 * @returns {ReturnType<typeof computeSafeZones>}
 */
export function computeSafeZonesFromCalpinageState(opts) {
  const prof = window.__SAFE_ZONE_PROF__;
  if (prof) prof.computeCalls++;
  const pans = opts?.pans || [];
  const obstacles = opts?.obstacles || [];
  const shadowVolumes = opts?.shadowVolumes || [];
  const roofExtensions = opts?.roofExtensions || [];
  const marginOuterCm = opts?.marginOuterCm ?? 0;
  const metersPerPixel = opts?.metersPerPixel;
  const marginPxOverride = opts?.marginPxOverride;

  /* SAFE-ZONE-V2 : marges par role si opts.margesCm present (sinon comportement historique). */
  const margesPartialV2 = sanitizeMargesCmPartial(opts?.margesCm);
  const margesCmV2 = margesPartialV2 ? completeMargesCm(margesPartialV2, marginOuterCm) : null;
  const mppV2 = typeof metersPerPixel === "number" && metersPerPixel > 0 ? metersPerPixel : 1;
  const cmToPxV2 = (cm) => (cm / 100) / mppV2;
  const structSegsV2 = margesCmV2
    ? collectStructuralSegments(opts?.ridges, opts?.traits)
    : [];

  const pansForEngine = pans
    .map((p) => {
      const polygonPx = getPanPolygonPx(p);
      if (!polygonPx) return null;
      const base = { id: p.id || "unknown", polygonPx };
      if (p.roofType === "FLAT" && p.flatRoofConfig && typeof p.flatRoofConfig === "object") {
        const fc = p.flatRoofConfig;
        if (typeof fc.setbackRoofEdgeCm === "number" && Number.isFinite(fc.setbackRoofEdgeCm)) {
          base.marginOuterCm = Math.max(0, fc.setbackRoofEdgeCm);
        }
        if (typeof fc.setbackObstacleCm === "number" && Number.isFinite(fc.setbackObstacleCm)) {
          base.obstacleMarginCm = Math.max(0, fc.setbackObstacleCm);
        }
      }
      /* SAFE-ZONE-V2 : pans inclines uniquement — FLAT garde ses setbacks dedies. */
      if (margesCmV2 && p.roofType !== "FLAT") {
        const panPartial = sanitizeMargesCmPartial(p.margesCm);
        const mPan = panPartial ? Object.assign({}, margesCmV2, panPartial) : margesCmV2;
        const cls = classifyPanEdgesV2(polygonPx, structSegsV2);
        if (cls.roles.length >= 3) {
          base.edgeMarginsPx = cls.roles.map((role) => cmToPxV2(marginCmForRole(role, mPan)));
          base.edgeRolesV2 = cls.roles;
        }
        if (structSegsV2.length > 0) {
          base.structuralSegmentsPx = structSegsV2.map((s) => ({
            a: s.a,
            b: s.b,
            marginPx: cmToPxV2(s.role === "faitage" ? mPan.faitageCm : mPan.aretierCm),
          }));
        }
        base.obstacleMarginPx = cmToPxV2(mPan.obstacleCm);
      }
      return base;
    })
    .filter(Boolean);

  const obstaclesFromState = obstacles
    .map((o) => {
      const polygonPx = getObstaclePolygonPx(o);
      if (!polygonPx) return null;
      return { id: o.id || "unknown", polygonPx };
    })
    .filter(Boolean);

  const mpp = typeof metersPerPixel === "number" && metersPerPixel > 0 ? metersPerPixel : 1;
  const svObstacles = shadowVolumes
    .map((sv) => shadowVolumeToObstacle(sv, mpp))
    .filter(Boolean);
  const rxObstacles = roofExtensions
    .map((rx) => roofExtensionToObstacle(rx))
    .filter(Boolean);

  const obstaclesForEngine = [...obstaclesFromState, ...svObstacles, ...rxObstacles];

  const cmToPxFn = mpp > 0 ? (cm) => (cm / 100) / mpp : null;

  return computeSafeZones({
    pans: pansForEngine,
    obstacles: obstaclesForEngine,
    marginOuterCm,
    cmToPxFn,
    marginPxOverride,
    simplifyPolygons: true,
  });
}

export { computeSafeZones, classifyPanEdgesV2, sanitizeMargesCmPartial, completeMargesCm, marginCmForRole };
