import { describe, expect, it } from "vitest";
import type { RoofObstacleVolume3D } from "../../../types/roof-obstacle-volume";
import { buildPremiumObstacleAssets } from "../premiumObstacleAssets";

function makeVolume(visualKey: string, kind: RoofObstacleVolume3D["kind"], heightM = 1): RoofObstacleVolume3D {
  const base = [
    { x: -0.25, y: -0.25, z: 2 },
    { x: 0.25, y: -0.25, z: 2 },
    { x: 0.25, y: 0.25, z: 2 },
    { x: -0.25, y: 0.25, z: 2 },
  ];
  const top = base.map((p) => ({ ...p, z: p.z + heightM }));
  const positions = [...base, ...top];
  return {
    id: `obs-${visualKey}`,
    kind,
    visualKey,
    structuralRole: "obstacle_simple",
    visualRole: visualKey === "roof_window" ? "roof_window_flush" : visualKey === "tree_shadow" ? "abstract_shadow_volume" : "physical_roof_body",
    baseElevationM: 2,
    heightM,
    extrusion: { mode: "hybrid_vertical_on_plane", directionWorld: { x: 0, y: 0, z: 1 } },
    footprintWorld: base,
    vertices: positions.map((position, index) => ({ id: `v${index}`, position })),
    edges: [],
    faces: [],
    bounds: { min: { x: -0.25, y: -0.25, z: 2 }, max: { x: 0.25, y: 0.25, z: 2 + heightM } },
    centroid: { x: 0, y: 0, z: 2 + heightM * 0.5 },
    surfaceAreaM2: 1,
    volumeM3: 1,
    relatedPlanePatchIds: [],
    roofAttachment: {
      primaryPlanePatchId: null,
      affectedPlanePatchIds: [],
      anchorKind: "no_plane_context",
      relationHint: "extrusion_world_vertical_only",
      extrusionChoice: "vertical_world_z",
    },
    provenance: { source: "solver", solverStep: "test" },
    quality: { confidence: "high", diagnostics: [] },
  };
}

describe("premiumObstacleAssets", () => {
  it("remplace les volumes generiques pour les petits assets techniques", () => {
    expect(buildPremiumObstacleAssets(makeVolume("vmc_round", "hvac", 0.3)).replaceBaseMesh).toBe(true);
    expect(buildPremiumObstacleAssets(makeVolume("roof_drain", "drain", 0.12)).replaceBaseMesh).toBe(true);
    expect(buildPremiumObstacleAssets(makeVolume("antenna", "antenna", 1.5)).replaceBaseMesh).toBe(true);
  });

  it("produit des assets metier sans modifier le fallback volume", () => {
    const velux = buildPremiumObstacleAssets(makeVolume("roof_window", "skylight", 0.035));
    expect(velux.meshes.map((m) => m.key)).toContain("velux-glass");
    expect(velux.lines.map((l) => l.key)).toContain("velux-sash");

    const shadow = buildPremiumObstacleAssets(makeVolume("tree_shadow", "tree_proxy", 4));
    expect(shadow.replaceBaseMesh).toBe(false);
    expect(shadow.lines.length).toBeGreaterThan(0);
  });
});
