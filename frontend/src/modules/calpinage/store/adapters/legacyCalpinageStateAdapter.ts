/**
 * Phase 1 — Adapter legacy → store Zustand.
 *
 * SEUL fichier autorisé à lire window.* pour alimenter le store.
 * Aucun composant React ni hook ne doit accéder à window.CALPINAGE_STATE directement.
 *
 * Cycle de vie :
 *   1. bootstrapCalpinageStore() appelé par CalpinageApp.tsx après initCalpinage()
 *   2. Lecture one-shot de l'état initial → store.initialized = true
 *   3. Écoute de "phase2:update" → met à jour store.phase2
 *   4. Écoute de "phase3:update" → met à jour store.phase3
 *   5. teardown() appelé au démontage de CalpinageApp → removeEventListeners
 *
 * Invariants :
 *   - Toutes les lectures window sont null-safe (l'IIFE peut ne pas être montée)
 *   - Aucune écriture dans window (lecture seule)
 *   - Aucun import React / hook Zustand — accès direct à useCalpinageStore.setState
 *
 * Sources legacy → champs store (correspondance officielle) :
 *   window.getPhase2Data()              → store.phase2 (calculé par le legacy)
 *   window.getPhase2ActiveTool()        → store.phase2.activeTool
 *   window.pvPlacementEngine.getAllPanels() → store.phase3.modulesCount
 *   window.PV_SELECTED_INVERTER         → store.phase3.pvSelectedInverter
 *   window.CALPINAGE_SELECTED_INVERTER_ID → store.phase3.selectedInverterId
 *   window.CALPINAGE_SELECTED_PANEL_ID  → store.phase3.selectedPanelId
 *   window.PV_SELECTED_PANEL            → store.phase3.pvSelectedPanel
 *   window.SOLARNEXT_INVERTERS          → store.phase3.inverters
 *   window.SOLARNEXT_PANELS             → store.phase3.panelCatalog
 *   window.CALPINAGE_STATE.validatedRoofData → store.phase3.validatedRoofData
 *   window.CalpinagePans.panState.activePanId → store.phase3.activePanId
 *   window.PV_LAYOUT_RULES.orientation  → store.phase3.pvLayoutOrientation
 *   window.pvPlacementEngine.getFocusBlock().orientation → store.phase3.focusBlockOrientation
 *   window.getPhase3ActiveTool()        → store.phase3.activeTool
 *   window.__CALPINAGE_AUTOFILL_MODE__  → store.phase3.autofillEnabled
 *   window.__CALPINAGE_AUTOFILL_TEXT__  → store.phase3.autofillText
 *   window.__CALPINAGE_AUTOFILL_VALID_COUNT__ → store.phase3.autofillValidCount
 *   window.pvPlacementEngine.getActiveBlock() → store.phase3.hasActiveBlockWithPanels
 *   window.projectCalpinageUi(state)    → store.phase3.flatRoofProjection
 */

import { useCalpinageStore } from "../calpinageStore";
import type { CalpinagePhase2Snapshot, CalpinagePhase3Snapshot, FlatRoofUiProjection } from "../storeTypes";

// ─────────────────────────────────────────────────────────────────────────────
// Type helper — window sans typage strict (legacy IIFE)
// ─────────────────────────────────────────────────────────────────────────────

type Win = Window & Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────────
// Lecture Phase 2
// ─────────────────────────────────────────────────────────────────────────────

function readPhase2Snapshot(): CalpinagePhase2Snapshot {
  const win = window as Win;

  const rawData =
    typeof win.getPhase2Data === "function"
      ? (win.getPhase2Data as () => Record<string, unknown>)()
      : {};

  const activeTool =
    typeof win.getPhase2ActiveTool === "function"
      ? String((win.getPhase2ActiveTool as () => unknown)() || "select")
      : "select";

  return {
    activeTool,
    contourClosed: !!rawData.contourClosed,
    ridgeDefined: !!rawData.ridgeDefined,
    heightsDefined: !!rawData.heightsDefined,
    obstaclesCount: Number(rawData.obstaclesCount) || 0,
    canValidate: !!rawData.canValidate,
    validateHint: String(rawData.validateHint || ""),
    captured: !!rawData.captured,
    hasExistingGeometry: !!rawData.hasExistingGeometry,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lecture Phase 3
// ─────────────────────────────────────────────────────────────────────────────

function readPhase3Snapshot(): CalpinagePhase3Snapshot {
  const win = window as Win;
  const eng = win.pvPlacementEngine as Record<string, unknown> | undefined;
  const state = win.CALPINAGE_STATE as Record<string, unknown> | null | undefined;

  // ── Modules posés ───────────────────────────────────────────────────────
  const rawPanels =
    eng && typeof eng.getAllPanels === "function"
      ? (eng.getAllPanels as () => unknown)()
      : [];
  const modulesCount = Array.isArray(rawPanels) ? rawPanels.length : 0;

  // ── Sélection ───────────────────────────────────────────────────────────
  const selectedInverterId =
    win.CALPINAGE_SELECTED_INVERTER_ID != null
      ? String(win.CALPINAGE_SELECTED_INVERTER_ID)
      : null;
  const pvSelectedInverter = win.PV_SELECTED_INVERTER ?? null;

  const selectedPanelId =
    win.CALPINAGE_SELECTED_PANEL_ID != null
      ? String(win.CALPINAGE_SELECTED_PANEL_ID)
      : null;
  const pvSelectedPanel = win.PV_SELECTED_PANEL ?? null;

  // ── Catalogues ──────────────────────────────────────────────────────────
  const inverters = Array.isArray(win.SOLARNEXT_INVERTERS)
    ? (win.SOLARNEXT_INVERTERS as unknown[])
    : [];
  const panelCatalog = Array.isArray(win.SOLARNEXT_PANELS)
    ? (win.SOLARNEXT_PANELS as unknown[])
    : [];

  // ── Toiture ─────────────────────────────────────────────────────────────
  const validatedRoofData = state?.validatedRoofData ?? null;

  const cpPans = win.CalpinagePans as Record<string, unknown> | undefined;
  const panState = cpPans?.panState as Record<string, unknown> | undefined;
  const activePanId: string | null =
    panState?.activePanId != null
      ? String(panState.activePanId)
      : state?.selectedPanId != null
        ? String(state.selectedPanId)
        : null;

  // ── Règles PV ───────────────────────────────────────────────────────────
  const pvRules = win.PV_LAYOUT_RULES as Record<string, unknown> | undefined;
  const pvLayoutOrientation: "portrait" | "landscape" =
    String(pvRules?.orientation ?? "portrait").toLowerCase() === "landscape"
      ? "landscape"
      : "portrait";

  const rawFocusBlock =
    eng && typeof eng.getFocusBlock === "function"
      ? (eng.getFocusBlock as () => unknown)()
      : null;
  const focusBlockOrientation: string | null =
    rawFocusBlock != null &&
    typeof (rawFocusBlock as Record<string, unknown>).orientation === "string"
      ? String((rawFocusBlock as Record<string, unknown>).orientation)
      : null;

  // ── Outil Phase 3 ───────────────────────────────────────────────────────
  const rawTool3 =
    typeof win.getPhase3ActiveTool === "function"
      ? (win.getPhase3ActiveTool as () => unknown)()
      : "panels";
  const activeTool: "panels" | "select" =
    String(rawTool3 || "panels") === "select" ? "select" : "panels";

  // ── Autofill ────────────────────────────────────────────────────────────
  const autofillMode = win.__CALPINAGE_AUTOFILL_MODE__ as
    | { enabled?: boolean }
    | null
    | undefined;
  const autofillEnabled = !!(autofillMode?.enabled);
  const autofillText = String(win.__CALPINAGE_AUTOFILL_TEXT__ || "");
  const autofillValidCount = Number(win.__CALPINAGE_AUTOFILL_VALID_COUNT__ || 0);

  // ── Bloc actif ──────────────────────────────────────────────────────────
  const activeBlock =
    eng && typeof eng.getActiveBlock === "function"
      ? (eng.getActiveBlock as () => unknown)()
      : null;
  const abPanels =
    activeBlock != null
      ? (activeBlock as Record<string, unknown>).panels
      : null;
  const hasActiveBlockWithPanels = !!(
    win.PV_SELECTED_PANEL &&
    activeBlock &&
    Array.isArray(abPanels) &&
    abPanels.length >= 1
  );

  // ── Toiture plate ───────────────────────────────────────────────────────
  let flatRoofProjection: FlatRoofUiProjection = {
    inPvLayout: false,
    hasPanCtx: false,
    activePanId: null,
    isFlat: false,
    showFlatEnable: false,
    supportTiltDeg: 10,
    layoutPortrait: true,
  };
  try {
    if (typeof win.projectCalpinageUi === "function" && state) {
      const ui = (win.projectCalpinageUi as (s: unknown) => Record<string, unknown>)(state);
      if (ui) {
        const lp = (ui.livePan ?? ui.validatedPan) as
          | Record<string, unknown>
          | null
          | undefined;
        const fc = (
          lp && typeof lp.flatRoofConfig === "object" && lp.flatRoofConfig
            ? lp.flatRoofConfig
            : {}
        ) as Record<string, unknown>;
        const tilt = Number(fc.supportTiltDeg);
        const lo = String(fc.layoutOrientation || "portrait").toLowerCase();
        flatRoofProjection = {
          inPvLayout: !!ui.inPvLayout,
          hasPanCtx: !!ui.hasPanCtx,
          activePanId:
            ui.activePanId != null && ui.activePanId !== ""
              ? String(ui.activePanId)
              : null,
          isFlat: !!ui.isFlat,
          showFlatEnable: !!ui.hasPanCtx && !ui.isFlat,
          supportTiltDeg: (tilt === 5 || tilt === 10 || tilt === 15 ? tilt : 10) as
            | 5
            | 10
            | 15,
          layoutPortrait: !(lo === "landscape" || lo === "paysage"),
        };
      }
    }
  } catch {
    /* projectCalpinageUi peut lancer si l'état legacy est partiellement initialisé */
  }

  return {
    modulesCount,
    selectedInverterId,
    pvSelectedInverter,
    selectedPanelId,
    pvSelectedPanel,
    inverters,
    panelCatalog,
    validatedRoofData,
    activePanId,
    pvLayoutOrientation,
    focusBlockOrientation,
    activeTool,
    autofillEnabled,
    autofillText,
    autofillValidCount,
    hasActiveBlockWithPanels,
    flatRoofProjection,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap + teardown
// ─────────────────────────────────────────────────────────────────────────────

const PHASE2_EVENT = "phase2:update";
const PHASE3_EVENT = "phase3:update";

/**
 * Initialise le store depuis window.CALPINAGE_STATE et branche les listeners d'événements.
 *
 * Doit être appelé une seule fois, après que initCalpinage() ait terminé
 * (le module legacy est monté, window.CALPINAGE_STATE est disponible).
 *
 * @returns teardown — à appeler au démontage de CalpinageApp
 */
export function bootstrapCalpinageStore(): () => void {
  // Bootstrap one-shot — lit l'état initial
  useCalpinageStore.setState({
    initialized: true,
    phase2: readPhase2Snapshot(),
    phase3: readPhase3Snapshot(),
  });

  // Sync événementiel — le legacy émet ces événements après chaque mutation
  const onPhase2 = (): void => {
    useCalpinageStore.setState({ phase2: readPhase2Snapshot() });
  };
  const onPhase3 = (): void => {
    useCalpinageStore.setState({ phase3: readPhase3Snapshot() });
  };

  window.addEventListener(PHASE2_EVENT, onPhase2);
  window.addEventListener(PHASE3_EVENT, onPhase3);

  return (): void => {
    window.removeEventListener(PHASE2_EVENT, onPhase2);
    window.removeEventListener(PHASE3_EVENT, onPhase3);
    // Réinitialiser le store pour éviter qu'une prochaine session lise un état stale
    useCalpinageStore.setState({ initialized: false });
  };
}
