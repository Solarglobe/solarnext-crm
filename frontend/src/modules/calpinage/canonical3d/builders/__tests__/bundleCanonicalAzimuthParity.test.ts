import { describe, expect, it } from "vitest";
import { vec3 } from "../../utils/math3";
import { computeOfficialPanPhysicsFromCornersWorld } from "../../builder/officialPanPhysics";
import {
  buildCornersWorldFromImageVertices,
  computeOfficialPanPhysicsFromImageVertices,
} from "../../builder/computeOfficialPanPhysicsFromImageVertices";

/**
 * Parité stricte : chemin « sommets image + mpp + north » vs polygone monde explicite.
 * Le bundle reproduit la même chaîne que `computeOfficialPanPhysicsFromImageVertices`.
 */
describe("Prompt 4B — parité pente / azimut image ↔ monde ENU", () => {
  const mpp = 0.0237;
  const north = 41.3;
  const verts = [
    { x: 120, y: 88 },
    { x: 410, y: 95 },
    { x: 400, y: 320 },
    { x: 105, y: 305 },
  ];
  const zM = [4.1, 4.25, 5.02, 4.88];

  it("même pente et même azimut (tolérance 1e-9°)", () => {
    const viaImage = computeOfficialPanPhysicsFromImageVertices(
      verts,
      (_pt, i) => zM[i]!,
      mpp,
      north,
      vec3(0, 0, 1),
    );
    const corners = buildCornersWorldFromImageVertices(verts, (_pt, i) => zM[i]!, mpp, north);
    expect(corners).not.toBeNull();
    const viaWorld = computeOfficialPanPhysicsFromCornersWorld(corners!, vec3(0, 0, 1));

    expect(viaImage.source).toBe("newell_corners_world");
    expect(viaWorld.source).toBe("newell_corners_world");
    expect(viaImage.slopeDeg).toBeCloseTo(viaWorld.slopeDeg!, 9);
    expect(viaImage.azimuthDeg).toBeCloseTo(viaWorld.azimuthDeg!, 9);
    expect(viaImage.normal.x).toBeCloseTo(viaWorld.normal.x, 9);
    expect(viaImage.normal.y).toBeCloseTo(viaWorld.normal.y, 9);
    expect(viaImage.normal.z).toBeCloseTo(viaWorld.normal.z, 9);
  });

  it("plusieurs nord / mpp : écart image vs monde toujours nul", () => {
    for (const n of [0, -17.5, 90]) {
      for (const m of [0.01, 0.05]) {
        const a = computeOfficialPanPhysicsFromImageVertices(verts, (_pt, i) => zM[i]!, m, n);
        const c = buildCornersWorldFromImageVertices(verts, (_pt, i) => zM[i]!, m, n);
        expect(c).not.toBeNull();
        const b = computeOfficialPanPhysicsFromCornersWorld(c!, vec3(0, 0, 1));
        expect(a.azimuthDeg).toBeCloseTo(b.azimuthDeg!, 9);
        expect(a.slopeDeg).toBeCloseTo(b.slopeDeg!, 9);
      }
    }
  });
});
