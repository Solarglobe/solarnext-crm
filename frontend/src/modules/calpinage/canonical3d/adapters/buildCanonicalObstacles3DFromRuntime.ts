/**
 * Adaptateur officiel : obstacles / extensions / volumes ombrants runtime → géométrie 3D canonique.
 *
 * Sources runtime réelles (aligné sur `buildNearObstaclesFromState` + GeoEntity3D) :
 *   - CALPINAGE_STATE.obstacles
 *   - CALPINAGE_STATE.shadowVolumes
 *   - CALPINAGE_STATE.roofExtensions
 *
 * - Emprise 2D : `toFootprintPx` (geoEntity3D) — pas de duplication des règles rect/cercle/shadow_volume.
 * - Z base par sommet : `resolveHeightAtXY` (heightResolver), `panId` si `entity.panId`.
 * - Hauteur : traçable (explicite → catalogue → legacy), jamais silencieuse.
 * - Extrusion : prisme vertical monde (+Z) ; documenté dans les diagnostics (pas de mesh décoratif).
 *
 * Ne mutte pas le runtime, ne persiste pas, ne rend pas.
 */

import {
  computeCentroidPx,
  toFootprintPx,
  type Point2D,
} from "../../geometry/geoEntity3D";
import {
  getRoofObstacleCatalogEntry,
  LEGACY_2D_OBSTACLE_NEAR_SHADING_HEIGHT_M,
  LEGACY_SHADOW_VOLUME_DEFAULT_HEIGHT_M,
  type RoofObstacleBusinessId,
} from "../../catalog/roofObstacleCatalog";
import {
  isKeepoutNonShadingObstacle,
  readExplicitHeightM,
} from "../../catalog/roofObstacleRuntime";
import { imagePxToWorldHorizontalM } from "../builder/worldMapping";
import {
  buildRuntimeContext,
  resolveHeightAtXY,
  type HeightResolverContext,
} from "../../core/heightResolver";
import { extractHeightStateContextFromCalpinageState } from "./buildCanonicalPans3DFromRuntime";
import { sanePanHeightM } from "../../adapter/heightSanityFilter";

// ─── Typologie canonique (BLOC D) ───────────────────────────────────────────

export type CanonicalObstacleKind =
  | "CHIMNEY"
  | "VMC"
  | "ANTENNA"
  | "SKYLIGHT"
  | "DORMER"
  | "ROOF_EXTENSION"
  | "RECT_OBSTACLE"
  | "CIRCLE_OBSTACLE"
  | "FREE_POLYGON_OBSTACLE"
  | "SHADOW_VOLUME"
  | "UNKNOWN";

/** Rôle sémantique pour ne pas mélanger physique / extension / ombre abstraite (BLOC G). */
export type CanonicalObstacleSemanticRole =
  | "PHYSICAL_SHADING_BODY"
  | "PHYSICAL_KEEPOUT_ONLY"
  | "ROOF_EXTENSION_VOLUME"
  | "SHADOW_VOLUME_ABSTRACT";

export type CanonicalObstacleVertex3D = {
  readonly vertexId: string;
  readonly xPx: number;
  readonly yPx: number;
  readonly xWorldM: number;
  readonly yWorldM: number;
  readonly zWorldM: number;
};

export type CanonicalObstacle3DDiagnostics = {
  readonly zBaseSource: string[];
  readonly zTopSource: string[];
  readonly heightSource: string;
  readonly confidenceMin: number;
  readonly confidenceAvg: number;
  readonly isDegenerate: boolean;
  /** Prisme vertical monde (+Z) depuis emprise — pas reconstruction lucarne complète. */
  readonly isExtrudedFromRoof: boolean;
  readonly isDormerLike: boolean;
  readonly heightWasFallback: boolean;
  readonly baseZUnreliable: boolean;
  readonly warnings: string[];
};

export type CanonicalObstacle3D = {
  readonly obstacleId: string;
  readonly stableId: string;
  readonly kind: CanonicalObstacleKind;
  readonly sourceKind: string | null;
  readonly semanticRole: CanonicalObstacleSemanticRole;

  readonly polygon2D: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly baseVertices3D: readonly CanonicalObstacleVertex3D[];
  readonly topVertices3D: readonly CanonicalObstacleVertex3D[];

  readonly centroid2D: { readonly x: number; readonly y: number };
  readonly centroid3D: { readonly xWorldM: number; readonly yWorldM: number; readonly zWorldM: number };

  readonly baseZWorldM: number;
  readonly topZWorldM: number;
  readonly heightM: number;

  readonly footprintArea2DPx: number | null;
  readonly footprintAreaPlanM2: number | null;
  /** Aire latérale approximative (prisme vertical) + doubles emprises horizontales base/haut. */
  readonly envelopeArea3DM2: number | null;

  readonly relatedPanId: string | null;
  readonly roofKind: string | null;

  readonly diagnostics: CanonicalObstacle3DDiagnostics;
};

export type CanonicalObstacle3DResult = {
  readonly ok: boolean;
  readonly obstacles: readonly CanonicalObstacle3D[];
  readonly diagnostics: {
    readonly totalObstacles: number;
    readonly validObstacles: number;
    readonly invalidObstacles: number;
    readonly warnings: string[];
  };
};

// ─── Entrée ─────────────────────────────────────────────────────────────────

export interface BuildCanonicalObstacles3DFromRuntimeOptions {
  readonly includeDiagnostics?: boolean;
  readonly includeInvalidObstacles?: boolean;
  readonly defaultObstacleHeightM?: number;
  readonly defaultBaseHeightM?: number;
}

export interface BuildCanonicalObstacles3DFromRuntimeInput {
  readonly state?: unknown;
  readonly getState?: () => unknown | null;
  readonly metersPerPixel?: number;
  readonly northAngleDeg?: number;
  readonly heightResolverContext?: HeightResolverContext;
  readonly options?: BuildCanonicalObstacles3DFromRuntimeOptions;
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

export function computeStableObstacle3DId(
  obstacleId: string,
  kind: CanonicalObstacleKind,
  semanticRole: CanonicalObstacleSemanticRole,
  points2D: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): string {
  const body = points2D
    .map((p) => `${Math.round(p.x * 1000) / 1000},${Math.round(p.y * 1000) / 1000}`)
    .join("|");
  return `obs3d-${fnv1a32Hex(`${kind}|${semanticRole}|${obstacleId}::${body}`)}`;
}

function stripClosingDuplicateOpenRing(pts: Point2D[]): Point2D[] {
  if (pts.length < 2) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (Math.hypot((b?.x ?? 0) - (a?.x ?? 0), (b?.y ?? 0) - (a?.y ?? 0)) < 1e-9) {
    return pts.slice(0, -1);
  }
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

function polygonProjectedHorizontalAreaXYFromVerts(
  verts: readonly CanonicalObstacleVertex3D[],
): number {
  if (verts.length < 3) return 0;
  let s = 0;
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += verts[i].xWorldM * verts[j].yWorldM - verts[j].xWorldM * verts[i].yWorldM;
  }
  return Math.abs(s) * 0.5;
}

function lateralAreaVerticalPrismM2(
  base: readonly CanonicalObstacleVertex3D[],
  heightM: number,
): number {
  if (base.length < 2 || heightM <= 0) return 0;
  let sum = 0;
  const n = base.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = base[j].xWorldM - base[i].xWorldM;
    const dy = base[j].yWorldM - base[i].yWorldM;
    sum += Math.hypot(dx, dy) * heightM;
  }
  return sum;
}

function readBusinessObstacleId(o: Record<string, unknown>): string | null {
  const m = o.meta as Record<string, unknown> | undefined;
  if (m && typeof m.businessObstacleId === "string") return m.businessObstacleId;
  if (typeof o.businessObstacleId === "string") return o.businessObstacleId;
  return null;
}

function mapBusinessIdToKind(id: string | null): CanonicalObstacleKind | null {
  if (!id) return null;
  const map: Partial<Record<RoofObstacleBusinessId, CanonicalObstacleKind>> = {
    chimney_square: "CHIMNEY",
    chimney_round: "CHIMNEY",
    vmc_round: "VMC",
    roof_window: "SKYLIGHT",
    dormer_keepout: "DORMER",
    keepout_zone: "FREE_POLYGON_OBSTACLE",
    generic_polygon_keepout: "FREE_POLYGON_OBSTACLE",
    legacy_shadow_cube: "SHADOW_VOLUME",
    legacy_shadow_tube: "SHADOW_VOLUME",
    antenna: "ANTENNA",
  };
  return map[id as RoofObstacleBusinessId] ?? null;
}

function inferKindFromRuntimeShape(o: Record<string, unknown>): CanonicalObstacleKind {
  const t = o.type;
  if (t === "shadow_volume") return "SHADOW_VOLUME";
  if (t === "roof_extension") return "ROOF_EXTENSION";
  if (t === "rect") return "RECT_OBSTACLE";
  if (t === "circle") return "CIRCLE_OBSTACLE";
  if (t === "polygon") return "FREE_POLYGON_OBSTACLE";
  return "UNKNOWN";
}

function resolveCanonicalKind(
  o: Record<string, unknown>,
  businessId: string | null,
): { kind: CanonicalObstacleKind; ambiguous: boolean } {
  const fromBiz = mapBusinessIdToKind(businessId);
  const fromShape = inferKindFromRuntimeShape(o);
  if (fromBiz) {
    const ambiguous =
      fromBiz !== fromShape &&
      fromShape !== "UNKNOWN" &&
      !(fromBiz === "SHADOW_VOLUME" && fromShape === "SHADOW_VOLUME");
    return { kind: fromBiz, ambiguous };
  }
  return { kind: fromShape, ambiguous: false };
}

function resolveSemanticRole(
  o: Record<string, unknown>,
  listKind: "obstacles" | "shadowVolumes" | "roofExtensions",
  kind: CanonicalObstacleKind,
  businessId: string | null,
): CanonicalObstacleSemanticRole {
  if (listKind === "shadowVolumes") {
    const legacyAbstract = businessId === "legacy_shadow_cube" || businessId === "legacy_shadow_tube" || kind === "SHADOW_VOLUME";
    return legacyAbstract ? "SHADOW_VOLUME_ABSTRACT" : "PHYSICAL_SHADING_BODY";
  }
  if (listKind === "roofExtensions") return "ROOF_EXTENSION_VOLUME";
  if (isKeepoutNonShadingObstacle(o)) return "PHYSICAL_KEEPOUT_ONLY";
  if (kind === "DORMER") return "PHYSICAL_SHADING_BODY";
  return "PHYSICAL_SHADING_BODY";
}

interface ResolvedHeight {
  readonly heightM: number;
  readonly source: string;
  readonly confidence: number;
  readonly wasFallback: boolean;
}

function resolveObstacleHeightDetailed(
  o: Record<string, unknown>,
  listKind: "obstacles" | "shadowVolumes" | "roofExtensions",
  defaultObstacleHeightM: number,
): ResolvedHeight {
  const explicit = readExplicitHeightM(o);
  if (explicit !== null && explicit > 0) {
    return { heightM: explicit, source: "explicit_runtime", confidence: 0.95, wasFallback: false };
  }
  if (explicit !== null && explicit === 0 && isKeepoutNonShadingObstacle(o)) {
    return { heightM: 0, source: "keepout_zero_height", confidence: 0.9, wasFallback: false };
  }

  const bid = readBusinessObstacleId(o);
  const entry = getRoofObstacleCatalogEntry(bid);

  if (listKind === "shadowVolumes") {
    const dh =
      entry && entry.isShadingObstacle && typeof entry.defaultHeightM === "number"
        ? entry.defaultHeightM
        : LEGACY_SHADOW_VOLUME_DEFAULT_HEIGHT_M;
    return {
      heightM: dh,
      source: bid ? "shadow_volume_catalog_default" : "shadow_volume_legacy_default",
      confidence: bid ? 0.82 : 0.55,
      wasFallback: !readExplicitHeightM(o),
    };
  }

  if (listKind === "roofExtensions") {
    const rh = o.ridgeHeightRelM;
    if (typeof rh === "number" && Number.isFinite(rh) && rh > 0) {
      return { heightM: rh, source: "ridgeHeightRelM", confidence: 0.88, wasFallback: false };
    }
    if (defaultObstacleHeightM > 0) {
      return {
        heightM: defaultObstacleHeightM,
        source: "fallback_defaultObstacleHeightM",
        confidence: 0.28,
        wasFallback: true,
      };
    }
    return { heightM: 0, source: "roof_extension_no_height", confidence: 0.15, wasFallback: true };
  }

  if (listKind === "obstacles") {
    if (entry && entry.isShadingObstacle && typeof entry.defaultHeightM === "number") {
      return {
        heightM: entry.defaultHeightM,
        source: `catalog_default:${entry.id}`,
        confidence: 0.85,
        wasFallback: false,
      };
    }
    if (entry && !entry.isShadingObstacle) {
      return { heightM: 0, source: `keepout_catalog:${entry.id}`, confidence: 0.9, wasFallback: false };
    }
    return {
      heightM: LEGACY_2D_OBSTACLE_NEAR_SHADING_HEIGHT_M,
      source: "legacy_near_shading_1m_default",
      confidence: 0.42,
      wasFallback: true,
    };
  }

  return {
    heightM: defaultObstacleHeightM > 0 ? defaultObstacleHeightM : LEGACY_2D_OBSTACLE_NEAR_SHADING_HEIGHT_M,
    source: "fallback_generic",
    confidence: 0.25,
    wasFallback: true,
  };
}

function readMppNorth(
  state: unknown,
  mppO?: number,
  northO?: number,
): { mpp: number; north: number } | null {
  if (typeof mppO === "number" && Number.isFinite(mppO) && mppO > 0) {
    return { mpp: mppO, north: typeof northO === "number" && Number.isFinite(northO) ? northO : 0 };
  }
  if (!state || typeof state !== "object") return null;
  const roof = (state as Record<string, unknown>).roof;
  if (!roof || typeof roof !== "object") return null;
  const r = roof as Record<string, unknown>;
  const mpp = (r.scale as { metersPerPixel?: number } | undefined)?.metersPerPixel;
  if (typeof mpp !== "number" || !Number.isFinite(mpp) || mpp <= 0) return null;
  const rb = r.roof as { north?: { angleDeg?: number } } | undefined;
  const north =
    typeof northO === "number" && Number.isFinite(northO)
      ? northO
      : typeof rb?.north?.angleDeg === "number"
        ? rb.north.angleDeg
        : 0;
  return { mpp, north };
}

type RuntimeListKind = "obstacles" | "shadowVolumes" | "roofExtensions";

function collectRawEntities(
  state: unknown,
  _mpp: number,
): Array<{ raw: Record<string, unknown>; listKind: RuntimeListKind; index: number }> {
  if (!state || typeof state !== "object") return [];
  const s = state as Record<string, unknown>;
  const out: Array<{ raw: Record<string, unknown>; listKind: RuntimeListKind; index: number }> = [];

  const obs = Array.isArray(s.obstacles) ? s.obstacles : [];
  obs.forEach((raw, index) => {
    if (raw && typeof raw === "object") out.push({ raw: raw as Record<string, unknown>, listKind: "obstacles", index });
  });

  const sv = Array.isArray(s.shadowVolumes) ? s.shadowVolumes : [];
  sv.forEach((raw, index) => {
    if (raw && typeof raw === "object") {
      out.push({ raw: raw as Record<string, unknown>, listKind: "shadowVolumes", index });
    }
  });

  const rx = Array.isArray(s.roofExtensions) ? s.roofExtensions : [];
  rx.forEach((raw, index) => {
    if (raw && typeof raw === "object") out.push({ raw: raw as Record<string, unknown>, listKind: "roofExtensions", index });
  });

  return out;
}

/**
 * Transforme obstacles, shadowVolumes et roofExtensions en fiches 3D canoniques.
 */
export function buildCanonicalObstacles3DFromRuntime(
  input: BuildCanonicalObstacles3DFromRuntimeInput,
): CanonicalObstacle3DResult {
  const opt = input.options ?? {};
  const defaultObstacleHeightM = opt.defaultObstacleHeightM ?? 1;
  const defaultBaseFallback = opt.defaultBaseHeightM ?? 0;
  const includeInvalid = opt.includeInvalidObstacles !== false;

  const rawState = input.state ?? (typeof input.getState === "function" ? input.getState() : null);
  const globalWarnings: string[] = [];

  const meta = readMppNorth(rawState, input.metersPerPixel, input.northAngleDeg);
  if (!meta) {
    globalWarnings.push("INVALID_OR_MISSING_METERS_PER_PIXEL");
    return {
      ok: false,
      obstacles: [],
      diagnostics: { totalObstacles: 0, validObstacles: 0, invalidObstacles: 0, warnings: globalWarnings },
    };
  }

  const { mpp, north } = meta;
  const heightState = extractHeightStateContextFromCalpinageState(rawState);
  const resolverBase: HeightResolverContext =
    input.heightResolverContext ?? buildRuntimeContext(heightState);

  const rawEntries = collectRawEntities(rawState, mpp);
  const out: CanonicalObstacle3D[] = [];
  let invalid = 0;

  for (let i = 0; i < rawEntries.length; i++) {
    const { raw, listKind, index } = rawEntries[i];
    const footprintFull =
      listKind === "shadowVolumes"
        ? toFootprintPx({ ...raw, metersPerPixel: mpp })
        : toFootprintPx(raw);
    if (!footprintFull || footprintFull.length < 3) {
      invalid++;
      globalWarnings.push(`SKIP_NO_FOOTPRINT:${listKind}:${index}`);
      continue;
    }

    const openRing = stripClosingDuplicateOpenRing(footprintFull);
    if (openRing.length < 3) {
      invalid++;
      globalWarnings.push(`SKIP_DEGENERATE_RING:${listKind}:${index}`);
      continue;
    }

    const obstacleId =
      raw.id != null ? String(raw.id) : `${listKind}-${index}`;

    const businessId = readBusinessObstacleId(raw);
    const { kind: kindResolved, ambiguous } = resolveCanonicalKind(raw, businessId);
    const semantic = resolveSemanticRole(raw, listKind, kindResolved, businessId);
    const kind: CanonicalObstacleKind = kindResolved;

    const heightR = resolveObstacleHeightDetailed(raw, listKind, defaultObstacleHeightM);
    const heightM = heightR.heightM;

    const relatedPanIdFromEntity =
      typeof raw.panId === "string" ? raw.panId : raw.panId != null ? String(raw.panId) : null;

    let resolvedRelatedPanId = relatedPanIdFromEntity;
    let panIdForZ = relatedPanIdFromEntity ?? undefined;
    const parentPanNotes: string[] = [];

    const centroid2D = computeCentroidPx(openRing);
    if (!panIdForZ && typeof resolverBase.hitTestPan === "function") {
      try {
        const hit = resolverBase.hitTestPan({ x: centroid2D.x, y: centroid2D.y });
        if (hit?.id) {
          panIdForZ = hit.id;
          resolvedRelatedPanId = hit.id;
          parentPanNotes.push("OBSTACLE_PARENT_PAN_HITTEST_RESOLVED");
          if (listKind === "roofExtensions") {
            parentPanNotes.push("ROOF_EXTENSION_BASE_RESOLVED_FROM_PARENT_PAN");
          }
        } else {
          parentPanNotes.push("OBSTACLE_PARENT_PAN_UNRESOLVED");
        }
      } catch {
        parentPanNotes.push("OBSTACLE_PARENT_PAN_HITTEST_FAILED");
      }
    } else if (!panIdForZ) {
      parentPanNotes.push("OBSTACLE_PARENT_PAN_UNRESOLVED");
    }

    const resolver: HeightResolverContext = {
      ...resolverBase,
      state: resolverBase.state ?? heightState ?? null,
    };

    const baseVertices3D: CanonicalObstacleVertex3D[] = [];
    const zBaseSources: string[] = [];
    let confMin = 1;
    let confSum = 0;
    let nV = 0;

    for (let vi = 0; vi < openRing.length; vi++) {
      const p = openRing[vi];
      const x = typeof p.x === "number" ? p.x : 0;
      const y = typeof p.y === "number" ? p.y : 0;
      const hz = resolveHeightAtXY(x, y, resolver, {
        panId: panIdForZ,
        defaultHeightM: defaultBaseFallback,
      });
      // sanePanHeightM filtre les valeurs aberrantes de fitPlaneWorldENU
      // (même bug que pour les patches/panneaux : valeurs ~47m ou ~-320m au lieu de 4-7m).
      const zBaseRaw =
        hz.heightM !== undefined && Number.isFinite(hz.heightM) ? hz.heightM : defaultBaseFallback;
      const zBase = sanePanHeightM(zBaseRaw, rawState, panIdForZ ?? null, defaultBaseFallback);
      zBaseSources.push(hz.source);
      confMin = Math.min(confMin, hz.confidence);
      confSum += hz.confidence;
      nV++;
      const xyW = imagePxToWorldHorizontalM(x, y, mpp, north);
      baseVertices3D.push({
        vertexId: `${obstacleId}:b${vi}`,
        xPx: x,
        yPx: y,
        xWorldM: xyW.x,
        yWorldM: xyW.y,
        zWorldM: zBase,
      });
    }

    const confidenceAvgBase = nV > 0 ? confSum / nV : 0;
    const baseZWorldM =
      baseVertices3D.reduce((s, v) => s + v.zWorldM, 0) / Math.max(1, baseVertices3D.length);

    const topVertices3D: CanonicalObstacleVertex3D[] = baseVertices3D.map((b, vi) => ({
      vertexId: `${obstacleId}:t${vi}`,
      xPx: b.xPx,
      yPx: b.yPx,
      xWorldM: b.xWorldM,
      yWorldM: b.yWorldM,
      zWorldM: b.zWorldM + heightM,
    }));

    const topZWorldM =
      topVertices3D.reduce((s, v) => s + v.zWorldM, 0) / Math.max(1, topVertices3D.length);

    const footprintArea2DPx = polygonArea2DPx(openRing);
    const planM2 = polygonProjectedHorizontalAreaXYFromVerts(baseVertices3D);
    const lateral = lateralAreaVerticalPrismM2(baseVertices3D, heightM);
    const envelopeArea3DM2 = heightM > 0 ? lateral + 2 * planM2 : planM2;

    const cxW = imagePxToWorldHorizontalM(centroid2D.x, centroid2D.y, mpp, north);
    const czBase = resolveHeightAtXY(centroid2D.x, centroid2D.y, resolver, {
      panId: panIdForZ,
      defaultHeightM: defaultBaseFallback,
    });
    const czRaw =
      czBase.heightM !== undefined && Number.isFinite(czBase.heightM)
        ? czBase.heightM
        : defaultBaseFallback;
    // Même filtre sanePanHeightM que pour les vertices (valeurs aberrantes fitPlaneWorldENU).
    const czNum = sanePanHeightM(czRaw, rawState, panIdForZ ?? null, defaultBaseFallback);
    const centroid3D = {
      xWorldM: cxW.x,
      yWorldM: cxW.y,
      zWorldM: czNum + heightM * 0.5,
    };

    const uniqueBaseZ = new Set(zBaseSources);
    const baseZUnreliable = confidenceAvgBase < 0.35 || [...uniqueBaseZ].some((s) => s.startsWith("fallback"));

    const isDormerLike =
      listKind === "roofExtensions" &&
      (raw.kind === "dormer" || raw.type === "roof_extension");

    const isDegenerate = footprintArea2DPx < 1e-9 || openRing.length < 3;

    const warnings: string[] = [...parentPanNotes];
    if (ambiguous) warnings.push("KIND_MAPPING_AMBIGUOUS");
    if (heightR.wasFallback) warnings.push("HEIGHT_FALLBACK_OR_LEGACY_DEFAULT");
    if (baseZUnreliable) {
      warnings.push("BASE_Z_LOW_CONFIDENCE");
      warnings.push("OBSTACLE_BASE_Z_FALLBACK");
    }
    if (heightM > 0) warnings.push("OBSTACLE_TOP_Z_DERIVED");
    if (isDormerLike && raw.stage === "COMPLETE" && raw.hips && raw.ridge) {
      warnings.push("DORMER_SIMPLIFIED_TO_VERTICAL_PRISM_FROM_FOOTPRINT");
    }
    if (semantic === "PHYSICAL_KEEPOUT_ONLY" && heightM <= 0) {
      warnings.push("KEEPOUT_ZERO_EXTRUSION");
    }
    if (semantic === "SHADOW_VOLUME_ABSTRACT") {
      warnings.push("ABSTRACT_SHADOW_VOLUME_NOT_PHYSICAL_ROOF_BODY");
    }
    if (listKind === "roofExtensions") {
      warnings.push("ROOF_EXTENSION_SIMPLIFIED_3D");
      if (heightR.wasFallback) warnings.push("ROOF_EXTENSION_HEIGHT_FALLBACK");
      if (parentPanNotes.includes("OBSTACLE_PARENT_PAN_UNRESOLVED")) {
        warnings.push("ROOF_EXTENSION_PARENT_SUPPORT_UNRESOLVED");
      }
    }

    const zSourceSummary =
      opt.includeDiagnostics === false ? [] : [...uniqueBaseZ].sort();

    const confCombined = Math.min(confidenceAvgBase, heightR.confidence);

    const stableId = computeStableObstacle3DId(obstacleId, kind, semantic, openRing);

    const row: CanonicalObstacle3D = {
      obstacleId,
      stableId,
      kind,
      sourceKind:
        typeof raw.kind === "string"
          ? raw.kind
          : typeof raw.type === "string"
            ? raw.type
            : null,
      semanticRole: semantic,
      polygon2D: openRing.map((p) => ({ x: p.x, y: p.y })),
      baseVertices3D,
      topVertices3D,
      centroid2D,
      centroid3D,
      baseZWorldM,
      topZWorldM,
      heightM,
      footprintArea2DPx: footprintArea2DPx > 0 ? footprintArea2DPx : null,
      footprintAreaPlanM2: planM2 > 0 ? planM2 : null,
      envelopeArea3DM2: envelopeArea3DM2 > 0 ? envelopeArea3DM2 : null,
      relatedPanId: resolvedRelatedPanId,
      roofKind: null,
      diagnostics: {
        zBaseSource: zSourceSummary,
        zTopSource: heightM > 0 ? zBaseSources.map(() => "vertical_offset_heightM") : [],
        heightSource: heightR.source,
        confidenceMin: Math.min(confMin, heightR.confidence),
        confidenceAvg: (confidenceAvgBase + heightR.confidence) * 0.5,
        isDegenerate,
        isExtrudedFromRoof: true,
        isDormerLike,
        heightWasFallback: heightR.wasFallback,
        baseZUnreliable,
        warnings,
      },
    };

    if (isDegenerate) invalid++;
    if (!includeInvalid && isDegenerate) continue;
    out.push(row);
  }

  const validObstacles = out.filter((o) => !o.diagnostics.isDegenerate).length;
  const totalObstacles = rawEntries.length;

  return {
    ok: out.length > 0 && validObstacles > 0,
    obstacles: out,
    diagnostics: {
      totalObstacles,
      validObstacles,
      invalidObstacles: invalid,
      warnings: globalWarnings,
    },
  };
}
