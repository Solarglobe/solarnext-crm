import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { computeViewerFraming, boundingBoxSignature } from "../viewerFraming";

describe("computeViewerFraming", () => {
  it("produit near < far, distances orbit bornées, cible au centre", () => {
    const box = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(5, -3, 12), new THREE.Vector3(20, 24, 4));
    const f = computeViewerFraming(box, 16 / 9);
    expect(f.near).toBeGreaterThan(0);
    expect(f.far).toBeGreaterThan(f.near * 2);
    expect(f.minDistance).toBeGreaterThan(0);
    expect(f.maxDistance).toBeGreaterThan(f.minDistance);
    const c = new THREE.Vector3();
    box.getCenter(c);
    expect(f.target.distanceTo(c)).toBeLessThan(1e-5);
    expect(f.position.distanceTo(c)).toBeGreaterThan(f.minDistance);
  });

  it("reframing : signature change quand la boîte change", () => {
    const a = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1));
    const b = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(10, 0, 0), new THREE.Vector3(1, 1, 1));
    expect(boundingBoxSignature(a)).not.toBe(boundingBoxSignature(b));
  });

  it("aspect dégénéré retombe sur 1", () => {
    const box = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(0, 0, 5), new THREE.Vector3(2, 2, 2));
    const f = computeViewerFraming(box, 0);
    expect(Number.isFinite(f.position.x)).toBe(true);
    expect(Number.isFinite(f.far)).toBe(true);
  });
});
