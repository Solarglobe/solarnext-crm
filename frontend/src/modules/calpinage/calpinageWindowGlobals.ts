/**
 * calpinageWindowGlobals.ts — Typage des globaux window exposés par le module calpinage.
 *
 * Remplace les `(window as any).*` éparpillés dans les composants React et bridges.
 * Toutes les propriétés sont `readonly` et optionnelles — leur présence dépend du
 * cycle de vie du module legacy (initCalpinage → cleanup).
 *
 * Usage :
 *   import { getCalpinageWindow } from "../calpinageWindowGlobals";
 *   const w = getCalpinageWindow();
 *   const studyId = w.CALPINAGE_STUDY_ID;   // string | null | undefined
 *
 * Règle : NE PAS utiliser directement `window as CalpinageWindow` hors de ce fichier.
 * Passer systématiquement par `getCalpinageWindow()`.
 */

// ── Interface ────────────────────────────────────────────────────────────────

/**
 * Extension typée de Window pour les globals exposés par le module calpinage.
 * Toutes les propriétés sont optionnelles — elles sont injectées par initCalpinage()
 * et supprimées par cleanup().
 */
export interface CalpinageWindow extends Window {
  // ── Identifiants étude ────────────────────────────────────────────────────
  readonly CALPINAGE_STUDY_ID: string | null | undefined;
  readonly CALPINAGE_VERSION_ID: string | null | undefined;

  // ── Feature flags 3D (booléens) ───────────────────────────────────────────
  /**
   * Mode debug 3D — overlay diagnostics.
   * Flag dev uniquement — positionné manuellement depuis la console navigateur.
   * NE PAS migrer vers CalpinageFeatureContext (intentionnellement hors React).
   */
  readonly __CALPINAGE_3D_DEBUG__: boolean | undefined;
  /**
   * Overlay XY debug (superposé en mode debug).
   * Flag dev uniquement — positionné manuellement depuis la console navigateur.
   */
  readonly __CALPINAGE_3D_XY_OVERLAY__: boolean | undefined;
  /** Mode vue courant ("2D" | "3D"). */
  readonly __CALPINAGE_VIEW_MODE__: "2D" | "3D" | undefined;
  /**
   * Indicateur DÉRIVÉ — écrit par Inline3DViewerBridge, lu par le legacy IIFE.
   * Source : `CalpinageFeatureContext.vertexZEdit || vertexXYEdit` (A2).
   * Les flags sources (`__CALPINAGE_3D_VERTEX_Z_EDIT__`, `__CALPINAGE_3D_VERTEX_XY_EDIT__`,
   * `__CALPINAGE_3D_RIDGE_HEIGHT_EDIT__`, `__CALPINAGE_3D_PV_PLACE_PROBE__`,
   * `__CALPINAGE_3D_PV_LAYOUT_MODE__`) ont été retirés de window en A2 →
   * utiliser `useCalpinageFeatures()` dans les composants React.
   */
  __CALPINAGE_3D_ROOF_VERTEX_EDIT_ACTIVE__: boolean | undefined;

  // ── Callbacks sidebar ─────────────────────────────────────────────────────
  /** Callback de notification mise à jour Phase 2 (installé par Phase2Sidebar). */
  notifyPhase2SidebarUpdate: (() => void) | undefined;
  /** Callback de notification mise à jour Phase 3 (installé par Phase3Sidebar). */
  notifyPhase3SidebarUpdate: (() => void) | undefined;

  // ── UI layer — dialog confirm ─────────────────────────────────────────────
  /** Expose la fonction de confirmation modale (installée par ConfirmProvider). */
  requestCalpinageConfirm: ((opts: {
    title: string;
    description: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm: () => void;
  }) => void) | undefined;

  // ── Toast layer ───────────────────────────────────────────────────────────
  /** Expose l'API toast calpinage (installée par ToastProvider). */
  calpinageToast: {
    success(msg: string): void;
    error(msg: string): void;
    warning(msg: string): void;
    info(msg: string): void;
  } | undefined;
  /** Alias legacy pour calpinageToast (conservé pour compatibilité window.showToast). */
  showToast: ((msg: string, level?: string) => void) | undefined;

  // ── Runtime calpinage ─────────────────────────────────────────────────────
  /** État global legacy — source de vérité pour les adaptateurs. */
  CALPINAGE_STATE: Record<string, unknown> | undefined;
  /** Flag manipulation en cours (drag obstacle/panel). */
  CALPINAGE_IS_MANIPULATING: boolean | undefined;
  /** Flag accès autorisé. */
  CALPINAGE_ALLOWED: boolean | undefined;

  // ── Sélection PV ─────────────────────────────────────────────────────────
  PV_SELECTED_PANEL: unknown | null;
  CALPINAGE_SELECTED_PANEL_ID: string | null | undefined;
  PV_SELECTED_INVERTER: unknown | null;
  CALPINAGE_SELECTED_INVERTER_ID: string | null | undefined;

  // ── Fonctions internes (injectées par initCalpinage) ──────────────────────
  getHeightAtXY: ((panId: string, xPx: number, yPx: number) => number | null | undefined) | undefined;
  __calpinage_hitTestPan__: ((x: number, y: number) => unknown) | undefined;
  CalpinagePans: { panState: { pans: unknown[]; activePanId: string | null; activePoint: unknown | null } } | undefined;
  pvPlacementEngine: { reset?: () => void; getAllPanels?: () => unknown[] } | undefined;

  // ── Mutations toiture plate (injectées par le module legacy) ─────────────
  /** Applique un patch de config toiture plate et déclenche un recalcul. */
  __applyFlatRoofConfigAndRecompute: ((panId: string, patch: Record<string, unknown>) => void) | undefined;
  /** Bascule le type toiture d'un pan (FLAT / PITCHED). Retourne false si impossible. */
  __applyManualPanRoofTypeAndRecompute: ((panId: string, type: "FLAT" | "PITCHED") => boolean) | undefined;
  /** Toast UX spécifique calpinage (injecté par le module legacy). */
  showCalpinageUxToast: ((msg: string) => void) | undefined;
  /** Définit l'orientation globale des modules PV (portrait / landscape). */
  setPvOrientation: ((value: "portrait" | "landscape") => void) | undefined;
}

// ── Accessor ─────────────────────────────────────────────────────────────────

/**
 * Retourne `window` typé comme `CalpinageWindow`.
 * À utiliser à la place de `(window as any)` dans tous les composants calpinage.
 *
 * @returns CalpinageWindow — window typé. Retourne un objet vide en SSR/test sans window.
 */
export function getCalpinageWindow(): CalpinageWindow {
  return (typeof window !== "undefined" ? window : {}) as CalpinageWindow;
}
