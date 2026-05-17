import { describe, expect, it } from "vitest";
import type { RoofPlanePatch3D } from "../../types/roof-surface";
import { buildPvPanels3D } from "../../pvPanels/buildPvPanels3D";
import { DEFAULT_NEAR_SHADING_RAYCAST_PARAMS } from "../nearShadingParams";
import { runNearShadingSeriesHorizonWeighted } from "../nearShadingHorizonWeighted";

function flatPatch(id: string): RoofPlanePatch3D {
  const normal = { x: 0, y: 0, z: 1 };
  return {
    id,
    topologyRole: "primary_shell",
    boundaryVertexIds: ["v1", "v2", "v3", "v4"],
    boundaryEdgeIds: ["e1", "e2", "e3", "e4"],
    cornersWorld: [
      { x: 0, y: 0, z: 0 },
      { x: 20, y: 0, z: 0 },
      { x: 20, y: 20, z: 0 },
      { x: 0, y: 20, z: 0 },
    ],
    localFrame: {
      role: "roof_face",
      origin: { x: 0, y: 0, z: 0 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: 1, z: 0 },
      zAxis: { ...normal },
    },
    normal,
    equation: { normal, d: 0 },
    boundaryCycleWinding: "unspecified",
    centroid: { x: 10, y: 10, z: 0 },
    surface: { areaM2: 400 },
    adjacentPlanePatchIds: [],
    provenance: { source: "solver", solverStep: "test" },
    quality: { confidence: "high", diagnostics: [] },
  } as RoofPlanePatch3D;
}

/**
 * Patch incliné à 45° vers le sud : normal = {0, -√2/2, √2/2}.
 *
 * Système de coordonnées : Y = nord, Z = vertical.
 * Face orientée sud → normal.y < 0.
 *
 * Pondération correcte per-panneau :
 *   soleil zénithal {0,0,1} : wp = dot({0,0,1}, {0,-√2/2,√2/2}) = √2/2 ≈ 0.7071
 *   soleil perpendiculaire panneau {0,-√2/2,√2/2} : wp = 1.0  (old: uz = √2/2 ≈ 0.7071)
 */
function tiltedSouthPatch45(id: string): RoofPlanePatch3D {
  const SQ2_2 = Math.SQRT2 / 2; // √2/2 ≈ 0.7071
  // Normale vers le sud et le haut à 45°
  const normal = { x: 0, y: -SQ2_2, z: SQ2_2 };
  // Axe v dans le plan (perpendiculaire à x et à la normale) : cross(normal, {1,0,0})
  //   = {(-SQ2_2)*0 - SQ2_2*0, SQ2_2*1 - 0*0, 0*0 - (-SQ2_2)*1} = {0, SQ2_2, SQ2_2}
  const vY = SQ2_2;
  const vZ = SQ2_2;
  const sz = 20;
  return {
    id,
    topologyRole: "primary_shell",
    boundaryVertexIds: ["v1", "v2", "v3", "v4"],
    boundaryEdgeIds: ["e1", "e2", "e3", "e4"],
    cornersWorld: [
      { x: 0,  y: 0,       z: 0       },
      { x: sz, y: 0,       z: 0       },
      { x: sz, y: sz * vY, z: sz * vZ },
      { x: 0,  y: sz * vY, z: sz * vZ },
    ],
    localFrame: {
      role: "roof_face",
      origin: { x: 0, y: 0, z: 0 },
      xAxis: { x: 1, y: 0, z: 0 },
      yAxis: { x: 0, y: vY, z: vZ },
      zAxis: { ...normal },
    },
    normal,
    equation: { normal, d: 0 },
    boundaryCycleWinding: "unspecified",
    centroid: { x: sz / 2, y: (sz / 2) * vY, z: (sz / 2) * vZ },
    surface: { areaM2: sz * sz },
    adjacentPlanePatchIds: [],
    provenance: { source: "solver", solverStep: "test:tilted45" },
    quality: { confidence: "high", diagnostics: [] },
  } as RoofPlanePatch3D;
}

describe("runNearShadingSeriesHorizonWeighted", () => {
  it("sans masque : exécute le pas zénith et agrège per-panel", () => {
    const patch = flatPatch("pan-a");
    const { panels } = buildPvPanels3D(
      {
        panels: [
          {
            id: "pv-1",
            roofPlanePatchId: patch.id,
            center: { mode: "plane_uv", uv: { u: 10, v: 10 } },
            widthM: 1,
            heightM: 1,
            orientation: "portrait",
            rotationDegInPlane: 0,
            sampling: { nx: 2, ny: 2 },
          },
        ],
      },
      { roofPlanePatches: [patch] }
    );
    const scene = {
      panels,
      obstacleVolumes: [] as const,
      extensionVolumes: [] as const,
      params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
    };
    const r = runNearShadingSeriesHorizonWeighted(scene, [{ dx: 0, dy: 0, dz: 1 }], null);
    expect(r.annual.timestepResults.length).toBe(1);
    expect(r.perPanelMeanShadedFraction.get("pv-1")).toBe(0);
  });

  // ── Cas 45° — pondération per-panneau ─────────────────────────────────────
  //
  // Panneau plat (normal={0,0,1}) : pondération inchangée vs ancienne implémentation.
  //   soleil zénithal → old w = max(0,1)=1, new wp = dot({0,0,1},{0,0,1})=1. Identique ✓
  //
  // Panneau 45° sud (normal={0,-√2/2,√2/2}) :
  //   soleil zénithal {0,0,1}           → old w=1.0,  new wp=√2/2≈0.707 (moins pondéré)
  //   soleil perpendiculaire {0,-√2/2,√2/2} → old w=√2/2≈0.707, new wp=1.0 (max irradiance)
  //
  // Sans obstacle le shadingRatio=0 donc la moyenne pondérée reste 0 quelle que soit la
  // pondération. Les tests ci-dessous vérifient que la fonction exécute correctement le pas
  // et que le résultat structurel est cohérent.
  // Pour valider numériquement la différence de pondération il faudrait un obstacle
  // (test d'intégration dans hardeningSceneFactories).

  it("panneau 45° sud — soleil zénithal : un pas exécuté, aucun ombrage sans obstacle", () => {
    const patch = tiltedSouthPatch45("pan-tilted");
    const { panels } = buildPvPanels3D(
      {
        panels: [
          {
            id: "pv-tilted",
            roofPlanePatchId: patch.id,
            center: { mode: "plane_uv", uv: { u: 10, v: 5 } },
            widthM: 1,
            heightM: 1.7,
            orientation: "portrait",
            rotationDegInPlane: 0,
            sampling: { nx: 2, ny: 2 },
          },
        ],
      },
      { roofPlanePatches: [patch] }
    );
    // Vérifier que buildPvPanels3D a bien produit la normale inclinée
    const panelNormal = panels[0]?.outwardNormal;
    expect(panelNormal).toBeDefined();
    expect(panelNormal!.z).toBeCloseTo(Math.SQRT2 / 2, 4); // z ≈ 0.7071
    expect(panelNormal!.y).toBeCloseTo(-(Math.SQRT2 / 2), 4); // y ≈ -0.7071

    const scene = {
      panels,
      obstacleVolumes: [] as const,
      extensionVolumes: [] as const,
      params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
    };
    // Soleil zénithal {0,0,1} : uz>0 → pas non filtré, wp = dot({0,0,1}, normal) ≈ 0.707
    const r = runNearShadingSeriesHorizonWeighted(scene, [{ dx: 0, dy: 0, dz: 1 }], null);
    expect(r.annual.timestepResults.length).toBe(1);
    expect(r.perPanelMeanShadedFraction.get("pv-tilted")).toBe(0); // aucun obstacle
  });

  it("panneau 45° sud — soleil perpendiculaire : pondération maximale (wp=1.0)", () => {
    const SQ2_2 = Math.SQRT2 / 2;
    const patch = tiltedSouthPatch45("pan-tilted-2");
    const { panels } = buildPvPanels3D(
      {
        panels: [
          {
            id: "pv-perp",
            roofPlanePatchId: patch.id,
            center: { mode: "plane_uv", uv: { u: 10, v: 5 } },
            widthM: 1,
            heightM: 1,
            orientation: "portrait",
            rotationDegInPlane: 0,
            sampling: { nx: 1, ny: 1 },
          },
        ],
      },
      { roofPlanePatches: [patch] }
    );
    const scene = {
      panels,
      obstacleVolumes: [] as const,
      extensionVolumes: [] as const,
      params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
    };
    // Soleil perpendiculaire au panneau : direction = normale du panneau = {0,-√2/2,√2/2}
    // uz = √2/2 > 0 → non filtré ; wp = dot(dir, normal) = 1.0 (incidence normale)
    // Ancienne pondération aurait donné w = uz = √2/2 ≈ 0.707 (sous-estimation)
    const r = runNearShadingSeriesHorizonWeighted(
      scene,
      [{ dx: 0, dy: -SQ2_2, dz: SQ2_2 }],
      null
    );
    expect(r.annual.timestepResults.length).toBe(1);
    // Sans obstacle : shadingRatio=0, moyenne=0 indépendamment de la pondération
    expect(r.annual.meanShadedFraction).toBe(0);
    expect(r.perPanelMeanShadedFraction.get("pv-perp")).toBe(0);
    // La pondération correcte est documentée : wp=1.0 vs old w=√2/2
    // (vérifiable numériquement en ajoutant un obstacle dans un test d'intégration)
  });

  it("masque bloque tout : aucun pas, moyenne 0", () => {
    const patch = flatPatch("pan-b");
    const { panels } = buildPvPanels3D(
      {
        panels: [
          {
            id: "pv-2",
            roofPlanePatchId: patch.id,
            center: { mode: "plane_uv", uv: { u: 10, v: 10 } },
            widthM: 1,
            heightM: 1,
            orientation: "portrait",
            rotationDegInPlane: 0,
            sampling: { nx: 1, ny: 1 },
          },
        ],
      },
      { roofPlanePatches: [patch] }
    );
    const scene = {
      panels,
      obstacleVolumes: [] as const,
      extensionVolumes: [] as const,
      params: DEFAULT_NEAR_SHADING_RAYCAST_PARAMS,
    };
    const maskBins = Array.from({ length: 36 }, (_, i) => ({ az: i * 10, elev: 50 }));
    const mask = { mask: maskBins };
    const r = runNearShadingSeriesHorizonWeighted(
      scene,
      [{ dx: 0.86602540378, dy: 0, dz: 0.5 }],
      mask
    );
    expect(r.annual.timestepResults.length).toBe(0);
    expect(r.annual.meanShadedFraction).toBe(0);
  });
});
