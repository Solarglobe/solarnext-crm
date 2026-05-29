import { describe, expect, it } from "vitest";
import { buildRoofDormerParametric3DFromRuntime } from "../buildRoofDormerParametric3DFromRuntime";
import { makeSupportPatch } from "./roofExtensionVolumeTestUtils";
import { createRoofDormerParametricModelFromDraft } from "../roofDormerParametricModel";

function baseDraft() {
  return {
    id: "e11-dormer",
    supportPanId: "pan1",
    anchorWorld: { x: 0, y: 0, z: 10 },
    orientation: {
      uAxisWorld: { x: 1, y: 0, z: 0 },
      vAxisWorld: { x: 0, y: 1, z: 0 },
    },
    footprint: {
      frontLeft:  { uM: -1, vM: 0 },
      frontRight: { uM:  1, vM: 0 },
      rearRight:  { uM:  1, vM: 2 },
      rearLeft:   { uM: -1, vM: 2 },
    },
    ridge: { left: { uM: -0.5, vM: 0.5 }, right: { uM: 0.5, vM: 1.5 } },
    facadeHeightM: 0.8,
    ridgeHeightM: 1.4,
  };
}

function makeRuntime(overrides: Record<string, unknown> = {}) {
  const model = createRoofDormerParametricModelFromDraft(baseDraft());
  const raw = JSON.parse(JSON.stringify(model));
  return { parametricDormers: [{ ...raw, ...overrides }] };
}

describe("E11 -- orientation explicite obligatoire dans buildRoofDormerParametric3DFromRuntime", () => {
  it("E11a : orientation absente => ROOF_DORMER_PARAMETRIC_ORIENTATION_MISSING error, geometry null", () => {
    const patch = makeSupportPatch("pan1", 0);
    const runtime = makeRuntime({ orientation: undefined });
    const res = buildRoofDormerParametric3DFromRuntime({ runtime, roofPlanePatches: [patch] });
    expect(res.geometries).toHaveLength(0);
    const diag = res.diagnostics.find((d) => d.code === "ROOF_DORMER_PARAMETRIC_ORIENTATION_MISSING");
    expect(diag).toBeTruthy();
    expect(diag!.severity).toBe("error");
  });

  it("E11b : uAxisWorld partiellement null => ORIENTATION_MISSING, pas de geometrie", () => {
    const patch = makeSupportPatch("pan1", 0);
    // uAxisWorld present but vAxisWorld missing component
    const runtime = makeRuntime({
      orientation: { uAxisWorld: { x: 1, y: 0, z: 0 }, vAxisWorld: { x: null, y: 1, z: 0 } },
    });
    const res = buildRoofDormerParametric3DFromRuntime({ runtime, roofPlanePatches: [patch] });
    expect(res.geometries).toHaveLength(0);
    const diag = res.diagnostics.find((d) => d.code === "ROOF_DORMER_PARAMETRIC_ORIENTATION_MISSING");
    expect(diag).toBeTruthy();
    expect(diag!.severity).toBe("error");
  });

  it("E11c : orientation explicite valide => geometrie construite sans erreur d'orientation", () => {
    const patch = makeSupportPatch("pan1", 0);
    const runtime = makeRuntime();
    const res = buildRoofDormerParametric3DFromRuntime({ runtime, roofPlanePatches: [patch] });
    expect(res.geometries).toHaveLength(1);
    const orientDiag = res.diagnostics.find((d) => d.code === "ROOF_DORMER_PARAMETRIC_ORIENTATION_MISSING");
    expect(orientDiag).toBeUndefined();
  });

  it("E11d : orientation = {} (objet vide) => ORIENTATION_MISSING, pas de geometrie", () => {
    const patch = makeSupportPatch("pan1", 0);
    const runtime = makeRuntime({ orientation: {} });
    const res = buildRoofDormerParametric3DFromRuntime({ runtime, roofPlanePatches: [patch] });
    expect(res.geometries).toHaveLength(0);
    const diag = res.diagnostics.find((d) => d.code === "ROOF_DORMER_PARAMETRIC_ORIENTATION_MISSING");
    expect(diag).toBeTruthy();
  });

  it("rejette un footprint source non quadrilatere sans simplification silencieuse", () => {
    const patch = makeSupportPatch("pan1", 0);
    const runtime = makeRuntime({
      footprint: {
        points: [
          { uM: -1, vM: 0 },
          { uM: 1, vM: 0 },
          { uM: 1.2, vM: 1 },
          { uM: 0.3, vM: 2 },
          { uM: -1, vM: 2 },
        ],
      },
    });
    const res = buildRoofDormerParametric3DFromRuntime({ runtime, roofPlanePatches: [patch] });
    expect(res.geometries).toHaveLength(0);
    const diag = res.diagnostics.find((d) => d.code === "DORMER_FOOTPRINT_NOT_QUADRILATERAL");
    expect(diag).toBeTruthy();
    expect(diag!.severity).toBe("warning");
  });
});
