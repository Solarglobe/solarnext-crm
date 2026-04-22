/**
 * Contrat unique des sommets de pan (runtime Phase 2 / 3 / miroir 3D).
 *
 * LECTURE canonique (une seule règle produit) :
 * 1. `pan.points` si au moins 2 sommets valides (x,y finis) — vérité runtime éditable
 * 2. sinon `pan.polygonPx` (dérivé affichage / outils / persistance partielle)
 * 3. sinon `pan.polygon` (sortie typique de computePansFromGeometryCore)
 *
 * ÉCRITURE : `points` est la structure canonique après enrichissement ;
 * `polygon` et `polygonPx` sont alignés explicitement (sync contrôlé, jamais l’inverse silencieux).
 *
 * SYNC obligatoire : toute logique parallèle dans `pans-bundle.js` (getPanPoints) doit reproduire
 * le même ordre — commentaire de lien dans le bundle.
 */

export type PanVertexRingItem = {
  readonly x: number;
  readonly y: number;
  readonly h?: number;
  readonly id?: string;
};

export type PanPhysicsSessionDiagnostics = {
  readonly panCount: number;
  readonly pansWithVertexRing: number;
  readonly pansWithAllHeightsResolved: number;
  readonly pansWithPhysicsSlope: number;
  readonly pansWithPhysicsAzimuth: number;
  readonly pansBlockedMissingHeights: number;
};

function normalizeVertex(v: unknown, panId: string, index: number): PanVertexRingItem | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const x = typeof o.x === "number" ? o.x : NaN;
  const y = typeof o.y === "number" ? o.y : NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const id = typeof o.id === "string" ? o.id : `${panId}-${index}`;
  if (typeof o.h === "number" && Number.isFinite(o.h)) {
    return { x, y, h: o.h, id };
  }
  if (typeof o.heightM === "number" && Number.isFinite(o.heightM)) {
    return { x, y, h: o.heightM, id };
  }
  return { x, y, id };
}

function ringFromArray(arr: unknown, panId: string): PanVertexRingItem[] {
  if (!Array.isArray(arr) || arr.length < 2) return [];
  const out: PanVertexRingItem[] = [];
  for (let i = 0; i < arr.length; i++) {
    const n = normalizeVertex(arr[i], panId, i);
    if (n) out.push(n);
  }
  return out.length >= 2 ? out : [];
}

/** Tolérance XY (px image) : sommets `points` vs `polygon` après recompute / split — au-delà, on repart du polygone dérivé. */
export const PAN_VERTEX_XY_MATCH_TOL_PX = 4;

/**
 * Vérifie si un anneau sauvegardé (ex. `saved.points`) correspond au polygone dérivé (même nombre de sommets, XY proches).
 * Si faux, réutiliser les anciens points figerait une topologie obsolète et casserait la résolution Z / la physique.
 */
export function savedPanVertexRingCompatibleWithPolygon(
  savedPoints: readonly unknown[] | null | undefined,
  polygon: readonly unknown[] | null | undefined,
  tolPx: number = PAN_VERTEX_XY_MATCH_TOL_PX,
): boolean {
  if (!Array.isArray(savedPoints) || !Array.isArray(polygon) || savedPoints.length < 2 || polygon.length < 2) {
    return false;
  }
  if (savedPoints.length !== polygon.length) return false;
  const tol = typeof tolPx === "number" && Number.isFinite(tolPx) && tolPx > 0 ? tolPx : PAN_VERTEX_XY_MATCH_TOL_PX;
  for (let i = 0; i < savedPoints.length; i++) {
    const a = savedPoints[i] as Record<string, unknown> | null;
    const b = polygon[i] as Record<string, unknown> | null;
    if (!a || !b) return false;
    const ax = typeof a.x === "number" ? a.x : NaN;
    const ay = typeof a.y === "number" ? a.y : NaN;
    const bx = typeof b.x === "number" ? b.x : NaN;
    const by = typeof b.y === "number" ? b.y : NaN;
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return false;
    if (Math.hypot(ax - bx, ay - by) > tol) return false;
  }
  return true;
}

/** Anneau uniquement depuis géométrie dérivée (polygon → polygonPx), sans lire `points`. */
function readPanVertexRingFromDerivedGeometryOnly(
  pan: Record<string, unknown>,
  panId: string,
): PanVertexRingItem[] {
  const poly = pan.polygon;
  if (Array.isArray(poly) && poly.length >= 2) {
    const r = ringFromArray(poly, panId);
    if (r.length >= 2) return r;
  }
  const px = pan.polygonPx;
  if (Array.isArray(px) && px.length >= 2) {
    const r = ringFromArray(px, panId);
    if (r.length >= 2) return r;
  }
  return [];
}

/**
 * Anneau de sommets image pour lecture physique / plans / diagnostics.
 * Si `points` est présent mais dégénéré (< 2 valides), retombe sur polygonPx puis polygon.
 */
export function readPanVertexRing(pan: Record<string, unknown> | null | undefined): PanVertexRingItem[] {
  if (!pan || typeof pan !== "object") return [];
  const panId = String(pan.id ?? "pan");

  const pts = pan.points;
  if (Array.isArray(pts) && pts.length >= 2) {
    const r = ringFromArray(pts, panId);
    if (r.length >= 2) return r;
  }
  const px = pan.polygonPx;
  if (Array.isArray(px) && px.length >= 2) {
    const r = ringFromArray(px, panId);
    if (r.length >= 2) return r;
  }
  const poly = pan.polygon;
  if (Array.isArray(poly) && poly.length >= 2) {
    const r = ringFromArray(poly, panId);
    if (r.length >= 2) return r;
  }
  return [];
}

/**
 * Garantit `pan.points` (≥2 sommets) à partir des sources géométriques si absent ou trop court.
 * Ne supprime pas les `h` déjà présents sur `points`.
 */
export function ensurePanPointsCanonicalFromGeometry(pan: Record<string, unknown>): boolean {
  const panId = String(pan.id ?? "pan");
  const pts = pan.points;
  if (Array.isArray(pts) && pts.length >= 2 && ringFromArray(pts, panId).length >= 2) {
    const poly = pan.polygon;
    if (Array.isArray(poly) && poly.length >= 2) {
      if (!savedPanVertexRingCompatibleWithPolygon(pts, poly)) {
        const geomRing = readPanVertexRingFromDerivedGeometryOnly(pan, panId);
        if (geomRing.length >= 2) {
          pan.points = geomRing.map((v) => {
            const o: Record<string, unknown> = { x: v.x, y: v.y, id: v.id ?? panId };
            if (typeof v.h === "number" && Number.isFinite(v.h)) o.h = v.h;
            return o;
          });
          return true;
        }
      } else {
        return true;
      }
    } else {
      return true;
    }
  }

  const ring = readPanVertexRing(pan);
  if (ring.length < 2) return false;

  pan.points = ring.map((v) => {
    const o: Record<string, unknown> = { x: v.x, y: v.y, id: v.id ?? panId };
    if (typeof v.h === "number" && Number.isFinite(v.h)) o.h = v.h;
    return o;
  });
  return true;
}

/** Aligne `pan.polygon` sur `pan.points` (xy + h si défini). */
export function alignPanPolygonToCanonicalPoints(pan: Record<string, unknown>): void {
  const pts = pan.points;
  if (!Array.isArray(pts) || pts.length < 2) return;
  pan.polygon = pts.map((raw) => {
    const pt = raw as Record<string, unknown>;
    const o: Record<string, unknown> = {
      x: typeof pt.x === "number" ? pt.x : 0,
      y: typeof pt.y === "number" ? pt.y : 0,
    };
    if (typeof pt.h === "number" && Number.isFinite(pt.h)) o.h = pt.h;
    return o;
  });
}

/**
 * Diagnostic session : détecter immédiatement pans non résolus physiquement.
 * `getVertexH` optionnel : même résolveur que le bundle (après ensurePanPointsWithHeights).
 */
export function computePanPhysicsDiagnostics(
  pans: readonly unknown[] | null | undefined,
  getVertexH?: (pt: { x: number; y: number }) => number | null,
): PanPhysicsSessionDiagnostics {
  const list = Array.isArray(pans) ? pans : [];
  let pansWithVertexRing = 0;
  let pansWithAllHeightsResolved = 0;
  let pansWithPhysicsSlope = 0;
  let pansWithPhysicsAzimuth = 0;
  let pansBlockedMissingHeights = 0;
  let panCount = 0;

  for (const raw of list) {
    const pan = raw as Record<string, unknown> | null;
    if (!pan) continue;
    panCount++;

    const ring = readPanVertexRing(pan);
    if (ring.length < 2) continue;
    pansWithVertexRing++;

    let missing = false;
    for (let i = 0; i < ring.length; i++) {
      const v = ring[i];
      const explicit = typeof v.h === "number" && Number.isFinite(v.h);
      let z: number | null = explicit ? v.h! : null;
      if (!explicit && getVertexH) {
        const got = getVertexH({ x: v.x, y: v.y });
        z = typeof got === "number" && Number.isFinite(got) ? got : null;
      }
      if (z === null) {
        missing = true;
        break;
      }
    }
    if (!missing) pansWithAllHeightsResolved++;
    if (missing) pansBlockedMissingHeights++;

    const phys = pan.physical as Record<string, unknown> | undefined;
    const slope = phys?.slope as Record<string, unknown> | undefined;
    const orient = phys?.orientation as Record<string, unknown> | undefined;
    const cd = slope?.computedDeg;
    const az = orient?.azimuthDeg;
    if (typeof cd === "number" && Number.isFinite(cd)) pansWithPhysicsSlope++;
    if (typeof az === "number" && Number.isFinite(az)) pansWithPhysicsAzimuth++;
  }

  return {
    panCount,
    pansWithVertexRing,
    pansWithAllHeightsResolved,
    pansWithPhysicsSlope,
    pansWithPhysicsAzimuth,
    pansBlockedMissingHeights,
  };
}
