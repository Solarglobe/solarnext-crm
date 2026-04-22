/**
 * Parité legacy GeoEntity + houseModelV2 vs chaîne canonical — cas structuraux et dégradés.
 */

import { describe, it, expect } from "vitest";
import {
  compareLegacyAndCanonical3D,
  prepareCalpinageStateForLegacyParityProbe,
} from "../compareLegacyAndCanonical3D";
import { buildSolarScene3DFromCalpinageRuntime } from "../../buildSolarScene3DFromCalpinageRuntime";
import { RUNTIME_3D_FIXTURE_BATTERY } from "../runtime3DFixtureBattery";
import { minimalCalpinageRuntimeFixture } from "../minimalCalpinageRuntimeFixture";

describe("prepareCalpinageStateForLegacyParityProbe", () => {
  it("promeut roof.roofPans vers pans quand pans absent", () => {
    const runtime = {
      roof: {
        roofPans: [{ id: "p1", polygonPx: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }] }],
      },
    };
    const { state, roofPansPromotedToPans } = prepareCalpinageStateForLegacyParityProbe(runtime);
    expect(roofPansPromotedToPans).toBe(true);
    expect(Array.isArray(state.pans) && state.pans!.length).toBe(1);
  });

  it("ne remplace pas des pans déjà présents", () => {
    const runtime = {
      pans: [{ id: "top", polygonPx: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }],
      roof: {
        roofPans: [{ id: "roof", polygonPx: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 2 }] }],
      },
    };
    const { state, roofPansPromotedToPans } = prepareCalpinageStateForLegacyParityProbe(runtime);
    expect(roofPansPromotedToPans).toBe(false);
    expect((state.pans as unknown[])[0]).toMatchObject({ id: "top" });
  });
});

describe("compareLegacyAndCanonical3D — scénarios ciblés", () => {
  it("dossier sans contrat persisté : matérialisation scale/nord au build, canonical OK (batterie CAS 4)", () => {
    const b = RUNTIME_3D_FIXTURE_BATTERY["partial-missing-world-contract"]!;
    const r = compareLegacyAndCanonical3D({
      sceneId: b.id,
      runtime: b.runtime,
      getAllPanels: () => b.panels,
    });
    expect(r.meta.canonicalBuildOk).toBe(true);
    expect(r.meta.canonical3DEligible).toBe(true);
    expect(r.sceneGlobal.canonicalScenePresent).toBe(true);
  });

  it("simple_gable_clean : build OK, pans/panels/obstacles alignés (ids stricts)", () => {
    const b = RUNTIME_3D_FIXTURE_BATTERY.simple_gable_clean!;
    const r = compareLegacyAndCanonical3D({
      sceneId: b.id,
      runtime: b.runtime,
      getAllPanels: () => b.panels,
    });
    expect(r.meta.canonicalBuildOk).toBe(true);
    expect(r.pans.missingInCanonical.length).toBe(0);
    expect(r.pans.extraInCanonical.length).toBe(0);
    expect(r.panels.missingInCanonical.length).toBe(0);
    expect(r.panels.extraInCanonical.length).toBe(0);
    expect(r.obstacles.legacyObstacleCount).toBe(0);
    expect(r.obstacles.canonicalObstacleVolumeCount).toBe(0);
    expect(["EQUIVALENT", "BETTER", "PARTIAL"]).toContain(r.overall.status);
  });

  it("mono-pan + obstacle : obstacle id runtime présent des deux côtés, hauteurs comparables", () => {
    const b = RUNTIME_3D_FIXTURE_BATTERY["mono-pan-nominal"]!;
    const r = compareLegacyAndCanonical3D({
      sceneId: b.id,
      runtime: b.runtime,
      getAllPanels: () => b.panels,
    });
    expect(r.meta.canonicalBuildOk).toBe(true);
    expect(r.obstacles.matched).toBeGreaterThanOrEqual(1);
    expect(r.heights.comparable).toBe(true);
    expect(r.heights.status).toBe("COMPARABLE");
  });

  it("runtime minimal valide : rapport construit sans throw", () => {
    const res = buildSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture);
    expect(res.ok).toBe(true);
    const r = compareLegacyAndCanonical3D({
      sceneId: "minimal",
      runtime: minimalCalpinageRuntimeFixture,
    });
    expect(r.sceneId).toBe("minimal");
    expect(r.meta.legacyEntityCount).toBeGreaterThan(0);
  });
});
