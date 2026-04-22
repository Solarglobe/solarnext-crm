import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  pickInspectableIntersection,
  pickSceneHitFromIntersections,
  scenePickHitToInspectionSelection,
} from "../pickInspectableIntersection";
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

function makeRoofTessellationHit(
  distance: number,
  panId: string,
  point: THREE.Vector3,
  faceIndex = 0,
): THREE.Intersection {
  const positions = new Float32Array([
    0, 0, 0,
    10, 0, 0,
    0, 10, 0,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex([0, 1, 2]);
  const mesh = new THREE.Mesh(geo);
  mesh.userData[INSPECT_USERDATA_KEY] = { kind: "PAN", id: panId, meshRole: "roof_tessellation" };
  return {
    distance,
    object: mesh,
    point,
    face: null,
    faceIndex,
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

  it("pan avant shell à distance similaire", () => {
    const hits = [makeHit(4, "SHELL", "calpinage-building-shell"), makeHit(4.05, "PAN", "p1")];
    const r = pickInspectableIntersection(hits);
    expect(r?.kind).toBe("PAN");
  });
});

describe("pickSceneHitFromIntersections / ScenePickHit", () => {
  it("remonte roof_vertex avec index sommet cohérent avec la géométrie indexée", () => {
    const hits = [makeRoofTessellationHit(2, "roof-a", new THREE.Vector3(9, 0, 0))];
    const pick = pickSceneHitFromIntersections(hits);
    expect(pick).toEqual({
      kind: "roof_vertex",
      roofPlanePatchId: "roof-a",
      vertexIndexInPatch: 1,
    });
    const sel = scenePickHitToInspectionSelection(pick!);
    expect(sel).toEqual({
      kind: "PAN",
      id: "roof-a",
      roofVertexIndexInPatch: 1,
    });
  });

  it("PAN sans meshRole → roof_patch (pas d’index sommet)", () => {
    const hits = [makeHit(1, "PAN", "legacy-pan")];
    expect(pickSceneHitFromIntersections(hits)).toEqual({
      kind: "roof_patch",
      roofPlanePatchId: "legacy-pan",
    });
  });
});
