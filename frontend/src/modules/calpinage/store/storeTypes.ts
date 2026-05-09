/**
 * Phase 1 — Types du store Zustand calpinage.
 *
 * PÉRIMÈTRE Phase 1 : lecture seule côté React.
 * Le legacy continue d'écrire dans window.CALPINAGE_STATE.
 * Le store est mis à jour par legacyCalpinageStateAdapter.ts via les événements legacy.
 *
 * Règles de ce fichier (immuables) :
 *   - Aucune référence à window.* (types purs)
 *   - Record<string, X> uniquement — pas de Map (non sérialisable JSON)
 *   - undoStack / redoStack : Phase 1+ (ici on ne persiste pas l'undo — prévu Phase 1.6)
 *
 * Évolution prévue :
 *   Phase 2 : ajouter actions PV (panelActions, roofActions)
 *   Phase 3 : ajouter store.vertices, store.faces (extraction géométrie)
 *   Phase 5 : ajouter undoStack, redoStack, ExportSnapshot
 */

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — snapshot de l'état relevé toiture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Snapshot Phase 2 — calculé par window.getPhase2Data() côté legacy.
 * Mis à jour à chaque événement "phase2:update".
 */
export interface CalpinagePhase2Snapshot {
  /** Outil Phase 2 actif ("select", "contour", "ridge", "heightEdit", "obstacle", etc.). */
  activeTool: string;
  contourClosed: boolean;
  ridgeDefined: boolean;
  heightsDefined: boolean;
  obstaclesCount: number;
  canValidate: boolean;
  validateHint: string;
  /** true si l'image satellite a été capturée. */
  captured: boolean;
  /** true si une géométrie existante est présente (brouillon ou étude chargée). */
  hasExistingGeometry: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 — snapshot brut des globals PV (adapter lit window, store stocke)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Projection UI "toiture plate" — résultat de window.projectCalpinageUi(state).
 * Stocké brut dans le store ; le hook dérive l'affichage depuis ces champs.
 */
export interface FlatRoofUiProjection {
  inPvLayout: boolean;
  hasPanCtx: boolean;
  activePanId: string | null;
  isFlat: boolean;
  /** true si le pan est incliné et la bascule "toiture plate" est proposée. */
  showFlatEnable: boolean;
  /** Inclinaison support : 5, 10 ou 15 degrés. */
  supportTiltDeg: 5 | 10 | 15;
  /** true = portrait, false = landscape. */
  layoutPortrait: boolean;
}

/**
 * Snapshot Phase 3 — données brutes lues depuis les globals window par l'adapter.
 * Mis à jour à chaque événement "phase3:update".
 *
 * Le hook usePhase3Data calcule les valeurs dérivées (totalKwc, dcAcRatio, etc.)
 * à partir de ces champs — sans accéder à window directement.
 */
export interface CalpinagePhase3Snapshot {
  // ── Panneaux posés ──────────────────────────────────────────────────────
  /** Nombre de panneaux actuellement posés (pvPlacementEngine.getAllPanels().length). */
  modulesCount: number;

  // ── Sélection onduleur ──────────────────────────────────────────────────
  /** ID onduleur sélectionné (CALPINAGE_SELECTED_INVERTER_ID). */
  selectedInverterId: string | null;
  /** Objet onduleur sélectionné (PV_SELECTED_INVERTER) — peut surcharger la lookup par ID. */
  pvSelectedInverter: unknown | null;

  // ── Sélection panneau catalogue ─────────────────────────────────────────
  /** ID panneau catalogue sélectionné (CALPINAGE_SELECTED_PANEL_ID). */
  selectedPanelId: string | null;
  /** Objet panneau catalogue (PV_SELECTED_PANEL) — peut surcharger la lookup par ID. */
  pvSelectedPanel: unknown | null;

  // ── Catalogues ──────────────────────────────────────────────────────────
  /** Liste complète des onduleurs disponibles (SOLARNEXT_INVERTERS). */
  inverters: unknown[];
  /** Liste complète du catalogue panneaux (SOLARNEXT_PANELS). */
  panelCatalog: unknown[];

  // ── Toiture ─────────────────────────────────────────────────────────────
  /** Snapshot de toiture validée Phase 2 (CALPINAGE_STATE.validatedRoofData). */
  validatedRoofData: unknown | null;
  /** Pan actif (CalpinagePans.panState.activePanId ou CALPINAGE_STATE.selectedPanId). */
  activePanId: string | null;

  // ── Règles PV ───────────────────────────────────────────────────────────
  /** Orientation globale des modules (PV_LAYOUT_RULES.orientation). */
  pvLayoutOrientation: "portrait" | "landscape";
  /**
   * Orientation du bloc focalisé (pvPlacementEngine.getFocusBlock().orientation).
   * Peut surcharger pvLayoutOrientation pour le bloc en cours d'édition.
   */
  focusBlockOrientation: string | null;

  // ── Outil Phase 3 ───────────────────────────────────────────────────────
  /** Outil actif Phase 3 (getPhase3ActiveTool()). */
  activeTool: "panels" | "select";

  // ── Autofill ────────────────────────────────────────────────────────────
  autofillEnabled: boolean;
  autofillText: string;
  autofillValidCount: number;

  // ── Bloc actif ──────────────────────────────────────────────────────────
  /** true si un panneau catalogue est sélectionné ET le bloc actif a ≥ 1 panneau posé. */
  hasActiveBlockWithPanels: boolean;

  // ── Toiture plate ───────────────────────────────────────────────────────
  /** Projection UI toiture plate — résultat de projectCalpinageUi(state). */
  flatRoofProjection: FlatRoofUiProjection;
}

// ─────────────────────────────────────────────────────────────────────────────
// STORE COMPLET — Phase 1
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Interface complète du store Zustand calpinage — Phase 1.
 *
 * Phase 1 : lecture seule, pas d'actions. Le legacy est source d'écriture.
 * Phase 2+ : les actions PV et roof seront ajoutées ici.
 */
export interface CalpinageStore {
  /**
   * true une fois que l'adapter a bootstrapé depuis window.CALPINAGE_STATE.
   * false jusqu'à la fin de initCalpinage().
   * Utilisé par les composants pour éviter un flash d'état vide.
   */
  initialized: boolean;

  /** Snapshot Phase 2 — relevé toiture. */
  phase2: CalpinagePhase2Snapshot;

  /** Snapshot Phase 3 — placement PV (données brutes). */
  phase3: CalpinagePhase3Snapshot;
}
