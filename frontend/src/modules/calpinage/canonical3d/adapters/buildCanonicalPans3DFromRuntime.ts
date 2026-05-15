/**
 * Pans runtime 2D → `CanonicalPan3D` via résolveur Z (hauteurs state) — **chemin hors produit 3D officiel**
 * ou debug / validations locales (ex. après édition toit).
 *
 * **Pipeline produit** (`buildSolarScene3DFromCalpinageRuntime`) : les pans affichés en scène viennent de
 * `deriveCanonicalPans3DFromRoofPlanePatches` (vue dérivée du RoofTruth), pas de ce fichier.
 *
 * - Z : Prompt 21/22 via `resolvePanVertexZ` + unification sommets partagés.
 * - Monde horizontal : `imagePxToWorldHorizontalM` (ENU Z↑).
 * - Normale / pente / azimut : `computeOfficialPanPhysicsFromCornersWorld`.
 *
 * Ne modifie pas le runtime, ne persiste rien, pas de rendu Three.js.
 */

import type { Vector3 } from "../types/primitives";
import { normalize3, vec3 } from "../utils/math3";
import { imagePxToWorldHorizontalM } from "../builder/worldMapping";
import { polygonArea3dIntrinsic, polygonProjectedHorizontalAreaXY } from "../builder/planePolygon3d";
import { computeOfficialPanPhysicsFromCornersWorld } from "../builder/officialPanPhysics";
import {
  buildRuntimeContext,
  HEIGHT_SOURCE_CONFIDENCE,
  type HeightResolverContext,
  type HeightSource,
  type HeightStateContext,
} from "../../core/heightResolver";
import { isCalpinage3DRuntimeDebugEnabled, logCalpinage3DDebug } from "../../core/calpinage3dRuntimeDebug";
import { resolvePanVertexZ } from "../resolution/resolvePanVertexZ";
import {
  unifySharedMutablePanVertices,
  type MutablePanVertexBuild,
} from "../resolution/unifySharedPanVerticesZ";
import { auditStructuralLinesAgainstCanonicalPans } from "../resolution/auditStructuralLines3D";
import {
  readOfficialRoofPanRecordsForCanonical3D,
  readStrictStatePansForProduct3D,
} from "../../integration/readOfficialCalpinageGeometryForCanonical3D";
import { resolvePanPolygonFor3D } from "../../integration/resolvePanPolygonFor3D";
import { finiteRoofHeightMOrUndefined } from "../../core/vertexHeightSemantics";

// ─── Sortie ─────────────────────────────────────────────────────────────────

export type CanonicalPanVertex3D = {
  readonly vertexId: string;
  readonly xPx: number;
  readonly yPx: number;
  readonly xWorldM: number;
  readonly yWorldM: number;
  /** Z monde (m), repère ENU — identique à la hauteur absolue utilisée par le builder toiture. */
  readonly zWorldM: number;
  /** Hauteur (m) — même valeur que zWorldM dans le repère projet (origine Z = 0 au niveau de référence runtime). */
  readonly heightM: number;
  readonly source: HeightSource | string;
  readonly confidence: number;
};

export type CanonicalPan3DDiagnostics = {
  readonly zSourceSummary: string[];
  readonly confidenceMin: number;
  readonly confidenceAvg: number;
  readonly isFlatLike: boolean;
  readonly isDegenerate: boolean;
  readonly warnings: string[];
  readonly zRangeM: number;
  readonly allHeightsEqual: boolean;
  readonly usedFallbackForAllVertices: boolean;
  readonly insufficientHeightSignal: boolean;
  readonly heterogeneousZSources: boolean;
  readonly planeResidualRmsM: number | null;
  /**
   * false si la pente / géométrie 3D ne doit pas être lue comme « reconstruite depuis cotes mesurées »
   * (repli Z global, signal hauteur insuffisant).
   */
  readonly inclinedRoofGeometryTruthful: boolean;
};

/** Arête de bord du pan dans le repère monde (sommets réels). */
export type CanonicalPanBoundaryEdgeWorld = {
  readonly i0: number;
  readonly i1: number;
  readonly start: { readonly x: number; readonly y: number; readonly z: number };
  readonly end: { readonly x: number; readonly y: number; readonly z: number };
};

export type CanonicalPan3D = {
  readonly panId: string;
  /** Hash déterministe (géométrie 2D + panId), stable entre appels si entrée identique. */
  readonly stableId: string;
  readonly points2D: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly vertices3D: readonly CanonicalPanVertex3D[];
  readonly centroid2D: { readonly x: number; readonly y: number };
  readonly centroid3D: { readonly xWorldM: number; readonly yWorldM: number; readonly zWorldM: number };
  readonly normal: { readonly x: number; readonly y: number; readonly z: number };
  /** Pente géométrique (0° = horizontal / normale verticale). */
  readonly slopeDeg: number | null;
  /** Azimut convention ENU projet : 0=Nord, 90=Est (depuis normale horizontale projetée). */
  readonly azimuthDeg: number | null;
  readonly area2DPx: number | null;
  /** Aire projetée sur le plan horizontal monde (m²), polygone XY world. */
  readonly areaPlanM2: number | null;
  /** Aire intrinsèque du polygone 3D (m²), somme triangles fan. */
  readonly area3DM2: number | null;
  readonly roofKind?: string | null;
  /** Segments 3D du contour (fermé) — wireframe / mesh / diagnostics. */
  readonly boundaryEdgesWorld?: readonly CanonicalPanBoundaryEdgeWorld[];
  readonly diagnostics: CanonicalPan3DDiagnostics;
};

export type CanonicalPans3DResult = {
  readonly ok: boolean;
  readonly pans: readonly CanonicalPan3D[];
  readonly diagnostics: {
    readonly totalPans: number;
    readonly validPans: number;
    readonly invalidPans: number;
    readonly warnings: string[];
  };
};

// ─── Entrée ─────────────────────────────────────────────────────────────────

export interface BuildCanonicalPans3DFromRuntimeOptions {
  readonly includeDiagnostics?: boolean;
  /** Si false, les pans dégénérés sont exclus de `pans` mais comptés dans invalidPans. @default true */
  readonly includeDegeneratePans?: boolean;
  readonly defaultHeightM?: number;
  /** Seuil pente (°) sous lequel le pan est marqué « quasi plat » côté géométrie. @default 0.75 */
  readonly epsilonFlatDeg?: number;
  /** Plage Z (m) considérée comme « plate » si géométrie bruitée. @default 1e-4 */
  readonly epsilonFlatZRangeM?: number;
  /** Si true : n’applique pas l’unification Z des sommets partagés entre pans (tests / debug). @default false */
  readonly skipSharedVertexUnify?: boolean;
}

export interface BuildCanonicalPans3DFromRuntimeInput {
  /**
   * État calpinage complet (CALPINAGE_STATE).
   * Peut être omis si `getState` est fourni.
   */
  readonly state?: unknown;
  /**
   * Alternative à `state` : ex. `() => getCalpinageRuntime()?.getState() ?? null`.
   */
  readonly getState?: () => unknown | null;
  readonly metersPerPixel?: number;
  readonly northAngleDeg?: number;
  /**
   * Contexte heightResolver injecté (tests). Si absent : `buildRuntimeContext(heightState)`.
   */
  readonly heightResolverContext?: HeightResolverContext;
  readonly options?: BuildCanonicalPans3DFromRuntimeOptions;
  /**
   * Produit : lecture pans **uniquement** depuis `state.pans` (jamais `roof.roofPans`).
   */
  readonly productStrictStatePansOnly?: boolean;
}

// ─── Constantes ─────────────────────────────────────────────────────────────

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

function fnv1a32Hex(s: string): string {
  let h = FNV_OFFSET >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Identifiant stable : panId + empreinte géométrique 2D (sommets arrondis, ordre conservé). */
export function computeStablePan3DId(
  panId: string,
  points2D: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): string {
  const body = points2D
    .map((p) => `${Math.round(p.x * 1000) / 1000},${Math.round(p.y * 1000) / 1000}`)
    .join("|");
  return `pan3d-${fnv1a32Hex(`${panId}::${body}`)}`;
}

function stripClosingDuplicate2D(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  if (pts.length < 2) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (a.x === b.x && a.y === b.y) return pts.slice(0, -1);
  return pts;
}

function polygonArea2DPx(pts: ReadonlyArray<{ x: number; y: number }>): number {
  if (pts.length < 3) return 0;
  let s = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(s) * 0.5;
}

function centroid2D(pts: ReadonlyArray<{ x: number; y: number }>): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  const n = pts.length;
  return n > 0 ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
}

/** Extrait contours / ridges / traits pour le moteur Z (chemins legacy réels). */
export function extractHeightStateContextFromCalpinageState(state: unknown): HeightStateContext | null {
  if (!state || typeof state !== "object") return null;
  const s = state as Record<string, unknown>;
  const structural = (s.structural && typeof s.structural === "object" ? s.structural : {}) as Record<
    string,
    unknown
  >;
  const contours = (Array.isArray(s.contours) ? s.contours : structural.contours) as HeightStateContext["contours"];
  const ridges = (Array.isArray(s.ridges) ? s.ridges : structural.ridges) as HeightStateContext["ridges"];
  const traits = (Array.isArray(s.traits) ? s.traits : structural.traits) as HeightStateContext["traits"];
  return { contours, ridges, traits };
}

/** Lit le polygone pan avec `h` / `heightM` explicites sur les sommets (Prompt 22). */
function readPanPolygon2DWithHeights(
  pan: Record<string, unknown>,
): Array<{ x: number; y: number; h?: number }> | null {
  const resolved = resolvePanPolygonFor3D(pan);
  const poly = resolved.raw;
  if (!poly || poly.length < 2) return null;
  const out: Array<{ x: number; y: number; h?: number }> = [];
  for (const rawPt of poly) {
    if (!rawPt || typeof rawPt !== "object") continue;
    const pt = rawPt as Record<string, unknown>;
    const x = typeof pt.x === "number" ? pt.x : 0;
    const y = typeof pt.y === "number" ? pt.y : 0;
    const h = finiteRoofHeightMOrUndefined(pt.h ?? pt.heightM);
    out.push(h !== undefined ? { x, y, h } : { x, y });
  }
  const stripped = stripClosingDuplicate2D(out.map((p) => ({ x: p.x, y: p.y })));
  if (stripped.length < 3) return null;
  const byXY = new Map<string, { x: number; y: number; h?: number }>();
  for (const p of out) {
    byXY.set(`${p.x}\u241e${p.y}`, p);
  }
  const aligned: Array<{ x: number; y: number; h?: number }> = [];
  for (const s of stripped) {
    const full = byXY.get(`${s.x}\u241e${s.y}`);
    aligned.push(full ?? { x: s.x, y: s.y });
  }
  return aligned.length >= 3 ? aligned : null;
}

function readRoofPansList(
  state: unknown,
  productStrictStatePansOnly?: boolean,
): {
  pans: Record<string, unknown>[];
  source: "state.pans" | "roof.roofPans_compatibility";
} | null {
  if (!state || typeof state !== "object") return null;
  const p = productStrictStatePansOnly ? readStrictStatePansForProduct3D(state) : readOfficialRoofPanRecordsForCanonical3D(state);
  if (p.pans.length === 0) return null;
  return {
    pans: [...p.pans],
    source: p.primaryField === "state.pans" ? "state.pans" : "roof.roofPans_compatibility",
  };
}

function readMppAndNorth(state: unknown, mppOverride?: number, northOverride?: number): { mpp: number; north: number } | null {
  if (typeof mppOverride === "number" && Number.isFinite(mppOverride) && mppOverride > 0) {
    return {
      mpp: mppOverride,
      north: typeof northOverride === "number" && Number.isFinite(northOverride) ? northOverride : 0,
    };
  }
  if (!state || typeof state !== "object") return null;
  const roof = (state as Record<string, unknown>).roof;
  if (!roof || typeof roof !== "object") return null;
  const r = roof as Record<string, unknown>;
  const scale = r.scale as { metersPerPixel?: number } | undefined;
  const mpp = scale?.metersPerPixel;
  if (typeof mpp !== "number" || !Number.isFinite(mpp) || mpp <= 0) return null;
  const roofBlock = r.roof as { north?: { angleDeg?: number } } | undefined;
  const north =
    typeof northOverride === "number" && Number.isFinite(northOverride)
      ? northOverride
      : typeof roofBlock?.north?.angleDeg === "number"
        ? roofBlock.north.angleDeg
        : 0;
  return { mpp, north };
}

function readPhysicalHints(pan: Record<string, unknown>): {
  tiltDegHint: number | null;
  azimuthDegHint: number | null;
} {
  const physical = pan.physical as
    | { slope?: { valueDeg?: number }; orientation?: { azimuthDeg?: number } }
    | undefined;
  const tilt =
    typeof physical?.slope?.valueDeg === "number" && Number.isFinite(physical.slope.valueDeg)
      ? physical.slope.valueDeg
      : typeof pan.tiltDeg === "number" && Number.isFinite(pan.tiltDeg)
        ? pan.tiltDeg
        : null;
  const az =
    typeof physical?.orientation?.azimuthDeg === "number" && Number.isFinite(physical.orientation.azimuthDeg)
      ? physical.orientation.azimuthDeg
      : typeof pan.azimuthDeg === "number" && Number.isFinite(pan.azimuthDeg)
        ? pan.azimuthDeg
        : null;
  return { tiltDegHint: tilt, azimuthDegHint: az };
}

function readRoofKind(pan: Record<string, unknown>): string | null {
  const rt = pan.roofType;
  return typeof rt === "string" ? rt : null;
}

function finalizeCanonicalPan3DFromMutable(
  pan: Record<string, unknown>,
  poly: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  panId: string,
  stableId: string,
  area2d: number,
  centroidPx: { x: number; y: number },
  vertices: readonly MutablePanVertexBuild[],
  _mpp: number,
  _north: number,
  opt: BuildCanonicalPans3DFromRuntimeOptions,
  upWorld: Vector3,
): CanonicalPan3D {
  const {
    includeDiagnostics = true,
    epsilonFlatDeg = 0.75,
    epsilonFlatZRangeM = 1e-4,
  } = opt;

  const vertices3D: CanonicalPanVertex3D[] = vertices.map((v) => ({
    vertexId: v.vertexId,
    xPx: v.xPx,
    yPx: v.yPx,
    xWorldM: v.xWorldM,
    yWorldM: v.yWorldM,
    zWorldM: v.zWorldM,
    heightM: v.heightM,
    source: v.source,
    confidence: v.confidence,
  }));

  const zSources = vertices3D.map((v) => String(v.source));
  const confMin = vertices3D.length ? Math.min(...vertices3D.map((v) => v.confidence)) : 0;
  const confSum = vertices3D.reduce((s, v) => s + v.confidence, 0);
  const nVert = vertices3D.length;
  const confidenceAvg = nVert > 0 ? confSum / nVert : 0;
  const fallbackCount = vertices3D.filter(
    (v) =>
      v.source === "fallback_default" ||
      v.source === "insufficient_height_signal" ||
      String(v.source).startsWith("fallback"),
  ).length;
  const heights = vertices3D.map((v) => v.heightM);
  const zMin = Math.min(...heights);
  const zMax = Math.max(...heights);
  const zRangeM = zMax - zMin;
  const allHeightsEqual = nVert > 0 && zRangeM <= epsilonFlatZRangeM;
  const usedFallbackForAllVertices = nVert > 0 && fallbackCount === nVert;
  const uniqueSources = new Set(zSources);
  const heterogeneousZSources = uniqueSources.size > 1;

  const cornersWorld: Vector3[] = vertices3D.map((v) => ({ x: v.xWorldM, y: v.yWorldM, z: v.zWorldM }));
  const official = computeOfficialPanPhysicsFromCornersWorld(cornersWorld, upWorld);
  const geometryOk = official.source === "newell_corners_world";
  const exteriorU = geometryOk ? normalize3(official.normal) : null;
  const planeResidualRmsM = geometryOk ? official.planeResidualRmsM : null;
  const slopeGeom = geometryOk ? official.slopeDeg : null;

  const areaPlanM2 = nVert >= 3 ? polygonProjectedHorizontalAreaXY(cornersWorld) : null;
  const area3DM2 = nVert >= 3 ? polygonArea3dIntrinsic(cornersWorld) : null;

  const { tiltDegHint, azimuthDegHint } = readPhysicalHints(pan);

  let slopeDeg: number | null = slopeGeom;
  if (slopeGeom != null && tiltDegHint != null && Number.isFinite(tiltDegHint)) {
    const delta = Math.abs(slopeGeom - tiltDegHint);
    if (delta <= 2.5) slopeDeg = tiltDegHint;
  }

  let azimuthDeg: number | null = geometryOk ? official.azimuthDeg : null;
  if (azimuthDeg != null && azimuthDegHint != null && Number.isFinite(azimuthDegHint)) {
    const dg = Math.abs((((azimuthDeg - azimuthDegHint + 540) % 360) - 180) as number);
    if (dg <= 15) azimuthDeg = azimuthDegHint;
  }

  const isDegenerate =
    nVert < 3 ||
    area2d < 1e-9 ||
    !geometryOk ||
    (planeResidualRmsM != null && planeResidualRmsM > 0.25 && !allHeightsEqual);

  const isFlatLike =
    (slopeGeom != null && slopeGeom <= epsilonFlatDeg) ||
    (allHeightsEqual && (planeResidualRmsM == null || planeResidualRmsM <= 0.02));

  const insufficientHeightSignal =
    usedFallbackForAllVertices ||
    (confidenceAvg < 0.35 && !allHeightsEqual) ||
    (zRangeM <= epsilonFlatZRangeM && slopeGeom != null && slopeGeom > 3 && !usedFallbackForAllVertices);

  const warnings: string[] = [];
  if (isDegenerate) warnings.push("DEGENERATE_GEOMETRY");
  if (usedFallbackForAllVertices) {
    warnings.push("ALL_VERTICES_FALLBACK_Z");
    warnings.push("PAN_VERTEX_Z_FALLBACK_USED");
  } else if (fallbackCount > 0) {
    warnings.push("PAN_VERTEX_Z_FALLBACK_USED");
  }
  if (heterogeneousZSources) warnings.push("HETEROGENEOUS_Z_SOURCES");
  if (insufficientHeightSignal) warnings.push("INSUFFICIENT_HEIGHT_SIGNAL");

  const inclinedRoofGeometryTruthful = !insufficientHeightSignal;
  if (planeResidualRmsM != null && planeResidualRmsM > 0.05) warnings.push("HIGH_PLANE_RESIDUAL");
  if (usedFallbackForAllVertices && planeResidualRmsM != null && planeResidualRmsM > 0.05) {
    warnings.push("PAN_PLANE_FROM_INSUFFICIENT_HEIGHTS");
  }
  if (isFlatLike && !allHeightsEqual && slopeGeom != null && slopeGeom > epsilonFlatDeg) {
    warnings.push("FLAT_LIKE_BUT_Z_SPREAD");
  }

  if (isCalpinage3DRuntimeDebugEnabled()) {
    logCalpinage3DDebug(`pan ${panId}`, {
      panId,
      vertexCount: nVert,
      vertices: vertices3D.map((v, vi) => ({
        vertex: vi,
        xPx: v.xPx,
        yPx: v.yPx,
        worldX: v.xWorldM,
        worldY: v.yWorldM,
        resolvedZ: v.zWorldM,
        zSource: String(v.source),
        confidence: v.confidence,
      })),
      usedFallbackForAllVertices,
      zRangeM,
      areaProjectedHorizontalXY_m2: areaPlanM2,
    });
  }

  const zSourceSummary = includeDiagnostics === false ? [] : [...uniqueSources].sort();

  const boundaryEdgesWorld: CanonicalPanBoundaryEdgeWorld[] = [];
  for (let ei = 0; ei < nVert; ei++) {
    const ej = (ei + 1) % nVert;
    const a = vertices3D[ei];
    const b = vertices3D[ej];
    boundaryEdgesWorld.push({
      i0: ei,
      i1: ej,
      start: { x: a.xWorldM, y: a.yWorldM, z: a.zWorldM },
      end: { x: b.xWorldM, y: b.yWorldM, z: b.zWorldM },
    });
  }

  return {
    panId,
    stableId,
    points2D: poly.map((p) => ({ x: p.x, y: p.y })),
    vertices3D,
    centroid2D: centroidPx,
    centroid3D: {
      xWorldM: vertices3D.reduce((s, v) => s + v.xWorldM, 0) / Math.max(1, nVert),
      yWorldM: vertices3D.reduce((s, v) => s + v.yWorldM, 0) / Math.max(1, nVert),
      zWorldM: vertices3D.reduce((s, v) => s + v.zWorldM, 0) / Math.max(1, nVert),
    },
    normal: exteriorU ? { x: exteriorU.x, y: exteriorU.y, z: exteriorU.z } : { x: 0, y: 0, z: 1 },
    slopeDeg,
    azimuthDeg,
    area2DPx: area2d > 0 ? area2d : null,
    areaPlanM2,
    area3DM2,
    roofKind: readRoofKind(pan),
    boundaryEdgesWorld,
    diagnostics: {
      zSourceSummary,
      confidenceMin: nVert > 0 ? confMin : 0,
      confidenceAvg,
      isFlatLike,
      isDegenerate,
      warnings,
      zRangeM,
      allHeightsEqual,
      usedFallbackForAllVertices,
      insufficientHeightSignal,
      heterogeneousZSources,
      planeResidualRmsM,
      inclinedRoofGeometryTruthful,
    },
  };
}

// ─── Cœur ───────────────────────────────────────────────────────────────────

/**
 * Transforme les pans runtime en fiches géométriques 3D canoniques.
 */
export function buildCanonicalPans3DFromRuntime(
  input: BuildCanonicalPans3DFromRuntimeInput,
): CanonicalPans3DResult {
  const opt = input.options ?? {};
  const {
    includeDegeneratePans = true,
    defaultHeightM = 5.5,
    skipSharedVertexUnify = false,
  } = opt;

  const rawState =
    input.state ?? (typeof input.getState === "function" ? input.getState() : null);

  const globalWarnings: string[] = [];

  const meta = readMppAndNorth(rawState, input.metersPerPixel, input.northAngleDeg);
  if (!meta) {
    globalWarnings.push("INVALID_OR_MISSING_METERS_PER_PIXEL");
    return {
      ok: false,
      pans: [],
      diagnostics: { totalPans: 0, validPans: 0, invalidPans: 0, warnings: globalWarnings },
    };
  }

  const { mpp, north } = meta;
  const heightState = extractHeightStateContextFromCalpinageState(rawState);
  const resolverBase: HeightResolverContext =
    input.heightResolverContext ?? buildRuntimeContext(heightState);

  const listPack = readRoofPansList(rawState, input.productStrictStatePansOnly === true);
  if (!listPack || listPack.pans.length === 0) {
    globalWarnings.push(
      input.productStrictStatePansOnly === true ? "NO_PANS_IN_STATE_STRICT_ROOT_PANS" : "NO_PANS_IN_STATE",
    );
    return {
      ok: false,
      pans: [],
      diagnostics: { totalPans: 0, validPans: 0, invalidPans: 0, warnings: globalWarnings },
    };
  }

  const upWorld = vec3(0, 0, 1);
  const outPans: CanonicalPan3D[] = [];
  let invalid = 0;

  const mutableBuilds: { panIndex: number; vertices: MutablePanVertexBuild[] }[] = [];
  const finalizeQueue: Array<{
    pan: Record<string, unknown>;
    poly: { x: number; y: number }[];
    panId: string;
    stableId: string;
    area2d: number;
    centroidPx: { x: number; y: number };
  }> = [];

  for (let i = 0; i < listPack.pans.length; i++) {
    const pan = listPack.pans[i];
    const polyH = readPanPolygon2DWithHeights(pan);
    const panId = pan.id != null ? String(pan.id) : `pan-${i}`;

    if (!polyH) {
      invalid++;
      globalWarnings.push(`PAN_SKIP_NO_POLYGON:${panId}`);
      continue;
    }

    const poly = polyH.map((p) => ({ x: p.x, y: p.y }));
    const stableId = computeStablePan3DId(panId, poly);
    const area2d = polygonArea2DPx(poly);
    const centroidPx = centroid2D(poly);

    const resolver: HeightResolverContext = {
      ...resolverBase,
      state: resolverBase.state ?? heightState ?? null,
    };

    const vertices: MutablePanVertexBuild[] = [];
    for (let vi = 0; vi < polyH.length; vi++) {
      const { x, y, h } = polyH[vi];
      const hz = resolvePanVertexZ({
        xPx: x,
        yPx: y,
        explicitPanVertexH: h,
        panId,
        context: resolver,
        options: { defaultHeightM },
      });
      const zResolved =
        hz.heightM !== undefined && Number.isFinite(hz.heightM) ? hz.heightM : defaultHeightM;
      const sourceUsed: HeightSource | string =
        hz.heightM !== undefined && Number.isFinite(hz.heightM)
          ? hz.source
          : "fallback_default";
      const confUsed =
        hz.heightM !== undefined && Number.isFinite(hz.heightM)
          ? hz.confidence
          : HEIGHT_SOURCE_CONFIDENCE.fallback_default;
      const xyW = imagePxToWorldHorizontalM(x, y, mpp, north);
      vertices.push({
        vertexId: `${stableId}:v${vi}`,
        xPx: x,
        yPx: y,
        xWorldM: xyW.x,
        yWorldM: xyW.y,
        zWorldM: zResolved,
        heightM: zResolved,
        source: sourceUsed,
        confidence: confUsed,
      });
    }

    const idx = mutableBuilds.length;
    mutableBuilds.push({ panIndex: idx, vertices });
    finalizeQueue.push({ pan, poly, panId, stableId, area2d, centroidPx });
  }

  if (mutableBuilds.length >= 2 && !skipSharedVertexUnify) {
    const u = unifySharedMutablePanVertices(mutableBuilds);
    globalWarnings.push(...u.warnings);
  }

  for (let bi = 0; bi < mutableBuilds.length; bi++) {
    const meta = finalizeQueue[bi];
    const panRow = finalizeCanonicalPan3DFromMutable(
      meta.pan,
      meta.poly,
      meta.panId,
      meta.stableId,
      meta.area2d,
      meta.centroidPx,
      mutableBuilds[bi].vertices,
      mpp,
      north,
      opt,
      upWorld,
    );
    if (panRow.diagnostics.isDegenerate) invalid++;
    if (!includeDegeneratePans && panRow.diagnostics.isDegenerate) continue;
    outPans.push(panRow);
  }

  globalWarnings.push(...auditStructuralLinesAgainstCanonicalPans(rawState, outPans));

  const validPans = outPans.filter((p) => !p.diagnostics.isDegenerate).length;
  const total = listPack.pans.length;

  return {
    ok: outPans.length > 0 && validPans > 0,
    pans: outPans,
    diagnostics: {
      totalPans: total,
      validPans,
      invalidPans: invalid,
      warnings: globalWarnings,
    },
  };
}
