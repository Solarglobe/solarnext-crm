/**
 * Tests adaptateur panneaux posés → PvPanelPlacementInput (Prompt 5).
 */

import { describe, it, expect } from "vitest";
import { buildRoofModel3DFromLegacyGeometry } from "../../builder/buildRoofModel3DFromLegacyGeometry";
import { buildPvPanels3D } from "../../pvPanels/buildPvPanels3D";
import {
  buildCanonicalPlacedPanelsFromRuntime,
  inferModuleDimsFromProjectionQuadPx,
  mapPvEnginePanelsToPanelInputs,
} from "../buildCanonicalPlacedPanelsFromRuntime";
import type { HeightResolverContext } from "../../../core/heightResolver";

function minimalLegacyRoof(panId = "pan-a") {
  const mpp = 0.05;
  return {
    metersPerPixel: mpp,
    northAngleDeg: 0,
    defaultHeightM: 10,
    pans: [
      {
        id: panId,
        polygonPx: [
          { xPx: 0, yPx: 0, heightM: 10 },
          { xPx: 100, yPx: 0, heightM: 10 },
          { xPx: 100, yPx: 100, heightM: 10 },
          { xPx: 0, yPx: 100, heightM: 10 },
        ],
      },
    ],
  };
}

describe("inferModuleDimsFromProjectionQuadPx", () => {
  it("moyenne des arêtes opposées × mpp", () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ];
    const { widthM, heightM } = inferModuleDimsFromProjectionQuadPx(poly, 0.01);
    expect(widthM).toBeCloseTo(1);
    expect(heightM).toBeCloseTo(0.5);
  });
});

describe("mapPvEnginePanelsToPanelInputs", () => {
  it("produit un PanelInput avec panId et polygone", () => {
    const raw = [
      {
        id: "blk_0",
        panId: "pan-a",
        rotationDeg: 0,
        center: { x: 50, y: 50 },
        polygonPx: [
          { x: 40, y: 40 },
          { x: 60, y: 40 },
          { x: 60, y: 60 },
          { x: 40, y: 60 },
        ],
        enabled: true,
      },
    ];
    const engine = {
      getBlockById: () => ({ orientation: "PORTRAIT" }),
    };
    const out = mapPvEnginePanelsToPanelInputs(raw, engine, 0.05);
    expect(out.length).toBe(1);
    expect(out[0].panId).toBe("pan-a");
    expect(out[0].polygonPx?.length).toBe(4);
    expect(out[0].moduleWidthM).toBeGreaterThan(0);
  });
});

describe("buildCanonicalPlacedPanelsFromRuntime", () => {
  it("mappe panId → patch et produit des entrées buildPvPanels3D valides", () => {
    const legacy = minimalLegacyRoof("pan-a");
    const { model } = buildRoofModel3DFromLegacyGeometry(legacy);
    const patches = model.roofPlanePatches;
    expect(patches.length).toBeGreaterThan(0);

    const blockId = "block-test";
    const rawPanels = [
      {
        id: `${blockId}_0`,
        panId: "pan-a",
        rotationDeg: 0,
        center: { x: 50, y: 50 },
        polygonPx: [
          { x: 40, y: 40 },
          { x: 60, y: 40 },
          { x: 60, y: 60 },
          { x: 40, y: 60 },
        ],
        enabled: true,
      },
    ];

    const getHeightAtXY = () => 10;
    const ctx: HeightResolverContext = { state: {}, getHeightAtXY };

    const res = buildCanonicalPlacedPanelsFromRuntime({
      roofPlanePatches: patches,
      metersPerPixel: legacy.metersPerPixel,
      northAngleDeg: 0,
      rawPanels,
      placementEngine: {
        getBlockById: (id: string) =>
          id === blockId ? { orientation: "PORTRAIT", panels: [{}] } : null,
      },
      heightResolverContext: ctx,
      options: { useHeightResolverForCenterZ: true, defaultZFallbackM: 10 },
    });

    expect(res.ok).toBe(true);
    expect(res.placementInputs.length).toBe(1);
    expect(res.placementInputs[0].roofPlanePatchId).toBe("pan-a");
    expect(res.rows[0].zResolutionOk).toBe(true);

    const pv = buildPvPanels3D({ panels: [...res.placementInputs] }, { roofPlanePatches: patches });
    expect(pv.panels.length).toBe(1);
    expect(pv.panels[0].surfaceAreaM2).toBeGreaterThan(0);
  });

  it("Z centre suit panId via resolveHeightAtXY (pente simulée)", () => {
    const legacy = minimalLegacyRoof("pan-a");
    const { model } = buildRoofModel3DFromLegacyGeometry(legacy);
    const getHeightAtXY = (_pid: string, x: number, y: number) => 10 + 0.02 * x;
    const ctx: HeightResolverContext = { state: {}, getHeightAtXY };

    const res = buildCanonicalPlacedPanelsFromRuntime({
      roofPlanePatches: model.roofPlanePatches,
      metersPerPixel: legacy.metersPerPixel,
      northAngleDeg: 0,
      rawPanels: [
        {
          id: "b_0",
          panId: "pan-a",
          rotationDeg: 0,
          center: { x: 10, y: 10 },
          polygonPx: [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 0, y: 20 },
          ],
          enabled: true,
        },
      ],
      placementEngine: { getBlockById: () => ({ orientation: "PORTRAIT" }) },
      heightResolverContext: ctx,
    });

    const pi = res.placementInputs[0];
    expect(pi.center.mode).toBe("world");
    if (pi.center.mode === "world") {
      expect(pi.center.position.z).toBeCloseTo(10 + 0.02 * 10);
    }
  });
});
