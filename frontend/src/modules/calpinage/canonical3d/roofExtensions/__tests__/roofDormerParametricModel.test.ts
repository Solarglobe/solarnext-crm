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
      "param-dormer-1:face:roof:front",
      "param-dormer-1:face:roof:rear",
    ]));
    expect(geom.parts.dormerRoof).toHaveLength(2);
    expect(geom.parts.cheekWalls).toHaveLength(2);
    expect(geom.volumeM3).toBeGreaterThan(0);
  });

  it("applique les hauteurs selon la normale du pan support : murs dans le plan de la pente", () => {
    // G1 : buildPoint utilise upAxis = normalize(supportPatch.normal) -- les hauteurs sont mesurees
    // le long de la normale sortante du pan, conformement a heights.reference = "support_plane_normal".
    // Pour un pan a 30 deg : normal ~= {x:0, y:-0.5, z:0.866} => eave != base en y, z-delta != facadeHeightM.
    const patch = makeSupportPatch("pan-param", 30);
    // E12: orientation must be tangent to the pan (ORIENTATION_OFF_PLANE is now an error).
    // xAxis=(1,0,0) is tangent; vAxisWorld=(0,cos30,sin30) is tangent to a 30 deg pan.
    const cos30 = Math.cos(30 * Math.PI / 180);
    const sin30 = Math.sin(30 * Math.PI / 180);
    // M21: anchor must be within 5 cm of the support plane.
    // For anchor at (2,-6,?): z = 10 - 6*tan(30deg) places it exactly on the 30deg pan.
    const tan30 = Math.tan(30 * Math.PI / 180);
    const model = createRoofDormerParametricModelFromDraft(draft({
      anchorWorld: { x: 2, y: -6, z: 10 - 6 * tan30 },
      orientation: {
        uAxisWorld: { x: 1, y: 0, z: 0 },
        vAxisWorld: { x: 0, y: cos30, z: sin30 },
      },
    }));
    const geom = buildRoofDormerParametric3D(model, patch).geometry!;

    // Les base vertices restent sur le plan du pan.
    for (const p of geom.footprintWorld) {
      expect(Math.abs(signedDistanceToPlane(p, patch.equation))).toBeLessThan(1e-6);
    }

    // Eave : distance signee au plan == facadeHeightM (extrusion le long de la normale unitaire).
    const eaveFrontLeft = geom.vertices.find((v) => v.id.endsWith(":eave:front-left"))!;
    expect(signedDistanceToPlane(eaveFrontLeft.position, patch.equation)).toBeCloseTo(0.45, 6);

    // Ridge left : distance signee au plan == ridgeHeightM.
    const ridgeLeft = geom.vertices.find((v) => v.id.endsWith(":ridge:left"))!;
    expect(signedDistanceToPlane(ridgeLeft.position, patch.equation)).toBeCloseTo(1.15, 6);
  });

  it("C1 ridge vertices use ridge.front and ridge.rear coords, not footprint averages", () => {
    // Asymmetric dormer: ridge is NOT centered in the footprint.
    // ridge.front.uM = -0.3 (offset left) vs footprint mean = (-1.2 + -1.0)/2 = -1.1
    // Before C1, ridgeLeftU was calculated from fp averages => 0.8m error in 3D.
    const patch = makeSupportPatch("pan-param", 0);
    const asymDraft = draft({
      ridge: {
        front: { uM: -0.3, vM: -0.5 },
        rear:  { uM:  0.8, vM:  0.5 },
      },
    });
    const model = createRoofDormerParametricModelFromDraft(asymDraft);
    const geom = buildRoofDormerParametric3D(model, patch).geometry!;

    const ridgeLeftVertex  = geom.vertices.find((v) => v.id.endsWith(":ridge:left"))!;
    const ridgeRightVertex = geom.vertices.find((v) => v.id.endsWith(":ridge:right"))!;

    // Anchor at (2, -6, 10) on horizontal pan => uAxisWorld=(1,0,0), vAxisWorld=(0,1,0).
    // ridgeLeft must be at uM=-0.3 from origin => x = 2 + (-0.3) = 1.7
    expect(ridgeLeftVertex.position.x).toBeCloseTo(2 + (-0.3), 5);
    // ridgeRight must be at uM=+0.8 => x = 2 + 0.8 = 2.8
    expect(ridgeRightVertex.position.x).toBeCloseTo(2 + 0.8, 5);

    // Must NOT match the old footprint-average logic
    const oldLeftU  = (asymDraft.footprint.frontLeft.uM + asymDraft.footprint.rearLeft.uM) / 2;   // -1.1
    const oldRightU = (asymDraft.footprint.frontRight.uM + asymDraft.footprint.rearRight.uM) / 2; //  1.1
    expect(ridgeLeftVertex.position.x).not.toBeCloseTo(2 + oldLeftU, 2);
    expect(ridgeRightVertex.position.x).not.toBeCloseTo(2 + oldRightU, 2);
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
describe("C4 — roofRiseM guard et try/catch normalize", () => {
  it("C4a : createRoofDormerParametricModelFromDraft leve une erreur si ridgeHeightM <= facadeHeightM", () => {
    const badDraft = draft({ ridgeHeightM: 0.45, facadeHeightM: 0.45 }); // rise = 0
    expect(() => createRoofDormerParametricModelFromDraft(badDraft)).toThrow(
      "ROOF_DORMER_PARAMETRIC_INVALID_RISE",
    );
  });

  it("C4b : createRoofDormerParametricModelFromDraft leve une erreur si ridgeHeightM < facadeHeightM", () => {
    const badDraft = draft({ ridgeHeightM: 0.3, facadeHeightM: 0.45 }); // rise < 0
    expect(() => createRoofDormerParametricModelFromDraft(badDraft)).toThrow(
      "ROOF_DORMER_PARAMETRIC_INVALID_RISE",
    );
  });

  it("C4c : normalizeRoofDormerParametric2DDraft retourne DRAFT_CREATE_EXCEPTION si rise invalide", () => {
    const patch = makeSupportPatch("pan-param", 0);
    const badDraft = draft({ ridgeHeightM: 0.45, facadeHeightM: 0.45 });
    const res = normalizeRoofDormerParametric2DDraft(badDraft, patch);
    expect(res.model).toBeNull();
    expect(res.diagnostics.some((d) => d.code === "DRAFT_CREATE_EXCEPTION" && d.severity === "error")).toBe(true);
  });

  it("C4d : un draft valide (rise > 0) passe sans erreur", () => {
    const patch = makeSupportPatch("pan-param", 0);
    const res = normalizeRoofDormerParametric2DDraft(draft(), patch);
    expect(res.model).not.toBeNull();
    expect(res.diagnostics.every((d) => d.code !== "DRAFT_CREATE_EXCEPTION")).toBe(true);
  });
});
describe("E8 -- seams et flashing distincts", () => {
  it("seams inclut les 4 aretes de base (perimetre complet)", () => {
    const patch = makeSupportPatch("pan-param", 0);
    const model = createRoofDormerParametricModelFromDraft(draft());
    const geom = buildRoofDormerParametric3D(model, patch).geometry!;
    expect(geom.parts.seams).toHaveLength(4);
    expect(geom.parts.seams).toContain("param-dormer-1:edge:base:rear");
  });

  it("flashing exclut base:rear (arrete arriere couverte par les tuiles) -- 3 aretes", () => {
    const patch = makeSupportPatch("pan-param", 0);
    const model = createRoofDormerParametricModelFromDraft(draft());
    const geom = buildRoofDormerParametric3D(model, patch).geometry!;
    expect(geom.parts.flashing).toHaveLength(3);
    expect(geom.parts.flashing).not.toContain("param-dormer-1:edge:base:rear");
    expect(geom.parts.flashing).toContain("param-dormer-1:edge:base:front");
    expect(geom.parts.flashing).toContain("param-dormer-1:edge:base:left");
    expect(geom.parts.flashing).toContain("param-dormer-1:edge:base:right");
  });
});


describe("E9 -- baseElevationM = min Z du footprint (pas mean)", () => {
  it("pan incline 20deg : baseElevationM est le coin le plus bas, pas la moyenne", () => {
    const patch = makeSupportPatch("pan-param", 20);
    // E12: uAxisWorld/vAxisWorld must be tangent to the inclined pan (E11 now blocks off-plane axes).
    // For a 20 deg pan: normal=(0,-sin20,cos20). xAxis=(1,0,0) is tangent. yAxis=(0,cos20,sin20).
    const cos20 = Math.cos(20 * Math.PI / 180);
    const sin20 = Math.sin(20 * Math.PI / 180);
    // M21: anchor must be within 5 cm of the support plane.
    // For anchor at (2,-6,?): z = 10 - 6*tan(20deg) places it exactly on the 20deg pan.
    const tan20 = Math.tan(20 * Math.PI / 180);
    const model = createRoofDormerParametricModelFromDraft(draft({
      anchorWorld: { x: 2, y: -6, z: 10 - 6 * tan20 },
      orientation: {
        uAxisWorld: { x: 1, y: 0, z: 0 },
        vAxisWorld: { x: 0, y: cos20, z: sin20 },
      },
    }));
    const { parametricDormers: [savedModel] } = JSON.parse(JSON.stringify({ parametricDormers: [model] }));
    const res = buildRoofDormerParametric3DFromRuntime({
      runtime: { parametricDormers: [savedModel] },
      roofPlanePatches: [patch],
    });
    expect(res.extensionVolumes).toHaveLength(1);
    const vol = res.extensionVolumes[0]!;
    const minZ = Math.min(...vol.footprintWorld.map((p) => p.z));
    const meanZ = vol.footprintWorld.reduce((s, p) => s + p.z, 0) / vol.footprintWorld.length;
    // On an inclined pan the corners have different Z -- min != mean
    expect(Math.abs(minZ - meanZ)).toBeGreaterThan(0.01);
    expect(vol.baseElevationM).toBeCloseTo(minZ, 6);
    expect(vol.baseElevationM).not.toBeCloseTo(meanZ, 2);
  });
});

describe("M21 -- ANCHOR_OFF_PLANE seuil 5 cm, severite error", () => {
  // makeSupportPatch(id, 0) => plan plat z=10, normale=(0,0,1), d=-10
  // Distance signee = anchor.z - 10

  it("ancre exactement sur le plan => aucun diagnostic ANCHOR_OFF_PLANE", () => {
    const patch = makeSupportPatch("pan-param", 0);
    const model = createRoofDormerParametricModelFromDraft(draft({ anchorWorld: { x: 2, y: -6, z: 10 } }));
    const diags = validateRoofDormerParametricModel(model, patch);
    expect(diags.some((d) => d.code === "ROOF_DORMER_PARAMETRIC_ANCHOR_OFF_PLANE")).toBe(false);
  });

  it("ancre a 4 cm du plan (< 5 cm) => aucun diagnostic ANCHOR_OFF_PLANE", () => {
    const patch = makeSupportPatch("pan-param", 0);
    const model = createRoofDormerParametricModelFromDraft(draft({ anchorWorld: { x: 2, y: -6, z: 10.04 } }));
    const diags = validateRoofDormerParametricModel(model, patch);
    expect(diags.some((d) => d.code === "ROOF_DORMER_PARAMETRIC_ANCHOR_OFF_PLANE")).toBe(false);
  });

  it("ancre a 6 cm du plan (> 5 cm) => diagnostic ANCHOR_OFF_PLANE de severite error (M21)", () => {
    const patch = makeSupportPatch("pan-param", 0);
    const model = createRoofDormerParametricModelFromDraft(draft({ anchorWorld: { x: 2, y: -6, z: 10.06 } }));
    const diags = validateRoofDormerParametricModel(model, patch);
    const d = diags.find((d) => d.code === "ROOF_DORMER_PARAMETRIC_ANCHOR_OFF_PLANE");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
  });
});
