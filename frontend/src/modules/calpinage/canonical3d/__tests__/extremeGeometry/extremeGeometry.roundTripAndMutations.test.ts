import { describe, expect, it, vi } from "vitest";
import { buildPvPanels3D } from "../../pvPanels/buildPvPanels3D";
import { buildSolarScene3D } from "../../scene/buildSolarScene3D";
import { parseSolarScene3DJson, serializeSolarScene3DStableSorted } from "../../scene/exportSolarScene3d";
import type { RoofPlanePatch3D } from "../../types/roof-surface";
import type { SolarScene3D } from "../../types/solarScene3d";
import type { Vector3 } from "../../types/primitives";
import { createDefaultQualityBlock } from "../../utils/factories";
import { tryCommitPvPlacementFrom3dRoofHit } from "../../../runtime/pvPlacementFrom3dWorldHit";
import { evaluateRoofPatchGeometryTruth, projectPointToPatchUv } from "../../validation/geometricTruthStatus";
import {
  makeExtremeGeometryFixtures,
  mutateScenePatch,
  patchFromLocalPolygon,
  sceneFromPatches,
} from "./extremeGeometryFixtures";
import { auditExtremeGeometryScene, stableSceneGeometrySignature } from "./extremeGeometryDiagnostics";

function add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(v: Vector3, s: number): Vector3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function distance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function pointOnPatch(patch: RoofPlanePatch3D, u: number, v: number): Vector3 {
  return add(patch.localFrame.origin, add(scale(patch.localFrame.xAxis, u), scale(patch.localFrame.yAxis, v)));
}

function rebuildScene(scene: SolarScene3D): SolarScene3D {
  return buildSolarScene3D({
    roofModel: scene.roofModel,
    obstacleVolumes: scene.obstacleVolumes,
    extensionVolumes: scene.extensionVolumes,
    volumesQuality: createDefaultQualityBlock(),
    pvPanels: scene.pvPanels,
    studyRef: scene.metadata.studyRef,
  });
}

describe("extremeGeometry / round-trip PV 3D -> 2D -> 3D", () => {
  const cases = [
    patchFromLocalPolygon("rt-rectangle", [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 5 }, { x: 0, y: 5 }]),
    patchFromLocalPolygon("rt-trapeze", [{ x: 0, y: 0 }, { x: 7.8, y: 0 }, { x: 6.4, y: 5 }, { x: 0.7, y: 4.8 }], { tiltDeg: 24 }),
    patchFromLocalPolygon("rt-concave", [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 7 }, { x: 0, y: 7 }]),
    patchFromLocalPolygon("rt-steep", [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 5 }, { x: 0, y: 5 }], { tiltDeg: 48 }),
  ];

  it("reconstruit le centre PV dans le meme repere local avec erreur millimetrique", () => {
    const errorsM: number[] = [];
    for (const patch of cases) {
      const initial = pointOnPatch(patch, 2.1, 1.7);
      const uv = projectPointToPatchUv(initial, patch)!;
      const pv = buildPvPanels3D(
        {
          panels: [
            {
              id: `${patch.id}-pv`,
              roofPlanePatchId: patch.id,
              center: { mode: "plane_uv", uv },
              widthM: 1.13,
              heightM: 1.72,
              orientation: "portrait",
              rotationDegInPlane: 0,
              sampling: { nx: 2, ny: 2 },
            },
          ],
        },
        { roofPlanePatches: [patch] },
      );
      const final = pv.panels[0]!.center3D;
      errorsM.push(distance(initial, final));
    }
    expect(Math.max(...errorsM) * 1000).toBeLessThan(0.01);
  });

  it("normalise un localFrame non orthonorme recuperable pour garder un round-trip coherent", () => {
    const basePatch = patchFromLocalPolygon("rt-non-orthonormal-frame", [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 5 },
      { x: 0, y: 5 },
    ]);
    const patch = {
      ...basePatch,
      localFrame: {
        ...basePatch.localFrame,
        xAxis: { x: 2, y: 0, z: 0 },
        yAxis: { x: 0, y: 3, z: 0 },
      },
    };
    const initial = { x: 2.1, y: 1.7, z: 8 };
    const truth = evaluateRoofPatchGeometryTruth(patch);
    expect(truth.status).toBe("VALID");
    expect(truth.diagnostics.some((d) => d.code === "LOCAL_FRAME_NORMALIZED")).toBe(true);
    const uv = projectPointToPatchUv(initial, patch)!;
    const pv = buildPvPanels3D(
      {
        panels: [
          {
            id: "rt-non-orthonormal-frame-pv",
            roofPlanePatchId: patch.id,
            center: { mode: "plane_uv", uv },
            widthM: 1.13,
            heightM: 1.72,
            orientation: "portrait",
            rotationDegInPlane: 0,
            sampling: { nx: 2, ny: 2 },
          },
        ],
      },
      { roofPlanePatches: [patch] },
    );
    const driftMm = distance(initial, pv.panels[0]!.center3D) * 1000;
    expect(driftMm).toBeLessThan(0.01);
  });

  it("marque INVALID un localFrame degenere impossible a reconstruire", () => {
    const patch = {
      ...patchFromLocalPolygon("rt-degenerate-frame", [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 8, y: 5 },
        { x: 0, y: 5 },
      ]),
      localFrame: {
        role: "roof_face" as const,
        origin: { x: 0, y: 0, z: 8 },
        xAxis: { x: 0, y: 0, z: 0 },
        yAxis: { x: 0, y: 1, z: 0 },
        zAxis: { x: 0, y: 0, z: 1 },
      },
    };
    expect(evaluateRoofPatchGeometryTruth(patch).status).toBe("INVALID");
  });

  it("verifie le contrat de passerelle 3D -> image legacy avec mock", () => {
    const fn = vi.fn().mockReturnValue({ ok: true, blockId: "mock-block" });
    (window as unknown as { __calpinageCommitPvPlacementFrom3DImagePoint: typeof fn }).__calpinageCommitPvPlacementFrom3DImagePoint =
      fn;
    const r = tryCommitPvPlacementFrom3dRoofHit({
      panId: "rt-rectangle",
      worldPointM: { x: 4.25, y: -3.5, z: 8 },
      worldConfig: { metersPerPixel: 0.05, northAngleDeg: 27, referenceFrame: "LOCAL_IMAGE_ENU" },
    });
    delete (window as unknown as { __calpinageCommitPvPlacementFrom3DImagePoint?: typeof fn })
      .__calpinageCommitPvPlacementFrom3DImagePoint;

    expect(r.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    const center = fn.mock.calls[0]![1] as { x: number; y: number };
    expect(Number.isFinite(center.x)).toBe(true);
    expect(Number.isFinite(center.y)).toBe(true);
  });
});

describe("extremeGeometry / mutations apres pose PV", () => {
  it("detecte explicitement les panneaux orphelins apres suppression de pan", () => {
    const fixture = makeExtremeGeometryFixtures().find((f) => f.id === "extensions-and-garage")!;
    const sceneWithoutPan = buildSolarScene3D({
      roofModel: {
        ...fixture.scene.roofModel,
        roofPlanePatches: fixture.scene.roofModel.roofPlanePatches.filter((p) => p.id !== "extension-low"),
      },
      obstacleVolumes: fixture.scene.obstacleVolumes,
      extensionVolumes: fixture.scene.extensionVolumes,
      volumesQuality: createDefaultQualityBlock(),
      pvPanels: fixture.scene.pvPanels,
      studyRef: "mutation-delete-pan",
    });

    const audit = auditExtremeGeometryScene("mutation-delete-pan", sceneWithoutPan);
    expect(audit.orphanPvPanelIds.length).toBeGreaterThan(0);
    expect(audit.status).toBe("INVALID");
  });

  it("conserve les IDs et associations lors d'un rebuild sans mutation metier", () => {
    const fixture = makeExtremeGeometryFixtures().find((f) => f.id === "ten-pans")!;
    const before = stableSceneGeometrySignature(fixture.scene);
    const after = stableSceneGeometrySignature(rebuildScene(fixture.scene));
    expect(after).toBe(before);
  });

  it("revele qu'un changement de pente de pan ne deplace pas automatiquement les PV deja materialises", () => {
    const base = sceneFromPatches("mutation-slope", [
      patchFromLocalPolygon("mutable", [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 5 }, { x: 0, y: 5 }], { tiltDeg: 10 }),
    ], { panelCount: 1 });
    const mutated = mutateScenePatch(base, "mutable", (patch) => {
      const normal = { x: 0, y: -Math.sin(Math.PI / 4), z: Math.cos(Math.PI / 4) };
      const d = -(normal.x * patch.localFrame.origin.x + normal.y * patch.localFrame.origin.y + normal.z * patch.localFrame.origin.z);
      return {
        ...patch,
        localFrame: {
          ...patch.localFrame,
          yAxis: { x: 0, y: Math.cos(Math.PI / 4), z: Math.sin(Math.PI / 4) },
          zAxis: normal,
        },
        normal,
        equation: { normal, d },
        tiltDeg: 45,
      };
    });
    const pv = mutated.pvPanels[0]!;
    const patch = mutated.roofModel.roofPlanePatches[0]!;
    const planeDistanceM =
      patch.equation.normal.x * pv.center3D.x +
      patch.equation.normal.y * pv.center3D.y +
      patch.equation.normal.z * pv.center3D.z +
      patch.equation.d;

    expect(Math.abs(planeDistanceM)).toBeGreaterThan(0.05);
  });
});

describe("extremeGeometry / save-reload determinisme", () => {
  it("produit la meme signature geometrique apres serialization stable et reload JSON", () => {
    const fixture = makeExtremeGeometryFixtures().find((f) => f.id === "twenty-pans-heavy")!;
    const json = serializeSolarScene3DStableSorted(fixture.scene);
    const parsed = parseSolarScene3DJson(json) as SolarScene3D;
    expect(stableSceneGeometrySignature(parsed)).toBe(stableSceneGeometrySignature(fixture.scene));
  });

  it("reste identique apres plusieurs rebuilds logiques", () => {
    const fixture = makeExtremeGeometryFixtures().find((f) => f.id === "house-u")!;
    const signatures = new Set<string>();
    let scene = fixture.scene;
    for (let i = 0; i < 6; i++) {
      scene = rebuildScene(scene);
      signatures.add(stableSceneGeometrySignature(scene));
    }
    expect(signatures.size).toBe(1);
  });
});
