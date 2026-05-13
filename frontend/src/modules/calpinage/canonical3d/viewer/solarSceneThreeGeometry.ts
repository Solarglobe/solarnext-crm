/**
 * Conversion fidèle SolarScene3D → géométries Three.js (aucun recalcul métier — uniquement tessellation affichage).
 *
 * Repère : coordonnées monde canoniques copiées telles quelles (x,y,z) → attributs Three.js.
 * Voir `docs/architecture/3d-world-convention.md`, `canonical3d/world/unifiedWorldFrame.ts` et `core/worldConvention.ts` (`worldPointToViewer`).
 */

import * as THREE from "three";
import { projectPointToPlaneUv } from "../builder/planePolygon3d";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { RoofObstacleVolume3D } from "../types/roof-obstacle-volume";
import type { RoofExtensionVolume3D } from "../types/roof-extension-volume";
import type { BuildingShell3D } from "../types/building-shell-3d";
import type { PvPanelSurface3D } from "../types/pv-panel-3d";
import type { RoofModel3D } from "../types/model";
import { signedArea2d, triangulateSimplePolygon2dCcW } from "../utils/triangulateSimplePolygon2d";

function fanTriangulateIndices(n: number): number[] {
  const idx: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    idx.push(0, i, i + 1);
  }
  return idx;
}

function patchUvPoints2d(patch: RoofPlanePatch3D): { readonly x: number; readonly y: number }[] {
  const corners = patch.cornersWorld;
  const n = corners.length;
  const poly = patch.polygon2DInPlane;
  if (poly && poly.length === n) {
    return poly.map((p) => ({ x: p.u, y: p.v }));
  }
  const { origin, xAxis, yAxis } = patch.localFrame;
  return corners.map((c) => {
    const uv = projectPointToPlaneUv(c, origin, xAxis, yAxis);
    return { x: uv.u, y: uv.v };
  });
}

function triangleWindAlongNormal(
  i0: number,
  i1: number,
  i2: number,
  corners: readonly { x: number; y: number; z: number }[],
  patchNormal: { x: number; y: number; z: number },
): readonly [number, number, number] {
  const p0 = corners[i0]!;
  const p1 = corners[i1]!;
  const p2 = corners[i2]!;
  const e1x = p1.x - p0.x;
  const e1y = p1.y - p0.y;
  const e1z = p1.z - p0.z;
  const e2x = p2.x - p0.x;
  const e2y = p2.y - p0.y;
  const e2z = p2.z - p0.z;
  const cx = e1y * e2z - e1z * e2y;
  const cy = e1z * e2x - e1x * e2z;
  const cz = e1x * e2y - e1y * e2x;
  const dot = cx * patchNormal.x + cy * patchNormal.y + cz * patchNormal.z;
  return dot >= 0 ? [i0, i1, i2] : [i0, i2, i1];
}

/**
 * Polygone plan : triangulation oreilles en UV (concave) avec repli éventail.
 * Faces verticales le long des arêtes **bord libre** (un seul pan incident) jusqu’au Z minimal du modèle.
 *
 * @param uvMapper — optionnel : projection satellite top-down. Reçoit (wx, wy) monde → retourne UV [0,1]
 *   avec u = xPx/declaredW et v = 1 - yPx/declaredH (avant correction repeat/offset texture).
 *   Quand fourni, l’attribut `uv` est ajouté à la géométrie pour le matériau texturé.
 */
export function roofPatchGeometry(
  patch: RoofPlanePatch3D,
  uvMapper?: ((wx: number, wy: number) => { u: number; v: number }) | null,
): THREE.BufferGeometry {
  const corners = patch.cornersWorld;
  const n = corners.length;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = corners[i]!.x;
    positions[i * 3 + 1] = corners[i]!.y;
    positions[i * 3 + 2] = corners[i]!.z;
  }

  const uv2 = patchUvPoints2d(patch);
  let order = Array.from({ length: n }, (_, i) => i);
  if (signedArea2d(order.map((i) => uv2[i]!)) < 0) {
    order = order.slice().reverse();
  }
  const ccwUv = order.map((i) => uv2[i]!);
  let raw = triangulateSimplePolygon2dCcW(ccwUv);
  let indices: number[];
  if (raw != null) {
    const out: number[] = [];
    const mapOrig = (k: number) => order[k]!;
    for (let t = 0; t < raw.length; t += 3) {
      const a = mapOrig(raw[t]!);
      const b = mapOrig(raw[t + 1]!);
      const c = mapOrig(raw[t + 2]!);
      const w = triangleWindAlongNormal(a, b, c, corners, patch.normal);
      out.push(w[0], w[1], w[2]);
    }
    indices = out;
  } else {
    let orderXy = Array.from({ length: n }, (_, i) => i);
    const xyLoop = orderXy.map((i) => ({ x: corners[i]!.x, y: corners[i]!.y }));
    if (signedArea2d(xyLoop) < 0) {
      orderXy = orderXy.slice().reverse();
    }
    const ccwXy = orderXy.map((i) => ({ x: corners[i]!.x, y: corners[i]!.y }));
    raw = triangulateSimplePolygon2dCcW(ccwXy);
    if (raw != null) {
      const out: number[] = [];
      const mapOrig = (k: number) => orderXy[k]!;
      for (let t = 0; t < raw.length; t += 3) {
        const a = mapOrig(raw[t]!);
        const b = mapOrig(raw[t + 1]!);
        const c = mapOrig(raw[t + 2]!);
        const w = triangleWindAlongNormal(a, b, c, corners, patch.normal);
        out.push(w[0], w[1], w[2]);
      }
      indices = out;
    } else {
      indices = fanTriangulateIndices(n);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  const n3 = patch.normal;
  const normals = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    normals[i * 3] = n3.x;
    normals[i * 3 + 1] = n3.y;
    normals[i * 3 + 2] = n3.z;
  }
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));

  if (uvMapper) {
    const uvs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const { u, v } = uvMapper(corners[i]!.x, corners[i]!.y);
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = v;
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  }

  return geo;
}

const CLOSURE_LEN_EPS_M = 1e-5;
const CLOSURE_Z_EPS_M = 1e-4;
/** Arête à 2 pans avec |Δz|/Δxy au-dessus de ce seuil : rive rampante / pignon — on ferme verticalement jusqu’au Z min (complète le bord libre seul). */
const CLOSURE_TWO_PATCH_MIN_SLOPE_RATIO = 0.28;

export function roofClosureFacadeGeometry(model: RoofModel3D): THREE.BufferGeometry | null {
  const vmap = new Map(model.roofVertices.map((v) => [v.id, v.position] as const));
  let zBase = Infinity;
  for (const v of model.roofVertices) {
    if (Number.isFinite(v.position.z)) zBase = Math.min(zBase, v.position.z);
  }
  if (!Number.isFinite(zBase)) return null;

  let cx = 0;
  let cy = 0;
  let nv = 0;
  for (const v of model.roofVertices) {
    cx += v.position.x;
    cy += v.position.y;
    nv++;
  }
  if (nv === 0) return null;
  cx /= nv;
  cy /= nv;

  const positions: number[] = [];
  const normals: number[] = [];
  const idx: number[] = [];

  for (const e of model.roofEdges) {
    if (e.purpose !== "mesh_topology") continue;
    if (e.incidentPlanePatchIds.length !== 1) continue;

    const a = vmap.get(e.vertexAId);
    const b = vmap.get(e.vertexBId);
    if (!a || !b) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < CLOSURE_LEN_EPS_M) continue;

    if (Math.max(a.z, b.z) <= zBase + CLOSURE_Z_EPS_M) continue;

    let nx = dy;
    let ny = -dx;
    const nh = Math.hypot(nx, ny);
    if (nh < CLOSURE_LEN_EPS_M) continue;
    nx /= nh;
    ny /= nh;
    const mx = (a.x + b.x) * 0.5;
    const my = (a.y + b.y) * 0.5;
    if (nx * (mx - cx) + ny * (my - cy) < 0) {
      nx = -nx;
      ny = -ny;
    }

    const zb = zBase;
    const vo = positions.length / 3;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, b.x, b.y, zb, a.x, a.y, zb);
    for (let k = 0; k < 4; k++) {
      normals.push(nx, ny, 0);
    }
    idx.push(vo, vo + 2, vo + 1, vo, vo + 3, vo + 2);
  }

  for (const e of model.roofEdges) {
    if (e.purpose !== "mesh_topology") continue;
    if (e.incidentPlanePatchIds.length !== 2) continue;
    if (e.semantic?.kind === "ridge") continue;

    const a = vmap.get(e.vertexAId);
    const b = vmap.get(e.vertexBId);
    if (!a || !b) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const horiz = Math.hypot(dx, dy);
    if (horiz < CLOSURE_LEN_EPS_M) continue;
    if (Math.abs(dz) / horiz < CLOSURE_TWO_PATCH_MIN_SLOPE_RATIO) continue;

    const len = Math.hypot(dx, dy, dz);
    if (len < CLOSURE_LEN_EPS_M) continue;

    if (Math.max(a.z, b.z) <= zBase + CLOSURE_Z_EPS_M) continue;

    let nx = dy;
    let ny = -dx;
    const nh = Math.hypot(nx, ny);
    if (nh < CLOSURE_LEN_EPS_M) continue;
    nx /= nh;
    ny /= nh;
    const mx = (a.x + b.x) * 0.5;
    const my = (a.y + b.y) * 0.5;
    if (nx * (mx - cx) + ny * (my - cy) < 0) {
      nx = -nx;
      ny = -ny;
    }

    const zb = zBase;
    const vo = positions.length / 3;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, b.x, b.y, zb, a.x, a.y, zb);
    for (let k = 0; k < 4; k++) {
      normals.push(nx, ny, 0);
    }
    idx.push(vo, vo + 2, vo + 1, vo, vo + 3, vo + 2);
  }

  if (positions.length === 0) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(idx);
  return geo;
}

/** Segments arêtes toiture depuis roofVertices + roofEdges. */
export function roofEdgesLineGeometry(model: RoofModel3D): THREE.BufferGeometry | null {
  const map = new Map(model.roofVertices.map((v) => [v.id, v.position] as const));
  const positions: number[] = [];
  for (const e of model.roofEdges) {
    const a = map.get(e.vertexAId);
    const b = map.get(e.vertexBId);
    if (!a || !b) continue;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  if (positions.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

/**
 * Segments pour `roofRidges[]` : résolution arête → extrémités (WORLD), sans recalcul topologique.
 */
export function roofRidgesLineGeometry(model: RoofModel3D): THREE.BufferGeometry | null {
  const ridges = model.roofRidges;
  if (!ridges.length) return null;
  const edgeById = new Map(model.roofEdges.map((e) => [e.id, e] as const));
  const vmap = new Map(model.roofVertices.map((v) => [v.id, v.position] as const));
  const positions: number[] = [];
  for (const ridge of ridges) {
    for (const eid of ridge.roofEdgeIds) {
      const e = edgeById.get(eid);
      if (!e) continue;
      const a = vmap.get(e.vertexAId);
      const b = vmap.get(e.vertexBId);
      if (!a || !b) continue;
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  if (positions.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

/** Maillage volumique triangulé (obstacles, extensions, coque bâtiment). */
function volumeGeometry(vol: {
  readonly vertices: RoofObstacleVolume3D["vertices"];
  readonly faces: RoofObstacleVolume3D["faces"];
}): THREE.BufferGeometry {
  const verts = vol.vertices;
  const positions: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  const posByIndex = (vi: number) => {
    const p = verts[vi]!.position;
    return [p.x, p.y, p.z] as const;
  };

  for (const face of vol.faces) {
    const cyc = face.vertexIndexCycle;
    if (cyc.length < 3) continue;
    const base = vertexOffset;
    for (const vi of cyc) {
      const [x, y, z] = posByIndex(vi);
      positions.push(x, y, z);
      vertexOffset++;
    }
    const m = cyc.length;
    for (let i = 1; i < m - 1; i++) {
      indices.push(base, base + i, base + i + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function obstacleVolumeGeometry(vol: RoofObstacleVolume3D): THREE.BufferGeometry {
  return volumeGeometry(vol);
}

export function extensionVolumeGeometry(vol: RoofExtensionVolume3D): THREE.BufferGeometry {
  return volumeGeometry(vol);
}

export function buildingShellGeometry(shell: BuildingShell3D): THREE.BufferGeometry {
  return volumeGeometry(shell);
}

/** Quad panneau : deux triangles depuis corners3D (ordre canonique). */
export function panelQuadGeometry(panel: PvPanelSurface3D): THREE.BufferGeometry {
  const corners = panel.corners3D;
  const positions = new Float32Array(12);
  for (let i = 0; i < 4; i++) {
    positions[i * 3] = corners[i]!.x;
    positions[i * 3 + 1] = corners[i]!.y;
    positions[i * 3 + 2] = corners[i]!.z;
  }
  const indices = [0, 1, 2, 0, 2, 3];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  const n = panel.outwardNormal;
  const normals = new Float32Array(12);
  for (let i = 0; i < 4; i++) {
    normals[i * 3] = n.x;
    normals[i * 3 + 1] = n.y;
    normals[i * 3 + 2] = n.z;
  }
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return geo;
}
