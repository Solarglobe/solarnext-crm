/**
 * houseModelV2 — Construction d'un modèle 3D à partir de geometry3d.entities.
 * POC minimal : extrusion obstacles/shadow volumes/contours, quads plats pour PV panels.
 * Format compatible phase3Viewer (LEGACY gelé) : walls (extruded) + roofMeshes (vertices/indices).
 * Pour la 3D officielle, préférer SolarScene3D + SolarScene3DViewer (canonical3d).
 *
 * Convention : mapping image→Three ici est une approximation legacy (originPx, Y=hauteur Three).
 * Vérité métier calpinage : `docs/architecture/3d-world-convention.md` — `canonical3d/core/worldConvention.ts`.
 */

import type { GeoEntity3D, Point2D } from "./geoEntity3D";

function fanTriangulate(contour: Array<{ x: number; z: number }>): number[] {
  const n = contour.length;
  if (n < 3) return [];
  const indices: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    indices.push(0, i, i + 1);
  }
  return indices;
}

function triangulatePolygon(contour: Array<{ x: number; z: number }>): number[] {
  if (!contour || contour.length < 3) return [];
  return fanTriangulate(contour);
}

export interface HouseModelV2Context {
  metersPerPixel: number;
  originPx?: Point2D;
}

export interface HouseModelV2Result {
  walls: Array<{
    type: "extruded";
    contour: Array<{ x: number; y: number }>;
    height: number;
    baseZ?: number;
  }>;
  roofMeshes: Array<{
    vertices: number[];
    indices: number[];
  }>;
}

/**
 * Convertit footprintPx en coordonnées monde (mètres).
 * worldX = (xPx - originPx.x) * mpp
 * worldZ = (yPx - originPx.y) * mpp  (Y = hauteur dans Three.js)
 */
function pxToWorld(
  footprintPx: Point2D[],
  mpp: number,
  originPx: Point2D
): Array<{ x: number; z: number }> {
  return footprintPx.map((p) => ({
    x: (p.x - originPx.x) * mpp,
    z: (p.y - originPx.y) * mpp,
  }));
}

/**
 * Construit le houseModel 3D à partir des entities GeoEntity3D.
 */
export function houseModelV2(
  entities: GeoEntity3D[],
  ctx: HouseModelV2Context
): HouseModelV2Result {
  const walls: HouseModelV2Result["walls"] = [];
  const roofMeshes: HouseModelV2Result["roofMeshes"] = [];

  const mpp = ctx.metersPerPixel > 0 ? ctx.metersPerPixel : 1;
  const originPx = ctx.originPx ?? { x: 0, y: 0 };

  for (const e of entities) {
    if (!e.footprintPx || e.footprintPx.length < 3) continue;

    const contour = pxToWorld(e.footprintPx, mpp, originPx);

    switch (e.type) {
      case "OBSTACLE":
      case "SHADOW_VOLUME":
        if (e.heightM > 0) {
          walls.push({
            type: "extruded",
            contour: contour.map((p) => ({ x: p.x, y: p.z })),
            height: e.heightM,
            baseZ: e.baseZWorldM,
          });
        }
        break;

      case "BUILDING_CONTOUR":
      case "ROOF_CONTOUR":
      case "ROOF_EXTENSION":
        if (e.heightM >= 0) {
          const z = e.baseZWorldM;
          const verts: number[] = [];
          for (const p of contour) {
            verts.push(p.x, p.z, z);
          }
          const inds = triangulatePolygon(contour);
          if (inds.length >= 3) {
            roofMeshes.push({ vertices: verts, indices: inds });
          }
        }
        break;

      case "PV_PANEL":
      case "PAN_SURFACE":
        {
          const z = e.baseZWorldM;
          const verts: number[] = [];
          for (const p of contour) {
            verts.push(p.x, p.z, z);
          }
          const inds = triangulatePolygon(contour);
          if (inds.length >= 3) {
            roofMeshes.push({ vertices: verts, indices: inds });
          }
        }
        break;

      default:
        break;
    }
  }

  return { walls, roofMeshes };
}
