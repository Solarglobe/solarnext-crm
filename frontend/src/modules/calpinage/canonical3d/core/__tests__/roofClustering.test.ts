import { describe, it, expect } from "vitest";
import { clusterRoofPlanes, filterTinyFaces, type RoofCluster } from "../roofClustering";
import type { RoofPlanePatch3D } from "../../types/roof-surface";

// ─────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crée un RoofPlanePatch3D minimal pour les tests.
 *
 * Convention normale : pan face sud incliné à `tiltDeg` de l'horizontale.
 *   normal = { x: 0, y: -sin(tiltDeg), z: cos(tiltDeg) }   (unitaire ✓)
 *
 * Angle entre deux tels pans = |tilt1 - tilt2| (dot = cos(|θ1-θ2|)).
 */
function makePan(id: string, tiltDeg: number, projectedAreaM2 = 10): RoofPlanePatch3D {
  const rad = (tiltDeg * Math.PI) / 180;
  const normal = { x: 0, y: -Math.sin(rad), z: Math.cos(rad) };
  return {
    id,
    topologyRole: "primary_shell",
    boundaryVertexIds: [],
    boundaryEdgeIds: [],
    cornersWorld: [],
    localFrame: {
      role: "roof_face",
      origin: { x: 0, y: 0, z: 0 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: normal,
    },
    normal,
    equation: { normal, d: 0 },
    boundaryCycleWinding: "unspecified",
    centroid: { x: 0, y: 0, z: 0 },
    surface: {
      areaM2: projectedAreaM2 / Math.cos(rad),
      projectedHorizontalAreaM2: projectedAreaM2,
    },
    adjacentPlanePatchIds: [],
    provenance: { source: "solver", solverStep: "test" },
    quality: { confidence: "high", diagnostics: [] },
  } as RoofPlanePatch3D;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cas nominal du brief : 3 plans 5°/12°/25° avec ε=8° → 2 clusters
// ─────────────────────────────────────────────────────────────────────────────

describe("clusterRoofPlanes — cas du brief", () => {
  //  Pan A : tilt 5°
  //  Pan B : tilt 12°  — |5 - 12| = 7° < 8° → même cluster que A
  //  Pan C : tilt 25°  — |5 - 25| = 20° > 8° → nouveau cluster
  //           (vs représentant A à 5°)

  it("3 plans 5°/12°/25° avec ε=8° → 2 clusters", () => {
    const planes = [makePan("A", 5), makePan("B", 12), makePan("C", 25)];
    const clusters = clusterRoofPlanes(planes, { clusterEpsilonDeg: 8 });
    expect(clusters).toHaveLength(2);
  });

  it("cluster 1 contient les plans 5° et 12°", () => {
    const panA = makePan("A", 5);
    const panB = makePan("B", 12);
    const panC = makePan("C", 25);
    const clusters = clusterRoofPlanes([panA, panB, panC], { clusterEpsilonDeg: 8 });
    // Le plus grand cluster en surface (A+B = 20m², C = 10m²) est en premier
    const bigCluster = clusters[0]!;
    expect(bigCluster.planes.map((p) => p.id).sort()).toEqual(["A", "B"]);
  });

  it("cluster 2 contient uniquement le plan 25°", () => {
    const clusters = clusterRoofPlanes(
      [makePan("A", 5), makePan("B", 12), makePan("C", 25)],
      { clusterEpsilonDeg: 8 },
    );
    const smallCluster = clusters[1]!;
    expect(smallCluster.planes.map((p) => p.id)).toEqual(["C"]);
  });

  it("totalProjectedAreaM2 correct pour chaque cluster", () => {
    const clusters = clusterRoofPlanes(
      [makePan("A", 5, 6), makePan("B", 12, 4), makePan("C", 25, 9)],
      { clusterEpsilonDeg: 8 },
    );
    const areas = clusters.map((c) => c.totalProjectedAreaM2).sort((a, b) => b - a);
    expect(areas[0]).toBeCloseTo(10, 5); // A(6) + B(4)
    expect(areas[1]).toBeCloseTo(9, 5);  // C(9)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Seuil exact : ε inclus (≤)
// ─────────────────────────────────────────────────────────────────────────────

describe("clusterRoofPlanes — seuil exact", () => {
  it("angle exactement égal à ε → même cluster (≤)", () => {
    // Deux pans séparés de exactement 8° → doivent être dans le même cluster
    const clusters = clusterRoofPlanes(
      [makePan("X", 10), makePan("Y", 18)],
      { clusterEpsilonDeg: 8 },
    );
    expect(clusters).toHaveLength(1);
  });

  it("angle légèrement > ε → clusters séparés", () => {
    const clusters = clusterRoofPlanes(
      [makePan("X", 10), makePan("Y", 18.1)],
      { clusterEpsilonDeg: 8 },
    );
    expect(clusters).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cas limites
// ─────────────────────────────────────────────────────────────────────────────

describe("clusterRoofPlanes — cas limites", () => {
  it("tableau vide → aucun cluster", () => {
    expect(clusterRoofPlanes([])).toHaveLength(0);
  });

  it("un seul plan → un cluster", () => {
    const clusters = clusterRoofPlanes([makePan("solo", 30)]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.planes).toHaveLength(1);
  });

  it("ignore les plans avec normales non-finies", () => {
    const badPan = makePan("bad", 30);
    const patchedBad = { ...badPan, normal: { x: NaN, y: 0, z: 1 } } as RoofPlanePatch3D;
    const goodPan = makePan("good", 30);
    const clusters = clusterRoofPlanes([patchedBad, goodPan]);
    // Seul goodPan doit apparaître
    expect(clusters.flatMap((c) => c.planes).map((p) => p.id)).toEqual(["good"]);
  });

  it("clusters triés par surface décroissante", () => {
    const planes = [
      makePan("small", 50, 1),   // cluster B — 1m²
      makePan("large", 10, 100), // cluster A — 100m²
    ];
    const clusters = clusterRoofPlanes(planes, { clusterEpsilonDeg: 5 });
    expect(clusters[0]!.totalProjectedAreaM2).toBeGreaterThan(clusters[1]!.totalProjectedAreaM2);
  });

  it("ε=0 → chaque plan dans son propre cluster (sauf normales identiques)", () => {
    const planes = [makePan("A", 10), makePan("B", 20), makePan("C", 30)];
    const clusters = clusterRoofPlanes(planes, { clusterEpsilonDeg: 0 });
    expect(clusters).toHaveLength(3);
  });

  it("ε=180 → tous les plans dans un seul cluster", () => {
    const planes = [makePan("A", 0), makePan("B", 45), makePan("C", 89)];
    const clusters = clusterRoofPlanes(planes, { clusterEpsilonDeg: 180 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.planes).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// filterTinyFaces
// ─────────────────────────────────────────────────────────────────────────────

describe("filterTinyFaces", () => {
  function makeCluster(areas: number[]): RoofCluster {
    const planes = areas.map((a, i) => makePan(`p${i}`, 30, a));
    return {
      planes,
      representativeNormal: planes[0]!.normal,
      totalProjectedAreaM2: areas.reduce((s, a) => s + a, 0),
    };
  }

  it("filtre les plans sous le seuil 0.5 m²", () => {
    const cluster = makeCluster([10, 0.3, 5]);
    const [filtered] = filterTinyFaces([cluster], 0.5);
    expect(filtered!.planes).toHaveLength(2); // 0.3m² éliminé
    expect(filtered!.planes.map((p) => p.id).sort()).toEqual(["p0", "p2"]);
  });

  it("recalcule totalProjectedAreaM2 après filtrage", () => {
    const cluster = makeCluster([8, 0.4, 3]);
    const [filtered] = filterTinyFaces([cluster], 0.5);
    expect(filtered!.totalProjectedAreaM2).toBeCloseTo(11, 5); // 8+3
  });

  it("supprime entièrement un cluster si tous ses plans sont trop petits", () => {
    const tinyCluster = makeCluster([0.1, 0.2]);
    const bigCluster = makeCluster([10]);
    const result = filterTinyFaces([tinyCluster, bigCluster], 0.5);
    expect(result).toHaveLength(1);
    expect(result[0]!.totalProjectedAreaM2).toBeCloseTo(10, 5);
  });

  it("conserve les plans exactement au seuil (≥)", () => {
    const cluster = makeCluster([0.5, 0.49]);
    const [filtered] = filterTinyFaces([cluster], 0.5);
    expect(filtered!.planes).toHaveLength(1); // 0.49 éliminé, 0.5 conservé
  });

  it("tableau vide → tableau vide", () => {
    expect(filterTinyFaces([])).toHaveLength(0);
  });

  it("seuil 0 → conserve tout", () => {
    const cluster = makeCluster([0.01, 0.001]);
    expect(filterTinyFaces([cluster], 0)).toHaveLength(1);
    expect(filterTinyFaces([cluster], 0)[0]!.planes).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline complet : cluster + filter
// ─────────────────────────────────────────────────────────────────────────────

describe("pipeline clusterRoofPlanes + filterTinyFaces", () => {
  it("ε=8°, 5 plans (dont 2 micro) → 2 clusters propres", () => {
    const planes = [
      makePan("A", 5, 10),
      makePan("B", 12, 8),
      makePan("C", 25, 6),
      makePan("micro1", 6, 0.2),  // micro — doit être filtré
      makePan("micro2", 26, 0.1), // micro — doit être filtré
    ];
    const clusters = clusterRoofPlanes(planes, { clusterEpsilonDeg: 8 });
    const cleaned = filterTinyFaces(clusters, 0.5);

    expect(cleaned).toHaveLength(2);
    const ids = cleaned.flatMap((c) => c.planes.map((p) => p.id)).sort();
    expect(ids).toEqual(["A", "B", "C"]); // micro1 et micro2 filtrés
  });
});
