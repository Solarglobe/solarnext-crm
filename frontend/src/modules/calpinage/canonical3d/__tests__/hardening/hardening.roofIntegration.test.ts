/**
 * Toitures issues du builder legacy 2D→3D : fumée + invariants (sans obstacle).
 */
import { describe, expect, it } from "vitest";
import { buildRoofModel3DFromLegacyGeometry } from "../../builder/buildRoofModel3DFromLegacyGeometry";
import { buildPvPanels3D } from "../../pvPanels/buildPvPanels3D";
import { DEFAULT_NEAR_SHADING_RAYCAST_PARAMS } from "../../nearShading3d/nearShadingParams";
import { runNearShadingSeries } from "../../nearShading3d/nearShadingEngine";
import { SUN_ZENITH } from "./hardeningSceneFactories";
import { assertAnnualAggregateInvariants } from "./nearShadingInvariantAsserts";

const MPP = 0.05;

describe("hardening — toiture builder → near 3D", () => {
  it("un pan horizontal : zénith sans obstacle → ombre nulle", () => {
    const { model } = buildRoofModel3DFromLegacyGeometry({
      metersPerPixel: MPP,
      northAngleDeg: 0,
      defaultHeightM: 10,
      pans: [
        {
          id: "pan-a",
          polygonPx: [
            { xPx: 0, yPx: 0, heightM: 10 },
            { xPx: 100, yPx: 0, heightM: 10 },
            { xPx: 100, yPx: 100, heightM: 10 },
            { xPx: 0, yPx: 100, heightM: 10 },
          ],
        },
      ],
    });
    expect(model.roofPlanePatches.length).toBe(1);
    const patch = model.roofPlanePatches[0]!;
    const { panels } = buildPvPanels3D(
      {
        panels: [
          {
            id: "pv-1",
            roofPlanePatchId: patch.id,
            center: { mode: "plane_uv", uv: { u: 2.5, v: 2.5 } },
            widthM: 0.8,
            heightM: 1.2,
            orientation: "portrait",
            rotationDegInPlane: 0,
            sampling: { nx: 2, ny: 2 },
          },
        ],
      },
      { roofPlanePatches: model.roofPlanePatches }
    );
    const series = runNearShadingSeries(
      {
        panels,
        obstacleVolumes: [],
        extensionVolumes: [],
        params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
      },
      [SUN_ZENITH]
    );
    assertAnnualAggregateInvariants(series.annual);
    expect(series.annual.meanShadedFraction).toBe(0);
  });

  it("deux pans adjacents : modèle 2 patches, panneau sur pan 1, zénith sans obstacle", () => {
    const { model } = buildRoofModel3DFromLegacyGeometry({
      metersPerPixel: MPP,
      northAngleDeg: 0,
      defaultHeightM: 8,
      pans: [
        {
          id: "p1",
          polygonPx: [
            { xPx: 0, yPx: 0, heightM: 8 },
            { xPx: 100, yPx: 0, heightM: 8 },
            { xPx: 100, yPx: 100, heightM: 8 },
            { xPx: 0, yPx: 100, heightM: 8 },
          ],
        },
        {
          id: "p2",
          polygonPx: [
            { xPx: 100, yPx: 0, heightM: 8 },
            { xPx: 200, yPx: 0, heightM: 8 },
            { xPx: 200, yPx: 100, heightM: 8 },
            { xPx: 100, yPx: 100, heightM: 8 },
          ],
        },
      ],
    });
    expect(model.roofPlanePatches.length).toBe(2);
    const p0 = model.roofPlanePatches[0]!;
    const { panels } = buildPvPanels3D(
      {
        panels: [
          {
            id: "pv-edge",
            roofPlanePatchId: p0.id,
            center: { mode: "plane_uv", uv: { u: 4.5, v: 2.5 } },
            widthM: 0.6,
            heightM: 1.0,
            orientation: "portrait",
            rotationDegInPlane: 0,
            sampling: { nx: 3, ny: 2 },
          },
        ],
      },
      { roofPlanePatches: model.roofPlanePatches }
    );
    const series = runNearShadingSeries(
      {
        panels,
        obstacleVolumes: [],
        extensionVolumes: [],
        params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
      },
      [SUN_ZENITH]
    );
    assertAnnualAggregateInvariants(series.annual);
    expect(series.annual.meanShadedFraction).toBe(0);
  });
});
