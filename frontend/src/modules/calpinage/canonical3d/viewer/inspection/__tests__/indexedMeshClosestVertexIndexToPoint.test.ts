import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { indexedMeshClosestVertexIndexToPoint } from "../indexedMeshClosestVertexIndexToPoint";

describe("indexedMeshClosestVertexIndexToPoint", () => {
  it("choisit le sommet du triangle indexé le plus proche du point d’impact", () => {
    const positions = new Float32Array([
      0, 0, 0,
      10, 0, 0,
      0, 10, 0,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex([0, 1, 2]);
    const mesh = new THREE.Mesh(geo);
    const hit = {
      object: mesh,
      faceIndex: 0,
      point: new THREE.Vector3(9, 0, 0),
    };
    expect(indexedMeshClosestVertexIndexToPoint(hit)).toBe(1);
  });

  it("fonctionne sans index (sommets consécutifs par face)", () => {
    const positions = new Float32Array([
      0, 0, 0,
      5, 0, 0,
      0, 5, 0,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mesh = new THREE.Mesh(geo);
    const hit = {
      object: mesh,
      faceIndex: 0,
      point: new THREE.Vector3(0.1, 0, 0),
    };
    expect(indexedMeshClosestVertexIndexToPoint(hit)).toBe(0);
  });

  it("retourne null si faceIndex manquant", () => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry());
    expect(
      indexedMeshClosestVertexIndexToPoint({
        object: mesh,
        faceIndex: undefined,
        point: new THREE.Vector3(),
      }),
    ).toBeNull();
  });
});
