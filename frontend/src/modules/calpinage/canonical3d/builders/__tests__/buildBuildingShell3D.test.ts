import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import type { CanonicalHouseDocument } from "../../model/canonicalHouse3DModel";
import { buildBuildingShell3D } from "../buildBuildingShell3D";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): CanonicalHouseDocument {
  const raw = readFileSync(join(__dirname, "../dev", name), "utf-8");
  return JSON.parse(raw) as CanonicalHouseDocument;
}

describe("buildBuildingShell3D", () => {
  it("rectangle CCW : 4 sommets bas/haut, 4 murs, coque latérale fermée", () => {
    const doc = loadFixture("fixture-rectangle-ccw.json");
    const { shell, diagnostics } = buildBuildingShell3D({ document: doc });
    expect(shell).not.toBeNull();
    expect(diagnostics.isValid).toBe(true);
    expect(diagnostics.isClosedLateralShell).toBe(true);
    expect(diagnostics.bottomVertexCount).toBe(4);
    expect(diagnostics.topVertexCount).toBe(4);
    expect(diagnostics.wallCount).toBe(4);
    expect(diagnostics.wallCount).toBe(diagnostics.bottomVertexCount);
    expect(diagnostics.normalsConsistent).toBe(true);
    expect(diagnostics.heightUsed).toBe(3);
    expect(diagnostics.lateralSurfaceAreaM2).toBeCloseTo(diagnostics.perimeterM * 3);
    const expectedPerimeter = 12 + 8 + 12 + 8;
    expect(diagnostics.perimeterM).toBeCloseTo(expectedPerimeter);
  });

  it("polygone L : 6 murs = 6 segments", () => {
    const doc = loadFixture("fixture-l-shape.json");
    const { shell, diagnostics } = buildBuildingShell3D({ document: doc });
    expect(shell).not.toBeNull();
    expect(diagnostics.wallCount).toBe(6);
    expect(diagnostics.bottomVertexCount).toBe(6);
    expect(shell!.wallFaces).toHaveLength(6);
  });

  it("winding horaire : warning + shell valide + normales cohérentes", () => {
    const doc = loadFixture("fixture-cw-winding.json");
    const { shell, diagnostics } = buildBuildingShell3D({ document: doc });
    expect(shell).not.toBeNull();
    expect(diagnostics.windingDetected).toBe("cw");
    expect(diagnostics.warnings.some((w) => w.includes("WINDING_INPUT_CLOCKWISE"))).toBe(true);
    expect(diagnostics.normalsConsistent).toBe(true);
    expect(diagnostics.wallCount).toBe(4);
  });

  it("footprint invalide / aire dégénérée : shell null", () => {
    const doc = loadFixture("fixture-invalid-footprint.json");
    const { shell, diagnostics } = buildBuildingShell3D({ document: doc });
    expect(shell).toBeNull();
    expect(diagnostics.isValid).toBe(false);
    expect(diagnostics.errors.some((e) => e.includes("DEGENERATE_AREA") || e.includes("FOOTPRINT_DEGENERATE"))).toBe(true);
  });

  it("hauteur absente : BUILDING_WALL_HEIGHT_MISSING", () => {
    const doc = loadFixture("fixture-rectangle-ccw.json");
    const d = structuredClone(doc) as CanonicalHouseDocument;
    delete (d.building as { wallHeightM?: number }).wallHeightM;
    const { shell, diagnostics } = buildBuildingShell3D({ document: d });
    expect(shell).toBeNull();
    expect(diagnostics.errors.some((e) => e.includes("BUILDING_WALL_HEIGHT_MISSING"))).toBe(true);
  });

  it("hauteur nulle (topZ = baseZ) : rejet", () => {
    const doc = loadFixture("fixture-rectangle-ccw.json");
    const { shell, diagnostics } = buildBuildingShell3D({ document: doc, wallHeightM: 0 });
    expect(shell).toBeNull();
    expect(diagnostics.errors.some((e) => e.includes("NON_POSITIVE"))).toBe(true);
  });

  it("zWallTop prioritaire sur wallHeightM", () => {
    const doc = loadFixture("fixture-rectangle-ccw.json");
    const { shell } = buildBuildingShell3D({ document: doc, zWallTop: 7, wallHeightM: 1 });
    expect(shell!.topZ).toBe(7);
    expect(shell!.provenance.heightSource).toBe("input.zWallTop");
    expect(shell!.wallFaces[0]!.heightM).toBe(7);
  });

  it("preuve géométrique : XY bas = XY haut, seul Z diffère", () => {
    const doc = loadFixture("fixture-rectangle-ccw.json");
    const { shell } = buildBuildingShell3D({ document: doc });
    const n = shell!.bottomRing.vertices.length;
    for (let i = 0; i < n; i++) {
      const b = shell!.bottomRing.vertices[i]!.position;
      const t = shell!.topRing.vertices[i]!.position;
      expect(t.x).toBeCloseTo(b.x);
      expect(t.y).toBeCloseTo(b.y);
      expect(t.z).toBeCloseTo(b.z + 3);
    }
  });

  it("preuve : chaque mur a la hauteur attendue et longueur > 0", () => {
    const doc = loadFixture("fixture-rectangle-ccw.json");
    const { shell } = buildBuildingShell3D({ document: doc });
    for (const w of shell!.wallFaces) {
      expect(w.heightM).toBeCloseTo(3);
      expect(w.lengthM).toBeGreaterThan(1e-5);
    }
  });

  it("correspondance segment footprint ↔ mur (indices)", () => {
    const doc = loadFixture("fixture-rectangle-ccw.json");
    const { shell } = buildBuildingShell3D({ document: doc });
    for (const w of shell!.wallFaces) {
      expect(w.segmentIndex).toBeGreaterThanOrEqual(0);
      expect(w.segmentIndex).toBeLessThan(shell!.bottomRing.vertices.length);
    }
  });

  it("doublons consécutifs : dégénérescence comptée, rectangle valide si nettoyé", () => {
    const doc = loadFixture("fixture-rectangle-ccw.json");
    const d = structuredClone(doc) as CanonicalHouseDocument;
    d.building = {
      ...d.building,
      buildingFootprint: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    };
    const { shell, diagnostics } = buildBuildingShell3D({ document: d });
    expect(diagnostics.degenerateSegmentCount).toBeGreaterThanOrEqual(1);
    expect(shell).not.toBeNull();
    expect(diagnostics.wallCount).toBe(4);
  });

  it("footprint replié → moins de 3 sommets après nettoyage : rejet", () => {
    const doc = loadFixture("fixture-rectangle-ccw.json");
    const d = structuredClone(doc) as CanonicalHouseDocument;
    d.building = {
      ...d.building,
      buildingFootprint: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 0 },
        { x: 0, y: 0 },
      ],
    };
    const { shell, diagnostics } = buildBuildingShell3D({ document: d });
    expect(shell).toBeNull();
    expect(diagnostics.errors.some((e) => e.includes("FOOTPRINT_NOT_EXPLOITABLE"))).toBe(true);
  });
});
