/**
 * Tests unitaires inverterSizing.
 * P4-INVERTER-SIZING-LOCKED
 */

import { describe, it, expect } from "vitest";
import { computeInverterSizing } from "../inverterSizing";

describe("computeInverterSizing", () => {
  it("CENTRAL: panel=10, dc=4.5, ac=4 → ratio = 4.5/4", () => {
    const result = computeInverterSizing({
      panelCount: 10,
      totalDcKw: 4.5,
      inverterFamily: "CENTRAL",
      inverterAcKw: 4,
    });
    expect(result.acTotalKw).toBe(4);
    expect(result.ratio).toBe(4.5 / 4);
  });

  it("MICRO: panel=10, dc=4.5, ac=0.4 → acTotal=4, ratio=4.5/4", () => {
    const result = computeInverterSizing({
      panelCount: 10,
      totalDcKw: 4.5,
      inverterFamily: "MICRO",
      inverterAcKw: 0.4,
    });
    expect(result.acTotalKw).toBe(4);
    expect(result.ratio).toBe(4.5 / 4);
  });

  it("panelCount=0 → ratio null", () => {
    const result = computeInverterSizing({
      panelCount: 0,
      totalDcKw: 4.5,
      inverterFamily: "CENTRAL",
      inverterAcKw: 4,
    });
    expect(result.acTotalKw).toBe(0);
    expect(result.ratio).toBeNull();
  });

  it("ac=0 → ratio null", () => {
    const result = computeInverterSizing({
      panelCount: 10,
      totalDcKw: 4.5,
      inverterFamily: "CENTRAL",
      inverterAcKw: 0,
    });
    expect(result.acTotalKw).toBe(0);
    expect(result.ratio).toBeNull();
  });

  it("inverterFamily inconnu → ne plante pas", () => {
    const result = computeInverterSizing({
      panelCount: 10,
      totalDcKw: 4.5,
      inverterFamily: "UNKNOWN" as "CENTRAL",
      inverterAcKw: 4,
    });
    expect(result.acTotalKw).toBe(0);
    expect(result.ratio).toBeNull();
  });
});
