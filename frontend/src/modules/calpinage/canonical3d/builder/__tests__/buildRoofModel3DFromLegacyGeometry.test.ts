import { describe, expect, it } from "vitest";
import { dot3 } from "../../utils/math3";
import { buildRoofModel3DFromLegacyGeometry } from "../buildRoofModel3DFromLegacyGeometry";
import { validateRoofModel3D } from "../../utils/validation";
import { centroid3, planeFitResidualRms } from "../planePolygon3d";

describe("buildRoofModel3DFromLegacyGeometry", () => {
  it("produit un modèle avec un pan horizontal carré et valide le contrat", () => {
    const mpp = 0.05;
    const input = {
      metersPerPixel: mpp,
      northAngleDeg: 0,
      defaultHeightM: 10,
      pans: [
        {
          id: "pan-a",
          polygonPx: [
            { xPx: 0, yPx: 0, heightM: 10 },
            { xPx: 100, yPx: 0, heightM: 10 },
            { xPx: 100, yPx: 100, heightM: 10 },
            { xPx: 0, yPx: 100, heightM: 10 },
          ],
        },
      ],
    };

    const { model, stats, interPanReports } = buildRoofModel3DFromLegacyGeometry(input);
    expect(stats.panCount).toBe(1);
    expect(stats.vertexCount).toBe(4);
    expect(stats.edgeCount).toBe(4);
    expect(stats.interPanRelationCount).toBe(0);
    expect(interPanReports).toHaveLength(0);
    expect(model.roofPlanePatches[0].tiltDeg).toBeLessThan(0.1);
    expect(model.metadata.reconstructionSource).toBe("from_legacy_2d");

    const v = validateRoofModel3D(model);
    expect(v.ok).toBe(true);
  });

  it("fusionne les arêtes entre deux pans qui partagent un bord (sommets dédoublonnés)", () => {
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

    const { model, stats, interPanReports } = buildRoofModel3DFromLegacyGeometry(input);
    expect(stats.panCount).toBe(2);
    expect(stats.edgeCount).toBe(7);
    expect(stats.interPanRelationCount).toBe(1);
    expect(interPanReports).toHaveLength(1);
    expect(interPanReports[0].structuralRole).toBe("topology_only");
    const shared = model.roofEdges.filter((e) => e.incidentPlanePatchIds.length === 2);
    expect(shared.length).toBeGreaterThanOrEqual(1);
    const adj = model.roofPlanePatches[0].adjacentPlanePatchIds;
    expect(adj).toContain("p2");
    expect(model.globalQuality.diagnostics.some((d) => d.code === "INTERPAN_SHARED_EDGE_PLANE_SUMMARY")).toBe(
      true,
    );
    for (const patch of model.roofPlanePatches) {
      const c = centroid3(patch.cornersWorld);
      const rms = planeFitResidualRms(patch.cornersWorld, patch.normal, c);
      expect(rms).toBeLessThan(1e-4);
    }
  });

  it("refuse metersPerPixel invalide sans lever", () => {
    const { model, stats } = buildRoofModel3DFromLegacyGeometry({
      metersPerPixel: -1,
      northAngleDeg: 0,
      defaultHeightM: 5,
      pans: [{ id: "x", polygonPx: [{ xPx: 0, yPx: 0 }, { xPx: 1, yPx: 0 }, { xPx: 0, yPx: 1 }] }],
    });
    expect(stats.panCount).toBe(0);
    expect(model.globalQuality.diagnostics.some((d) => d.code === "BUILDER_INVALID_MPP")).toBe(true);
  });

  it("produit une RoofRidge3D traçable quand une ridge 2D colle au bord commun de deux pans", () => {
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
          id: "r-shared",
          kind: "ridge" as const,
          a: { xPx: 100, yPx: 0, heightM: 8 },
          b: { xPx: 100, yPx: 100, heightM: 8 },
        },
      ],
    };

    const { model, stats, interPanReports } = buildRoofModel3DFromLegacyGeometry(input);
    expect(stats.ridgeLineCount).toBe(1);
    expect(stats.interPanRelationCount).toBe(1);
    const rel = interPanReports.find((r) => r.planePatchIdA === "p1" && r.planePatchIdB === "p2");
    expect(rel?.structuralRole).toBe("ridge_line");
    expect(rel?.continuityGrade).toMatch(/strong|medium|ambiguous/);
    expect(model.roofRidges).toHaveLength(1);
    expect(model.roofRidges[0].id).toBe("ridge3d-r-shared");
    expect(model.roofRidges[0].structuralKind).toBe("main_ridge");
    expect(model.roofRidges[0].roofEdgeIds.length).toBeGreaterThanOrEqual(1);

    const ridgeEdge = model.roofEdges.find(
      (e) => e.incidentPlanePatchIds.length === 2 && e.semantic?.kind === "ridge" && e.ridgeLineId === "ridge3d-r-shared"
    );
    expect(ridgeEdge).toBeDefined();
    const p1 = model.roofPlanePatches.find((p) => p.id === "p1");
    const p2 = model.roofPlanePatches.find((p) => p.id === "p2");
    if (ridgeEdge && p1 && p2) {
      const d = ridgeEdge.directionWorld;
      expect(Math.abs(dot3(p1.normal, d))).toBeLessThan(0.02);
      expect(Math.abs(dot3(p2.normal, d))).toBeLessThan(0.02);
    }

    const v = validateRoofModel3D(model);
    expect(v.ok).toBe(true);
  });

  it("rapporte une relation break_line pour un trait sur l’arête commune de deux pans", () => {
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
      traits: [
        {
          id: "t-shared",
          kind: "trait" as const,
          a: { xPx: 100, yPx: 0, heightM: 8 },
          b: { xPx: 100, yPx: 100, heightM: 8 },
        },
      ],
    };

    const { stats, interPanReports, model } = buildRoofModel3DFromLegacyGeometry(input);
    expect(stats.interPanRelationCount).toBe(1);
    expect(interPanReports[0].structuralRole).toBe("break_line");
    expect(model.roofRidges[0].structuralKind).toBe("break_line");
    expect(validateRoofModel3D(model).ok).toBe(true);
  });

  it("verrouille le Z identique sur les coins partagés si les hauteurs explicites divergent", () => {
    const mpp = 0.05;
    const { model, interPanReports } = buildRoofModel3DFromLegacyGeometry({
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
            { xPx: 100, yPx: 0, heightM: 8.12 },
            { xPx: 200, yPx: 0, heightM: 8 },
            { xPx: 200, yPx: 100, heightM: 8 },
            { xPx: 100, yPx: 100, heightM: 8.12 },
          ],
        },
      ],
    });
    expect(interPanReports.length).toBeGreaterThanOrEqual(1);
    const p1 = model.roofPlanePatches.find((p) => p.id === "p1")!;
    const p2 = model.roofPlanePatches.find((p) => p.id === "p2")!;
    const keyXY = (c: { x: number; y: number }) =>
      `${Math.round(c.x * 1e5)},${Math.round(c.y * 1e5)}`;
    const zsByXY = new Map<string, number[]>();
    for (const patch of [p1, p2]) {
      for (const c of patch.cornersWorld) {
        const k = keyXY(c);
        const arr = zsByXY.get(k) ?? [];
        arr.push(c.z);
        zsByXY.set(k, arr);
      }
    }
    for (const zs of zsByXY.values()) {
      if (zs.length > 1) {
        expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(1e-4);
      }
    }
    expect(model.globalQuality.diagnostics.some((d) => d.code === "INTERPAN_SHARED_CORNER_Z_LOCKED")).toBe(true);
  });

  it("priorise les hauteurs explicites sur les sommets par rapport au défaut global", () => {
    const mpp = 0.05;
    const { model } = buildRoofModel3DFromLegacyGeometry({
      metersPerPixel: mpp,
      northAngleDeg: 0,
      defaultHeightM: 3,
      pans: [
        {
          id: "p1",
          polygonPx: [
            { xPx: 0, yPx: 0, heightM: 12 },
            { xPx: 100, yPx: 0, heightM: 12 },
            { xPx: 100, yPx: 100, heightM: 12 },
            { xPx: 0, yPx: 100, heightM: 12 },
          ],
        },
      ],
    });
    for (const v of model.roofVertices) {
      expect(v.position.z).toBe(0);
    }
  });
});
