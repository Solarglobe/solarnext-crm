/**
 * Preuve : pour lat/lon valides, le soleil DSM overlay = shared/shading/solarPosition.cjs.
 * Preuve : hors plage, séparation assumée (DSM clamp vs officiel null).
 */

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeSunPosition as computeDsm } from "../solarPosition.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const sharedPath = path.join(__dirname, "../../../../../../shared/shading/solarPosition.cjs");
const { computeSunPosition: computeShared } = require(sharedPath);

function expectClose(a, b, eps) {
  expect(Math.abs(a - b)).toBeLessThan(eps);
}

describe("dsmSolarParityWithSharedTruth — entrées valides = même NOAA que shared", () => {
  const cases = [
    {
      name: "Paris UTC mi-juin",
      date: new Date(Date.UTC(2026, 5, 21, 10, 0, 0)),
      lat: 48.8566,
      lon: 2.3522,
    },
    {
      name: "timestamp numérique",
      date: Date.UTC(2026, 0, 15, 12, 30, 0),
      lat: 45.0,
      lon: 5.0,
    },
    {
      name: "équateur",
      date: new Date(Date.UTC(2026, 2, 20, 6, 0, 0)),
      lat: 0,
      lon: 20,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const a = computeDsm(c.date, c.lat, c.lon);
      const b = computeShared(c.date, c.lat, c.lon);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expectClose(a.azimuthDeg, b.azimuthDeg, 1e-4);
      expectClose(a.elevationDeg, b.elevationDeg, 1e-4);
    });
  }
});

describe("dsmSolarParityWithSharedTruth — séparation hors plage (documentée)", () => {
  it("lat hors plage : shared null, DSM renvoie encore une position (clamp overlay)", () => {
    const ms = Date.UTC(2026, 6, 1, 12, 0, 0);
    const dsm = computeDsm(ms, 200, 2);
    const shared = computeShared(ms, 200, 2);
    expect(shared).toBeNull();
    expect(dsm).not.toBeNull();
    expect(typeof dsm.azimuthDeg).toBe("number");
    expect(typeof dsm.elevationDeg).toBe("number");
  });
});
