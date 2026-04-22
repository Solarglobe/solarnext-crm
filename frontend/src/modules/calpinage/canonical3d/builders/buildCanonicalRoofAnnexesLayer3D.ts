/**
 * Orchestrateur officiel — couche roofAnnexes (binding + volumes 3D).
 * À enchaîner après buildRoofTopology + solveRoofPlanes (et idéalement intersections + bindRoofToBuilding).
 */

import type { CanonicalHouseDocument, RoofAnnexesCanonicalBlock } from "../model/canonicalHouse3DModel";
import { ROOF_ANNEXES_CANONICAL_SCHEMA_ID } from "../model/canonicalHouse3DModel";
import type { RoofTopologyGraph } from "../model/roofTopologyModel";
import type { RoofPlaneSolutionSet } from "../model/roofPlaneSolutionModel";
import { bindRoofAnnexesToRoofPatches } from "./bindRoofAnnexesToRoofPatches";
import { buildRoofAnnexVolumes3D } from "./buildRoofAnnexVolumes3D";

export interface BuildCanonicalRoofAnnexesLayer3DInput {
  readonly document: CanonicalHouseDocument;
  readonly topologyGraph: RoofTopologyGraph;
  readonly solutionSet: RoofPlaneSolutionSet;
}

export function buildCanonicalRoofAnnexesLayer3D(
  input: BuildCanonicalRoofAnnexesLayer3DInput,
): RoofAnnexesCanonicalBlock {
  const { document, topologyGraph, solutionSet } = input;
  const { items: bindingItems } = bindRoofAnnexesToRoofPatches({
    document,
    topologyGraph,
    solutionSet,
  });
  const items = buildRoofAnnexVolumes3D({ document, bindingItems, solutionSet });

  const boundCount = items.filter(
    (x) =>
      x.roofPatchId &&
      x.bindingStatus !== "outside_all_patches" &&
      x.bindingStatus !== "degenerate_footprint" &&
      x.bindingStatus !== "no_footprint_geometry" &&
      x.bindingStatus !== "ambiguous_patch_choice",
  ).length;

  const volumeBuiltCount = items.filter(
    (x) =>
      x.geometryStatus === "volume_ok" ||
      (x.geometryStatus === "opening_footprint_only" && x.footprint3D && x.footprint3D.length >= 3),
  ).length;

  const errors: string[] = [];
  const warnings: string[] = [];
  for (const it of items) {
    if (it.bindingStatus === "ambiguous_patch_choice") {
      warnings.push(`${it.annexId}: choix de pan ambigu.`);
    }
    if (it.geometryStatus === "height_missing" && it.annexFamily === "roof_obstacle_solid") {
      warnings.push(`${it.annexId}: obstacle sans hauteur pour volume 3D.`);
    }
    if (it.topologyCompatibility === "needs_roof_split") {
      warnings.push(`${it.annexId}: emprise multi-pans — découpe toit future requise.`);
    }
  }

  return {
    schemaId: ROOF_ANNEXES_CANONICAL_SCHEMA_ID,
    items,
    diagnostics: {
      annexCount: document.annexes.length,
      boundCount,
      volumeBuiltCount,
      errors,
      warnings,
    },
  };
}

/**
 * Retourne une copie du document avec `roofAnnexes` renseigné (sans muter l’entrée).
 */
export function attachRoofAnnexesLayerToCanonicalDocument(
  document: CanonicalHouseDocument,
  topologyGraph: RoofTopologyGraph,
  solutionSet: RoofPlaneSolutionSet,
): CanonicalHouseDocument {
  const roofAnnexes = buildCanonicalRoofAnnexesLayer3D({ document, topologyGraph, solutionSet });
  return { ...document, roofAnnexes };
}
