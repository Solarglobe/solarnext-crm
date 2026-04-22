/**
 * Volume fermé : base à `baseZ` (scalaire ou Z par sommet), couronne supérieure aux Z variables par sommet
 * (épouse le toit plan-par-plan), faces latérales quadrangulaires.
 *
 * Chapeau **base** : toujours généré — triangulation oreilles en projection XY (concave), repli éventail si échec.
 *
 * **Phase A5 — Chapeau supérieur** : la couronne haute suit souvent **plusieurs plans** de toit ; trianguler son
 * chapeau uniquement en **projection XY** produit des triangles 3D qui **traversent** la surface toit réelle
 * (artefacts, z-fight). **Stratégie** : mesurer le RMS des résidus au plan de meilleur ajustement (normale Newell,
 * `planeFitResidualRms`). Si `RMS > SHELL_TOP_RING_MAX_PLANARITY_RMS_M`, **aucune** face `kind: "top"` n’est émise ;
 * le volume reste utile (base + murs) sans « faux plafond » sous le toit produit. En `import.meta.env.DEV`, omission
 * tracée via `[SHELL-TOP-CAP]`. (Pas de triangulation 3D contrainte dans cette phase.)
 */

import type { Vector3 } from "../types/primitives";
import type { WorldPosition3D } from "../types/coordinates";
import type { VolumeEdge3D, VolumeFace3D, VolumeVertex3D } from "../types/volumetric-mesh";
import { centroid3, newellNormalUnnormalized, planeFitResidualRms } from "../builder/planePolygon3d";
import { cross3, dot3, length3, normalize3, scale3, sub3, vec3 } from "../utils/math3";
import { computeVolumeM3FromTriangleMesh } from "./meshVolume";
import type { VerticalPrismMeshResult } from "./extrudeVerticalPrism";
import { signedArea2d, triangulateSimplePolygon2dCcW } from "../utils/triangulateSimplePolygon2d";

const UP = vec3(0, 0, 1);

/** Seuil RMS (m) : au-delà, aucune face de chapeau supérieur (triangulation XY non fiable vs toit réel). */
export const SHELL_TOP_RING_MAX_PLANARITY_RMS_M = 0.06;

/**
 * RMS (m) des distances au plan de meilleur ajustement (Newell + centroïde). `null` si anneau dégénéré.
 */
export function computeShellTopRingPlaneFitRmsM(top: readonly WorldPosition3D[]): number | null {
  const m = top.length;
  if (m < 3) return null;
  const c = centroid3(top);
  const raw = newellNormalUnnormalized(top);
  const n = normalize3(raw);
  if (!n) return null;
  return planeFitResidualRms(top, n, c);
}

export function shellTopRingPlanarEnoughForXyCap(top: readonly WorldPosition3D[]): boolean {
  const rms = computeShellTopRingPlaneFitRmsM(top);
  return rms != null && rms <= SHELL_TOP_RING_MAX_PLANARITY_RMS_M;
}

function centroidPoints(pts: readonly Vector3[]): WorldPosition3D {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const k = pts.length;
  return { x: x / k, y: y / k, z: z / k };
}

function aabb(pts: readonly Vector3[]): { min: WorldPosition3D; max: WorldPosition3D } {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
    maxZ = Math.max(maxZ, p.z);
  }
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
}

function faceNormalFromTriangle(a: Vector3, b: Vector3, c: Vector3, centroidSolid: Vector3): Vector3 {
  const ab = sub3(b, a);
  const ac = sub3(c, a);
  const n = cross3(ab, ac);
  const nu = normalize3(n);
  if (!nu) return vec3(0, 0, 1);
  const fc = centroidPoints([a, b, c]);
  const toSolid = sub3(centroidSolid, fc);
  if (dot3(nu, toSolid) < 0) {
    return { x: -nu.x, y: -nu.y, z: -nu.z };
  }
  return nu;
}

function orientNormalForFaceKind(
  kind: "base" | "top" | "side" | "cap" | "other",
  nu: Vector3,
): Vector3 {
  let n = nu;
  if (kind === "base") {
    if (dot3(n, UP) > 0) n = scale3(n, -1);
  } else if (kind === "top") {
    if (dot3(n, UP) < 0) n = scale3(n, -1);
  }
  return normalize3(n) ?? n;
}

function pushCapFacesEarOrFan(
  ring: readonly WorldPosition3D[],
  vertexIndexOffset: number,
  centroid: Vector3,
  kind: "base" | "top",
  idPrefix: string,
  faces: VolumeFace3D[],
): void {
  const n = ring.length;
  const pts2d = ring.map((p) => ({ x: p.x, y: p.y }));
  let order = Array.from({ length: n }, (_, i) => i);
  if (signedArea2d(order.map((i) => pts2d[i]!)) < 0) {
    order = order.slice().reverse();
  }
  const ccwPts = order.map((i) => pts2d[i]!);
  const flat = triangulateSimplePolygon2dCcW(ccwPts);
  if (flat != null) {
    for (let t = 0; t < flat.length; t += 3) {
      const ia = order[flat[t]!]!;
      const ib = order[flat[t + 1]!]!;
      const ic = order[flat[t + 2]!]!;
      const a = ring[ia]!;
      const b = ring[ib]!;
      const c = ring[ic]!;
      let nu = faceNormalFromTriangle(a, b, c, centroid);
      nu = orientNormalForFaceKind(kind, nu);
      const triArea = length3(cross3(sub3(b, a), sub3(c, a))) * 0.5;
      faces.push({
        id: `${idPrefix}-face-${kind}-ear-${t}`,
        kind,
        vertexIndexCycle: [ia + vertexIndexOffset, ib + vertexIndexOffset, ic + vertexIndexOffset],
        outwardUnitNormal: nu,
        areaM2: triArea,
      });
    }
    return;
  }
  for (let tt = 1; tt < n - 1; tt++) {
    const i0 = order[0]!;
    const i1 = order[tt]!;
    const i2 = order[tt + 1]!;
    const a = ring[i0]!;
    const b = ring[i1]!;
    const c = ring[i2]!;
    let nu = faceNormalFromTriangle(a, b, c, centroid);
    nu = orientNormalForFaceKind(kind, nu);
    const triArea = length3(cross3(sub3(b, a), sub3(c, a))) * 0.5;
    faces.push({
      id: `${idPrefix}-face-${kind}-fan-${tt}`,
      kind,
      vertexIndexCycle: [i0 + vertexIndexOffset, i1 + vertexIndexOffset, i2 + vertexIndexOffset],
      outwardUnitNormal: nu,
      areaM2: triArea,
    });
  }
}

/**
 * @param ringXY polygone horizontal (ordre CCW vu de +Z)
 * @param baseZ cote base du shell : **scalaire** (même Z pour tout le pourtour) **ou** un tableau d’une cote par sommet
 * @param topZPerVertex Z du haut du shell par sommet (ex. plan toit local − clearance)
 */
export function extrudeShellUnderSlopedRoofWorld(
  ringXY: readonly { x: number; y: number }[],
  baseZ: number | readonly number[],
  topZPerVertex: readonly number[],
  idPrefix: string,
): VerticalPrismMeshResult {
  const n = ringXY.length;
  if (
    n < 3 ||
    topZPerVertex.length !== n ||
    !topZPerVertex.every((z) => Number.isFinite(z))
  ) {
    return {
      vertices: [],
      edges: [],
      faces: [],
      centroid: { x: 0, y: 0, z: 0 },
      volumeM3: 0,
      surfaceAreaM2: 0,
      bounds: {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 0, y: 0, z: 0 },
      },
    };
  }

  const baseZs: number[] =
    typeof baseZ === "number"
      ? Number.isFinite(baseZ)
        ? Array.from({ length: n }, () => baseZ)
        : []
      : baseZ.length === n && baseZ.every((z) => Number.isFinite(z))
        ? [...baseZ]
        : [];

  if (baseZs.length !== n) {
    return {
      vertices: [],
      edges: [],
      faces: [],
      centroid: { x: 0, y: 0, z: 0 },
      volumeM3: 0,
      surfaceAreaM2: 0,
      bounds: {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 0, y: 0, z: 0 },
      },
    };
  }

  for (let i = 0; i < n; i++) {
    if (baseZs[i]! >= topZPerVertex[i]! - 1e-4) {
      return {
        vertices: [],
        edges: [],
        faces: [],
        centroid: { x: 0, y: 0, z: 0 },
        volumeM3: 0,
        surfaceAreaM2: 0,
        bounds: {
          min: { x: 0, y: 0, z: 0 },
          max: { x: 0, y: 0, z: 0 },
        },
      };
    }
  }

  const baseFootprint: WorldPosition3D[] = ringXY.map((p, i) => ({ x: p.x, y: p.y, z: baseZs[i]! }));
  const top: WorldPosition3D[] = ringXY.map((p, i) => ({
    x: p.x,
    y: p.y,
    z: topZPerVertex[i]!,
  }));

  const allPts: Vector3[] = [...baseFootprint, ...top];
  const centroid = centroidPoints(allPts);
  const bounds = aabb(allPts);

  const vertices: VolumeVertex3D[] = allPts.map((p, i) => ({
    id: `${idPrefix}-v-${i}`,
    position: { ...p },
  }));

  const edges: VolumeEdge3D[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    edges.push({
      id: `${idPrefix}-e-base-${i}`,
      vertexAIndex: i,
      vertexBIndex: j,
      kind: "base",
    });
    edges.push({
      id: `${idPrefix}-e-top-${i}`,
      vertexAIndex: i + n,
      vertexBIndex: j + n,
      kind: "top",
    });
    edges.push({
      id: `${idPrefix}-e-lat-${i}`,
      vertexAIndex: i,
      vertexBIndex: i + n,
      kind: "lateral",
    });
  }

  const faces: VolumeFace3D[] = [];

  pushCapFacesEarOrFan(baseFootprint, 0, centroid, "base", idPrefix, faces);

  const topRingPlanarityRmsM = computeShellTopRingPlaneFitRmsM(top);
  const includeTopCap =
    topRingPlanarityRmsM != null && topRingPlanarityRmsM <= SHELL_TOP_RING_MAX_PLANARITY_RMS_M;
  if (includeTopCap) {
    pushCapFacesEarOrFan(top, n, centroid, "top", idPrefix, faces);
  } else if (import.meta.env.DEV) {
    console.info("[SHELL-TOP-CAP]", {
      idPrefix,
      ringVertexCount: n,
      planeFitResidualRmsM:
        topRingPlanarityRmsM != null && Number.isFinite(topRingPlanarityRmsM)
          ? Number(topRingPlanarityRmsM.toFixed(6))
          : null,
      maxPlanarityRmsM: SHELL_TOP_RING_MAX_PLANARITY_RMS_M,
      decision:
        topRingPlanarityRmsM == null
          ? "omit_top_cap_degenerate_ring_or_normal"
          : "omit_top_cap_xy_triangulation_non_planar_ring",
    });
  }

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = baseFootprint[i]!;
    const b = baseFootprint[j]!;
    const c = top[j]!;
    const d = top[i]!;
    let nu1 = faceNormalFromTriangle(a, b, c, centroid);
    nu1 = normalize3(nu1) ?? nu1;
    const area1 = length3(cross3(sub3(b, a), sub3(c, a))) * 0.5;
    faces.push({
      id: `${idPrefix}-face-side-a-${i}`,
      kind: "side",
      vertexIndexCycle: [i, j, j + n],
      outwardUnitNormal: nu1,
      areaM2: area1,
    });
    let nu2 = faceNormalFromTriangle(a, c, d, centroid);
    nu2 = normalize3(nu2) ?? nu2;
    const area2 = length3(cross3(sub3(c, a), sub3(d, a))) * 0.5;
    faces.push({
      id: `${idPrefix}-face-side-b-${i}`,
      kind: "side",
      vertexIndexCycle: [i, j + n, i + n],
      outwardUnitNormal: nu2,
      areaM2: area2,
    });
  }

  let surfaceAreaM2 = 0;
  for (const f of faces) surfaceAreaM2 += f.areaM2;

  const volumeM3 = computeVolumeM3FromTriangleMesh(allPts, faces);

  return {
    vertices,
    edges,
    faces,
    centroid,
    volumeM3,
    surfaceAreaM2,
    bounds,
  };
}
