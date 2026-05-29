import type { RoofExtensionKind } from "../types/extension";
import {
  intersectInfiniteLines2D,
  pointsCoincidePx,
  quantizeRoofExtensionImagePxCoord,
  stableApexId,
  type RoofExtensionApexPersisted,
} from "../../runtime/roofExtensionApex";

export interface RoofExtensionSourcePoint2D {
  readonly x: number;
  readonly y: number;
  /** Hauteur relative au pan support, en metres. `null` signifie valeur absente. */
  readonly heightRelM: number | null;
}

export interface RoofExtensionSourceSegment2D {
  readonly a: RoofExtensionSourcePoint2D;
  readonly b: RoofExtensionSourcePoint2D;
}

export interface RoofExtensionSourceHips2D {
  readonly left?: RoofExtensionSourceSegment2D;
  readonly right?: RoofExtensionSourceSegment2D;
}

export interface RoofExtensionSource2D {
  readonly id: string;
  readonly kind: RoofExtensionKind;
  readonly sourceIndex: number;
  readonly stage: string | null;
  readonly visualModel: string | null;
  readonly supportPanId: string | null;
  readonly contour: readonly RoofExtensionSourcePoint2D[];
  readonly ridge: RoofExtensionSourceSegment2D | null;
  readonly hips: RoofExtensionSourceHips2D | null;
  /** Sommet partagé hips → faîtage ; même vérité que fins des arêtiers si géométrie cohérente */
  readonly apexVertex: RoofExtensionApexPersisted | null;
  readonly ridgeHeightRelM: number | null;
  readonly wallHeightM: number | null;
  readonly hadLegacyCanonicalDormerGeometry: boolean;
  /** Referentiel de hauteur : null = inconnu (suppose support_plane_normal). */
  readonly heightReference: "support_plane_normal" | "vertical_from_main_roof" | null;
  readonly warnings: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const n = finiteNumber(value);
  return n != null && n >= 0 ? n : null;
}

function readHeightRelM(raw: Record<string, unknown>): number | null {
  return (
    nonNegativeNumber(raw.h) ??
    nonNegativeNumber(raw.heightRelM) ??
    nonNegativeNumber(raw.heightM) ??
    null
  );
}

function readPoint(raw: unknown): RoofExtensionSourcePoint2D | null {
  if (!isRecord(raw)) return null;
  const x = finiteNumber(raw.x);
  const y = finiteNumber(raw.y);
  if (x == null || y == null) return null;
  return { x, y, heightRelM: readHeightRelM(raw) };
}

function readSegment(raw: unknown): RoofExtensionSourceSegment2D | null {
  if (!isRecord(raw)) return null;
  const a = readPoint(raw.a);
  const b = readPoint(raw.b);
  if (!a || !b) return null;
  if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-9) return null;
  return { a, b };
}

function stripClosingDuplicate(
  points: readonly RoofExtensionSourcePoint2D[],
): readonly RoofExtensionSourcePoint2D[] {
  if (points.length < 2) return points;
  const a = points[0]!;
  const b = points[points.length - 1]!;
  if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-9) return points.slice(0, -1);
  return points;
}

function readContour(raw: Record<string, unknown>): readonly RoofExtensionSourcePoint2D[] {
  const contour = raw.contour;
  const points = isRecord(contour) && Array.isArray(contour.points) ? contour.points : null;
  if (!points) return [];
  return stripClosingDuplicate(points.flatMap((p) => {
    const point = readPoint(p);
    return point ? [point] : [];
  }));
}

function readCanonicalV1(raw: Record<string, unknown>): Record<string, unknown> | null {
  const canonical = raw.canonicalV1;
  if (!isRecord(canonical)) return null;
  return canonical.version === "roof_extension_v1" ? canonical : null;
}

function readCanonicalContour(raw: Record<string, unknown>): readonly RoofExtensionSourcePoint2D[] {
  const canonical = readCanonicalV1(raw);
  const points = canonical && Array.isArray(canonical.footprintPx) ? canonical.footprintPx : null;
  if (!points) return [];
  return stripClosingDuplicate(points.flatMap((p) => {
    const point = readPoint(p);
    return point ? [point] : [];
  }));
}

function readRidge(raw: Record<string, unknown>): RoofExtensionSourceSegment2D | null {
  const canonical = readCanonicalV1(raw);
  const canonicalRidge = canonical ? readSegment(canonical.ridgePx) : null;
  if (canonicalRidge) return canonicalRidge;
  const direct = readSegment(raw.ridge);
  if (direct) return direct;
  const model = raw.dormerModel;
  if (isRecord(model)) {
    const modelRidge = readSegment(model.ridge);
    if (modelRidge) return modelRidge;
  }
  return null;
}

function readHips(raw: Record<string, unknown>): RoofExtensionSourceHips2D | null {
  const hips = raw.hips;
  const canonical = readCanonicalV1(raw);
  const src = canonical && isRecord(canonical.hipsPx) ? canonical.hipsPx : isRecord(hips) ? hips : null;
  if (!src) return null;
  const left = readSegment(src.left);
  const right = readSegment(src.right);
  if (!left && !right) return null;
  return {
    ...(left ? { left } : {}),
    ...(right ? { right } : {}),
  };
}

function readKind(raw: Record<string, unknown>): RoofExtensionKind {
  const kind = typeof raw.kind === "string" ? raw.kind.toLowerCase() : "";
  const dormerType = typeof raw.dormerType === "string" ? raw.dormerType.toLowerCase() : "";
  const canonical = readCanonicalV1(raw);
  const canonicalKind = canonical && typeof canonical.kind === "string" ? canonical.kind.toLowerCase() : "";
  if (canonicalKind.includes("chien")) return "dormer"; // F24: chien_assis unified into dormer
  if (canonicalKind.includes("shed")) return "shed";
  if (canonicalKind.includes("flat")) return "flat_extension";
  if (canonicalKind.includes("dormer")) return "dormer";
  if (kind.includes("chien") || dormerType.includes("chien")) return "dormer"; // F24
  if (kind.includes("dormer") || dormerType.includes("gable")) return "dormer";
  if (kind.includes("shed") || dormerType.includes("shed")) return "shed";
  if (kind.includes("flat")) return "flat_extension";
  return "dormer";
}

function hasLegacyCanonicalDormerGeometry(raw: Record<string, unknown>): boolean {
  const geom = raw.canonicalDormerGeometry;
  if (!isRecord(geom)) return false;
  return Array.isArray(geom.vertices) || Array.isArray(geom.faces);
}

function readSupportPanId(raw: Record<string, unknown>): string | null {
  const canonical = readCanonicalV1(raw);
  const canonicalSupportPanId = canonical?.supportPanId;
  if (typeof canonicalSupportPanId === "string" && canonicalSupportPanId.length > 0) return canonicalSupportPanId;
  const panId = raw.panId ?? raw.supportPanId ?? raw.parentPanId;
  if (typeof panId === "string" && panId.length > 0) return panId;
  return null;
}

function readPersistedApexVertex(raw: Record<string, unknown>, extensionId: string): RoofExtensionApexPersisted | null {
  const canonical = readCanonicalV1(raw);
  const av = isRecord(raw.apexVertex) ? raw.apexVertex : canonical?.apexPx;
  if (!isRecord(av)) return null;
  const canonicalApexId = canonical?.apexId;
  const vid =
    typeof av.id === "string" && av.id.length > 0
      ? av.id
      : typeof canonicalApexId === "string" && canonicalApexId.length > 0
        ? canonicalApexId
        : stableApexId(extensionId);
  const x = finiteNumber(av.x);
  const y = finiteNumber(av.y);
  if (x == null || y == null) return null;
  const h = finiteNumber(av.h);
  return {
    id: vid,
    x: quantizeRoofExtensionImagePxCoord(x),
    y: quantizeRoofExtensionImagePxCoord(y),
    ...(h != null && h >= 0 ? { h } : {}),
  };
}

function readLegacyRidgeOriginPx(raw: Record<string, unknown>): { readonly x: number; readonly y: number } | null {
  const ro = raw.ridgeOrigin;
  if (!isRecord(ro)) return null;
  const x = finiteNumber(ro.x);
  const y = finiteNumber(ro.y);
  if (x == null || y == null) return null;
  return { x, y };
}

function deriveApexFromHipsSegments(
  extensionId: string,
  hips: RoofExtensionSourceHips2D,
  ridgeHeightRelM: number | null,
): RoofExtensionApexPersisted | null {
  const left = hips.left;
  const right = hips.right;
  if (!left?.a || !left.b || !right?.a || !right.b) return null;
  const ix = intersectInfiniteLines2D(
    left.a.x,
    left.a.y,
    left.b.x,
    left.b.y,
    right.a.x,
    right.a.y,
    right.b.x,
    right.b.y,
  );
  if (!ix) return null;
  const out: RoofExtensionApexPersisted = {
    id: stableApexId(extensionId),
    x: quantizeRoofExtensionImagePxCoord(ix.x),
    y: quantizeRoofExtensionImagePxCoord(ix.y),
  };
  if (ridgeHeightRelM != null) return { ...out, h: ridgeHeightRelM };
  return out;
}

function resolveApexVertex(
  raw: Record<string, unknown>,
  extensionId: string,
  hips: RoofExtensionSourceHips2D | null,
  ridgeHeightRelM: number | null,
): RoofExtensionApexPersisted | null {
  const persisted = readPersistedApexVertex(raw, extensionId);
  if (persisted) return persisted;
  if (hips) {
    const derived = deriveApexFromHipsSegments(extensionId, hips, ridgeHeightRelM);
    if (derived) return derived;
  }
  const legacyRo = readLegacyRidgeOriginPx(raw);
  if (legacyRo) {
    const out: RoofExtensionApexPersisted = {
      id: stableApexId(extensionId),
      x: quantizeRoofExtensionImagePxCoord(legacyRo.x),
      y: quantizeRoofExtensionImagePxCoord(legacyRo.y),
    };
    if (ridgeHeightRelM != null) return { ...out, h: ridgeHeightRelM };
    return out;
  }
  return null;
}

/** True si le point image est le sommet apex (pour fusion projection faîtage). */
export function ridgeEndpointSharesApexVertex(
  px: RoofExtensionSourcePoint2D,
  apex: RoofExtensionApexPersisted,
  tolerancePx?: number,
): boolean {
  return pointsCoincidePx(px.x, px.y, apex.x, apex.y, tolerancePx);
}


/**
 * Dimensions d'une extension de toiture lues depuis canonicalV1.dimensions.
 * UNITE : metres mesures selon la normale sortante du pan support (support_plane_normal),
 * PAS en hauteur verticale absolue. Pour un pan incline a 30 deg, totalHeightM=1m signifie
 * 1m le long de la normale, soit environ 0.87m de hauteur verticale.
 * Seuil realiste pour un chien assis : totalHeightM <= 4.0m.
 */
interface RoofExtensionDimensionsV1 {
  readonly totalHeightM?: number;
  readonly wallHeightM?: number;
  [key: string]: unknown;
}

/** Hauteur maximale realiste pour un chien assis (m selon la normale au pan). Au-dela : valeur suspecte. */
const ROOF_EXTENSION_MAX_REALISTIC_DORMER_HEIGHT_M = 4.0;


function readHeightReference(raw: Record<string, unknown>): "support_plane_normal" | "vertical_from_main_roof" | null {
  const canonical = readCanonicalV1(raw);
  const fromDimensions = canonical && isRecord(canonical.dimensions)
    ? (canonical.dimensions as Record<string, unknown>).heightReference
    : null;
  const fromLegacyGeom = isRecord(raw.canonicalDormerGeometry)
    ? (raw.canonicalDormerGeometry as Record<string, unknown>).heightReference
    : null;
  const ref = fromDimensions ?? fromLegacyGeom ?? raw.heightReference;
  if (ref === "vertical_from_main_roof") return "vertical_from_main_roof";
  if (ref === "support_plane_normal") return "support_plane_normal";
  return null;
}

function readSource(raw: Record<string, unknown>, index: number): RoofExtensionSource2D {
  const id = raw.id != null ? String(raw.id) : `roof-extension-${index}`;
  const canonical = readCanonicalV1(raw);
  const canonicalContour = readCanonicalContour(raw);
  const contour = readContour(raw);
  const effectiveContour = canonicalContour.length >= 3 ? canonicalContour : contour;
  const ridge = readRidge(raw);
  const hips = readHips(raw);
  const dimensions = canonical && isRecord(canonical.dimensions) ? canonical.dimensions : null;
  const rawTotalHeightM = nonNegativeNumber((dimensions as RoofExtensionDimensionsV1 | null)?.totalHeightM);
  const totalHeightSuspicious =
    rawTotalHeightM != null && rawTotalHeightM > ROOF_EXTENSION_MAX_REALISTIC_DORMER_HEIGHT_M;
  const effectiveTotalHeightM = totalHeightSuspicious ? null : rawTotalHeightM;
  const ridgeHeightRelM = effectiveTotalHeightM ?? nonNegativeNumber(raw.ridgeHeightRelM);
  const heightReference = readHeightReference(raw);
  const apexVertex = resolveApexVertex(raw, id, hips, ridgeHeightRelM);
  const warnings: string[] = [];
  if (totalHeightSuspicious) {
    warnings.push(
      `ROOF_EXTENSION_TOTAL_HEIGHT_SUSPICIOUS: totalHeightM=${rawTotalHeightM} > ${ROOF_EXTENSION_MAX_REALISTIC_DORMER_HEIGHT_M}m -- fallback sur raw.ridgeHeightRelM`,
    );
  }
  if (effectiveContour.length < 3) warnings.push("ROOF_EXTENSION_CONTOUR_INVALID");
  if (canonicalContour.length >= 3) warnings.push("ROOF_EXTENSION_SOURCE_FROM_CANONICAL_V1");
  if (!ridge) warnings.push("ROOF_EXTENSION_RIDGE_MISSING");
  if (hasLegacyCanonicalDormerGeometry(raw)) warnings.push("LEGACY_CANONICAL_DORMER_GEOMETRY_IGNORED");
  if (hips?.left?.b && hips.right?.b && apexVertex && ridge) {
    const la = hips.left.b;
    const ra = hips.right.b;
    if (
      !pointsCoincidePx(la.x, la.y, apexVertex.x, apexVertex.y) ||
      !pointsCoincidePx(ra.x, ra.y, apexVertex.x, apexVertex.y)
    ) {
      warnings.push("ROOF_EXTENSION_APEX_HIP_MISMATCH");
    }
    const hitsRidge =
      ridgeEndpointSharesApexVertex(ridge.a, apexVertex) || ridgeEndpointSharesApexVertex(ridge.b, apexVertex);
    if (!hitsRidge) warnings.push("ROOF_EXTENSION_APEX_RIDGE_MISMATCH");
  }

  return {
    id,
    kind: readKind(raw),
    sourceIndex: index,
    stage: typeof raw.stage === "string" ? raw.stage : null,
    visualModel: typeof raw.visualModel === "string" ? raw.visualModel : null,
    supportPanId: readSupportPanId(raw),
    contour: effectiveContour,
    ridge,
    hips,
    apexVertex,
    ridgeHeightRelM,
    wallHeightM: nonNegativeNumber(dimensions?.wallHeightM) ?? nonNegativeNumber(raw.wallHeightM),
    hadLegacyCanonicalDormerGeometry: hasLegacyCanonicalDormerGeometry(raw),
    heightReference,
    warnings,
  };
}

export function readRuntimeRoofExtensionSources(state: unknown): readonly RoofExtensionSource2D[] {
  if (!isRecord(state) || !Array.isArray(state.roofExtensions)) return [];
  return state.roofExtensions.flatMap((raw, index) => {
    if (!isRecord(raw)) return [];
    return [readSource(raw, index)];
  });
}
