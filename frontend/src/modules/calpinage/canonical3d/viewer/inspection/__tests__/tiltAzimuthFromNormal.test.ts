import { describe, it, expect } from "vitest";
import { azimuthDegFromOutwardNormalWorld, tiltDegFromOutwardNormalWorld } from "../tiltAzimuthFromNormal";

describe("tiltAzimuthFromNormal", () => {
  it("toit horizontal : pente ~0°", () => {
    const t = tiltDegFromOutwardNormalWorld({ x: 0, y: 0, z: 1 });
    expect(t).not.toBeNull();
    expect(t!).toBeLessThan(1);
  });

  it("normale avec composante horizontale : azimut défini", () => {
    const a = azimuthDegFromOutwardNormalWorld({ x: 1, y: 0, z: 1 });
    expect(a).not.toBeNull();
    expect(a!).toBeGreaterThanOrEqual(0);
    expect(a!).toBeLessThanOrEqual(360);
  });
});
