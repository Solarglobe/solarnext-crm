/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { minimalCalpinageRuntimeFixture } from "../../canonical3d/dev/minimalCalpinageRuntimeFixture";
import { syncRoofPansMirrorFromPans } from "../../legacy/phase2RoofDerivedModel";
import { applyCanonical3DWorldContractToRoof } from "../canonical3DWorldContract";
import {
  ROOF_MODELING_MAX_SLOPE_DEG,
  validateCalpinageRuntimeAfterRoofEdit,
} from "../validateCalpinageRuntimeAfterRoofEdit";

function prepareRuntime(state: typeof minimalCalpinageRuntimeFixture) {
  syncRoofPansMirrorFromPans(state as unknown as Record<string, unknown>);
  applyCanonical3DWorldContractToRoof(state.roof);
}

describe("validateCalpinageRuntimeAfterRoofEdit (B8)", () => {
  it("fixture minimal cohérent → ok", () => {
    const state = JSON.parse(JSON.stringify(minimalCalpinageRuntimeFixture)) as typeof minimalCalpinageRuntimeFixture;
    prepareRuntime(state);
    const v = validateCalpinageRuntimeAfterRoofEdit(state, { editedPanId: "pan-a" });
    expect(v.ok).toBe(true);
  });

  it("pente excessive sur un sommet → échec avec message (option B)", () => {
    const state = JSON.parse(JSON.stringify(minimalCalpinageRuntimeFixture)) as typeof minimalCalpinageRuntimeFixture;
    for (const pt of state.pans[0]!.polygonPx!) {
      (pt as { h: number }).h = 0;
    }
    (state.pans[0]!.polygonPx![0] as { h: number }).h = 14;
    prepareRuntime(state);
    const v = validateCalpinageRuntimeAfterRoofEdit(state, { editedPanId: "pan-a" });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.userMessage.length).toBeGreaterThan(10);
      expect(
        v.codes.includes("ROOF_MODELING_SLOPE_EXCEEDED") ||
          v.codes.some((c) => c === "PAN_DEGENERATE" || c === "PAN_INVALID_GEOMETRY"),
      ).toBe(true);
    }
  });

  it("constante pente max exportée dans la plage modeleur", () => {
    expect(ROOF_MODELING_MAX_SLOPE_DEG).toBeGreaterThanOrEqual(60);
    expect(ROOF_MODELING_MAX_SLOPE_DEG).toBeLessThan(90);
  });

  it("pan voisin très pentu : alignement RoofTruth — commit sur pan-a ok ; pan-b rejeté par pente max (slope dérivée)", () => {
    const state = JSON.parse(JSON.stringify(minimalCalpinageRuntimeFixture)) as typeof minimalCalpinageRuntimeFixture;
    const panB = JSON.parse(JSON.stringify(state.pans[0])) as (typeof state.pans)[0];
    panB.id = "pan-b";
    panB.polygonPx = [
      { x: 500, y: 500, h: 22 },
      { x: 600, y: 500, h: 3 },
      { x: 600, y: 600, h: 3 },
      { x: 500, y: 600, h: 3 },
    ] as typeof panB.polygonPx;
    state.pans.push(panB);
    prepareRuntime(state);
    const vOk = validateCalpinageRuntimeAfterRoofEdit(state, { editedPanId: "pan-a" });
    expect(vOk.ok).toBe(true);
    const vBad = validateCalpinageRuntimeAfterRoofEdit(state, { editedPanId: "pan-b" });
    expect(vBad.ok).toBe(false);
    const vStrict = validateCalpinageRuntimeAfterRoofEdit(state, {
      editedPanId: "pan-a",
      scopePanGeometryErrorsToEditedPanId: false,
    });
    expect(vStrict.ok).toBe(true);
  });
});
