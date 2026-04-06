/**
 * Prédicats et guards non destructifs.
 */

import type { PlaneEquation } from "../types/plane";
import type { StableEntityId } from "../types/primitives";
import type { Vector3 } from "../types/primitives";
import { length3 } from "./math3";

export function isNonEmptyStableId(id: string): id is StableEntityId {
  return typeof id === "string" && id.length > 0;
}

/**
 * Garde runtime : objet inconnu ressemble à un Vector3 fini.
 * (Nom explicite pour éviter collision avec `isFiniteVec3` dans math3.)
 */
export function isUnknownFiniteVec3(v: unknown): v is Vector3 {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.x === "number" &&
    Number.isFinite(o.x) &&
    typeof o.y === "number" &&
    Number.isFinite(o.y) &&
    typeof o.z === "number" &&
    Number.isFinite(o.z)
  );
}

/** Normale unitaire à tolérance près pour PlaneEquation. */
export function isUnitNormalPlane(e: PlaneEquation, eps = 1e-4): boolean {
  const n = e.normal;
  const len = length3(n);
  return Math.abs(len - 1) < eps && Number.isFinite(e.d);
}
