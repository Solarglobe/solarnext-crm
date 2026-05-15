import { describe, expect, it } from "vitest";
import { buildRoofModel3DFromLegacyGeometry } from "../../builder/buildRoofModel3DFromLegacyGeometry";
import { buildRoofMultiPanDiagnostics } from "../roofMultiPanDiagnostics";

describe("buildRoofMultiPanDiagnostics", () => {
  it("remonte les divergences Z et jonctions suspectes avant pose PV", () => {
    const res = buildRoofModel3DFromLegacyGeometry({
      metersPerPixel: 0.05,
      northAngleDeg: 0,
      defaultHeightM: 8,
      pans: [
        {
          id: "p1",
          polygonPx: [
            { xPx: 0, yPx: 0, heightM: 8 },
            { xPx: 100, yPx: 0, heightM: 8 },
            { xPx: 100, yPx: 100, heightM: 8 },
            { xPx: 0, yPx: 100, heightM: 8 },
          ],
        },
        {
          id: "p2",
          polygonPx: [
            { xPx: 100, yPx: 0, heightM: 8 },
            { xPx: 200, yPx: 0, heightM: 8 },
            { xPx: 200, yPx: 100, heightM: 8 },
            { xPx: 100, yPx: 100, heightM: 8 },
          ],
        },
      ],
      ridges: [
        {
          id: "r-bad",
          kind: "ridge",
          a: { xPx: 100, yPx: 0, heightM: 8 },
          b: { xPx: 100, yPx: 100, heightM: 10.6 },
        },
      ],
    });

    const diag = buildRoofMultiPanDiagnostics({
      model: res.model,
      interPanReports: res.interPanReports,
    });
    expect(diag.relationCount).toBeGreaterThan(0);
    expect(diag.zDivergenceCount).toBeGreaterThan(0);
    expect(diag.okForPvLayout).toBe(false);
    expect(diag.items.some((i) => i.kind === "z_divergence" && i.panIds.includes("p1") && i.panIds.includes("p2"))).toBe(true);
  });

  it("marque une toiture mono-pan comme sans relation multi-pans", () => {
    const res = buildRoofModel3DFromLegacyGeometry({
      metersPerPixel: 0.05,
      northAngleDeg: 0,
      defaultHeightM: 8,
      pans: [
        {
          id: "solo",
          polygonPx: [
            { xPx: 0, yPx: 0, heightM: 8 },
            { xPx: 100, yPx: 0, heightM: 8 },
            { xPx: 100, yPx: 100, heightM: 8 },
            { xPx: 0, yPx: 100, heightM: 8 },
          ],
        },
      ],
    });
    const diag = buildRoofMultiPanDiagnostics({ model: res.model, interPanReports: res.interPanReports });
    expect(diag.relationCount).toBe(0);
    expect(diag.okForPvLayout).toBe(true);
  });
});
