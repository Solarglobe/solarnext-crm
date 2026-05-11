/**
 * Enrichit les PanelInput pour le canonical near (lecture seule moteur placement).
 * Sans modifier pvPlacementEngine : utilise getBlockById + structure block.panels[idx].
 */

import type { PanelInput } from "../shading/shadingInputTypes";

export type PlacementEngineLike = {
  getBlockById?: (id: string) => {
    rotation?: number;
    /** PORTRAIT | PAYSAGE / LANDSCAPE (moteur placement). null = legacy moteur sans orientation. */
    orientation?: string | null;
    manipulationTransform?: { rotationDeg?: number } | null;
    panels?: ReadonlyArray<{ localRotationDeg?: number }>;
  } | null;
};

/** Parse id "blockId_index" retourné par getAllPanels. */
export function parsePanelCompositeId(panelId: string): { blockId: string; index: number } | null {
  const last = panelId.lastIndexOf("_");
  if (last <= 0) return null;
  const idx = Number(panelId.slice(last + 1));
  if (!Number.isFinite(idx) || idx < 0 || !Number.isInteger(idx)) return null;
  return { blockId: panelId.slice(0, last), index: idx };
}

/**
 * Ajoute localRotationDeg et rotationDeg effectifs (bloc + manipulation + locale) si le moteur est dispo.
 */
export function enrichPanelsForCanonicalShading(
  panels: readonly PanelInput[],
  placementEngine: PlacementEngineLike | null | undefined
): PanelInput[] {
  if (!placementEngine || typeof placementEngine.getBlockById !== "function") {
    return panels.map((p) => ({ ...p }));
  }
  return panels.map((p) => {
    const id = p.id != null ? String(p.id) : "";
    const parsed = id ? parsePanelCompositeId(id) : null;
    if (!parsed) return { ...p };
    const block = placementEngine.getBlockById!(parsed.blockId);
    if (!block || !Array.isArray(block.panels)) return { ...p };
    const panelRow = block.panels[parsed.index];
    const localRot =
      panelRow && typeof panelRow.localRotationDeg === "number" && Number.isFinite(panelRow.localRotationDeg)
        ? panelRow.localRotationDeg
        : 0;
    let blockRot = typeof block.rotation === "number" && Number.isFinite(block.rotation) ? block.rotation : 0;
    blockRot = ((blockRot % 360) + 360) % 360;
    const manip =
      block.manipulationTransform && typeof block.manipulationTransform.rotationDeg === "number"
        ? block.manipulationTransform.rotationDeg
        : 0;
    const rotCombined = (((blockRot + manip) % 360) + 360) % 360;
    return {
      ...p,
      rotationDeg: rotCombined,
      localRotationDeg: localRot,
    };
  });
}
