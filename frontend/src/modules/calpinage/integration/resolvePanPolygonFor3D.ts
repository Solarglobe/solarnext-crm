/**
 * Résolution unique du polygone pan (px image) pour tous les pipelines 3D / legacy alignés.
 *
 * Priorité stricte : polygonPx → points → polygon → contour.points
 * Aucune valeur inventée : premier tableau avec ≥ 3 sommets, sinon null.
 *
 * Lecteurs volontairement non migrés (hors périmètre pan toiture ou non géométrique) :
 * - `buildSolarScene3DFromCalpinageRuntimeCore.ts` : dump console audit uniquement.
 * - `mapPanelsToPvPlacementInputs` / `mapPvEnginePanelsToPanelInputs` : panneaux PV (`PanelInput`), pas `state.pans[]`.
 */

export type PanPolygon3DSource = "polygonPx" | "points" | "polygon" | "contour.points";

export type ResolvePanPolygonFor3DResult = {
  readonly source: PanPolygon3DSource;
  /** Référence au tableau gagnant sur l’objet pan (≥ 3 entrées). */
  readonly raw: readonly unknown[];
} | {
  readonly source: null;
  readonly raw: null;
};

function contourPointsArray(pan: Record<string, unknown>): unknown[] | undefined {
  const contour = pan.contour;
  if (!contour || typeof contour !== "object" || Array.isArray(contour)) return undefined;
  const pts = (contour as { points?: unknown }).points;
  return Array.isArray(pts) ? pts : undefined;
}

export function resolvePanPolygonFor3D(pan: Record<string, unknown>): ResolvePanPolygonFor3DResult {
  const candidates: ReadonlyArray<{ source: PanPolygon3DSource; arr: unknown }> = [
    { source: "polygonPx", arr: pan.polygonPx },
    { source: "points", arr: pan.points },
    { source: "polygon", arr: pan.polygon },
    { source: "contour.points", arr: contourPointsArray(pan) },
  ];
  for (const { source, arr } of candidates) {
    if (Array.isArray(arr) && arr.length >= 3) {
      return { source, raw: arr };
    }
  }
  return { source: null, raw: null };
}
