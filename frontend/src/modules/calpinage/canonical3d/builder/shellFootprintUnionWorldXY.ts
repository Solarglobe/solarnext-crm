/**
 * Niveau 1 — emprise shell multi-pans : union / intersection des polygones XY monde (Clipper).
 * Les polygones doivent être dans le **même repère** que `imagePxToWorldHorizontalM` (ENU, Y image → −Y monde).
 * Repli union : null → l’appelant peut utiliser le plus grand pan seul.
 */

/* clipper-lib : pas de typings stables — API runtime validée par tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import ClipperLib from "clipper-lib";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { WorldPosition3D } from "../types/coordinates";

type ClipperPath = Array<{ X: number; Y: number }>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CL: any = ClipperLib;

/** Résolution sub-millimétrique en mètres (entiers Clipper). */
const SCALE = 1_000_000;

const CLEAN_DIST = Math.round(SCALE * 1e-4);

function patchFootprintXY(poly: readonly WorldPosition3D[]): { x: number; y: number }[] {
  return poly
    .filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y))
    .map((c) => ({ x: c.x, y: c.y }));
}

function ensureClosedClipperPath(path: ClipperPath): ClipperPath {
  if (path.length < 2) return path;
  const first = path[0]!;
  const last = path[path.length - 1]!;
  if (first.X === last.X && first.Y === last.Y) return path;
  return [...path, { X: first.X, Y: first.Y }];
}

function toClipperPath(xy: readonly { x: number; y: number }[]): ClipperPath {
  const out: ClipperPath = [];
  for (const p of xy) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    out.push({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) });
  }
  return ensureClosedClipperPath(out);
}

function fromClipperPath(path: ClipperPath): { x: number; y: number }[] {
  if (path.length < 2) return [];
  const pts = path.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE }));
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  if (pts.length >= 2 && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) {
    return pts.slice(0, -1);
  }
  return pts;
}

function shoelaceSignedAreaXY(pts: readonly { x: number; y: number }[]): number {
  let s = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += pts[i]!.x * pts[j]!.y - pts[j]!.x * pts[i]!.y;
  }
  return s * 0.5;
}

/**
 * Union des empreintes horizontales des pans (monde, m).
 * @returns anneau simple (sans point de fermeture dupliqué), CCW, ou null si union impossible.
 */
export function tryUnionRoofPatchFootprintsWorldXY(
  patches: readonly RoofPlanePatch3D[],
): { x: number; y: number }[] | null {
  if (patches.length < 2) return null;

  const paths: ClipperPath[] = [];
  for (const p of patches) {
    const xy = patchFootprintXY(p.cornersWorld);
    if (xy.length < 3) continue;
    const path = toClipperPath(xy);
    if (path.length < 4) continue;
    paths.push(path);
  }
  if (paths.length < 2) return null;

  const clipper = new CL.Clipper();
  for (const path of paths) {
    clipper.AddPath(path, CL.PolyType.ptSubject, true);
  }
  const solution = new CL.Paths();
  const ok = clipper.Execute(
    CL.ClipType.ctUnion,
    solution,
    CL.PolyFillType.pftNonZero,
    CL.PolyFillType.pftNonZero,
  );
  if (!ok || solution.length === 0) return null;

  const cleaned = CL.Clipper.CleanPolygons(solution, CLEAN_DIST);
  if (cleaned.length === 0) return null;

  let bestPath: ClipperPath | null = null;
  let bestArea = 0;
  for (const path of cleaned) {
    if (path.length < 3) continue;
    const a = Math.abs(CL.Clipper.Area(path));
    if (a > bestArea) {
      bestArea = a;
      bestPath = path;
    }
  }
  if (bestPath == null || bestPath.length < 3) return null;

  let ring = fromClipperPath(ensureClosedClipperPath(bestPath));
  if (ring.length < 3) return null;
  if (shoelaceSignedAreaXY(ring) < 0) {
    ring = ring.slice().reverse();
  }
  return ring;
}

/**
 * Union brute des empreintes pans (chemins Clipper, nettoyés) — 1 ou N polygones.
 */
function unionAllPatchFootprintsToCleanedPaths(
  patches: readonly RoofPlanePatch3D[],
): ClipperPath[] | null {
  const panPaths: ClipperPath[] = [];
  for (const p of patches) {
    const xy = patchFootprintXY(p.cornersWorld);
    if (xy.length < 3) continue;
    const path = toClipperPath(xy);
    if (path.length < 4) continue;
    panPaths.push(path);
  }
  if (panPaths.length === 0) return null;
  if (panPaths.length === 1) return [ensureClosedClipperPath(panPaths[0]!)];

  const clipper = new CL.Clipper();
  for (const path of panPaths) {
    clipper.AddPath(path, CL.PolyType.ptSubject, true);
  }
  const solution = new CL.Paths();
  const ok = clipper.Execute(
    CL.ClipType.ctUnion,
    solution,
    CL.PolyFillType.pftNonZero,
    CL.PolyFillType.pftNonZero,
  );
  if (!ok || solution.length === 0) return null;
  const cleaned = CL.Clipper.CleanPolygons(solution, CLEAN_DIST) as ClipperPath[];
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Anneau XY du **contour bâti** découpé par l’**union des empreintes toiture** (monde, m).
 * Garantit que le périmètre du shell ne s’étend pas au-delà du maillage toiture (plus de cordes
 * dans le vide ni murs « hors toit » quand le contour image est plus grand que les pans).
 *
 * @returns polygone simple CCW (sans point de fermeture dupliqué), ou `null` si pas d’intersection.
 */
export function clipBuildingContourRingXYToRoofCoverageWorld(
  buildingRingXY: readonly { x: number; y: number }[],
  patches: readonly RoofPlanePatch3D[],
): { x: number; y: number }[] | null {
  if (buildingRingXY.length < 3 || patches.length === 0) return null;

  const unionPaths = unionAllPatchFootprintsToCleanedPaths(patches);
  if (unionPaths == null || unionPaths.length === 0) return null;

  const subj = toClipperPath(buildingRingXY);
  if (subj.length < 4) return null;

  const clipper = new CL.Clipper();
  clipper.AddPath(subj, CL.PolyType.ptSubject, true);
  for (const path of unionPaths) {
    if (path.length >= 3) clipper.AddPath(path, CL.PolyType.ptClip, true);
  }
  const solution = new CL.Paths();
  const ok = clipper.Execute(
    CL.ClipType.ctIntersection,
    solution,
    CL.PolyFillType.pftNonZero,
    CL.PolyFillType.pftNonZero,
  );
  if (!ok || solution.length === 0) return null;

  const cleaned = CL.Clipper.CleanPolygons(solution, CLEAN_DIST) as ClipperPath[];
  if (cleaned.length === 0) return null;

  let bestPath: ClipperPath | null = null;
  let bestArea = 0;
  for (const path of cleaned) {
    if (path.length < 3) continue;
    const a = Math.abs(CL.Clipper.Area(path));
    if (a > bestArea) {
      bestArea = a;
      bestPath = path;
    }
  }
  if (bestPath == null || bestPath.length < 3) return null;

  let ring = fromClipperPath(ensureClosedClipperPath(bestPath));
  if (ring.length < 3) return null;
  if (shoelaceSignedAreaXY(ring) < 0) {
    ring = ring.slice().reverse();
  }
  return ring;
}
