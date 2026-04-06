/**
 * Reload integrity — JSON final calpinage V1
 * 1) Générer / simuler JSON final
 * 2) Sauvegarder (stringify)
 * 3) Recharger (parse)
 * 4) Vérifier : pas de dérive, pans.length stable, panelCount stable, pas de NaN
 * Tolérance : 0.1%
 */

import { describe, it, expect } from "vitest";

function buildFixtureFinalJSON() {
  return {
    meta: {
      version: "calpinage_v1_final",
      generatedAt: new Date().toISOString(),
      engine: { shading: "near+far+HD", production: "multi-pan" },
    },
    roof: {
      scale: { metersPerPixel: 0.05 },
      north: null,
      pans: [
        {
          id: "pan-1",
          azimuth: 180,
          tilt: 30,
          panelCount: 10,
          surface: 25.5,
          geometryRef: "pan-1",
          shadingNearPct: 3,
          shadingFarPct: 8,
          shadingCombinedPct: 5.2,
        },
        {
          id: "pan-2",
          azimuth: 90,
          tilt: 25,
          panelCount: 6,
          surface: 14,
          geometryRef: "pan-2",
          shadingNearPct: 2,
          shadingFarPct: 6,
          shadingCombinedPct: 4.1,
        },
      ],
    },
    pans: [
      {
        id: "pan-1",
        azimuth: 180,
        tilt: 30,
        panelCount: 10,
        surface: 25.5,
        geometryRef: "pan-1",
        shadingNearPct: 3,
        shadingFarPct: 8,
        shadingCombinedPct: 5.2,
      },
      {
        id: "pan-2",
        azimuth: 90,
        tilt: 25,
        panelCount: 6,
        surface: 14,
        geometryRef: "pan-2",
        shadingNearPct: 2,
        shadingFarPct: 6,
        shadingCombinedPct: 4.1,
      },
    ],
    panels: [
      { id: "b1_0", panId: "pan-1", position: { x: 100, y: 200 }, orientation: "PORTRAIT", state: null },
    ],
    shading: {
      near: { totalLossPct: 2.5 },
      far: { totalLossPct: 6 },
      combined: { totalLossPct: 5 },
      totalLossPct: 5,
      computedAt: new Date().toISOString(),
    },
    production: null,
  };
}

const TOLERANCE_PCT = 0.001;

describe("Calpinage JSON final V1 — reload integrity", () => {
  it("1) Round-trip: no drift on pans.length", () => {
    const json = buildFixtureFinalJSON();
    const str = JSON.stringify(json);
    const reloaded = JSON.parse(str);
    expect(reloaded.pans).toBeDefined();
    expect(Array.isArray(reloaded.pans)).toBe(true);
    expect(reloaded.pans.length).toBe(json.pans.length);
    expect(reloaded.roof.pans.length).toBe(json.roof.pans.length);
  });

  it("2) Round-trip: panelCount total stable", () => {
    const json = buildFixtureFinalJSON();
    const totalBefore = json.pans.reduce((s, p) => s + (p.panelCount || 0), 0);
    const str = JSON.stringify(json);
    const reloaded = JSON.parse(str);
    const totalAfter = reloaded.pans.reduce((s, p) => s + (p.panelCount || 0), 0);
    expect(totalAfter).toBe(totalBefore);
    expect(totalBefore).toBe(16);
  });

  it("3) Round-trip: shadingCombinedPct no drift (0.1%)", () => {
    const json = buildFixtureFinalJSON();
    const str = JSON.stringify(json);
    const reloaded = JSON.parse(str);
    for (let i = 0; i < json.pans.length; i++) {
      const before = json.pans[i].shadingCombinedPct;
      const after = reloaded.pans[i].shadingCombinedPct;
      const drift = Math.abs(after - before) / (before || 1);
      expect(drift).toBeLessThanOrEqual(TOLERANCE_PCT);
    }
    const combinedBefore = json.shading.combined?.totalLossPct ?? json.shading.totalLossPct;
    const combinedAfter = reloaded.shading.combined?.totalLossPct ?? reloaded.shading.totalLossPct;
    expect(Math.abs(combinedAfter - combinedBefore) / (combinedBefore || 1)).toBeLessThanOrEqual(TOLERANCE_PCT);
  });

  it("4) No NaN in pans", () => {
    const json = buildFixtureFinalJSON();
    const str = JSON.stringify(json);
    const reloaded = JSON.parse(str);
    reloaded.pans.forEach((p) => {
      expect(Number.isNaN(p.azimuth)).toBe(false);
      expect(Number.isNaN(p.tilt)).toBe(false);
      expect(Number.isNaN(p.panelCount)).toBe(false);
      expect(Number.isNaN(p.surface)).toBe(false);
      expect(Number.isNaN(p.shadingCombinedPct)).toBe(false);
    });
  });

  it("5) meta.version present and v1_final", () => {
    const json = buildFixtureFinalJSON();
    const str = JSON.stringify(json);
    const reloaded = JSON.parse(str);
    expect(reloaded.meta).toBeDefined();
    expect(reloaded.meta.version).toBe("calpinage_v1_final");
    expect(reloaded.meta.engine).toEqual({ shading: "near+far+HD", production: "multi-pan" });
  });

  it("6) No undefined keys in official shape", () => {
    const json = buildFixtureFinalJSON();
    const str = JSON.stringify(json);
    const reloaded = JSON.parse(str);
    expect(reloaded.meta).toBeDefined();
    expect(reloaded.roof).toBeDefined();
    expect(reloaded.pans).toBeDefined();
    expect(reloaded.panels).toBeDefined();
    expect(reloaded.shading).toBeDefined();
    expect(reloaded.production === null || typeof reloaded.production === "object").toBe(true);
    reloaded.pans.forEach((p) => {
      expect(p.id).toBeDefined();
      expect(typeof p.azimuth === "number").toBe(true);
      expect(typeof p.tilt === "number").toBe(true);
      expect(typeof p.panelCount === "number").toBe(true);
      expect(typeof p.surface === "number").toBe(true);
      expect(p.geometryRef).toBeDefined();
      expect(typeof p.shadingCombinedPct === "number").toBe(true);
    });
  });
});
