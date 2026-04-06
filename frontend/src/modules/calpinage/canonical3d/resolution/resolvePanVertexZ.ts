/**
 * Résolution Z officielle pour un sommet de pan (Prompt 21/22).
 * 1) `points[].h` / équivalent explicite sur le sommet
 * 2) Chaîne `resolveHeightAtXY` (structurants + fitPlane pan)
 */

import {
  HEIGHT_SOURCE_CONFIDENCE,
  isValidBuildingHeightM,
  resolveHeightAtXY,
  type HeightResolutionResult,
  type HeightResolverContext,
  type ResolveHeightOptions,
} from "../../core/heightResolver";

export type ResolvePanVertexZParams = {
  readonly xPx: number;
  readonly yPx: number;
  /** `h` ou `heightM` lu sur le point pan (runtime). */
  readonly explicitPanVertexH?: number | undefined;
  readonly panId: string;
  readonly context: HeightResolverContext;
  readonly options?: Omit<ResolveHeightOptions, "panId">;
};

/**
 * Z monde (m) pour un sommet de pan — ne dépend pas de tiltDeg / slope seuls.
 */
export function resolvePanVertexZ(params: ResolvePanVertexZParams): HeightResolutionResult {
  const { xPx, yPx, explicitPanVertexH, panId, context, options } = params;
  if (explicitPanVertexH !== undefined && isValidBuildingHeightM(explicitPanVertexH)) {
    return {
      ok: true,
      heightM: explicitPanVertexH,
      source: "explicit_pan_vertex_h",
      confidence: HEIGHT_SOURCE_CONFIDENCE.explicit_pan_vertex_h,
    };
  }
  return resolveHeightAtXY(xPx, yPx, context, { ...options, panId });
}
