/**
 * Lecture seule des prédicats déjà utilisés par le legacy pour activer « Valider le calpinage ».
 * Ne modifie aucune règle métier : copie fidèle de calpinage.module.js (updateCalpinageValidateButton).
 */

export function hasPhase3CatalogModuleSelected(win: Window & typeof globalThis = window): boolean {
  const w = win as unknown as {
    PV_SELECTED_PANEL?: { id?: string };
    CALPINAGE_SELECTED_PANEL_ID?: string;
  };
  return !!(w.PV_SELECTED_PANEL && w.PV_SELECTED_PANEL.id) || !!w.CALPINAGE_SELECTED_PANEL_ID;
}

export function computeLegacyPhase3CanValidate(win: Window & typeof globalThis = window): boolean {
  const w = win as unknown as {
    pvPlacementEngine?: { getAllPanels?: () => unknown[] };
    PV_SELECTED_INVERTER?: { id?: string };
    CALPINAGE_SELECTED_INVERTER_ID?: string;
    getPhase3ChecklistOk?: () => boolean;
  };
  const totalPanels =
    w.pvPlacementEngine?.getAllPanels != null
      ? (w.pvPlacementEngine.getAllPanels() || []).length
      : 0;
  const hasCatalog = hasPhase3CatalogModuleSelected(win);
  const hasInverter =
    !!(w.PV_SELECTED_INVERTER && w.PV_SELECTED_INVERTER.id) || !!w.CALPINAGE_SELECTED_INVERTER_ID;
  const checklistOk = typeof w.getPhase3ChecklistOk === "function" ? w.getPhase3ChecklistOk() : true;
  return hasCatalog && totalPanels > 0 && hasInverter && checklistOk;
}

/** Message d’action suivante ; null si validation possible (même ordre de priorité que les title legacy). */
export function getPhase3ValidateBlockedHint(win: Window & typeof globalThis = window): string | null {
  if (computeLegacyPhase3CanValidate(win)) return null;
  const w = win as unknown as {
    pvPlacementEngine?: { getAllPanels?: () => unknown[] };
    PV_SELECTED_INVERTER?: { id?: string };
    CALPINAGE_SELECTED_INVERTER_ID?: string;
    getPhase3ChecklistOk?: () => boolean;
  };
  const totalPanels =
    w.pvPlacementEngine?.getAllPanels != null
      ? (w.pvPlacementEngine.getAllPanels() || []).length
      : 0;
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
    return "Pour un onduleur central, le ratio DC/AC doit être au moins 0,80 — ajustez l’onduleur ou la puissance installée.";
  }
  if (totalPanels < 1) {
    return "Posez au moins un module sur le plan.";
  }
  return "Complétez les points indiqués ci-dessus pour activer la validation.";
}
