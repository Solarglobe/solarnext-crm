/**
 * Sélection sommet toiture en mode modelage 3D : ignore PV/obstacles/extensions,
 * snap en espace écran (px) sur les coins du patch.
 */

import * as THREE from "three";
import type { Camera, Intersection, Object3D } from "three";
import type { ScenePickHit } from "./sceneInspectionTypes";
import { INSPECT_USERDATA_KEY } from "./sceneInspectionTypes";

export const ROOF_VERTEX_SCREEN_SNAP_PX_DEFAULT = 12;

function isRoofTessellationMesh(obj: Object3D): boolean {
  const raw = (obj.userData as Record<string, unknown> | undefined)?.[INSPECT_USERDATA_KEY];
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return r.kind === "PAN" && r.meshRole === "roof_tessellation" && typeof r.id === "string";
}

/** Intersections triées par distance caméra (premier = plus proche). */
export function filterIntersectionsToRoofTessellationOnly(
  intersections: readonly Intersection[],
): Intersection[] {
  const out = intersections.filter((h) => isRoofTessellationMesh(h.object));
  out.sort((a, b) => a.distance - b.distance);
  return out;
}

/**
 * Plus proche coin du maillage patch en coordonnées écran vs clic ;
 * `null` si aucun sommet dans le rayon `snapPx`.
 */
export function pickRoofVertexIndexScreenSpace(
  hit: Intersection,
  camera: Camera,
  canvasRect: DOMRect,
  clientX: number,
  clientY: number,
  snapPx: number = ROOF_VERTEX_SCREEN_SNAP_PX_DEFAULT,
): number | null {
  const obj = hit.object;
  if (!(obj instanceof THREE.Mesh)) return null;
  const g = obj.geometry;
  if (!(g instanceof THREE.BufferGeometry)) return null;
  const pos = g.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos || pos.itemSize < 3) return null;
  const nVerts = pos.count;
  if (nVerts < 3) return null;

  const v = new THREE.Vector3();
  let bestI: number | null = null;
  let bestD = Infinity;
  for (let i = 0; i < nVerts; i++) {
    v.fromBufferAttribute(pos, i);
    obj.localToWorld(v);
    v.project(camera);
    const sx = (v.x * 0.5 + 0.5) * canvasRect.width + canvasRect.left;
    const sy = (-v.y * 0.5 + 0.5) * canvasRect.height + canvasRect.top;
    const d = Math.hypot(clientX - sx, clientY - sy);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  if (bestI == null || bestD > snapPx) return null;
  return bestI;
}

export type RoofVertexModelingPickContext = {
  readonly camera: Camera;
  readonly canvasRect: DOMRect;
  readonly clientX: number;
  readonly clientY: number;
  readonly snapPx?: number;
};

/**
 * Pick dédié édition toiture : uniquement maillage `roof_tessellation`, snap sommet en px.
 * Retourne `null` si pas de toit touché ou aucun sommet dans le seuil.
 */
export function pickSceneHitForRoofVertexModeling(
  intersections: readonly Intersection[],
  ctx: RoofVertexModelingPickContext,
): ScenePickHit | null {
  const roofHits = filterIntersectionsToRoofTessellationOnly(intersections);
  const hit = roofHits[0];
  if (!hit) return null;

  const raw = (hit.object.userData as Record<string, unknown> | undefined)?.[INSPECT_USERDATA_KEY];
  if (!raw || typeof raw !== "object") return null;
  const id = (raw as { id?: unknown }).id;
  if (typeof id !== "string" || id.length === 0) return null;

  const snap = ctx.snapPx ?? ROOF_VERTEX_SCREEN_SNAP_PX_DEFAULT;
  const vi = pickRoofVertexIndexScreenSpace(
    hit,
    ctx.camera,
    ctx.canvasRect,
    ctx.clientX,
    ctx.clientY,
    snap,
  );
  if (vi == null) return null;
  return { kind: "roof_vertex", roofPlanePatchId: id, vertexIndexInPatch: vi };
}
