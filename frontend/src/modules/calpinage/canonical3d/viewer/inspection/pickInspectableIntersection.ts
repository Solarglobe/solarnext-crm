/**
 * Priorité clic : panneau PV > obstacle / extension > pan toiture > enveloppe shell
 * (à distance égale : type prime, puis distance minimale).
 */

import type { Intersection, Object3D } from "three";
import { indexedMeshClosestVertexIndexToPoint } from "./indexedMeshClosestVertexIndexToPoint";
import type {
  SceneInspectableKind,
  SceneInspectionSelection,
  SceneInspectMeshRole,
  SceneInspectUserData,
  ScenePickHit,
} from "./sceneInspectionTypes";
import { INSPECT_USERDATA_KEY } from "./sceneInspectionTypes";

const PRIORITY: Record<SceneInspectableKind, number> = {
  PV_PANEL: 0,
  OBSTACLE: 1,
  EXTENSION: 1,
  PAN: 2,
  SHELL: 3,
};

const MESH_ROLES = new Set<SceneInspectMeshRole>(["volume_surface", "roof_tessellation", "shell_tessellation"]);

function readInspectData(obj: Object3D): SceneInspectUserData | null {
  const raw = (obj.userData as Record<string, unknown> | undefined)?.[INSPECT_USERDATA_KEY];
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  const id = r.id;
  if (
    kind !== "PAN" &&
    kind !== "PV_PANEL" &&
    kind !== "OBSTACLE" &&
    kind !== "EXTENSION" &&
    kind !== "SHELL"
  ) {
    return null;
  }
  if (typeof id !== "string" || id.length === 0) return null;
  const mr = r.meshRole;
  let meshRole: SceneInspectMeshRole | undefined;
  if (typeof mr === "string" && MESH_ROLES.has(mr as SceneInspectMeshRole)) {
    meshRole = mr as SceneInspectMeshRole;
  }
  return meshRole != null ? { kind: kind as SceneInspectableKind, id, meshRole } : { kind: kind as SceneInspectableKind, id };
}

function inspectHitToScenePickHit(data: SceneInspectUserData, hit: Intersection): ScenePickHit {
  switch (data.kind) {
    case "PV_PANEL":
      return { kind: "pv_panel", panelId: data.id };
    case "OBSTACLE":
      return { kind: "obstacle_volume", volumeId: data.id };
    case "EXTENSION":
      return { kind: "extension_volume", volumeId: data.id };
    case "PAN": {
      if (data.meshRole === "roof_tessellation") {
        const vi = indexedMeshClosestVertexIndexToPoint(hit);
        if (vi != null) {
          return { kind: "roof_vertex", roofPlanePatchId: data.id, vertexIndexInPatch: vi };
        }
      }
      return { kind: "roof_patch", roofPlanePatchId: data.id };
    }
    case "SHELL": {
      if (data.meshRole === "shell_tessellation") {
        const vi = indexedMeshClosestVertexIndexToPoint(hit);
        if (vi != null) {
          return { kind: "shell_vertex", shellId: data.id, vertexIndex: vi };
        }
      }
      return { kind: "shell_envelope", shellId: data.id };
    }
    default: {
      const _exhaustive: never = data.kind;
      return _exhaustive;
    }
  }
}

export function scenePickHitToInspectionSelection(hit: ScenePickHit): SceneInspectionSelection {
  switch (hit.kind) {
    case "roof_patch":
      return { kind: "PAN", id: hit.roofPlanePatchId };
    case "roof_vertex":
      return { kind: "PAN", id: hit.roofPlanePatchId, roofVertexIndexInPatch: hit.vertexIndexInPatch };
    case "shell_envelope":
      return { kind: "SHELL", id: hit.shellId };
    case "shell_vertex":
      return { kind: "SHELL", id: hit.shellId, shellVertexIndex: hit.vertexIndex };
    case "pv_panel":
      return { kind: "PV_PANEL", id: hit.panelId };
    case "obstacle_volume":
      return { kind: "OBSTACLE", id: hit.volumeId };
    case "extension_volume":
      return { kind: "EXTENSION", id: hit.volumeId };
    default: {
      const _e: never = hit;
      return _e;
    }
  }
}

/**
 * Hit canonique 3D (IDs stables + indices sommet quand le maillage le permet).
 */
export function pickSceneHitFromIntersections(intersections: readonly Intersection[]): ScenePickHit | null {
  type Cand = { distance: number; data: SceneInspectUserData; hit: Intersection };
  const candidates: Cand[] = [];
  for (const hit of intersections) {
    const data = readInspectData(hit.object);
    if (data) candidates.push({ distance: hit.distance, data, hit });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const pa = PRIORITY[a.data.kind];
    const pb = PRIORITY[b.data.kind];
    if (pa !== pb) return pa - pb;
    return a.distance - b.distance;
  });
  const { data, hit } = candidates[0]!;
  return inspectHitToScenePickHit(data, hit);
}

/**
 * À partir des intersections R3F / Three (ordonnées par distance), choisit la cible d’inspection.
 */
export function pickInspectableIntersection(intersections: readonly Intersection[]): SceneInspectionSelection | null {
  const hit = pickSceneHitFromIntersections(intersections);
  return hit == null ? null : scenePickHitToInspectionSelection(hit);
}
