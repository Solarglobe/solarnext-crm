import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { parseCalpinageStateToCanonicalHouse3D } from "../parseCalpinageStateToCanonicalHouse3D";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): Record<string, unknown> {
  const raw = readFileSync(join(__dirname, "../dev", name), "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("parseCalpinageStateToCanonicalHouse3D", () => {
  it("parse nominal 2 pans : patches 3D complets, éligibilité toit", () => {
    const state = loadFixture("state-simple-2pans.json");
    const r = parseCalpinageStateToCanonicalHouse3D(state, {});
    expect(r.diagnostics.filter((d) => d.severity === "blocking")).toHaveLength(0);
    expect(r.document.roof.geometry.roofPatches).toHaveLength(2);
    for (const p of r.document.roof.geometry.roofPatches) {
      expect(p.boundaryLoop3d).toHaveLength(4);
    }
    expect(r.eligibility.roof3dBuildable).toBe(true);
    expect(r.sourcesUsed.some((s) => s.includes("state.pans"))).toBe(true);
    expect(r.diagnostics.some((d) => d.code === "ROOF_EDGE_SEGMENT_GEOMETRY_DEFERRED")).toBe(true);
  });

  it("priorité validatedRoofData.pans si verrou + préférence snapshot", () => {
    const state = loadFixture("state-validated-snapshot.json");
    const r = parseCalpinageStateToCanonicalHouse3D(state, { preferValidatedRoofSnapshot: true });
    expect(r.sourcesUsed.some((s) => s.includes("validatedRoofData.pans"))).toBe(true);
    expect(r.document.roof.topology.patches.map((p) => p.roofPatchId)).toEqual(["from-snapshot"]);
  });

  it("snapshot verrouillé sans hauteurs 3D : conserve state.pans quand il est complet", () => {
    const state = loadFixture("state-validated-snapshot.json");
    state.validatedRoofData = {
      pans: [
        {
          id: "snapshot-2d-only",
          points: [
            { x: 5, y: 5 },
            { x: 95, y: 5 },
            { x: 95, y: 95 },
            { x: 5, y: 95 },
          ],
        },
      ],
    };

    const r = parseCalpinageStateToCanonicalHouse3D(state, { preferValidatedRoofSnapshot: true });

    expect(r.sourcesUsed.some((s) => s.includes("state.pans (validated_snapshot_missing_3d_heights)"))).toBe(true);
    expect(r.document.roof.topology.patches.map((p) => p.roofPatchId)).toEqual([
      "live-pan-should-not-win-when-prefer-snapshot",
    ]);
    expect(r.document.roof.geometry.roofPatches[0]?.boundaryLoop3d).toHaveLength(4);
    expect(r.eligibility.roof3dBuildable).toBe(true);
  });

  it("désactiver préférence snapshot → state.pans prioritaire", () => {
    const state = loadFixture("state-validated-snapshot.json");
    const r = parseCalpinageStateToCanonicalHouse3D(state, { preferValidatedRoofSnapshot: false });
    expect(r.document.roof.topology.patches.map((p) => p.roofPatchId)).toEqual(["live-pan-should-not-win-when-prefer-snapshot"]);
  });

  it("hauteurs pan absentes : pas de boundaryLoop3d synthétique, toit non buildable", () => {
    const state = loadFixture("state-missing-pan-heights.json");
    const r = parseCalpinageStateToCanonicalHouse3D(state, {});
    expect(r.diagnostics.some((d) => d.code === "PAN_VERTEX_MISSING_H")).toBe(true);
    const patch = r.document.roof.geometry.roofPatches[0];
    expect(patch?.boundaryLoop3d).toHaveLength(0);
    expect(r.eligibility.roof3dBuildable).toBe(false);
    expect(r.eligibility.reasons).toContain("INCOMPLETE_PATCH_HEIGHTS");
  });

  it("obstacle ambigu sans hauteur : obstacles3dBuildable false", () => {
    const state = loadFixture("state-ambiguous-obstacle.json");
    const r = parseCalpinageStateToCanonicalHouse3D(state, {});
    expect(r.eligibility.obstacles3dBuildable).toBe(false);
    expect(r.eligibility.reasons).toContain("AMBIGUOUS_OBSTACLE_FAMILIES");
  });

  it("mpp manquant : bloquant, document minimal", () => {
    const state = { ...loadFixture("state-simple-2pans.json"), roof: { scale: {} } };
    const r = parseCalpinageStateToCanonicalHouse3D(state, {});
    expect(r.diagnostics.some((d) => d.code === "MISSING_METERS_PER_PIXEL")).toBe(true);
    expect(r.eligibility.house3dBuildable).toBe(false);
  });

  it("format prod roofState : lit mpp/nord hors ancien chemin state.roof", () => {
    const state = loadFixture("state-simple-2pans.json");
    delete state.roof;
    state.roofState = {
      scale: { metersPerPixel: 0.049 },
      roof: { north: { angleDeg: 0 } },
      canonical3DWorldContract: {
        metersPerPixel: 0.049,
        northAngleDeg: 0,
        referenceFrame: "LOCAL_IMAGE_ENU",
      },
    };
    state.validatedRoofData = {
      scale: { metersPerPixel: 0.049 },
      north: { north: { angleDeg: 0 } },
    };

    const r = parseCalpinageStateToCanonicalHouse3D(state, {});

    expect(r.diagnostics.some((d) => d.code === "MISSING_METERS_PER_PIXEL")).toBe(false);
    expect(r.sourcesUsed).toContain("state.roofState.canonical3DWorldContract.metersPerPixel");
    expect(r.sourcesUsed).toContain("state.roofState.canonical3DWorldContract.northAngleDeg");
    expect(r.eligibility.roof3dBuildable).toBe(true);
  });

  it("provenance hauteurs : chemins contours / ridges traçables", () => {
    const state = loadFixture("state-ridge-and-pans.json");
    const r = parseCalpinageStateToCanonicalHouse3D(state, {});
    const paths = r.provenance.heights.map((h) => h.sourcePath).join(" ");
    expect(paths).toContain("state.contours");
    expect(paths).toContain("state.ridges");
  });

  it("frozenPvBlocks : panneaux parsés, pv3dBuildable", () => {
    const state = loadFixture("state-simple-2pans.json");
    const r = parseCalpinageStateToCanonicalHouse3D(state, {
      frozenPvBlocks: [
        {
          id: "blk1",
          panId: "pan-a",
          rotation: 0,
          panels: [
            { id: "pv1", center: { x: 50, y: 50 }, localRotationDeg: 0 },
          ],
        },
      ],
    });
    expect(r.document.pv?.pvPanels).toHaveLength(1);
    expect(r.eligibility.pv3dBuildable).toBe(true);
  });

  it("placedPanels : diagnostic miroir uniquement", () => {
    const state = {
      ...loadFixture("state-simple-2pans.json"),
      placedPanels: [{ id: "legacy" }],
    };
    const r = parseCalpinageStateToCanonicalHouse3D(state, {});
    expect(r.diagnostics.some((d) => d.code === "PLACED_PANELS_MIRROR_ONLY")).toBe(true);
  });
});
