/**
 * Cohérence 2D → 3D — cas nominaux et régressions (Prompt 10).
 */

import { describe, it, expect } from "vitest";
import { buildRoofVolumes3D } from "../../volumes/buildRoofVolumes3D";
import { buildPvPanels3D } from "../../pvPanels/buildPvPanels3D";
import { buildSolarScene3D } from "../../scene/buildSolarScene3D";
import { makeHorizontalSquarePatch } from "../../__tests__/hardening/hardeningSceneFactories";
import { createDefaultQualityBlock, createEmptyRoofModel3D } from "../../utils/factories";
import type { SolarScene3D } from "../../types/solarScene3d";
import type { CanonicalWorldConfig } from "../../world/worldConvention";
import type { Scene2DSourceTrace } from "../../types/scene2d3dCoherence";
import { validate2DTo3DCoherence } from "../validate2DTo3DCoherence";

const worldOk: CanonicalWorldConfig = {
  metersPerPixel: 0.02,
  northAngleDeg: 12,
  referenceFrame: "LOCAL_IMAGE_ENU",
};

function sceneSimpleValide(): SolarScene3D {
  const patch = makeHorizontalSquarePatch("pan-a", 20, 10);
  const roofModel = { ...createEmptyRoofModel3D(), roofPlanePatches: [patch] };
  const volRes = buildRoofVolumes3D(
    {
      obstacles: [
        {
          id: "obs-1",
          kind: "chimney",
          structuralRole: "obstacle_simple",
          heightM: 1.5,
          footprint: {
            mode: "world",
            footprintWorld: [
              { x: 2, y: 2, z: 10 },
              { x: 4, y: 2, z: 10 },
              { x: 4, y: 4, z: 10 },
              { x: 2, y: 4, z: 10 },
            ],
          },
          relatedPlanePatchIds: ["pan-a"],
        },
      ],
      extensions: [],
    },
    { roofPlanePatches: [patch] },
  );
  const pvRes = buildPvPanels3D(
    {
      panels: [
        {
          id: "pv-1",
          roofPlanePatchId: "pan-a",
          center: { mode: "plane_uv", uv: { u: 10, v: 10 } },
          widthM: 1,
          heightM: 1.7,
          orientation: "portrait",
          rotationDegInPlane: 0,
          sampling: { nx: 2, ny: 2, includeEdgeMidpoints: false },
        },
      ],
    },
    { roofPlanePatches: [patch] },
  );
  const sourceTrace: Scene2DSourceTrace = {
    schemaVersion: "scene-2d-source-trace-v1",
    sourcePanIds: ["pan-a"],
    sourceObstacleIds: ["obs-1"],
    sourcePanelIds: ["pv-1"],
    expectedRoofPlanePatchIds: ["pan-a"],
    metrics: { sourcePanCount: 1, sourceObstacleCount: 1, sourcePanelCount: 1 },
  };

  return buildSolarScene3D({
    worldConfig: worldOk,
    sourceTrace,
    roofModel,
    obstacleVolumes: volRes.obstacleVolumes,
    extensionVolumes: volRes.extensionVolumes,
    volumesQuality: volRes.globalQuality,
    pvPanels: pvRes.panels,
  });
}

describe("validate2DTo3DCoherence", () => {
  it("Cas 1 — toit simple + obstacles + panneaux → isCoherent true", () => {
    const scene = sceneSimpleValide();
    const c = scene.coherence!;
    expect(c.isCoherent).toBe(true);
    expect(c.confidence.geometryConfidence).toBe("HIGH");
    expect(c.confidence.source2DLinked).toBe(true);
    expect(c.stats.panCount).toBe(1);
    expect(c.stats.panelCount).toBeGreaterThanOrEqual(1);
    expect(c.stats.shadowVolumeCount).toBeGreaterThanOrEqual(1);
    expect(c.summary.hasSourceTrace).toBe(true);
    expect(c.summary.hasBlockingGeometryErrors).toBe(false);
    expect(c.summary.errorCount).toBe(0);
    expect(c.sceneQualityGrade === "A" || c.sceneQualityGrade === "B").toBe(true);
  });

  it("Cas 2 — panneau orphelin (patch inconnu)", () => {
    const scene = sceneSimpleValide();
    const p0 = scene.pvPanels[0]!;
    const badPanel = {
      ...p0,
      attachment: {
        ...p0.attachment,
        roofPlanePatchId: "fantôme",
        kind: "single_plane_resolved" as const,
      },
    };
    const broken: SolarScene3D = { ...scene, pvPanels: [badPanel] };
    const r = validate2DTo3DCoherence(broken);
    expect(r.isCoherent).toBe(false);
    expect(r.issues.some((i) => i.code === "PANEL_PARENT_PAN_UNRESOLVED")).toBe(true);
  });

  it("Cas 3 — obstacle orphelin (pan inexistant)", () => {
    const scene = sceneSimpleValide();
    const v0 = scene.obstacleVolumes[0]!;
    const badVol = {
      ...v0,
      relatedPlanePatchIds: ["n-existe-pas"],
    };
    const broken: SolarScene3D = { ...scene, obstacleVolumes: [badVol] };
    const r = validate2DTo3DCoherence(broken);
    expect(r.isCoherent).toBe(false);
    expect(r.issues.some((i) => i.code === "OBSTACLE_PARENT_PATCH_MISMATCH")).toBe(true);
  });

  it("Cas 4 — volume dégénéré (maillage vide)", () => {
    const scene = sceneSimpleValide();
    const v0 = scene.obstacleVolumes[0]!;
    const badVol = { ...v0, vertices: [], faces: [] };
    const broken: SolarScene3D = { ...scene, obstacleVolumes: [badVol] };
    const r = validate2DTo3DCoherence(broken);
    expect(r.isCoherent).toBe(false);
    expect(r.issues.some((i) => i.code === "SHADOW_VOLUME_DEGENERATE_MESH")).toBe(true);
  });

  it("Cas 5 — monde invalide (mpp ≤ 0)", () => {
    const scene = sceneSimpleValide();
    const broken: SolarScene3D = {
      ...scene,
      worldConfig: { metersPerPixel: 0, northAngleDeg: 0, referenceFrame: "LOCAL_IMAGE_ENU" },
    };
    const r = validate2DTo3DCoherence(broken);
    expect(r.isCoherent).toBe(false);
    expect(r.issues.some((i) => i.code === "WORLD_MPP_INVALID")).toBe(true);
  });

  it("Cas 6 — pan dégénéré (< 3 sommets)", () => {
    const patch = makeHorizontalSquarePatch("pan-b", 10, 5);
    const badPatch = {
      ...patch,
      cornersWorld: [
        { x: 0, y: 0, z: 5 },
        { x: 1, y: 0, z: 5 },
      ],
      boundaryVertexIds: ["a", "b"],
      boundaryEdgeIds: ["e1"],
    };
    const roofModel = { ...createEmptyRoofModel3D(), roofPlanePatches: [badPatch] };
    const scene = buildSolarScene3D({
      worldConfig: worldOk,
      roofModel,
      obstacleVolumes: [],
      extensionVolumes: [],
      volumesQuality: createDefaultQualityBlock(),
      pvPanels: [],
    });
    expect(scene.coherence?.isCoherent).toBe(false);
    expect(scene.coherence?.issues.some((i) => i.code === "PAN_DEGENERATE_VERTICES")).toBe(true);
  });

  it("Cas 7 — divergence toiture legacy vs ids attendus (patches scène ≠ expected)", () => {
    const scene = sceneSimpleValide();
    const broken: SolarScene3D = {
      ...scene,
      sourceTrace: {
        ...scene.sourceTrace!,
        expectedRoofPlanePatchIds: ["intrus-1", "intrus-2", "intrus-3"],
      },
    };
    const r = validate2DTo3DCoherence(broken);
    expect(r.issues.some((i) => i.code === "ROOF_PATCH_SOURCE_DIVERGENCE" && i.severity === "ERROR")).toBe(true);
    expect(r.confidence.geometryConfidence).toBe("LOW");
  });

  it("Cas 8 — panneaux locaux OK mais dispersion globale (bbox centres vs emprise pans)", () => {
    const scene = sceneSimpleValide();
    const p0 = scene.pvPanels[0]!;
    const far = {
      ...p0,
      id: "pv-far",
      center3D: { x: 500, y: 500, z: p0.center3D.z },
      corners3D: p0.corners3D.map((c) => ({ x: c.x + 500, y: c.y + 500, z: c.z })) as typeof p0.corners3D,
    };
    const broken: SolarScene3D = {
      ...scene,
      pvPanels: [p0, far],
      sourceTrace: {
        ...scene.sourceTrace!,
        sourcePanelIds: ["pv-1", "pv-far"],
      },
    };
    const r = validate2DTo3DCoherence(broken);
    expect(r.issues.some((i) => i.code === "PANEL_LAYOUT_GLOBAL_FOOTPRINT_MISMATCH")).toBe(true);
    expect(r.confidence.geometryConfidence).not.toBe("HIGH");
  });

  it("Cas 9 — scène amputée vs source (panneaux source annoncés mais absents)", () => {
    const scene = sceneSimpleValide();
    const broken: SolarScene3D = {
      ...scene,
      sourceTrace: {
        ...scene.sourceTrace!,
        sourcePanelIds: ["pv-1", "pv-manquant-a", "pv-manquant-b"],
      },
    };
    const r = validate2DTo3DCoherence(broken);
    expect(r.issues.some((i) => i.code === "SOURCE_PANEL_MISSING_IN_SCENE")).toBe(true);
    expect(r.issues.some((i) => i.code === "SOURCE_COVERAGE_LOW")).toBe(true);
  });

  it("Cas 10 — sans sourceTrace : warning traçabilité + confiance non maximale", () => {
    const scene = sceneSimpleValide();
    const sansTrace: SolarScene3D = { ...scene, sourceTrace: undefined };
    const r = validate2DTo3DCoherence(sansTrace);
    expect(r.issues.some((i) => i.code === "ROOF_SOURCE_TRACE_TOO_WEAK")).toBe(true);
    expect(r.confidence.roofTraceabilityLevel).toBe("NONE");
    expect(r.confidence.geometryConfidence).toBe("MEDIUM");
    expect(r.summary.hasSourceTrace).toBe(false);
    expect(r.sceneQualityGrade).toBe("B");
  });

  it("Cas 11 — obstacle : primaryPlanePatchId absent de relatedPlanePatchIds", () => {
    const scene = sceneSimpleValide();
    const v0 = scene.obstacleVolumes[0]!;
    const badVol = {
      ...v0,
      relatedPlanePatchIds: ["pan-a"],
      roofAttachment: {
        ...v0.roofAttachment,
        primaryPlanePatchId: "autre-pan",
      },
    };
    const broken: SolarScene3D = { ...scene, obstacleVolumes: [badVol] };
    const r = validate2DTo3DCoherence(broken);
    expect(r.issues.some((i) => i.code === "OBSTACLE_SUPPORT_GEOMETRY_DIVERGENCE")).toBe(true);
    expect(r.isCoherent).toBe(false);
  });

  it("Cas 12 — panneau : normale module opposée au patch parent", () => {
    const scene = sceneSimpleValide();
    const p0 = scene.pvPanels[0]!;
    const flipped = {
      ...p0,
      outwardNormal: { x: -p0.outwardNormal.x, y: -p0.outwardNormal.y, z: -p0.outwardNormal.z },
    };
    const broken: SolarScene3D = { ...scene, pvPanels: [flipped] };
    const r = validate2DTo3DCoherence(broken);
    expect(r.issues.some((i) => i.code === "PANEL_PARENT_PATCH_MISMATCH")).toBe(true);
    expect(r.isCoherent).toBe(false);
  });
});
