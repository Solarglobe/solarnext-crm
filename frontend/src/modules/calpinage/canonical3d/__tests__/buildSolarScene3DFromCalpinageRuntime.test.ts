/**
 * Hook runtime → SolarScene3D (assemblage + validation).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import * as roofModelBuilder from "../builder/buildRoofModel3DFromLegacyGeometry";
import { polygonHorizontalAreaM2FromImagePx } from "../builder/worldMapping";
import { buildSolarScene3DFromCalpinageRuntime } from "../buildSolarScene3DFromCalpinageRuntime";
import { minimalCalpinageRuntimeFixture } from "../dev/minimalCalpinageRuntimeFixture";

describe("buildSolarScene3DFromCalpinageRuntime", () => {
  afterEach(() => {
    delete (window as unknown as { getHeightAtXY?: unknown }).getHeightAtXY;
    vi.restoreAllMocks();
  });

  it("CAS 1 — runtime minimal valide (state.pans) → ok, provenance STATE_PANS sans miroir", () => {
    const res = buildSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture);

    expect(res.ok).toBe(true);
    expect(res.is3DEligible).toBe(true);
    expect(res.scene).not.toBeNull();
    expect(res.minimalHouse3DDiagnostics.roofGeometrySource).toBe("REAL_ROOF_PANS");
    expect(res.minimalHouse3DDiagnostics.fallbackReason).toBeNull();
    expect(res.minimalHouse3DDiagnostics.hasRealRoofPans).toBe(true);
    expect(res.geometryProvenance.geometryTruthSource).toBe("STATE_PANS");
    expect(res.geometryProvenance.roofModelBuildCount).toBe(1);
    expect(res.geometryProvenance.usedRoofRoofPansMirror).toBe(false);
    expect(res.scene!.roofModel.roofPlanePatches.length).toBeGreaterThan(0);
    expect(res.scene!.metadata.integrationNotes).toContain("calpinage-runtime");
    expect(res.scene!.worldConfig).toEqual({
      metersPerPixel: 0.02,
      northAngleDeg: 0,
      referenceFrame: "LOCAL_IMAGE_ENU",
    });
    expect(res.diagnostics.errors.length).toBe(0);
    expect(res.coherence).not.toBeNull();
    expect(res.coherence?.isCoherent).toBe(true);
    expect(res.scene?.coherence).toEqual(res.coherence);
    expect(res.scene?.sourceTrace?.sourcePanIds.length).toBeGreaterThan(0);
    expect(res.scene?.sourceTrace?.expectedRoofPlanePatchIds?.length).toBeGreaterThan(0);
    expect(
      res.scene!.metadata.buildGuards?.some((g) => g.code === "LEVEL2_ROOF_GEOMETRY_HYBRID_MODE"),
    ).toBe(true);
    const contourPts = minimalCalpinageRuntimeFixture.contours[0]!.points;
    const expFootprintM2 = polygonHorizontalAreaM2FromImagePx(contourPts, 0.02, 0);
    expect(res.scene?.sourceTrace?.metrics?.roofOutlineHorizontalAreaM2).toBeCloseTo(expFootprintM2, 6);
    expect(
      res.scene!.metadata.buildGuards?.some((g) => g.code === "LEVEL4_SOURCE_TRACE_ROOF_FOOTPRINT_M2"),
    ).toBe(true);
    expect(res.scene?.metadata.roofQualityPhaseA).toBeDefined();
    expect(res.scene!.metadata.roofQualityPhaseA!.quality).toBe(res.roofReconstructionQuality.roofReconstructionQuality);
    expect(Array.isArray(res.scene!.metadata.roofQualityPhaseA!.stepsFr)).toBe(true);
    expect(res.scene?.metadata.roofQualityPhaseB).toBeDefined();
    expect(res.scene!.metadata.roofQualityPhaseB!.panTechnical.length).toBeGreaterThanOrEqual(1);
    expect(res.scene!.metadata.roofQualityPhaseB!.supportLinesFr.length).toBeGreaterThan(0);
  });

  it("avec getHeightAtXY mocké — scène se construit, patches cohérents, Z sommets suit le mock (chemin riche)", () => {
    (window as unknown as { getHeightAtXY: (pid: string, x: number, y: number) => number }).getHeightAtXY =
      vi.fn().mockReturnValue(6.25);

    const res = buildSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture);

    expect(res.ok).toBe(true);
    expect(res.scene).not.toBeNull();
    const patches = res.scene!.roofModel.roofPlanePatches;
    expect(patches.length).toBeGreaterThan(0);
    const zVals = patches[0]!.cornersWorld.map((c) => c.z);
    for (const z of zVals) {
      expect(z).toBeCloseTo(0, 5);
    }
  });

  it("runtime avec pans + échelle/nord mais sans canonical3DWorldContract persisté → ok (contrat matérialisé au build)", () => {
    const runtime = {
      pans: [
        {
          id: "pan-a",
          polygonPx: [
            { x: 100, y: 100 },
            { x: 200, y: 100 },
            { x: 200, y: 200 },
            { x: 100, y: 200 },
          ],
        },
      ],
      roof: {
        scale: { metersPerPixel: 0.02 },
        roof: { north: { angleDeg: 0 } },
        roofPans: [],
      },
      contours: [],
    };
    const res = buildSolarScene3DFromCalpinageRuntime(runtime);
    expect(res.ok).toBe(true);
    expect(res.is3DEligible).toBe(true);
    expect(res.scene).not.toBeNull();
    const roof = runtime.roof as Record<string, unknown>;
    expect(roof.canonical3DWorldContract).toBeDefined();
    expect((roof.canonical3DWorldContract as { referenceFrame?: string }).referenceFrame).toBe("LOCAL_IMAGE_ENU");
  });

  const contourOnlyWorldContract = {
    scale: { metersPerPixel: 0.02 },
    roof: { north: { angleDeg: 15 } },
    canonical3DWorldContract: {
      schemaVersion: 1,
      metersPerPixel: 0.02,
      northAngleDeg: 15,
      referenceFrame: "LOCAL_IMAGE_ENU" as const,
    },
    roofPans: [] as const,
  };

  it("CAS 2 — contour bâti seul + monde valide → maison minimale fallback, scène non vide", () => {
    const res = buildSolarScene3DFromCalpinageRuntime(
      {
        roof: { ...contourOnlyWorldContract },
        contours: [
          {
            roofRole: "contour",
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 60 },
              { x: 0, y: 60 },
            ],
          },
        ],
      },
      { allowBuildingContourFallback: true },
    );
    expect(res.ok).toBe(true);
    expect(res.scene).not.toBeNull();
    expect(res.minimalHouse3DDiagnostics.roofGeometrySource).toBe("FALLBACK_BUILDING_CONTOUR");
    expect(res.minimalHouse3DDiagnostics.hasBuildingContour).toBe(true);
    expect(res.minimalHouse3DDiagnostics.hasRealRoofPans).toBe(false);
    expect(res.geometryProvenance.geometryTruthSource).toBe("STATE_CONTOURS_FALLBACK");
    expect(res.scene!.metadata.roofGeometrySource).toBe("FALLBACK_BUILDING_CONTOUR");
    expect(res.scene!.roofModel.roofPlanePatches.length).toBeGreaterThan(0);
    expect(res.scene!.buildingShell?.id).toBe("calpinage-building-shell");
  });

  it("CAS 3 — state.pans prioritaire : miroir roof.roofPans divergent ignoré pour la toiture", () => {
    const res = buildSolarScene3DFromCalpinageRuntime({
      pans: [
        {
          id: "pan-official",
          polygonPx: [
            { x: 100, y: 100 },
            { x: 200, y: 100 },
            { x: 200, y: 200 },
            { x: 100, y: 200 },
          ],
        },
      ],
      roof: {
        ...contourOnlyWorldContract,
        roofPans: [{ id: "wrong-mirror", polygonPx: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }],
      },
      contours: [],
    });
    expect(res.ok).toBe(true);
    expect(res.geometryProvenance.usedRoofRoofPansMirror).toBe(false);
    expect(res.scene!.roofModel.roofPlanePatches.some((p) => String(p.id) === "pan-official")).toBe(true);
    expect(res.productPipeline3DDiagnostics.panSource).toBe("STATE_PANS_STRICT");
    expect(res.productPipeline3DDiagnostics.legacyInputMode).toBe("LEGACY_RICH_INPUT_USED");
  });

  it("roofExtensions : la scene utilise le volume unifie issu du contour/ridge runtime", () => {
    const res = buildSolarScene3DFromCalpinageRuntime({
      pans: [
        {
          id: "pan-dormer",
          polygonPx: [
            { x: 100, y: 100, h: 8 },
            { x: 220, y: 100, h: 8 },
            { x: 220, y: 220, h: 8 },
            { x: 100, y: 220, h: 8 },
          ],
        },
      ],
      roofExtensions: [
        {
          id: "rx-scene",
          kind: "dormer",
          visualModel: "manual_outline_gable",
          supportPanId: "pan-dormer",
          contour: {
            closed: true,
            points: [
              { x: 120, y: 120, h: 0 },
              { x: 170, y: 120, h: 0 },
              { x: 185, y: 180, h: 0 },
              { x: 120, y: 190, h: 0 },
            ],
          },
          ridge: {
            a: { x: 145, y: 125, h: 1 },
            b: { x: 145, y: 180, h: 1 },
          },
          canonicalDormerGeometry: {
            vertices: [{ id: "legacy-bbox", x: 999, y: 999, h: 4 }],
            faces: [],
          },
        },
      ],
      roof: {
        scale: { metersPerPixel: 0.02 },
        roof: { north: { angleDeg: 0 } },
        canonical3DWorldContract: {
          schemaVersion: 1,
          metersPerPixel: 0.02,
          northAngleDeg: 0,
          referenceFrame: "LOCAL_IMAGE_ENU" as const,
        },
        roofPans: [],
      },
      contours: [
        {
          roofRole: "contour",
          points: [
            { x: 100, y: 100 },
            { x: 220, y: 100 },
            { x: 220, y: 220 },
            { x: 100, y: 220 },
          ],
        },
      ],
    });

    expect(res.ok).toBe(true);
    expect(res.scene).not.toBeNull();
    expect(res.scene!.extensionVolumes).toHaveLength(1);
    const ext = res.scene!.extensionVolumes[0]!;
    expect(ext.id).toBe("rx-scene");
    expect(ext.extrusion.mode).toBe("along_pan_normal");
    expect(ext.relatedPlanePatchIds).toEqual(["pan-dormer"]);
    expect(ext.topology?.version).toBe("roof_extension_topology_v2");
    expect(ext.topology?.source).toBe("roofExtensions.runtime.contour_ridge");
    expect(ext.topology?.heightReference).toBe("support_plane_normal");
    expect(ext.topology?.ignoredLegacyCanonicalDormerGeometry).toBe(true);
    expect(ext.topology?.sourceContourPx.map((p) => [p.x, p.y])).toEqual([
      [120, 120],
      [170, 120],
      [185, 180],
      [120, 190],
    ]);
  });

  it("CAS 4 — un seul appel buildRoofModel3DFromLegacyGeometry pour la scène complète", () => {
    const spy = vi.spyOn(roofModelBuilder, "buildRoofModel3DFromLegacyGeometry");
    const res = buildSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture);
    expect(res.ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.geometryProvenance.roofModelBuildCount).toBe(1);
    expect(res.pvBindingDiagnostics.usedOfficialRoofModel).toBe(true);
    spy.mockRestore();
  });

  it("Prompt 4 CAS 4 — toiture réelle exploitable : pas de fallback contour, reconstruction non masquée", () => {
    const res = buildSolarScene3DFromCalpinageRuntime({
      pans: [
        {
          id: "pa",
          polygonPx: [
            { x: 100, y: 100, h: 8 },
            { x: 200, y: 100, h: 8 },
            { x: 200, y: 200, h: 8 },
            { x: 100, y: 200, h: 8 },
          ],
        },
        {
          id: "pb",
          polygonPx: [
            { x: 200, y: 100, h: 8 },
            { x: 300, y: 100, h: 8 },
            { x: 300, y: 200, h: 8 },
            { x: 200, y: 200, h: 8 },
          ],
        },
      ],
      roof: {
        scale: { metersPerPixel: 0.02 },
        roof: { north: { angleDeg: 0 } },
        canonical3DWorldContract: {
          schemaVersion: 1,
          metersPerPixel: 0.02,
          northAngleDeg: 0,
          referenceFrame: "LOCAL_IMAGE_ENU" as const,
        },
        roofPans: [],
      },
      contours: [
        {
          roofRole: "contour",
          points: [
            { x: 100, y: 100 },
            { x: 300, y: 100 },
            { x: 300, y: 200 },
            { x: 100, y: 200 },
          ],
        },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.minimalHouse3DDiagnostics.roofGeometrySource).toBe("REAL_ROOF_PANS");
    expect(res.scene!.metadata.roofGeometrySource).not.toBe("FALLBACK_BUILDING_CONTOUR");
    expect(res.roofReconstructionQuality.roofReconstructionQuality).toBe("TRUTHFUL");
    expect(res.roofReconstructionQuality.sharedEdgeConflictCount).toBe(0);
    expect(res.scene!.buildingShell?.id).toBe("calpinage-building-shell");
    expect(res.scene!.buildingShell?.contourSource).toBe("CALPINAGE_STATE.contours");
    expect(
      res.scene!.metadata.buildGuards?.some((g) => g.code === "LEVEL1_SHELL_REQUIRES_BUILDING_CONTOUR"),
    ).toBe(false);
    expect(
      res.productPipeline3DDiagnostics!.messages.some((m) =>
        m.includes("LEVEL1_SHELL_REQUIRES_BUILDING_CONTOUR"),
      ),
    ).toBe(false);
  });

  it("Prompt 4 CAS 5 — runtime sous-contraint (pas de cotes sommets) : FALLBACK diagnostiqué", () => {
    const res = buildSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture);
    expect(res.ok).toBe(true);
    expect(res.roofReconstructionQuality.roofReconstructionQuality).toBe("FALLBACK");
    expect(res.roofHeightSignal.heightSignalStatus).toBe("MISSING");
  });

  it("pans invalides sur state.pans + contour → échec explicite sans repli silencieux", () => {
    const res = buildSolarScene3DFromCalpinageRuntime({
      pans: [{ id: "bad-pan", polygonPx: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
      roof: {
        ...contourOnlyWorldContract,
        roofPans: [],
      },
      contours: [
        {
          roofRole: "contour",
          points: [
            { x: 10, y: 10 },
            { x: 90, y: 10 },
            { x: 90, y: 70 },
            { x: 10, y: 70 },
          ],
        },
      ],
    });
    expect(res.ok).toBe(false);
    expect(res.scene).toBeNull();
    expect(
      res.diagnostics.errors.some(
        (e) =>
          e.message.includes("PRODUCT_ROOF_PAN_INTENT_BUT_NO_VALID") ||
          (e.code === "SCENE_INCOHERENT" && e.message.includes("no pans")),
      ),
    ).toBe(true);
  });

  it("pans invalides + contour + allowBuildingContourFallback → repli explicite assumé", () => {
    const res = buildSolarScene3DFromCalpinageRuntime(
      {
        pans: [{ id: "bad-pan", polygonPx: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
        roof: {
          ...contourOnlyWorldContract,
          roofPans: [],
        },
        contours: [
          {
            roofRole: "contour",
            points: [
              { x: 10, y: 10 },
              { x: 90, y: 10 },
              { x: 90, y: 70 },
              { x: 10, y: 70 },
            ],
          },
        ],
      },
      { allowBuildingContourFallback: true },
    );
    expect(res.ok).toBe(true);
    expect(res.scene).not.toBeNull();
    expect(res.minimalHouse3DDiagnostics.roofGeometrySource).toBe("FALLBACK_BUILDING_CONTOUR");
    expect(res.minimalHouse3DDiagnostics.hasRealRoofPans).toBe(true);
    expect(res.minimalHouse3DDiagnostics.fallbackReason).toContain("no_valid_roof_pans");
    expect(res.productPipeline3DDiagnostics.buildingFallbackUsed).toBe(true);
  });
});
