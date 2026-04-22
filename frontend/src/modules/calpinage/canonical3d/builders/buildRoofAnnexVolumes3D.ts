/**
 * Construction géométrie 3D annexes toiture à partir du binding + plans résolus.
 * Base Z : évaluation sur le plan du pan (evaluateZOnRoofPlane) — pas getHeightAtXY métier.
 */

import type {
  BuildingLocalVec3,
  CanonicalHouseDocument,
  CanonicalRoofAnnexItem,
  RoofAnnexBaseReference,
  RoofAnnexGeometryStatus,
  RoofAnnexHeightInfo,
} from "../model/canonicalHouse3DModel";
import type { RoofPlaneSolutionSet } from "../model/roofPlaneSolutionModel";
import { evaluateZOnRoofPlane } from "./solveRoofPlanes";
import type { RoofAnnexBindingWorkItem } from "./bindRoofAnnexesToRoofPatches";
import type { Ring2D } from "./roofAnnexPolygon2d";

function quantityValueM(doc: CanonicalHouseDocument, id: string): number | null {
  if (doc.heightModel.zBase.id === id) return doc.heightModel.zBase.valueM;
  const q = doc.heightModel.quantities.find((x) => x.id === id);
  return q ? q.valueM : null;
}

function resolveHeightM(
  doc: CanonicalHouseDocument,
  work: RoofAnnexBindingWorkItem,
): { heightM: number | null; notes?: string } {
  if (work.annex.geometry.kind !== "footprint_extrusion") {
    return { heightM: null, notes: "Pas d’extrusion footprint." };
  }
  const zB = quantityValueM(doc, work.annex.geometry.zBottomId);
  const zT = quantityValueM(doc, work.annex.geometry.zTopId);
  if (zB === null || zT === null) {
    return { heightM: null, notes: "Hauteur bottom/top introuvable dans heightModel." };
  }
  const h = zT - zB;
  if (!Number.isFinite(h) || h < 0) {
    return { heightM: null, notes: "Delta hauteur invalide." };
  }
  return { heightM: h };
}

function buildSideAndTopIndices(nBase: number): {
  sideFaces: Readonly<{ a: number; b: number; c: number }>[];
  topIndices: readonly number[];
} {
  const sideFaces: { a: number; b: number; c: number }[] = [];
  for (let i = 0; i < nBase; i++) {
    const j = (i + 1) % nBase;
    const bi = i;
    const bj = j;
    const ti = i + nBase;
    const tj = j + nBase;
    sideFaces.push({ a: bi, b: bj, c: tj });
    sideFaces.push({ a: bi, b: tj, c: ti });
  }
  const topIndices = Array.from({ length: nBase }, (_, i) => i + nBase);
  return { sideFaces, topIndices };
}

export interface BuildRoofAnnexVolumes3DInput {
  readonly document: CanonicalHouseDocument;
  readonly bindingItems: readonly RoofAnnexBindingWorkItem[];
  readonly solutionSet: RoofPlaneSolutionSet;
}

function canEvaluateGeometry(work: RoofAnnexBindingWorkItem): boolean {
  return (
    Boolean(work.footprint2D) &&
    Boolean(work.primaryRoofPatchId) &&
    work.bindingStatus !== "no_footprint_geometry" &&
    work.bindingStatus !== "degenerate_footprint" &&
    work.bindingStatus !== "outside_all_patches" &&
    work.bindingStatus !== "ambiguous_patch_choice" &&
    work.bindingStatus !== "no_solved_plane_for_primary_patch"
  );
}

export function buildRoofAnnexVolumes3D(input: BuildRoofAnnexVolumes3DInput): readonly CanonicalRoofAnnexItem[] {
  const { document, bindingItems, solutionSet } = input;
  const out: CanonicalRoofAnnexItem[] = [];

  for (const work of bindingItems) {
    const diag: string[] = [...work.diagnostics];
    const annexId = work.annex.annexId;
    const roofPatchId = work.primaryRoofPatchId;
    const fam = work.annexFamily;

    const { heightM, notes: hNotes } = resolveHeightM(document, work);
    if (hNotes) diag.push(hNotes);

    const sol =
      roofPatchId ? solutionSet.solutions.find((s) => s.roofPatchId === roofPatchId) : undefined;
    const eq = sol?.planeEquation ?? null;

    let baseOnPlane: BuildingLocalVec3[] | null = null;
    let baseReference: RoofAnnexBaseReference | null = null;

    if (canEvaluateGeometry(work) && work.footprint2D && roofPatchId && eq) {
      const fp = work.footprint2D as Ring2D;
      baseOnPlane = fp.map((p) => {
        const z = evaluateZOnRoofPlane(eq, p.x, p.y);
        return { x: p.x, y: p.y, z };
      });
      if (baseOnPlane.some((v) => !Number.isFinite(v.z))) {
        diag.push("Z non fini sur le plan du pan pour au moins un sommet.");
        baseOnPlane = null;
      } else if (work.annex.geometry.kind === "footprint_extrusion") {
        baseReference = {
          method: "roof_patch_plane_evaluation",
          roofPatchId,
          planeEquationImplicit: { normal: eq.normal, d: eq.d },
          heightQuantityIds: {
            bottomId: work.annex.geometry.zBottomId,
            topId: work.annex.geometry.zTopId,
          },
        };
      }
    } else if (work.bindingStatus === "no_solved_plane_for_primary_patch") {
      diag.push("Plan pan non résolu — pas de base 3D sur plan.");
    }

    const normal = eq?.normal ?? { x: 0, y: 0, z: 1 };

    let footprint3D: BuildingLocalVec3[] | null = null;
    let geometryStatus: RoofAnnexGeometryStatus = "plane_unresolved";
    let heightInfo: RoofAnnexHeightInfo = {
      heightM: heightM ?? null,
      extrusionDirection: "along_patch_outward_normal",
    };
    let sideFaces: Readonly<{ a: number; b: number; c: number }>[] | null = null;
    let topFacePolygonVertexIndices: readonly number[] | null = null;
    let cutCandidate = false;
    let shadingRelevance = true;
    let extensionTopologyIntent: CanonicalRoofAnnexItem["extensionTopologyIntent"] = "n_a";

    if (fam === "roof_edge_uplift") {
      geometryStatus = "edge_uplift_deferred";
      heightInfo = {
        heightM: heightM ?? null,
        extrusionDirection: "world_vertical_z",
        notes: "Acrotère / relevé — maillage bande non construit en v1.",
      };
      shadingRelevance = false;
      footprint3D = null;
    } else if (fam === "roof_opening") {
      cutCandidate = true;
      shadingRelevance = false;
      footprint3D = baseOnPlane;
      geometryStatus = baseOnPlane ? "opening_footprint_only" : "plane_unresolved";
      heightInfo = {
        heightM: heightM ?? null,
        extrusionDirection: "opening_no_extrusion",
        notes: "Ouverture métier — cutCandidate pour découpe future ; pas d’extrusion v1.",
      };
    } else if (fam === "roof_keepout_zone") {
      footprint3D = baseOnPlane;
      geometryStatus = baseOnPlane ? "opening_footprint_only" : "plane_unresolved";
      heightInfo = {
        heightM: 0,
        extrusionDirection: "opening_no_extrusion",
        notes: "Keepout pose PV — emprise sur plan seule.",
      };
      shadingRelevance = true;
    } else if (fam === "roof_unknown_annex") {
      footprint3D = baseOnPlane;
      geometryStatus = baseOnPlane ? "volume_ok" : "plane_unresolved";
      shadingRelevance = false;
      heightInfo = { heightM: heightM ?? null, extrusionDirection: "along_patch_outward_normal" };
    } else if (fam === "roof_extension_volume") {
      extensionTopologyIntent = "needs_dedicated_topology_split";
      heightInfo = {
        heightM: heightM ?? null,
        extrusionDirection: "along_patch_outward_normal",
        notes: "Sous-toiture — découpe topologique dédiée volontairement non réalisée en v1.",
      };
      if (baseOnPlane && heightM !== null && heightM > 1e-6) {
        const top = baseOnPlane.map((p) => ({
          x: p.x + normal.x * heightM,
          y: p.y + normal.y * heightM,
          z: p.z + normal.z * heightM,
        }));
        footprint3D = [...baseOnPlane, ...top];
        const { sideFaces: sf, topIndices } = buildSideAndTopIndices(baseOnPlane.length);
        sideFaces = sf;
        topFacePolygonVertexIndices = topIndices;
        geometryStatus = "volume_ok";
      } else {
        footprint3D = baseOnPlane;
        geometryStatus = heightM === null || heightM <= 1e-6 ? "height_missing" : "plane_unresolved";
        if (geometryStatus === "height_missing") diag.push("Extension sans hauteur exploitable.");
      }
    } else if (fam === "roof_obstacle_solid" || fam === "roof_shadow_volume") {
      extensionTopologyIntent = "simple_volume";
      if (baseOnPlane && heightM !== null && heightM > 1e-6) {
        const top = baseOnPlane.map((p) => ({
          x: p.x + normal.x * heightM,
          y: p.y + normal.y * heightM,
          z: p.z + normal.z * heightM,
        }));
        footprint3D = [...baseOnPlane, ...top];
        const { sideFaces: sf, topIndices } = buildSideAndTopIndices(baseOnPlane.length);
        sideFaces = sf;
        topFacePolygonVertexIndices = topIndices;
        geometryStatus = "volume_ok";
      } else {
        footprint3D = baseOnPlane;
        geometryStatus =
          baseOnPlane && (heightM === null || heightM <= 1e-6) ? "height_missing" : "plane_unresolved";
        if (geometryStatus === "height_missing") {
          diag.push("Volume solide / ombrant sans hauteur positive — coque latérale non émise.");
        }
      }
    } else {
      footprint3D = baseOnPlane;
      geometryStatus = baseOnPlane ? "volume_ok" : "plane_unresolved";
    }

    out.push({
      annexId,
      annexFamily: fam,
      sourceEntityKind: work.sourceEntityKind,
      roofPatchId,
      bindingStatus: work.bindingStatus,
      bindingConfidence: work.bindingConfidence,
      footprintOnRoofPlane: work.footprint2D,
      bindingDiagnostics: [...work.diagnostics],
      baseReference,
      footprint2D: work.footprint2D,
      footprint3D,
      heightInfo,
      geometryStatus,
      topologyCompatibility: work.topologyCompatibility,
      shadingRelevance,
      cutCandidate,
      extensionTopologyIntent,
      sideFacesTriangleIndices: sideFaces,
      topFacePolygonVertexIndices,
      diagnostics: diag,
    });
  }

  return out;
}
