import type { NearShadingRaycastParams } from "../types/near-shading-3d";

export const DEFAULT_NEAR_SHADING_RAYCAST_PARAMS: NearShadingRaycastParams = {
  originEpsilonM: 1e-4,
  rayMaxLengthM: 1e9,
  useAabbBroadPhase: true,
};
