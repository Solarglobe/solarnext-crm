import type { RoofExtensionKind } from "../types/extension";

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
  readonly ridgeHeightRelM: number | null;
  readonly wallHeightM: number | null;
  readonly hadLegacyCanonicalDormerGeometry: boolean;
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

function readRidge(raw: Record<string, unknown>): RoofExtensionSourceSegment2D | null {
  const direct = readSegment(raw.ridge);
  if (direct) return direct;
  const model = raw.dormerModel;
  if (isRecord(model)) return readSegment(model.ridge);
  return null;
}

function readHips(raw: Record<string, unknown>): RoofExtensionSourceHips2D | null {
  const hips = raw.hips;
  if (!isRecord(hips)) return null;
  const left = readSegment(hips.left);
  const right = readSegment(hips.right);
  if (!left && !right) return null;
  return {
    ...(left ? { left } : {}),
    ...(right ? { right } : {}),
  };
}

function readKind(raw: Record<string, unknown>): RoofExtensionKind {
  const kind = typeof raw.kind === "string" ? raw.kind.toLowerCase() : "";
  const dormerType = typeof raw.dormerType === "string" ? raw.dormerType.toLowerCase() : "";
  if (kind.includes("chien") || dormerType.includes("chien")) return "chien_assis";
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
  const panId = raw.panId ?? raw.supportPanId ?? raw.parentPanId;
  return typeof panId === "string" && panId.length > 0 ? panId : null;
}

function readSource(raw: Record<string, unknown>, index: number): RoofExtensionSource2D {
  const id = raw.id != null ? String(raw.id) : `roof-extension-${index}`;
  const contour = readContour(raw);
  const ridge = readRidge(raw);
  const warnings: string[] = [];
  if (contour.length < 3) warnings.push("ROOF_EXTENSION_CONTOUR_INVALID");
  if (!ridge) warnings.push("ROOF_EXTENSION_RIDGE_MISSING");
  if (hasLegacyCanonicalDormerGeometry(raw)) warnings.push("LEGACY_CANONICAL_DORMER_GEOMETRY_IGNORED");

  return {
    id,
    kind: readKind(raw),
    sourceIndex: index,
    stage: typeof raw.stage === "string" ? raw.stage : null,
    visualModel: typeof raw.visualModel === "string" ? raw.visualModel : null,
    supportPanId: readSupportPanId(raw),
    contour,
    ridge,
    hips: readHips(raw),
    ridgeHeightRelM: nonNegativeNumber(raw.ridgeHeightRelM),
    wallHeightM: nonNegativeNumber(raw.wallHeightM),
    hadLegacyCanonicalDormerGeometry: hasLegacyCanonicalDormerGeometry(raw),
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
