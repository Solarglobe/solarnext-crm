import { describe, expect, it } from "vitest";
import { getPremiumRoofObstacleSpec, PREMIUM_ROOF_OBSTACLE_CATALOG } from "../roofObstaclePremiumCatalog";
import { getRoofObstacleCatalogEntry } from "../roofObstacleCatalog";

describe("roofObstaclePremiumCatalog", () => {
  it("couvre tous les types premium attendus sans casser le catalogue legacy", () => {
    const expected = [
      "chimney_square",
      "chimney_round",
      "vmc_round",
      "antenna",
      "roof_window",
      "keepout_zone",
      "tree_shadow",
      "parapet",
      "roof_drain",
    ] as const;

    for (const id of expected) {
      expect(PREMIUM_ROOF_OBSTACLE_CATALOG[id]).toBeTruthy();
      expect(getRoofObstacleCatalogEntry(id)).toBeTruthy();
    }
  });

  it("separe bien rendu, geometrie et shading par type", () => {
    const velux = getPremiumRoofObstacleSpec("roof_window")!;
    expect(velux.business.visualRole).toBe("roof_window_flush");
    expect(velux.shading.castsNearShading).toBe(false);
    expect(velux.shading.blocksPvPlacement).toBe(true);
    expect(velux.rendering3d.detailProfile).toBe("roof_window_glass");

    const tree = getPremiumRoofObstacleSpec("tree_shadow")!;
    expect(tree.business.visualRole).toBe("abstract_shadow_volume");
    expect(tree.shading.castsNearShading).toBe(true);
    expect(tree.shading.blocksPvPlacement).toBe(false);
  });

  it("conserve des fallbacks stables pour les anciens IDs", () => {
    expect(getPremiumRoofObstacleSpec("generic_polygon_keepout")?.business.type).toBe("keepout_zone");
    expect(getPremiumRoofObstacleSpec("legacy_shadow_cube")?.business.type).toBe("tree_shadow");
  });
});
