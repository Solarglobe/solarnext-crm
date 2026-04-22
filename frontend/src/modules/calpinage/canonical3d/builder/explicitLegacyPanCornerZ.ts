/**
 * Sommets legacy avec `heightM` explicite (provenant du runtime `h` / `heightM` sur le polygone pan).
 * Ne doivent pas être réécrits par unify / impose / clamp spike — source de vérité utilisateur.
 */

import type { LegacyImagePoint2D } from "./legacyInput";

export function legacyPanRawCornerHasExplicitHeightM(
  raw: readonly LegacyImagePoint2D[],
  ci: number,
): boolean {
  const p = raw[ci];
  if (!p) return false;
  const hm = p.heightM;
  return hm !== undefined && hm !== null && typeof hm === "number" && Number.isFinite(hm);
}
