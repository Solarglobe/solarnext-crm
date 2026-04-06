/**
 * Validations structure officielle pans[] — modèle multi-pente.
 * 1) 1 seul pan → pans.length === 1
 * 2) panelCount total = somme(pans.panelCount)
 * 3) shadingCombined global ≈ moyenne pondérée pans
 * 4) Aucun NaN
 * 5) Reload JSON → structure intacte
 */

import { describe, it, expect } from "vitest";
import { buildOfficialPans, enrichPansWithOfficialFields } from "../buildOfficialPans.js";

describe("buildOfficialPans / pans[] official structure", () => {
  it("1) 1 seul pan → pans.length === 1", () => {
    const pans = [{ id: "pan-1", orientationDeg: 180, tiltDeg: 30, surfaceM2: 25 }];
    const result = buildOfficialPans(pans, () => [], null);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("pan-1");
    expect(result[0].panelCount).toBe(0);
  });

  it("2) panelCount total = somme(pans.panelCount)", () => {
    const pans = [
      { id: "p1", orientationDeg: 180, tiltDeg: 25, surfaceM2: 20 },
      { id: "p2", orientationDeg: 90, tiltDeg: 15, surfaceM2: 10 },
    ];
    const panels = [
      { id: "panel-1", panId: "p1" },
      { id: "panel-2", panId: "p1" },
      { id: "panel-3", panId: "p2" },
    ];
    const result = buildOfficialPans(pans, () => panels, null);
    const sumPanelCount = result.reduce((s, p) => s + p.panelCount, 0);
    expect(result.length).toBe(2);
    expect(result[0].panelCount).toBe(2);
    expect(result[1].panelCount).toBe(1);
    expect(sumPanelCount).toBe(panels.length);
  });

  it("3) shadingCombined global ≈ moyenne pondérée pans", () => {
    const pans = [
      { id: "p1", orientationDeg: 180, tiltDeg: 25, surfaceM2: 20 },
      { id: "p2", orientationDeg: 90, tiltDeg: 15, surfaceM2: 10 },
    ];
    const panels = [
      { id: "panel-1", panId: "p1" },
      { id: "panel-2", panId: "p1" },
      { id: "panel-3", panId: "p2" },
    ];
    const shading = {
      near: { totalLossPct: 2 },
      far: { totalLossPct: 5 },
      combined: { totalLossPct: 7 },
      perPanel: [
        { panelId: "panel-1", lossPct: 4 },
        { panelId: "panel-2", lossPct: 8 },
        { panelId: "panel-3", lossPct: 6 },
      ],
    };
    const result = buildOfficialPans(pans, () => panels, shading);
    expect(result.length).toBe(2);
    expect(result[0].shadingCombinedPct).toBe(6);
    expect(result[1].shadingCombinedPct).toBe(6);
    const totalPanels = result.reduce((s, p) => s + p.panelCount, 0);
    const weightedSum = result.reduce((s, p) => s + p.shadingCombinedPct * p.panelCount, 0);
    const weightedAvg = totalPanels > 0 ? weightedSum / totalPanels : 0;
    expect(Math.abs(weightedAvg - (4 + 8 + 6) / 3)).toBeLessThan(0.01);
  });

  it("4) Aucun NaN", () => {
    const pans = [
      { id: "p1" },
      { id: "p2", orientationDeg: null, tiltDeg: null, surfaceM2: undefined },
    ];
    const result = buildOfficialPans(pans, () => [], null);
    expect(result.length).toBe(2);
    result.forEach((p) => {
      expect(Number.isNaN(p.azimuth)).toBe(false);
      expect(Number.isNaN(p.tilt)).toBe(false);
      expect(Number.isNaN(p.panelCount)).toBe(false);
      expect(Number.isNaN(p.surface)).toBe(false);
      expect(Number.isNaN(p.shadingNearPct)).toBe(false);
      expect(Number.isNaN(p.shadingFarPct)).toBe(false);
      expect(Number.isNaN(p.shadingCombinedPct)).toBe(false);
    });
  });

  it("5) Reload JSON → structure intacte (enrich preserves then round-trip)", () => {
    const pansFromJson = [
      { id: "pan-1", orientationDeg: 180, tiltDeg: 30, surfaceM2: 25, polygon: [] },
    ];
    const enriched = enrichPansWithOfficialFields(pansFromJson, () => [], null);
    expect(enriched.length).toBe(1);
    const p = enriched[0];
    expect(p.id).toBe("pan-1");
    expect(p.orientationDeg).toBe(180);
    expect(p.tiltDeg).toBe(30);
    expect(p.surfaceM2).toBe(25);
    expect(typeof p.azimuth).toBe("number");
    expect(typeof p.tilt).toBe("number");
    expect(typeof p.panelCount).toBe("number");
    expect(typeof p.surface).toBe("number");
    expect(typeof p.geometryRef).toBe("string");
    expect(typeof p.shadingNearPct).toBe("number");
    expect(typeof p.shadingFarPct).toBe("number");
    expect(typeof p.shadingCombinedPct).toBe("number");
    const roundTrip = JSON.parse(JSON.stringify(enriched));
    expect(roundTrip.length).toBe(1);
    expect(roundTrip[0].id).toBe("pan-1");
    expect(roundTrip[0].azimuth).toBe(180);
    expect(roundTrip[0].panelCount).toBe(0);
    expect(roundTrip[0].geometryRef).toBe("pan-1");
  });

  it("empty pans returns empty array", () => {
    expect(buildOfficialPans([], () => [], null)).toEqual([]);
  });

  it("6) missing_gps → shadingNear/Far/Combined null (pas 0)", () => {
    const shading = {
      far: { source: "UNAVAILABLE_NO_GPS", totalLossPct: null },
      shadingQuality: { blockingReason: "missing_gps" },
      combined: { totalLossPct: null },
    };
    const pans = [{ id: "p1", orientationDeg: 180, tiltDeg: 30, surfaceM2: 20 }];
    const r = buildOfficialPans(pans, () => [], shading);
    expect(r[0].shadingFarPct).toBeNull();
    expect(r[0].shadingNearPct).toBeNull();
    expect(r[0].shadingCombinedPct).toBeNull();
  });
});
