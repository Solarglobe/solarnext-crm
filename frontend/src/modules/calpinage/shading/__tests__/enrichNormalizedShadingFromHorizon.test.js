/**
 * Preuve : après horizon-mask, normalized.far / shadingQuality reflètent HTTP_GEOTIFF
 * et l’export premium n’affiche plus un faux RELIEF_ONLY par défaut.
 */

import { describe, it, expect } from "vitest";
import { enrichNormalizedShadingFromHorizon } from "../enrichNormalizedShadingFromHorizon.js";
import { buildPremiumShadingExport } from "../../export/buildShadingExport.js";

describe("enrichNormalizedShadingFromHorizon", () => {
  it("propage HTTP_GEOTIFF + REAL_TERRAIN pour export", () => {
    const horizonData = {
      mask: [{ az: 0, elev: 1 }],
      horizon: [{ azimuth: 0, elevation_deg: 1 }],
      meta: { source: "SURFACE_DSM", providerType: "HTTP_GEOTIFF", qualityScore: 0.9 },
      dataCoverage: { provider: "HTTP_GEOTIFF", gridResolutionMeters: 10, effectiveRadiusMeters: 500 },
    };
    const normalized = {
      computedAt: Date.now(),
      totalLossPct: 5,
      near: { totalLossPct: 2 },
      far: { totalLossPct: 3 },
      combined: { totalLossPct: 5 },
      perPanel: [],
    };
    enrichNormalizedShadingFromHorizon(horizonData, normalized);
    expect(normalized.far.source).toBe("HTTP_GEOTIFF");
    expect(normalized.far.farHorizonKind).toBe("REAL_TERRAIN");
    expect(normalized.far.dataCoverage?.provider).toBe("HTTP_GEOTIFF");
    expect(normalized.shadingQuality.provider).toBe("HTTP_GEOTIFF");
    expect(normalized.shadingQuality.modelType).toBe("DSM");

    const exp = buildPremiumShadingExport(normalized);
    expect(exp.farHorizonKind).toBe("REAL_TERRAIN");
    expect(exp.source).toBe("HTTP_GEOTIFF");
  });

  it("RELIEF_ONLY après fallback HTTP reste SYNTHETIC + horizonMeta", () => {
    const horizonData = {
      mask: [{ az: 0, elev: 0.5 }],
      horizon: [{ azimuth: 0, elevation_deg: 0.5 }],
      meta: {
        source: "RELIEF_ONLY",
        fallbackReason: "HTTP_GEOTIFF_FAILED",
        requestedSurfaceProvider: "HTTP_GEOTIFF",
        qualityScore: 0.3,
      },
      dataCoverage: { provider: "RELIEF_ONLY", notes: ["HTTP_GEOTIFF → RELIEF_ONLY"] },
    };
    const normalized = {
      computedAt: Date.now(),
      totalLossPct: 4,
      near: { totalLossPct: 1 },
      far: { totalLossPct: 3 },
      combined: { totalLossPct: 4 },
      perPanel: [],
    };
    enrichNormalizedShadingFromHorizon(horizonData, normalized);
    expect(normalized.far.source).toBe("RELIEF_ONLY");
    expect(normalized.far.farHorizonKind).toBe("SYNTHETIC");
    expect(normalized.far.horizonMeta?.fallbackReason).toBe("HTTP_GEOTIFF_FAILED");
    expect(normalized.far.horizonMeta?.requestedSurfaceProvider).toBe("HTTP_GEOTIFF");

    const exp = buildPremiumShadingExport(normalized);
    expect(exp.farHorizonKind).toBe("SYNTHETIC");
    expect(exp.shadingQuality?.note === "synthetic_relief" || exp.confidence === "LOW").toBe(true);
  });

  it("sans horizon utilisable, ne modifie pas normalized", () => {
    const n = { far: { totalLossPct: 1 }, combined: { totalLossPct: 1 } };
    enrichNormalizedShadingFromHorizon({}, n);
    expect(n.far.source).toBeUndefined();
  });
});
