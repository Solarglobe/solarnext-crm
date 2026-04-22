import { describe, expect, it } from "vitest";
import type { LegacyRoofGeometryInput } from "../legacyInput";
import type { HeightResolutionTrace } from "../heightConstraints";
import { computeRoofHeightSignalFromLegacyCornerTraces } from "../roofHeightSignalDiagnostics";

function legacyInput(defaultHeightM: number): LegacyRoofGeometryInput {
  return {
    metersPerPixel: 0.02,
    northAngleDeg: 0,
    defaultHeightM,
    pans: [
      {
        id: "p1",
        polygonPx: [
          { xPx: 0, yPx: 0 },
          { xPx: 10, yPx: 0 },
          { xPx: 5, yPx: 8 },
        ],
      },
    ],
  };
}

describe("roofHeightSignalDiagnostics (Prompt 3)", () => {
  it("tous les coins en default_global → MISSING", () => {
    const traces: HeightResolutionTrace[][] = [
      [
        { source: "default_global", tier: "low" },
        { source: "default_global", tier: "low" },
        { source: "default_global", tier: "low" },
      ],
    ];
    const d = computeRoofHeightSignalFromLegacyCornerTraces(legacyInput(5.5), traces);
    expect(d.heightSignalStatus).toBe("MISSING");
    expect(d.explicitVertexHeightCount).toBe(0);
    expect(d.fallbackVertexHeightCount).toBe(3);
    expect(d.usedSyntheticZeroHeight).toBe(false);
    expect(d.inclinedRoofGeometryTruthful).toBe(false);
  });

  it("tous les coins explicites polygone → SUFFICIENT", () => {
    const traces: HeightResolutionTrace[][] = [
      [
        { source: "explicit_polygon_vertex", tier: "high" },
        { source: "explicit_polygon_vertex", tier: "high" },
        { source: "explicit_polygon_vertex", tier: "high" },
      ],
    ];
    const d = computeRoofHeightSignalFromLegacyCornerTraces(legacyInput(5.5), traces);
    expect(d.heightSignalStatus).toBe("SUFFICIENT");
    expect(d.usedSyntheticZeroHeight).toBe(false);
    expect(d.inclinedRoofGeometryTruthful).toBe(true);
  });

  it("mélange explicite + défaut global → PARTIAL", () => {
    const traces: HeightResolutionTrace[][] = [
      [
        { source: "explicit_polygon_vertex", tier: "high" },
        { source: "explicit_polygon_vertex", tier: "high" },
        { source: "default_global", tier: "low" },
        { source: "default_global", tier: "low" },
      ],
    ];
    const d = computeRoofHeightSignalFromLegacyCornerTraces(legacyInput(5.5), traces);
    expect(d.heightSignalStatus).toBe("PARTIAL");
    expect(d.explicitVertexHeightCount).toBe(2);
    expect(d.fallbackVertexHeightCount).toBe(2);
    expect(d.inclinedRoofGeometryTruthful).toBe(false);
  });

  it("defaultHeightM=0 sur coins default_global → usedSyntheticZeroHeight", () => {
    const traces: HeightResolutionTrace[][] = [
      [{ source: "default_global", tier: "low" }],
    ];
    const d = computeRoofHeightSignalFromLegacyCornerTraces(legacyInput(0), traces);
    expect(d.usedSyntheticZeroHeight).toBe(true);
  });
});
