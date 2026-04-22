/**
 * PROMPT 8 — batterie de validation produit (audit 2D ↔ 3D).
 * Lisibilité : chaque cas est nommé comme le livrable audit ; assertions sur le pipeline réel
 * `buildSolarScene3DFromCalpinageRuntime` (+ passerelle dans les tests gateway dédiés).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSolarScene3DFromCalpinageRuntime } from "../buildSolarScene3DFromCalpinageRuntime";
import { minimalCalpinageRuntimeFixture } from "../dev/minimalCalpinageRuntimeFixture";
import {
  clearOfficialSolarScene3DCache,
  getOrBuildOfficialSolarScene3DFromCalpinageRuntime,
} from "../scene/officialSolarScene3DGateway";

const mondeValide = {
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

describe("PROMPT 8 — vérités produit (pipeline runtime → SolarScene3D)", () => {
  afterEach(() => {
    clearOfficialSolarScene3DCache();
    delete (window as unknown as { getHeightAtXY?: unknown }).getHeightAtXY;
    vi.restoreAllMocks();
  });

  it("CAS A — contour seul + monde valide → scène non vide, fallback contour honnête", () => {
    const res = buildSolarScene3DFromCalpinageRuntime(
      {
        roof: { ...mondeValide },
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
    expect(res.geometryProvenance.geometryTruthSource).toBe("STATE_CONTOURS_FALLBACK");
    expect(res.minimalHouse3DDiagnostics.roofGeometrySource).toBe("FALLBACK_BUILDING_CONTOUR");
    expect(res.scene!.roofModel.roofPlanePatches.length).toBeGreaterThan(0);
  });

  it("CAS B — vrais pans valides → REAL_ROOF_PANS, pas de fallback contour", () => {
    const res = buildSolarScene3DFromCalpinageRuntime({
      pans: [
        {
          id: "pan-a",
          polygonPx: [
            { x: 100, y: 100, h: 8 },
            { x: 200, y: 100, h: 8 },
            { x: 200, y: 200, h: 8 },
            { x: 100, y: 200, h: 8 },
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
      contours: [],
    });
    expect(res.ok).toBe(true);
    expect(res.minimalHouse3DDiagnostics.roofGeometrySource).toBe("REAL_ROOF_PANS");
    expect(res.scene!.metadata.roofGeometrySource).not.toBe("FALLBACK_BUILDING_CONTOUR");
    expect(res.geometryProvenance.geometryTruthSource).toBe("STATE_PANS");
  });

  it("CAS C — pans partiels (miroir divergent ignoré) → toiture issue de state.pans", () => {
    const res = buildSolarScene3DFromCalpinageRuntime({
      pans: [
        {
          id: "pan-official",
          polygonPx: [
            { x: 100, y: 100, h: 8 },
            { x: 200, y: 100, h: 8 },
            { x: 200, y: 200, h: 8 },
            { x: 100, y: 200, h: 8 },
          ],
        },
      ],
      roof: {
        ...mondeValide,
        roofPans: [{ id: "wrong", polygonPx: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }],
      },
      contours: [],
    });
    expect(res.ok).toBe(true);
    expect(res.geometryProvenance.usedRoofRoofPansMirror).toBe(false);
    expect(res.scene!.roofModel.roofPlanePatches.some((p) => String(p.id) === "pan-official")).toBe(true);
  });

  it("CAS D — panneaux valides moteur → binding officiel sur patches courants", () => {
    const panel = {
      id: "pv-1",
      panId: "pan-a",
      enabled: true,
      center: { x: 150, y: 150 },
      projection: {
        points: [
          { x: 140, y: 140 },
          { x: 160, y: 140 },
          { x: 160, y: 160 },
          { x: 140, y: 160 },
        ],
      },
    };
    const res = buildSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture, {
      getAllPanels: () => [panel],
    });
    expect(res.ok).toBe(true);
    expect(res.pvBindingDiagnostics.usedOfficialRoofModel).toBe(true);
    expect(res.scene!.pvPanels.length).toBeGreaterThan(0);
  });

  it("CAS E — panneau orphelin (panId inconnu) → diagnostic ORPHAN / pas de binding plein OK", () => {
    const panel = {
      id: "orphan-1",
      panId: "missing-pan-xx",
      enabled: true,
      center: { x: 150, y: 150 },
      projection: {
        points: [
          { x: 140, y: 140 },
          { x: 160, y: 140 },
          { x: 160, y: 160 },
          { x: 140, y: 160 },
        ],
      },
    };
    const res = buildSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture, {
      getAllPanels: () => [panel],
    });
    expect(res.ok).toBe(true);
    expect(res.pvBindingDiagnostics.orphanPanelCount).toBeGreaterThan(0);
    expect(["ORPHAN", "PARTIAL", "REJECTED"]).toContain(res.pvBindingDiagnostics.pvBindingQuality);
  });

  it("CAS F — mutation runtime → signature change → rebuild passerelle (pas seulement cache)", () => {
    const a = getOrBuildOfficialSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture);
    const sig0 = a.sceneStructuralSignatures.sceneRuntimeSignature;
    const mutated = structuredClone(minimalCalpinageRuntimeFixture) as typeof minimalCalpinageRuntimeFixture;
    mutated.pans[0]!.polygonPx![0]!.x += 1;
    const b = getOrBuildOfficialSolarScene3DFromCalpinageRuntime(mutated);
    expect(b.sceneStructuralSignatures.sceneRuntimeSignature).not.toBe(sig0);
    expect(b.sceneSyncDiagnostics.usedSceneCache).toBe(false);
  });

  it("CAS G — toggle / double appel même runtime → cache hit, même signature", () => {
    const a = getOrBuildOfficialSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture);
    const b = getOrBuildOfficialSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture, {
      previouslyDisplayedSceneRuntimeSignature: a.sceneStructuralSignatures.sceneRuntimeSignature,
    });
    expect(b.sceneStructuralSignatures.sceneRuntimeSignature).toBe(a.sceneStructuralSignatures.sceneRuntimeSignature);
    expect(b.sceneSyncDiagnostics.usedSceneCache).toBe(true);
  });

  it("CAS H — données pauvres (pas de contrat monde) → ok false, pas de scène, pas de throw", () => {
    const res = buildSolarScene3DFromCalpinageRuntime({
      roof: {
        scale: { metersPerPixel: 0.02 },
        roof: { north: { angleDeg: 0 } },
        roofPans: [],
      },
    });
    expect(res.ok).toBe(false);
    expect(res.scene).toBeNull();
    expect(res.is3DEligible).toBe(false);
  });
});
