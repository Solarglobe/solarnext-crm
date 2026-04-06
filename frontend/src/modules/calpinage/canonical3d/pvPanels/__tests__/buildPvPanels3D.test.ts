import { describe, expect, it } from "vitest";
import type { RoofObstacleVolume3D } from "../../types/roof-obstacle-volume";
import type { RoofPlanePatch3D } from "../../types/roof-surface";
import { buildPvPanels3D } from "../buildPvPanels3D";
import { dot3 } from "../../utils/math3";

/** Pan horizontal z = 10 m, normale +Z — rectangle 10×10 m (4 coins). */
function makeHorizontalPatch(id: string): RoofPlanePatch3D {
  const normal = { x: 0, y: 0, z: 1 };
  return {
    id,
    topologyRole: "primary_shell",
    boundaryVertexIds: ["pv1", "pv2", "pv3", "pv4"],
    boundaryEdgeIds: ["pe1", "pe2", "pe3", "pe4"],
    cornersWorld: [
      { x: 0, y: 0, z: 10 },
      { x: 10, y: 0, z: 10 },
      { x: 10, y: 10, z: 10 },
      { x: 0, y: 10, z: 10 },
    ],
    localFrame: {
      role: "roof_face",
      origin: { x: 0, y: 0, z: 10 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { ...normal },
    },
    normal,
    equation: { normal, d: -10 },
    boundaryCycleWinding: "unspecified",
    centroid: { x: 5, y: 5, z: 10 },
    surface: { areaM2: 100 },
    adjacentPlanePatchIds: [],
    provenance: { source: "solver", solverStep: "test:horizontalPatch" },
    quality: { confidence: "high", diagnostics: [] },
  } as RoofPlanePatch3D;
}

describe("buildPvPanels3D", () => {
  it("construit un quad plan avec normale pan, centre et coins cohérents (pan horizontal)", () => {
    const patch = makeHorizontalPatch("pan-flat");
    const { panels } = buildPvPanels3D(
      {
        panels: [
          {
            id: "mod-1",
            roofPlanePatchId: "pan-flat",
            center: { mode: "plane_uv", uv: { u: 2, v: 3 } },
            widthM: 1,
            heightM: 1.7,
            orientation: "portrait",
            rotationDegInPlane: 0,
            sampling: { nx: 2, ny: 2, includeEdgeMidpoints: false },
          },
        ],
      },
      { roofPlanePatches: [patch] }
    );

    expect(panels).toHaveLength(1);
    const p = panels[0];
    expect(p.corners3D).toHaveLength(4);
    expect(Math.abs(dot3(p.outwardNormal, patch.normal) - 1)).toBeLessThan(1e-6);
    expect(p.localFrame.role).toBe("pv_panel_surface");
    expect(p.surfaceAreaM2).toBeCloseTo(1 * 1.7, 6);

    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const c of p.corners3D) {
      sx += c.x;
      sy += c.y;
      sz += c.z;
    }
    const cx = sx / 4;
    const cy = sy / 4;
    const cz = sz / 4;
    expect(cx).toBeCloseTo(p.center3D.x, 6);
    expect(cy).toBeCloseTo(p.center3D.y, 6);
    expect(cz).toBeCloseTo(p.center3D.z, 6);
    expect(cz).toBeCloseTo(10, 6);

    expect(p.samplingGrid.cellCentersWorld).toHaveLength(4);
    let gx = 0;
    let gy = 0;
    let gz = 0;
    for (const g of p.samplingGrid.cellCentersWorld) {
      gx += g.x;
      gy += g.y;
      gz += g.z;
    }
    expect(gx / 4).toBeCloseTo(p.center3D.x, 6);
    expect(gy / 4).toBeCloseTo(p.center3D.y, 6);
    expect(gz / 4).toBeCloseTo(10, 6);

    expect(p.spatialContext.patchBoundary.cornersAllInsidePatchBoundary).toBe(true);
    expect(p.spatialContext.patchBoundary.minDistanceToPatchBoundaryM).toBeGreaterThan(0.1);
    expect(p.spatialContext.spatialContextQuality).toBe("partial");
    expect(p.spatialContext.structuralLines.minDistanceToStructuralLineM).toBeNull();
  });

  it("paysage vs portrait : dimensions le long U/V diffèrent pour le même module", () => {
    const patch = makeHorizontalPatch("pan-b");
    const base = {
      roofPlanePatchId: "pan-b",
      center: { mode: "plane_uv" as const, uv: { u: 0, v: 0 } },
      widthM: 1,
      heightM: 2,
      rotationDegInPlane: 0,
      sampling: { nx: 1, ny: 1 },
    };

    const portrait = buildPvPanels3D(
      { panels: [{ id: "a", ...base, orientation: "portrait" }] },
      { roofPlanePatches: [patch] }
    ).panels[0];

    const landscape = buildPvPanels3D(
      { panels: [{ id: "b", ...base, orientation: "landscape" }] },
      { roofPlanePatches: [patch] }
    ).panels[0];

    const w0 = portrait.corners3D[0];
    const w1 = portrait.corners3D[1];
    const edgePortrait = Math.hypot(w1.x - w0.x, w1.y - w0.y, w1.z - w0.z);

    const l0 = landscape.corners3D[0];
    const l1 = landscape.corners3D[1];
    const edgeLandscape = Math.hypot(l1.x - l0.x, l1.y - l0.y, l1.z - l0.z);

    expect(edgePortrait).toBeCloseTo(1, 6);
    expect(edgeLandscape).toBeCloseTo(2, 6);
  });

  it("rotation 90° dans le plan modifie la pose (premier bord)", () => {
    const patch = makeHorizontalPatch("pan-c");
    const r0 = buildPvPanels3D(
      {
        panels: [
          {
            id: "r0",
            roofPlanePatchId: "pan-c",
            center: { mode: "plane_uv", uv: { u: 0, v: 0 } },
            widthM: 1,
            heightM: 1,
            orientation: "portrait",
            rotationDegInPlane: 0,
            sampling: { nx: 1, ny: 1 },
          },
        ],
      },
      { roofPlanePatches: [patch] }
    ).panels[0];

    const r90 = buildPvPanels3D(
      {
        panels: [
          {
            id: "r90",
            roofPlanePatchId: "pan-c",
            center: { mode: "plane_uv", uv: { u: 0, v: 0 } },
            widthM: 1,
            heightM: 1,
            orientation: "portrait",
            rotationDegInPlane: 90,
            sampling: { nx: 1, ny: 1 },
          },
        ],
      },
      { roofPlanePatches: [patch] }
    ).panels[0];

    const e0 = Math.hypot(
      r0.corners3D[1].x - r0.corners3D[0].x,
      r0.corners3D[1].y - r0.corners3D[0].y,
      r0.corners3D[1].z - r0.corners3D[0].z
    );
    const e90 = Math.hypot(
      r90.corners3D[1].x - r90.corners3D[0].x,
      r90.corners3D[1].y - r90.corners3D[0].y,
      r90.corners3D[1].z - r90.corners3D[0].z
    );
    expect(e0).toBeCloseTo(1, 6);
    expect(e90).toBeCloseTo(1, 6);
    expect(Math.abs(r0.corners3D[0].x - r90.corners3D[0].x)).toBeGreaterThan(1e-3);
  });

  it("centre monde hors plan : projection + diagnostic", () => {
    const patch = makeHorizontalPatch("pan-d");
    const { panels, globalQuality } = buildPvPanels3D(
      {
        panels: [
          {
            id: "off",
            roofPlanePatchId: "pan-d",
            center: { mode: "world", position: { x: 1, y: 2, z: 12 } },
            widthM: 0.5,
            heightM: 0.5,
            orientation: "landscape",
            rotationDegInPlane: 0,
            sampling: { nx: 1, ny: 1 },
          },
        ],
      },
      { roofPlanePatches: [patch] }
    );

    expect(panels).toHaveLength(1);
    expect(panels[0].center3D.z).toBeCloseTo(10, 6);
    expect(panels[0].attachment.signedDistanceCenterToPlaneM).toBeCloseTo(2, 6);
    expect(panels[0].quality.diagnostics.some((d) => d.code === "PV_PANEL_CENTER_PROJECTED")).toBe(true);
    expect(globalQuality.diagnostics.some((d) => d.code === "PV_PANEL_BUILD_STRATEGY")).toBe(true);
  });

  it("pan introuvable : panneau omis + diagnostic", () => {
    const patch = makeHorizontalPatch("only");
    const { panels, globalQuality } = buildPvPanels3D(
      {
        panels: [
          {
            id: "ghost",
            roofPlanePatchId: "nope",
            center: { mode: "plane_uv", uv: { u: 0, v: 0 } },
            widthM: 1,
            heightM: 1,
            orientation: "portrait",
            rotationDegInPlane: 0,
          },
        ],
      },
      { roofPlanePatches: [patch] }
    );

    expect(panels).toHaveLength(0);
    expect(globalQuality.diagnostics.some((d) => d.code === "PV_PANEL_PLANE_PATCH_NOT_FOUND")).toBe(true);
  });

  it("panneau près du bord : faible clearance + nearRoofBoundary", () => {
    const patch = makeHorizontalPatch("pan-edge");
    const { panels } = buildPvPanels3D(
      {
        panels: [
          {
            id: "edge-mod",
            roofPlanePatchId: "pan-edge",
            center: { mode: "plane_uv", uv: { u: 0.25, v: 5 } },
            widthM: 0.4,
            heightM: 0.5,
            orientation: "portrait",
            rotationDegInPlane: 0,
            sampling: { nx: 1, ny: 1 },
          },
        ],
      },
      { roofPlanePatches: [patch] }
    );
    const p = panels[0];
    expect(p.spatialContext.patchBoundary.minDistanceToPatchBoundaryM).toBeLessThan(0.2);
    expect(p.spatialContext.patchBoundary.nearRoofBoundary).toBe(true);
  });

  it("ligne structurante (ridge) proche : distance faible + flag", () => {
    const patch = makeHorizontalPatch("pan-ridge");
    const { panels } = buildPvPanels3D(
      {
        panels: [
          {
            id: "m1",
            roofPlanePatchId: "pan-ridge",
            center: { mode: "plane_uv", uv: { u: 5, v: 5 } },
            widthM: 0.5,
            heightM: 0.5,
            orientation: "portrait",
            rotationDegInPlane: 0,
            sampling: { nx: 1, ny: 1 },
          },
        ],
      },
      {
        roofPlanePatches: [patch],
        structuralLineSegments: [
          {
            id: "ridge-1",
            endpointAWorld: { x: 5, y: 0, z: 10 },
            endpointBWorld: { x: 5, y: 10, z: 10 },
            semanticKind: "ridge",
            incidentPlanePatchIds: ["pan-ridge"],
          },
        ],
        obstacleVolumes: [],
        extensionVolumes: [],
      }
    );
    const p = panels[0];
    expect(p.spatialContext.structuralLines.minDistanceToStructuralLineM).toBeLessThan(0.3);
    expect(p.spatialContext.structuralLines.nearRidgeOrHip).toBe(true);
    expect(p.spatialContext.spatialContextQuality).toBe("complete");
  });

  it("obstacle volumique proche (AABB) : distance et contexte volumes", () => {
    const patch = makeHorizontalPatch("pan-vol");
    const obstacle = {
      id: "chem-1",
      bounds: {
        min: { x: 5.2, y: 5.2, z: 10 },
        max: { x: 5.8, y: 5.8, z: 12 },
      },
    } as RoofObstacleVolume3D;

    const { panels } = buildPvPanels3D(
      {
        panels: [
          {
            id: "pv-near",
            roofPlanePatchId: "pan-vol",
            center: { mode: "plane_uv", uv: { u: 5, v: 5 } },
            widthM: 0.4,
            heightM: 0.4,
            orientation: "portrait",
            rotationDegInPlane: 0,
            sampling: { nx: 1, ny: 1 },
          },
        ],
      },
      {
        roofPlanePatches: [patch],
        structuralLineSegments: [],
        obstacleVolumes: [obstacle],
        extensionVolumes: [],
      }
    );

    const p = panels[0];
    expect(p.spatialContext.volumes.nearestObstacleVolumeId).toBe("chem-1");
    expect(p.spatialContext.volumes.nearestObstacleDistanceM).toBeLessThan(1);
    expect(p.quality.diagnostics.some((d) => d.code === "PV_PANEL_NEAR_OBSTACLE_VOLUME")).toBe(true);
  });
});
