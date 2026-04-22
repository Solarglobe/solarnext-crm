import { describe, expect, it } from "vitest";
import { computeOfficialPanPhysicsFromCornersWorld, azimuthDegOfFallDirectionEnu } from "../../builder/officialPanPhysics";
import { vec3 } from "../../utils/math3";

describe("computeOfficialPanPhysicsFromCornersWorld", () => {
  it("toit horizontal : pente ~0°, normale verticale", () => {
    const corners = [
      vec3(0, 0, 5),
      vec3(10, 0, 5),
      vec3(10, 10, 5),
      vec3(0, 10, 5),
    ];
    const o = computeOfficialPanPhysicsFromCornersWorld(corners);
    expect(o.source).toBe("newell_corners_world");
    expect(o.slopeDeg).not.toBeNull();
    expect(o.slopeDeg!).toBeLessThan(0.1);
    expect(o.normal.z).toBeGreaterThan(0.99);
  });

  it("plan incliné : pente > 0 et direction de chute horizontale cohérente", () => {
    const corners = [
      vec3(0, 0, 0),
      vec3(10, 0, 0),
      vec3(10, 10, 2),
      vec3(0, 10, 2),
    ];
    const o = computeOfficialPanPhysicsFromCornersWorld(corners);
    expect(o.source).toBe("newell_corners_world");
    expect(o.slopeDeg).not.toBeNull();
    expect(o.slopeDeg!).toBeGreaterThan(5);
    expect(o.fallDirectionEnu).not.toBeNull();
    const azFall = azimuthDegOfFallDirectionEnu(o.fallDirectionEnu!);
    expect(Number.isFinite(azFall)).toBe(true);
  });

  it("moins de 3 sommets : pas de géométrie newell", () => {
    const o = computeOfficialPanPhysicsFromCornersWorld([vec3(0, 0, 0), vec3(1, 0, 0)]);
    expect(o.source).toBe("insufficient_vertices");
    expect(o.slopeDeg).toBeNull();
  });
});
