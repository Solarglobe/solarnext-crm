/**
 * Pass 4 — câble technique pose PV : intersection rayon / pan (3D) → point image → `__calpinageCommitPvPlacementFrom3DImagePoint` (legacy).
 * Aligné sur la chaîne Phase 3 (`pvPlacementEngine.createBlock` + contexte bloc).
 */

import { worldPointToImage } from "../canonical3d/world/worldToImage";
import type { CanonicalWorldConfig } from "../canonical3d/world/worldConvention";

export type PvPlacementFrom3dCommitResult =
  | {
      readonly ok: true;
      readonly blockId: string | null;
      readonly panId: string;
      readonly imagePx: { readonly x: number; readonly y: number };
    }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly panId?: string };

type LegacyCommitFn = (
  panId: string,
  centerImage: { x: number; y: number },
) => { ok?: boolean; code?: string; message?: string; blockId?: string | null };

function readLegacyCommit(): LegacyCommitFn | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __calpinageCommitPvPlacementFrom3DImagePoint?: LegacyCommitFn };
  return typeof w.__calpinageCommitPvPlacementFrom3DImagePoint === "function"
    ? w.__calpinageCommitPvPlacementFrom3DImagePoint
    : null;
}

/**
 * Convertit un point monde (intersection rayon / maillage pan) en px image puis tente la création de bloc Phase 3.
 */
export function tryCommitPvPlacementFrom3dRoofHit(input: {
  readonly panId: string;
  readonly worldPointM: { readonly x: number; readonly y: number; readonly z: number };
  readonly worldConfig: CanonicalWorldConfig;
}): PvPlacementFrom3dCommitResult {
  const img = worldPointToImage(input.worldPointM, input.worldConfig);
  const fn = readLegacyCommit();
  if (!fn) {
    return { ok: false, code: "LEGACY_UNAVAILABLE", message: "Passerelle calpinage legacy non chargée." };
  }
  const r = fn(String(input.panId), { x: img.x, y: img.y });
  if (r && typeof r === "object" && r.ok === false) {
    return {
      ok: false,
      code: String((r as { code?: string }).code ?? "COMMIT_REJECT"),
      message: String((r as { message?: string }).message ?? "Refus legacy."),
      panId: input.panId,
    };
  }
  const blockId = (r as { blockId?: string | null } | null)?.blockId ?? null;
  return {
    ok: true,
    blockId,
    panId: String(input.panId),
    imagePx: { x: img.x, y: img.y },
  };
}
