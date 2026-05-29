import type { StableEntityId, Vector3 } from "../types/primitives";

export type RoofDormerParametricVersion = "roof_dormer_parametric_v1";

export type RoofDormerParametricTopology = "gable_trapezoid";

export type RoofDormerHeightReference = "support_plane_normal";

export interface RoofDormerParametricPoint2D {
  readonly uM: number;
  readonly vM: number;
}

export interface RoofDormerParametricFootprint {
  readonly frontLeft: RoofDormerParametricPoint2D;
  readonly frontRight: RoofDormerParametricPoint2D;
  readonly rearRight: RoofDormerParametricPoint2D;
  readonly rearLeft: RoofDormerParametricPoint2D;
}

export interface RoofDormerParametricRidge {
  readonly front: RoofDormerParametricPoint2D;
  readonly rear: RoofDormerParametricPoint2D;
}

export interface RoofDormerParametricHeights {
  readonly reference: RoofDormerHeightReference;
  readonly facadeHeightM: number;
  readonly ridgeHeightM: number;
  readonly roofRiseM: number;
}

export interface RoofDormerParametricOrientation {
  readonly uAxisWorld: Vector3;
  readonly vAxisWorld: Vector3;
}

export interface RoofDormerParametricRendering {
  readonly materialFamily: "roof_dormer_parametric_premium";
  readonly showDebugGeometry: boolean;
}

export interface RoofDormerParametricPreparedUses {
  readonly render: "parametric_mesh";
  readonly keepout: "parametric_footprint";
  readonly shading: "parametric_mesh";
  readonly raycast: "parametric_mesh";
  readonly collisions: "parametric_mesh";
  readonly safeZones: "parametric_footprint_offset";
}

/**
 * Parallel dormer model. It is intentionally not a legacy roofExtension shape:
 * no point.h, no dormerModel, no canonicalDormerGeometry, no free height fields.
 */
export interface RoofDormerParametricModel {
  readonly version: RoofDormerParametricVersion;
  readonly id: StableEntityId;
  readonly supportPanId: StableEntityId;
  readonly topology: RoofDormerParametricTopology;
  readonly anchorWorld: Vector3;
  readonly orientation: RoofDormerParametricOrientation;
  readonly footprint: RoofDormerParametricFootprint;
  readonly ridge: RoofDormerParametricRidge;
  readonly heights: RoofDormerParametricHeights;
  readonly eaveOverhangM: number;
  readonly flashingOffsetM: number;
  readonly keepoutOffsetM: number;
  readonly render: RoofDormerParametricRendering;
  readonly preparedUses: RoofDormerParametricPreparedUses;
}

export interface RoofDormerParametric2DDraft {
  readonly id: StableEntityId;
  readonly supportPanId: StableEntityId;
  readonly anchorWorld: Vector3;
  readonly orientation?: RoofDormerParametricOrientation;
  readonly footprint: RoofDormerParametricFootprint;
  readonly ridge: RoofDormerParametricRidge;
  readonly facadeHeightM: number;
  readonly ridgeHeightM: number;
  readonly eaveOverhangM?: number;
  readonly flashingOffsetM?: number;
  readonly keepoutOffsetM?: number;
}

export const ROOF_DORMER_PARAMETRIC_PREPARED_USES: RoofDormerParametricPreparedUses = {
  render: "parametric_mesh",
  keepout: "parametric_footprint",
  shading: "parametric_mesh",
  raycast: "parametric_mesh",
  collisions: "parametric_mesh",
  safeZones: "parametric_footprint_offset",
};

export function createRoofDormerParametricModelFromDraft(
  draft: RoofDormerParametric2DDraft,
): RoofDormerParametricModel {
  const roofRiseM = draft.ridgeHeightM - draft.facadeHeightM;
  if (roofRiseM <= 0) {
    throw new Error(
      `ROOF_DORMER_PARAMETRIC_INVALID_RISE: ridgeHeightM (${draft.ridgeHeightM}) must be strictly greater than facadeHeightM (${draft.facadeHeightM}). roofRiseM=${roofRiseM}.`,
    );
  }
  return {
    version: "roof_dormer_parametric_v1",
    id: draft.id,
    supportPanId: draft.supportPanId,
    topology: "gable_trapezoid",
    anchorWorld: draft.anchorWorld,
    orientation: draft.orientation ?? {
      uAxisWorld: { x: 1, y: 0, z: 0 },
      vAxisWorld: { x: 0, y: 1, z: 0 },
    },
    footprint: draft.footprint,
    ridge: draft.ridge,
    heights: {
      reference: "support_plane_normal",
      facadeHeightM: draft.facadeHeightM,
      ridgeHeightM: draft.ridgeHeightM,
      roofRiseM,
    },
    eaveOverhangM: draft.eaveOverhangM ?? 0.30, // 30 cm : debord de rive standard (M22 -- 0.04 etait une erreur d'unite)
    flashingOffsetM: draft.flashingOffsetM ?? 0.02,
    keepoutOffsetM: draft.keepoutOffsetM ?? 0.08,
    render: {
      materialFamily: "roof_dormer_parametric_premium",
      showDebugGeometry: false,
    },
    preparedUses: ROOF_DORMER_PARAMETRIC_PREPARED_USES,
  };
}
