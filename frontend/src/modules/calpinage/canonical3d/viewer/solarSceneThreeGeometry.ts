/**
 * Conversion fidèle SolarScene3D → géométries Three.js (aucun recalcul métier — uniquement tessellation affichage).
 *
 * Repère : coordonnées monde canoniques copiées telles quelles (x,y,z) → attributs Three.js.
 * Voir `docs/architecture/3d-world-convention.md`, `canonical3d/world/unifiedWorldFrame.ts` et `core/worldConvention.ts` (`worldPointToViewer`).
 */

import * as THREE from "three";
import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { RoofObstacleVolume3D } from "../types/roof-obstacle-volume";
import type { RoofExtensionVolume3D } from "../types/roof-extension-volume";
import type { PvPanelSurface3D } from "../types/pv-panel-3d";
import type { RoofModel3D } from "../types/model";

function fanTriangulateIndices(n: number): number[] {
  const idx: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    idx.push(0, i, i + 1);
  }
  return idx;
}

/** Polygone plan depuis coins monde (supposé simple / utilisable en éventail). */
export function roofPatchGeometry(patch: RoofPlanePatch3D): THREE.BufferGeometry {
  const corners = patch.cornersWorld;
  const n = corners.length;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = corners[i]!.x;
    positions[i * 3 + 1] = corners[i]!.y;
    positions[i * 3 + 2] = corners[i]!.z;
  }
  const indices = fanTriangulateIndices(n);
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

function volumeGeometry(vol: RoofObstacleVolume3D | RoofExtensionVolume3D): THREE.BufferGeometry {
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
