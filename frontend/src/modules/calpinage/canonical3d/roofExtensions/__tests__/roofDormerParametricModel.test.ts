import { describe, expect, it } from "vitest";
import { buildRoofDormerParametric3D } from "../buildRoofDormerParametric3D";
import { buildRoofDormerParametric3DFromRuntime } from "../buildRoofDormerParametric3DFromRuntime";
import { normalizeRoofDormerParametric2DDraft } from "../roofDormerParametric2DController";
import type { RoofDormerParametric2DDraft } from "../roofDormerParametricModel";
import { createRoofDormerParametricModelFromDraft } from "../roofDormerParametricModel";
import { validateRoofDormerParametricModel } from "../roofDormerParametricValidation";
import { makeSupportPatch, signedDistanceToPlane } from "./roofExtensionVolumeTestUtils";

function draft(overrides: Partial<RoofDormerParametric2DDraft> = {}): RoofDormerParametric2DDraft {
  return {
    id: "param-dormer-1",
    supportPanId: "pan-param",
    anchorWorld: { x: 2, y: -6, z: 10 },
    footprint: {
      frontLeft: { uM: -1.2, vM: -1.4 },
      frontRight: { uM: 1.2, vM: -1.4 },
      rearRight: { uM: 1.0, vM: 1.4 },
      rearLeft: { uM: -1.0, vM: 1.4 },
    },
    ridge: {
      front: { uM: 0, vM: -1.4 },
      rear: { uM: 0, vM: 1.4 },
    },
    facadeHeightM: 0.45,
    ridgeHeightM: 1.15,
    ...overrides,
  };
}

describe("RoofDormerParametricModel", () => {
  it("normalise un draft 2D controle sans champs legacy libres", () => {
    const patch = makeSupportPatch("pan-param", 0);
    const res = normalizeRoofDormerParametric2DDraft(draft(), patch);
    expect(res.model).toBeTruthy();
    expect(res.model?.version).toBe("roof_dormer_parametric_v1");
    expect(res.model?.heights.reference).toBe("support_plane_normal");
    expect(res.model?.heights.roofRiseM).toBeCloseTo(0.7, 6);
    expect(res.model?.preparedUses).toMatchObject({
      render: "parametric_mesh",
      keepout: "parametric_footprint",
      shading: "parametric_mesh",
      raycast: "parametric_mesh",
      collisions: "parametric_mesh",
    });
  });

  it("refuse un modele dont les hauteurs se contredisent", () => {
    const model = {
      ...createRoofDormerParametricModelFromDraft(draft()),
      heights: {
        reference: "support_plane_normal" as const,
        facadeHeightM: 0.6,
        ridgeHeightM: 0.8,
        roofRiseM: 0.6,
      },
    };
    const diagnostics = validateRoofDormerParametricModel(model, makeSupportPatch("pan-param", 0));
    expect(diagnostics.some((d) => d.code === "ROOF_DORMER_PARAMETRIC_HEIGHT_CONFLICT")).toBe(true);
  });

  it("genere un vrai volume architectural separe du legacy", () => {
    const patch = makeSupportPatch("pan-param", 0);
    const model = createRoofDormerParametricModelFromDraft(draft());
    const res = buildRoofDormerParametric3D(model, patch);
    expect(res.geometry).toBeTruthy();
    const geom = res.geometry!;
    expect(geom.version).toBe("roof_dormer_parametric_runtime_geometry_v1");
    expect(geom.vertices).toHaveLength(10);
    expect(geom.faces.map((f) => f.id)).toEqual(expect.arrayContaining([
      "param-dormer-1:face:front-wall",
      "param-dormer-1:face:left-cheek-wall",
      "param-dormer-1:face:roof:left",
      "param-dormer-1:face:roof:right",
    ]));
    expect(geom.parts.dormerRoof).toHaveLength(2);
    expect(geom.parts.cheekWalls).toHaveLength(2);
    expect(geom.volumeM3).toBeGreaterThan(0);
  });

  it("applique les hauteurs selon la normale du pan support", () => {
    const patch = makeSupportPatch("pan-param", 30);
    const model = createRoofDormerParametricModelFromDraft(draft());
    const geom = buildRoofDormerParametric3D(model, patch).geometry!;
    for (const p of geom.footprintWorld) {
      expect(Math.abs(signedDistanceToPlane(p, patch.equation))).toBeLessThan(1e-6);
    }
    const ridgeFront = geom.vertices.find((v) => v.id.endsWith(":ridge:front"))!;
    const eaveFront = geom.vertices.find((v) => v.id.endsWith(":eave:front-left"))!;
    expect(signedDistanceToPlane(ridgeFront.position, patch.equation)).toBeCloseTo(1.15, 6);
    expect(signedDistanceToPlane(eaveFront.position, patch.equation)).toBeCloseTo(0.45, 6);
  });

  it("relit un parametricDormers[] runtime sans passer par roofExtensions legacy", () => {
    const patch = makeSupportPatch("pan-param", 0);
    const model = createRoofDormerParametricModelFromDraft(draft());
    const savedReloaded = JSON.parse(JSON.stringify({ parametricDormers: [model] }));
    const res = buildRoofDormerParametric3DFromRuntime({
      runtime: savedReloaded,
      roofPlanePatches: [patch],
    });
    expect(res.geometries).toHaveLength(1);
    expect(res.extensionVolumes).toHaveLength(1);
    expect(res.geometries[0]!.modelId).toBe("param-dormer-1");
    expect(res.extensionVolumes[0]!.topology?.source).toBe("parametricDormers.v2");
    expect(res.extensionVolumes[0]!.topology?.meshStrategy).toBe("parametric_dormer_v2");
    expect(res.geometries[0]!.preparedUses.shading).toBe("parametric_mesh");
    expect(res.geometries[0]!.preparedUses.raycast).toBe("parametric_mesh");
    expect(res.diagnostics.some((d) => d.code === "ROOF_DORMER_PARAMETRIC_RUNTIME_PARALLEL_READY")).toBe(true);
  });
});
