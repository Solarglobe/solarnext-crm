import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { pickInspectableIntersection } from "../pickInspectableIntersection";
import { INSPECT_USERDATA_KEY } from "../sceneInspectionTypes";

function makeHit(distance: number, kind: string, id: string): THREE.Intersection {
  const mesh = new THREE.Mesh();
  mesh.userData[INSPECT_USERDATA_KEY] = { kind, id };
  return {
    distance,
    object: mesh,
    point: new THREE.Vector3(),
    face: null,
    faceIndex: 0,
    uv: undefined,
  } as unknown as THREE.Intersection;
}

describe("pickInspectableIntersection", () => {
  it("retourne null si aucune cible", () => {
    const mesh = new THREE.Mesh();
    expect(pickInspectableIntersection([{ distance: 1, object: mesh } as THREE.Intersection])).toBeNull();
  });

  it("priorité panneau sur pan plus proche derrière", () => {
    const hits = [makeHit(5, "PAN", "p1"), makeHit(6, "PV_PANEL", "pv1")];
    const r = pickInspectableIntersection(hits);
    expect(r?.kind).toBe("PV_PANEL");
    expect(r?.id).toBe("pv1");
  });

  it("à priorité égale, distance minimale", () => {
    const hits = [makeHit(10, "OBSTACLE", "o2"), makeHit(3, "OBSTACLE", "o1")];
    const r = pickInspectableIntersection(hits);
    expect(r?.id).toBe("o1");
  });

  it("obstacle avant pan à distance similaire", () => {
    const hits = [makeHit(4, "PAN", "p1"), makeHit(4.1, "OBSTACLE", "o1")];
    const r = pickInspectableIntersection(hits);
    expect(r?.kind).toBe("OBSTACLE");
  });
});
