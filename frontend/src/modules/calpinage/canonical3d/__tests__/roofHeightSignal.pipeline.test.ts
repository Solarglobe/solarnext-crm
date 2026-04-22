/**
 * Prompt 3 — validation pipeline : signal hauteur + absence de 0 silencieux résolveur.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRoofModel3DFromLegacyGeometry } from "../builder/buildRoofModel3DFromLegacyGeometry";
import type { LegacyRoofGeometryInput } from "../builder/legacyInput";
import { buildSolarScene3DFromCalpinageRuntime } from "../buildSolarScene3DFromCalpinageRuntime";
import { minimalCalpinageRuntimeFixture } from "../dev/minimalCalpinageRuntimeFixture";
import { resolveHeightAtXY } from "../../core/heightResolver";

describe("roofHeightSignal — pipeline 3D", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { getHeightAtXY?: unknown }).getHeightAtXY;
  });

  it("Cas 4 — runtime sans hauteurs sommet : signal non SUFFICIENT, pas de synthetic zero si default ≠ 0", () => {
    const res = buildSolarScene3DFromCalpinageRuntime(minimalCalpinageRuntimeFixture);
    expect(res.ok).toBe(true);
    expect(res.roofHeightSignal.heightSignalStatus).not.toBe("SUFFICIENT");
    expect(res.roofHeightSignal.usedSyntheticZeroHeight).toBe(false);
  });

  it("Cas 5 — legacy avec heightM explicites sur tous les sommets : SUFFICIENT + pas de synthetic zero", () => {
    const input: LegacyRoofGeometryInput = {
      metersPerPixel: 0.02,
      northAngleDeg: 0,
      defaultHeightM: 5.5,
      pans: [
        {
          id: "pan-a",
          polygonPx: [
            { xPx: 100, yPx: 100, heightM: 5 },
            { xPx: 200, yPx: 100, heightM: 5.2 },
            { xPx: 200, yPx: 200, heightM: 5.1 },
            { xPx: 100, yPx: 200, heightM: 5.05 },
          ],
        },
      ],
    };
    const { roofHeightSignal } = buildRoofModel3DFromLegacyGeometry(input);
    expect(roofHeightSignal.heightSignalStatus).toBe("SUFFICIENT");
    expect(roofHeightSignal.usedSyntheticZeroHeight).toBe(false);
    expect(roofHeightSignal.inclinedRoofGeometryTruthful).toBe(true);
  });

  it("Résolveur sans defaultHeightM : pas de heightM imposé", () => {
    const r = resolveHeightAtXY(10, 10, {}, {});
    expect(r.source).toBe("insufficient_height_signal");
    expect(r.heightM).toBeUndefined();
  });
});
