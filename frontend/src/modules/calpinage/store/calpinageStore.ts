/**
 * Phase 1 — Store Zustand calpinage.
 *
 * Point d'entrée unique pour tout accès React à l'état calpinage.
 * Le store est initialisé par legacyCalpinageStateAdapter.ts après initCalpinage().
 *
 * Usage dans les composants :
 *   const phase2 = useCalpinageStore(s => s.phase2);
 *   const modulesCount = useCalpinageStore(s => s.phase3.modulesCount);
 *
 * Mutation (adapter uniquement — jamais depuis les composants en Phase 1) :
 *   useCalpinageStore.setState({ phase3: newSnapshot });
 *
 * Règles immuables :
 *   - Les composants React n'appellent jamais .setState() directement
 *   - Toute mutation passe par legacyCalpinageStateAdapter.ts
 *   - Aucune dépendance à window.* dans ce fichier
 */
import { create } from "zustand";
import type { CalpinageStore, CalpinagePhase2Snapshot, CalpinagePhase3Snapshot } from "./storeTypes";

// ─────────────────────────────────────────────────────────────────────────────
// Valeurs initiales (avant bootstrap de l'adapter)
// ─────────────────────────────────────────────────────────────────────────────

const initialPhase2: CalpinagePhase2Snapshot = {
  activeTool: "select",
  contourClosed: false,
  ridgeDefined: false,
  heightsDefined: false,
  obstaclesCount: 0,
  canValidate: false,
  validateHint: "",
  captured: false,
  hasExistingGeometry: false,
};

const initialPhase3: CalpinagePhase3Snapshot = {
  modulesCount: 0,
  selectedInverterId: null,
  pvSelectedInverter: null,
  selectedPanelId: null,
  pvSelectedPanel: null,
  inverters: [],
  panelCatalog: [],
  validatedRoofData: null,
  activePanId: null,
  pvLayoutOrientation: "portrait",
  focusBlockOrientation: null,
  activeTool: "panels",
  autofillEnabled: false,
  autofillText: "",
  autofillValidCount: 0,
  hasActiveBlockWithPanels: false,
  flatRoofProjection: {
    inPvLayout: false,
    hasPanCtx: false,
    activePanId: null,
    isFlat: false,
    showFlatEnable: false,
    supportTiltDeg: 10,
    layoutPortrait: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook Zustand — consommé uniquement dans les composants React et les hooks custom.
 * L'adapter accède au store via `useCalpinageStore.setState()` (API hors-React de Zustand).
 */
export const useCalpinageStore = create<CalpinageStore>()(() => ({
  initialized: false,
  phase2: initialPhase2,
  phase3: initialPhase3,
}));
