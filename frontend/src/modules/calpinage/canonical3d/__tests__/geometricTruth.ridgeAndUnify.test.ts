/**
 * Prompt 23 — C : faîtage / sommets partagés + audit structurant.
 */

import { describe, expect, it } from "vitest";
import { buildCanonicalPans3DFromRuntime } from "../adapters/buildCanonicalPans3DFromRuntime";
import { auditStructuralLinesAgainstCanonicalPans } from "../resolution/auditStructuralLines3D";
import type { HeightResolverContext } from "../../core/heightResolver";
import { expectDiagnosticsIncludeOneOf, expectSharedImageVerticesSameZ } from "../test-utils/geometryAssertions";

describe("Géométrie C — raccord faîtage / audit", () => {
  it("deux pans partageant un coin : Z unifié (déjà couvert CAS 9) — renforce tolérance Z", () => {
    const shared = { x: 100, y: 100 };
    const getHeightAtXY = (pid: string) => (pid === "pl" ? 5.5 : 7.5);
    const ctx: HeightResolverContext = { state: {}, getHeightAtXY };
    const state = {
      roof: {
        scale: { metersPerPixel: 0.01 },
        roof: { north: { angleDeg: 0 } },
        roofPans: [
          { id: "pl", polygon: [shared, { x: 200, y: 100 }, { x: 200, y: 200 }] },
          { id: "pr", polygon: [shared, { x: 100, y: 200 }, { x: 0, y: 100 }] },
        ],
      },
    };
    const res = buildCanonicalPans3DFromRuntime({ state, heightResolverContext: ctx });
    const vl = res.pans.find((p) => p.panId === "pl")!.vertices3D.find((v) => v.xPx === 100 && v.yPx === 100)!;
    const vr = res.pans.find((p) => p.panId === "pr")!.vertices3D.find((v) => v.xPx === 100 && v.yPx === 100)!;
    expectSharedImageVerticesSameZ(vl, vr, 0.6, 0.02);
  });

  it("ridge avec h incompatible vs sommets pan → RIDGE_Z_INCONSISTENT", () => {
    const poly = [
      { x: 0, y: 0, h: 6 },
      { x: 100, y: 0, h: 6 },
      { x: 100, y: 100, h: 6 },
      { x: 0, y: 100, h: 6 },
    ];
    const state = {
      roof: {
        scale: { metersPerPixel: 0.01 },
        roof: { north: { angleDeg: 0 } },
        roofPans: [{ id: "p1", points: poly }],
      },
      ridges: [
        {
          id: "r-bad",
          roofRole: "main",
          a: { x: 0, y: 0, h: 20 },
          b: { x: 100, y: 0, h: 20 },
        },
      ],
    };
    const res = buildCanonicalPans3DFromRuntime({
      state,
      heightResolverContext: { state: {} },
    });
    const pan = res.pans[0]!;
    const audit = auditStructuralLinesAgainstCanonicalPans(state, [pan], 2);
    expectDiagnosticsIncludeOneOf(audit, ["RIDGE_Z_INCONSISTENT"]);
  });

  it("ridge point loin du pan → STRUCTURAL_POINT_UNRESOLVED", () => {
    const poly = [
      { x: 0, y: 0, h: 5 },
      { x: 10, y: 0, h: 5 },
      { x: 5, y: 10, h: 5 },
    ];
    const state = {
      roof: {
        scale: { metersPerPixel: 0.01 },
        roof: { north: { angleDeg: 0 } },
        roofPans: [{ id: "tiny", points: poly }],
      },
      ridges: [
        {
          id: "r-far",
          roofRole: "main",
          /** h valide requis : sinon l’audit ignore le point (pas de diagnostic). */
          a: { x: 5000, y: 5000, h: 5.5 },
          b: { x: 5001, y: 5000, h: 5.5 },
        },
      ],
    };
    const res = buildCanonicalPans3DFromRuntime({
      state,
      heightResolverContext: { state: {} },
    });
    const audit = auditStructuralLinesAgainstCanonicalPans(state, res.pans, 2);
    expectDiagnosticsIncludeOneOf(audit, ["STRUCTURAL_POINT_UNRESOLVED"]);
  });
});
