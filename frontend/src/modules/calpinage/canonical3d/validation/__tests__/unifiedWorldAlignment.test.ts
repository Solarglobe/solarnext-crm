/**
 * Prompt 32 — calage repère monde unique : px → monde → Three (identité), builder legacy, bbox, nord.
 */

import { describe, it, expect } from "vitest";
import { buildRoofModel3DFromLegacyGeometry } from "../../builder/buildRoofModel3DFromLegacyGeometry";
import { imagePxToWorldHorizontalM, worldHorizontalMToImagePx } from "../../builder/worldMapping";
import type { LegacyRoofGeometryInput } from "../../builder/legacyInput";
import {
  worldMetersToThreeJsPosition,
  UNIFIED_WORLD_IMAGE_ORIGIN_PX,
  toUnifiedWorldFrame,
} from "../../world/unifiedWorldFrame";
import type { CanonicalWorldConfig } from "../../world/worldConvention";
import { computeSolarSceneBoundingBox } from "../../viewer/solarSceneBounds";
import { computeViewerFraming } from "../../viewer/viewerFraming";
import { buildSolarScene3D } from "../../scene/buildSolarScene3D";
import { appendUnifiedWorldAlignmentIssues, dotImageAxesWorld } from "../validateUnifiedWorldAlignment";
import type { CoherenceIssue, Scene2DSourceTrace } from "../../types/scene2d3dCoherence";
import type { SolarScene3D } from "../../types/solarScene3d";
import { validate2DTo3DCoherence } from "../validate2DTo3DCoherence";
import { SOLAR_SCENE_3D_SCHEMA_VERSION } from "../../types/solarScene3d";

describe("Unified world alignment (Prompt 32)", () => {
  const mpp = 0.02;
  const north = 33.7;

  it("Test A — point px → monde → Three : cohérent avec identité ENU Z-up", () => {
    const xPx = 100;
    const yPx = 200;
    const xy = imagePxToWorldHorizontalM(xPx, yPx, mpp, north);
    const zM = 8.5;
    const three = worldMetersToThreeJsPosition(xy.x, xy.y, zM);
    expect(three.x).toBeCloseTo(xy.x, 10);
    expect(three.y).toBeCloseTo(xy.y, 10);
    expect(three.z).toBeCloseTo(zM, 10);
    const inv = worldHorizontalMToImagePx(xy.x, xy.y, mpp, north);
    expect(inv.xPx).toBeCloseTo(xPx, 8);
    expect(inv.yPx).toBeCloseTo(yPx, 8);
  });

  it("Test B — coin bâtiment : polygone px → cornersWorld (x,y) via builder", () => {
    const input: LegacyRoofGeometryInput = {
      metersPerPixel: mpp,
      northAngleDeg: north,
      defaultHeightM: 11,
      pans: [
        {
          id: "pan-footprint",
          polygonPx: [
            { xPx: 0, yPx: 0, heightM: 11 },
            { xPx: 100, yPx: 0, heightM: 11 },
            { xPx: 100, yPx: 50, heightM: 11 },
            { xPx: 0, yPx: 50, heightM: 11 },
          ],
        },
      ],
    };
    const { model } = buildRoofModel3DFromLegacyGeometry(input);
    const patch = model.roofPlanePatches[0]!;
    expect(patch.cornersWorld.length).toBe(4);
    for (let i = 0; i < 4; i++) {
      const p = input.pans[0]!.polygonPx[i]!;
      const exp = imagePxToWorldHorizontalM(p.xPx, p.yPx, mpp, north);
      const c = patch.cornersWorld[i]!;
      expect(c.x).toBeCloseTo(exp.x, 8);
      expect(c.y).toBeCloseTo(exp.y, 8);
      expect(c.z).toBeCloseTo(0, 8);
    }
  });

  it("Test C — bbox 2D (px→monde) == bbox 3D horizontal (coins patch)", () => {
    const input: LegacyRoofGeometryInput = {
      metersPerPixel: mpp,
      northAngleDeg: north,
      defaultHeightM: 9,
      pans: [
        {
          id: "pan-rect",
          polygonPx: [
            { xPx: 10, yPx: 20, heightM: 9 },
            { xPx: 110, yPx: 20, heightM: 9 },
            { xPx: 110, yPx: 70, heightM: 9 },
            { xPx: 10, yPx: 70, heightM: 9 },
          ],
        },
      ],
    };
    const { model } = buildRoofModel3DFromLegacyGeometry(input);
    const corners = model.roofPlanePatches[0]!.cornersWorld;
    const fromPx = input.pans[0]!.polygonPx.map((p) => imagePxToWorldHorizontalM(p.xPx, p.yPx, mpp, north));
    const minX = Math.min(...fromPx.map((p) => p.x));
    const maxX = Math.max(...fromPx.map((p) => p.x));
    const minY = Math.min(...fromPx.map((p) => p.y));
    const maxY = Math.max(...fromPx.map((p) => p.y));
    const minX3 = Math.min(...corners.map((c) => c.x));
    const maxX3 = Math.max(...corners.map((c) => c.x));
    const minY3 = Math.min(...corners.map((c) => c.y));
    const maxY3 = Math.max(...corners.map((c) => c.y));
    expect(minX3).toBeCloseTo(minX, 8);
    expect(maxX3).toBeCloseTo(maxX, 8);
    expect(minY3).toBeCloseTo(minY, 8);
    expect(maxY3).toBeCloseTo(maxY, 8);
  });

  it("Test D — orientation nord : orthogonalité des pas px en monde (tous angles)", () => {
    for (const nd of [0, 15, -40, 90, 123.456]) {
      const d = dotImageAxesWorld(mpp, nd);
      expect(Math.abs(d)).toBeLessThan(mpp * mpp * 1e-8);
    }
  });

  it("Contrat UnifiedWorldFrame + origine image figée", () => {
    const cfg: CanonicalWorldConfig = { metersPerPixel: mpp, northAngleDeg: 0, referenceFrame: "LOCAL_IMAGE_ENU" };
    const u = toUnifiedWorldFrame(cfg);
    expect(u).not.toBeNull();
    expect(u!.imageOriginPx).toEqual(UNIFIED_WORLD_IMAGE_ORIGIN_PX);
  });

  it("Caméra : cible = centre de la bbox monde réelle (pas de décalage arbitraire)", () => {
    const input: LegacyRoofGeometryInput = {
      metersPerPixel: mpp,
      northAngleDeg: 0,
      defaultHeightM: 5,
      pans: [
        {
          id: "p",
          polygonPx: [
            { xPx: 0, yPx: 0, heightM: 5 },
            { xPx: 50, yPx: 0, heightM: 5 },
            { xPx: 50, yPx: 50, heightM: 5 },
            { xPx: 0, yPx: 50, heightM: 5 },
          ],
        },
      ],
    };
    const { model } = buildRoofModel3DFromLegacyGeometry(input);
    const scene: SolarScene3D = buildSolarScene3D({
      worldConfig: { metersPerPixel: mpp, northAngleDeg: 0, referenceFrame: "LOCAL_IMAGE_ENU" },
      roofModel: model,
      obstacleVolumes: [],
      extensionVolumes: [],
      volumesQuality: model.globalQuality,
      pvPanels: [],
    });
    const box = computeSolarSceneBoundingBox(scene);
    const framing = computeViewerFraming(box, 16 / 9);
    const cx = (box.min.x + box.max.x) / 2;
    const cy = (box.min.y + box.max.y) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    expect(framing.target.x).toBeCloseTo(cx, 6);
    expect(framing.target.y).toBeCloseTo(cy, 6);
    expect(framing.target.z).toBeCloseTo(cz, 6);
  });

  it("Garde-fous : sondes px↔monde sans WORLD_MAPPING_INCONSISTENT (implémentation cohérente)", () => {
    const { model } = buildRoofModel3DFromLegacyGeometry({
      metersPerPixel: mpp,
      northAngleDeg: north,
      defaultHeightM: 5,
      pans: [
        {
          id: "p",
          polygonPx: [
            { xPx: 0, yPx: 0, heightM: 5 },
            { xPx: 10, yPx: 0, heightM: 5 },
            { xPx: 10, yPx: 10, heightM: 5 },
          ],
        },
      ],
    });
    const scene: SolarScene3D = buildSolarScene3D({
      worldConfig: { metersPerPixel: mpp, northAngleDeg: north, referenceFrame: "LOCAL_IMAGE_ENU" },
      roofModel: model,
      obstacleVolumes: [],
      extensionVolumes: [],
      volumesQuality: model.globalQuality,
      pvPanels: [],
    });
    const issues: CoherenceIssue[] = [];
    appendUnifiedWorldAlignmentIssues(scene, issues);
    expect(issues.some((i) => i.code === "WORLD_MAPPING_INCONSISTENT")).toBe(false);
    expect(issues.some((i) => i.code === "NORTH_ROTATION_MISMATCH")).toBe(false);
  });

  it("BBOX_2D_3D_MISMATCH si contour source px ne correspond pas à l’emprise pans (heuristique)", () => {
    const { model } = buildRoofModel3DFromLegacyGeometry({
      metersPerPixel: 0.02,
      northAngleDeg: 0,
      defaultHeightM: 3,
      pans: [
        {
          id: "small",
          polygonPx: [
            { xPx: 0, yPx: 0, heightM: 3 },
            { xPx: 10, yPx: 0, heightM: 3 },
            { xPx: 10, yPx: 10, heightM: 3 },
            { xPx: 0, yPx: 10, heightM: 3 },
          ],
        },
      ],
    });
    const sourceTrace: Scene2DSourceTrace = {
      schemaVersion: "scene-2d-source-trace-v1",
      sourcePanIds: ["small"],
      sourceObstacleIds: [],
      sourcePanelIds: [],
      roofOutline2D: {
        contourPx: [
          { x: 5000, y: 5000 },
          { x: 5100, y: 5000 },
          { x: 5100, y: 5100 },
          { x: 5000, y: 5100 },
        ],
      },
    };
    const scene: SolarScene3D = {
      metadata: {
        schemaVersion: SOLAR_SCENE_3D_SCHEMA_VERSION,
        createdAtIso: new Date().toISOString(),
        generator: "manual",
      },
      worldConfig: { metersPerPixel: 0.02, northAngleDeg: 0, referenceFrame: "LOCAL_IMAGE_ENU" },
      sourceTrace,
      roofModel: model,
      obstacleVolumes: [],
      extensionVolumes: [],
      pvPanels: [],
      volumesQuality: model.globalQuality,
    };
    const issues: CoherenceIssue[] = [];
    appendUnifiedWorldAlignmentIssues(scene, issues);
    expect(issues.some((i) => i.code === "BBOX_2D_3D_MISMATCH")).toBe(true);
  });

  it("validate2DTo3DCoherence inclut les garde-fous alignement (pas d’erreur sur scène builder)", () => {
    const { model } = buildRoofModel3DFromLegacyGeometry({
      metersPerPixel: 0.01,
      northAngleDeg: -7,
      defaultHeightM: 4,
      pans: [
        {
          id: "p1",
          polygonPx: [
            { xPx: 0, yPx: 0, heightM: 4 },
            { xPx: 50, yPx: 0, heightM: 4 },
            { xPx: 25, yPx: 40, heightM: 4 },
          ],
        },
      ],
    });
    const scene: SolarScene3D = buildSolarScene3D({
      worldConfig: { metersPerPixel: 0.01, northAngleDeg: -7, referenceFrame: "LOCAL_IMAGE_ENU" },
      roofModel: model,
      obstacleVolumes: [],
      extensionVolumes: [],
      volumesQuality: model.globalQuality,
      pvPanels: [],
    });
    const r = validate2DTo3DCoherence(scene);
    expect(r.issues.some((i) => i.code === "WORLD_MAPPING_INCONSISTENT")).toBe(false);
    expect(r.issues.some((i) => i.code === "NORTH_ROTATION_MISMATCH")).toBe(false);
  });
});
