import { describe, expect, it } from "vitest";
import { roofClosureFacadeGeometry } from "../solarSceneThreeGeometry";
import type { RoofModel3D } from "../../types/model";
import { createEmptyRoofModel3D } from "../../utils/factories";

/** Arête intérieure à 2 pans, pente nette (pignon / rive rampante) — doit produire un quad de fermeture. */
function minimalModelWithTwoPatchSteepEdge(): RoofModel3D {
  const base = createEmptyRoofModel3D();
  return {
    ...base,
    roofVertices: [
      {
        id: "v0",
        position: { x: 0, y: 0, z: 5 },
        role: "corner",
        provenance: { source: "solver", solverStep: "test" },
      },
      {
        id: "v1",
        position: { x: 0, y: 8, z: 8 },
        role: "corner",
        provenance: { source: "solver", solverStep: "test" },
      },
    ],
    roofEdges: [
      {
        id: "e0",
        vertexAId: "v0",
        vertexBId: "v1",
        topologyKind: "interior",
        semantic: { kind: "rake" },
        purpose: "mesh_topology",
        incidentPlanePatchIds: ["pan-a", "pan-b"],
        lengthM: 8,
        directionWorld: { x: 0, y: 1, z: 0.375 },
        provenance: { source: "solver", solverStep: "test" },
      },
    ],
  };
}

/** Même géométrie mais arête classée faîtage : pas de quad 2-pans (évite doubles murs sur faîtages). */
function minimalModelWithTwoPatchRidgeSemantic(): RoofModel3D {
  const m = minimalModelWithTwoPatchSteepEdge();
  return {
    ...m,
    roofEdges: [
      {
        ...m.roofEdges[0]!,
        semantic: { kind: "ridge" },
      },
    ],
  };
}

function minimalModelWithBoundaryEdge(): RoofModel3D {
  const base = createEmptyRoofModel3D();
  return {
    ...base,
    roofVertices: [
      {
        id: "v0",
        position: { x: 0, y: 0, z: 4 },
        role: "corner",
        provenance: { source: "solver", solverStep: "test" },
      },
      {
        id: "v1",
        position: { x: 10, y: 0, z: 6 },
        role: "corner",
        provenance: { source: "solver", solverStep: "test" },
      },
    ],
    roofEdges: [
      {
        id: "e0",
        vertexAId: "v0",
        vertexBId: "v1",
        topologyKind: "boundary",
        semantic: null,
        purpose: "mesh_topology",
        incidentPlanePatchIds: ["pan-a"],
        lengthM: 10,
        directionWorld: { x: 1, y: 0, z: 0 },
        provenance: { source: "solver", solverStep: "test" },
      },
    ],
  };
}

describe("roofClosureFacadeGeometry", () => {
  it("retourne null si aucune arête bord libre au-dessus du z minimal", () => {
    const m = createEmptyRoofModel3D();
    const geo = roofClosureFacadeGeometry(m);
    expect(geo).toBeNull();
  });

  it("produit une géométrie pour une arête bord (un pan) avec surélévation", () => {
    const m = minimalModelWithBoundaryEdge();
    const geo = roofClosureFacadeGeometry(m);
    expect(geo).not.toBeNull();
    const pos = geo!.getAttribute("position");
    expect(pos.count).toBe(4);
    geo!.dispose();
  });

  it("produit une géométrie pour une arête à 2 pans « rampante » (pignon) avec surélévation", () => {
    const m = minimalModelWithTwoPatchSteepEdge();
    const geo = roofClosureFacadeGeometry(m);
    expect(geo).not.toBeNull();
    const pos = geo!.getAttribute("position");
    expect(pos.count).toBe(4);
    geo!.dispose();
  });

  it("n’ajoute pas de quad 2-pans si l’arête est sémantiquement un faîtage", () => {
    const m = minimalModelWithTwoPatchRidgeSemantic();
    const geo = roofClosureFacadeGeometry(m);
    expect(geo).toBeNull();
  });
});
