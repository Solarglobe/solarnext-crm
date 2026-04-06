import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { computePlanOrthographicFraming } from "../viewerFraming";

describe("computePlanOrthographicFraming (Prompt 34)", () => {
  it("caméra au-dessus du centre (Z+) et frustum ortho englobe l’emprise XY", () => {
    const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 8, 2));
    const f = computePlanOrthographicFraming(box, 1);
    expect(f.position.z).toBeGreaterThan(f.target.z);
    expect(f.left).toBeLessThan(0);
    expect(f.right).toBeGreaterThan(0);
    expect(f.top).toBeGreaterThan(0);
    expect(f.bottom).toBeLessThan(0);
    expect(f.right - f.left).toBeGreaterThanOrEqual(f.top - f.bottom);
    expect(f.near).toBeGreaterThan(0);
    expect(f.far).toBeGreaterThan(f.near);
  });

  it("respect du ratio largeur / hauteur viewport", () => {
    const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(20, 10, 1));
    const wide = computePlanOrthographicFraming(box, 2);
    const narrow = computePlanOrthographicFraming(box, 0.5);
    const arWide = (wide.right - wide.left) / (wide.top - wide.bottom);
    const arNarrow = (narrow.right - narrow.left) / (narrow.top - narrow.bottom);
    expect(arWide).toBeCloseTo(2, 5);
    expect(arNarrow).toBeCloseTo(0.5, 5);
  });
});
