/**
 * Lecture seule des prédicats déjà utilisés par le legacy pour activer « Valider le calpinage ».
 * Ne modifie aucune règle métier : copie fidèle de calpinage.module.js (updateCalpinageValidateButton).
 *
 * T13 — wiring : pvPlacementEngine lu via getCalpinageRuntime().getPlacementEngine()
 * au lieu du cast inline `window as unknown as { pvPlacementEngine?: ... }`.
 */

import { getCalpinageRuntime } from "../runtime/calpinageRuntime";

export function hasPhase3CatalogModuleSelected(win: Window & typeof globalThis = window): boolean {
  const w = win as unknown as {
    PV_SELECTED_PANEL?: { id?: string };
    CALPINAGE_SELECTED_PANEL_ID?: string;
  };
  return !!(w.PV_SELECTED_PANEL && w.PV_SELECTED_PANEL.id) || !!w.CALPINAGE_SELECTED_PANEL_ID;
}

export function computeLegacyPhase3CanValidate(win: Window & typeof globalThis = window): boolean {
  const w = win as unknown as {
    PV_SELECTED_INVERTER?: { id?: string };
    CALPINAGE_SELECTED_INVERTER_ID?: string;
    getPhase3ChecklistOk?: () => boolean;
  };
  // T13 : accès typé via façade runtime — plus de cast inline pvPlacementEngine.
  const totalPanels = getCalpinageRuntime()?.getPlacementEngine()?.getAllPanels()?.length ?? 0;
  const hasCatalog = hasPhase3CatalogModuleSelected(win);
  const hasInverter =
    !!(w.PV_SELECTED_INVERTER && w.PV_SELECTED_INVERTER.id) || !!w.CALPINAGE_SELECTED_INVERTER_ID;
  const checklistOk = typeof w.getPhase3ChecklistOk === "function" ? w.getPhase3ChecklistOk() : true;
  return hasCatalog && totalPanels > 0 && hasInverter && checklistOk;
}

/**
 * Code de blocage structuré — remplace les heuristiques h.includes() dans Phase3Sidebar.
 * Retourne null si la validation est possible.
 * RATIO_INVALID est le seul cas « Bloqué » (actif mais hors plage) ;
 * les autres sont des états « Incomplet » (action manquante).
 */
export type Phase3ValidateBlockingReason =
  | "RATIO_INVALID"   // onduleur central, ratio DC/AC < 0,80 → Bloqué
  | "NO_CATALOG"      // aucun module sélectionné
  | "NO_INVERTER"     // aucun onduleur sélectionné
  | "NO_PANELS"       // aucun panneau posé
  | "INCOMPLETE"      // cas générique
  | null;             // validation possible

export function getPhase3ValidateBlockingReason(
  win: Window & typeof globalThis = window,
): Phase3ValidateBlockingReason {
  if (computeLegacyPhase3CanValidate(win)) return null;
  const w = win as unknown as {
    PV_SELECTED_INVERTER?: { id?: string };
    CALPINAGE_SELECTED_INVERTER_ID?: string;
    getPhase3ChecklistOk?: () => boolean;
  };
  const totalPanels = getCalpinageRuntime()?.getPlacementEngine()?.getAllPanels()?.length ?? 0;
  const hasCatalog = hasPhase3CatalogModuleSelected(win);
  const hasInverter =
    !!(w.PV_SELECTED_INVERTER && w.PV_SELECTED_INVERTER.id) || !!w.CALPINAGE_SELECTED_INVERTER_ID;
  const checklistOk = typeof w.getPhase3ChecklistOk === "function" ? w.getPhase3ChecklistOk() : true;
  if (!hasCatalog) return "NO_CATALOG";
  if (!hasInverter) return "NO_INVERTER";
  if (!checklistOk) return "RATIO_INVALID";
  if (totalPanels < 1) return "NO_PANELS";
  return "INCOMPLETE";
}

/** Message d'action suivante ; null si validation possible (même ordre de priorité que les title legacy). */
export function getPhase3ValidateBlockedHint(win: Window & typeof globalThis = window): string | null {
  if (computeLegacyPhase3CanValidate(win)) return null;
  const w = win as unknown as {
    PV_SELECTED_INVERTER?: { id?: string };
    CALPINAGE_SELECTED_INVERTER_ID?: string;
    getPhase3ChecklistOk?: () => boolean;
  };
  // T13 : accès typé via façade runtime.
  const totalPanels = getCalpinageRuntime()?.getPlacementEngine()?.getAllPanels()?.length ?? 0;
  const hasCatalog = hasPhase3CatalogModuleSelected(win);
  const hasInverter =
    !!(w.PV_SELECTED_INVERTER && w.PV_SELECTED_INVERTER.id) || !!w.CALPINAGE_SELECTED_INVERTER_ID;
  const checklistOk = typeof w.getPhase3ChecklistOk === "function" ? w.getPhase3ChecklistOk() : true;
  if (!hasCatalog) {
    return "Sélectionnez un module photovoltaïque dans la barre du haut (catalogue).";
  }
  if (!hasInverter) {
    return "Sélectionnez un onduleur dans la barre du haut.";
  }
  if (!checklistOk) {
    return "Pour un onduleur central, le ratio DC/AC doit être au moins 0,80 — ajustez l'onduleur ou la puissance installée.";
  }
  if (totalPanels < 1) {
    return "Posez au moins un module sur le plan.";
  }
  return "Complétez les points indiqués ci-dessus pour activer la validation.";
}
