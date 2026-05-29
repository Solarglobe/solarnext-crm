/**
 * F28 -- Test d'ombrage near-shading produit par un chien assis sur les panneaux adjacents.
 *
 * Geometrie :
 *   - Pan principal plat, z = 10 m (world)
 *   - Dormer (boite) : x=[-1,1], y=[-1,1], z=[10,12] (hauteur 2 m)
 *   - Soleil : azimut 90 deg (Est), elevation 30 deg
 *     => direction vers soleil = (cos30, 0, sin30) = (0.866, 0, 0.5)
 *     => ombre portee vers l'Ouest (x negatif)
 *   - Panneau Ouest (x=-3, y=0, z=10) : en ombre -- le rayon traverse la face Ouest du dormer
 *   - Panneau Est  (x=+3, y=0, z=10) : non ombre  -- le rayon s'eloigne du dormer
 */

import { describe, it, expect } from "vitest";
import { runNearShadingTimeStep } from "../../canonical3d/nearShading3d/nearShadingEngine";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Volume dormer minimal : boite x=[-1,1], y=[-1,1], z=[10,12]. */
function makeDormerBox() {
  return {
    id: "dormer-box",
    kind: "dormer",
    structuralRole: "roof_extension",
    baseElevationM: 10,
    heightM: 2,
    extrusion: { kind: "flat_top", heightM: 2 },
    footprintWorld: [
      { x: -1, y: -1, z: 10 },
      { x: 1, y: -1, z: 10 },
      { x: 1, y: 1, z: 10 },
      { x: -1, y: 1, z: 10 },
    ],
    // 8 sommets : 0-3 fond, 4-7 sommet
    vertices: [
      { id: "v0", position: { x: -1, y: -1, z: 10 } },
      { id: "v1", position: { x:  1, y: -1, z: 10 } },
      { id: "v2", position: { x:  1, y:  1, z: 10 } },
      { id: "v3", position: { x: -1, y:  1, z: 10 } },
      { id: "v4", position: { x: -1, y: -1, z: 12 } },
      { id: "v5", position: { x:  1, y: -1, z: 12 } },
      { id: "v6", position: { x:  1, y:  1, z: 12 } },
      { id: "v7", position: { x: -1, y:  1, z: 12 } },
    ],
    edges: [],
    // 6 faces de la boite (cycles de vertex indices)
    faces: [
      { id: "f-top",    vertexIndexCycle: [4, 5, 6, 7] },
      { id: "f-bottom", vertexIndexCycle: [3, 2, 1, 0] },
      { id: "f-west",   vertexIndexCycle: [0, 3, 7, 4] }, // x = -1 -- face que frappe le rayon depuis l'ouest
      { id: "f-east",   vertexIndexCycle: [1, 5, 6, 2] }, // x = +1
      { id: "f-south",  vertexIndexCycle: [0, 4, 5, 1] }, // y = -1
      { id: "f-north",  vertexIndexCycle: [2, 6, 7, 3] }, // y = +1
    ],
    bounds: {
      min: { x: -1, y: -1, z: 10 },
      max: { x:  1, y:  1, z: 12 },
    },
    centroid: { x: 0, y: 0, z: 11 },
    surfaceAreaM2: 20,
    volumeM3: 8,
    relatedPlanePatchIds: ["pan1"],
    roofAttachment: { kind: "on_roof_plane", planePatchId: "pan1" },
  };
}

/**
 * Panneau PV minimal pour runNearShadingTimeStep.
 * Seuls panel.id et panel.samplingGrid.cellCentersWorld sont lus par le moteur.
 */
function makePanel(id, samplePoints) {
  return {
    id,
    samplingGrid: {
      cellCentersWorld: samplePoints,
      params: { nx: 1, ny: 1, includeEdgeMidpoints: false },
      cellUv01: [],
      cornerPointsWorld: [],
      centerWorld: samplePoints[0] ?? { x: 0, y: 0, z: 10 },
    },
  };
}

// ---------------------------------------------------------------------------
// Sun direction : azimut 90 deg (Est), elevation 30 deg
// direction vers soleil (ENU) = (sin(az)*cos(el), cos(az)*cos(el), sin(el))
//   = (sin90*cos30, cos90*cos30, sin30)
//   = (cos30, 0, 0.5)
//   = (0.8660, 0, 0.5)
// ---------------------------------------------------------------------------
const COS30 = Math.cos(30 * Math.PI / 180); // ~0.8660
const SUN_EAST_30DEG = { x: COS30, y: 0, z: 0.5 };

// ---------------------------------------------------------------------------
// Scene context
// ---------------------------------------------------------------------------
const SCENE = {
  panels: [
    // Panneau Ouest (x=-3) : le dormer est entre lui et le soleil (Est) => ombre
    makePanel("panel-west", [{ x: -3, y: 0, z: 10 }]),
    // Panneau Est (x=+3) : le rayon s'eloigne du dormer => pas d'ombre
    makePanel("panel-east", [{ x:  3, y: 0, z: 10 }]),
  ],
  obstacleVolumes: [],
  extensionVolumes: [makeDormerBox()],
  params: {
    originEpsilonM: 0.01,   // decalage leger de l'origine du rayon (evite auto-intersection)
    rayMaxLengthM: 200,     // distance max de recherche d'occlusion
    useAabbBroadPhase: true,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("F28 -- ombrage near-shading chien assis sur panneaux adjacents", () => {
  it("scène construite : 1 dormer, 2 panneaux, direction solaire Est 30 deg", () => {
    const result = runNearShadingTimeStep(SCENE, {
      directionTowardSunWorld: SUN_EAST_30DEG,
    });
    expect(result.panelResults).toHaveLength(2);
    expect(result.totalSamples).toBe(2);
  });

  it("panneau Ouest (x=-3) : le chien assis obstrue le soleil => shadingRatio > 0", () => {
    const result = runNearShadingTimeStep(SCENE, {
      directionTowardSunWorld: SUN_EAST_30DEG,
    });
    const west = result.panelResults.find((p) => p.panelId === "panel-west");
    expect(west).toBeDefined();
    // Le rayon depuis (-3,0,10) vers (0.866,0,0.5) traverse la face Ouest du dormer
    expect(west.shadingRatio).toBeGreaterThan(0);
    expect(west.shadedSampleCount).toBe(1);
  });

  it("panneau Est (x=+3) : soleil libre, aucun occlusion => shadingRatio = 0", () => {
    const result = runNearShadingTimeStep(SCENE, {
      directionTowardSunWorld: SUN_EAST_30DEG,
    });
    const east = result.panelResults.find((p) => p.panelId === "panel-east");
    expect(east).toBeDefined();
    // Le rayon depuis (3,0,10) vers l'Est s'eloigne du dormer
    expect(east.shadingRatio).toBe(0);
    expect(east.shadedSampleCount).toBe(0);
  });

  it("global : exactement 1 echantillon sur 2 est ombre", () => {
    const result = runNearShadingTimeStep(SCENE, {
      directionTowardSunWorld: SUN_EAST_30DEG,
    });
    expect(result.shadedSamples).toBe(1);
    expect(result.globalShadedFraction).toBeCloseTo(0.5, 6);
  });

  it("hit rapporte le volume dormer comme occlusion (kind = extension)", () => {
    const result = runNearShadingTimeStep(SCENE, {
      directionTowardSunWorld: SUN_EAST_30DEG,
    });
    const west = result.panelResults.find((p) => p.panelId === "panel-west");
    const shadedSample = west?.sampleResults.find((s) => s.shaded);
    expect(shadedSample).toBeDefined();
    expect(shadedSample.hitVolumeKind).toBe("extension");
    expect(shadedSample.hitVolumeId).toBe("dormer-box");
    expect(shadedSample.hitDistanceM).toBeGreaterThan(0);
  });
});
