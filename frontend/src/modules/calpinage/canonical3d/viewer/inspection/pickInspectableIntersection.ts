/**
 * Priorité clic : panneau PV > obstacle / extension > pan toiture (même distance : type prime).
 */

import type { Intersection, Object3D } from "three";
import type {
  SceneInspectableKind,
  SceneInspectionSelection,
  SceneInspectUserData,
} from "./sceneInspectionTypes";
import { INSPECT_USERDATA_KEY } from "./sceneInspectionTypes";

const PRIORITY: Record<SceneInspectableKind, number> = {
  PV_PANEL: 0,
  OBSTACLE: 1,
  EXTENSION: 1,
  PAN: 2,
};

function readInspectData(obj: Object3D): SceneInspectUserData | null {
  const raw = (obj.userData as Record<string, unknown> | undefined)?.[INSPECT_USERDATA_KEY];
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  const id = r.id;
  if (kind !== "PAN" && kind !== "PV_PANEL" && kind !== "OBSTACLE" && kind !== "EXTENSION") return null;
  if (typeof id !== "string" || id.length === 0) return null;
  return { kind: kind as SceneInspectableKind, id };
}

/**
 * À partir des intersections R3F / Three (ordonnées par distance), choisit la cible d’inspection.
 */
export function pickInspectableIntersection(intersections: readonly Intersection[]): SceneInspectionSelection | null {
  const candidates: { distance: number; data: SceneInspectUserData }[] = [];
  for (const hit of intersections) {
    const data = readInspectData(hit.object);
    if (data) {
      candidates.push({ distance: hit.distance, data });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const pa = PRIORITY[a.data.kind];
    const pb = PRIORITY[b.data.kind];
    if (pa !== pb) return pa - pb;
    return a.distance - b.distance;
  });
  const best = candidates[0]!.data;
  return { kind: best.kind, id: best.id };
}
