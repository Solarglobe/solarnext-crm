/**
 * Mutation minimale officielle : hauteur métier (`h`) sur un sommet de `CALPINAGE_STATE.pans[]`.
 * Lue par `calpinageStateToLegacyRoofInput` (champ `h` / `heightM` sur le point).
 *
 * Ne modifie pas XY. Après appel : émettre `emitOfficialRuntimeStructuralChange({ changedDomains: ["pans"] })`
 * pour rebuild 3D (le flush synchronise `roof.roofPans` depuis `state.pans`).
 *
 * **Plan / validation** : si un seul sommet diffère fortement des autres, le pan peut être rejeté
 * (`PAN_DEGENERATE`) par `validateCanonicalScene3DInput` — ajuster les autres sommets ou garder un plan cohérent.
 */

import { resolvePanPolygonFor3D } from "../integration/resolvePanPolygonFor3D";
import { isValidBuildingHeightM } from "../core/heightResolver";
import { syncPointsFromPolygonPx } from "./syncPointsFromPolygonPx";
import { syncPolygonPxFromPoints } from "./syncPolygonPxFromPoints";

export type RoofVertexHeightEdit = {
  readonly panId: string;
  readonly vertexIndex: number;
  readonly heightM: number;
  /** Optionnel — corrélation télémétrie (`roofVertexZEditTelemetry.ts`), ignoré par la mutation. */
  readonly trace?: {
    readonly dragSessionId?: string;
    readonly source?: string;
  };
};

export type ApplyRoofVertexHeightEditResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string };

type MutablePoly = { readonly points: Record<string, unknown>[] };

/** Même résolution que la mutation Z — pour assert / provenance / UI. */
export function resolveCalpinagePanPolygonPointsForHeightEdit(
  pan: Record<string, unknown>,
): MutablePoly | null {
  const { raw } = resolvePanPolygonFor3D(pan);
  if (!raw) return null;
  return { points: raw as Record<string, unknown>[] };
}

function getMutablePanPolygon(pan: Record<string, unknown>): MutablePoly | null {
  return resolveCalpinagePanPolygonPointsForHeightEdit(pan);
}

/**
 * Mutate `runtime.pans` uniquement (source officielle). Ne touche pas au miroir `roof.roofPans`
 * — laisser `syncRoofPansMirrorFromPans` lors de l’émission structurelle.
 */
export function applyRoofVertexHeightEdit(
  runtime: unknown,
  edit: RoofVertexHeightEdit,
): ApplyRoofVertexHeightEditResult {
  if (!isValidBuildingHeightM(edit.heightM)) {
    return {
      ok: false,
      code: "INVALID_HEIGHT_M",
      message: "heightM doit être un nombre fini dans la plage hauteur bâtiment officielle.",
    };
  }
  if (!Number.isInteger(edit.vertexIndex) || edit.vertexIndex < 0) {
    return { ok: false, code: "INVALID_VERTEX_INDEX", message: "vertexIndex entier ≥ 0 requis." };
  }
  if (!runtime || typeof runtime !== "object") {
    return { ok: false, code: "RUNTIME_MISSING", message: "Runtime absent ou invalide." };
  }
  const root = runtime as Record<string, unknown>;
  const pans = root.pans;
  if (!Array.isArray(pans)) {
    return { ok: false, code: "PANS_MISSING", message: "state.pans absent ou non tableau." };
  }
  const panId = String(edit.panId);
  const panRec = pans.find((p) => p && typeof p === "object" && String((p as Record<string, unknown>).id) === panId);
  if (!panRec || typeof panRec !== "object") {
    return { ok: false, code: "PAN_NOT_FOUND", message: `Aucun pan id « ${panId} » dans state.pans.` };
  }
  const poly = getMutablePanPolygon(panRec as Record<string, unknown>);
  if (!poly) {
    return { ok: false, code: "PAN_POLYGON_MISSING", message: "Polygone pan introuvable (polygonPx / points / polygon / contour.points)." };
  }
  if (edit.vertexIndex >= poly.points.length) {
    return {
      ok: false,
      code: "VERTEX_OUT_OF_RANGE",
      message: `vertexIndex ${edit.vertexIndex} ≥ ${poly.points.length} sommets.`,
    };
  }
  const pt = poly.points[edit.vertexIndex]!;
  if (!pt || typeof pt !== "object") {
    return { ok: false, code: "VERTEX_INVALID", message: "Sommet polygone absent ou invalide." };
  }
  pt.h = edit.heightM;
  if ("heightM" in pt) {
    delete pt.heightM;
  }
  const panObj = panRec as Record<string, unknown>;
  if (poly.points === panObj.points) {
    syncPolygonPxFromPoints(panObj);
  } else if (poly.points === panObj.polygonPx) {
    syncPointsFromPolygonPx(panObj);
  }
  return { ok: true };
}

/**
 * Lit `h` / `heightM` sur le sommet `vertexIndex` du pan `panId` dans `runtime.pans` (après mutation legacy, etc.).
 */
export function readCalpinagePanVertexHeightM(
  runtime: unknown,
  panId: string,
  vertexIndex: number,
): number | null {
  if (!runtime || typeof runtime !== "object") return null;
  if (!Number.isInteger(vertexIndex) || vertexIndex < 0) return null;
  const root = runtime as Record<string, unknown>;
  const pans = root.pans;
  if (!Array.isArray(pans)) return null;
  const pid = String(panId);
  const panRec = pans.find((p) => p && typeof p === "object" && String((p as Record<string, unknown>).id) === pid);
  if (!panRec || typeof panRec !== "object") return null;
  const poly = resolveCalpinagePanPolygonPointsForHeightEdit(panRec as Record<string, unknown>);
  if (!poly || vertexIndex >= poly.points.length) return null;
  const pt = poly.points[vertexIndex];
  if (!pt || typeof pt !== "object") return null;
  const hRaw = (pt as Record<string, unknown>).h ?? (pt as Record<string, unknown>).heightM;
  if (typeof hRaw === "number" && Number.isFinite(hRaw)) return hRaw;
  return null;
}
