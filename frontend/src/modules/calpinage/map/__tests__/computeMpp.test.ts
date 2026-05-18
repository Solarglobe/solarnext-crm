import { describe, it, expect } from "vitest";
import { computeMpp, MERCATOR_INITIAL_RES } from "../computeMpp";

describe("computeMpp — Web Mercator (aligné metersPerPixelDP4 legacy)", () => {
  // Valeur de référence : zoom 20, lat 0 → INITIAL_RES / 2^20
  const REF_ZOOM_20_LAT0 = MERCATOR_INITIAL_RES / Math.pow(2, 20); // ≈ 0.14929

  it("zoom 20, lat 0° → ≈ 0.1493 m/px", () => {
    const mpp = computeMpp(20, 0);
    expect(mpp).not.toBeNull();
    expect(mpp!).toBeCloseTo(REF_ZOOM_20_LAT0, 6);
  });

  it("zoom 20, lat 45° → réduit par cos(45°) ≈ 0.7071", () => {
    const mpp = computeMpp(20, 45);
    expect(mpp).not.toBeNull();
    expect(mpp!).toBeCloseTo(REF_ZOOM_20_LAT0 * Math.cos((45 * Math.PI) / 180), 6);
  });

  it("zoom 20, lat 48.86° (Paris) → valeur plausible [0.05, 0.20]", () => {
    const mpp = computeMpp(20, 48.86);
    expect(mpp).not.toBeNull();
    expect(mpp!).toBeGreaterThan(0.05);
    expect(mpp!).toBeLessThan(0.20);
  });

  it("zoom 19 → exactement 2× zoom 20 (à même latitude)", () => {
    const m20 = computeMpp(20, 48);
    const m19 = computeMpp(19, 48);
    expect(m20).not.toBeNull();
    expect(m19).not.toBeNull();
    expect(m19!).toBeCloseTo(m20! * 2, 10);
  });

  // ─── Parité avec la formule legacy JavaScript ───────────────────────────────
  // metersPerPixelDP4(lat, zoom) = INITIAL_RES * cos(lat * π / 180) / 2^zoom
  it("parité exacte avec metersPerPixelDP4 legacy (zoom 20, lat 43.7°)", () => {
    const lat = 43.7;
    const zoom = 20;
    const legacy = (MERCATOR_INITIAL_RES * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
    expect(computeMpp(zoom, lat)).toBeCloseTo(legacy, 12);
  });

  // ─── Cas invalides ──────────────────────────────────────────────────────────

  it("zoom NaN → null", () => {
    expect(computeMpp(NaN, 48)).toBeNull();
  });

  it("lat NaN → null", () => {
    expect(computeMpp(20, NaN)).toBeNull();
  });

  it("zoom Infinity → null", () => {
    expect(computeMpp(Infinity, 48)).toBeNull();
  });
});
