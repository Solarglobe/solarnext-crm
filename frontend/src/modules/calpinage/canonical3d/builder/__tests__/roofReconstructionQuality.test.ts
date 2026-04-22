/**
 * Prompt 4 — diagnostics `roofReconstructionQuality` (vérité géométrique vs fallback).
 */

import { describe, expect, it } from "vitest";
import { buildRoofModel3DFromLegacyGeometry } from "../buildRoofModel3DFromLegacyGeometry";
import { distance3 } from "../../utils/math3";

function vertexPos(model: { roofVertices: { id: string; position: { x: number; y: number; z: number } }[] }, id: string) {
  const v = model.roofVertices.find((x) => x.id === id);
  if (!v) throw new Error(`vertex ${id}`);
  return v.position;
}

describe("roofReconstructionQuality (Prompt 4)", () => {
  it("CAS 1 — deux pans voisins : arête 3D unique (mêmes sommets), pas de conflit topologique", () => {
    const mpp = 0.05;
    const input = {
      metersPerPixel: mpp,
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
    };

    const { model, roofReconstructionQuality } = buildRoofModel3DFromLegacyGeometry(input);
    expect(roofReconstructionQuality.panCount).toBe(2);
    expect(roofReconstructionQuality.roofReconstructionQuality).toBe("TRUTHFUL");
    expect(roofReconstructionQuality.sharedEdgeConflictCount).toBe(0);
    expect(roofReconstructionQuality.solvedPanCount).toBe(2);

    const shared = model.roofEdges.filter((e) => e.incidentPlanePatchIds.length === 2);
    expect(shared.length).toBeGreaterThanOrEqual(1);
    const e0 = shared[0]!;
    const pa = vertexPos(model, e0.vertexAId);
    const pb = vertexPos(model, e0.vertexBId);
    expect(distance3(pa, pb)).toBeGreaterThan(1e-4);

    const p1 = model.roofPlanePatches.find((p) => p.id === "p1")!;
    const ids = p1.boundaryVertexIds;
    const ia = ids.indexOf(e0.vertexAId);
    const ib = ids.indexOf(e0.vertexBId);
    expect(ia).toBeGreaterThanOrEqual(0);
    expect(ib).toBeGreaterThanOrEqual(0);
    const n = ids.length;
    const consecutive =
      Math.abs(ia - ib) === 1 ||
      (ia === 0 && ib === n - 1) ||
      (ib === 0 && ia === n - 1);
    expect(consecutive).toBe(true);
  });

  it("CAS 2 — sommets partiellement cotés + ridge valide : au moins PARTIAL, contrainte structurante comptée", () => {
    const mpp = 0.05;
    const input = {
      metersPerPixel: mpp,
      northAngleDeg: 0,
      defaultHeightM: 8,
      pans: [
        {
          id: "p1",
          polygonPx: [
            { xPx: 0, yPx: 0, heightM: 8 },
            { xPx: 100, yPx: 0, heightM: 8 },
            { xPx: 100, yPx: 100, heightM: 8 },
            { xPx: 0, yPx: 100 },
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
          id: "r-shared",
          kind: "ridge" as const,
          a: { xPx: 100, yPx: 0, heightM: 8 },
          b: { xPx: 100, yPx: 100, heightM: 8 },
        },
      ],
    };

    const { roofReconstructionQuality, model, stats } = buildRoofModel3DFromLegacyGeometry(input);
    expect(roofReconstructionQuality.structuralConstraintCount).toBe(1);
    expect(["PARTIAL", "TRUTHFUL"]).toContain(roofReconstructionQuality.roofReconstructionQuality);
    expect(stats.ridgeLineCount).toBeGreaterThanOrEqual(1);
    expect(model.roofRidges.length).toBeGreaterThanOrEqual(1);
  });

  it("CAS 3 — ridge contradictoire (cotes Z différentes + faîtage quasi plat) : conflits diagnostiqués, pas TRUTHFUL silencieux", () => {
    const mpp = 0.05;
    const input = {
      metersPerPixel: mpp,
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
          kind: "ridge" as const,
          a: { xPx: 100, yPx: 0, heightM: 8 },
          b: { xPx: 100, yPx: 100, heightM: 10.6 },
        },
      ],
    };

    const { roofReconstructionQuality, interPanReports } = buildRoofModel3DFromLegacyGeometry(input);
    expect(roofReconstructionQuality.roofReconstructionQuality).not.toBe("TRUTHFUL");
    expect(roofReconstructionQuality.sharedEdgeConflictCount).toBeGreaterThan(0);
    expect(roofReconstructionQuality.roofTopologyWarnings.some((w) => w.startsWith("STRUCTURAL_INTERPAN"))).toBe(
      true,
    );
    const hasAsym = interPanReports.some((r) =>
      r.diagnostics.some((d) => d.code === "INTERPAN_HEIGHT_ASYMMETRY_ALONG_STRUCTURAL_LINE"),
    );
    expect(hasAsym).toBe(true);
  });

  it("CAS 5 (builder) — uniquement defaultHeightM sur les sommets : qualité FALLBACK assumée", () => {
    const { roofReconstructionQuality, roofHeightSignal } = buildRoofModel3DFromLegacyGeometry({
      metersPerPixel: 0.05,
      northAngleDeg: 0,
      defaultHeightM: 9,
      pans: [
        {
          id: "solo",
          polygonPx: [
            { xPx: 0, yPx: 0 },
            { xPx: 50, yPx: 0 },
            { xPx: 25, yPx: 40 },
          ],
        },
      ],
    });
    expect(roofHeightSignal.heightSignalStatus).toBe("MISSING");
    expect(roofReconstructionQuality.roofReconstructionQuality).toBe("FALLBACK");
    expect(roofReconstructionQuality.fallbackPanCount).toBe(1);
  });
});
