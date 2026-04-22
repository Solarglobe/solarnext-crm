/**
 * Agrégation du « signal hauteur » sur la construction toiture legacy → RoofModel3D.
 * Stable pour logs / tests produit (Prompt 3).
 */

import type { LegacyRoofGeometryInput } from "./legacyInput";
import type { HeightResolutionTrace } from "./heightConstraints";

export type RoofHeightSignalStatus = "SUFFICIENT" | "PARTIAL" | "MISSING" | "INVALID";

export type RoofHeightSignalDiagnostics = {
  readonly heightSignalStatus: RoofHeightSignalStatus;
  readonly explicitVertexHeightCount: number;
  readonly interpolatedVertexHeightCount: number;
  readonly fallbackVertexHeightCount: number;
  /** true si Z=0 provient d’un repli `defaultHeightM === 0`, pas d’une cote explicite sommet. */
  readonly usedSyntheticZeroHeight: boolean;
  readonly heightWarnings: readonly string[];
  /**
   * false si la pente affichée ne peut pas être présentée comme « reconstruite depuis des cotes mesurées »
   * (repli global / signal insuffisant).
   */
  readonly inclinedRoofGeometryTruthful: boolean;
};

export function emptyRoofHeightSignalDiagnostics(): RoofHeightSignalDiagnostics {
  return {
    heightSignalStatus: "INVALID",
    explicitVertexHeightCount: 0,
    interpolatedVertexHeightCount: 0,
    fallbackVertexHeightCount: 0,
    usedSyntheticZeroHeight: false,
    heightWarnings: [],
    inclinedRoofGeometryTruthful: false,
  };
}

function isInterpolatedTrace(source: string): boolean {
  return (
    source === "pan_local_mean" ||
    source.includes("interpolated") ||
    source === "structural_ridge_endpoint" ||
    source === "structural_trait_endpoint"
  );
}

/**
 * Agrège les traces `heightConstraints` par coin après `resolveZForPanCorner`.
 */
export function computeRoofHeightSignalFromLegacyCornerTraces(
  input: LegacyRoofGeometryInput,
  tracesPerPan: readonly (readonly HeightResolutionTrace[])[],
): RoofHeightSignalDiagnostics {
  let explicitVertexHeightCount = 0;
  let interpolatedVertexHeightCount = 0;
  let fallbackVertexHeightCount = 0;
  const heightWarnings: string[] = [];

  for (const traces of tracesPerPan) {
    for (const t of traces) {
      const s = t.source;
      if (s === "explicit_polygon_vertex") explicitVertexHeightCount++;
      else if (s === "default_global") fallbackVertexHeightCount++;
      else if (isInterpolatedTrace(s)) interpolatedVertexHeightCount++;
      else fallbackVertexHeightCount++;
    }
  }

  const totalVerts = tracesPerPan.reduce((acc, row) => acc + row.length, 0);

  const usedSyntheticZeroHeight =
    input.defaultHeightM === 0 && fallbackVertexHeightCount > 0;
  if (usedSyntheticZeroHeight) {
    heightWarnings.push("SYNTHETIC_ZERO_VIA_DEFAULT_HEIGHT_M");
  }

  let heightSignalStatus: RoofHeightSignalStatus;
  if (totalVerts === 0) {
    heightSignalStatus = "INVALID";
  } else if (fallbackVertexHeightCount === totalVerts) {
    heightSignalStatus = "MISSING";
  } else if (fallbackVertexHeightCount === 0) {
    heightSignalStatus = "SUFFICIENT";
  } else {
    heightSignalStatus = "PARTIAL";
  }

  if (heightSignalStatus !== "SUFFICIENT") {
    heightWarnings.push(`HEIGHT_SIGNAL_${heightSignalStatus}`);
  }

  const inclinedRoofGeometryTruthful =
    heightSignalStatus === "SUFFICIENT" && !usedSyntheticZeroHeight;

  return {
    heightSignalStatus,
    explicitVertexHeightCount,
    interpolatedVertexHeightCount,
    fallbackVertexHeightCount,
    usedSyntheticZeroHeight,
    heightWarnings,
    inclinedRoofGeometryTruthful,
  };
}
