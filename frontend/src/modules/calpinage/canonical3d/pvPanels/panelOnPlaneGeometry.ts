/**
 * Géométrie pure : rectangle sur plan (repère pan), grille d’échantillonnage.
 */

import type { WorldPosition3D } from "../types/coordinates";
import type { LocalFrame3D } from "../types/frame";
import type { PlaneEquation } from "../types/plane";
import type { PvPanelGrid3D, PvPanelSamplingParams } from "../types/pv-panel-3d";
import type { Vector3 } from "../types/primitives";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import { add3, cross3, dot3, normalize3, scale3, sub3 } from "../utils/math3";
import { projectPointOntoPlane } from "../volumes/planeAnchor";

export interface PatchTangentBasis {
  readonly origin: Vector3;
  readonly uHat: Vector3;
  readonly vHat: Vector3;
  readonly nHat: Vector3;
}

/** Normalise les axes tangents du patch : u × v = n (main droite, n sortante). */
export function orthonormalPatchBasis(patch: RoofPlanePatch3D): PatchTangentBasis | null {
  const n = normalize3(patch.normal) ?? normalize3(patch.localFrame.zAxis);
  if (!n) return null;
  const x0 = patch.localFrame.xAxis;
  const u0 = sub3(x0, scale3(n, dot3(x0, n)));
  const u = normalize3(u0);
  if (!u) return null;
  const v = normalize3(cross3(n, u));
  if (!v) return null;
  return { origin: { ...patch.localFrame.origin }, uHat: u, vHat: v, nHat: n };
}

export function resolveCenterOnPlaneWorld(
  center: { mode: "plane_uv"; uv: { u: number; v: number } } | { mode: "world"; position: Vector3 },
  patch: RoofPlanePatch3D,
  equation: PlaneEquation
): { world: WorldPosition3D; signedDistanceBeforeProjectionM: number } {
  if (center.mode === "plane_uv") {
    const b = orthonormalPatchBasis(patch);
    if (!b) {
      const p0 = projectPointOntoPlane(patch.localFrame.origin, equation);
      return { world: p0, signedDistanceBeforeProjectionM: 0 };
    }
    const p = add3(add3(b.origin, scale3(b.uHat, center.uv.u)), scale3(b.vHat, center.uv.v));
    const sd = dot3(equation.normal, p) + equation.d;
    const proj = projectPointOntoPlane({ x: p.x, y: p.y, z: p.z }, equation);
    return { world: proj, signedDistanceBeforeProjectionM: sd };
  }
  const sd = dot3(equation.normal, center.position) + equation.d;
  const proj = projectPointOntoPlane(center.position, equation);
  return { world: proj, signedDistanceBeforeProjectionM: sd };
}

/** Dimensions le long des axes tangents U/V du pan après choix portrait / paysage. */
export function moduleDimsAlongPatchUv(
  widthM: number,
  heightM: number,
  orientation: "portrait" | "landscape"
): { dimAlongU: number; dimAlongV: number } {
  if (orientation === "portrait") {
    return { dimAlongU: widthM, dimAlongV: heightM };
  }
  return { dimAlongU: heightM, dimAlongV: widthM };
}

export function panelRectangleFromCenter(
  center: WorldPosition3D,
  uHat: Vector3,
  vHat: Vector3,
  dimAlongU: number,
  dimAlongV: number,
  rotationRad: number
): {
  corners: readonly [WorldPosition3D, WorldPosition3D, WorldPosition3D, WorldPosition3D];
  widthDir: Vector3;
  heightDir: Vector3;
} {
  const c = Math.cos(rotationRad);
  const s = Math.sin(rotationRad);
  const wu = normalize3(add3(scale3(uHat, c), scale3(vHat, s)))!;
  const hv = normalize3(add3(scale3(uHat, -s), scale3(vHat, c)))!;
  const du = dimAlongU * 0.5;
  const dv = dimAlongV * 0.5;
  const c0 = add3(center, add3(scale3(wu, -du), scale3(hv, -dv)));
  const c1 = add3(center, add3(scale3(wu, du), scale3(hv, -dv)));
  const c2 = add3(center, add3(scale3(wu, du), scale3(hv, dv)));
  const c3 = add3(center, add3(scale3(wu, -du), scale3(hv, dv)));
  return { corners: [c0, c1, c2, c3], widthDir: wu, heightDir: hv };
}

export function buildPanelLocalFrame(
  center: WorldPosition3D,
  widthDir: Vector3,
  heightDir: Vector3,
  nHat: Vector3
): LocalFrame3D {
  const xAxis = normalize3(widthDir) ?? widthDir;
  const yAxis = normalize3(heightDir) ?? heightDir;
  const zAxis = normalize3(nHat) ?? nHat;
  return {
    role: "pv_panel_surface",
    origin: { ...center },
    xAxis: { ...xAxis },
    yAxis: { ...yAxis },
    zAxis: { ...zAxis },
  };
}

export function buildSamplingGrid(
  center: WorldPosition3D,
  widthDir: Vector3,
  heightDir: Vector3,
  dimAlongU: number,
  dimAlongV: number,
  corners: readonly [WorldPosition3D, WorldPosition3D, WorldPosition3D, WorldPosition3D],
  params: PvPanelSamplingParams
): PvPanelGrid3D {
  const { nx, ny, includeEdgeMidpoints } = params;
  const cellCenters: WorldPosition3D[] = [];
  const cellUv: { u: number; v: number }[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const u01 = (i + 0.5) / nx;
      const v01 = (j + 0.5) / ny;
      const pt = add3(
        center,
        add3(
          scale3(widthDir, (u01 - 0.5) * dimAlongU),
          scale3(heightDir, (v01 - 0.5) * dimAlongV)
        )
      );
      cellCenters.push({ x: pt.x, y: pt.y, z: pt.z });
      cellUv.push({ u: u01, v: v01 });
    }
  }
  const [k0, k1, k2, k3] = corners;
  const edgeMid: WorldPosition3D[] | undefined = includeEdgeMidpoints
    ? [
        {
          x: (k0.x + k1.x) * 0.5,
          y: (k0.y + k1.y) * 0.5,
          z: (k0.z + k1.z) * 0.5,
        },
        {
          x: (k1.x + k2.x) * 0.5,
          y: (k1.y + k2.y) * 0.5,
          z: (k1.z + k2.z) * 0.5,
        },
        {
          x: (k2.x + k3.x) * 0.5,
          y: (k2.y + k3.y) * 0.5,
          z: (k2.z + k3.z) * 0.5,
        },
        {
          x: (k3.x + k0.x) * 0.5,
          y: (k3.y + k0.y) * 0.5,
          z: (k3.z + k0.z) * 0.5,
        },
      ]
    : undefined;
  return {
    params,
    cellCentersWorld: cellCenters,
    cellUv01: cellUv,
    cornerPointsWorld: [...corners],
    centerWorld: { ...center },
    edgeMidpointsWorld: edgeMid,
  };
}

/** Aire du quad = produit des dimensions (rectangle). */
export function panelSurfaceAreaM2(widthM: number, heightM: number): number {
  return Math.abs(widthM * heightM);
}
