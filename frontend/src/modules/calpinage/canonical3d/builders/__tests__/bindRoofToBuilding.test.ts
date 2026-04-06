import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import type { CanonicalHouseDocument } from "../../model/canonicalHouse3DModel";
import { bindRoofToBuilding } from "../bindRoofToBuilding";
import { buildBuildingShell3D } from "../buildBuildingShell3D";
import { buildRoofTopology } from "../buildRoofTopology";
import { computeRoofPlaneIntersections } from "../computeRoofPlaneIntersections";
import { solveRoofPlanes } from "../solveRoofPlanes";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): CanonicalHouseDocument {
  const raw = readFileSync(join(__dirname, "../dev", name), "utf-8");
  return JSON.parse(raw) as CanonicalHouseDocument;
}

function fullPipeline(doc: CanonicalHouseDocument) {
  const { shell } = buildBuildingShell3D({ document: doc });
  const { graph } = buildRoofTopology(doc);
  const { solutionSet } = solveRoofPlanes({ document: doc, topologyGraph: graph });
  const { intersectionSet } = computeRoofPlaneIntersections({ document: doc, topologyGraph: graph, solutionSet });
  if (!shell) throw new Error("shell null");
  return { shell, graph, solutionSet, intersectionSet };
}

describe("bindRoofToBuilding", () => {
  it("maison simple : eaves alignées au haut de mur, toiture attachée", () => {
    const doc = loadFixture("binding-simple-aligned.json");
    const { shell, graph, solutionSet, intersectionSet } = fullPipeline(doc);
    const { binding } = bindRoofToBuilding({ shell, topologyGraph: graph, solutionSet, intersectionSet });
    expect(binding.diagnostics.structuralProof.eaveEdgeCount).toBe(4);
    expect(binding.diagnostics.structuralProof.correctlyAttachedEaveCount).toBe(4);
    expect(binding.diagnostics.misalignedEdgeCount).toBe(0);
    expect(binding.diagnostics.floatingEdgeCount).toBe(0);
    expect(binding.diagnostics.roofAttachedToBuilding).toBe(true);
    expect(binding.diagnostics.isValid).toBe(true);
    for (const eb of binding.eaveBindings) {
      expect(eb.isSnappedToWallTop).toBe(true);
      expect(eb.verticalOffsetM).not.toBeNull();
      expect(Math.abs(eb.verticalOffsetM!)).toBeLessThanOrEqual(0.02);
      expect(eb.attachedWallSegmentId).toMatch(/^shell-ts-/);
      expect(eb.alignedSegment3D).not.toBeNull();
    }
  });

  it("débord de gouttière : détection outwardOverhangM et intention probable", () => {
    const doc = loadFixture("binding-overhang-eave.json");
    const { shell, graph, solutionSet, intersectionSet } = fullPipeline(doc);
    const { binding } = bindRoofToBuilding({ shell, topologyGraph: graph, solutionSet, intersectionSet });
    const south = binding.eaveBindings.find((e) => {
      const s = e.roofEdgeSegment3D;
      if (!s) return false;
      const y0 = s[0].y;
      const y1 = s[1].y;
      return Math.abs(y0 - y1) < 1e-6 && y0 < -0.2;
    });
    expect(south).toBeDefined();
    expect(south!.outwardOverhangM).toBeGreaterThan(0.35);
    const oh = binding.overhangs.find((o) => o.topologyEdgeId === south!.topologyEdgeId);
    expect(oh?.isIntentional).toBe("likely_intentional");
    expect(binding.diagnostics.structuralProof.overhangDetectionCount).toBeGreaterThan(0);
  });

  it("maison mal alignée en Z : misalignedEdgeCount > 0, pas attachée", () => {
    const doc = loadFixture("binding-misaligned-z.json");
    const { shell, graph, solutionSet, intersectionSet } = fullPipeline(doc);
    const { binding } = bindRoofToBuilding({ shell, topologyGraph: graph, solutionSet, intersectionSet });
    expect(binding.diagnostics.misalignedEdgeCount).toBeGreaterThan(0);
    expect(binding.diagnostics.roofAttachedToBuilding).toBe(false);
    expect(binding.diagnostics.bindingConsistencyLevel).toBe("partial");
  });

  it("pignons typés gable : fermeture cohérente sur murs x=0 et x=20", () => {
    const doc = loadFixture("binding-gable-flat.json");
    const { shell, graph, solutionSet, intersectionSet } = fullPipeline(doc);
    const { binding } = bindRoofToBuilding({ shell, topologyGraph: graph, solutionSet, intersectionSet });
    expect(binding.gableBindings.length).toBe(2);
    for (const g of binding.gableBindings) {
      expect(g.isWallClosureGeometricallyConsistent).toBe(true);
      expect(g.minZOffsetFromWallTopM).not.toBeNull();
      expect(Math.abs(g.minZOffsetFromWallTopM!)).toBeLessThanOrEqual(0.02);
    }
    expect(binding.diagnostics.roofAttachedToBuilding).toBe(true);
  });

  it("cas ambigu (diagnostic intersections) : niveau ambiguous si sewingLevel forcé", () => {
    const doc = loadFixture("binding-simple-aligned.json");
    const { shell, graph, solutionSet, intersectionSet } = fullPipeline(doc);
    const patched = {
      ...intersectionSet,
      diagnostics: {
        ...intersectionSet.diagnostics,
        sewingLevel: "ambiguous" as const,
      },
    };
    const { binding } = bindRoofToBuilding({ shell, topologyGraph: graph, solutionSet, intersectionSet: patched });
    expect(binding.diagnostics.bindingConsistencyLevel).toBe("ambiguous");
  });

  it("preuve structurelle : compteurs exposés", () => {
    const doc = loadFixture("binding-simple-aligned.json");
    const { shell, graph, solutionSet, intersectionSet } = fullPipeline(doc);
    const { binding } = bindRoofToBuilding({ shell, topologyGraph: graph, solutionSet, intersectionSet });
    const p = binding.diagnostics.structuralProof;
    expect(p.eaveEdgeCount).toBe(4);
    expect(p.correctlyAttachedEaveCount).toBeLessThanOrEqual(p.eaveEdgeCount);
    expect(p.floatingEaveCount).toBe(0);
    expect(typeof p.gableEdgeCount).toBe("number");
    expect(binding.diagnostics.intersectionCrossCheckSummary.entries.length).toBe(intersectionSet.intersections.length);
  });
});
