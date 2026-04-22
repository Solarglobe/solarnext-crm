/**
 * Calculs physiques des pans (pente et orientation) à partir des hauteurs.
 * Vue strictement 2D ; tous les calculs sont déterministes et reproductibles.
 * Source de vérité pour les calculs solaires : pan.physical.slope.valueDeg.
 *
 * Garanties :
 * - Aucun pan n’a de pente incohérente avec ses hauteurs : computedDeg est toujours
 *   recalculé depuis les sommets ; en mode "auto", valueDeg = computedDeg.
 * - Toute correction manuelle reste physiquement valide (valueDeg en degrés, conservée).
 * - Données prêtes pour calepinage, ombrage et calcul solaire après recomputePanPhysicalProps.
 */

import type { Pan, PanPhysical, Point2D } from "./panState";
import {
  collectPartialWorldHeightSamplesFromImage,
  computeOfficialPanPhysicsFromImageVertices,
  tryPanPhysicsFromWorldHeightSamples,
} from "../../src/modules/calpinage/canonical3d/builder/computeOfficialPanPhysicsFromImageVertices";
import { segmentHorizontalLengthMFromImagePx } from "../../src/modules/calpinage/canonical3d/builder/worldMapping";
import { readPanVertexRing } from "../../src/modules/calpinage/runtime/panVertexContract";

/** État minimal pour les calculs (roof.north, scale) — aligné bundle / worldMapping. */
export type CalpinageStateLike = {
  pans: Pan[];
  roof?: {
    north?: { angleDeg: number } | null;
    scale?: { metersPerPixel: number } | null;
    roof?: { north?: { angleDeg: number } | null } | null;
  } | null;
};

const TOL = 1e-10;
const TOL_PX = 1e-6;

function readNorthDeg(state: CalpinageStateLike): number {
  const n1 = state.roof?.north?.angleDeg;
  if (typeof n1 === "number" && Number.isFinite(n1)) return n1;
  const n2 = state.roof?.roof?.north?.angleDeg;
  if (typeof n2 === "number" && Number.isFinite(n2)) return n2;
  return 0;
}

function getVertexZForPhysics(pt: Point2D): number | null {
  return typeof pt.h === "number" && Number.isFinite(pt.h) ? pt.h : null;
}

/** Retourne la hauteur effective d'un point (m). */
function getH(pt: Point2D): number {
  return typeof pt.h === "number" && Number.isFinite(pt.h) ? pt.h : 0;
}

/** Distance horizontale monde (m) — même loi que la 3D (`segmentHorizontalLengthMFromImagePx`, Niveau 2). */
function horizontalDistanceM(
  a: Point2D,
  b: Point2D,
  metersPerPixel: number,
  northAngleDeg: number,
): number {
  return segmentHorizontalLengthMFromImagePx(
    { x: a.x, y: a.y },
    { x: b.x, y: b.y },
    metersPerPixel,
    northAngleDeg,
  );
}

/** Points effectifs du pan — contrat panVertexContract (points → polygonPx → polygon), sans h fictif. */
function getPanPointsForPlane(pan: Pan): Point2D[] {
  const ring = readPanVertexRing(pan as unknown as Record<string, unknown>);
  return ring.map((v, i) => {
    const o: Point2D = { x: v.x, y: v.y, id: v.id ?? pan.id + "-" + i };
    if (typeof v.h === "number" && Number.isFinite(v.h)) o.h = v.h;
    return o;
  });
}

/**
 * Pente : même chaîne que le canonical (image → ENU → Newell), repli LSQ monde.
 */
export function computePanSlopeComputedDeg(
  pan: Pan,
  state: CalpinageStateLike
): number {
  const pts = getPanPointsForPlane(pan);
  const mpp = state.roof?.scale?.metersPerPixel ?? 1;
  if (!Number.isFinite(mpp) || mpp <= 0) return 0;
  const north = readNorthDeg(state);
  const official = computeOfficialPanPhysicsFromImageVertices(pts, (pt) => getVertexZForPhysics(pt), mpp, north);
  if (official.source === "newell_corners_world" && official.slopeDeg != null) return official.slopeDeg;
  const samples = collectPartialWorldHeightSamplesFromImage(pts, (pt) => getVertexZForPhysics(pt), mpp, north);
  const lsq = tryPanPhysicsFromWorldHeightSamples(samples);
  if (lsq) return lsq.slopeDeg;
  if (typeof window !== "undefined" && (window as any).__DEV_MODE__ === true) {
    console.warn("[PAN_PHYSICS] pas de plan monde fiable -> tilt=0", { panId: pan.id });
  }
  return 0;
}

/** Libellés cardinaux (N, NNE, …) pour l’azimut final. */
const CARDINAL_LABELS: { min: number; max: number; label: string }[] = [
  { min: 348.75, max: 360, label: "N" },
  { min: 0, max: 11.25, label: "N" },
  { min: 11.25, max: 33.75, label: "NNE" },
  { min: 33.75, max: 56.25, label: "NE" },
  { min: 56.25, max: 78.75, label: "ENE" },
  { min: 78.75, max: 101.25, label: "E" },
  { min: 101.25, max: 123.75, label: "ESE" },
  { min: 123.75, max: 146.25, label: "SE" },
  { min: 146.25, max: 168.75, label: "SSE" },
  { min: 168.75, max: 191.25, label: "S" },
  { min: 191.25, max: 213.75, label: "SSO" },
  { min: 213.75, max: 236.25, label: "SO" },
  { min: 236.25, max: 258.75, label: "OSO" },
  { min: 258.75, max: 281.25, label: "O" },
  { min: 281.25, max: 303.75, label: "ONO" },
  { min: 303.75, max: 326.25, label: "NO" },
  { min: 326.25, max: 348.75, label: "NNO" },
];

function azimuthToCardinalLabel(azimuthDeg: number): string {
  for (const { min, max, label } of CARDINAL_LABELS) {
    if (azimuthDeg >= min && azimuthDeg < max) return label;
  }
  return "N";
}

/**
 * Azimut ENU de la normale horizontale (0=N, 90=E) — identique au canonical / pans-bundle (Prompt 4B).
 */
export function computePanOrientation(
  pan: Pan,
  state: CalpinageStateLike
): { azimuthDeg: number; label: string; slopeDirectionLabel: string } | null {
  const pts = getPanPointsForPlane(pan);
  const mpp = state.roof?.scale?.metersPerPixel ?? 1;
  if (!Number.isFinite(mpp) || mpp <= 0) return null;
  const north = readNorthDeg(state);
  const official = computeOfficialPanPhysicsFromImageVertices(pts, (pt) => getVertexZForPhysics(pt), mpp, north);
  let azimuthDeg: number | null =
    official.source === "newell_corners_world" && official.azimuthDeg != null ? official.azimuthDeg : null;
  if (azimuthDeg == null) {
    const samples = collectPartialWorldHeightSamplesFromImage(pts, (pt) => getVertexZForPhysics(pt), mpp, north);
    const lsq = tryPanPhysicsFromWorldHeightSamples(samples);
    if (lsq) azimuthDeg = lsq.azimuthDeg;
  }
  if (azimuthDeg == null) return null;
  const label = azimuthToCardinalLabel(azimuthDeg);
  return { azimuthDeg, label, slopeDirectionLabel: label };
}

/** Structure physical par défaut pour un nouveau pan. */
export function getDefaultPanPhysical(): PanPhysical {
  return {
    slope: {
      mode: "auto",
      computedDeg: null,
      valueDeg: null,
    },
    orientation: {
      azimuthDeg: null,
      label: null,
    },
  };
}

/**
 * Assure que pan.physical existe avec la structure attendue (sans supprimer les champs existants).
 */
export function ensurePanPhysical(pan: Pan): void {
  if (!pan.physical) {
    pan.physical = getDefaultPanPhysical();
    return;
  }
  if (!pan.physical.slope) {
    pan.physical.slope = {
      mode: "auto",
      computedDeg: null,
      valueDeg: null,
    };
  }
  if (pan.physical.slope.mode === undefined) pan.physical.slope.mode = "auto";
  if (pan.physical.slope.computedDeg === undefined)
    pan.physical.slope.computedDeg = null;
  if (pan.physical.slope.valueDeg === undefined)
    pan.physical.slope.valueDeg = null;
  if (!pan.physical.orientation) {
    pan.physical.orientation = { azimuthDeg: null, label: null };
  }
  if (pan.physical.orientation.azimuthDeg === undefined)
    pan.physical.orientation.azimuthDeg = null;
  if (pan.physical.orientation.label === undefined)
    pan.physical.orientation.label = null;
  if (pan.physical.slopeDirectionLabel === undefined)
    pan.physical.slopeDirectionLabel = null;
}

/**
 * Recalcule computedDeg et orientation ; en mode "auto", valueDeg = computedDeg.
 * À appeler après : modification de hauteur, recalcul de pans, chargement du state.
 */
export function recomputePanPhysicalProps(
  pan: Pan,
  state: CalpinageStateLike
): void {
  ensurePanPhysical(pan);
  const computedDeg = computePanSlopeComputedDeg(pan, state);
  pan.physical!.slope.computedDeg = computedDeg;
  if (pan.physical!.slope.mode === "auto") {
    pan.physical!.slope.valueDeg = computedDeg;
  }
  const orient = computePanOrientation(pan, state);
  if (orient) {
    pan.physical!.orientation.azimuthDeg = orient.azimuthDeg;
    pan.physical!.orientation.label = orient.label;
    pan.physical!.slopeDirectionLabel = orient.slopeDirectionLabel;
  } else {
    pan.physical!.slopeDirectionLabel = null;
  }
  pan.azimuthDeg = pan.physical!.orientation.azimuthDeg ?? pan.azimuthDeg;
  pan.tiltDeg = pan.physical!.slope.valueDeg ?? pan.tiltDeg;
}

/**
 * Recalcule les propriétés physiques pour tous les pans.
 */
export function recomputeAllPanPhysicalProps(
  pans: Pan[],
  state: CalpinageStateLike
): void {
  const fullState = { ...state, pans };
  for (const pan of pans) {
    recomputePanPhysicalProps(pan, fullState);
  }
}

const VERTEX_TOL_PX = 0.5;

/** Points effectifs du pan — même contrat que getPanPointsForPlane. */
function getPanPoints(pan: Pan): Point2D[] {
  return getPanPointsForPlane(pan);
}

/** Deux points sont-ils au même endroit (tolérance pixels) ? */
function sameVertex(a: { x: number; y: number }, b: { x: number; y: number }, tol = VERTEX_TOL_PX): boolean {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
}

/** Arête [a,b] égale à [c,d] ou [d,c] (même extrémités). */
function sameEdge(
  a: Point2D,
  b: Point2D,
  c: Point2D,
  d: Point2D,
  tol = VERTEX_TOL_PX
): boolean {
  return (
    (sameVertex(a, c, tol) && sameVertex(b, d, tol)) ||
    (sameVertex(a, d, tol) && sameVertex(b, c, tol))
  );
}

/**
 * Pans adjacents au pan donné.
 * Critères : partage d’un trait (traitIds), partage d’un faîtage (ridgeIds),
 * partage d’une arête géométrique, ou au moins un sommet commun.
 */
export function getAdjacentPans(pan: Pan, state: CalpinageStateLike): Pan[] {
  const seen = new Set<string>();
  const result: Pan[] = [];
  const pts = getPanPoints(pan);
  if (pts.length < 2) return result;

  const addIfNew = (other: Pan) => {
    if (other.id !== pan.id && !seen.has(other.id)) {
      seen.add(other.id);
      result.push(other);
    }
  };

  // 1) Adjacency par trait partagé
  const panTraitIds = pan.traitIds || [];
  if (panTraitIds.length > 0) {
    for (const other of state.pans) {
      const otherTraitIds = other.traitIds || [];
      if (other.id === pan.id) continue;
      for (const tid of panTraitIds) {
        if (otherTraitIds.includes(tid)) {
          addIfNew(other);
          break;
        }
      }
    }
  }

  // 2) Adjacency par faîtage partagé
  const panRidgeIds = pan.ridgeIds || [];
  if (panRidgeIds.length > 0) {
    for (const other of state.pans) {
      const otherRidgeIds = other.ridgeIds || [];
      if (other.id === pan.id) continue;
      for (const rid of panRidgeIds) {
        if (otherRidgeIds.includes(rid)) {
          addIfNew(other);
          break;
        }
      }
    }
  }

  // 3) Arête commune (segment partagé)
  for (const other of state.pans) {
    if (other.id === pan.id) continue;
    const op = getPanPoints(other);
    if (op.length < 2) continue;
    for (let i = 0, ni = pts.length; i < ni; i++) {
      const i1 = (i + 1) % ni;
      for (let j = 0, nj = op.length; j < nj; j++) {
        const j1 = (j + 1) % nj;
        if (sameEdge(pts[i], pts[i1], op[j], op[j1])) {
          addIfNew(other);
          break;
        }
      }
    }
  }

  // 4) Au moins un sommet commun (sommets communs)
  for (const other of state.pans) {
    if (other.id === pan.id) continue;
    const op = getPanPoints(other);
    for (const p of pts) {
      for (const q of op) {
        if (sameVertex(p, q)) {
          addIfNew(other);
          break;
        }
      }
    }
  }

  return result;
}

/**
 * Applique une pente manuelle au pan : ajuste les hauteurs (gouttières conservées, faîtage ajusté)
 * pour obtenir la pente souhaitée, puis met mode = "manual" et valueDeg = desiredSlopeDeg.
 * Recalcule les pans adjacents.
 */
/**
 * Copie les hauteurs des sommets communs (même x,y) du pan source vers le pan cible.
 * Modifie uniquement les points du pan cible (pan.points) ; ne crée pas .points si absent.
 */
function syncCommonHeights(source: Pan, target: Pan): void {
  const srcPts = getPanPoints(source);
  if (!target.points || target.points.length === 0) return;
  for (const sp of srcPts) {
    for (const tp of target.points) {
      if (sameVertex(sp, tp) && typeof sp.h === "number" && Number.isFinite(sp.h)) {
        tp.h = sp.h;
      }
    }
  }
}

/**
 * Applique une pente manuelle au pan : ajuste les hauteurs (gouttières conservées, faîtage ajusté)
 * pour obtenir la pente souhaitée, met mode = "manual" et valueDeg = desiredSlopeDeg.
 * Pour les pans adjacents en mode "auto" : met à jour les hauteurs des sommets communs puis recalcule
 * pente/orientation. Ne modifie jamais un pan déjà en mode "manual".
 */
export function applyManualSlopeToPan(
  pan: Pan,
  desiredSlopeDeg: number,
  state: CalpinageStateLike
): void {
  ensurePanPhysical(pan);
  const pts = getPanPoints(pan);
  if (pts.length < 2) return;
  // S'assurer que le pan a bien .points modifiable (pas seulement .polygon)
  if (!pan.points || pan.points.length === 0) {
    pan.points = pts.map((p, i) => ({ ...p, id: p.id ?? pan.id + "-" + i }));
  }

  const mpp = state.roof?.scale?.metersPerPixel ?? 1;
  if (!Number.isFinite(mpp) || mpp <= 0) return;
  const north = readNorthDeg(state);

  const workPts = pan.points;
  let minH = getH(workPts[0]);
  let maxH = minH;
  const atMin: number[] = [];
  const atMax: number[] = [];
  for (let i = 0; i < workPts.length; i++) {
    const h = getH(workPts[i]);
    if (h < minH) {
      minH = h;
      atMin.length = 0;
      atMin.push(i);
    } else if (h === minH) {
      atMin.push(i);
    }
    if (h > maxH) {
      maxH = h;
      atMax.length = 0;
      atMax.push(i);
    } else if (h === maxH) {
      atMax.push(i);
    }
  }

  let maxRun = 0;
  for (let i = 0; i < workPts.length; i++) {
    const hi = getH(workPts[i]);
    for (let j = 0; j < workPts.length; j++) {
      if (i === j) continue;
      const hj = getH(workPts[j]);
      const isLowHigh =
        (hi <= minH + TOL_PX && hj >= maxH - TOL_PX) ||
        (hj <= minH + TOL_PX && hi >= maxH - TOL_PX);
      if (!isLowHigh) continue;
      const run = horizontalDistanceM(workPts[i], workPts[j], mpp, north);
      if (run > maxRun) maxRun = run;
    }
  }
  if (maxRun < TOL_PX) return;

  const deltaH =
    Math.tan((desiredSlopeDeg * Math.PI) / 180) * maxRun;
  const newRidgeH = minH + deltaH;
  const oldSpan = maxH - minH;

  for (const idx of atMax) {
    workPts[idx].h = newRidgeH;
  }
  for (let i = 0; i < workPts.length; i++) {
    if (atMax.indexOf(i) >= 0) continue;
    if (atMin.indexOf(i) >= 0) continue;
    const h = getH(workPts[i]);
    const t = oldSpan > TOL_PX ? (h - minH) / oldSpan : 0;
    workPts[i].h = minH + t * (newRidgeH - minH);
  }

  pan.physical!.slope.mode = "manual";
  pan.physical!.slope.valueDeg = desiredSlopeDeg;
  pan.physical!.slope.computedDeg = computePanSlopeComputedDeg(pan, state);
  pan.tiltDeg = desiredSlopeDeg;

  const fullState = { ...state, pans: state.pans };
  const adjacent = getAdjacentPans(pan, fullState);
  for (const adj of adjacent) {
    if (adj.physical?.slope?.mode === "manual") continue;
    syncCommonHeights(pan, adj);
    recomputePanPhysicalProps(adj, fullState);
  }
}
