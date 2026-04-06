/**
 * Validation de **contrat** sur RoofModel3D : références, cohérence métrique, pas de reconstruction.
 * Aucune mutation ; pas de « réparation » automatique.
 */

import type { RoofPlanePatch3D } from "../types/roof-surface";
import type { RoofModel3D } from "../types/model";
import type { GeometryDiagnostic } from "../types/quality";
import {
  distance3,
  dot3,
  isApproxUnitDirection3,
  isRightHandedOrthonormalFrame,
  length3,
  nearlyEqual3,
  signedDistanceToPlane,
} from "./math3";
import { isNonEmptyStableId, isUnitNormalPlane } from "./guards";

export interface RoofModelValidationResult {
  readonly ok: boolean;
  readonly diagnostics: readonly GeometryDiagnostic[];
}

const PLANE_DIST_EPS = 1e-2;
const CORNER_POS_EPS = 1e-2;
const DIR_UNIT_EPS = 1e-3;
const NORMAL_ALIGN_EPS = 1e-2;
const EDGE_LEN_EPS = 1e-3;
const DEGENERATE_EDGE_LEN = 1e-9;

function diag(
  code: string,
  severity: GeometryDiagnostic["severity"],
  message: string,
  context?: Readonly<Record<string, string | number | boolean>>
): GeometryDiagnostic {
  return context ? { code, severity, message, context } : { code, severity, message };
}

function collectVertexIds(model: RoofModel3D): Set<string> {
  const s = new Set<string>();
  for (const v of model.roofVertices) s.add(v.id);
  return s;
}

function collectEdgeIds(model: RoofModel3D): Set<string> {
  const s = new Set<string>();
  for (const e of model.roofEdges) s.add(e.id);
  return s;
}

function vertexPositionMap(model: RoofModel3D): Map<string, { x: number; y: number; z: number }> {
  const m = new Map<string, { x: number; y: number; z: number }>();
  for (const v of model.roofVertices) m.set(v.id, v.position);
  return m;
}

function validateDuplicateIds(ids: readonly string[], prefix: string): GeometryDiagnostic[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return [...dup].map((id) =>
    diag(`${prefix}_DUPLICATE_ID`, "error", `Identifiant dupliqué : ${id}`, { id })
  );
}

function validateEmptyIds(ids: readonly string[], prefix: string, label: string): GeometryDiagnostic[] {
  const out: GeometryDiagnostic[] = [];
  for (const id of ids) {
    if (!isNonEmptyStableId(id)) {
      out.push(diag(`${prefix}_EMPTY_ID`, "error", `${label} : identifiant vide interdit`));
    }
  }
  return out;
}

function validatePlanePatch(
  patch: RoofPlanePatch3D,
  vertexIds: Set<string>,
  edgeIds: Set<string>,
  posById: Map<string, { x: number; y: number; z: number }>
): GeometryDiagnostic[] {
  const out: GeometryDiagnostic[] = [];

  if (patch.boundaryVertexIds.length < 3) {
    out.push(
      diag("PLANE_PATCH_BOUNDARY_TOO_SHORT", "error", `Pan ${patch.id} : moins de 3 sommets de bord`, {
        patchId: patch.id,
      })
    );
  }

  if (patch.boundaryEdgeIds.length > 0 && patch.boundaryEdgeIds.length !== patch.boundaryVertexIds.length) {
    out.push(
      diag(
        "PLANE_PATCH_EDGE_VERTEX_COUNT",
        "warning",
        `Pan ${patch.id} : nombre d'arêtes de bord ≠ nombre de sommets (graphe ouvert ou convention différente)`,
        { patchId: patch.id }
      )
    );
  }

  for (const eid of patch.boundaryEdgeIds) {
    if (!edgeIds.has(eid)) {
      out.push(
        diag("PLANE_PATCH_UNKNOWN_EDGE", "warning", `Pan ${patch.id} référence arête bord ${eid} absente`, {
          patchId: patch.id,
          edgeId: eid,
        })
      );
    }
  }
  for (const vid of patch.boundaryVertexIds) {
    if (!vertexIds.has(vid)) {
      out.push(
        diag("PLANE_PATCH_MISSING_VERTEX", "error", `Sommet manquant pour le pan ${patch.id}`, {
          patchId: patch.id,
          vertexId: vid,
        })
      );
    }
  }
  if (patch.cornersWorld.length !== patch.boundaryVertexIds.length) {
    out.push(
      diag(
        "PLANE_PATCH_CORNERS_MISMATCH",
        "error",
        `cornersWorld et boundaryVertexIds de longueurs différentes pour ${patch.id}`
      )
    );
  } else {
    for (let i = 0; i < patch.boundaryVertexIds.length; i++) {
      const vid = patch.boundaryVertexIds[i];
      const cw = patch.cornersWorld[i];
      const vp = posById.get(vid);
      if (vp && cw && distance3(vp, cw) > CORNER_POS_EPS) {
        out.push(
          diag(
            "PLANE_PATCH_CORNER_POS_MISMATCH",
            "warning",
            `Position cornersWorld[${i}] ≠ sommet ${vid} pour pan ${patch.id}`,
            { patchId: patch.id, index: i }
          )
        );
      }
    }
  }

  if (patch.polygon2DInPlane != null && patch.polygon2DInPlane.length !== patch.boundaryVertexIds.length) {
    out.push(
      diag(
        "PLANE_PATCH_UV_COUNT_MISMATCH",
        "error",
        `polygon2DInPlane et boundaryVertexIds : longueurs différentes pour ${patch.id}`
      )
    );
  }

  if (!isUnitNormalPlane(patch.equation)) {
    out.push(diag("PLANE_PATCH_NON_UNIT_NORMAL", "warning", `Normale équation non unitaire pour ${patch.id}`));
  }

  if (!nearlyEqual3(patch.equation.normal, patch.normal, NORMAL_ALIGN_EPS)) {
    out.push(
      diag("PLANE_PATCH_NORMAL_EQUATION_MISMATCH", "warning", `normal vs equation.normal pour ${patch.id}`)
    );
  }

  const sd = signedDistanceToPlane(patch.centroid, patch.equation);
  if (!Number.isFinite(sd) || Math.abs(sd) > PLANE_DIST_EPS) {
    out.push(
      diag(
        "PLANE_PATCH_CENTROID_OFF_PLANE",
        "warning",
        `Centroïde hors plan (|distance|=${Math.abs(sd)}) pour ${patch.id}`
      )
    );
  }

  const f = patch.localFrame;
  if (
    !isRightHandedOrthonormalFrame(f.xAxis, f.yAxis, f.zAxis, 1e-3) &&
    length3(f.xAxis) > 0 &&
    length3(f.yAxis) > 0 &&
    length3(f.zAxis) > 0
  ) {
    out.push(diag("PLANE_PATCH_BAD_FRAME", "warning", `Repère local non orthonormé droit pour ${patch.id}`));
  }

  const alignZ = Math.abs(dot3(patch.normal, f.zAxis));
  if (alignZ < 1 - NORMAL_ALIGN_EPS) {
    out.push(
      diag(
        "PLANE_PATCH_NORMAL_FRAME_Z_MISMATCH",
        "warning",
        `patch.normal et localFrame.zAxis non alignés pour ${patch.id}`,
        { patchId: patch.id }
      )
    );
  }

  return out;
}

/**
 * Valide le modèle ; `ok` si aucune erreur (les warnings sont autorisés).
 */
export function validateRoofModel3D(model: RoofModel3D): RoofModelValidationResult {
  const diagnostics: GeometryDiagnostic[] = [];

  const vertexIds = collectVertexIds(model);
  const edgeIds = collectEdgeIds(model);
  const posById = vertexPositionMap(model);
  const planeIds = new Set(model.roofPlanePatches.map((p) => p.id));

  diagnostics.push(...validateEmptyIds(model.roofVertices.map((v) => v.id), "VERTEX", "Sommet"));
  diagnostics.push(...validateEmptyIds(model.roofEdges.map((e) => e.id), "EDGE", "Arête"));
  diagnostics.push(...validateEmptyIds(model.roofPlanePatches.map((p) => p.id), "PLANE", "Pan"));
  diagnostics.push(...validateEmptyIds(model.roofRidges.map((r) => r.id), "RIDGE", "Ridge"));
  diagnostics.push(...validateEmptyIds(model.roofObstacles.map((o) => o.id), "OBSTACLE", "Obstacle"));
  diagnostics.push(...validateEmptyIds(model.roofExtensions.map((e) => e.id), "EXTENSION", "Extension"));

  diagnostics.push(
    ...validateDuplicateIds(
      model.roofVertices.map((v) => v.id),
      "VERTEX"
    )
  );
  diagnostics.push(
    ...validateDuplicateIds(
      model.roofEdges.map((e) => e.id),
      "EDGE"
    )
  );
  diagnostics.push(
    ...validateDuplicateIds(
      model.roofPlanePatches.map((p) => p.id),
      "PLANE"
    )
  );
  diagnostics.push(...validateDuplicateIds(model.roofRidges.map((r) => r.id), "RIDGE"));
  diagnostics.push(...validateDuplicateIds(model.roofObstacles.map((o) => o.id), "OBSTACLE"));
  diagnostics.push(...validateDuplicateIds(model.roofExtensions.map((e) => e.id), "EXTENSION"));

  for (const e of model.roofEdges) {
    if (!vertexIds.has(e.vertexAId) || !vertexIds.has(e.vertexBId)) {
      diagnostics.push(
        diag("EDGE_UNKNOWN_VERTEX", "error", `Arête ${e.id} référence un sommet inexistant`)
      );
    }
    if (e.vertexAId === e.vertexBId) {
      diagnostics.push(diag("EDGE_DEGENERATE_VERTICES", "error", `Arête ${e.id} : vertexAId = vertexBId`));
    }
    const va = posById.get(e.vertexAId);
    const vb = posById.get(e.vertexBId);
    if (va && vb) {
      const d = distance3(va, vb);
      if (d < DEGENERATE_EDGE_LEN && (e.purpose === "mesh_topology" || e.purpose === "both")) {
        diagnostics.push(diag("EDGE_ZERO_LENGTH", "error", `Arête ${e.id} dégénérée (longueur ~0)`));
      }
      if (e.lengthM > 0 && Math.abs(d - e.lengthM) > EDGE_LEN_EPS) {
        diagnostics.push(
          diag(
            "EDGE_LENGTH_MISMATCH",
            "warning",
            `Longueur stockée ${e.lengthM} ≠ distance sommets ${d} pour ${e.id}`
          )
        );
      }
    }
    if ((e.purpose === "mesh_topology" || e.purpose === "both") && !isApproxUnitDirection3(e.directionWorld, DIR_UNIT_EPS)) {
      diagnostics.push(
        diag("EDGE_DIRECTION_NOT_UNIT", "warning", `directionWorld non unitaire pour arête ${e.id}`)
      );
    }
    for (const pid of e.incidentPlanePatchIds) {
      if (!planeIds.has(pid)) {
        diagnostics.push(diag("EDGE_UNKNOWN_PLANE", "error", `Arête ${e.id} référence pan inconnu ${pid}`));
      }
    }
    if (e.ridgeLineId != null && !model.roofRidges.some((r) => r.id === e.ridgeLineId)) {
      diagnostics.push(
        diag("EDGE_UNKNOWN_RIDGE", "error", `Arête ${e.id} référence ridgeLineId inconnu ${e.ridgeLineId}`)
      );
    }
  }

  const ridgeById = new Map(model.roofRidges.map((r) => [r.id, r] as const));
  for (const r of model.roofRidges) {
    if (r.roofEdgeIds.length < 1) {
      diagnostics.push(diag("RIDGE_EMPTY", "error", `Ridge ${r.id} : aucune arête`));
    }
    for (const eid of r.roofEdgeIds) {
      if (!edgeIds.has(eid)) {
        diagnostics.push(diag("RIDGE_UNKNOWN_EDGE", "error", `Ridge ${r.id} référence arête ${eid}`));
      }
    }
  }

  for (const e of model.roofEdges) {
    if (e.ridgeLineId == null) continue;
    const ridge = ridgeById.get(e.ridgeLineId);
    if (ridge && !ridge.roofEdgeIds.includes(e.id)) {
      diagnostics.push(
        diag(
          "EDGE_RIDGE_BACKREF_MISMATCH",
          "warning",
          `Arête ${e.id} déclare ridgeLineId ${e.ridgeLineId} mais la ridge ne référence pas cette arête`
        )
      );
    }
  }

  for (const p of model.roofPlanePatches) {
    diagnostics.push(...validatePlanePatch(p, vertexIds, edgeIds, posById));
  }

  for (const a of model.roofPlanePatches) {
    for (const bid of a.adjacentPlanePatchIds) {
      if (!planeIds.has(bid)) {
        diagnostics.push(
          diag("PLANE_ADJ_UNKNOWN", "warning", `Pan ${a.id} : adjacent inconnu ${bid}`, { patchId: a.id })
        );
        continue;
      }
      const b = model.roofPlanePatches.find((x) => x.id === bid);
      if (b && !b.adjacentPlanePatchIds.includes(a.id)) {
        diagnostics.push(
          diag(
            "PLANE_ADJ_ASYMMETRIC",
            "warning",
            `Adjacence asymétrique entre ${a.id} et ${bid} (référence non réciproque)`
          )
        );
      }
    }
  }

  for (const o of model.roofObstacles) {
    if (o.footprintWorld.length < 3) {
      diagnostics.push(
        diag("OBSTACLE_FOOTPRINT_TOO_SMALL", "error", `Obstacle ${o.id} : footprint < 3 sommets`, { id: o.id })
      );
    }
    if (!Number.isFinite(o.baseElevationM)) {
      diagnostics.push(diag("OBSTACLE_BAD_BASE_Z", "error", `Obstacle ${o.id} : baseElevationM non fini`));
    }
    if (!Number.isFinite(o.heightM) || o.heightM <= 0) {
      diagnostics.push(diag("OBSTACLE_BAD_HEIGHT", "error", `Obstacle ${o.id} : heightM invalide`));
    }
    for (const pid of o.relatedPlanePatchIds) {
      if (!planeIds.has(pid)) {
        diagnostics.push(
          diag("OBSTACLE_UNKNOWN_PLANE", "warning", `Obstacle ${o.id} référence pan inconnu ${pid}`)
        );
      }
    }
  }

  for (const ex of model.roofExtensions) {
    if (ex.footprintWorld.length < 3) {
      diagnostics.push(
        diag("EXTENSION_FOOTPRINT_TOO_SMALL", "warning", `Extension ${ex.id} : footprint < 3 sommets`, { id: ex.id })
      );
    }
  }

  const errors = diagnostics.filter((d) => d.severity === "error");
  return { ok: errors.length === 0, diagnostics };
}
