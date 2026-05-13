import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  positionFromOrbitSpherical,
  readOrbitSpherical,
  smoothstep01,
  worldEastUnitFromNorthDeg,
} from "../cameraOrbitContinuity";

const Z_UP = new THREE.Vector3(0, 0, 1);

describe("cameraOrbitContinuity", () => {
  it("worldEastUnitFromNorthDeg — 0° = +X", () => {
    const e = worldEastUnitFromNorthDeg(0);
    expect(e.x).toBeCloseTo(1, 5);
    expect(e.y).toBeCloseTo(0, 5);
    expect(e.z).toBeCloseTo(0, 5);
  });

  it("readOrbitSpherical / positionFromOrbitSpherical — aller-retour", () => {
    const target = new THREE.Vector3(10, 20, 3);
    const sp0 = new THREE.Spherical(55, 0.35, 0.42);
    const pos = positionFromOrbitSpherical(target, sp0, Z_UP);
    const sp1 = readOrbitSpherical(pos, target, Z_UP);
    expect(sp1.radius).toBeCloseTo(sp0.radius, 3);
    expect(sp1.phi).toBeCloseTo(sp0.phi, 3);
    expect(sp1.theta).toBeCloseTo(sp0.theta, 3);
  });

  it("smoothstep01 — bords", () => {
    expect(smoothstep01(-1)).toBe(0);
    expect(smoothstep01(2)).toBe(1);
    expect(smoothstep01(0.5)).toBeCloseTo(0.5, 2);
  });
});
