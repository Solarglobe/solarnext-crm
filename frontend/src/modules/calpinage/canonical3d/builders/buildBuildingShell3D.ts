/**
 * Builder officiel — volume bâtiment (coque latérale fermée par extrusion verticale du footprint canonique).
 *
 * - Entrée : `CanonicalHouseDocument` (+ surcharges optionnelles). **Aucune** lecture `CALPINAGE_STATE`, `window`, legacy.
 * - Sortie : `BuildingShell3D` + diagnostics auditables.
 *
 * @see docs/architecture/building-shell-3d.md
 */

import type { CanonicalHouseDocument, Polygon2DLocal } from "../model/canonicalHouse3DModel";
import type {
  BuildBuildingShell3DResult,
  BuildingShell3D,
  BuildingShellBuildDiagnostics,
  BuildingShellRing3D,
  BuildingShellVertex3D,
  BuildingWallFace3D,
  BuildingShellWinding,
} from "../model/buildingShell3DModel";
import { BUILDING_SHELL_SCHEMA_ID } from "../model/buildingShell3DModel";
import { cross3, normalize3, sub3 } from "../utils/math3";

const EPS_LEN = 1e-6;
const EPS_AREA = 1e-9;
const EPS_NORMAL_DOT = 1e-5;

export type BuildingShellHeightSource = BuildingShell3D["provenance"]["heightSource"];

/**
 * Entrées autorisées. Refusé : relire le runtime brut.
 *
 * | Champ | Obligatoire | Rôle |
 * |-------|-------------|------|
 * | `document` | oui | Canonique House3D |
 * | `document.building.buildingFootprint` | oui | Footprint officiel (≥3 sommets après nettoyage) |
 * | `document.building.baseZ` | oui | Toujours 0 (convention) |
 * | `zWallTop` **ou** `wallHeightM` **ou** `building.wallHeightM` | au moins un | Hauteur / cote haute |
 *
 * **Optionnel** : `wallHeightM` / `zWallTop` en surcharge.
 *
 * **Ignoré** : `roof`, `annexes`, `pv`, `worldPlacement`, `building.buildingOuterContour` (seul `buildingFootprint` est utilisé pour la coque).
 */
export interface BuildBuildingShell3DInput {
  readonly document: CanonicalHouseDocument;
  readonly zWallTop?: number;
  readonly wallHeightM?: number;
}

function signedAreaXY2(poly: ReadonlyArray<Readonly<{ x: number; y: number }>>): number {
  let a = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % n]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function dist2(a: Readonly<{ x: number; y: number }>, b: Readonly<{ x: number; y: number }>): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function cleanFootprintRing(
  footprint: Polygon2DLocal,
): { ring: { x: number; y: number }[]; degenerateSegmentCount: number } {
  if (footprint.length === 0) return { ring: [], degenerateSegmentCount: 0 };
  const cleaned: { x: number; y: number }[] = [];
  let degenerateSegmentCount = 0;
  for (let i = 0; i < footprint.length; i++) {
    const p = footprint[i]!;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      degenerateSegmentCount++;
      continue;
    }
    if (cleaned.length === 0) {
      cleaned.push({ x: p.x, y: p.y });
      continue;
    }
    const last = cleaned[cleaned.length - 1]!;
    const d = dist2(p, last);
    if (d < EPS_LEN) {
      degenerateSegmentCount++;
    } else {
      cleaned.push({ x: p.x, y: p.y });
    }
  }
  if (cleaned.length >= 2) {
    const first = cleaned[0]!;
    const last = cleaned[cleaned.length - 1]!;
    if (dist2(first, last) < EPS_LEN) {
      cleaned.pop();
    }
  }
  return { ring: cleaned, degenerateSegmentCount };
}

function classifyWinding(signedArea: number): BuildingShellWinding {
  if (signedArea > EPS_AREA) return "ccw";
  if (signedArea < -EPS_AREA) return "cw";
  return "degenerate";
}

function outwardUnitXY(
  p0: Readonly<{ x: number; y: number }>,
  p1: Readonly<{ x: number; y: number }>,
  windingCcW: boolean,
): { x: number; y: number } {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy);
  if (len < EPS_LEN) return { x: 0, y: 0 };
  if (windingCcW) {
    return { x: dy / len, y: -dx / len };
  }
  return { x: -dy / len, y: dx / len };
}

/**
 * Construit la coque latérale du bâtiment (extrusion verticale pure).
 */
export function buildBuildingShell3D(input: BuildBuildingShell3DInput): BuildBuildingShell3DResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const building = input.document.building;
  const baseZ = building.baseZ;

  let heightSource: BuildingShellHeightSource;
  let topZ: number;

  if (input.zWallTop != null && Number.isFinite(input.zWallTop)) {
    topZ = input.zWallTop;
    heightSource = "input.zWallTop";
  } else {
    const h = input.wallHeightM ?? building.wallHeightM;
    if (h == null || !Number.isFinite(h)) {
      errors.push("BUILDING_WALL_HEIGHT_MISSING: fournir zWallTop, wallHeightM (input) ou building.wallHeightM.");
      topZ = NaN;
      heightSource = "building.wallHeightM";
    } else {
      topZ = baseZ + h;
      heightSource = input.wallHeightM != null ? "input.wallHeightM" : "building.wallHeightM";
    }
  }

  const heightUsed = Number.isFinite(topZ) ? topZ - baseZ : NaN;

  if (Number.isFinite(heightUsed) && heightUsed <= 0) {
    errors.push("BUILDING_WALL_HEIGHT_NON_POSITIVE: topZ doit être strictement supérieur à baseZ.");
  }

  const { ring: rawRing, degenerateSegmentCount } = cleanFootprintRing(building.buildingFootprint);
  if (rawRing.length < 3) {
    errors.push(`FOOTPRINT_NOT_EXPLOITABLE: moins de 3 sommets après nettoyage (obtenu ${rawRing.length}).`);
  }

  const area0 = signedAreaXY2(rawRing);
  const windingDetected = classifyWinding(area0);
  if (windingDetected === "degenerate") {
    errors.push("FOOTPRINT_DEGENERATE_AREA: aire signée ~0 — polygone plat ou colinéaire.");
  }

  let ring = rawRing;
  let windingCcWForNormals = windingDetected === "ccw";
  if (windingDetected === "cw") {
    ring = [...rawRing].reverse();
    windingCcWForNormals = true;
    warnings.push("WINDING_INPUT_CLOCKWISE: ordre inversé en interne pour normales sortantes cohérentes.");
  }

  const n = ring.length;
  let perimeterM = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    perimeterM += dist2(ring[i]!, ring[j]!);
  }

  const failedPrecheck =
    errors.length > 0 || n < 3 || !Number.isFinite(heightUsed) || heightUsed <= 0;

  if (failedPrecheck) {
    const diagnostics: BuildingShellBuildDiagnostics = {
      isValid: false,
      isClosedLateralShell: false,
      wallCount: 0,
      bottomVertexCount: 0,
      topVertexCount: 0,
      degenerateSegmentCount,
      windingDetected,
      normalsConsistent: false,
      baseZ,
      topZ: Number.isFinite(topZ) ? topZ : baseZ,
      heightUsed: Number.isFinite(heightUsed) ? heightUsed : 0,
      errors,
      warnings,
      perimeterM: 0,
      lateralSurfaceAreaM2: 0,
      footprintSignedAreaM2: area0,
    };
    return { shell: null, diagnostics };
  }

  const bottomVertices: BuildingShellVertex3D[] = ring.map((p, i) => ({
    vertexId: `shell-b-${i}`,
    position: { x: p.x, y: p.y, z: baseZ },
  }));
  const topVertices: BuildingShellVertex3D[] = ring.map((p, i) => ({
    vertexId: `shell-t-${i}`,
    position: { x: p.x, y: p.y, z: topZ },
  }));

  const bottomSegments = ring.map((_, i) => {
    const j = (i + 1) % n;
    const a = bottomVertices[i]!;
    const b = bottomVertices[j]!;
    const len = dist2(
      { x: a.position.x, y: a.position.y },
      { x: b.position.x, y: b.position.y },
    );
    return {
      segmentId: `shell-bs-${i}`,
      vertexIdA: a.vertexId,
      vertexIdB: b.vertexId,
      lengthM: len,
    };
  });

  const topSegments = ring.map((_, i) => {
    const j = (i + 1) % n;
    const a = topVertices[i]!;
    const b = topVertices[j]!;
    const len = dist2(
      { x: a.position.x, y: a.position.y },
      { x: b.position.x, y: b.position.y },
    );
    return {
      segmentId: `shell-ts-${i}`,
      vertexIdA: a.vertexId,
      vertexIdB: b.vertexId,
      lengthM: len,
    };
  });

  const bottomRing: BuildingShellRing3D = {
    ringId: "building-shell-bottom",
    vertices: bottomVertices,
    segments: bottomSegments,
    closed: true,
  };
  const topRing: BuildingShellRing3D = {
    ringId: "building-shell-top",
    vertices: topVertices,
    segments: topSegments,
    closed: true,
  };

  const wallFaces: BuildingWallFace3D[] = [];
  let lateralSurfaceAreaM2 = 0;
  const wallErrors: string[] = [];

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const p0 = ring[i]!;
    const p1 = ring[j]!;
    const b0 = bottomVertices[i]!.position;
    const b1 = bottomVertices[j]!.position;
    const t0 = topVertices[i]!.position;
    const t1 = topVertices[j]!.position;
    const len = dist2(p0, p1);
    if (len < EPS_LEN) {
      wallErrors.push(`DEGENERATE_EDGE_AT_INDEX_${i}`);
      continue;
    }
    const polygon = [b0, b1, t1, t0] as [typeof b0, typeof b1, typeof t1, typeof t0];
    const e0 = sub3(b1, b0);
    const e1 = sub3(t1, b0);
    const rawN = cross3(e0, e1);
    const nrm = normalize3(rawN);
    if (!nrm) {
      wallErrors.push(`WALL_NORMAL_FAILED_AT_INDEX_${i}`);
      continue;
    }
    const expected = outwardUnitXY(p0, p1, windingCcWForNormals);
    const horizDot = nrm.x * expected.x + nrm.y * expected.y;
    if (horizDot < 1 - EPS_NORMAL_DOT) {
      wallErrors.push(`WALL_NORMAL_MISMATCH_SEGMENT_${i}`);
    }
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const edgeLen = Math.hypot(dx, dy);
    wallFaces.push({
      wallId: `wall-${i}`,
      segmentIndex: i,
      bottomVertexIds: [bottomVertices[i]!.vertexId, bottomVertices[j]!.vertexId],
      topVertexIds: [topVertices[i]!.vertexId, topVertices[j]!.vertexId],
      polygon,
      outwardNormal: nrm,
      heightM: heightUsed,
      lengthM: len,
      edgeDirectionXY: { x: dx / edgeLen, y: dy / edgeLen },
    });
    lateralSurfaceAreaM2 += len * heightUsed;
  }

  const normalsConsistent = wallErrors.length === 0 && wallFaces.length === n;
  const isClosedLateralShell = wallFaces.length === n;
  const isValid = isClosedLateralShell && normalsConsistent;

  if (wallErrors.length > 0) {
    errors.push(...wallErrors);
  }

  const diagnostics: BuildingShellBuildDiagnostics = {
    isValid,
    isClosedLateralShell,
    wallCount: wallFaces.length,
    bottomVertexCount: bottomVertices.length,
    topVertexCount: topVertices.length,
    degenerateSegmentCount,
    windingDetected,
    normalsConsistent,
    baseZ,
    topZ,
    heightUsed,
    errors,
    warnings,
    perimeterM,
    lateralSurfaceAreaM2,
    footprintSignedAreaM2: area0,
  };

  if (!isValid) {
    return { shell: null, diagnostics };
  }

  const shell: BuildingShell3D = {
    schemaId: BUILDING_SHELL_SCHEMA_ID,
    buildingId: building.buildingId,
    baseZ,
    topZ,
    bottomRing,
    topRing,
    wallFaces,
    provenance: {
      source: "canonical_house_document",
      buildingFootprintSource: "building.buildingFootprint",
      heightSource,
    },
  };

  return { shell, diagnostics };
}
