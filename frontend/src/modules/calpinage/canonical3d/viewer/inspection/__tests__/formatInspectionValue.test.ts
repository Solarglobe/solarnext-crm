import { describe, it, expect } from "vitest";
import {
  formatAngleDeg,
  formatAreaM2,
  formatConfidenceFr,
  formatDimsM,
  formatLengthM,
  formatPercentFr,
} from "../formatInspectionValue";

describe("formatInspectionValue", () => {
  it("formatAngleDeg", () => {
    expect(formatAngleDeg(35)).toMatch(/35/);
    expect(formatAngleDeg(null)).toBe("—");
  });

  it("formatPercentFr", () => {
    expect(formatPercentFr(6.2)).toMatch(/6/);
    expect(formatPercentFr(undefined)).toBe("—");
  });

  it("formatLengthM", () => {
    expect(formatLengthM(0.85)).toMatch(/0,85/);
  });

  it("formatAreaM2", () => {
    expect(formatAreaM2(21.4)).toMatch(/21/);
  });

  it("formatDimsM", () => {
    const s = formatDimsM(1.8, 1.13);
    expect(s).toContain("×");
  });

  it("formatConfidenceFr", () => {
    expect(formatConfidenceFr("high")).toBe("Élevée");
    expect(formatConfidenceFr("unknown")).toBe("Inconnue");
  });
});
