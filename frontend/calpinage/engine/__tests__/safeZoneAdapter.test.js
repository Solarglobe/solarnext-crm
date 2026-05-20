import { describe, expect, it } from "vitest";
import { computeSafeZonesFromCalpinageState, isPanelInsideSafeZone } from "../safeZoneAdapter.js";

function panelAt(cx, cy, half = 2) {
  return [
    { x: cx - half, y: cy - half },
    { x: cx + half, y: cy - half },
    { x: cx + half, y: cy + half },
    { x: cx - half, y: cy + half },
  ];
}

describe("safeZoneAdapter roof extensions", () => {
  it("utilise canonicalV1.footprintPx avant le contour legacy pour le keepout PV", () => {
    const result = computeSafeZonesFromCalpinageState({
      pans: [{
        id: "pan-a",
        polygonPx: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
      }],
      roofExtensions: [{
        id: "rx-a",
        contour: {
          points: [
            { x: 200, y: 200 },
            { x: 220, y: 200 },
            { x: 220, y: 220 },
            { x: 200, y: 220 },
          ],
        },
        canonicalV1: {
          version: "roof_extension_v1",
          supportPanId: "pan-a",
          footprintPx: [
            { x: 40, y: 40 },
            { x: 60, y: 40 },
            { x: 60, y: 60 },
            { x: 40, y: 60 },
          ],
        },
      }],
      metersPerPixel: 0.1,
    });

    const safeZones = result.byPanId["pan-a"]?.safeZonePolygonsPx ?? [];
    expect(isPanelInsideSafeZone(panelAt(20, 20), safeZones)).toBe(true);
    expect(isPanelInsideSafeZone(panelAt(50, 50), safeZones)).toBe(false);
  });
});
