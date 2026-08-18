import { describe, expect, it } from "vitest";
import type { PvPanelPlacementInput } from "../../pvPanels/pvPanelInput";
import { buildPvPanels3D } from "../../pvPanels/buildPvPanels3D";
import { evaluatePvPanelPlacementsForScene } from "../../pvPanels/pvPanelPlacementValidation";
import { buildSolarScene3D } from "../../scene/buildSolarScene3D";
import { parseSolarScene3DJson, serializeSolarScene3DStableSorted } from "../../scene/exportSolarScene3d";
import type { RoofPlanePatch3D } from "../../types/roof-surface";
import type { SolarScene3D } from "../../types/solarScene3d";
import type { Vector3 } from "../../types/primitives";
import { createDefaultQualityBlock, createEmptyRoofModel3D } from "../../utils/factories";
import { dot3, sub3 } from "../../utils/math3";
import { buildRoofVolumes3D } from "../../volumes/buildRoofVolumes3D";
import { patchFromLocalPolygon } from "./extremeGeometryFixtures";

const EPS_M = 1e-6;
const EPS_LOCAL_M = 1e-9;
const EPS_DRIFT_M = 1e-8;

function axesFromAzimuthDeg(deg: number): { xAxis: Vector3; yAxisBase: Vector3 } {
  const a = (deg * Math.PI) / 180;
  return {
    xAxis: { x: Math.cos(a), y: Math.sin(a), z: 0 },
    yAxisBase: { x: -Math.sin(a), y: Math.cos(a), z: 0 },
  };
}

function roofPatch(id: string, opts: { tiltDeg?: number; azimuthDeg?: number; widthM?: number; heightM?: number } = {}): RoofPlanePatch3D {
  const width = opts.widthM ?? 8;
  const height = opts.heightM ?? 6;
  const axes = axesFromAzimuthDeg(opts.azimuthDeg ?? 0);
  const tilt = ((opts.tiltDeg ?? 20) * Math.PI) / 180;
  return patchFromLocalPolygon(
    id,
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    {
      origin: { x: 0, y: 0, z: 8 },
      xAxis: axes.xAxis,
      yAxis: {
        x: axes.yAxisBase.x * Math.cos(tilt),
        y: axes.yAxisBase.y * Math.cos(tilt),
        z: Math.sin(tilt),
      },
      tiltDeg: opts.tiltDeg ?? 20,
      azimuthDeg: opts.azimuthDeg ?? 0,
    },
  );
}

function makeInputs(patchId: string): PvPanelPlacementInput[] {
  return [
    {
      id: "pv-a",
      roofPlanePatchId: patchId,
      center: { mode: "plane_uv", uv: { u: 2.2, v: 2.2 } },
      widthM: 1,
      heightM: 1.7,
      orientation: "portrait",
      rotationDegInPlane: 0,
      sampling: { nx: 2, ny: 2 },
    },
    {
      id: "pv-b",
      roofPlanePatchId: patchId,
      center: { mode: "plane_uv", uv: { u: 4.6, v: 3.1 } },
      widthM: 1,
      heightM: 1.7,
      orientation: "portrait",
      rotationDegInPlane: 90,
      sampling: { nx: 2, ny: 2 },
    },
  ];
}

function sceneFor(patches: readonly RoofPlanePatch3D[], inputs: readonly PvPanelPlacementInput[], requestedCount = inputs.length): SolarScene3D {
  const roofModel = { ...createEmptyRoofModel3D(), roofPlanePatches: patches };
  const pv = buildPvPanels3D({ panels: inputs }, { roofPlanePatches: patches, obstacleVolumes: [], extensionVolumes: [] });
  return buildSolarScene3D({
    roofModel,
    obstacleVolumes: [],
    extensionVolumes: [],
    volumesQuality: createDefaultQualityBlock(),
    pvPanels: pv.panels,
    pvPanelPlacementRequestedCount: requestedCount,
  });
}

function signedDistance(point: Vector3, patch: RoofPlanePatch3D): number {
  return dot3(patch.equation.normal, point) + patch.equation.d;
}

function assertPanelsOnPatch(scene: SolarScene3D, patch: RoofPlanePatch3D, expectedIds: readonly string[]): void {
  expect(scene.pvPanels.map((p) => String(p.id)).sort()).toEqual([...expectedIds].sort());
  expect(scene.metadata.pvPlacementValidityStatus).toBe("VALID");
  for (const panel of scene.pvPanels) {
    expect(panel.attachment.roofPlanePatchId).toBe(patch.id);
    expect(panel.placementValidity.status).toBe("VALID");
    expect(Math.abs(signedDistance(panel.center3D, patch))).toBeLessThan(EPS_M);
    expect(dot3(panel.outwardNormal, patch.normal)).toBeCloseTo(1, 6);
  }
}

describe("PV mutations lifecycle", () => {
  it("changement de pente : conserve roofId et coordonnées locales, reconstruit sur le nouveau plan", () => {
    const beforePatch = roofPatch("roof-A", { tiltDeg: 12 });
    const afterPatch = roofPatch("roof-A", { tiltDeg: 34 });
    const inputs = makeInputs("roof-A");

    const before = sceneFor([beforePatch], inputs);
    const after = sceneFor([afterPatch], inputs);

    assertPanelsOnPatch(before, beforePatch, ["pv-a", "pv-b"]);
    assertPanelsOnPatch(after, afterPatch, ["pv-a", "pv-b"]);
    for (const input of inputs) {
      expect(input.center.mode).toBe("plane_uv");
      const panel = after.pvPanels.find((p) => p.id === input.id)!;
      const local = input.center.mode === "plane_uv" ? input.center.uv : null;
      expect(local).not.toBeNull();
      expect(Math.abs(signedDistance(panel.center3D, beforePatch))).toBeGreaterThan(0.05);
    }
  });

  it("changements d'azimut successifs : pas de migration ni dérive cumulative locale", () => {
    const inputs = makeInputs("roof-A");
    const azimuths = [180, 190, 220, 175, 180];
    const first = sceneFor([roofPatch("roof-A", { azimuthDeg: 180 })], inputs);
    let current = first;

    for (const azimuthDeg of azimuths.slice(1)) {
      const patch = roofPatch("roof-A", { azimuthDeg });
      current = sceneFor([patch], inputs);
      assertPanelsOnPatch(current, patch, ["pv-a", "pv-b"]);
    }

    const final = current;
    for (const panel of final.pvPanels) {
      const initial = first.pvPanels.find((p) => p.id === panel.id)!;
      const d = sub3(panel.center3D, initial.center3D);
      expect(Math.hypot(d.x, d.y, d.z)).toBeLessThan(EPS_DRIFT_M);
      expect(panel.pose.rotationDegInPlane).toBe(initial.pose.rotationDegInPlane);
      expect(panel.attachment.roofPlanePatchId).toBe(initial.attachment.roofPlanePatchId);
    }
  });

  it("redimensionnement : conserve les PV dedans et invalide explicitement ceux qui sortent", () => {
    const grown = sceneFor([roofPatch("roof-A", { widthM: 10, heightM: 8 })], makeInputs("roof-A"));
    assertPanelsOnPatch(grown, grown.roofModel.roofPlanePatches[0]!, ["pv-a", "pv-b"]);

    const shrunkInside = sceneFor([roofPatch("roof-A", { widthM: 6, heightM: 5 })], makeInputs("roof-A"));
    assertPanelsOnPatch(shrunkInside, shrunkInside.roofModel.roofPlanePatches[0]!, ["pv-a", "pv-b"]);

    const tooSmallPatch = roofPatch("roof-A", { widthM: 3, heightM: 3 });
    const tooSmall = sceneFor([tooSmallPatch], makeInputs("roof-A"));
    expect(tooSmall.metadata.pvPlacementValidityStatus).toBe("INVALID");
    expect(tooSmall.pvPanels.some((p) => p.placementValidity.reasons.includes("outside_roof_surface"))).toBe(true);
  });

  it("nouvelle zone interdite : collision PV détectée sans repositionnement automatique", () => {
    const patch = roofPatch("roof-A");
    const inputs = makeInputs("roof-A");
    const obs = buildRoofVolumes3D(
      {
        obstacles: [
          {
            id: "chimney-over-pv",
            kind: "chimney",
            structuralRole: "obstacle_structuring",
            heightM: 0.8,
            footprint: {
              mode: "world",
              footprintWorld: [
                { x: 1.8, y: 1.8, z: 8 },
                { x: 2.8, y: 1.8, z: 8 },
                { x: 2.8, y: 2.8, z: 8 },
                { x: 1.8, y: 2.8, z: 8 },
              ],
            },
            relatedPlanePatchIds: ["roof-A"],
            extrusionPreference: "hybrid_vertical_on_plane",
          },
        ],
        extensions: [],
      },
      { roofPlanePatches: [patch] },
    );
    const pv = buildPvPanels3D({ panels: inputs }, { roofPlanePatches: [patch], obstacleVolumes: obs.obstacleVolumes, extensionVolumes: [] });
    const scene = buildSolarScene3D({
      roofModel: { ...createEmptyRoofModel3D(), roofPlanePatches: [patch] },
      obstacleVolumes: obs.obstacleVolumes,
      extensionVolumes: [],
      volumesQuality: obs.globalQuality,
      pvPanels: pv.panels,
    });

    expect(scene.metadata.pvPlacementValidityStatus).toBe("INVALID");
    const invalid = scene.pvPanels.find((p) => p.id === "pv-a")!;
    expect(invalid.placementValidity.reasons).toContain("intersects_keepout_volume");
    expect(invalid.center3D).toEqual(pv.panels.find((p) => p.id === "pv-a")!.center3D);
  });

  it("suppression de pan : aucun PV ni obstacle ne référence le pan supprimé", () => {
    const patchA = roofPatch("roof-A");
    const patchB = roofPatch("roof-B", { azimuthDeg: 90 });
    const inputs = [
      ...makeInputs("roof-A"),
      ...makeInputs("roof-B").map((p) => ({ ...p, id: `b-${p.id}` })),
    ];
    const afterDeletionInputs = inputs.filter((p) => p.roofPlanePatchId !== "roof-A");
    const scene = sceneFor([patchB], afterDeletionInputs, inputs.length);

    expect(scene.pvPanels).toHaveLength(2);
    expect(scene.pvPanels.every((p) => p.attachment.roofPlanePatchId === "roof-B")).toBe(true);
    expect(scene.pvPanels.some((p) => p.attachment.roofPlanePatchId === "roof-A")).toBe(false);
    expect(scene.metadata.pvPlacementDroppedPanelCount).toBe(2);
    expect(scene.metadata.pvPlacementValidityStatus).toBe("INVALID");

    const volumes = buildRoofVolumes3D(
      {
        obstacles: [
          {
            id: "obs-a",
            kind: "other",
            structuralRole: "obstacle_simple",
            heightM: 1,
            footprint: { mode: "world", footprintWorld: [{ x: 1, y: 1, z: 8 }, { x: 2, y: 1, z: 8 }, { x: 1.5, y: 2, z: 8 }] },
            relatedPlanePatchIds: ["roof-A"],
          },
          {
            id: "obs-b",
            kind: "other",
            structuralRole: "obstacle_simple",
            heightM: 1,
            footprint: { mode: "world", footprintWorld: [{ x: 1, y: 1, z: 8 }, { x: 2, y: 1, z: 8 }, { x: 1.5, y: 2, z: 8 }] },
            relatedPlanePatchIds: ["roof-B"],
          },
        ],
        extensions: [],
      },
      { roofPlanePatches: [patchB] },
    );
    expect(volumes.obstacleVolumes.map((v) => v.id)).toEqual(["obs-b"]);
    expect(volumes.globalQuality.diagnostics.some((d) => d.code === "OBSTACLE_ORPHAN_PLANE_PATCH_SKIPPED")).toBe(true);
  });

  it("suppression puis recréation : un nouveau pan d'id différent ne récupère pas les anciens PV", () => {
    const recreated = roofPatch("roof-A-new");
    const oldInputs = makeInputs("roof-A");
    const pv = buildPvPanels3D({ panels: oldInputs }, { roofPlanePatches: [recreated] });
    const scene = buildSolarScene3D({
      roofModel: { ...createEmptyRoofModel3D(), roofPlanePatches: [recreated] },
      obstacleVolumes: [],
      extensionVolumes: [],
      volumesQuality: createDefaultQualityBlock(),
      pvPanels: pv.panels,
      pvPanelPlacementRequestedCount: oldInputs.length,
    });

    expect(scene.pvPanels).toHaveLength(0);
    expect(scene.metadata.pvPlacementDroppedPanelCount).toBe(2);
    expect(scene.metadata.pvPlacementValidityStatus).toBe("INVALID");
  });

  it("torture mutations : retour géométrique identique sans dérive cumulée", () => {
    const inputs = makeInputs("roof-A");
    const initialPatch = roofPatch("roof-A", { tiltDeg: 20, azimuthDeg: 15, widthM: 8, heightM: 6 });
    const initial = sceneFor([initialPatch], inputs);
    let current = initial;

    for (let i = 0; i < 8; i++) {
      current = sceneFor([roofPatch("roof-A", { tiltDeg: 32, azimuthDeg: 80, widthM: 8.5, heightM: 6.3 })], inputs);
      current = sceneFor([roofPatch("roof-A", { tiltDeg: 20, azimuthDeg: 15, widthM: 8, heightM: 6 })], inputs);
    }

    for (const finalPanel of current.pvPanels) {
      const initialPanel = initial.pvPanels.find((p) => p.id === finalPanel.id)!;
      const d = sub3(finalPanel.center3D, initialPanel.center3D);
      expect(Math.hypot(d.x, d.y, d.z)).toBeLessThan(EPS_DRIFT_M);
      expect(Math.abs(finalPanel.pose.rotationDegInPlane - initialPanel.pose.rotationDegInPlane)).toBeLessThan(EPS_LOCAL_M);
      expect(finalPanel.attachment.roofPlanePatchId).toBe(initialPanel.attachment.roofPlanePatchId);
    }
  });

  it("save/reload après mutation : état PV strictement reproductible", () => {
    const patch = roofPatch("roof-A", { tiltDeg: 31, azimuthDeg: 42, widthM: 7, heightM: 5 });
    const scene = sceneFor([patch], makeInputs("roof-A"));
    const parsed = parseSolarScene3DJson(serializeSolarScene3DStableSorted(scene)) as SolarScene3D;

    expect(parsed.pvPanels.map((p) => p.id)).toEqual(scene.pvPanels.map((p) => p.id));
    expect(parsed.pvPanels.map((p) => p.attachment.roofPlanePatchId)).toEqual(scene.pvPanels.map((p) => p.attachment.roofPlanePatchId));
    expect(parsed.pvPanels.map((p) => p.center3D)).toEqual(scene.pvPanels.map((p) => p.center3D));
    expect(parsed.pvPanels.map((p) => p.placementValidity.status)).toEqual(scene.pvPanels.map((p) => p.placementValidity.status));
  });
});
