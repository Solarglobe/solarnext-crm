/**
 * Sérialisation JSON de `SolarScene3D` — replay, debug, futur client Three.js (import JSON).
 */

import type { SolarScene3D } from "../types/solarScene3d";
import { serializeJsonStableSorted } from "../utils/serialization";

/**
 * JSON déterministe (clés triées en profondeur) — deux scènes égales → même chaîne (hors flottants).
 */
export function serializeSolarScene3DStableSorted(scene: SolarScene3D): string {
  return serializeJsonStableSorted(scene as unknown);
}

export function serializeSolarScene3D(scene: SolarScene3D): string {
  return JSON.stringify(scene);
}

export function parseSolarScene3DJson(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
