import { describe, it, expect } from "vitest";
import { buildIndex, query, nearestPoint, CELL_SIZE, type Point3D } from "../spatialIndex";
import { PointCloudHeightInterpolator } from "../../../engine/roofGeometryEngine/heightInterpolator";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeGrid(n: number, spacing = 1, zFn: (x: number, y: number) => number = () => 0): Point3D[] {
  const pts: Point3D[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = i * spacing;
      const y = j * spacing;
      pts.push({ x, y, z: zFn(x, y) });
    }
  }
  return pts;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildIndex
// ─────────────────────────────────────────────────────────────────────────────

describe("buildIndex", () => {
  it("retourne un index vide pour un tableau vide", () => {
    const idx = buildIndex([]);
    expect(idx.pointCount).toBe(0);
    expect(idx.cells.size).toBe(0);
    expect(idx.cellSize).toBe(CELL_SIZE);
  });

  it("indexe correctement N points — pointCount cohérent", () => {
    const pts = makeGrid(10, 1); // 100 points
    const idx = buildIndex(pts);
    expect(idx.pointCount).toBe(100);
  });

  it("ignore les points avec coordonnées non-finies", () => {
    const pts: Point3D[] = [
      { x: 0, y: 0, z: 1 },
      { x: NaN, y: 0, z: 1 },
      { x: 0, y: Infinity, z: 1 },
    ];
    const idx = buildIndex(pts);
    expect(idx.pointCount).toBe(1);
  });

  it("regroupe les points dans la même cellule (CELL_SIZE=2m)", () => {
    // Deux points à (0.5, 0.5) et (1.5, 1.5) → même cellule (0:0)
    const pts: Point3D[] = [
      { x: 0.5, y: 0.5, z: 10 },
      { x: 1.5, y: 1.5, z: 20 },
    ];
    const idx = buildIndex(pts);
    expect(idx.cells.size).toBe(1); // une seule cellule
    expect(idx.pointCount).toBe(2);
  });

  it("sépare les points dans des cellules différentes", () => {
    const pts: Point3D[] = [
      { x: 0.5, y: 0.5, z: 0 }, // cellule (0:0)
      { x: 2.5, y: 0.5, z: 0 }, // cellule (1:0)
    ];
    const idx = buildIndex(pts);
    expect(idx.cells.size).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// query
// ─────────────────────────────────────────────────────────────────────────────

describe("query", () => {
  it("retourne tous les points dans le rayon", () => {
    const pts: Point3D[] = [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 2 },
      { x: 5, y: 0, z: 3 }, // hors rayon
    ];
    const idx = buildIndex(pts);
    const res = query(idx, { x: 0, y: 0 }, 2);
    expect(res.length).toBe(2);
    expect(res.map((p) => p.z).sort()).toEqual([1, 2]);
  });

  it("retourne zéro résultat si le rayon ne capture aucun point", () => {
    const pts: Point3D[] = [{ x: 100, y: 100, z: 5 }];
    const idx = buildIndex(pts);
    const res = query(idx, { x: 0, y: 0 }, 1);
    expect(res.length).toBe(0);
  });

  it("inclut les points exactement sur le bord du rayon (≤)", () => {
    const pts: Point3D[] = [{ x: 5, y: 0, z: 99 }];
    const idx = buildIndex(pts);
    const res = query(idx, { x: 0, y: 0 }, 5); // dist = 5 exactement
    expect(res.length).toBe(1);
  });

  it("index vide → tableau vide", () => {
    const idx = buildIndex([]);
    expect(query(idx, { x: 0, y: 0 }, 10)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// nearestPoint
// ─────────────────────────────────────────────────────────────────────────────

describe("nearestPoint", () => {
  it("retourne le point le plus proche", () => {
    const pts: Point3D[] = [
      { x: 10, y: 0, z: 1 },
      { x: 3, y: 0, z: 2 },
      { x: 1, y: 0, z: 3 },
    ];
    const idx = buildIndex(pts);
    const res = nearestPoint(idx, { x: 0, y: 0 });
    expect(res?.z).toBe(3);
  });

  it("retourne null pour index vide", () => {
    expect(nearestPoint(buildIndex([]), { x: 0, y: 0 })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PointCloudHeightInterpolator — unité
// ─────────────────────────────────────────────────────────────────────────────

describe("PointCloudHeightInterpolator", () => {
  it("retourne null si nuage vide", () => {
    const interp = new PointCloudHeightInterpolator([]);
    expect(interp.getHeightAtXY(0, 0)).toBeNull();
    expect(interp.getElevation(0, 0)).toBeNull();
  });

  it("retourne la valeur exacte pour un point coïncident", () => {
    const interp = new PointCloudHeightInterpolator([{ x: 5, y: 5, z: 42 }]);
    expect(interp.getHeightAtXY(5, 5)).toBeCloseTo(42, 10);
  });

  it("IDW : pondération correcte entre deux points équidistants", () => {
    // (0,0,z=10) et (2,0,z=20) — query au milieu (1,0)
    const interp = new PointCloudHeightInterpolator([
      { x: 0, y: 0, z: 10 },
      { x: 2, y: 0, z: 20 },
    ]);
    const h = interp.getHeightAtXY(1, 0, 5);
    // d²=1 pour les deux → w égaux → moyenne = 15
    expect(h).toBeCloseTo(15, 5);
  });

  it("IDW : le point le plus proche pèse davantage", () => {
    const interp = new PointCloudHeightInterpolator([
      { x: 1, y: 0, z: 10 }, // dist=1 → w=1
      { x: 3, y: 0, z: 50 }, // dist=3 → w=1/9
    ]);
    const h = interp.getHeightAtXY(0, 0, 10);
    // h = (10*1 + 50*(1/9)) / (1 + 1/9) = (10 + 5.555...) / 1.111... ≈ 13.99 < 30
    expect(h).not.toBeNull();
    expect(h!).toBeLessThan(30); // proche de 10, pas de 50
  });

  it("fallback nearestPoint si aucun point dans le rayon", () => {
    const interp = new PointCloudHeightInterpolator([{ x: 100, y: 100, z: 7 }]);
    const h = interp.getHeightAtXY(0, 0, 1); // rayon trop petit
    expect(h).toBeCloseTo(7, 10); // fallback → z du seul point
  });

  it("getElevation est un alias de getHeightAtXY", () => {
    const interp = new PointCloudHeightInterpolator([{ x: 0, y: 0, z: 3.14 }]);
    expect(interp.getElevation(0, 0)).toBeCloseTo(interp.getHeightAtXY(0, 0)!, 10);
  });

  it("setPointCloud reconstruit l'index et libère l'ancien", () => {
    const interp = new PointCloudHeightInterpolator([{ x: 0, y: 0, z: 1 }]);
    expect(interp.getHeightAtXY(0, 0)).toBeCloseTo(1, 10);

    interp.setPointCloud([{ x: 0, y: 0, z: 99 }]);
    expect(interp.getHeightAtXY(0, 0)).toBeCloseTo(99, 10);
    expect(interp.pointCount).toBe(1);
  });

  it("setPointCloud([]) reset → retourne null", () => {
    const interp = new PointCloudHeightInterpolator([{ x: 0, y: 0, z: 5 }]);
    interp.setPointCloud([]);
    expect(interp.getHeightAtXY(0, 0)).toBeNull();
    expect(interp.pointCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark : 10 000 points, 1 000 appels < 100ms total
// ─────────────────────────────────────────────────────────────────────────────

describe("benchmark — 10 000 points / 1 000 appels < 100ms", () => {
  it("buildIndex + 1000 getHeightAtXY sur 10k points → < 100ms", () => {
    // Génère 10 000 points en grille 100×100 espacés de 1m, z = x + y
    const N = 100;
    const pts: Point3D[] = [];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        pts.push({ x: i, y: j, z: i + j });
      }
    }
    // Construction de l'index (incluse dans le budget)
    const t0 = performance.now();
    const interp = new PointCloudHeightInterpolator(pts);

    // 1 000 appels répartis sur la grille
    for (let k = 0; k < 1000; k++) {
      const x = (k % N) + 0.5;
      const y = Math.floor(k / N) + 0.5;
      interp.getHeightAtXY(x, y);
    }
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(100); // < 100ms
  });

  it("buildIndex seul sur 10k points → < 50ms", () => {
    const pts = makeGrid(100, 1);
    const t0 = performance.now();
    buildIndex(pts);
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it("1000 query() sur index 10k points → < 20ms", () => {
    const pts = makeGrid(100, 1);
    const idx = buildIndex(pts);
    const t0 = performance.now();
    for (let k = 0; k < 1000; k++) {
      query(idx, { x: 50 + Math.sin(k) * 20, y: 50 + Math.cos(k) * 20 }, 5);
    }
    expect(performance.now() - t0).toBeLessThan(20);
  });
});
