/**
 * Calpinage Module — Montable React-compatible
 * Usage: initCalpinage(container, { studyId, versionId })
 * CP-004 — localStorage scopé par studyId+versionId via calpinageStorage
 */
import {
  getCalpinageScopedKeyFromLegacy,
  getCalpinageItem,
  setCalpinageItem,
} from "../calpinageStorage";
import { loadScriptOnce } from "./loadCalpinageDeps";
import {
  normalizeCalpinageGeometry3DReady,
  buildGeometry3DExportSection,
  houseModelV2,
  computeCentroidPx,
} from "../geometry";
import { unifiedHitTest } from "../core/unifiedHitTest";
import { startInteraction, updateInteraction, commitInteraction } from "../core/interactionEngine";
// INTERACTION-ENGINE-WIRED
import {
  InteractionStates,
  getInteractionState,
  setInteractionState,
  resetInteractionState,
} from "../core/interactionStateMachine"; // STATE-MACHINE-WIRED
import { validateInverterSizing } from "../inverterSizing";
import { normalizeInverterFamily } from "../utils/normalizeInverterFamily";
import { SG_P2_ICONS } from "../icons/solarglobePhase2Icons";

function debugStateConsistency(drawState) {
  const state = getInteractionState();

  if (process.env.NODE_ENV === "production") return;

  const isDragging =
    !!drawState.draggingObstacleOffset ||
    !!drawState.draggingVertex ||
    !!drawState.draggingShadowVolumeMove ||
    !!window.CALPINAGE_IS_MANIPULATING;

  const isResizing =
    !!drawState.resizeObstacleStart ||
    !!drawState.resizeShadowVolumeStart;

  const isRotating =
    !!drawState.shadowVolumeRotateStart;

  const isCreating =
    !!drawState.shadowVolumePlaceStart ||
    !!drawState.obstacleAnchor ||
    !!drawState.obstacleCircleStartPoint ||
    !!drawState.obstacleRectStartPoint;

  if (isDragging && state !== InteractionStates.DRAGGING) {
    console.warn("[STATE MISMATCH] Expected DRAGGING but state =", state);
  }

  if (isResizing && state !== InteractionStates.RESIZING) {
    console.warn("[STATE MISMATCH] Expected RESIZING but state =", state);
  }

  if (isRotating && state !== InteractionStates.ROTATING) {
    console.warn("[STATE MISMATCH] Expected ROTATING but state =", state);
  }

  if (isCreating && state !== InteractionStates.CREATING) {
    console.warn("[STATE MISMATCH] Expected CREATING but state =", state);
  }
}

var _calpinageInitInFlight = false;

export function initCalpinage(container, options = {}) {
  if (container && container.__CALPINAGE_MOUNTED__) {
    if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
      console.warn("[Calpinage] Prevented double init");
    }
    return container.__CALPINAGE_TEARDOWN__ || function () {};
  }
  var studyId = options.studyId || null;
  var versionId = options.versionId || null;
  if (typeof window !== "undefined") {
    window.CALPINAGE_STUDY_ID = studyId;
    window.CALPINAGE_VERSION_ID = versionId;
  }
  var cleanupTasks = [];
  function addSafeListener(target, type, handler, options) {
    if (!target || !target.addEventListener) return;
    target.addEventListener(type, handler, options);
    cleanupTasks.push(function () {
      target.removeEventListener(type, handler, options);
    });
  }
  var devLog = typeof import.meta !== "undefined" && import.meta.env?.DEV && typeof console !== "undefined";
  if (devLog) {
    console.log("[CALPINAGE] initCalpinage start studyId=" + studyId + " versionId=" + versionId + " options.onValidate=" + (typeof options.onValidate === "function" ? "fn" : "no"));
  }
  if (_calpinageInitInFlight) {
    if (devLog) console.warn("[CALPINAGE] init already in flight, aborting");
    return function noop() { _calpinageInitInFlight = false; };
  }
  if (!container || !container.isConnected) {
    if (devLog) console.warn("[CALPINAGE] container missing or disconnected, aborting");
    return function noop() { _calpinageInitInFlight = false; };
  }

  /* Idempotence : si #calpinage-root existe déjà ET que studyId/versionId n'ont pas changé, ne pas réinjecter.
   * Si studyId ou versionId diffèrent, on supprime l'ancien root et on force re-init pour isoler l'état par étude. */
  var existingRoot = container.querySelector("#calpinage-root");
  var prevStudyId = container.__CALPINAGE_STUDY_ID;
  var prevVersionId = container.__CALPINAGE_VERSION_ID;
  var studyVersionUnchanged = (prevStudyId === studyId && prevVersionId === versionId);
  if (existingRoot && existingRoot.parentNode === container && studyVersionUnchanged) {
    _calpinageInitInFlight = false;
    if (devLog) console.warn("[Calpinage] Prevented double injection (#calpinage-root already present, same study/version)");
    return container.__CALPINAGE_TEARDOWN__ || function () {};
  }
  /* Changement d'étude : reset moteurs + destroy map + supprimer l'ancien root avant de réinjecter (évite fuite d'état) */
  if (existingRoot && existingRoot.parentNode === container) {
    if (devLog) console.log("[CALPINAGE] study/version changed, resetting state for re-init");
    try {
      if (typeof window !== "undefined" && window.calpinageMap && typeof window.calpinageMap.destroy === "function") {
        window.calpinageMap.destroy();
      }
      window.calpinageMap = null;
    } catch (_) {}
    try {
      var engReset = (typeof window !== "undefined" && window.pvPlacementEngine && window.pvPlacementEngine.reset) ||
        (typeof window !== "undefined" && window.ActivePlacementBlock && window.ActivePlacementBlock.reset);
      if (typeof engReset === "function") engReset();
    } catch (_) {}
    try {
      if (typeof window !== "undefined" && window.CalpinagePans && window.CalpinagePans.panState) {
        var ps = window.CalpinagePans.panState;
        if (Array.isArray(ps.pans)) ps.pans.length = 0;
        ps.activePanId = null;
        ps.activePoint = null;
      }
    } catch (_) {}
    if (typeof window !== "undefined") {
      try { delete window.CALPINAGE_STATE; } catch (_) {}
      window.PV_SELECTED_PANEL = null;
      window.CALPINAGE_SELECTED_PANEL_ID = null;
      window.PV_SELECTED_INVERTER = null;
      window.CALPINAGE_SELECTED_INVERTER_ID = null;
      window.CALPINAGE_ALLOWED = false;
    }
    try { container.removeChild(existingRoot); } catch (_) {}
  }

  _calpinageInitInFlight = true;

  /* Marquer le container avec studyId/versionId pour détecter changement d'étude au prochain init */
  container.__CALPINAGE_STUDY_ID = studyId;
  container.__CALPINAGE_VERSION_ID = versionId;

  var CALPINAGE_STYLES = `
    :root {
      --bg:#f4f1e9;
      --bg-soft:#f7f3eb;
      --card:#ffffff;
      --ink:#1f2937;
      --muted:#6b7280;
      --line:#e4ddcc;
      --brand:#c9a449;
      --brand-soft:#f1e1af;
      --brand-ink:#1a1a1a;

      --radius-lg:20px;
      --radius-md:14px;
      --radius-pill:999px;

      --shadow-soft:0 14px 40px rgba(15,23,42,0.10);
      --shadow-chip:0 6px 18px rgba(15,23,42,0.14);
      --shadow-subtle:0 6px 20px rgba(15,23,42,0.08);

      --transition-fast:150ms ease-out;
      --transition-med:220ms ease-out;

      --header-height:56px;
      --calpinage-toolbar-height:44px;
    }

    html { height: 100%; }
    * { margin:0; padding:0; box-sizing:border-box; }

    .hidden { display: none !important; }

    .calpinage-root {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: radial-gradient(circle at top left, #fbf7ee 0, #f3efe5 32%, #f4f1e9 55%, #f0ece2 100%);
      color: var(--ink);
      height: 100%;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      -webkit-font-smoothing: antialiased;
    }

    /* ================= CALPINAGE LAYOUT — 3 zones fixes ================= */
    main#calpinage-layout {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      padding: 0;
      margin: 0;
      align-items: stretch;
      justify-content: flex-start;
      max-width: 100%;
    }

    #calpinage-body {
      flex: 1;
      display: flex;
      min-height: 0;
      height: 100%;
      overflow: hidden;
      background: var(--bg);
    }

    /* ========== ZONE A ??? Colonne gauche (inspection / ?dition / contr??le), ind?pendante de la carte ========== */
    #zone-a {
      width: 280px;
      min-width: 280px;
      flex-shrink: 0;
      min-height: 0;
      height: 100%;
      align-self: stretch;
      background: var(--card);
      border-right: 1px solid var(--line);
      padding: 20px;
      overflow-y: auto;
      overflow-x: hidden;
      overscroll-behavior: contain;
      touch-action: pan-y;
      box-shadow: var(--sg-shadow-soft);
    }
    #zone-a .phase-title {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: #111827;
      margin: 0 0 8px 0;
      line-height: 1.25;
    }
    #zone-a .phase-desc {
      font-size: 13px;
      color: var(--muted);
      margin: 0 0 20px 0;
      line-height: 1.4;
    }
    .phase2-steps {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 16px 0;
      padding: 12px 14px;
      background: var(--bg-soft);
      border-radius: var(--radius-md);
      border: 1px solid var(--line);
    }
    .phase2-step {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      font-weight: 500;
      padding: 6px 0;
      transition: opacity var(--transition-fast), color var(--transition-fast);
    }
    .phase2-step-indicator {
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 1px solid var(--sg-border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 700;
      transition: border-color var(--transition-fast), background var(--transition-fast), color var(--transition-fast);
    }
    .phase2-step[data-status="inactive"] {
      opacity: 0.5;
      color: var(--sg-text-muted);
    }
    .phase2-step[data-status="inactive"] .phase2-step-indicator {
      background: var(--sg-bg-soft);
      border-color: var(--sg-border);
    }
    .phase2-step[data-status="active"] {
      color: var(--sg-brand);
    }
    .phase2-step[data-status="active"] .phase2-step-indicator {
      background: rgba(195,152,71,0.12);
      border-color: var(--sg-brand);
    }
    .phase2-step[data-status="completed"] {
      color: var(--sg-success);
    }
    .phase2-step[data-status="completed"] .phase2-step-indicator {
      background: rgba(22,163,74,0.12);
      border-color: var(--sg-success);
      position: relative;
    }
    .phase2-step[data-status="completed"] .phase2-step-indicator::after {
      content: "✓";
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 11px;
      font-weight: 700;
      color: var(--sg-success);
    }
    #zone-a .map-source-selector {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 20px;
    }
    #zone-a .map-source-selector label {
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
    }
    #zone-a .map-source-selector select {
      padding: 8px 12px;
      border-radius: var(--radius-md);
      border: 1px solid var(--line);
      font-size: 13px;
      background: var(--card);
      color: var(--ink);
    }
    #zone-a .state-block {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid var(--line);
    }
    #zone-a .state-block .state-title {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--muted);
      margin: 0 0 10px 0;
    }
    #zone-a .state-block .state-item {
      font-size: 13px;
      color: var(--ink);
      margin: 0 0 6px 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    #zone-a .state-block .state-item .icon { font-size: 14px; }
    /* Phase 2 — Design System aligné */
    #zone-a .btn-validate-roof { width: 100%; }
    #zone-a .btn-validate-roof:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    #zone-a .zone-a-validate-hint {
      font-size: 12px;
      color: var(--muted);
      margin: 8px 0 0;
    }
    #zone-a .pans-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    #zone-a .pans-list li {
      font-size: 13px;
      padding: 8px 10px;
      margin: 2px 0;
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: background var(--transition-fast);
    }
    #zone-a .pans-list li:hover {
      background: var(--bg-soft);
    }
    #zone-a .pans-list li.pan-selected {
      background: var(--brand-soft);
      color: var(--brand-ink);
      font-weight: 600;
    }

    /* Accord?on PANS : un seul pan ouvert ? la fois */
    #zone-a .pans-accordion {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    #zone-a .pans-accordion-item {
      margin: 2px 0;
      border-radius: var(--radius-md);
      border: 1px solid var(--line);
      background: var(--card);
      overflow: hidden;
    }
    #zone-a .pans-accordion-item.open {
      border-color: var(--brand);
      box-shadow: 0 0 0 1px var(--brand);
    }
    #zone-a .pans-accordion-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
      padding: 10px 12px;
      font-size: 13px;
      font-weight: 500;
      color: var(--ink);
      background: transparent;
      border: none;
      cursor: pointer;
      text-align: left;
      transition: background var(--transition-fast);
    }
    #zone-a .pans-accordion-header:hover {
      background: var(--bg-soft);
    }
    #zone-a .pans-accordion-item.open .pans-accordion-header {
      background: var(--brand-soft);
      color: var(--brand-ink);
      font-weight: 600;
    }
    #zone-a .pans-accordion-header-chevron {
      flex-shrink: 0;
      font-size: 12px;
      opacity: 0.8;
      transition: transform var(--transition-fast);
    }
    #zone-a .pans-accordion-item.open .pans-accordion-header-chevron {
      transform: rotate(180deg);
    }
    #zone-a .pans-accordion-header-label { flex: 1; min-width: 0; }
    #zone-a .pans-accordion-header-badge {
      flex-shrink: 0;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: var(--sg-radius-sm);
      text-transform: uppercase;
    }
    #zone-a .pans-accordion-header-badge.mode-auto {
      background: rgba(22,163,74,0.12);
      color: var(--sg-success);
      border: 1px solid var(--sg-success);
    }
    #zone-a .pans-accordion-header-badge.mode-manual {
      background: rgba(195,152,71,0.12);
      color: var(--sg-brand);
      border: 1px solid var(--sg-brand);
    }
    #zone-a .pans-accordion-body {
      display: none;
      padding: 12px 12px 14px;
      border-top: 1px solid var(--line);
      background: var(--bg-soft);
    }
    #zone-a .pans-accordion-item.open .pans-accordion-body {
      display: block;
    }
    #zone-a .pan-panel-row {
      margin-bottom: 10px;
      font-size: 12px;
    }
    #zone-a .pan-panel-row:last-child { margin-bottom: 0; }
    #zone-a .pan-panel-label {
      display: block;
      font-weight: 600;
      color: var(--muted);
      margin-bottom: 4px;
    }
    #zone-a .pan-panel-value { color: var(--ink); }
    #zone-a .pan-panel-inclinaison-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    #zone-a .pan-panel-inclinaison-row input[type="number"] {
      width: 64px;
      padding: 6px 8px;
      border-radius: var(--sg-radius-sm);
      border: 1px solid var(--line);
      font-size: 13px;
    }
    #zone-a .pan-panel-slope-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
    }
    #zone-a .pan-panel-slope-toggle input[type="checkbox"] {
      width: 18px;
      height: 18px;
      cursor: pointer;
    }
    #zone-a .pan-panel-slope-computed {
      font-size: 11px;
      color: var(--muted);
      margin-top: 4px;
    }

    /* ========== ZONE B ??? Barre d'action (au-dessus du plan) ========== */
    #zone-b {
      flex-shrink: 0;
      padding: 12px 20px;
      background: rgba(255,255,255,0.85);
      border-bottom: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: flex-start;
    }
    /* Phase 1 vs Phase 2 — Séparation stricte : jamais les deux simultanément */
    #zone-b .btn-capture-roof:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    /* Phase 1 : uniquement bouton capture, toolbar masquée */
    #zone-b-before-capture { display: block; }
    #zone-b-toolbar { display: none; }
    #zone-b:not(.capture-done) #zone-b-before-capture { display: block; }
    #zone-b:not(.capture-done) #zone-b-toolbar { display: none !important; }
    /* Phase 2 (après capture) : toolbar visible, bouton capture masqué */
    #zone-b.capture-done #zone-b-before-capture { display: none; }
    #zone-b.capture-done #zone-b-toolbar { display: flex !important; }

    /* ========== Calpinage Toolbar — Base commune Phase 2 & Phase 3 (hauteur alignée) ========== */
    .calpinage-toolbar-base,
    .calpinage-toolbar,
    #zone-b-toolbar.calpinage-toolbar,
    #pv-layout-dp2-toolbar.calpinage-toolbar,
    #p3-topbar {
      height: var(--calpinage-toolbar-height);
      min-height: var(--calpinage-toolbar-height);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      box-sizing: border-box;
      background: #fff;
      border: 1px solid var(--sg-border, var(--line));
      border-radius: var(--sg-radius-md);
      box-shadow: 0 1px 2px rgba(0,0,0,0.04);
    }
    .calpinage-toolbar-btn,
    .calpinage-toolbar .calpinage-tool-btn,
    .calpinage-toolbar .sg-btn.sg-btn-ghost {
      height: 36px;
      padding: 0 12px;
      border-radius: var(--sg-radius-sm);
      font-size: 13px;
      font-weight: 500;
      background: transparent;
      border: 1px solid transparent;
      color: var(--sg-text, var(--ink));
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .calpinage-toolbar-btn:hover,
    .calpinage-toolbar .calpinage-tool-btn:hover,
    .calpinage-toolbar .sg-btn.sg-btn-ghost:hover {
      background: rgba(195,152,71,0.08);
      color: var(--sg-brand);
    }
    .calpinage-toolbar-btn--active,
    .calpinage-toolbar .calpinage-tool-btn[aria-pressed="true"],
    .calpinage-toolbar .calpinage-tool-btn.calpinage-tool-active {
      background: rgba(195,152,71,0.12);
      color: var(--sg-brand);
      border: 1px solid var(--sg-brand);
    }
    /* Bascule Phase 2 / Phase 3 : une seule colonne gauche visible */
    #zone-a.phase-pv-layout #zone-a-phase2 { display: none !important; }
    #zone-a.phase-pv-layout #zone-a-phase3 { display: block !important; }
    #zone-a:not(.phase-pv-layout) #zone-a-phase2 { display: block; }
    #zone-a:not(.phase-pv-layout) #zone-a-phase3 { display: none !important; }
    #zone-a .pv-layout-block .state-title { margin-bottom: 8px; }
    #zone-a .pv-orientation-toggle { display: flex; gap: 8px; margin-top: 4px; }
    #zone-a .pv-orientation-btn {
      flex: 1; padding: 10px 14px; font-size: 13px; font-weight: 500; border: 1px solid var(--line);
      border-radius: var(--radius-md); background: var(--bg-soft); color: var(--ink); cursor: pointer;
      transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
    }
    #zone-a .pv-orientation-btn:hover { background: #ebe6dc; }
    #zone-a .pv-orientation-btn[aria-pressed="true"] {
      background: linear-gradient(135deg, #fffaf0, #f3e1b7); border-color: var(--brand);
      color: var(--brand-ink); box-shadow: var(--sg-shadow-soft);
    }
    #zone-a .pv-rotate-btn {
      display: block; width: 100%; padding: 10px 14px; font-size: 13px; font-weight: 500;
      border: 1px solid var(--line); border-radius: var(--radius-md);
      background: var(--bg-soft); color: var(--ink); cursor: pointer; margin-top: 6px;
    }
    #zone-a .pv-rotate-btn:hover { background: #ebe6dc; }
    #zone-a .pv-layout-label { display: block; font-size: 12px; font-weight: 600; color: var(--muted); margin-bottom: 6px; }
    #zone-a .pv-panel-select {
      width: 100%; padding: 8px 12px; font-size: 13px; border: 1px solid var(--line);
      border-radius: var(--radius-md); box-sizing: border-box; background: var(--bg-soft); color: var(--ink);
    }
    #zone-a .pv-panel-select-hint { margin: 6px 0 0; font-size: 12px; color: var(--muted); min-height: 1.2em; }
    #zone-a .pv-panel-loading { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
    #zone-a .pv-panel-error {
      font-size: 12px;
      color: var(--sg-error);
      border: 1px solid var(--sg-error);
      background: rgba(220,38,38,0.08);
      padding: 8px 12px;
      border-radius: var(--sg-radius-sm);
      margin-bottom: 6px;
    }
    #zone-a .pv-inverter-loading { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
    #zone-a .pv-inverter-error {
      font-size: 12px;
      color: var(--sg-error);
      border: 1px solid var(--sg-error);
      background: rgba(220,38,38,0.08);
      padding: 8px 12px;
      border-radius: var(--sg-radius-sm);
      margin-bottom: 6px;
    }
    #zone-a .pv-inverter-select { width: 100%; padding: 8px 12px; font-size: 13px; border: 1px solid var(--line); border-radius: var(--radius-md); box-sizing: border-box; background: var(--bg-soft); color: var(--ink); }
    #zone-a .pv-inverter-family-block { margin-bottom: 12px; }
    #zone-a .pv-inverter-family-block:last-of-type { margin-bottom: 0; }
    #zone-a .pv-inverter-family-title { font-size: 12px; font-weight: 600; color: var(--muted); margin-bottom: 6px; }
    #zone-a .pv-micro-info-block { margin-top: 8px; padding: 10px 12px; background: var(--bg-soft); border-radius: var(--radius-md); font-size: 13px; }
    #zone-a .pv-micro-info-block .pv-power-summary-row { margin: 4px 0; }
    #zone-a .pv-micro-info-block .pv-power-summary-row span { color: var(--muted); }
    #zone-a .pv-power-summary { margin-top: 12px; padding: 10px 12px; background: var(--bg-soft); border-radius: var(--radius-md); font-size: 13px; }
    #zone-a .pv-power-summary .pv-power-summary-row { margin: 4px 0; }
    #zone-a .pv-power-summary .pv-power-summary-row span { color: var(--muted); }
    .pv-live-summary {
      padding: 12px;
      border: 1px solid var(--brand, #c9a449);
      border-radius: var(--sg-radius-sm);
      background: rgba(0,0,0,0.03);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .pv-live-row {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
    }
    .pv-live-row strong {
      font-weight: 600;
    }
    .pv-status-ok {
      color: var(--sg-success);
      border: 1px solid var(--sg-success);
      background: rgba(22,163,74,0.08);
      padding: 2px 8px;
      border-radius: var(--sg-radius-sm);
    }
    .pv-status-warning {
      color: var(--sg-warning);
      border: 1px solid var(--sg-warning);
      background: rgba(245,158,11,0.08);
      padding: 2px 8px;
      border-radius: var(--sg-radius-sm);
    }
    .pv-status-error {
      color: var(--sg-error);
      border: 1px solid var(--sg-error);
      background: rgba(220,38,38,0.08);
      padding: 2px 8px;
      border-radius: var(--sg-radius-sm);
    }
    .p3-status-hidden { display: none; }
    .pv-live-warning { font-size: 11px; color: var(--muted, #6b7280); margin-top: 2px; }
    #zone-a .pv-live-summary-block { margin-bottom: 12px; }
    #zone-a .pv-add-block-hint { margin: 0 0 12px 0; font-size: 12px; color: var(--muted); font-style: italic; }
    #zone-a .pv-panel-search { display: none; }
    #zone-a .pv-layout-block input[type="number"] {
      width: 100%; padding: 8px 12px; font-size: 14px; border: 1px solid var(--line);
      border-radius: var(--radius-md); box-sizing: border-box;
    }
    #calpinage-body.phase-pv-layout #zone-b-toolbar { display: none !important; }
    #pv-layout-dp2-toolbar {
      display: flex !important;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }
    #zone-a .btn-back-roof { width: 100%; }
    .calpinage-toolbar.phase-locked {
      pointer-events: none;
      opacity: 0.75;
    }
    .calpinage-tool-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .calpinage-tool-icon { font-size: 16px; line-height: 1; }
    .calpinage-tool-label { white-space: nowrap; }
    .calpinage-phase2-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
    }
    .calpinage-btn-delete {
      width: 42px;
      min-width: 42px;
      padding: 0;
    }
    .calpinage-tool-obstacle-wrap { position: relative; }
    .calpinage-tool-obstacle-chevron { font-size: 10px; margin-left: 2px; opacity: 0.8; }
    .calpinage-tool-obstacle-dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      margin-top: 4px;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: var(--sg-radius-sm);
      box-shadow: var(--sg-shadow-soft);
      padding: 4px 0;
      min-width: 140px;
      z-index: 20;
    }
    .calpinage-tool-obstacle-dropdown[hidden] { display: none !important; }
    .calpinage-tool-obstacle-option {
      display: block;
      width: 100%;
      padding: 8px 14px;
      text-align: left;
      font-size: 13px;
      background: none;
      border: none;
      cursor: pointer;
      color: var(--ink);
    }
    .calpinage-tool-obstacle-option:hover { background: var(--bg-soft); }

    /* ========== Overlay dimensions obstacle Cercle / Rectangle — Design System aligné ========== */
    .sg-obstacle-overlay {
      position: absolute;
      background: #ffffff;
      border-radius: var(--sg-radius-lg);
      border: 1px solid var(--sg-border);
      box-shadow: var(--sg-shadow-soft);
      padding: 18px;
      color: var(--sg-text);
      z-index: 1000;
      min-width: 180px;
    }
    .sg-obstacle-overlay .sg-field {
      margin-bottom: 12px;
    }
    .sg-obstacle-overlay .sg-field:last-of-type { margin-bottom: 0; }
    .sg-obstacle-overlay .sg-field label {
      margin-bottom: 6px;
      display: block;
    }
    .sg-obstacle-overlay .sg-field input {
      background: var(--sg-bg);
      border: 1px solid var(--sg-border);
      border-radius: var(--sg-radius-sm);
      padding: 8px 12px;
      color: var(--sg-text);
      width: 100%;
      outline: none;
      transition: 0.2s ease;
      box-sizing: border-box;
    }
    .sg-obstacle-overlay .sg-field input:focus {
      border-color: var(--sg-brand);
      box-shadow: 0 0 0 2px rgba(195,152,71,0.2);
    }
    .sg-obstacle-overlay .sg-obstacle-overlay-actions .sg-btn-primary,
    .sg-obstacle-overlay .sg-obstacle-overlay-actions button.sg-btn-primary {
      width: 100%;
    }
    .sg-obstacle-overlay .sg-obstacle-overlay-actions .sg-btn-secondary,
    .sg-obstacle-overlay .sg-obstacle-overlay-actions button.sg-btn-secondary {
      width: 100%;
    }
    .sg-obstacle-overlay .obstacle-dim-title {
      margin-bottom: 12px;
    }
    .sg-obstacle-overlay .sg-obstacle-overlay-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 12px;
    }

    /* Dropdown Dessin toiture (contour, trait, fa??tage, mesure) */
    .calpinage-tool-dessin-wrap { position: relative; }
    .calpinage-tool-dessin-dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      margin-top: 4px;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: var(--sg-radius-sm);
      box-shadow: var(--sg-shadow-soft);
      padding: 4px 0;
      min-width: 160px;
      z-index: 20;
    }
    .calpinage-tool-dessin-dropdown[hidden] { display: none !important; }
    .calpinage-tool-dessin-option {
      display: block;
      width: 100%;
      padding: 8px 14px;
      text-align: left;
      font-size: 13px;
      background: none;
      border: none;
      cursor: pointer;
      color: var(--ink);
    }
    .calpinage-tool-dessin-option:hover { background: var(--bg-soft); }
    .calpinage-tool-dessin-option.active,
    .calpinage-tool-dessin-option[aria-pressed="true"] {
      background: #eef2ff;
      color: #4338ca;
    }

    /* ========== P3 Topbar — Barre horizontale Phase 3 (hauteur via --calpinage-toolbar-height) ========== */
    #p3-topbar {
      flex-shrink: 0;
      display: none;
      flex-direction: row;
      justify-content: flex-start;
      flex-wrap: nowrap;
    }
    #calpinage-body.phase-pv-layout #p3-topbar {
      display: flex;
    }
    .p3-topbar-group {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 8px;
    }
    .p3-topbar-tech { gap: 8px; }
    .p3-topbar-products { gap: 8px; }
    .p3-topbar-separator {
      width: 1px;
      height: 20px;
      background: var(--sg-border);
      margin: 0 6px;
    }
    #p3-topbar .p3-pill-btn,
    .p3-pill-btn {
      height: 36px;
      padding: 0 12px;
      border-radius: var(--sg-radius-sm);
      font-size: 13px;
      font-weight: 500;
      background: transparent;
      border: 1px solid transparent;
      color: var(--sg-text, var(--ink));
      line-height: 1.2;
      cursor: pointer;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    #p3-topbar .p3-pill-btn:hover,
    .p3-pill-btn:hover {
      background: rgba(195,152,71,0.08);
      color: var(--sg-brand);
    }
    .p3-pill-btn.is-active {
      background: rgba(195,152,71,0.12);
      border: 1px solid var(--sg-brand);
      color: var(--sg-brand);
    }
    .p3-pill-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .p3-pill-value { font-size: 12px; font-weight: 600; }
    .p3-pill-wrap { position: relative; }
    .p3-tech-popover {
      display: none;
      position: absolute;
      top: 100%;
      left: 0;
      margin-top: 4px;
      padding: 12px;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: var(--sg-radius-md);
      box-shadow: var(--sg-shadow-soft);
      z-index: 100;
      flex-direction: column;
      gap: 8px;
      min-width: 180px;
    }
    .p3-tech-popover.is-open {
      display: flex;
    }
    .p3-popover-label { font-size: 12px; font-weight: 600; color: var(--muted); }
    .p3-tech-popover input[type="number"] {
      width: 100%;
      padding: 8px 12px;
      font-size: 14px;
      border: 1px solid var(--line);
      border-radius: var(--sg-radius-sm);
      box-sizing: border-box;
    }
    .p3-popover-apply {
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 600;
      background: var(--brand);
      color: var(--brand-ink);
      border: none;
      border-radius: var(--sg-radius-sm);
      cursor: pointer;
    }
    .p3-popover-apply:hover { opacity: 0.9; }
    @media (max-width: 480px) {
      #p3-topbar { gap: 8px; }
    }

    /* ========== ZONE C ??? Carte / image (support) ========== */
    #zone-b-c {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }
    #zone-c {
      flex: 1;
      display: flex;
      align-items: stretch;
      justify-content: stretch;
      background: var(--bg-soft);
      overflow: hidden;
      min-width: 0;
      position: relative;
    }
    #zone-c canvas {
      display: block;
      width: 100%;
      height: 100%;
      touch-action: none;
    }
    #map-container {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      min-height: 0;
    }
    #canvas-wrapper {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: none;
    }
    #canvas-wrapper.visible {
      display: block;
    }
    .pv-layout-feedback {
      position: absolute;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      padding: 8px 16px;
      color: var(--sg-success);
      border: 1px solid var(--sg-success);
      background: rgba(22,163,74,0.08);
      font-size: 13px;
      border-radius: var(--sg-radius-sm);
      pointer-events: none;
      z-index: 10;
      opacity: 0;
      transition: opacity 120ms ease-out;
    }
    .pv-layout-feedback.visible {
      opacity: 1;
      transition: opacity 80ms ease-out;
    }
    .pv-layout-error {
      position: absolute;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      padding: 8px 16px;
      color: var(--sg-error);
      border: 1px solid var(--sg-error);
      background: rgba(220,38,38,0.08);
      font-size: 13px;
      border-radius: var(--sg-radius-sm);
      pointer-events: none;
      z-index: 10;
      opacity: 0;
      transition: opacity 120ms ease-out;
    }
    .pv-layout-error.visible {
      opacity: 1;
      transition: opacity 80ms ease-out;
    }
    #map-container.hidden {
      display: none;
    }
    @media (max-width: 900px) {
      #calpinage-body { flex-direction: column; }
      #zone-a { width: 100%; min-width: 0; max-height: 220px; border-right: none; border-bottom: 1px solid var(--line); }
      #zone-b-c { min-height: 300px; }
    }
    /* P3-02 Overlay Premium — éléments masqués (logique conservée) */
    .p3-overlay-hidden { display: none !important; }
    /* Calpinage settings overlay — P3-02 Premium */
    .p3-overlay-container { align-items: center; justify-content: center; display: none; }
    #calpinage-settings-overlay.p3-overlay-open { display: flex; }
    .p3-overlay-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.55); transition: opacity 0.2s ease; }
    .p3-overlay-modal {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) translateY(-12px);
      width: min(640px, calc(100vw - 32px));
      max-width: 640px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      background: #ffffff;
      border-radius: var(--sg-radius-lg);
      border: 1px solid var(--sg-border);
      box-shadow: var(--sg-shadow-soft);
      padding: 0;
      overflow: hidden;
      opacity: 0;
      transition: opacity 250ms ease-out, transform 250ms ease-out;
      color: var(--sg-text);
    }
    .p3-overlay-container.p3-overlay-open .p3-overlay-modal { transform: translate(-50%, -50%) translateY(0); opacity: 1; }
    .p3-overlay-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid var(--sg-border); flex-shrink: 0; }
    .p3-overlay-close {
      width: 36px;
      height: 36px;
      min-width: 36px;
      min-height: 36px;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: var(--sg-bg-soft);
      color: var(--sg-text-muted);
      font-size: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s ease, color 0.2s ease;
    }
    .p3-overlay-close:hover { background: var(--sg-border); color: var(--sg-text); }
    .p3-overlay-close:focus { outline: 2px solid var(--sg-brand); outline-offset: 2px; }
    .p3-overlay-body { padding: 24px; overflow-y: auto; overflow-x: hidden; flex: 1; min-height: 0; }
    .p3-overlay-section { margin-bottom: 24px; }
    .p3-overlay-section:last-child { margin-bottom: 0; }
    .p3-select-hidden { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; clip: rect(0,0,0,0); }
    .p3-cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
    .p3-product-card {
      background: #ffffff;
      border: 1px solid var(--sg-border);
      border-radius: var(--sg-radius-md);
      box-shadow: var(--sg-shadow-soft);
      padding: 14px;
      cursor: pointer;
      transition: border-color 0.2s ease, background 0.2s ease;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      min-height: 100px;
    }
    .p3-product-card.p3-card-active {
      border: 1px solid var(--sg-brand);
      background: rgba(195,152,71,0.06);
    }
    .p3-product-card-img {
      width: 48px;
      height: 48px;
      border-radius: var(--sg-radius-sm);
      background: rgba(195,152,71,0.08);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      margin-bottom: 8px;
      flex-shrink: 0;
    }
    .p3-product-card-name { font-size: 13px; font-weight: 600; line-height: 1.3; margin-bottom: 4px; color: var(--sg-text); }
    .p3-product-card-meta { font-size: 11px; color: var(--sg-text-muted); }
    .p3-product-card-badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: var(--sg-radius-sm);
      margin-top: 4px;
      background: rgba(195,152,71,0.12);
      color: var(--sg-brand);
    }
    .p3-params-card {
      border-radius: var(--sg-radius-md);
      padding: 16px;
      background: #ffffff;
      border: 1px solid var(--sg-border);
    }
    .p3-params-card .state-block { margin-bottom: 16px; }
    .p3-params-card .state-block:last-child { margin-bottom: 0; }
    #calpinage-settings-modal .state-block.pv-layout-block { margin-bottom: 20px; }
    #calpinage-settings-modal .state-block.pv-layout-block:last-child { margin-bottom: 0; }
    #calpinage-settings-modal .state-title { margin-bottom: 10px !important; font-size: 18px; font-weight: 600; color: var(--sg-text); }
    #calpinage-settings-modal .pv-orientation-toggle { display: flex; gap: 10px; margin-top: 6px; }
    #calpinage-settings-modal .pv-orientation-btn {
      flex: 1;
      padding: 12px 16px !important;
      font-size: 14px !important;
      font-weight: 500 !important;
      border-radius: var(--sg-radius-md) !important;
      border: 1px solid var(--sg-border) !important;
      background: #ffffff !important;
      color: var(--sg-text) !important;
      cursor: pointer;
      transition: background 0.2s ease, border-color 0.2s ease;
    }
    #calpinage-settings-modal .pv-orientation-btn:hover { border-color: var(--sg-text-muted); }
    #calpinage-settings-modal .pv-orientation-btn[aria-pressed="true"] {
      border-color: var(--sg-brand) !important;
      background: rgba(195,152,71,0.06) !important;
      color: var(--sg-text) !important;
    }
    #calpinage-settings-modal .pv-orientation-btn:focus { outline: 2px solid var(--sg-brand); outline-offset: 2px; }
    #calpinage-settings-modal .pv-orientation-btn:focus { outline: 2px solid #C39847; outline-offset: 2px; }
    #calpinage-settings-modal .pv-layout-label { display: block !important; margin-bottom: 8px !important; font-size: 14px; font-weight: 500; color: var(--sg-text); }
    #calpinage-settings-modal .pv-layout-block input[type="number"],
    #calpinage-settings-modal .pv-layout-block input[type="text"] {
      width: 100% !important;
      height: 42px !important;
      min-height: 42px !important;
      padding: 10px 14px !important;
      font-size: 14px !important;
      border-radius: var(--sg-radius-md) !important;
      border: 1px solid var(--sg-border) !important;
      background: #ffffff !important;
      color: var(--sg-text) !important;
      box-sizing: border-box !important;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    #calpinage-settings-modal .pv-layout-block input:hover { border-color: var(--sg-text-muted) !important; }
    #calpinage-settings-modal .pv-layout-block input:focus {
      outline: none !important;
      border-color: var(--sg-brand) !important;
      box-shadow: 0 0 0 2px rgba(195,152,71,0.2) !important;
    }
    #calpinage-settings-modal .pv-panel-select-hint { margin-top: 8px !important; font-size: 12px; color: var(--sg-text-muted); }
    .pv-inverter-family-block { margin-bottom: 16px; }
    .pv-inverter-family-block:last-of-type { margin-bottom: 0; }
    .pv-inverter-family-title { font-size: 14px; font-weight: 600; margin-bottom: 10px; color: var(--sg-text); }
    @media (max-width: 480px) {
      .p3-overlay-modal { width: calc(100vw - 24px); max-height: 85vh; }
      .p3-cards-grid { grid-template-columns: 1fr; }
    }
    #zone-a #btn-open-calpinage-settings { display: inline-block; width: 100%; padding: 12px 18px; font-size: 14px; font-weight: 600; border-radius: var(--sg-radius-md); border: 1px solid var(--line); background: var(--bg-soft); color: var(--ink); cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease; }
    #zone-a #btn-open-calpinage-settings:hover { background: #ebe6dc; border-color: rgba(0,0,0,0.12); box-shadow: var(--sg-shadow-soft); }
    #zone-a #btn-open-calpinage-settings:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px rgba(201,164,73,0.25); }
    #zone-a #btn-validate-calpinage { display: inline-block; width: 100%; padding: 12px 18px; font-size: 14px; font-weight: 600; border-radius: var(--sg-radius-md); border: 1px solid var(--brand); background: var(--brand); color: #111; cursor: pointer; margin-top: 8px; transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease; }
    #zone-a #btn-validate-calpinage:hover { background: #d4b85c; border-color: #d4b85c; box-shadow: var(--sg-shadow-soft); }
    #zone-a #btn-validate-calpinage:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px rgba(201,164,73,0.25); }
    #calpinage-settings-placeholder { display: none; }
    /* P3 Catalog Overlay — Overlay catalogue unique (Step 2, SAFE MODE) */
    .p3-catalog-overlay {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 9998;
    }
    .p3-catalog-overlay.is-open {
      display: flex;
    }
    .p3-catalog-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.5);
    }
    .p3-catalog-modal {
      position: relative;
      width: min(900px, calc(100vw - 40px));
      max-height: 90vh;
      overflow-y: auto;
      background: #ffffff;
      border-radius: var(--sg-radius-lg);
      border: 1px solid var(--sg-border);
      box-shadow: var(--sg-shadow-soft);
      padding: 20px;
      z-index: 1;
    }
    .p3-catalog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--sg-border);
    }
    .p3-catalog-header h2 {
      font-size: 18px;
      font-weight: 600;
      margin: 0;
      color: var(--sg-text);
    }
    #p3-catalog-close {
      width: 36px;
      height: 36px;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: var(--sg-bg-soft);
      color: var(--sg-text-muted);
      font-size: 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s ease, color 0.2s ease;
    }
    #p3-catalog-close:hover { background: var(--sg-border); color: var(--sg-text); }
    #p3-catalog-search {
      width: 100%;
      padding: 12px 16px;
      font-size: 14px;
      border: 1px solid var(--sg-border);
      border-radius: var(--sg-radius-md);
      margin-bottom: 16px;
      box-sizing: border-box;
    }
    #p3-catalog-search:focus {
      outline: none;
      border-color: var(--sg-brand);
      box-shadow: 0 0 0 2px rgba(195,152,71,0.2);
    }
    #p3-catalog-recents {
      margin-bottom: 16px;
    }
    #p3-catalog-recents:empty {
      display: none;
    }
    .p3-catalog-recents-title {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--sg-text-muted);
    }
    #p3-catalog-suggestions {
      margin-bottom: 16px;
    }
    #p3-catalog-suggestions:empty {
      display: none;
    }
    #p3-catalog-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 16px;
    }
    .p3-catalog-overlay .p3-product-card {
      aspect-ratio: 1 / 1;
      padding: 10px;
      min-height: 0;
      justify-content: center;
    }
    .p3-catalog-overlay .p3-cards-grid {
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 16px;
    }
    #p3-catalog-load-more {
      display: block;
      width: 100%;
      margin-top: 16px;
      padding: 12px 16px;
      font-size: 14px;
      font-weight: 600;
      border: 1px solid var(--sg-border);
      border-radius: var(--sg-radius-md);
      background: var(--sg-bg-soft);
      color: var(--sg-text);
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    #p3-catalog-load-more:hover { background: var(--sg-border); }
    #p3-catalog-load-more:disabled {
      display: none;
    }
  `;

  var CALPINAGE_HTML = `
  <main id="calpinage-layout" class="calpinage-root">
    <section id="calpinage-body">
      <!-- ZONE A — Colonne gauche : Phase 2 (Relevé toiture) ou Phase 3 (Implantation panneaux), une seule visible -->
      <aside id="zone-a">
        <div id="zone-a-phase2" class="zone-a-phase-block">
          <h2 class="phase-title" id="zone-a-phase-title">Phase 2 — Relevé toiture</h2>
          <p class="phase-desc" id="zone-a-phase-desc">Dessinez le toit réel : contour, faîtages, obstacles et mesures. Aucun panneau, aucun calcul solaire.</p>
          <div id="p2-sidebar-react-mount"></div>
          <div id="p2-legacy-triggers" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);visibility:hidden;pointer-events:none;" aria-hidden="true">
            <button type="button" class="btn-validate-roof sg-btn sg-btn-primary" id="btn-validate-roof" disabled title="Contour bâti valide et au moins un pan requis">Valider le relevé toiture</button>
          </div>
        </div>
        <div id="zone-a-phase3" class="zone-a-phase-block" style="display: none;">
          <div id="p3-sidebar-react-mount"></div>
          <p id="pv-add-block-hint" class="pv-add-block-hint" aria-live="polite" style="display: none;">Cliquez sur un pan pour ajouter un bloc de panneaux</p>
          <div id="p3-legacy-triggers" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);visibility:hidden;pointer-events:none;" aria-hidden="true">
            <button type="button" id="btn-open-calpinage-settings">Paramètres calpinage</button>
            <button type="button" id="btn-validate-calpinage" disabled title="Valider définitivement le calepinage et calculer le résultat">Valider le calepinage</button>
            <button type="button" id="btn-back-roof" title="Revenir au relevé toiture et invalider les panneaux posés">← Retour au relevé toiture</button>
            <button type="button" id="btn-show-horizon-mask" style="display:none" disabled title="Afficher le masque d'horizon (ombrage lointain)">Masque d'horizon</button>
            <button type="button" id="btn-preview-3d" style="display:none" title="Aperçu 3D du modèle (houseModelV2)">Aperçu 3D</button>
            <div id="pv-layout-dp2-toolbar" class="calpinage-toolbar" role="toolbar">
              <button type="button" id="pv-tool-panels" data-tool="panels" title="Ajouter des panneaux">⊕</button>
              <button type="button" id="pv-tool-select" data-tool="select" title="Sélectionner">Select</button>
            </div>
          </div>
          <div id="calpinage-settings-placeholder">
            <div id="calpinage-settings-block" class="p3-overlay-block">
          <!-- Section Panneaux -->
          <section class="p3-overlay-section p3-section-panels">
            <div class="state-block pv-layout-block" id="pv-panel-selection-block">
              <div class="state-title p3-section-title">Module photovoltaïque</div>
              <div id="pv-panel-loading" class="pv-panel-loading" style="display:none;">Chargement du catalogue…</div>
              <div id="pv-panel-error" class="pv-panel-error" style="display:none;"></div>
              <div class="p3-product-cards">
                <select id="pv-panel-select" class="pv-panel-select p3-select-hidden" aria-label="Choisir le module photovoltaïque" disabled>
                  <option value="">— Choisir un panneau —</option>
                </select>
                <div id="pv-panel-cards" class="p3-cards-grid" role="listbox" aria-label="Modules photovoltaïques"></div>
              </div>
              <p class="pv-panel-select-hint" id="pv-panel-select-hint" aria-live="polite"></p>
            </div>
          </section>
          <!-- Section Onduleur -->
          <section class="p3-overlay-section p3-section-inverter">
            <div class="state-block pv-layout-block" id="pv-inverter-selection-block">
              <div class="state-title p3-section-title">Onduleur</div>
              <div id="pv-inverter-loading" class="pv-inverter-loading" style="display:none;">Chargement onduleurs…</div>
              <div id="pv-inverter-error" class="pv-inverter-error" style="display:none;"></div>
              <div class="pv-inverter-family-block" id="pv-inverter-central-block">
                <div class="pv-inverter-family-title">Onduleurs centraux</div>
                <div class="p3-product-cards">
                  <select id="pv-inverter-select-central" class="pv-inverter-select p3-select-hidden" aria-label="Choisir un onduleur central" disabled>
                    <option value="">— Choisir un onduleur central —</option>
                  </select>
                  <div id="pv-inverter-cards-central" class="p3-cards-grid" role="listbox" aria-label="Onduleurs centraux"></div>
                </div>
              </div>
              <div class="pv-inverter-family-block" id="pv-inverter-micro-block">
                <div class="pv-inverter-family-title">Micro-onduleurs</div>
                <div class="p3-product-cards">
                  <select id="pv-inverter-select-micro" class="pv-inverter-select p3-select-hidden" aria-label="Choisir un micro-onduleur" disabled>
                    <option value="">— Choisir un micro-onduleur —</option>
                  </select>
                  <div id="pv-inverter-cards-micro" class="p3-cards-grid" role="listbox" aria-label="Micro-onduleurs"></div>
                </div>
              </div>
              <div class="pv-power-summary-row p3-overlay-hidden" id="pv-inverters-required-row" style="margin-top:6px;font-size:13px;"><span>Onduleurs requis :</span> <strong id="pv-inverters-required">—</strong></div>
              <div id="pv-micro-info-block" class="pv-micro-info-block p3-overlay-hidden" style="display:none;">
                <div class="pv-power-summary-row"><span>Nombre de micro-onduleurs :</span> <strong id="pv-micro-count">—</strong></div>
                <div class="pv-power-summary-row"><span>Puissance AC totale estimée :</span> <strong id="pv-micro-ac-total">—</strong> kW</div>
              </div>
            </div>
            <div id="pv-power-summary" class="pv-power-summary p3-overlay-hidden" style="display:none;">
              <div class="pv-power-summary-row"><span>Panneaux posés :</span> <strong id="pv-panels-count">0</strong></div>
              <div class="pv-power-summary-row"><span>Puissance totale :</span> <strong id="pv-total-kwc">0</strong> kWc</div>
            </div>
            <input type="text" id="pv-panel-search" class="pv-panel-search" placeholder="Recherche (à venir)" disabled hidden aria-label="Rechercher un panneau" />
          </div>
          <!-- Section Paramètres -->
          <section class="p3-overlay-section p3-section-params">
            <div class="p3-params-card">
              <div class="state-title p3-section-title">Paramètres d'implantation</div>
              <div class="state-block pv-layout-block">
                <div class="state-title">Orientation des modules</div>
                <div class="pv-orientation-toggle" role="group" aria-label="Orientation des modules">
                  <button type="button" class="pv-orientation-btn" id="pv-layout-orient-portrait" data-orientation="PORTRAIT" aria-pressed="true">Portrait</button>
                  <button type="button" class="pv-orientation-btn" id="pv-layout-orient-paysage" data-orientation="PAYSAGE" aria-pressed="false">Paysage</button>
                </div>
              </div>
              <div class="state-block pv-layout-block">
                <label class="pv-layout-label" for="pv-layout-margin-cm">Marge extérieure (cm)</label>
                <input type="number" id="pv-layout-margin-cm" min="0" value="20" step="1" aria-label="Marge extérieure en centimètres" />
              </div>
              <div class="state-block pv-layout-block">
                <label class="pv-layout-label" for="pv-layout-spacing-x-cm">Espacement entre panneaux (cm)</label>
                <input type="number" id="pv-layout-spacing-x-cm" min="0" value="2" step="1" aria-label="Espacement horizontal entre panneaux en centimètres" />
              </div>
              <div class="state-block pv-layout-block">
                <label class="pv-layout-label" for="pv-layout-spacing-y-cm">Espacement entre rangées (cm)</label>
                <input type="number" id="pv-layout-spacing-y-cm" min="0" value="4.5" step="1" aria-label="Espacement entre rangées en centimètres" />
              </div>
            </div>
          </section>
            </div>
          </div>

        </div>
      </aside>

<div id="zone-b-c">
        <!-- ZONE B — Barre au-dessus du plan : avant capture = bouton ; après = barre d’outils dessin (ordre DP4) -->
        <div id="zone-b">
          <div id="zone-b-before-capture">
            <button type="button" class="btn-capture-roof sg-btn sg-btn-primary" id="btn-capture-roof" title="Cadrez la carte (zoom, orientation, centre), puis capturez. Échelle et Nord automatiques.">Capturer la toiture</button>
          </div>

          <div id="zone-b-toolbar" class="calpinage-toolbar" role="toolbar" aria-label="Outils de relevé toiture">
            <button type="button" class="calpinage-tool-btn sg-btn sg-btn-ghost" id="calpinage-tool-select" data-tool="select" title="Sélection (éditer / déplacer / supprimer)">
              <span class="sg-icon-wrapper"><span class="calpinage-tool-icon" aria-hidden="true"></span></span>
              <span class="calpinage-tool-label">Sélection</span>
            </button>
            <div class="calpinage-tool-dessin-wrap" role="group" aria-label="Dessin toiture">
              <button type="button" class="calpinage-tool-btn sg-btn sg-btn-ghost" id="calpinage-tool-dessin-toiture" title="Dessin toiture (contour, trait, faîtage)">
                <span class="sg-icon-wrapper" aria-hidden="true"><svg class="sg-icon" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${SG_P2_ICONS.roofDraw}</svg></span>
                <span class="calpinage-tool-label">Dessin toiture</span>
                <span class="calpinage-tool-obstacle-chevron" aria-hidden="true">▾</span>
              </button>

              <div class="calpinage-tool-dessin-dropdown" id="calpinage-dessin-toiture-dropdown" hidden>
                <button type="button" class="calpinage-tool-dessin-option" data-tool="contour" title="Contour bâti (polygone du toit)">
                  <span class="sg-icon-wrapper" aria-hidden="true"><svg class="sg-icon" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${SG_P2_ICONS.buildingOutline}</svg></span>
                  <span class="calpinage-tool-label">Contour bâti</span>
                </button>
                <button type="button" class="calpinage-tool-dessin-option" data-tool="trait" title="Arête (ligne libre)">
                  <span class="sg-icon-wrapper" aria-hidden="true"><svg class="sg-icon" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${SG_P2_ICONS.edge}</svg></span>
                  <span class="calpinage-tool-label">Arête</span>
                </button>
                <button type="button" class="calpinage-tool-dessin-option" data-tool="ridge" title="Faîtage (ligne de rupture)">
                  <span class="sg-icon-wrapper" aria-hidden="true"><svg class="sg-icon" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${SG_P2_ICONS.ridge}</svg></span>
                  <span class="calpinage-tool-label">Faîtage</span>
                </button>
              </div>
            </div>

            <button type="button" class="calpinage-tool-btn sg-btn sg-btn-ghost" id="calpinage-btn-height-edit" aria-pressed="false" title="Mode éditer les hauteurs (contours, faîtages, traits)">
              <span class="sg-icon-wrapper" aria-hidden="true"><svg class="sg-icon" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${SG_P2_ICONS.heightEdit}</svg></span>
              <span class="calpinage-tool-label">Éditer les hauteurs</span>
            </button>

            <div class="calpinage-tool-obstacle-wrap" role="group" aria-label="Obstacle toiture">
              <button type="button" class="calpinage-tool-btn sg-btn sg-btn-ghost" id="calpinage-tool-obstacle" title="Obstacle toiture (cheminée, lucarne, VMC — emprise au sol)">
                <span class="sg-icon-wrapper" aria-hidden="true"><svg class="sg-icon" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${SG_P2_ICONS.roofObstacle}</svg></span>
                <span class="calpinage-tool-label">Obstacle toiture</span>
                <span class="calpinage-tool-obstacle-chevron" aria-hidden="true">▾</span>
              </button>

              <div class="calpinage-tool-obstacle-dropdown" id="calpinage-obstacle-dropdown" hidden>
                <button type="button" class="calpinage-tool-obstacle-option" data-obstacle-shape="circle" title="Cercle (cheminée, VMC)">
                  <span class="sg-icon-wrapper" aria-hidden="true"><svg class="sg-icon" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${SG_P2_ICONS.circle}</svg></span>
                  <span class="calpinage-tool-label">Cercle</span>
                </button>
                <button type="button" class="calpinage-tool-obstacle-option" data-obstacle-shape="rect" title="Rectangle (lucarne, Velux, acrotère)">
                  <span class="sg-icon-wrapper" aria-hidden="true"><svg class="sg-icon" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${SG_P2_ICONS.rect}</svg></span>
                  <span class="calpinage-tool-label">Rectangle</span>
                </button>
                <button type="button" class="calpinage-tool-obstacle-option" data-obstacle-shape="polygon" title="Polygone libre">
                  <span class="sg-icon-wrapper" aria-hidden="true"><svg class="sg-icon" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${SG_P2_ICONS.polygon}</svg></span>
                  <span class="calpinage-tool-label">Polygone libre</span>
                </button>
              </div>
            </div>

            <div class="calpinage-tool-obstacle-wrap" role="group" aria-label="Obstacle ombrant">
              <button type="button" class="calpinage-tool-btn sg-btn sg-btn-ghost" id="calpinage-tool-shadow-volume" title="Obstacle ombrant (volume 3D)">
                <span class="sg-icon-wrapper" aria-hidden="true"><svg class="sg-icon" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${SG_P2_ICONS.shadingObstacle}</svg></span>
                <span class="calpinage-tool-label">Obstacle ombrant</span>
                <span class="calpinage-tool-obstacle-chevron" aria-hidden="true">▾</span>
              </button>
              <div class="calpinage-tool-obstacle-dropdown" id="calpinage-shadow-volume-dropdown" hidden>
                <button type="button" class="calpinage-tool-obstacle-option" data-shadow-shape="cube" title="Cube (prisme rectangulaire)">
                  <span class="sg-icon-wrapper" aria-hidden="true"><svg class="sg-icon" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${SG_P2_ICONS.cube}</svg></span>
                  <span class="calpinage-tool-label">Cube</span>
                </button>
                <button type="button" class="calpinage-tool-obstacle-option" data-shadow-shape="tube" title="Tube (cylindre)">
                  <span class="sg-icon-wrapper" aria-hidden="true"><svg class="sg-icon" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${SG_P2_ICONS.tube}</svg></span>
                  <span class="calpinage-tool-label">Tube</span>
                </button>
              </div>
            </div>

            <div class="calpinage-tool-obstacle-wrap" role="group" aria-label="Extension toiture">
              <button type="button" class="calpinage-tool-btn sg-btn sg-btn-ghost" id="calpinage-tool-roof-extension" title="Extension toiture (chien assis)">
                <span class="sg-icon-wrapper" aria-hidden="true"><svg class="sg-icon" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${SG_P2_ICONS.roofExtension}</svg></span>
                <span class="calpinage-tool-label">Extension toiture</span>
                <span class="calpinage-tool-obstacle-chevron" aria-hidden="true">▾</span>
              </button>
              <div class="calpinage-tool-obstacle-dropdown" id="calpinage-roof-extension-dropdown" hidden>
                <button type="button" class="calpinage-tool-obstacle-option" data-dormer-tool="contour" title="Chien assis — Contour">
                  <span class="calpinage-tool-label">Chien assis — Contour</span>
                </button>
                <button type="button" class="calpinage-tool-obstacle-option" data-dormer-tool="hips" title="Chien assis — Arêtiers">
                  <span class="calpinage-tool-label">Chien assis — Arêtiers</span>
                </button>
                <button type="button" class="calpinage-tool-obstacle-option" data-dormer-tool="ridge" title="Chien assis — Faîtage">
                  <span class="calpinage-tool-label">Chien assis — Faîtage</span>
                </button>
              </div>
            </div>

            <div class="calpinage-phase2-actions">
              <button type="button" class="calpinage-btn-delete sg-btn sg-btn-danger" title="Supprimer"><span class="sg-icon-wrapper" aria-hidden="true"><svg class="sg-icon" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></span></button>
            </div>
          </div>
        <!-- P3 Topbar — Barre horizontale Phase 3 (au-dessus du plan), enfant de #zone-b pour alignement structurel Phase 2/3 -->
        <div id="p3-topbar" class="p3-topbar" role="toolbar" aria-label="Paramètres implantation Phase 3">
          <div class="p3-topbar-group p3-topbar-tech">
            <div class="p3-pill-wrap">
              <button type="button" class="p3-pill-btn" id="p3-pill-spacing-x" data-tech="spacing-x" title="Espacement entre panneaux (cm)">
                <span class="p3-pill-label">Espacement panneaux</span>
                <span class="p3-pill-value" id="p3-pill-spacing-x-value">—</span>
              </button>
              <div id="p3-popover-spacing-x" class="p3-tech-popover" aria-hidden="true">
                <label class="p3-popover-label" for="p3-popover-spacing-x-input">Espacement entre panneaux (cm)</label>
                <input type="number" id="p3-popover-spacing-x-input" min="0" value="2" step="1" aria-label="Espacement horizontal entre panneaux" />
                <button type="button" class="p3-popover-apply" data-tech="spacing-x">Appliquer</button>
              </div>
            </div>
            <div class="p3-pill-wrap">
              <button type="button" class="p3-pill-btn" id="p3-pill-spacing-y" data-tech="spacing-y" title="Espacement entre rangées (cm)">
                <span class="p3-pill-label">Espacement rangées</span>
                <span class="p3-pill-value" id="p3-pill-spacing-y-value">—</span>
              </button>
              <div id="p3-popover-spacing-y" class="p3-tech-popover" aria-hidden="true">
                <label class="p3-popover-label" for="p3-popover-spacing-y-input">Espacement entre rangées (cm)</label>
                <input type="number" id="p3-popover-spacing-y-input" min="0" value="4.5" step="1" aria-label="Espacement entre rangées" />
                <button type="button" class="p3-popover-apply" data-tech="spacing-y">Appliquer</button>
              </div>
            </div>
            <div class="p3-pill-wrap">
              <button type="button" class="p3-pill-btn" id="p3-pill-margin" data-tech="margin" title="Marge extérieure (cm)">
                <span class="p3-pill-label">Marge bord</span>
                <span class="p3-pill-value" id="p3-pill-margin-value">—</span>
              </button>
              <div id="p3-popover-margin" class="p3-tech-popover" aria-hidden="true">
                <label class="p3-popover-label" for="p3-popover-margin-input">Marge extérieure (cm)</label>
                <input type="number" id="p3-popover-margin-input" min="0" value="20" step="1" aria-label="Marge extérieure" />
                <button type="button" class="p3-popover-apply" data-tech="margin">Appliquer</button>
              </div>
            </div>
          </div>
          <div class="p3-topbar-separator"></div>
          <div class="p3-topbar-group p3-topbar-products">
            <button type="button" class="p3-pill-btn p3-pill-product" id="p3-pill-module" data-product="panel" title="Choisir un module">
              <span class="p3-pill-label">Module</span>
              <span class="p3-pill-value" id="p3-pill-module-value">Choisir…</span>
            </button>
            <button type="button" class="p3-pill-btn p3-pill-product" id="p3-pill-micro" data-product="micro" title="Choisir un micro-onduleur">
              <span class="p3-pill-label">Micro-onduleur</span>
              <span class="p3-pill-value" id="p3-pill-micro-value">Choisir…</span>
            </button>
            <button type="button" class="p3-pill-btn p3-pill-product" id="p3-pill-central" data-product="central" title="Choisir un onduleur central">
              <span class="p3-pill-label">Onduleur</span>
              <span class="p3-pill-value" id="p3-pill-central-value">Choisir…</span>
            </button>
          </div>
        </div>
        </div>
        <!-- ZONE C ??? Carte + dessin 2D -->
        <section id="zone-c">
          <div id="map-container"></div>
          <div id="canvas-wrapper">
            <canvas id="calpinage-canvas-el"></canvas>
            <div id="height-edit-inplace-container" style="position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:100;overflow:visible;"></div>
            <div id="pv-layout-error" class="pv-layout-error" aria-live="polite"></div>
            <div id="pv-layout-feedback" class="pv-layout-feedback" aria-live="polite" style="display: none;">Bloc de panneaux validé</div>
            <div id="calpinage-shadow-volume-overlay" class="sg-obstacle-overlay" style="display:none;top:20px;left:20px;">
              <div class="obstacle-dim-title sg-title-md">Volume ombrant</div>
              <div class="sg-field">
                <label class="sg-label">Largeur (m)</label>
                <input type="number" id="shadow-volume-width" step="0.01" min="0.01" />
              </div>
              <div class="sg-field">
                <label class="sg-label">Profondeur (m)</label>
                <input type="number" id="shadow-volume-depth" step="0.01" min="0.01" />
              </div>
              <div class="sg-field">
                <label class="sg-label">Hauteur (m)</label>
                <input type="number" id="shadow-volume-height" step="0.01" min="0.01" />
              </div>
              <div class="sg-field">
                <label class="sg-label">Rotation (°)</label>
                <input type="number" id="shadow-volume-rotation" step="1" />
              </div>
              <div class="sg-obstacle-overlay-actions">
                <button type="button" id="shadow-volume-apply" class="sg-btn sg-btn-primary">Valider</button>
                <button type="button" id="shadow-volume-cancel" class="sg-btn sg-btn-secondary">Annuler</button>
              </div>
            </div>
            <div id="calpinage-obstacle-dim-overlay" class="sg-obstacle-overlay" style="display:none;top:20px;left:20px;">
              <div class="obstacle-dim-title sg-title-md">Dimensions obstacle</div>
              <div id="obstacle-dim-circle" style="display:none;">
                <div class="sg-field">
                  <label class="sg-label">Diamètre (m)</label>
                  <input type="number" id="obstacle-dim-diameter" step="0.01" min="0.01" />
                </div>
              </div>
              <div id="obstacle-dim-rect" style="display:none;">
                <div class="sg-field">
                  <label class="sg-label">Largeur (m)</label>
                  <input type="number" id="obstacle-dim-width" step="0.01" min="0.01" />
                </div>
                <div class="sg-field">
                  <label class="sg-label">Hauteur (m)</label>
                  <input type="number" id="obstacle-dim-height" step="0.01" min="0.01" />
                </div>
              </div>
              <div class="sg-obstacle-overlay-actions">
                <button type="button" id="obstacle-dim-apply" class="sg-btn sg-btn-primary">Appliquer</button>
                <button type="button" id="obstacle-dim-cancel" class="sg-btn sg-btn-secondary">Annuler</button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  </main>
  <div id="calpinage-settings-overlay" class="p3-overlay-container" style="display:none;position:fixed;inset:0;z-index:9999;">
    <div id="calpinage-settings-backdrop" class="p3-overlay-backdrop"></div>
    <div id="calpinage-settings-modal" class="p3-overlay-modal">
      <header class="p3-overlay-header">
        <h2 class="p3-overlay-title sg-title-lg">Paramètres calpinage</h2>
        <button type="button" id="btn-close-calpinage-settings" class="p3-overlay-close" aria-label="Fermer">✕</button>
      </header>
      <div id="calpinage-settings-content-slot" class="p3-overlay-body"></div>
    </div>
  </div>
  <div id="p3-catalog-overlay" class="p3-catalog-overlay">
    <div class="p3-catalog-backdrop"></div>
    <div class="p3-catalog-modal">
      <header class="p3-catalog-header">
        <h2 id="p3-catalog-title" class="sg-title-lg"></h2>
        <button type="button" id="p3-catalog-close" aria-label="Fermer">×</button>
      </header>
      <input type="text" id="p3-catalog-search" placeholder="Rechercher par nom ou marque…" />
      <div id="p3-catalog-recents"></div>
      <div id="p3-catalog-suggestions"></div>
      <div id="p3-catalog-list"></div>
      <button type="button" id="p3-catalog-load-more">Charger plus</button>
    </div>
  </div>
  <div id="calpinage-preview-3d-overlay" style="display:none;position:fixed;inset:0;z-index:9998;background:#111;">
    <div style="position:absolute;top:8px;right:8px;z-index:10;">
      <button type="button" id="btn-close-preview-3d" style="padding:8px 12px;background:#333;color:#fff;border:none;border-radius:var(--sg-radius-sm);cursor:pointer;">Fermer</button>
    </div>
    <div id="calpinage-preview-3d-container" style="position:absolute;inset:0;top:48px;"></div>
  </div>
  `;

  /* Root interne : le legacy manipule UNIQUEMENT ce div, jamais le container React.
   * Pas de vidage du container (interdit). Le container est vide par design (CalpinageApp). */
  var innerRoot = document.createElement("div");
  innerRoot.id = "calpinage-root";
  innerRoot.innerHTML = "<style>" + CALPINAGE_STYLES + "</style>" + CALPINAGE_HTML;
  container.appendChild(innerRoot);

  if (devLog) {
    var htmlLen = (CALPINAGE_STYLES + CALPINAGE_HTML).length;
    var mapEl = container.querySelector("#map-container");
    var canvasEl = container.querySelector("#calpinage-canvas-el");
    var btnVal = container.querySelector("#btn-validate-calpinage");
    console.log("[CALPINAGE] after innerHTML: htmlLen=" + htmlLen + " #map-container=" + !!mapEl + " #calpinage-canvas-el=" + !!canvasEl + " #btn-validate-calpinage=" + !!btnVal);
  }

  (function () {

    /* ============================================================
       CALPINAGE ??? NORD : SUPPRESSION EXISTANT + BOUSSOLE PRO
    ============================================================ */
    (function initCalpinageNorthCompass() {
      if (!innerRoot || !innerRoot.isConnected) return;

      /* ??TAPE 1 ??? Supprimer tout nord existant (Google Maps / Canvas / HTML) */
      innerRoot.querySelectorAll(
        "#north-arrow, #north-arrow-overlay, .north-arrow, .north-compass"
      ).forEach(function (el) { el.remove(); });

      if (window.google && window.google.maps && window.calpinageMap) {
        try {
          var map = window.calpinageMap;
          Object.keys(google.maps.ControlPosition).forEach(function (key) {
            var pos = google.maps.ControlPosition[key];
            var controls = map.controls[pos];
            if (controls && controls.clear) controls.clear();
          });
        } catch (e) {
          console.warn("Nord Google Maps non supprim? automatiquement", e);
        }
      }

      var hideStyle = document.createElement("style");
      hideStyle.innerHTML = "canvas[data-north],.gm-style .north,.gm-style .compass,.gm-style canvas+div{display:none!important}";
      innerRoot.appendChild(hideStyle);

      /* ??TAPE 2 ??? Cr?ation de la boussole pro (la seule) */
      if (innerRoot.querySelector("#calpinage-north-compass")) return;

      var compass = document.createElement("div");
      compass.id = "calpinage-north-compass";
      compass.innerHTML = "<div class=\"compass-ring\"><div class=\"compass-needle\"></div></div>";
      innerRoot.appendChild(compass);

      var style = document.createElement("style");
      style.innerHTML = "#calpinage-north-compass{position:fixed;bottom:24px;right:24px;width:48px;height:48px;z-index:999999;pointer-events:none}.compass-ring{width:100%;height:100%;border:1.5px solid #111;border-radius:50%;background:rgba(255,255,255,0.9);display:flex;align-items:center;justify-content:center}.compass-needle{width:2px;height:18px;background:#111;position:relative;transform-origin:center bottom}.compass-needle::after{content:'';position:absolute;top:-6px;left:-4px;border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:6px solid #111}";
      innerRoot.appendChild(style);

      /* Synchro rotation avec la carte (2D / 3D) */
      var compassRafId = null;
      var compassActive = true;
      function syncCompass() {
        if (!compassActive) return;
        var bearing = 0;
        if (window.calpinageMap && typeof window.calpinageMap.getHeading === "function") {
          bearing = window.calpinageMap.getHeading() || 0;
        }
        if (window.calpinageViewRotation !== undefined) {
          bearing = window.calpinageViewRotation;
        }
        compass.style.transform = "rotate(" + (-bearing) + "deg)";
        compassRafId = requestAnimationFrame(syncCompass);
      }
      syncCompass();
      cleanupTasks.push(function () {
        compassActive = false;
        if (compassRafId != null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(compassRafId);
      });
    })();
    (function () {
      var GOOGLE_MAPS_API_KEY = "__GOOGLE_API_KEY__";

      var mapContainer = container.querySelector("#map-container");
      var canvasWrapper = container.querySelector("#canvas-wrapper");
      var canvasEl = container.querySelector("#calpinage-canvas-el");
      var zoneB = container.querySelector("#zone-b");
      var stateCaptureEl = container.querySelector("#state-capture");
      var stateCaptureText = container.querySelector("#state-capture-text");
      var btnCapture = container.querySelector("#btn-capture-roof");

      if (devLog && mapContainer && canvasEl) {
        var cs = canvasEl.getBoundingClientRect ? canvasEl.getBoundingClientRect() : null;
        var style = canvasEl.style || {};
        console.log("[CALPINAGE] map/canvas init: canvas width=" + (canvasEl.width || 0) + " height=" + (canvasEl.height || 0) + " getBoundingClientRect=" + (cs ? cs.width + "x" + cs.height : "n/a") + " display=" + (style.display || "default") + " zIndex=" + (style.zIndex || "default") + " pointerEvents=" + (style.pointerEvents || "default"));
      }
      if (!mapContainer || !canvasWrapper || !canvasEl || !btnCapture) {
        var missing = [];
        if (!mapContainer) missing.push("map-container");
        if (!canvasWrapper) missing.push("canvas-wrapper");
        if (!canvasEl) missing.push("calpinage-canvas-el");
        if (!btnCapture) missing.push("btn-capture-roof");
        var errMsg = "Calpinage : éléments DOM manquants (" + missing.join(", ") + "). Vérifiez l'intégrité du module.";
        console.error("[CALPINAGE] bootstrap aborted", { missing: missing });
        var errEl = innerRoot.querySelector("#calpinage-body") || innerRoot;
        if (errEl && errEl.isConnected) {
          var msg = document.createElement("div");
          msg.style.cssText = "padding:20px;color:#b91c1c;font-size:14px;text-align:center;background:#fef2f2;";
          msg.textContent = errMsg;
          errEl.appendChild(msg);
        }
        throw new Error(errMsg);
      }

      var CalpinageCanvas = window.CalpinageCanvas;
      var CalpinageMap = window.CalpinageMap;
      var CalpinagePans = window.CalpinagePans;
      if (!CalpinageCanvas || !CalpinageMap || !CalpinagePans) {
        var missingDeps = [(!CalpinageCanvas && "CalpinageCanvas"), (!CalpinageMap && "CalpinageMap"), (!CalpinagePans && "CalpinagePans")].filter(Boolean);
        var errMsg2 = "Calpinage : dépendances manquantes (" + missingDeps.join(", ") + "). Vérifiez que les bundles /calpinage/*.js sont chargés (URLs absolues, pas de 404).";
        console.error("[CALPINAGE] bootstrap aborted", { missing: missingDeps });
        var errEl2 = innerRoot.querySelector("#calpinage-body") || innerRoot;
        if (errEl2 && errEl2.isConnected) {
          var msg2 = document.createElement("div");
          msg2.style.cssText = "padding:20px;color:#b91c1c;font-size:14px;text-align:center;background:#fef2f2;";
          msg2.textContent = errMsg2;
          errEl2.appendChild(msg2);
        }
        throw new Error(errMsg2);
      }

      var mapApi = null;
      /** Moteur canvas actuel (pour resize/destroy). */
      var currentCanvasEngine = null;
      /** RAF en cours pour debounce resize. */
      var resizeRafId = null;
      /** RAF en cours pour la boucle de render (annulé au cleanup). */
      var renderRafId = null;
      /** Handler resize fenêtre (pour cleanup). */
      var resizeHandler = null;
      /** Centre maison (lead) mémorisé pour recentrage après changement de fond de carte. */
      var initialLeadCenter = null;
      /** true si l'utilisateur a déplacé la carte manuellement → on ne recentre pas au changement de layer. */
      var userMovedMap = false;

      var CALPINAGE_STORAGE_KEY = "calpinage-state";
      var CALPINAGE_PV_PARAMS_KEY = "calpinage-pv-params";
      var CALPINAGE_HORIZON_MASK_KEY = "calpinage-horizon-mask";

      /** CP-004 — Clé scopée via helper centralisé. Format: calpinage:{studyId}:{versionId}:{baseKey} */
      function getScopedKey(baseKey, studyId, versionId) {
        var sid = studyId != null ? studyId : (typeof window !== "undefined" && window.CALPINAGE_STUDY_ID);
        var vid = versionId != null ? versionId : (typeof window !== "undefined" && window.CALPINAGE_VERSION_ID);
        return getCalpinageScopedKeyFromLegacy(baseKey, sid, vid);
      }

      /** true apr?s validation du mod?le (Phase 3) ; requis pour acc?der au calepinage panneaux */
      window.CALPINAGE_ALLOWED = false;

      /* ??chelle DP4 : m??me constante que frontend/dp-tool/dp-app.js (Web Mercator, tuiles 256px). */
      var INITIAL_RES = 156543.03392804097;

      /** Charge les coordonnées du lead depuis l'API study (pour centrage carte). */
      async function loadLeadCoordinates(studyId) {
        if (!studyId) return null;
        try {
          var apiBase = (window.CALPINAGE_API_BASE != null ? window.CALPINAGE_API_BASE : (window.location && window.location.origin)) || "";
          var token = localStorage.getItem("solarnext_token");
          var headers = { "Content-Type": "application/json" };
          if (token) headers["Authorization"] = "Bearer " + token;
          var res = await fetch(apiBase + "/api/studies/" + encodeURIComponent(studyId), { headers });
          if (!res.ok) return null;
          var data = await res.json();
          var lat = data && data.lead && data.lead.lat;
          var lng = data && data.lead && data.lead.lng;
          if (typeof lat === "number" && typeof lng === "number") return [lat, lng];
          return null;
        } catch (err) {
          console.warn("[Calpinage] Unable to load lead coordinates", err);
          return null;
        }
      }

      /** Centre initial : mapCenter/roofState.map > lead > France. */
      function getInitialCenter(stateOrGeom, leadCoords) {
        var mapCenter = (stateOrGeom && stateOrGeom.roofState && stateOrGeom.roofState.map && stateOrGeom.roofState.map.centerLatLng)
          || (stateOrGeom && stateOrGeom.mapCenter)
          || (stateOrGeom && stateOrGeom.roof && stateOrGeom.roof.map && stateOrGeom.roof.map.centerLatLng);
        if (mapCenter && typeof mapCenter.lat === "number" && typeof mapCenter.lng === "number") {
          return [mapCenter.lat, mapCenter.lng];
        }
        if (leadCoords && Array.isArray(leadCoords) && leadCoords.length >= 2) return leadCoords;
        return [46.5, 2.5];
      }

      var APPLY_INITIAL_MAP_POSITION_DONE = false;
      async function applyInitialMapPosition() {
        if (APPLY_INITIAL_MAP_POSITION_DONE || !mapApi || typeof mapApi.setView !== "function") return;
        var studyId = window.CALPINAGE_STUDY_ID || (function () { try { return new URLSearchParams(location.search).get("studyId"); } catch (e) { return null; } })();
        var leadCoords = await loadLeadCoordinates(studyId);
        var state = window.CALPINAGE_STATE;
        var hasMapCenter = state && state.roof && state.roof.map && state.roof.map.centerLatLng
          && typeof state.roof.map.centerLatLng.lat === "number" && typeof state.roof.map.centerLatLng.lng === "number";
        var hasPansOrObstacles = state && (
          (state.pans && state.pans.length > 0) || (state.obstacles && state.obstacles.length > 0)
        );
        var hasExistingCalpinage = hasMapCenter && hasPansOrObstacles;
        var center = getInitialCenter(state, leadCoords);
        var zoom = 19;
        if (leadCoords) initialLeadCenter = leadCoords;
        if (!hasExistingCalpinage && leadCoords) {
          mapApi.flyTo(center, zoom, { duration: 0.8 });
        } else {
          mapApi.setView(center, zoom);
        }
        APPLY_INITIAL_MAP_POSITION_DONE = true;
      }

      function tryApplyInitialMapPosition() {
        if (mapApi && typeof mapApi.setView === "function") {
          applyInitialMapPosition().catch(function () {});
        }
      }

      /** Enregistre le listener drag pour ne pas recentrer si l'utilisateur a déplacé la carte. */
      function setupMapDragListener() {
        if (mapApi && typeof mapApi.onDragStart === "function") {
          mapApi.onDragStart(function () { userMovedMap = true; });
        }
      }

      /** Recentre sur la maison après changement de fond de carte (IGN ↔ Google), si conditions remplies. */
      function applyCenterOnLayerChange() {
        if (!mapApi || typeof mapApi.setView !== "function") return;
        if (userMovedMap) return;
        var geom = window.geometry_json;
        var hasMapCenter = geom && geom.mapCenter && typeof geom.mapCenter.lat === "number" && typeof geom.mapCenter.lng === "number";
        if (hasMapCenter) return;
        var state = window.CALPINAGE_STATE;
        var hasStateMapCenter = state && state.roof && state.roof.map && state.roof.map.centerLatLng
          && typeof state.roof.map.centerLatLng.lat === "number" && typeof state.roof.map.centerLatLng.lng === "number";
        var hasPansOrObstacles = state && (
          (state.pans && state.pans.length > 0) || (state.obstacles && state.obstacles.length > 0)
        );
        if (hasStateMapCenter && hasPansOrObstacles) return;
        if (!initialLeadCenter) return;
        if (CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.image) return;
        var mapState = mapApi.getState && mapApi.getState();
        var zoom = (mapState && typeof mapState.zoom === "number") ? mapState.zoom : 19;
        mapApi.setView(initialLeadCenter, zoom);
      }

      /**
       * Une seule source de v?rit? : toiture + ?chelle + contours + mesures.
       * V?rification console : window.CALPINAGE_STATE
       */
      window.CALPINAGE_STATE = {
        roof: {
          image: null,
          map: {
            provider: "google",
            centerLatLng: null,
            zoom: null,
            bearing: 0,
          },
          scale: {
            metersPerPixel: null,
            source: "google-dp4",
          },
          roof: { north: null },
        },
        contours: [],
        traits: [],
        measures: [],
        activeContour: { points: [], hoverPoint: null },
        ridges: [],
        activeRidge: { a: null, b: null, hover: null, hoverSnap: null },
        planes: [],
        pans: [],
               selectedPanId: null,
        /** Pan en mode édition : ses sommets sont visibles et sélectionnables. */
        editingPanId: null,
        /** Sommet sélectionné : "panId-index" (ex. "uuid-0"). */
        selectedPointId: null,
        selected: { type: null, id: null, pointIndex: null },
        obstacles: [],
        /** Obstacle polygone en cours de dessin (A-2). points = image space, polygone fermé. */
        activeObstacle: { points: [], hover: null },
        /** Mode global « éditer les hauteurs » : points source visibles et éditables. */
        heightEditMode: false,
        /** Point source sélectionné pour édition hauteur : { type: 'contour'|'ridge'|'trait', index, pointIndex } ou null. */
        selectedHeightPoint: null,
        /** Groupe multi-sélection (CTRL) : [{ type, index, pointIndex }]. Vide en sélection simple. */
        selectedHeightPoints: [],
        /** Phase métier : 2 = Relevé toiture (éditable), 3 = Implantation PV (relevé verrouillé). */
        phase: 2,
        /** Mode global explicite : un seul actif. ROOF_EDIT = Phase 2, PV_LAYOUT = Phase 3. Jamais les deux en même temps. */
        currentPhase: "ROOF_EDIT",
        /** true après clic sur "Valider le relevé toiture" ; les outils Phase 2 sont alors désactivés. */
        roofSurveyLocked: false,
        /** Snapshot figé des données toiture au moment de la validation (référence unique pour calcul PV et pose). Null tant que non validé. */
        validatedRoofData: null,
        /** Paramètres d'implantation PV (Phase 3). Dérivé de PV_LAYOUT_RULES pour compatibilité. */
        pvParams: {
          distanceLimitesCm: 20,
          espacementHorizontalCm: 2,
          espacementVerticalCm: 4.5,
          orientationPanneaux: "portrait",
        },
        /** Panneaux déjà posés (Phase 3). Tant que length === 0, les paramètres PV restent modifiables. */
        placedPanels: [],
        /** Bloc actuellement manipulable (rotation / déplacement) en Phase 3. null = aucune poignée. */
        activeManipulationBlockId: null,
        /** Volumes ombrants (SHADOW_VOLUMES). Indépendants des obstacles 2D. */
        shadowVolumes: [],
        /** Extensions toiture (chien assis, etc.). Indépendantes des obstacles 2D. */
        roofExtensions: [],
      };
      window.CALPINAGE_STATE.roofExtensions = window.CALPINAGE_STATE.roofExtensions || [];

      if (!CALPINAGE_STATE.shading) {
        CALPINAGE_STATE.shading = {
          lastResult: null,
          lastComputedAt: null,
          enabled: true
        };
      }
      CALPINAGE_STATE.shading.normalized = CALPINAGE_STATE.shading.normalized || null;

      CALPINAGE_STATE.horizonMask = CALPINAGE_STATE.horizonMask || {
        enabled: true,
        data: null,
        loadedAt: null,
        source: null
      };

      window.loadCalpinageHorizonMask = function () {
        try {
          var sid = (typeof window !== "undefined" && window.CALPINAGE_STUDY_ID) || null;
          var vid = (typeof window !== "undefined" && window.CALPINAGE_VERSION_ID) || null;
          var raw = getCalpinageItem("horizon-mask", sid, vid);
          if (!raw) return null;
          var json = JSON.parse(raw);
          if (!json || !Array.isArray(json.horizon)) return null;
          CALPINAGE_STATE.horizonMask.data = json;
          CALPINAGE_STATE.horizonMask.loadedAt = Date.now();
          CALPINAGE_STATE.horizonMask.source = (json && json.meta && json.meta.source) ? json.meta.source : null;
          return json;
        } catch (_) {
          return null;
        }
      };

      /** Convertit horizon [{azimuth, elevation_deg}] vers {azimuthStepDeg, elevations} pour horizonMaskEngine. */
      window.convertHorizonToMask = function (data, azimuthStepDeg) {
        if (!data || !Array.isArray(data.horizon) || data.horizon.length === 0) return null;
        var step = (typeof azimuthStepDeg === "number" && azimuthStepDeg > 0) ? azimuthStepDeg : 2;
        var n = Math.ceil(360 / step);
        var elevations = [];
        for (var i = 0; i < n; i++) {
          var az = (i * step) % 360;
          var best = null;
          var bestD = 1e9;
          for (var j = 0; j < data.horizon.length; j++) {
            var h = data.horizon[j];
            if (!h || typeof h.azimuth !== "number" || typeof h.elevation_deg !== "number") continue;
            var d = Math.abs((h.azimuth % 360) - az);
            if (d > 180) d = 360 - d;
            if (d < bestD) { bestD = d; best = h.elevation_deg; }
          }
          elevations.push(typeof best === "number" ? best : 0);
        }
        return { azimuthStepDeg: step, elevations: elevations };
      };

      window.computeCalpinageShading = function() {
        if (!window.computeAnnualShadingLoss) return null;
        if (!CALPINAGE_STATE.shading.enabled) return null;

        var lat = CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.gps ? CALPINAGE_STATE.roof.gps.lat : undefined;
        var lon = CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.gps ? CALPINAGE_STATE.roof.gps.lon : undefined;

        if (typeof lat !== "number" || typeof lon !== "number") return null;

        var panels = window.pvPlacementEngine
          ? window.pvPlacementEngine.getAllPanels && window.pvPlacementEngine.getAllPanels()
          : [];

        if (!Array.isArray(panels)) return null;
        panels = panels.filter(function (p) { return p.enabled !== false; });
        panels = panels.filter(function (p) {
          var poly = p.polygonPx;
          return Array.isArray(poly) && poly.length >= 3;
        });
        if (panels.length === 0) return null;

        var mpp = (CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.scale && CALPINAGE_STATE.roof.scale.metersPerPixel) || 1;
        var rawObstacles = (CALPINAGE_STATE.obstacles || []).concat(
          CALPINAGE_STATE.shadowVolumes || [],
          CALPINAGE_STATE.roofExtensions || []
        );

        var nearObstacles = [];
        for (var oi = 0; oi < rawObstacles.length; oi++) {
          var o = rawObstacles[oi];
          if (!o || typeof o !== "object") continue;
          var polygonPx = o.polygonPx || o.polygon || o.points || (o.contour && o.contour.points) || null;
          if (o.type === "shadow_volume" && !polygonPx) {
            var cx = o.x, cy = o.y;
            var wM = o.width || 0.6, dM = o.depth || 0.6;
            var wPx = wM / mpp, dPx = dM / mpp;
            var rotDeg = typeof o.rotation === "number" ? o.rotation : 0;
            var rotRad = (rotDeg * Math.PI) / 180;
            var cos = Math.cos(rotRad), sin = Math.sin(rotRad);
            function rotPt(lx, ly) { return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos }; }
            if (o.shape === "tube") {
              var r = wPx / 2;
              var n = 16;
              polygonPx = [];
              for (var si = 0; si < n; si++) {
                var a = (si / n) * Math.PI * 2;
                polygonPx.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
              }
            } else {
              var hw = wPx / 2, hd = dPx / 2;
              polygonPx = [rotPt(-hw, -hd), rotPt(hw, -hd), rotPt(hw, hd), rotPt(-hw, hd)];
            }
          }
          if (!Array.isArray(polygonPx) || polygonPx.length < 3) continue;
          var heightM;
          if (typeof o.heightM === "number") heightM = o.heightM;
          else if (typeof o.heightRelM === "number") heightM = o.heightRelM;
          else if (typeof o.height === "number") heightM = o.height;
          else if (o.ridgeHeightRelM != null && typeof o.ridgeHeightRelM === "number") heightM = o.ridgeHeightRelM;
          else heightM = 1;
          if (heightM <= 0) continue;
          nearObstacles.push({
            id: (o.id != null && String(o.id)) || "obs-" + oi,
            polygonPx: polygonPx.map(function (pt) { return { x: typeof pt.x === "number" ? pt.x : 0, y: typeof pt.y === "number" ? pt.y : 0 }; }),
            heightM: heightM
          });
        }

        var horizonMask = null;
        if (CALPINAGE_STATE.horizonMask && CALPINAGE_STATE.horizonMask.enabled && CALPINAGE_STATE.horizonMask.data) {
          horizonMask = window.convertHorizonToMask
            ? window.convertHorizonToMask(CALPINAGE_STATE.horizonMask.data, 2)
            : null;
        }

        var result = window.computeAnnualShadingLoss({
          latDeg: lat,
          lonDeg: lon,
          roofPans: (CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.roofPans) ? CALPINAGE_STATE.roof.roofPans : [],
          panels: panels,
          obstacles: nearObstacles,
          horizonMask: horizonMask,
          getHeightAtImagePoint: typeof getHeightAtImgPoint === "function"
            ? function (x, y) { return getHeightAtImgPoint({ x: x, y: y }); }
            : undefined,
          config: {
            year: new Date().getFullYear(),
            stepMinutes: 30,
            minSunElevationDeg: 3
          }
        });

        CALPINAGE_STATE.shading.lastResult = result;
        CALPINAGE_STATE.shading.lastComputedAt = Date.now();

        return result;
      };

      window.normalizeCalpinageShading = function () {
        const raw = CALPINAGE_STATE.shading.lastResult;
        if (!raw || typeof raw !== "object") return null;

        const totalLossPct =
          typeof raw.annualLossPercent === "number"
            ? raw.annualLossPercent
            : null;

        const perPanel = Array.isArray(raw.panelStats)
          ? raw.panelStats.map(function (p) {
              return {
                panelId: p.panelId || null,
                lossPct:
                  typeof p.shadedFractionAvg === "number"
                    ? p.shadedFractionAvg * 100
                    : null
              };
            })
          : [];

        const normalized = {
          computedAt: Date.now(),
          totalLossPct: totalLossPct,
          annualLossKWh: null, // volontairement laissé à SmartPitch
          panelCount: perPanel.length,
          perPanel: perPanel
        };

        CALPINAGE_STATE.shading.normalized = normalized;
        return normalized;
      };

      window.applyShadingToEnergyProduction = function (annualKWh) {
        if (typeof annualKWh !== "number") return annualKWh;
        const shading = CALPINAGE_STATE.shading?.normalized;
        if (!shading || typeof shading.totalLossPct !== "number") return annualKWh;
        const lossFactor = 1 - Math.min(Math.max(shading.totalLossPct, 0), 100) / 100;
        return annualKWh * lossFactor;
      };

      /** État pour le comportement DP2 (pose, ghost, snap, sélection, drag, rotation). Aucun state.panels : source de vérité = blocs calpinage via adapter. */
      window.CALPINAGE_DP2_STATE = {
        selectedRefs: [],
        selectedPanelIds: [],
        selectedPanelId: null,
        selectedPlacedPanelId: null,
        selectedPlacedBlockId: null,
        currentTool: "panels",
      };
      Object.defineProperty(window.CALPINAGE_DP2_STATE, "scale_m_per_px", {
        get: function () {
          var s = window.CALPINAGE_STATE && window.CALPINAGE_STATE.roof && window.CALPINAGE_STATE.roof.scale;
          return s && s.metersPerPixel != null ? s.metersPerPixel : null;
        },
        configurable: true,
      });
      Object.defineProperty(window.CALPINAGE_DP2_STATE, "panelModel", {
        get: function () {
          var dims = (typeof window.getPanelDimensions === "function") ? window.getPanelDimensions() : null;
          if (!dims) return null;
          return { width_m: dims.widthM, height_m: dims.heightM };
        },
        configurable: true,
      });

      /**
       * R?gles d'implantation PV ??? SOURCE DE V??RIT?? UNIQUE (Phase 3).
       * N'existe que pour currentPhase === "PV_LAYOUT". Utilis? par le moteur de pose.
       */
      /** Flag diagnostic : mettre ? true pour tracer largeur panneau / pas / nombre max (console). */
      window.DEBUG_CALPINAGE_WIDTH = false;
      /** Flag : mettre ? true pour tracer orientation/spacing/ghosts apr?s toggle Portrait/Paysage (console). */
      window.DEBUG_ORIENTATION_TOGGLE = false;
      /** Flag : mettre ? true pour tracer localRotationDeg + halfs effectifs (computeProjectedPanelRect) et stepAlong/stepPerp (computeExpansionGhosts). */
      window.DEBUG_PV_ORIENT = false;
      window.PV_LAYOUT_RULES = {
        orientation: "portrait",
        marginOuterCm: 20,
        spacingXcm: 2,
        spacingYcm: 4.5,
      };

      /** Flag : une fois true, PV_LAYOUT_RULES ne doit plus ??tre ?cras? par le state (Phase 3). */
      window.PV_RULES_INITIALIZED = false;

      /** Mappe spacing UI vers axes moteur selon orientation : portrait = swap (panneaux→along), paysage = passthrough. */
      function mapSpacingForOrientation(rules, orientation) {
        var orient = (orientation || "").toString().toUpperCase();
        if (orient === "PAYSAGE" || orient === "LANDSCAPE") {
          return {
            spacingXcm: Number(rules && rules.spacingXcm) || 0,
            spacingYcm: Number(rules && rules.spacingYcm) || 0,
          };
        }
        return {
          spacingXcm: Number(rules && rules.spacingYcm) || 0,
          spacingYcm: Number(rules && rules.spacingXcm) || 0,
        };
      }

      /** Règles effectives pour l'implantation. Passthrough toiture-first : spacingXcm=panneaux (axe faîtage/perp), spacingYcm=rangées (axe pente/along). */
      function getEffectiveLayoutRules(blockOrient) {
        var rules = window.PV_LAYOUT_RULES;
        if (!rules) return { spacingXcm: 0, spacingYcm: 0, marginOuterCm: 0, orientation: "portrait" };
        var orient = (blockOrient || rules.orientation || "portrait").toString().toLowerCase();
        if (orient === "paysage") orient = "landscape";
        return {
          spacingXcm: Number(rules.spacingXcm) || 0,
          spacingYcm: Number(rules.spacingYcm) || 0,
          marginOuterCm: Number(rules.marginOuterCm) || 0,
          orientation: orient,
        };
      }

      /**
       * ??tat explicite du flux Phase 3 (FSM simple). Compl?ment de lisibilit? ??? ne remplace pas activeBlock / selectedBlockId.
       * ADD = aucun bloc actif, pr??t ? en cr?er un.
       * SELECT = bloc fig? s?lectionn? (ou bloc actif sans manipulation en cours).
       * MOVE = manipulation translation. ROTATE = manipulation rotation.
       * VALIDATE = transition de fin de bloc (juste avant/apr?s endBlock).
       */
      var PV_LAYOUT_FLOW = {
        ADD: "ADD",
        SELECT: "SELECT",
        MOVE: "MOVE",
        ROTATE: "ROTATE",
        VALIDATE: "VALIDATE",
      };
      window.PV_LAYOUT_STATE = PV_LAYOUT_FLOW.ADD;

      /** Entre beginManipulation() et commitManipulation() : aucun recalcul, clearSelection, endBlock, save ou render global. */
      window.CALPINAGE_IS_MANIPULATING = false;
      var calpinageHandleDrag = null;

      /**
       * DATA SHAPE: Extension toiture (chien assis / dormer).
       * Factory pure : ne lit pas le DOM, ne modifie pas l'état global, pas de rendu.
       * @param {string} shapeId - "dormer" uniquement pour l'instant.
       * @param {{x:number,y:number}} atImgPt - point en image-space.
       * @returns {Object} Objet draft (ne push pas dans state).
       */
      function createRoofExtensionDormerDraft(shapeId, atImgPt) {
        var id = "rx_" + Date.now() + "_" + Math.random().toString(16).slice(2);
        return {
          id: id,
          type: "roof_extension",
          kind: "dormer",
          stage: "CONTOUR",
          contour: { points: [], closed: false },
          ridge: null,
          hips: null,
          ridgeHeightRelM: 0.8,
          baseZ: 0,
          meta: { createdAt: Date.now() }
        };
      }

      /** Clone un point en préservant h (anti-régression recompute non destructif). */
      function clonePointPreserveHeight(p, overrides) {
        var x = (overrides && typeof overrides.x === "number") ? overrides.x : (p && typeof p.x === "number" ? p.x : 0);
        var y = (overrides && typeof overrides.y === "number") ? overrides.y : (p && typeof p.y === "number" ? p.y : 0);
        var out = { x: x, y: y };
        if (p && typeof p.h === "number") out.h = p.h;
        if (p && p.attach != null) out.attach = p.attach;
        return out;
      }

      /** Retourne la cible d'édition hips/ridge : roofExtensions[dormerEditRxIndex] ou selectedRoofExtensionIndex, sinon dormerDraft. */
      function getDormerEditTarget() {
        var rxList = CALPINAGE_STATE.roofExtensions || [];
        if (drawState.dormerEditRxIndex != null && rxList[drawState.dormerEditRxIndex]) {
          return rxList[drawState.dormerEditRxIndex];
        }
        if (
          drawState.selectedRoofExtensionIndex != null &&
          CALPINAGE_STATE.roofExtensions &&
          drawState.selectedRoofExtensionIndex >= 0 &&
          drawState.selectedRoofExtensionIndex < CALPINAGE_STATE.roofExtensions.length
        ) {
          return rxList[drawState.selectedRoofExtensionIndex];
        }
        return drawState.dormerDraft;
      }

      /** Crée et push une roofExtension partielle (stage CONTOUR) dès la fermeture du contour. */
      function pushRoofExtensionFromContour(draft) {
        if (!draft || !draft.contour || !draft.contour.closed || !draft.contour.points || draft.contour.points.length < 3) return -1;
        var rxPartiel = {
          id: draft.id || ("rx_" + Date.now() + "_" + Math.random().toString(16).slice(2)),
          type: "roof_extension",
          kind: "dormer",
          stage: "CONTOUR",
          contour: { points: draft.contour.points.map(function (p) { return clonePointPreserveHeight(p); }), closed: true },
          hips: null,
          ridge: null,
          ridgeHeightRelM: draft.ridgeHeightRelM != null ? draft.ridgeHeightRelM : 0.8,
          baseZ: 0
        };
        CALPINAGE_STATE.roofExtensions = CALPINAGE_STATE.roofExtensions || [];
        CALPINAGE_STATE.roofExtensions.push(rxPartiel);
        return CALPINAGE_STATE.roofExtensions.length - 1;
      }

      function finalizeDormerIfComplete() {
        var d = getDormerEditTarget() || drawState.dormerDraft;
        if (!d) return false;

        var ridge = d.ridge;
        var hips = d.hips;
        if (!ridge || !ridge.a || !ridge.b) return false;
        if (!hips || !hips.left || !hips.right || !hips.left.b || !hips.right.b) return false;

        if (drawState.dormerEditRxIndex != null) {
          var rx = (CALPINAGE_STATE.roofExtensions || [])[drawState.dormerEditRxIndex];
          if (rx) {
            rx.ridge = { a: clonePointPreserveHeight(ridge.a), b: clonePointPreserveHeight(ridge.b) };
            rx.stage = "COMPLETE";
          }
          drawState.dormerEditRxIndex = null;
        } else {
          var dormerFinal = JSON.parse(JSON.stringify(d));
          dormerFinal.baseZ = dormerFinal.baseZ || 0;
          dormerFinal.stage = "COMPLETE";
          dormerFinal.ridge = dormerFinal.ridge || { a: null, b: null };
          dormerFinal.hips = dormerFinal.hips || { left: null, right: null };
          CALPINAGE_STATE.roofExtensions = CALPINAGE_STATE.roofExtensions || [];
          CALPINAGE_STATE.roofExtensions.push(dormerFinal);
          drawState.dormerDraft = null;
        }

        if (typeof saveCalpinageState === "function") saveCalpinageState();
        if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
        return true;
      }

      function projectPointOnSegment(p, a, b) {
        var dx = b.x - a.x;
        var dy = b.y - a.y;
        var lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return null;
        var t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
        if (t < 0 || t > 1) return null;
        return { x: a.x + t * dx, y: a.y + t * dy };
      }
      function snapToContourEdge(imgPt, contourPts, maxDist) {
        var best = null;
        var bestDist = maxDist;
        for (var i = 0; i < contourPts.length; i++) {
          var a = contourPts[i];
          var b = contourPts[(i + 1) % contourPts.length];
          var proj = projectPointOnSegment(imgPt, a, b);
          if (!proj) continue;
          var d = Math.hypot(imgPt.x - proj.x, imgPt.y - proj.y);
          if (d < bestDist) {
            best = proj;
            bestDist = d;
          }
        }
        return best;
      }
      function intersectLines(p1, p2, p3, p4) {
        var a1 = p2.y - p1.y;
        var b1 = p1.x - p2.x;
        var c1 = a1 * p1.x + b1 * p1.y;
        var a2 = p4.y - p3.y;
        var b2 = p3.x - p4.x;
        var c2 = a2 * p3.x + b2 * p3.y;
        var det = a1 * b2 - a2 * b1;
        if (Math.abs(det) < 0.0001) return null;
        return { x: (b2 * c1 - b1 * c2) / det, y: (a1 * c2 - a2 * c1) / det };
      }
      function snapToSegment(p, segA, segB, maxDist) {
        var dx = segB.x - segA.x;
        var dy = segB.y - segA.y;
        var lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return null;
        var t = ((p.x - segA.x) * dx + (p.y - segA.y) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        var proj = { x: segA.x + t * dx, y: segA.y + t * dy };
        var d = Math.hypot(p.x - proj.x, p.y - proj.y);
        return (d <= maxDist) ? proj : null;
      }
      function findNearestContourVertex(imgPt, contourPts, maxDist) {
        var best = null;
        var bestDist = maxDist;
        for (var i = 0; i < contourPts.length; i++) {
          var d = Math.hypot(imgPt.x - contourPts[i].x, imgPt.y - contourPts[i].y);
          if (d <= bestDist) {
            best = contourPts[i];
            bestDist = d;
          }
        }
        return best;
      }
      function snapToDormerVertex(imgPt, contourPts, maxDist) {
        var best = null;
        var bestDist = maxDist;
        for (var i = 0; i < contourPts.length; i++) {
          var d = Math.hypot(imgPt.x - contourPts[i].x, imgPt.y - contourPts[i].y);
          if (d <= bestDist) {
            best = contourPts[i];
            bestDist = d;
          }
        }
        return best;
      }
      function snapToRoofContour(imgPt, roofContours, maxDist) {
        if (!roofContours || roofContours.length === 0) return null;
        var best = null;
        var bestDist = maxDist;
        for (var c = 0; c < roofContours.length; c++) {
          var pts = roofContours[c].points;
          if (!pts || pts.length < 2) continue;
          for (var i = 0; i < pts.length; i++) {
            var a = pts[i];
            var b = pts[(i + 1) % pts.length];
            var proj = projectPointOnSegment(imgPt, a, b);
            if (!proj) continue;
            var d = Math.hypot(imgPt.x - proj.x, imgPt.y - proj.y);
            if (d < bestDist) {
              best = proj;
              bestDist = d;
            }
          }
        }
        return best;
      }
      function snapToAllRoofEdges(imgPt, maxDist) {
        var edges = getAllRoofEdgesIncludingExtensions();
        if (!edges || !edges.length) return null;
        var best = null;
        var bestDist = maxDist;
        edges.forEach(function (seg) {
          if (!seg.a || !seg.b) return;
          var proj = projectPointOnSegment(imgPt, seg.a, seg.b);
          if (!proj) return;
          var d = Math.hypot(imgPt.x - proj.x, imgPt.y - proj.y);
          if (d <= bestDist) {
            best = proj;
            bestDist = d;
          }
        });
        return best;
      }

      var VERTEX_SNAP_DIST_PX = 12;
      var EDGE_SNAP_DIST_PX = 12;
      var SNAP_RELEASE_DIST_PX = 18;
      var RX_SNAP_MAX_DIST_PX = 28;

      /** Snap doux avec hysteresis pour drag roofExtension. Retourne { x, y } candidat. Modifie drawState.rxDragSnap (preview uniquement). */
      function softSnapRoofExtensionVertex(imgTarget, pointRef, rxIndex, scale, ctrlKey) {
        if (ctrlKey) {
          drawState.rxDragSnap = null;
          return { x: imgTarget.x, y: imgTarget.y };
        }
        var vImg = Math.max(0.5, VERTEX_SNAP_DIST_PX / scale);
        var eImg = Math.max(0.5, EDGE_SNAP_DIST_PX / scale);
        var rImg = Math.max(0.5, SNAP_RELEASE_DIST_PX / scale);
        var maxImg = Math.max(0.5, RX_SNAP_MAX_DIST_PX / scale);
        var snap = drawState.rxDragSnap;
        if (snap && snap.active && snap.x != null && snap.y != null) {
          var d = Math.hypot(imgTarget.x - snap.x, imgTarget.y - snap.y);
          if (d <= rImg) return { x: snap.x, y: snap.y };
          drawState.rxDragSnap = null;
        }
        var contours = (CALPINAGE_STATE.contours || []).filter(function (c) { return c && c.roofRole !== "chienAssis" && c.points; });
        var traits = (CALPINAGE_STATE.traits || []).filter(function (t) { return t && t.a && t.b; });
        var ridges = (CALPINAGE_STATE.ridges || []).filter(function (r) { return r && r.roofRole !== "chienAssis"; });
        var rxList = CALPINAGE_STATE.roofExtensions || [];
        var bestVert = null, bestVertD = vImg;
        var bestEdge = null, bestEdgeD = eImg;
        function tryVertex(p) {
          if (!p || p === pointRef) return;
          var d = Math.hypot(imgTarget.x - p.x, imgTarget.y - p.y);
          if (d < bestVertD) { bestVertD = d; bestVert = p; }
        }
        function tryEdge(a, b) {
          if (!a || !b) return;
          var dx = b.x - a.x, dy = b.y - a.y, lenSq = dx * dx + dy * dy + 1e-10;
          var t = ((imgTarget.x - a.x) * dx + (imgTarget.y - a.y) * dy) / lenSq;
          t = Math.max(0, Math.min(1, t));
          var proj = { x: a.x + t * dx, y: a.y + t * dy };
          var d = Math.hypot(imgTarget.x - proj.x, imgTarget.y - proj.y);
          if (d < bestEdgeD) { bestEdgeD = d; bestEdge = { x: proj.x, y: proj.y }; }
        }
        contours.forEach(function (c) { (c.points || []).forEach(tryVertex); });
        traits.forEach(function (t) { tryVertex(t.a); tryVertex(t.b); });
        ridges.forEach(function (r) {
          var ra = r.a && typeof r.a.x === "number" ? r.a : null, rb = r.b && typeof r.b.x === "number" ? r.b : null;
          if (ra) tryVertex(ra); if (rb) tryVertex(rb);
        });
        rxList.forEach(function (rx, ri) {
          if (rx.contour && rx.contour.points) rx.contour.points.forEach(tryVertex);
          if (rx.hips && rx.hips.left && rx.hips.left.a) tryVertex(rx.hips.left.a);
          if (rx.hips && rx.hips.left && rx.hips.left.b) tryVertex(rx.hips.left.b);
          if (rx.hips && rx.hips.right && rx.hips.right.a) tryVertex(rx.hips.right.a);
          if (rx.hips && rx.hips.right && rx.hips.right.b) tryVertex(rx.hips.right.b);
          if (rx.ridge && rx.ridge.a) tryVertex(rx.ridge.a);
          if (rx.ridge && rx.ridge.b) tryVertex(rx.ridge.b);
        });
        contours.forEach(function (c) {
          var pts = c.points || [];
          for (var i = 0; i < pts.length; i++) tryEdge(pts[i], pts[(i + 1) % pts.length]);
        });
        traits.forEach(function (t) { tryEdge(t.a, t.b); });
        ridges.forEach(function (r) {
          var ra = r.a, rb = r.b;
          if (ra && rb && typeof ra.x === "number" && typeof rb.x === "number") tryEdge(ra, rb);
        });
        rxList.forEach(function (rx) {
          var pts = rx.contour && rx.contour.points ? rx.contour.points : [];
          for (var i = 0; i < pts.length; i++) tryEdge(pts[i], pts[(i + 1) % pts.length]);
          if (rx.hips && rx.hips.left && rx.hips.left.a && rx.hips.left.b) tryEdge(rx.hips.left.a, rx.hips.left.b);
          if (rx.hips && rx.hips.right && rx.hips.right.a && rx.hips.right.b) tryEdge(rx.hips.right.a, rx.hips.right.b);
          if (rx.ridge && rx.ridge.a && rx.ridge.b) tryEdge(rx.ridge.a, rx.ridge.b);
        });
        if (bestVert) {
          var dVert = Math.hypot(imgTarget.x - bestVert.x, imgTarget.y - bestVert.y);
          if (dVert <= maxImg) {
            drawState.rxDragSnap = { active: true, type: "vertex", x: bestVert.x, y: bestVert.y };
            return { x: bestVert.x, y: bestVert.y };
          }
        }
        if (bestEdge) {
          var dEdge = Math.hypot(imgTarget.x - bestEdge.x, imgTarget.y - bestEdge.y);
          if (dEdge <= maxImg) {
            drawState.rxDragSnap = { active: true, type: "edge", x: bestEdge.x, y: bestEdge.y };
            return { x: bestEdge.x, y: bestEdge.y };
          }
        }
        drawState.rxDragSnap = null;
        return { x: imgTarget.x, y: imgTarget.y };
      }
      function snapToRoofContourEdge(imgPt, buildingContours, maxDist) {
        var best = null;
        var bestDist = maxDist;
        if (!buildingContours) return null;
        buildingContours.forEach(function (contour) {
          var pts = contour.points;
          if (!pts || pts.length < 2) return;
          for (var i = 0; i < pts.length; i++) {
            var a = pts[i];
            var b = pts[(i + 1) % pts.length];
            var proj = projectPointOnSegment(imgPt, a, b);
            if (!proj) continue;
            var d = Math.hypot(imgPt.x - proj.x, imgPt.y - proj.y);
            if (d <= bestDist) {
              best = proj;
              bestDist = d;
            }
          }
        });
        return best;
      }

      function pointInPolygon(point, vs) {
        var x = point.x, y = point.y;
        var inside = false;
        for (var i = 0, j = vs.length - 1; i < vs.length; j = i++) {
          var xi = vs[i].x, yi = vs[i].y;
          var xj = vs[j].x, yj = vs[j].y;
          var intersect = ((yi > y) != (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi + 0.0000001) + xi);
          if (intersect) inside = !inside;
        }
        return inside;
      }

      /** Projette un point image à une hauteur donnée sur le sol selon la direction du soleil. Réutilise la logique shadowVolume. */
      function projectShadowPoint(imgPt, heightM, sunVec, metersPerPixel) {
        var dx = sunVec.x;
        var dy = sunVec.y;
        var dz = sunVec.z;
        if (dz >= 0) return null;
        var t = heightM / -dz;
        return {
          x: imgPt.x + (dx * t) / metersPerPixel,
          y: imgPt.y + (dy * t) / metersPerPixel
        };
      }

      function computeDormerShadowPolygon(rx, sunVec, metersPerPixel) {
        if (!rx || !rx.ridge || !rx.hips) return null;
        if (!rx.ridge.a || !rx.ridge.b) return null;
        if (!rx.hips.left || !rx.hips.right) return null;
        if (!rx.hips.left.b || !rx.hips.right.b) return null;
        var h = rx.ridgeHeightRelM;
        if (!(h > 0)) return null;
        var sLeft = projectShadowPoint(rx.ridge.a, h, sunVec, metersPerPixel);
        var sRight = projectShadowPoint(rx.ridge.b, h, sunVec, metersPerPixel);
        if (!sLeft || !sRight) return null;
        return [
          { x: rx.hips.left.b.x, y: rx.hips.left.b.y },
          { x: rx.hips.right.b.x, y: rx.hips.right.b.y },
          { x: sRight.x, y: sRight.y },
          { x: sLeft.x, y: sLeft.y }
        ];
      }

      function getPanelCenterFromPoly(poly) {
        var x = 0, y = 0;
        for (var i = 0; i < poly.length; i++) { x += poly[i].x; y += poly[i].y; }
        return { x: x / poly.length, y: y / poly.length };
      }

      function hitTestRidge(imgPt, ridge, tolerance) {
        if (!ridge || !ridge.a || !ridge.b) return false;
        var ax = ridge.a.x;
        var ay = ridge.a.y;
        var bx = ridge.b.x;
        var by = ridge.b.y;
        var dx = bx - ax;
        var dy = by - ay;
        var lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return false;
        var t = ((imgPt.x - ax) * dx + (imgPt.y - ay) * dy) / lenSq;
        if (t < 0 || t > 1) return false;
        var projX = ax + t * dx;
        var projY = ay + t * dy;
        var dist = Math.hypot(imgPt.x - projX, imgPt.y - projY);
        return dist <= tolerance;
      }

      function openDormerHeightOverlay(rx, index) {
        var currentVal = rx.ridgeHeightRelM || 0.8;
        var val = prompt("Hauteur du faîtage (m au-dessus du toit) :", currentVal);
        if (val === null) return;
        var num = parseFloat(val);
        if (isNaN(num) || num < 0) {
          if (typeof window.calpinageToast !== "undefined" && window.calpinageToast.error) {
            window.calpinageToast.error("Valeur invalide.");
          } else if (typeof console !== "undefined") console.warn("[CALPINAGE]", "Valeur invalide.");
          return;
        }
        rx.ridgeHeightRelM = num;
        if (typeof saveCalpinageState === "function") {
          saveCalpinageState();
        }
        if (typeof window.CALPINAGE_RENDER === "function") {
          window.CALPINAGE_RENDER();
        }
      }

      /** Copie pvParams (snapshot) vers PV_LAYOUT_RULES (source de v?rit?). Utilis? une seule fois au chargement. */
      function mapPvParamsToRules(pvParams, rules) {
        if (!pvParams || !rules) return;
        if (typeof pvParams.distanceLimitesCm === "number") rules.marginOuterCm = Math.max(0, pvParams.distanceLimitesCm);
        if (typeof pvParams.espacementHorizontalCm === "number") rules.spacingXcm = Math.max(0, pvParams.espacementHorizontalCm);
        if (typeof pvParams.espacementVerticalCm === "number") rules.spacingYcm = Math.max(0, pvParams.espacementVerticalCm);
        if (pvParams.orientationPanneaux === "portrait" || pvParams.orientationPanneaux === "paysage" || pvParams.orientationPanneaux === "landscape") rules.orientation = (pvParams.orientationPanneaux === "paysage" || pvParams.orientationPanneaux === "landscape") ? "landscape" : "portrait";
      }

      /** CP-005 — Catalogue panneaux SolarNext charg? via API /api/public/pv/panels */
      window.SOLARNEXT_PANELS = [];
      /** CP-005 — ID du panneau s?lectionn? (synchro avec PV_SELECTED_PANEL) */
      window.CALPINAGE_SELECTED_PANEL_ID = null;
      /** CP-006 — Onduleur sélectionné (id). */
      window.CALPINAGE_SELECTED_INVERTER_ID = null;
      /** CP-006 — Onduleur sélectionné (objet API). */
      window.PV_SELECTED_INVERTER = null;

      /**
       * Panneau s?lectionn? pour l'implantation (Phase 3). SOURCE DE V??RIT?? pour la pose.
       * Null = aucune pose autoris?e. Charg? depuis API /api/public/pv/panels.
       * @type {{ id: string, name: string, widthMm: number, heightMm: number, widthM: number, heightM: number, powerWc: number, [key: string]: * }|null}
       */
      window.PV_SELECTED_PANEL = null;

      /**
       * CP-005 — Charge les panneaux depuis l'API GET /api/public/pv/panels.
       * Stocke dans window.SOLARNEXT_PANELS. G?re loading + erreur.
       * @returns {Promise<void>}
       */
      async function loadPanelsFromApi() {
        var loadingEl = container.querySelector("#pv-panel-loading");
        var errorEl = container.querySelector("#pv-panel-error");
        var selectEl = container.querySelector("#pv-panel-select");
        if (loadingEl) loadingEl.style.display = "block";
        if (errorEl) { errorEl.style.display = "none"; errorEl.textContent = ""; }
        if (selectEl) selectEl.disabled = true;
        window.SOLARNEXT_PANELS = [];
        try {
          var apiBase = (window.location && window.location.origin) || "";
          var res = await fetch(apiBase + "/api/public/pv/panels");
          if (!res.ok) throw new Error("Erreur " + res.status + " : " + (res.statusText || "Chargement catalogue impossible"));
          var list = await res.json();
          window.SOLARNEXT_PANELS = Array.isArray(list) ? list : [];
          if (errorEl) {
            if (window.SOLARNEXT_PANELS.length === 0) {
              errorEl.textContent = "Aucun panneau actif dans le catalogue";
              errorEl.style.display = "block";
            } else {
              errorEl.style.display = "none";
            }
          }
        } catch (e) {
          window.SOLARNEXT_PANELS = [];
          if (errorEl) {
            errorEl.textContent = e && e.message ? e.message : "Impossible de charger le catalogue panneaux.";
            errorEl.style.display = "block";
          }
          console.warn("[PV] loadPanelsFromApi failed:", e);
        } finally {
          if (loadingEl) loadingEl.style.display = "none";
          if (selectEl) selectEl.disabled = (window.SOLARNEXT_PANELS || []).length === 0;
        }
      }

      /**
       * CP-006 — Charge les onduleurs depuis l'API GET /api/public/pv/inverters.
       * Stocke dans window.SOLARNEXT_INVERTERS. Gère loading + erreur.
       * @returns {Promise<void>}
       */
      async function loadInvertersFromApi() {
        var loadingEl = container.querySelector("#pv-inverter-loading");
        var errorEl = container.querySelector("#pv-inverter-error");
        var selectCentral = container.querySelector("#pv-inverter-select-central");
        var selectMicro = container.querySelector("#pv-inverter-select-micro");
        if (loadingEl) loadingEl.style.display = "block";
        if (errorEl) { errorEl.style.display = "none"; errorEl.textContent = ""; }
        if (selectCentral) selectCentral.disabled = true;
        if (selectMicro) selectMicro.disabled = true;
        window.SOLARNEXT_INVERTERS = [];
        try {
          var apiBase = (window.location && window.location.origin) || "";
          var res = await fetch(apiBase + "/api/public/pv/inverters");
          if (!res.ok) throw new Error("Erreur " + res.status + " : " + (res.statusText || "Chargement catalogue impossible"));
          var list = await res.json();
          window.SOLARNEXT_INVERTERS = Array.isArray(list) ? list : [];
          if (errorEl) errorEl.style.display = "none";
        } catch (e) {
          window.SOLARNEXT_INVERTERS = [];
          if (errorEl) {
            errorEl.textContent = e && e.message ? e.message : "Impossible de charger le catalogue onduleurs.";
            errorEl.style.display = "block";
          }
          console.warn("[PV] loadInvertersFromApi failed:", e);
        } finally {
          if (loadingEl) loadingEl.style.display = "none";
          var hasInverters = (window.SOLARNEXT_INVERTERS || []).length > 0;
          if (selectCentral) selectCentral.disabled = !hasInverters;
          if (selectMicro) selectMicro.disabled = !hasInverters;
        }
      }

      /** Retourne la liste des onduleurs (API). */
      function getInverterList() {
        return (window.SOLARNEXT_INVERTERS && Array.isArray(window.SOLARNEXT_INVERTERS)) ? window.SOLARNEXT_INVERTERS : [];
      }

      /** Trouve un onduleur par id dans SOLARNEXT_INVERTERS. */
      function findInverterById(id) {
        var list = getInverterList();
        if (!id) return null;
        return list.filter(function (i) { return i && i.id === id; })[0] || null;
      }

      /** Retourne la liste des panneaux (API). */
      function getPanelList() {
        return (window.SOLARNEXT_PANELS && Array.isArray(window.SOLARNEXT_PANELS)) ? window.SOLARNEXT_PANELS : [];
      }

      /** Trouve un panneau par id dans SOLARNEXT_PANELS. */
      function findPanelById(id) {
        var list = getPanelList();
        if (!id) return null;
        return list.filter(function (p) { return p && p.id === id; })[0] || null;
      }

      /**
       * Construit PV_SELECTED_PANEL ? partir d'un panneau API (format: id, brand, name, model_ref, power_wc, efficiency_pct, width_mm, height_mm).
       * @param {Object} apiPanel - ?l?ment de SOLARNEXT_PANELS
       * @returns {Object|null}
       */
      function buildPVSelectedPanelFromApi(apiPanel) {
        if (!apiPanel || !apiPanel.id) return null;
        var wMm = Number(apiPanel.width_mm);
        var hMm = Number(apiPanel.height_mm);
        if (!Number.isFinite(wMm) || !Number.isFinite(hMm) || wMm <= 0 || hMm <= 0) return null;
        var name = (apiPanel.name || "").trim() || [apiPanel.brand, apiPanel.model_ref].filter(Boolean).join(" ") || apiPanel.id;
        return {
          id: apiPanel.id,
          name: name,
          widthMm: Math.round(wMm),
          heightMm: Math.round(hMm),
          widthM: wMm / 1000,
          heightM: hMm / 1000,
          powerWc: Number(apiPanel.power_wc) || 0,
          brand: apiPanel.brand,
          model: apiPanel.model_ref,
          model_ref: apiPanel.model_ref,
          efficiency_pct: apiPanel.efficiency_pct,
          power_wc: Number(apiPanel.power_wc) || 0,
          width_mm: wMm,
          height_mm: hMm,
          isc_a: apiPanel.isc_a != null ? Number(apiPanel.isc_a) : undefined,
          vmp_v: apiPanel.vmp_v != null ? Number(apiPanel.vmp_v) : undefined
        };
      }

      /** Construit PV_SELECTED_PANEL à partir d'un panneau API uniquement (source catalogue /api/public/pv/panels). */
      function buildPVSelectedPanel(spec) {
        if (!spec || !spec.id) return null;
        return buildPVSelectedPanelFromApi(spec);
      }

      /** Contour b??ti valide : au moins un contour principal ferm? avec au moins 3 points. */
      function isContourValid() {
        var contours = (CALPINAGE_STATE.contours || []).filter(function (c) { return c.roofRole !== "chienAssis"; });
        return contours.some(function (c) { return c && c.points && c.points.length >= 3 && c.closed !== false; });
      }
      /** Tous les points hauteur obligatoires ont une valeur valide et aucun n'est en erreur. */
      function areAllHeightsValid() {
        var contours = (CALPINAGE_STATE.contours || []).filter(function (c) { return c.roofRole !== "chienAssis"; });
        var ridges = (CALPINAGE_STATE.ridges || []).filter(function (r) { return r.roofRole !== "chienAssis"; });
        var traits = (CALPINAGE_STATE.traits || []).filter(function (t) { return t.roofRole !== "chienAssis"; });
        var ok = function (pt) { return pt && typeof pt.h === "number" && Number.isFinite(pt.h); };
        var i, j, pt;
        for (i = 0; i < contours.length; i++) {
          if (!contours[i].points) return false;
          for (j = 0; j < contours[i].points.length; j++) {
            pt = contours[i].points[j];
            if (!pt || !ok(pt)) return false;
          }
        }
        for (i = 0; i < ridges.length; i++) {
          if (!ridges[i].a || !ok(ridges[i].a) || !ridges[i].b || !ok(ridges[i].b)) return false;
        }
        for (i = 0; i < traits.length; i++) {
          if (!traits[i].a || !ok(traits[i].a) || !traits[i].b || !ok(traits[i].b)) return false;
        }
        return true;
      }
      /** Peut-on activer le bouton "Valider le relevé toiture" : contour valide + au moins un pan. Les hauteurs sont informatives (orange/vert), jamais bloquantes. */
      function canValidateRoofSurvey() {
        if (CALPINAGE_STATE.roofSurveyLocked) return false;
        if (!isContourValid()) return false;
        computePansFromGeometry();
        if ((CALPINAGE_STATE.pans || []).length < 1) return false;
        return true;
      }
      /** Aire du polygone 2D en m?? (points en image, scale = m/px). */
      function polygonAreaM2(points, metersPerPixel) {
        if (!points || points.length < 3 || !Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return 0;
        var n = points.length;
        var areaPx2 = 0;
        for (var i = 0; i < n; i++) {
          var j = (i + 1) % n;
          areaPx2 += points[i].x * points[j].y - points[j].x * points[i].y;
        }
        areaPx2 = Math.abs(areaPx2) * 0.5;
        return areaPx2 * metersPerPixel * metersPerPixel;
      }
      /** Construit le snapshot fig? de la toiture (un pan par entr?e) pour la Phase 3. */
      function buildValidatedRoofData() {
        ensurePanPointsWithHeights();
        if (window.CalpinagePans && CalpinagePans.recomputeAllPanPhysicalProps && CALPINAGE_STATE.pans.length) {
          CalpinagePans.recomputeAllPanPhysicalProps(CALPINAGE_STATE.pans, getStateForPans());
        }
        var mpp = (CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.scale && CALPINAGE_STATE.roof.scale.metersPerPixel) || 1;
        var pans = CALPINAGE_STATE.pans || [];
        return {
          pans: pans.map(function (p) {
            var poly = p.points || p.polygon || [];
            var pts = poly.map(function (pt) { return { x: pt.x, y: pt.y }; });
            var orientationDeg = (p.physical && p.physical.orientation && typeof p.physical.orientation.azimuthDeg === "number") ? p.physical.orientation.azimuthDeg : (p.azimuthDeg != null ? p.azimuthDeg : null);
            var tiltDeg = (p.physical && p.physical.slope && typeof p.physical.slope.valueDeg === "number") ? p.physical.slope.valueDeg : (p.tiltDeg != null ? p.tiltDeg : null);
            var slopeDirectionLabel = (p.physical && p.physical.slopeDirectionLabel != null) ? p.physical.slopeDirectionLabel : null;
            return {
              id: p.id,
              name: p.name,
              orientationDeg: orientationDeg,
              tiltDeg: tiltDeg,
              slopeDirectionLabel: slopeDirectionLabel,
              surfaceM2: polygonAreaM2(pts, mpp),
              polygon: pts.slice(),
              ridgeIds: (p.ridgeIds || []).slice(),
              traitIds: (p.traitIds || []).slice(),
              obstacleIds: (p.obstacles || []).slice(),
            };
          }),
          scale: CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.scale ? { metersPerPixel: CALPINAGE_STATE.roof.scale.metersPerPixel } : null,
          north: CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.roof ? CALPINAGE_STATE.roof.roof : null,
        };
      }

      /**
       * Contexte pour computeProjectedPanelRect (Phase 3 ??? bloc actif).
       * Adaptateur UI : pr?pare les entr?es depuis l'?tat global puis appelle buildProjectionContext (pur).
       */
      function getProjectionContextForPan(panId) {
        if (window.CALPINAGE_IS_MANIPULATING) return null;
        var data = CALPINAGE_STATE.validatedRoofData;
        if (!data || !data.pans || !data.scale || !data.scale.metersPerPixel) return null;
        var pan = data.pans.filter(function (p) { return p.id === panId; })[0];
        if (!pan || !pan.polygon || pan.polygon.length < 3) return null;
        var rules = window.PV_LAYOUT_RULES;
        if (!rules) return null;
        var panel = window.PV_SELECTED_PANEL;
        if (!panel || !Number.isFinite(panel.widthMm) || !Number.isFinite(panel.heightMm)) return null;
        var orientForPan = (rules.orientation === "landscape" || rules.orientation === "paysage") ? "landscape" : "portrait";
        var dims = (typeof window.getPanelDimensions === "function") ? window.getPanelDimensions("portrait") : null;
        if (!dims || !Number.isFinite(dims.widthM) || !Number.isFinite(dims.heightM)) return null;
        var mpp = data.scale.metersPerPixel;
        var ridgeSegments = [];
        if (pan.ridgeIds && CALPINAGE_STATE.ridges) {
          for (var ri = 0; ri < pan.ridgeIds.length; ri++) {
            var r = CALPINAGE_STATE.ridges.filter(function (x) { return x.id === pan.ridgeIds[ri]; })[0];
            if (r && r.a && r.b && typeof resolveRidgePoint === "function") {
              var ra = resolveRidgePoint(r.a);
              var rb = resolveRidgePoint(r.b);
              if (ra && rb) ridgeSegments.push([ra, rb]);
            }
          }
        }
        var obstaclePolygons = [];
        if (pan.obstacleIds && CALPINAGE_STATE.obstacles) {
          for (var oi = 0; oi < pan.obstacleIds.length; oi++) {
            var o = CALPINAGE_STATE.obstacles.filter(function (x) { return x.id === pan.obstacleIds[oi]; })[0];
            if (o && o.points && o.points.length >= 3) obstaclePolygons.push(o.points);
          }
        }
        var existingPanelsProjections = [];
        var getFrozen = (window.pvPlacementEngine && window.pvPlacementEngine.getFrozenBlocks) || (window.ActivePlacementBlock && window.ActivePlacementBlock.getFrozenBlocks);
        if (typeof getFrozen === "function") {
          var frozen = getFrozen();
          for (var fi = 0; fi < frozen.length; fi++) {
            var bl = frozen[fi];
            if (!bl.panels) continue;
            for (var pi = 0; pi < bl.panels.length; pi++) {
              if (bl.panels[pi].projection && bl.panels[pi].projection.points) {
                existingPanelsProjections.push(bl.panels[pi].projection);
              }
            }
          }
        }
        var roofParams = {
          roofSlopeDeg: Number.isFinite(pan.tiltDeg) ? pan.tiltDeg : 0,
          roofOrientationDeg: Number.isFinite(pan.orientationDeg) ? pan.orientationDeg : 0,
          metersPerPixel: mpp,
        };
        var computeTrueSlopeAxisFromPolygon = (typeof window !== "undefined" && window.computeTrueSlopeAxisFromPolygon) || (typeof global !== "undefined" && global.computeTrueSlopeAxisFromPolygon);
        if (typeof computeTrueSlopeAxisFromPolygon === "function") {
          var axes = computeTrueSlopeAxisFromPolygon(pan.polygon, pan.orientationDeg, pan.slopeDirectionLabel);
          if (axes && axes.slopeAxis && axes.perpAxis) {
            roofParams.trueSlopeAxis = axes.slopeAxis;
            roofParams.truePerpAxis = axes.perpAxis;
          }
        }
        /* Dimensions orientées via getPanelDimensions() — source de vérité unique. Géométrie paysage via localRotationDeg=90 uniquement (pas de swap dims). */
        var panelWidthMm = dims.widthM * 1000;
        var panelHeightMm = dims.heightM * 1000;
        var localRotationDeg = (orientForPan === "landscape" || orientForPan === "paysage") ? 90 : 0;
        var panelParams = {
          panelWidthMm: panelWidthMm,
          panelHeightMm: panelHeightMm,
          panelOrientation: "PORTRAIT",
          localRotationDeg: localRotationDeg,
        };
        if (window.DEBUG_CALPINAGE_WIDTH && panel) {
          console.log("[getProjectionContextForPan] DIAG panelParams", {
            panId: pan.id,
            panelWidthMm: panelWidthMm,
            panelHeightMm: panelHeightMm,
            effectiveWidthM: dims.widthM,
            effectiveHeightM: dims.heightM,
            source: "getPanelDimensions()",
          });
        }
        var orientEngine = (orientForPan === "landscape" || orientForPan === "paysage") ? "PAYSAGE" : "PORTRAIT";
        var effRules = getEffectiveLayoutRules(orientForPan);
        var mapped = mapSpacingForOrientation(rules, orientEngine);
        if (typeof window !== "undefined" && window.__PV_AUDIT__ === true) {
          console.log("[PV_AUDIT][CTX_PAN]", panId, rules.orientation, orientEngine, panelParams.panelOrientation, panelParams.localRotationDeg, mapped.spacingXcm, mapped.spacingYcm);
        }
        var pvRules = {
          spacingXcm: mapped.spacingXcm,
          spacingYcm: mapped.spacingYcm,
          marginOuterCm: Number.isFinite(effRules.marginOuterCm) ? effRules.marginOuterCm : 0,
          orientation: effRules.orientation,
        };
        var traitSegments = [];
        var traits = CALPINAGE_STATE.traits || [];
        for (var ti = 0; ti < traits.length; ti++) {
          var tr = traits[ti];
          if (tr && tr.a && tr.b && typeof tr.a.x === "number" && typeof tr.b.x === "number") {
            traitSegments.push([tr.a, tr.b]);
          }
        }
        var roofConstraints = { ridgeSegments: ridgeSegments, traitSegments: traitSegments, obstaclePolygons: obstaclePolygons };
        return window.pvPlacementEngine && typeof window.pvPlacementEngine.buildProjectionContext === "function"
          ? window.pvPlacementEngine.buildProjectionContext({
              pan: pan,
              roofPolygon: pan.polygon,
              roofParams: roofParams,
              panelParams: panelParams,
              pvRules: pvRules,
              roofConstraints: roofConstraints,
              existingProjections: existingPanelsProjections,
            })
          : (function fallback() {
              var marginPx = Number.isFinite(rules.marginOuterCm) && mpp > 0 ? (rules.marginOuterCm / 100) / mpp : 0;
              return {
                roofPolygon: pan.polygon,
                roofConstraints: { marginPx: marginPx, ridgeSegments: ridgeSegments, traitSegments: traitSegments, obstaclePolygons: obstaclePolygons },
                roofParams: roofParams,
                panelParams: panelParams,
                pvRules: pvRules,
                existingPanelsProjections: existingPanelsProjections,
              };
            })();
      }

      /** Contexte de projection pour un bloc donn?: dimensions via getPanelDimensions, pvRules via getEffectiveLayoutRules. */
      function getProjectionContextForBlock(block) {
        if (!block || !block.panId) return null;
        var ctx = getProjectionContextForPan(block.panId);
        if (!ctx || !ctx.panelParams) return ctx;
        var rules = window.PV_LAYOUT_RULES;
        var blockOrient = (block.orientation === "PAYSAGE" || block.orientation === "landscape") ? "landscape" : "portrait";
        var blockOrientEngine = blockOrient === "landscape" ? "PAYSAGE" : "PORTRAIT";
        var dims = (typeof window.getPanelDimensions === "function") ? window.getPanelDimensions("portrait") : null;
        var effRules = getEffectiveLayoutRules(blockOrient);
        var mapped = mapSpacingForOrientation(rules, blockOrientEngine);
        var pvRules = {
          spacingXcm: mapped.spacingXcm,
          spacingYcm: mapped.spacingYcm,
          marginOuterCm: Number.isFinite(effRules.marginOuterCm) ? effRules.marginOuterCm : 0,
          orientation: effRules.orientation,
        };
        var out = Object.assign({}, ctx, { pvRules: pvRules });
        if (dims && Number.isFinite(dims.widthM) && Number.isFinite(dims.heightM)) {
          /* panelOrientation reflète block.orientation (pas de hardcode) — dimensions effectives suivent. */
          out.panelParams = {
            panelWidthMm: dims.widthM * 1000,
            panelHeightMm: dims.heightM * 1000,
            panelOrientation: blockOrientEngine,
            localRotationDeg: 0,
          };
        }
        if (typeof window !== "undefined" && window.__PV_AUDIT__ === true) {
          console.log("[PV_AUDIT][CTX_BLOCK]", block.id, block.orientation, block.rotationBaseDeg, out.panelParams.panelOrientation, out.panelParams.localRotationDeg, pvRules.spacingXcm, pvRules.spacingYcm);
        }
        return out;
      }

      /** Teste si un point (image) est ? l?int?rieur d?un panneau du bloc actif (projection effective). Utilis? pour d?marrer la manipulation du bloc. */
      function hitTestActiveBlock(imgPt) {
        var ENG = window.pvPlacementEngine;
        var block = ENG && ENG.getFocusBlock ? ENG.getFocusBlock() : null;
        if (!ENG || !block || !block.panels) return false;
        for (var i = 0; i < block.panels.length; i++) {
          var proj = ENG.getEffectivePanelProjection(block, i);
          if (proj && proj.points && proj.points.length >= 3 && pointInPolygonImage(imgPt, proj.points)) return true;
        }
        return false;
      }

      function hitTestActiveBlockPanelIndex(imgPt) {
        var ENG = window.pvPlacementEngine;
        var block = ENG && ENG.getFocusBlock ? ENG.getFocusBlock() : null;
        if (!ENG || !block || !block.panels) return -1;
        for (var i = 0; i < block.panels.length; i++) {
          if (block.panels[i].enabled === false) continue;
          var proj = ENG.getEffectivePanelProjection(block, i);
          if (proj && proj.points && proj.points.length >= 3 && pointInPolygonImage(imgPt, proj.points)) return i;
        }
        return -1;
      }

      /** Hit-test panneau du focusBlock : retourne { blockId, panelId } ou null (sélection stable). */
      function hitTestFocusBlockPanelId(imgPt) {
        var ENG = window.pvPlacementEngine;
        var block = ENG && ENG.getFocusBlock ? ENG.getFocusBlock() : null;
        if (!ENG || !block || !block.panels) return null;
        for (var i = 0; i < block.panels.length; i++) {
          var proj = ENG.getEffectivePanelProjection(block, i);
          if (proj && proj.points && proj.points.length >= 3 && pointInPolygonImage(imgPt, proj.points)) {
            var p = block.panels[i];
            var panelId = p && typeof p.id === "string" && p.id ? p.id : ("legacy-" + i);
            return { blockId: block.id, panelId: panelId };
          }
        }
        return null;
      }

      /** Index du panneau du focusBlock sous le point. Rétrocompat (délègue à hitTestFocusBlockPanelId + getPanelIndexById). */
      function hitTestFocusBlockPanelIndex(imgPt) {
        var hit = hitTestFocusBlockPanelId(imgPt);
        if (!hit || !hit.panelId) return -1;
        var block = window.pvPlacementEngine && window.pvPlacementEngine.getBlockById ? window.pvPlacementEngine.getBlockById(hit.blockId) : null;
        if (!block) return -1;
        if (typeof hit.panelId === "string" && hit.panelId.indexOf("legacy-") === 0) {
          var idx = parseInt(hit.panelId.slice(7), 10);
          return (Number.isFinite(idx) && idx >= 0 && idx < block.panels.length) ? idx : -1;
        }
        return window.ActivePlacementBlock && typeof window.ActivePlacementBlock.getPanelIndexById === "function"
          ? window.ActivePlacementBlock.getPanelIndexById(block, hit.panelId)
          : -1;
      }

      /** Hit test blocs fig?s : retourne le premier bloc (en ordre dessin) dont un panneau contient le point. */
      function hitTestFrozenBlock(imgPt) {
        var ENG = window.pvPlacementEngine;
        if (!ENG || typeof ENG.getFrozenBlocks !== "function") return null;
        var frozen = ENG.getFrozenBlocks();
        for (var i = frozen.length - 1; i >= 0; i--) {
          var bl = frozen[i];
          if (!bl.panels) continue;
          for (var p = 0; p < bl.panels.length; p++) {
            var proj = bl.panels[p].projection;
            if (proj && proj.points && proj.points.length >= 3 && pointInPolygonImage(imgPt, proj.points)) {
              return { blockId: bl.id };
            }
          }
        }
        return null;
      }

      /** Reconstruit CALPINAGE_STATE.placedPanels ? partir des blocs fig?s uniquement. ?? appeler apr?s endBlock ou removeBlock. */
      function syncPlacedPanelsFromBlocks() {
        var ENG = window.pvPlacementEngine;
        if (!ENG || typeof ENG.getFrozenBlocks !== "function") return;
        CALPINAGE_STATE.placedPanels = [];
        var frozen = ENG.getFrozenBlocks();
        for (var i = 0; i < frozen.length; i++) {
          var bl = frozen[i];
          if (!bl.panels) continue;
          for (var k = 0; k < bl.panels.length; k++) {
            var c = bl.panels[k].center;
            var proj = bl.panels[k].projection;
            var wPx = proj && typeof proj.halfLengthPerpPx === "number" ? proj.halfLengthPerpPx * 2 : 0;
            var hPx = proj && typeof proj.halfLengthAlongSlopePx === "number" ? proj.halfLengthAlongSlopePx * 2 : 0;
            CALPINAGE_STATE.placedPanels.push({ panId: bl.panId, x: c.x, y: c.y, widthPx: wPx, heightPx: hPx });
          }
        }
      }

      /** Recalcule projections + ghosts du bloc actif (replace, jamais concat). Appelé par onOrientationChange. */
      function recomputeActiveBlockProjectionsAndGhosts(pivotPanelId) {
        var ENG = window.pvPlacementEngine;
        var active = ENG && typeof ENG.getActiveBlock === "function" ? ENG.getActiveBlock() : null;
        if (!active) return;
        recomputeAllPlacementBlocksFromRules(true, pivotPanelId);
      }

      /** Reflow : recalcule toutes les projections des blocs (fig?s + actif) via l'engine. Centres inchang?s.
       * Apr?s reflow, revalidation du bloc actif pour coh?rence valid/invalid.
       * @param {boolean} [forceRebuild] - si true, re-fetch du bloc actif apr?s recompute pour ?viter d'utiliser d'anciens existingRects.
       * @param {string} [pivotPanelId] - panneau sélectionné pour ancrage grille (toggle orientation). */
      function recomputeAllPlacementBlocksFromRules(forceRebuild, pivotPanelId) {
        var ENG = window.pvPlacementEngine;
        if (!ENG || typeof ENG.getFrozenBlocks !== "function" || typeof ENG.recomputeBlock !== "function") return;
        var frozen = ENG.getFrozenBlocks();
        for (var i = 0; i < frozen.length; i++) {
          var block = frozen[i];
          var ctx = getProjectionContextForBlock(block);
          if (ctx) ENG.recomputeBlock(block.id, window.PV_LAYOUT_RULES, ctx);
        }
        var active = ENG.getActiveBlock();
        if (active) {
          var ctxActive = getProjectionContextForBlock(active);
          var optsActive = (pivotPanelId && active.panels && active.panels.some(function (p) { return p && p.id === pivotPanelId; })) ? { pivotPanelId: pivotPanelId } : undefined;
          if (ctxActive) ENG.recomputeBlock(active.id, window.PV_LAYOUT_RULES, ctxActive, optsActive);
          if (forceRebuild) active = ENG.getActiveBlock();
          if (active && typeof ENG.updatePanelValidationForBlock === "function") {
            var getCtxActive = function () { return getProjectionContextForBlock(active); };
            ENG.updatePanelValidationForBlock(active, getCtxActive);
          }
        }
      }

      /** Phase 3 uniquement : met à jour la source de vérité moteur (position + rotation du bloc) avant tout recompute / render. */
      function commitPhase3BlockTransform() {
        if (CALPINAGE_STATE.currentPhase !== "PV_LAYOUT") return;
        var ENG = window.pvPlacementEngine;
        if (!ENG || typeof ENG.commitManipulation !== "function") return;

        console.log("[PH3] commit", {
          phase: CALPINAGE_STATE.currentPhase,
          isManip: window.CALPINAGE_IS_MANIPULATING
        });

        ENG.commitManipulation();
      }

      /** Charge les param?tres PV depuis localStorage et remplit PV_LAYOUT_RULES (Phase 3). Restaure aussi le panneau s?lectionn?.
       * Si PV_RULES_INITIALIZED : ne pas ?craser PV_LAYOUT_RULES (source de v?rit? runtime) ; uniquement selectedPanelId. */
      function loadPvParams() {
        var rules = window.PV_LAYOUT_RULES;
        if (!rules) return;
        try {
          var specs = getPanelList();
          var sid = (typeof window !== "undefined" && window.CALPINAGE_STUDY_ID) || null;
          var vid = (typeof window !== "undefined" && window.CALPINAGE_VERSION_ID) || null;
          var raw = getCalpinageItem("pv-params", sid, vid);
          if (raw) {
            var o = JSON.parse(raw);
            if (o && typeof o === "object") {
              if (!window.PV_RULES_INITIALIZED) {
                if (typeof o.marginOuterCm === "number") rules.marginOuterCm = Math.max(0, o.marginOuterCm);
                if (typeof o.spacingXcm === "number") rules.spacingXcm = Math.max(0, o.spacingXcm);
                if (typeof o.spacingYcm === "number") rules.spacingYcm = Math.max(0, o.spacingYcm);
                if (o.orientation === "PORTRAIT" || o.orientation === "PAYSAGE") rules.orientation = o.orientation === "PAYSAGE" ? "landscape" : "portrait";
                if (o.orientation === "portrait" || o.orientation === "landscape") rules.orientation = o.orientation;
                if (typeof o.distanceLimitesCm === "number") rules.marginOuterCm = Math.max(0, o.distanceLimitesCm);
                if (typeof o.espacementHorizontalCm === "number") rules.spacingXcm = Math.max(0, o.espacementHorizontalCm);
                if (typeof o.espacementVerticalCm === "number") rules.spacingYcm = Math.max(0, o.spacingYcm);
                if (o.orientationPanneaux === "portrait" || o.orientationPanneaux === "paysage" || o.orientationPanneaux === "landscape") rules.orientation = (o.orientationPanneaux === "paysage" || o.orientationPanneaux === "landscape") ? "landscape" : "portrait";
              }
              var savedPanelId = o.selectedPanelId;
              if (typeof savedPanelId === "string" && savedPanelId) {
                var spec = findPanelById(savedPanelId);
                if (spec) {
                  window.PV_SELECTED_PANEL = buildPVSelectedPanel(spec);
                  window.CALPINAGE_SELECTED_PANEL_ID = savedPanelId;
                } else {
                  window.PV_SELECTED_PANEL = null;
                  window.CALPINAGE_SELECTED_PANEL_ID = null;
                }
              } else {
                window.PV_SELECTED_PANEL = null;
                window.CALPINAGE_SELECTED_PANEL_ID = null;
              }
              /* CP-006 — Restauration onduleur sélectionné */
              var savedInverterId = o.selectedInverterId;
              if (typeof savedInverterId === "string" && savedInverterId) {
                var inv = findInverterById(savedInverterId);
                if (inv) {
                  window.PV_SELECTED_INVERTER = inv;
                  window.CALPINAGE_SELECTED_INVERTER_ID = savedInverterId;
                } else {
                  window.PV_SELECTED_INVERTER = null;
                  window.CALPINAGE_SELECTED_INVERTER_ID = null;
                }
              } else {
                window.PV_SELECTED_INVERTER = null;
                window.CALPINAGE_SELECTED_INVERTER_ID = null;
              }
            }
          }
          CALPINAGE_STATE.pvParams.distanceLimitesCm = rules.marginOuterCm;
          CALPINAGE_STATE.pvParams.espacementHorizontalCm = rules.spacingXcm;
          CALPINAGE_STATE.pvParams.espacementVerticalCm = rules.spacingYcm;
          CALPINAGE_STATE.pvParams.orientationPanneaux = (rules.orientation === "landscape" || rules.orientation === "portrait") ? rules.orientation : ((rules.orientation || "").toUpperCase() === "PAYSAGE" ? "landscape" : "portrait");
          if (window.PV_SELECTED_PANEL == null && specs.length > 0) {
            var chosenSpec = specs[0];
            window.PV_SELECTED_PANEL = buildPVSelectedPanel(chosenSpec);
            window.CALPINAGE_SELECTED_PANEL_ID = chosenSpec.id;
            var sel = container.querySelector("#pv-panel-select");
            if (sel) {
              sel.value = chosenSpec.id;
              sel.dispatchEvent(new Event("change", { bubbles: true }));
            }
            savePvParams();
            if (typeof window.syncPhase3LayoutUI === "function") window.syncPhase3LayoutUI();
          }
        } catch (e) {}
      }
      /** Sauvegarde : PV_LAYOUT_RULES (source de v?rit?) ??? CALPINAGE_STATE.pvParams + localStorage. Sauvegarde aussi selectedPanelId. */
      function savePvParams() {
        var rules = window.PV_LAYOUT_RULES;
        if (!rules) return;
        CALPINAGE_STATE.pvParams.distanceLimitesCm = rules.marginOuterCm;
        CALPINAGE_STATE.pvParams.espacementHorizontalCm = rules.spacingXcm;
        CALPINAGE_STATE.pvParams.espacementVerticalCm = rules.spacingYcm;
        var orientVal = (rules.orientation || "portrait").toString().toLowerCase();
        CALPINAGE_STATE.pvParams.orientationPanneaux = (orientVal === "landscape" || orientVal === "paysage") ? "landscape" : "portrait";
        try {
          var payload = {
            orientation: orientVal === "landscape" ? "landscape" : "portrait",
            marginOuterCm: rules.marginOuterCm,
            spacingXcm: rules.spacingXcm,
            spacingYcm: rules.spacingYcm,
          };
          if (window.PV_SELECTED_PANEL && window.PV_SELECTED_PANEL.id) payload.selectedPanelId = window.PV_SELECTED_PANEL.id;
          if (window.PV_SELECTED_INVERTER && window.PV_SELECTED_INVERTER.id) payload.selectedInverterId = window.PV_SELECTED_INVERTER.id;
          var sid = (typeof window !== "undefined" && window.CALPINAGE_STUDY_ID) || null;
          var vid = (typeof window !== "undefined" && window.CALPINAGE_VERSION_ID) || null;
          if (sid && vid) setCalpinageItem("pv-params", sid, vid, JSON.stringify(payload));
        } catch (e) {}
      }
      function ensurePVSelectedPanel() {
        try {
          if (window.PV_SELECTED_PANEL && Number.isFinite(window.PV_SELECTED_PANEL.widthMm) && Number.isFinite(window.PV_SELECTED_PANEL.heightMm)) {
            return true;
          }
          var specs = getPanelList();
          if (!specs || !specs.length) return false;

          var chosen = specs[0];
          if (!chosen) return false;

          if (typeof buildPVSelectedPanel === "function") {
            window.PV_SELECTED_PANEL = buildPVSelectedPanel(chosen);
            window.CALPINAGE_SELECTED_PANEL_ID = chosen.id;
          } else {
            return false;
          }

          var sel = container.querySelector("#pv-panel-select");
          if (sel && chosen.id) sel.value = chosen.id;

          if (typeof savePvParams === "function") savePvParams();

          return !!(window.PV_SELECTED_PANEL && Number.isFinite(window.PV_SELECTED_PANEL.widthMm) && Number.isFinite(window.PV_SELECTED_PANEL.heightMm));
        } catch(e) {
          console.warn("[PV] ensurePVSelectedPanel failed", e);
          return false;
        }
      }
      function resolveRidgePoint(rp) {
        if (!rp || typeof rp.x !== "number") return rp;
        if (rp.attach && rp.attach.type === "trait") {
          var t = CALPINAGE_STATE.traits.find(function (x) { return x.id === rp.attach.id; });
          if (!t) return rp;
          if (rp.attach.pointIndex === 0) return t.a;
          if (rp.attach.pointIndex === 1) return t.b;
          return rp;
        }
        if (rp.attach && rp.attach.type === "contour" && rp.attach.pointIndex != null) {
          var c = CALPINAGE_STATE.contours.find(function (x) { return x.id === rp.attach.id; });
          if (!c || !c.points[rp.attach.pointIndex]) return rp;
          return c.points[rp.attach.pointIndex];
        }
        return rp;
      }

      var HEIGHT_EDIT_EPS_IMG = 15;
      var DEFAULT_HEIGHT_GUTTER = 4;
      var DEFAULT_HEIGHT_RIDGE = 7;

      function distImgPt(a, b) {
        return Math.hypot((b.x - a.x), (b.y - a.y));
      }

      /** Retourne la hauteur du point source ? la position imgPt (contour / fa??tage / trait), ou null. */
      function getHeightAtPoint(imgPt, state) {
        state = state || CALPINAGE_STATE;
        var contours = (state.contours || []).filter(function (c) { return c.roofRole !== "chienAssis"; });
        var ridges = (state.ridges || []).filter(function (r) { return r.roofRole !== "chienAssis"; });
        var traits = (state.traits || []).filter(function (t) { return t.roofRole !== "chienAssis"; });
        var rp = state === CALPINAGE_STATE ? resolveRidgePoint : function (rp) { return resolveRidgePointFromState(state, rp); };
        var i, pt;
        for (i = 0; i < contours.length; i++) {
          if (!contours[i].points) continue;
          for (var j = 0; j < contours[i].points.length; j++) {
            pt = contours[i].points[j];
            if (pt && distImgPt(imgPt, pt) <= HEIGHT_EDIT_EPS_IMG) return typeof pt.h === "number" ? pt.h : DEFAULT_HEIGHT_GUTTER;
          }
        }
        for (i = 0; i < ridges.length; i++) {
          pt = rp(ridges[i].a);
          if (pt && distImgPt(imgPt, pt) <= HEIGHT_EDIT_EPS_IMG) return typeof ridges[i].a.h === "number" ? ridges[i].a.h : DEFAULT_HEIGHT_RIDGE;
          pt = rp(ridges[i].b);
          if (pt && distImgPt(imgPt, pt) <= HEIGHT_EDIT_EPS_IMG) return typeof ridges[i].b.h === "number" ? ridges[i].b.h : DEFAULT_HEIGHT_RIDGE;
        }
        for (i = 0; i < traits.length; i++) {
          if (traits[i].a && distImgPt(imgPt, traits[i].a) <= HEIGHT_EDIT_EPS_IMG) return typeof traits[i].a.h === "number" ? traits[i].a.h : DEFAULT_HEIGHT_GUTTER;
          if (traits[i].b && distImgPt(imgPt, traits[i].b) <= HEIGHT_EDIT_EPS_IMG) return typeof traits[i].b.h === "number" ? traits[i].b.h : DEFAULT_HEIGHT_GUTTER;
        }
        return null;
      }

      /** State pour le bundle Pans : roof, pans, getVertexH (hauteurs sources). */
      function getStateForPans() {
        return {
          roof: CALPINAGE_STATE.roof,
          pans: CALPINAGE_STATE.pans,
          getVertexH: function (imgPt) {
            var h = getHeightAtPoint(imgPt, CALPINAGE_STATE);
            if (h == null || (typeof h !== "number") || !Number.isFinite(h)) {
              CALPINAGE_STATE.__lastMissingH = (CALPINAGE_STATE.__lastMissingH || 0) + 1;
              return 0;
            }
            return h;
          }
        };
      }

      /** API officielle : hauteur Z (m) d'un point (xPx,yPx) sur un pan. Plan h = a*xM + b*yM + c. */
      window.getHeightAtXY = function (panId, xPx, yPx) {
        if (typeof window.CalpinagePans === "undefined" || typeof window.CalpinagePans.getHeightAtXY !== "function") return null;
        return window.CalpinagePans.getHeightAtXY(panId, xPx, yPx, getStateForPans());
      };

      /** Hauteur à un point image (x,y). Trouve le pan contenant le point et appelle getHeightAtXY. Retourne 0 si hors pan. */
      function getHeightAtImgPoint(imgPt) {
        var pan = hitTestPan(imgPt);
        if (!pan || !pan.id) return 0;
        var h = window.getHeightAtXY(pan.id, imgPt.x, imgPt.y);
        return (typeof h === "number" && Number.isFinite(h)) ? h : 0;
      }

      /** Pour chaque pan (CALPINAGE_STATE.pans), cr?e/met ? jour pan.points[] ? partir de pan.polygon[] et des hauteurs sources (getHeightAtPoint). */
      function ensurePanPointsWithHeights() {
        var pans = CALPINAGE_STATE.pans || [];
        for (var i = 0; i < pans.length; i++) {
          var pan = pans[i];
          var poly = pan.polygon || pan.points || null;
          if (!poly || poly.length < 2) continue;
          if (pan.polygon && pan.polygon.length >= 2) {
            pan.points = pan.polygon.map(function (p, idx) {
              var h = (typeof getHeightAtPoint === "function") ? getHeightAtPoint(p, CALPINAGE_STATE) : 0;
              return { x: p.x, y: p.y, h: (typeof h === "number" ? h : 0), id: (pan.id ? (pan.id + "-" + idx) : ("pan-" + i + "-" + idx)) };
            });
          } else if (pan.points && pan.points.length >= 2) {
            pan.points = pan.points.map(function (p, idx) {
              if (typeof p.h === "number") return p;
              var h = (typeof getHeightAtPoint === "function") ? getHeightAtPoint(p, CALPINAGE_STATE) : 0;
              return { x: p.x, y: p.y, h: (typeof h === "number" ? h : 0), id: p.id || (pan.id ? (pan.id + "-" + idx) : ("pan-" + i + "-" + idx)) };
            });
          }
        }
      }

      /** Hauteur d?une extr?mit? de trait : connect? ? fa??tage ??? 7 m, contour b??ti ??? 4 m. Utilise attach si pr?sent, sinon d?tection par position (fa??tage prioritaire). */
      function getTraitEndpointHeight(imgPt, endpointObj, state) {
        state = state || CALPINAGE_STATE;
        var rp = state === CALPINAGE_STATE ? resolveRidgePoint : function (rp) { return resolveRidgePointFromState(state, rp); };
        if (endpointObj && endpointObj.attach && endpointObj.attach.type) {
          if (endpointObj.attach.type === "ridge") return DEFAULT_HEIGHT_RIDGE;
          if (endpointObj.attach.type === "contour") return DEFAULT_HEIGHT_GUTTER;
          return DEFAULT_HEIGHT_GUTTER;
        }
        var contours = (state.contours || []).filter(function (c) { return c.roofRole !== "chienAssis"; });
        var ridges = (state.ridges || []).filter(function (r) { return r.roofRole !== "chienAssis"; });
        var i, pt;
        for (i = 0; i < ridges.length; i++) {
          pt = rp(ridges[i].a);
          if (pt && distImgPt(imgPt, pt) <= HEIGHT_EDIT_EPS_IMG) return DEFAULT_HEIGHT_RIDGE;
          pt = rp(ridges[i].b);
          if (pt && distImgPt(imgPt, pt) <= HEIGHT_EDIT_EPS_IMG) return DEFAULT_HEIGHT_RIDGE;
        }
        for (i = 0; i < contours.length; i++) {
          if (!contours[i].points) continue;
          for (var j = 0; j < contours[i].points.length; j++) {
            pt = contours[i].points[j];
            if (pt && distImgPt(imgPt, pt) <= HEIGHT_EDIT_EPS_IMG) return DEFAULT_HEIGHT_GUTTER;
          }
        }
        return DEFAULT_HEIGHT_GUTTER;
      }

      /** Réservé à un import initial hors UI. Ne modifie plus h. */
      function initHeights() {
        /* Vide : aucune écriture sur h. Les hauteurs sont uniquement modifiées via applyHeightToSelectedPoints. */
      }

      /** Retourne le point image (x,y) pour une sélection { type, index, pointIndex }. */
      function getImgPtForHeightSelection(sel) {
        if (!sel) return null;
        var contours = (CALPINAGE_STATE.contours || []).filter(function (c) { return c.roofRole !== "chienAssis"; });
        var ridges = (CALPINAGE_STATE.ridges || []).filter(function (r) { return r.roofRole !== "chienAssis"; });
        var traits = (CALPINAGE_STATE.traits || []).filter(function (t) { return t.roofRole !== "chienAssis"; });
        if (sel.type === "contour") {
          var c = contours[sel.index];
          return c && c.points && c.points[sel.pointIndex] ? c.points[sel.pointIndex] : null;
        }
        if (sel.type === "ridge") {
          var r = ridges[sel.index];
          if (!r) return null;
          var end = sel.pointIndex === 0 ? r.a : r.b;
          return end ? resolveRidgePoint(end) : null;
        }
        if (sel.type === "trait") {
          var t = traits[sel.index];
          if (!t) return null;
          return sel.pointIndex === 0 ? t.a : t.b;
        }
        return null;
      }

      /** Hit-test des points source (mode hauteur) : retourne { type, index, pointIndex } ou null. */
      function hitTestHeightPoints(imgPt, imageToScreen, screenToImage) {
        var contours = (CALPINAGE_STATE.contours || []).filter(function (c) { return c.roofRole !== "chienAssis"; });
        var ridges = (CALPINAGE_STATE.ridges || []).filter(function (r) { return r.roofRole !== "chienAssis"; });
        var traits = (CALPINAGE_STATE.traits || []).filter(function (t) { return t.roofRole !== "chienAssis"; });
        var best = null;
        var bestDist = 20;
        var screenPt = imageToScreen(imgPt);
        function check(distPx, type, index, pointIndex) {
          if (distPx < bestDist) { bestDist = distPx; best = { type: type, index: index, pointIndex: pointIndex }; }
        }
        var i, j, sc, d;
        for (i = 0; i < contours.length; i++) {
          if (!contours[i].points) continue;
          for (j = 0; j < contours[i].points.length; j++) {
            sc = imageToScreen(contours[i].points[j]);
            d = Math.hypot(screenPt.x - sc.x, screenPt.y - sc.y);
            check(d, "contour", i, j);
          }
        }
        for (i = 0; i < ridges.length; i++) {
          var ra = resolveRidgePoint(ridges[i].a);
          var rb = resolveRidgePoint(ridges[i].b);
          if (ra) { sc = imageToScreen(ra); d = Math.hypot(screenPt.x - sc.x, screenPt.y - sc.y); check(d, "ridge", i, 0); }
          if (rb) { sc = imageToScreen(rb); d = Math.hypot(screenPt.x - sc.x, screenPt.y - sc.y); check(d, "ridge", i, 1); }
        }
        for (i = 0; i < traits.length; i++) {
          if (traits[i].a) { sc = imageToScreen(traits[i].a); d = Math.hypot(screenPt.x - sc.x, screenPt.y - sc.y); check(d, "trait", i, 0); }
          if (traits[i].b) { sc = imageToScreen(traits[i].b); d = Math.hypot(screenPt.x - sc.x, screenPt.y - sc.y); check(d, "trait", i, 1); }
        }
        return best;
      }

      /** Retourne la hauteur pour une sélection donnée (un point). */
      function getHeightForSelection(sel) {
        if (!sel) return null;
        var contours = (CALPINAGE_STATE.contours || []).filter(function (c) { return c.roofRole !== "chienAssis"; });
        var ridges = (CALPINAGE_STATE.ridges || []).filter(function (r) { return r.roofRole !== "chienAssis"; });
        var traits = (CALPINAGE_STATE.traits || []).filter(function (t) { return t.roofRole !== "chienAssis"; });
        if (sel.type === "contour") {
          var c = contours[sel.index];
          if (!c || !c.points || c.points[sel.pointIndex] == null) return null;
          return typeof c.points[sel.pointIndex].h === "number" ? c.points[sel.pointIndex].h : DEFAULT_HEIGHT_GUTTER;
        }
        if (sel.type === "ridge") {
          var r = ridges[sel.index];
          if (!r) return null;
          var end = sel.pointIndex === 0 ? r.a : r.b;
          return typeof end.h === "number" ? end.h : DEFAULT_HEIGHT_RIDGE;
        }
        if (sel.type === "trait") {
          var t = traits[sel.index];
          if (!t) return null;
          var end = sel.pointIndex === 0 ? t.a : t.b;
          return typeof end.h === "number" ? end.h : DEFAULT_HEIGHT_GUTTER;
        }
        return null;
      }

      function getSelectedPointHeight() {
        var pts = CALPINAGE_STATE.selectedHeightPoints;
        var sel = (pts && pts.length) ? pts[0] : CALPINAGE_STATE.selectedHeightPoint;
        return getHeightForSelection(sel);
      }

      /** SEULE fonction autorisée à modifier h. Écrit value sur chaque point de sels (ou sélection courante si sels absent). Aucune propagation implicite. */
      function applyHeightToSelectedPoints(value, optionalSels) {
        var pts = optionalSels != null ? optionalSels : CALPINAGE_STATE.selectedHeightPoints;
        var sels = (pts && pts.length) ? pts : (CALPINAGE_STATE.selectedHeightPoint ? [CALPINAGE_STATE.selectedHeightPoint] : []);
        if (!sels.length) return;
        var v = parseFloat(value);
        if (isNaN(v) || v < 0) return;
        var contours = (CALPINAGE_STATE.contours || []).filter(function (c) { return c.roofRole !== "chienAssis"; });
        var ridges = (CALPINAGE_STATE.ridges || []).filter(function (r) { return r.roofRole !== "chienAssis"; });
        var traits = (CALPINAGE_STATE.traits || []).filter(function (t) { return t.roofRole !== "chienAssis"; });
        function setOne(sel) {
          if (sel.type === "contour") {
            var c = contours[sel.index];
            if (c && c.points && c.points[sel.pointIndex]) c.points[sel.pointIndex].h = v;
          } else if (sel.type === "ridge") {
            var r = ridges[sel.index];
            if (r) { var end = sel.pointIndex === 0 ? r.a : r.b; if (end) end.h = v; }
          } else if (sel.type === "trait") {
            var t = traits[sel.index];
            if (t) { var end = sel.pointIndex === 0 ? t.a : t.b; if (end) end.h = v; }
          }
        }
        sels.forEach(setOne);
        if (optionalSels == null) CALPINAGE_STATE.selectedHeightPoint = sels[0];
        computePansFromGeometry();
        ensurePanPointsWithHeights();
        if (window.CalpinagePans && CalpinagePans.recomputeAllPanPhysicalProps && CALPINAGE_STATE.pans.length) {
          CalpinagePans.recomputeAllPanPhysicalProps(CALPINAGE_STATE.pans, getStateForPans());
        }
        updatePansListUI();
        if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
        saveCalpinageState();
      }

      /** Valide la hauteur en cours : appelle applyHeightToSelectedPoints, sauvegarde, ferme l'input, feedback. Reste en mode HeightEditMode. */
      function commitHeightEdit() {
        var cont = container.querySelector("#height-edit-inplace-container");
        var focusedInput = document.activeElement && document.activeElement.tagName === "INPUT" && cont && cont.contains(document.activeElement) ? document.activeElement : null;
        var firstInput = cont ? cont.querySelector("input") : null;
        var srcInput = focusedInput || firstInput;
        var v = srcInput ? parseFloat(srcInput.value) : (heightEditDraftValue != null ? heightEditDraftValue : getSelectedPointHeight());
        if (v != null && !isNaN(v) && v >= 0) {
          heightEditDraftValue = v;
          applyHeightToSelectedPoints(v);
          if (typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
          exitHeightEdit(false);
          if (typeof window.showToast === "function") window.showToast("Hauteur enregistrée", true);
        }
      }

      /** Ferme l'édition hauteur : clear sélection, masque overlay, sort du mode si demandé. */
      function exitHeightEdit(exitMode) {
        CALPINAGE_STATE.selectedHeightPoint = null;
        CALPINAGE_STATE.selectedHeightPoints = [];
        heightEditDraftValue = null;
        heightEditInplaceRollbackValues = [];
        var cont = container.querySelector("#height-edit-inplace-container");
        if (cont) cont.innerHTML = "";
        if (exitMode) {
          CALPINAGE_STATE.heightEditMode = false;
          drawState.activeTool = "select";
          var btn = container.querySelector("#calpinage-btn-height-edit");
          if (btn) {
            btn.setAttribute("aria-pressed", "false");
            btn.classList.remove("calpinage-tool-active");
          }
        }
        if (typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
      }

      /** Valeurs au moment de l'ouverture (pour rollback ESC). Une par point sélectionné. */
      var heightEditInplaceRollbackValues = [];
      /** Valeur en cours de saisie (sync live vers tous les inputs et points sélectionnés). */
      var heightEditDraftValue = null;

      /** Affiche N inputs in-place, un par sommet sélectionné. Chaque overlay affiche la vraie valeur du point ; si draftValue défini, tous reflètent draftValue. */
      function updateHeightEditInplaceOverlay(imageToScreen, canvasEl) {
        var cont = container.querySelector("#height-edit-inplace-container");
        if (!cont) return;
        var pts = CALPINAGE_STATE.selectedHeightPoints;
        var sels = (pts && pts.length) ? pts : (CALPINAGE_STATE.selectedHeightPoint ? [CALPINAGE_STATE.selectedHeightPoint] : []);
        if (!sels.length) {
          cont.innerHTML = "";
          heightEditInplaceRollbackValues = [];
          heightEditDraftValue = null;
          return;
        }
        var displayVal = function (i) { return heightEditDraftValue != null ? heightEditDraftValue : getHeightForSelection(sels[i]); };
        if (heightEditInplaceRollbackValues.length !== sels.length) {
          heightEditInplaceRollbackValues = sels.map(function (s, i) { return getHeightForSelection(s); });
        }
        var inputStyle = "width:64px;padding:4px 8px;border-radius:var(--sg-radius-sm);border:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.1);color:#fff;font-size:13px;pointer-events:auto;";
        var boxStyle = "position:absolute;background:#1f2937;color:#fff;padding:6px 10px;border-radius:var(--sg-radius-sm);font-size:13px;box-shadow:var(--sg-shadow-soft);pointer-events:auto;";
        var needRebuild = cont.children.length !== sels.length;
        if (!needRebuild) {
          for (var i = 0; i < sels.length; i++) {
            var imgPt = getImgPtForHeightSelection(sels[i]);
            if (!imgPt) { needRebuild = true; break; }
            var sp = imageToScreen(imgPt);
            var box = cont.children[i];
            if (box) {
              box.style.left = Math.max(4, sp.x - 70) + "px";
              box.style.top = Math.max(4, sp.y - 40) + "px";
              var inp = box.querySelector("input");
              var v = displayVal(i);
              if (inp && inp !== document.activeElement && String(inp.value) !== String(v != null ? v : "")) inp.value = v != null ? String(v) : "";
            }
          }
        }
        if (needRebuild) {
          cont.innerHTML = "";
          var firstInput = null;
          for (var i = 0; i < sels.length; i++) {
            var imgPt = getImgPtForHeightSelection(sels[i]);
            if (!imgPt) continue;
            var sp = imageToScreen(imgPt);
            var box = document.createElement("div");
            box.style.cssText = boxStyle + "left:" + Math.max(4, sp.x - 70) + "px;top:" + Math.max(4, sp.y - 40) + "px;";
            var inp = document.createElement("input");
            inp.type = "number";
            inp.step = "0.1";
            inp.min = "0";
            inp.max = "50";
            inp.style.cssText = inputStyle;
            inp.setAttribute("aria-label", "Hauteur en mètres");
            inp.value = String(displayVal(i) != null ? displayVal(i) : "");
            inp.dataset.index = String(i);
            box.appendChild(inp);
            box.appendChild(document.createTextNode(" m — Entrée pour valider"));
            cont.appendChild(box);
            if (!firstInput) firstInput = inp;
          }
          if (firstInput) firstInput.focus();
        }
      }

      function segIntersectsBox(a, b, minX, minY, maxX, maxY) {
        function inBox(p) { return p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY; }
        if (inBox(a) || inBox(b)) return true;
        var r1 = { x: minX, y: minY }, r2 = { x: maxX, y: minY }, r3 = { x: maxX, y: maxY }, r4 = { x: minX, y: maxY };
        function ccw(A, B, C) { return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x); }
        function intersect(A, B, C, D) {
          return (ccw(A, C, D) !== ccw(B, C, D)) && (ccw(A, B, C) !== ccw(A, B, D));
        }
        if (intersect(a, b, r1, r2)) return true;
        if (intersect(a, b, r2, r3)) return true;
        if (intersect(a, b, r3, r4)) return true;
        if (intersect(a, b, r4, r1)) return true;
        return false;
      }

      /* ----- EDGE API (unification contour / trait / fa??tage en 2D) ----- */
      var EDGE_CONTOUR = "contour";
      var EDGE_TRAIT = "trait";
      var EDGE_RIDGE = "ridge";

      function getEdgesFromState(state, opts) {
        opts = opts || {};
        var edges = [];
        var contours = state.contours || [];
        var traits = state.traits || [];
        var ridges = state.ridges || [];
        if (opts.excludeChienAssis) {
          contours = contours.filter(function (c) { return c.roofRole !== "chienAssis"; });
          traits = traits.filter(function (t) { return t.roofRole !== "chienAssis"; });
          ridges = ridges.filter(function (r) { return r.roofRole !== "chienAssis"; });
        }
        contours.forEach(function (c) {
          if (!c) return;
          edges.push({ kind: EDGE_CONTOUR, id: c.id, ref: c, roofRole: c.roofRole || null, closed: true });
        });
        traits.forEach(function (t) {
          if (!t) return;
          edges.push({ kind: EDGE_TRAIT, id: t.id, ref: t, roofRole: t.roofRole || null, closed: false });
        });
        ridges.forEach(function (r) {
          if (!r) return;
          edges.push({ kind: EDGE_RIDGE, id: r.id, ref: r, roofRole: r.roofRole || null, closed: false });
        });
        return edges;
      }

      function getAllRoofEdgesIncludingExtensions() {
        var edges = [];
        var state = { contours: CALPINAGE_STATE.contours || [], traits: CALPINAGE_STATE.traits || [], ridges: CALPINAGE_STATE.ridges || [] };
        var buildingState = {
          contours: (state.contours || []).filter(function (c) { return c.roofRole !== "chienAssis"; }),
          traits: (state.traits || []).filter(function (t) { return t.roofRole !== "chienAssis"; }),
          ridges: (state.ridges || []).filter(function (r) { return r.roofRole !== "chienAssis"; })
        };
        var baseEdgeRefs = getEdgesFromState(buildingState);
        if (baseEdgeRefs && baseEdgeRefs.length) {
          baseEdgeRefs.forEach(function (edgeRef) {
            var segs = edgeSegments(edgeRef);
            segs.forEach(function (seg) {
              edges.push({ a: seg[0], b: seg[1] });
            });
          });
        }
        var rxList = CALPINAGE_STATE.roofExtensions || [];
        rxList.forEach(function (rx) {
          if (rx.contour && rx.contour.points && rx.contour.points.length >= 2) {
            var pts = rx.contour.points;
            for (var i = 0; i < pts.length; i++) {
              var a = pts[i];
              var b = pts[(i + 1) % pts.length];
              if (a && b) edges.push({ a: a, b: b });
            }
          }
          if (rx.hips) {
            if (rx.hips.left && rx.hips.left.a && rx.hips.left.b) edges.push({ a: rx.hips.left.a, b: rx.hips.left.b });
            if (rx.hips.right && rx.hips.right.a && rx.hips.right.b) edges.push({ a: rx.hips.right.a, b: rx.hips.right.b });
          }
          if (rx.ridge && rx.ridge.a && rx.ridge.b) {
            edges.push({ a: rx.ridge.a, b: rx.ridge.b });
          }
        });
        return edges;
      }

      /** R?solution d?un point de fa??tage dans un state donn?. */
      function resolveRidgePointFromState(state, rp) {
        if (!rp || typeof rp.x !== "number") return rp;
        if (rp.attach && rp.attach.type === "trait") {
          var t = (state.traits || []).find(function (x) { return x.id === rp.attach.id; });
          if (!t) return rp;
          if (rp.attach.pointIndex === 0) return t.a;
          if (rp.attach.pointIndex === 1) return t.b;
          return rp;
        }
        if (rp.attach && rp.attach.type === "contour" && rp.attach.pointIndex != null) {
          var c = (state.contours || []).find(function (x) { return x.id === rp.attach.id; });
          if (!c || !c.points[rp.attach.pointIndex]) return rp;
          return c.points[rp.attach.pointIndex];
        }
        return rp;
      }

      function edgePoints(edgeRef, resolveRidgePointFn) {
        var resolveRp = resolveRidgePointFn || resolveRidgePoint;
        if (edgeRef.kind === EDGE_CONTOUR) return (edgeRef.ref.points || []).slice();
        if (edgeRef.kind === EDGE_TRAIT) return [edgeRef.ref.a, edgeRef.ref.b].filter(Boolean);
        if (edgeRef.kind === EDGE_RIDGE) {
          var ra = resolveRp(edgeRef.ref.a);
          var rb = resolveRp(edgeRef.ref.b);
          return [(ra && typeof ra.x === "number") ? ra : edgeRef.ref.a, (rb && typeof rb.x === "number") ? rb : edgeRef.ref.b].filter(Boolean);
        }
        return [];
      }

      function edgeSegments(edgeRef, resolveRidgePointFn) {
        var pts = edgePoints(edgeRef, resolveRidgePointFn);
        if (pts.length < 2) return [];
        var segs = [];
        for (var i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
        if (edgeRef.closed && pts.length >= 3) segs.push([pts[pts.length - 1], pts[0]]);
        return segs;
      }

      function edgeVertices(edgeRef, resolveRidgePointFn) {
        return edgePoints(edgeRef, resolveRidgePointFn);
      }

      function edgeLabel(edgeRef) {
        return (edgeRef.kind || "?") + ":" + (edgeRef.id != null ? edgeRef.id : "?");
      }

      function edgeProjectPointToSegment(pt, segA, segB) {
        var ax = segA.x, ay = segA.y, bx = segB.x, by = segB.y, px = pt.x, py = pt.y;
        var abx = bx - ax, aby = by - ay;
        var t = (abx * (px - ax) + aby * (py - ay)) / (abx * abx + aby * aby + 1e-20);
        t = Math.max(0, Math.min(1, t));
        return { x: ax + t * abx, y: ay + t * aby };
      }

      /* Seuil fermeture contour (?cran px) ??? identique DP4 */
      var CLOSE_THRESHOLD_PX = 15;
      /* Snap automatique prioritaire : distance ?cran en px (une seule r?gle pour contour / fa??tage / trait) */
      const SNAP_DIST_PX = 12;
      /* Mode debug pans : 1 = affiche stats + overlay des faces d?tect?es (d?sactiv? par d?faut) */
      const CALPINAGE_DEBUG_PANS = 0;
      const MODE_CREATE_DORMER = "CREATE_DORMER";
      const MODE_DORMER_CONTOUR = "DORMER_CONTOUR";
      const MODE_DORMER_RIDGE   = "DORMER_RIDGE";
      const MODE_DORMER_HIPS    = "DORMER_HIPS";

      /* ??tat dessin : outil actif + pr?visualisation ; donn?es m?tier dans CALPINAGE_STATE */
      var drawState = {
        activeTool: "select",
        drawingPoints: [],
        draggingVertexIndex: null,
        selectedContourIndex: null,
        measureLineStart: null,
        selectedMesureIndex: null,
        draggingMesureStartImage: null,
        traitLineStart: null,
        traitSnapPreview: null,
        traitSnapPreviewSource: null,
        traitSnapEdge: null,
        selectedTraitIndex: null,
        draggingTraitPoint: null,
        draggingTraitSegmentStart: null,
        lastMouseImage: null,
        hoverNearFirstPoint: false,
        hoverNearFirstPointObstacle: false,
        selectedRidgeIndex: null,
        draggingRidgePoint: null,
        draggingRidgeOffset: null,
        obstacleShape: null,
        obstacleAnchor: null,
        obstacleCircleStartPoint: null,
        obstacleCircleTempIndex: null,
        obstacleRectStartPoint: null,
        obstacleRectTempIndex: null,
        selectedObstacleIndex: null,
        draggingObstacleOffset: null,
        draggingObstacleHandle: null,
        activePointerId: null,
        draggingVertex: null,
        resizeObstacleStart: null,
        selectedContourIds: [],
        selectedRidgeIds: [],
        selectedTraitIds: [],
        selectionBoxStart: null,
        selectionBoxEnd: null,
        isSelectingBox: false,
        dragMode: null,
        dragBase: null,
        dragLastMouseImg: null,
        snapPreview: null,
        ph3HandleDrag: null,
        ph3HandleDragStart: null, // { x, y } point aimant VISUEL uniquement
        ph3HandleHover: null, // "rotate" | "move" | null pour curseur poignées Phase 3
        /** SHADOW_VOLUMES */
        shadowVolumeCreateShape: null, // "cube" | "tube" | null
        selectedShadowVolumeIndex: null,
        draggingShadowVolumeHandle: null, // "right" | "bottom" | "corner" | "height"
        isPlacingShadowVolume: false,
        shadowVolumePlaceStart: null, // {x,y}
        draggingShadowVolumeMove: false,
        shadowVolumeMoveStart: null, // {x,y, cx, cy}
        resizeShadowVolumeStart: null,
        shadowVolumeRotateStart: null,
        dormerDraft: null,
        dormerActiveTool: null,
        dormerEditRxIndex: null,
        dormerStep: 0,
        selectedRoofExtensionIndex: null,
        dragOffset: null,
        rxDragSnap: null,
        contourHoverSnapSource: null,
        ridgeHintMessageUntil: 0,
        traitHintMessageUntil: 0,
        hoverPanId: null,
      };

      var deleteCurrentSelection;

      /** Mode création volume ombrant. "CREATE_SHADOW_VOLUME" = en attente du clic sur toit. */
      window.CALPINAGE_MODE = null;

      function cancelDormerMode() {
        var wasContour = window.CALPINAGE_MODE === MODE_DORMER_CONTOUR;
        window.CALPINAGE_MODE = null;
        drawState.dormerActiveTool = null;
        drawState.dormerEditRxIndex = null;
        if (wasContour) drawState.dormerDraft = null;
        if (canvasEl) canvasEl.style.cursor = "default";
      }

      /* Phase 2 — Centralisation sélection : reset uniquement les indices selected* */
      function clearSelection() {
        drawState.selectedContourIndex = null;
        drawState.selectedRidgeIndex = null;
        drawState.selectedTraitIndex = null;
        drawState.selectedObstacleIndex = null;
        drawState.selectedRoofExtensionIndex = null;
        drawState.selectedShadowVolumeIndex = null;
        drawState.selectedMesureIndex = null;
      }

      /* Phase 2 — Sélection centralisée à partir d'un hit unifiedHitTest */
      function selectEntityFromHit(hit) {
        clearSelection();
        if (!hit || !hit.type) return;
        switch (hit.type) {
          case "contour":
            drawState.selectedContourIndex = hit.index;
            break;
          case "ridge":
            drawState.selectedRidgeIndex = hit.index;
            break;
          case "trait":
            drawState.selectedTraitIndex = hit.index;
            break;
          case "obstacle":
            drawState.selectedObstacleIndex = hit.index;
            break;
          case "obstacle-vertex":
          case "obstacle-segment":
            drawState.selectedObstacleIndex = hit.obstacleIndex != null ? hit.obstacleIndex : hit.index;
            break;
          case "roofExtension":
            drawState.selectedRoofExtensionIndex = hit.index;
            break;
          case "shadowVolume":
            drawState.selectedShadowVolumeIndex = hit.index;
            break;
          case "mesure":
            drawState.selectedMesureIndex = hit.index;
            break;
        }
      }

      /* Clavier centralisé : attaché UNE FOIS sur container, dispatché vers l'outil actif. */
      addSafeListener(container, "keydown", function (e) {
        if (e.key === "Escape" && (window.CALPINAGE_MODE === MODE_CREATE_DORMER || window.CALPINAGE_MODE === MODE_DORMER_CONTOUR || window.CALPINAGE_MODE === MODE_DORMER_RIDGE || window.CALPINAGE_MODE === MODE_DORMER_HIPS)) {
          cancelDormerMode();
          if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
        }
        if (CALPINAGE_STATE.heightEditMode) {
          if (e.key === "Enter") {
            commitHeightEdit();
            e.preventDefault();
          }
          if (e.key === "Escape") {
            if (heightEditInplaceRollbackValues.length && CALPINAGE_STATE.selectedHeightPoints.length) {
              var sels = CALPINAGE_STATE.selectedHeightPoints;
              for (var ri = 0; ri < sels.length && ri < heightEditInplaceRollbackValues.length; ri++) {
                var rv = heightEditInplaceRollbackValues[ri];
                if (rv != null && !isNaN(rv) && rv >= 0) applyHeightToSelectedPoints(rv, [sels[ri]]);
              }
            }
            exitHeightEdit(false);
            e.preventDefault();
          }
        }
      });

      (function initHeightEditInplaceOverlay() {
        var cont = container.querySelector("#height-edit-inplace-container");
        if (!cont) return;
        addSafeListener(cont, "input", function (e) {
          if (e.target.tagName !== "INPUT") return;
          var v = parseFloat(e.target.value);
          if (!isNaN(v) && v >= 0) {
            heightEditDraftValue = v;
            var active = e.target;
            cont.querySelectorAll("input").forEach(function (inp) {
              if (inp !== active) inp.value = String(v);
            });
            applyHeightToSelectedPoints(v);
          }
        });
      })();

      function loadCalpinageState(fromData) {
        try {
          var data;
          if (fromData && typeof fromData === "object") {
            data = fromData;
          } else {
            var sid = (typeof window !== "undefined" && window.CALPINAGE_STUDY_ID) || null;
            var vid = (typeof window !== "undefined" && window.CALPINAGE_VERSION_ID) || null;
            var raw = getCalpinageItem("state", sid, vid);
            if (!raw) return;
            data = JSON.parse(raw);
          }
          var savedPans = (data.pans && Array.isArray(data.pans)) ? data.pans : [];
          if (savedPans.length > 0) {
            CalpinagePans.panState.pans.length = 0;
            savedPans.forEach(function (p) {
              if (p && (p.ridgeIds === undefined || p.ridgeIds === null)) p.ridgeIds = [];
              CalpinagePans.panState.pans.push(p);
            });
            CalpinagePans.ensurePanPhysicalProps(CalpinagePans.panState.pans);
            if (CalpinagePans.recomputeAllPanPhysicalProps && CalpinagePans.panState.pans.length) {
              CalpinagePans.recomputeAllPanPhysicalProps(CalpinagePans.panState.pans, getStateForPans());
            }
            CalpinagePans.panState.activePanId = data.activePanId == null ? null : data.activePanId;
            CalpinagePans.panState.activePoint = null;
          }
          if (data.roofState && typeof data.roofState === "object") {
            if (data.roofState.map) CALPINAGE_STATE.roof.map = data.roofState.map;
            /* Ne jamais restaurer roof.image : le capture mode ne doit pas persister entre ouvertures (CP-015). */
            if (data.roofState.gps && typeof data.roofState.gps === "object") {
              CALPINAGE_STATE.roof.gps = { lat: data.roofState.gps.lat, lon: data.roofState.gps.lon };
            }
            if (data.roofState.scale) {
              CALPINAGE_STATE.roof.scale.metersPerPixel = data.roofState.scale.metersPerPixel;
              if (data.roofState.scale.source) CALPINAGE_STATE.roof.scale.source = data.roofState.scale.source;
            }
            if (data.roofState.roof) CALPINAGE_STATE.roof.roof = data.roofState.roof;
            if (data.roofState.contoursBati && Array.isArray(data.roofState.contoursBati)) {
              CALPINAGE_STATE.contours = data.roofState.contoursBati.filter(function (pts) { return pts && (pts.roofRole || "") !== "chienAssis"; }).map(function (pts, idx) {
                var points = Array.isArray(pts) ? pts : (pts && pts.points) ? pts.points : [];
                var id = (pts && pts.id) ? pts.id : (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : "c-" + idx;
                return { id: id, points: points, closed: true, roofRole: "main" };
              }).filter(function (c) { return c && c.points && c.points.length >= 2; });
            } else if (data.roofState.contourBati && Array.isArray(data.roofState.contourBati)) {
              CALPINAGE_STATE.contours = [{ id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : "c-0", points: data.roofState.contourBati, closed: true }];
            }
            if (data.roofState.mesures && Array.isArray(data.roofState.mesures)) {
              CALPINAGE_STATE.measures = data.roofState.mesures.map(function (m, idx) {
                var id = (m && m.id) ? m.id : (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : "m-" + idx;
                return { id: id, a: m.a || { x: 0, y: 0 }, b: m.b || { x: 0, y: 0 } };
              });
            }
            if (data.roofState.traits && Array.isArray(data.roofState.traits)) {
              CALPINAGE_STATE.traits = data.roofState.traits.filter(function (t) { return !t || t.roofRole !== "chienAssis"; }).map(function (t, idx) {
                var id = (t && t.id) ? t.id : (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : "t-" + idx;
                var a = t.a && typeof t.a.x === "number" ? { x: t.a.x, y: typeof t.a.y === "number" ? t.a.y : 0, attach: (t.a.attach && typeof t.a.attach === "object") ? t.a.attach : null, h: typeof t.a.h === "number" ? t.a.h : undefined } : { x: 0, y: 0 };
                var b = t.b && typeof t.b.x === "number" ? { x: t.b.x, y: typeof t.b.y === "number" ? t.b.y : 0, attach: (t.b.attach && typeof t.b.attach === "object") ? t.b.attach : null, h: typeof t.b.h === "number" ? t.b.h : undefined } : { x: 0, y: 0 };
                return { id: id, a: a, b: b, roofRole: "main" };
              });
            }
            if (data.roofState.ridges && Array.isArray(data.roofState.ridges)) {
              CALPINAGE_STATE.ridges = data.roofState.ridges.filter(function (r) { return !r || (r.roofRole || "") !== "chienAssis"; }).map(function (r, idx) {
                var a = r.a || { x: 0, y: 0 };
                var b = r.b || { x: 0, y: 0 };
                var id = (r && r.id) ? r.id : (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : "r-" + idx;
                return {
                  id: id,
                  a: { x: a.x, y: a.y, attach: a.attach || null, h: typeof a.h === "number" ? a.h : undefined },
                  b: { x: b.x, y: b.y, attach: b.attach || null, h: typeof b.h === "number" ? b.h : undefined },
                  roofRole: "main"
                };
              });
            }
            if (data.roofState.planes && Array.isArray(data.roofState.planes)) {
              CALPINAGE_STATE.planes = data.roofState.planes;
            }
            if (data.roofState.obstacles && Array.isArray(data.roofState.obstacles)) {
              CALPINAGE_STATE.obstacles = data.roofState.obstacles.map(function (o) {
                if (o.type === "polygon" && o.points && Array.isArray(o.points) && o.points.length >= 3) {
                  return {
                    id: o.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "obs-" + Date.now()),
                    type: "polygon",
                    points: o.points.map(function (p) { return { x: p.x, y: p.y }; }),
                    shapeMeta: o.shapeMeta && typeof o.shapeMeta === "object" ? o.shapeMeta : undefined,
                    roofRole: o.roofRole !== "chienAssis" ? (o.roofRole || null) : null,
                    kind: o.kind || "other",
                    meta: o.meta && typeof o.meta === "object" ? o.meta : {},
                  };
                }
                if (o.points && Array.isArray(o.points) && o.points.length >= 3) {
                  return {
                    id: o.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "obs-" + Date.now()),
                    type: "polygon",
                    points: o.points.map(function (p) { return { x: p.x, y: p.y }; }),
                    roofRole: o.roofRole !== "chienAssis" ? (o.roofRole || null) : null,
                    kind: o.kind || "other",
                    meta: o.meta && typeof o.meta === "object" ? o.meta : {},
                  };
                }
                var type = o.type || "rect";
                var x = typeof o.x === "number" ? o.x : 0;
                var y = typeof o.y === "number" ? o.y : 0;
                var w = o.w;
                var h = o.h;
                var angle = typeof o.angle === "number" ? o.angle : 0;
                if (type === "circle" && typeof o.r === "number") {
                  var ptsCircle = obstacleCircleToPoints(x, y, o.r);
                  return { id: o.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "obs-" + Date.now()), type: "polygon", points: ptsCircle, shapeMeta: { originalType: "circle", centerX: x, centerY: y, radius: o.r } };
                }
                if (type === "rect" && typeof w === "number" && typeof h === "number") {
                  var cx = o.obstacleCenter ? x : x + w / 2;
                  var cy = o.obstacleCenter ? y : y + h / 2;
                  var ptsRect = obstacleRectToPoints(cx, cy, w, h, angle);
                  return { id: o.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "obs-" + Date.now()), type: "polygon", points: ptsRect, shapeMeta: { originalType: "rect", centerX: cx, centerY: cy, width: w, height: h, angle: angle } };
                }
                return null;
              }).filter(Boolean);
            }
            computePansFromGeometry();
            ensurePanPointsWithHeights();
            /* Restaurer hauteurs et physical depuis les pans sauvegard?s (par id). */
            if (savedPans.length > 0) {
              var savedById = {};
              savedPans.forEach(function (p) { if (p && p.id) savedById[p.id] = p; });
              CALPINAGE_STATE.pans.forEach(function (pan) {
                var saved = savedById[pan.id];
                if (!saved) return;
                if (saved.points && Array.isArray(saved.points) && saved.points.length >= 2) {
                  pan.points = saved.points.map(function (pt) { return { x: pt.x, y: pt.y, h: typeof pt.h === "number" ? pt.h : 0, id: pt.id }; });
                }
                if (saved.physical) {
                  pan.physical = pan.physical || {};
                  pan.physical.slope = pan.physical.slope || { mode: "auto", computedDeg: null, valueDeg: null };
                  pan.physical.orientation = pan.physical.orientation || { azimuthDeg: null, label: null };
                  if (saved.physical.slope) {
                    if (saved.physical.slope.mode === "manual" || saved.physical.slope.mode === "auto") pan.physical.slope.mode = saved.physical.slope.mode;
                    if (typeof saved.physical.slope.valueDeg === "number") pan.physical.slope.valueDeg = saved.physical.slope.valueDeg;
                  }
                  if (saved.physical.orientation) {
                    if (typeof saved.physical.orientation.azimuthDeg === "number") pan.physical.orientation.azimuthDeg = saved.physical.orientation.azimuthDeg;
                    if (typeof saved.physical.orientation.label === "string") pan.physical.orientation.label = saved.physical.orientation.label;
                  }
                }
              });
            }
            ensurePansHavePoints();
            CalpinagePans.ensurePanPhysicalProps(CALPINAGE_STATE.pans);
            if (CalpinagePans.recomputeAllPanPhysicalProps && CALPINAGE_STATE.pans.length) {
              CalpinagePans.recomputeAllPanPhysicalProps(CALPINAGE_STATE.pans, getStateForPans());
            }
            if (CalpinagePans.panState) {
              CalpinagePans.panState.pans.length = 0;
              CALPINAGE_STATE.pans.forEach(function (p) { CalpinagePans.panState.pans.push(p); });
            }
            if (data.selectedPanId != null && CALPINAGE_STATE.pans.some(function (p) { return p.id === data.selectedPanId; })) {
              CALPINAGE_STATE.selectedPanId = data.selectedPanId;
            } else {
              CALPINAGE_STATE.selectedPanId = null;
            }
            setTimeout(function () { }, 0);
          }
          if (data.phase === 2 || data.phase === 3) {
            CALPINAGE_STATE.phase = data.phase;
            CALPINAGE_STATE.currentPhase = data.phase === 3 ? "PV_LAYOUT" : "ROOF_EDIT";
          }
          if (data.roofSurveyLocked === true) CALPINAGE_STATE.roofSurveyLocked = true;
          if (data.validatedRoofData && typeof data.validatedRoofData === "object") CALPINAGE_STATE.validatedRoofData = data.validatedRoofData;
          if (data.pvParams && typeof data.pvParams === "object") {
            if (typeof data.pvParams.distanceLimitesCm === "number") CALPINAGE_STATE.pvParams.distanceLimitesCm = data.pvParams.distanceLimitesCm;
            if (typeof data.pvParams.espacementHorizontalCm === "number") CALPINAGE_STATE.pvParams.espacementHorizontalCm = data.pvParams.espacementHorizontalCm;
            if (typeof data.pvParams.espacementVerticalCm === "number") CALPINAGE_STATE.pvParams.espacementVerticalCm = data.pvParams.espacementVerticalCm;
            if (data.pvParams.orientationPanneaux === "portrait" || data.pvParams.orientationPanneaux === "paysage" || data.pvParams.orientationPanneaux === "landscape") CALPINAGE_STATE.pvParams.orientationPanneaux = data.pvParams.orientationPanneaux === "paysage" ? "landscape" : data.pvParams.orientationPanneaux;
          }
          /* PV_RULES_INITIALIZED = true UNE SEULE FOIS ici (apr?s mapping pvParams ??? PV_LAYOUT_RULES). Aucun autre endroit. */
          if (!window.PV_RULES_INITIALIZED && data.pvParams && window.PV_LAYOUT_RULES) {
            mapPvParamsToRules(data.pvParams, window.PV_LAYOUT_RULES);
            window.PV_RULES_INITIALIZED = true;
          }
          if (Array.isArray(data.placedPanels)) CALPINAGE_STATE.placedPanels = data.placedPanels;
          if (Array.isArray(data.shadowVolumes)) CALPINAGE_STATE.shadowVolumes = data.shadowVolumes;
          if (Array.isArray(data.roofExtensions)) {
            CALPINAGE_STATE.roofExtensions = data.roofExtensions;
            CALPINAGE_STATE.roofExtensions.forEach(function (rx) {
              if (!rx) return;
              if (rx.stage) return;
              var hasRidge = rx.ridge && rx.ridge.a && rx.ridge.b;
              var hasHips = rx.hips && rx.hips.left && rx.hips.right && rx.hips.left.b && rx.hips.right.b;
              if (hasRidge && hasHips) rx.stage = "COMPLETE";
              else if (hasHips) rx.stage = "HIPS";
              else if (rx.contour && rx.contour.closed && rx.contour.points && rx.contour.points.length >= 3) rx.stage = "CONTOUR";
              else rx.stage = "CONTOUR";
            });
          }
          var restoreBlocks = (window.pvPlacementEngine && window.pvPlacementEngine.restoreFrozenBlocks) || (window.ActivePlacementBlock && window.ActivePlacementBlock.restoreFrozenBlocks);
          if (typeof restoreBlocks === "function" && Array.isArray(data.frozenBlocks)) {
            restoreBlocks(data.frozenBlocks);
          }
          if (data.panel && data.panel.id && typeof findPanelById === "function") {
            var restored = findPanelById(data.panel.id);
            if (restored) {
              window.PV_SELECTED_PANEL = buildPVSelectedPanel(restored);
              window.CALPINAGE_SELECTED_PANEL_ID = data.panel.id;
            }
          }
          /* CP-006 — Restauration onduleur si présent dans calpinage chargé */
          if (data.inverter && data.inverter.id && typeof findInverterById === "function") {
            var invRestored = findInverterById(data.inverter.id);
            if (invRestored) {
              window.PV_SELECTED_INVERTER = invRestored;
              window.CALPINAGE_SELECTED_INVERTER_ID = data.inverter.id;
            }
          }
        } catch (e) {}
      }

      /** Assure que chaque pan a .points (? partir de .polygon si besoin) pour calculs physiques. */
      function ensurePansHavePoints() {
        var pans = CALPINAGE_STATE.pans || [];
        for (var i = 0; i < pans.length; i++) {
          var pan = pans[i];
          if (!pan) continue;
          if (!pan.points && pan.polygon && Array.isArray(pan.polygon)) {
            pan.points = pan.polygon.map(function (pt, idx) {
              return { x: pt.x, y: pt.y, h: 0, id: pan.id + "-" + idx };
            });
          }
        }
      }

      function updatePansListUI() {
        var listEl = container.querySelector("#zone-a-pans-list");
        var blockEl = container.querySelector("#zone-a-pans-block");
        if (!listEl || !blockEl) return;
        var pans = CALPINAGE_STATE.pans || [];
        if (typeof CalpinagePans !== "undefined" && CalpinagePans.panState && CalpinagePans.panState.activePanId != null) {
          CALPINAGE_STATE.selectedPanId = CalpinagePans.panState.activePanId;
        }
        var selectedId = CALPINAGE_STATE.selectedPanId;
        ensurePanPointsWithHeights();
        ensurePansHavePoints();
        if (typeof CalpinagePans !== "undefined") {
          if (CalpinagePans.ensurePanPhysicalProps) CalpinagePans.ensurePanPhysicalProps(pans);
          if (CalpinagePans.recomputeAllPanPhysicalProps && pans.length) {
            CalpinagePans.recomputeAllPanPhysicalProps(pans, getStateForPans());
          }
        }
        /* Log temporaire pour tests : d?commenter pour voir deg, runM, deltaH, az sur le 1er pan
        if (pans.length && pans[0].physical) {
          var s = pans[0].physical.slope, o = pans[0].physical.orientation;
          console.log("[PANS] pan0", { deg: s && s.computedDeg, runM: s && s.runM, deltaH: s && s.deltaH, az: o && o.azimuthDeg, label: o && o.label });
        }
        */
        listEl.innerHTML = "";
        listEl.classList.remove("pans-list");
        listEl.classList.add("pans-accordion");
        pans.forEach(function (pan) {
          var isOpen = pan.id === selectedId;
          var slope = (pan.physical && pan.physical.slope) ? pan.physical.slope : { mode: "auto", valueDeg: null, computedDeg: null };
          var orient = (pan.physical && pan.physical.orientation) ? pan.physical.orientation : { azimuthDeg: null, label: null };
          var mode = slope.mode || "auto";
          var valueDeg = (slope.valueDeg != null ? slope.valueDeg : (pan.tiltDeg != null ? pan.tiltDeg : (slope.computedDeg != null ? slope.computedDeg : 0)));
          valueDeg = Math.round(Number(valueDeg));
          var computedDeg = slope.computedDeg != null ? Math.round(slope.computedDeg) : null;
          var azimuth = orient.azimuthDeg != null ? Math.round(orient.azimuthDeg) : null;
          var cardinal = orient.label || "\u2014";
          var sensPente = (pan.physical && pan.physical.slopeDirectionLabel) ? pan.physical.slopeDirectionLabel : (orient.label || "\u2014");

          var li = document.createElement("li");
          li.className = "pans-accordion-item" + (isOpen ? " open" : "");
          li.setAttribute("data-pan-id", pan.id);

          var header = document.createElement("button");
          header.type = "button";
          header.className = "pans-accordion-header";
          header.setAttribute("aria-expanded", isOpen ? "true" : "false");
          var labelSpan = document.createElement("span");
          labelSpan.className = "pans-accordion-header-label";
          labelSpan.textContent = pan.name || "Pan " + pan.id;
          var badge = document.createElement("span");
          badge.className = "pans-accordion-header-badge mode-" + mode;
          badge.textContent = mode === "manual" ? "Manuel" : "Auto";
          var chevron = document.createElement("span");
          chevron.className = "pans-accordion-header-chevron";
          chevron.setAttribute("aria-hidden", "true");
          chevron.textContent = "\u25BC"; // ▼
          header.appendChild(labelSpan);
          header.appendChild(badge);
          header.appendChild(chevron);
          addSafeListener(header, "click", function () {
            CALPINAGE_STATE.selectedPanId = pan.id;
            if (typeof CalpinagePans !== "undefined" && CalpinagePans.panState) CalpinagePans.panState.activePanId = pan.id;
            updatePansListUI();
            if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
          });
          li.appendChild(header);

          var body = document.createElement("div");
          body.className = "pans-accordion-body";

          var inclinaisonRow = document.createElement("div");
          inclinaisonRow.className = "pan-panel-row pan-panel-inclinaison-row";
          var inclLabel = document.createElement("label");
          inclLabel.className = "pan-panel-label";
          inclLabel.textContent = "Inclinaison (\u00B0)";
          var inclInput = document.createElement("input");
          inclInput.type = "number";
          inclInput.min = "0";
          inclInput.max = "90";
          inclInput.step = "1";
          inclInput.value = String(valueDeg);
          inclInput.setAttribute("data-pan-id", pan.id);
          inclinaisonRow.appendChild(inclLabel);
          inclinaisonRow.appendChild(inclInput);
          body.appendChild(inclinaisonRow);

          var toggleRow = document.createElement("div");
          toggleRow.className = "pan-panel-row pan-panel-slope-toggle";
          var toggleLabel = document.createElement("label");
          var toggleCheck = document.createElement("input");
          toggleCheck.type = "checkbox";
          toggleCheck.checked = mode === "manual";
          toggleCheck.setAttribute("data-pan-id", pan.id);
          toggleLabel.appendChild(toggleCheck);
          toggleLabel.appendChild(document.createTextNode(" Pente manuelle (sinon calcul\u00E9e)"));
          toggleRow.appendChild(toggleLabel);
          body.appendChild(toggleRow);

          var computedRow = document.createElement("div");
          computedRow.className = "pan-panel-row pan-panel-slope-computed";
          if (computedDeg != null) {
            computedRow.textContent = "Pente calcul\u00E9e : " + computedDeg + "\u00B0";
          } else {
            computedRow.textContent = "";
          }
          body.appendChild(computedRow);

          var orientRow = document.createElement("div");
          orientRow.className = "pan-panel-row";
          var orientLabel = document.createElement("span");
          orientLabel.className = "pan-panel-label";
          orientLabel.textContent = "Orientation";
          var orientValue = document.createElement("p");
          orientValue.className = "pan-panel-value";
          orientValue.textContent = azimuth != null ? azimuth + "\u00B0 vers " + cardinal : "\u2014";
          orientRow.appendChild(orientLabel);
          orientRow.appendChild(orientValue);
          body.appendChild(orientRow);

          var sensRow = document.createElement("div");
          sensRow.className = "pan-panel-row";
          var sensLabel = document.createElement("span");
          sensLabel.className = "pan-panel-label";
          sensLabel.textContent = "Sens de la pente";
          var sensValue = document.createElement("p");
          sensValue.className = "pan-panel-value";
          sensValue.textContent = sensPente;
          sensRow.appendChild(sensLabel);
          sensRow.appendChild(sensValue);
          body.appendChild(sensRow);

          addSafeListener(inclInput, "change", function () {
            var v = parseInt(inclInput.value, 10);
            if (!Number.isFinite(v) || v < 0) v = 0;
            if (v > 90) v = 90;
            inclInput.value = String(v);
            if (typeof CalpinagePans !== "undefined" && CalpinagePans.applyManualSlopeToPan) {
              CalpinagePans.applyManualSlopeToPan(pan, v, getStateForPans());
            } else {
              if (pan.physical && pan.physical.slope) {
                pan.physical.slope.mode = "manual";
                pan.physical.slope.valueDeg = v;
              }
              pan.tiltDeg = v;
            }
            toggleCheck.checked = true;
            updatePansListUI();
            if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
          });

          addSafeListener(toggleCheck, "change", function () {
            if (toggleCheck.checked) {
              var v = parseInt(inclInput.value, 10);
              if (!Number.isFinite(v)) v = 0;
              if (typeof CalpinagePans !== "undefined" && CalpinagePans.applyManualSlopeToPan) {
                CalpinagePans.applyManualSlopeToPan(pan, v, getStateForPans());
              } else {
                if (pan.physical && pan.physical.slope) {
                  pan.physical.slope.mode = "manual";
                  pan.physical.slope.valueDeg = v;
                }
              }
            } else {
              if (pan.physical && pan.physical.slope) {
                pan.physical.slope.mode = "auto";
                if (typeof CalpinagePans !== "undefined" && CalpinagePans.recomputePanPhysicalProps) {
                  CalpinagePans.recomputePanPhysicalProps(pan, getStateForPans());
                }
              }
              updatePansListUI();
            }
            if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
          });

          li.appendChild(body);
          listEl.appendChild(li);
        });
        if (!CALPINAGE_STATE.roofSurveyLocked && typeof updateValidateButton === "function") updateValidateButton();
      }

      function pointInPolygonImage(pt, poly) {
        var n = poly.length;
        var inside = false;
        for (var i = 0, j = n - 1; i < n; j = i++) {
          var xi = poly[i].x, yi = poly[i].y;
          var xj = poly[j].x, yj = poly[j].y;
          if (yi === yj) continue;
          if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
      }

      /** Génère les points d'un polygone cercle (24 segments minimum). */
      function obstacleCircleToPoints(cx, cy, radius) {
        var pts = [];
        var n = 24;
        for (var i = 0; i < n; i++) {
          var a = (i / n) * Math.PI * 2;
          pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
        }
        return pts;
      }

      /** Génère les points d'un rectangle (4 coins), optionnellement tourné. */
      function obstacleRectToPoints(cx, cy, width, height, angleRad) {
        var hw = width / 2, hh = height / 2;
        var corners = [
          { x: -hw, y: -hh },
          { x: hw, y: -hh },
          { x: hw, y: hh },
          { x: -hw, y: hh },
        ];
        var a = typeof angleRad === "number" ? angleRad : 0;
        var c = Math.cos(a), s = Math.sin(a);
        return corners.map(function (p) {
          return { x: cx + p.x * c - p.y * s, y: cy + p.x * s + p.y * c };
        });
      }

      /** Recalcule points à partir de shapeMeta (circle ou rect). */
      function obstacleRecalcFromShapeMeta(obstacle) {
        var m = obstacle.shapeMeta;
        if (!m) return;
        if (m.originalType === "circle" && typeof m.radius === "number") {
          obstacle.points = obstacleCircleToPoints(m.centerX, m.centerY, m.radius);
        } else if (m.originalType === "rect" && typeof m.width === "number" && typeof m.height === "number") {
          obstacle.points = obstacleRectToPoints(m.centerX, m.centerY, m.width, m.height, m.angle);
        }
      }

      /**
       * A-2.5 ??? Teste si un point (image space) est ? l?int?rieur d?un obstacle.
       * ?? appeler avant de placer un panneau / cellule de calepinage.
       * Point d?int?gration : l? o?? le calepinage pose les panneaux (centre ou cellule), appeler isPointInAnyObstacle(centerImg) et ne pas placer si true.
       */
      function isPointInAnyObstacle(pt) {
        var obstacles = CALPINAGE_STATE.obstacles || [];
        for (var i = 0; i < obstacles.length; i++) {
          var o = obstacles[i];
          if (!o || !o.points || !Array.isArray(o.points) || o.points.length < 3) continue;
          if (pointInPolygonImage(pt, o.points)) return true;
        }
        return false;
      }
      window.isPointInAnyObstacle = isPointInAnyObstacle;

      /** Overlay double-clic obstacle : dimensions en mètres. */
      (function initObstacleDimOverlay() {
        var overlay = container.querySelector("#calpinage-obstacle-dim-overlay");
        var circleDiv = container.querySelector("#obstacle-dim-circle");
        var rectDiv = container.querySelector("#obstacle-dim-rect");
        var diamInput = container.querySelector("#obstacle-dim-diameter");
        var widthInput = container.querySelector("#obstacle-dim-width");
        var heightInput = container.querySelector("#obstacle-dim-height");
        var applyBtn = container.querySelector("#obstacle-dim-apply");
        var cancelBtn = container.querySelector("#obstacle-dim-cancel");
        var currentIndex = null;
        var currentMpp = null;
        var onApply = null;
        function closeOverlay() {
          if (overlay) overlay.style.display = "none";
          currentIndex = null;
        }
        function apply() {
          if (currentIndex == null || !currentMpp || currentMpp <= 0) return;
          var ob = (CALPINAGE_STATE.obstacles || [])[currentIndex];
          if (!ob || !ob.shapeMeta) return;
          var m = ob.shapeMeta;
          if (m.originalType === "circle") {
            var diamM = parseFloat(diamInput && diamInput.value);
            if (Number.isFinite(diamM) && diamM > 0) {
              m.radius = (diamM / 2) / currentMpp;
              obstacleRecalcFromShapeMeta(ob);
            }
          } else if (m.originalType === "rect") {
            var wM = parseFloat(widthInput && widthInput.value);
            var hM = parseFloat(heightInput && heightInput.value);
            if (Number.isFinite(wM) && wM > 0 && Number.isFinite(hM) && hM > 0) {
              m.width = wM / currentMpp;
              m.height = hM / currentMpp;
              obstacleRecalcFromShapeMeta(ob);
            }
          }
          closeOverlay();
          if (typeof onApply === "function") onApply();
        }
        window.showObstacleDimOverlay = function (index, obstacle, mpp, callback) {
          currentIndex = index;
          currentMpp = mpp;
          onApply = callback;
          if (!overlay || !obstacle || !obstacle.shapeMeta) return;
          circleDiv.style.display = "none";
          rectDiv.style.display = "none";
          var m = obstacle.shapeMeta;
          if (m.originalType === "circle") {
            circleDiv.style.display = "block";
            if (diamInput) diamInput.value = (m.radius * 2 * mpp).toFixed(2);
          } else if (m.originalType === "rect") {
            rectDiv.style.display = "block";
            if (widthInput) widthInput.value = (m.width * mpp).toFixed(2);
            if (heightInput) heightInput.value = (m.height * mpp).toFixed(2);
          }
          overlay.style.display = "block";
        };
        if (applyBtn) addSafeListener(applyBtn, "click", apply);
        if (cancelBtn) addSafeListener(cancelBtn, "click", closeOverlay);
      })();

      /** Overlay double-clic volume ombrant */
      (function initShadowVolumeOverlay() {
        var overlay = container.querySelector("#calpinage-shadow-volume-overlay");
        var widthInput = container.querySelector("#shadow-volume-width");
        var depthInput = container.querySelector("#shadow-volume-depth");
        var heightInput = container.querySelector("#shadow-volume-height");
        var rotationInput = container.querySelector("#shadow-volume-rotation");
        var applyBtn = container.querySelector("#shadow-volume-apply");
        var cancelBtn = container.querySelector("#shadow-volume-cancel");
        var currentIndex = null;
        function closeOverlay() {
          if (overlay) overlay.style.display = "none";
          currentIndex = null;
        }
        function apply() {
          if (currentIndex == null) return;
          var vol = (CALPINAGE_STATE.shadowVolumes || [])[currentIndex];
          if (!vol || vol.type !== "shadow_volume") return;
          var w = parseFloat(widthInput && widthInput.value);
          var d = parseFloat(depthInput && depthInput.value);
          var h = parseFloat(heightInput && heightInput.value);
          var r = parseFloat(rotationInput && rotationInput.value);
          if (Number.isFinite(w) && w > 0) vol.width = w;
          if (Number.isFinite(d) && d > 0) vol.depth = d;
          if (Number.isFinite(h) && h > 0) vol.height = h;
          if (Number.isFinite(r)) vol.rotation = r;
          closeOverlay();
          if (typeof saveCalpinageState === "function") saveCalpinageState();
          if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
        }
        window.showShadowVolumeOverlay = function (index, volume) {
          currentIndex = index;
          if (!overlay || !volume) return;
          if (widthInput) widthInput.value = (volume.width || 0.6).toFixed(2);
          if (depthInput) depthInput.value = (volume.depth || 0.6).toFixed(2);
          if (heightInput) heightInput.value = (volume.height || 1).toFixed(2);
          if (rotationInput) rotationInput.value = (typeof volume.rotation === "number" ? volume.rotation : 0).toFixed(0);
          overlay.style.display = "block";
        };
        if (applyBtn) addSafeListener(applyBtn, "click", apply);
        if (cancelBtn) addSafeListener(cancelBtn, "click", closeOverlay);
      })();

      function hitTestPan(imgPt) {
        var pans = CALPINAGE_STATE.pans || [];
        for (var i = pans.length - 1; i >= 0; i--) {
          var poly = pans[i].points && pans[i].points.length >= 3 ? pans[i].points : pans[i].polygon;
          if (poly && pointInPolygonImage(imgPt, poly)) return pans[i];
        }
        return null;
      }

      function hitTestShadowVolume(imgPt) {
        var list = CALPINAGE_STATE.shadowVolumes || [];
        var mpp = (CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.scale && CALPINAGE_STATE.roof.scale.metersPerPixel) || 1;
        for (var i = list.length - 1; i >= 0; i--) {
          var sv = list[i];
          if (!sv || sv.type !== "shadow_volume") continue;
          var wPx = (sv.width || 0.6) / mpp, dPx = (sv.depth || 0.6) / mpp;
          var rotDeg = typeof sv.rotation === "number" ? sv.rotation : 0;
          var rotRad = (rotDeg * Math.PI) / 180;
          var cos = Math.cos(rotRad), sin = Math.sin(rotRad);
          var cx = sv.x, cy = sv.y;
          function rotPt(lx, ly) { return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos }; }
          if (sv.shape === "tube") {
            var r = wPx / 2;
            var d = Math.hypot(imgPt.x - cx, imgPt.y - cy);
            if (d <= r) return { index: i, volume: sv };
          } else {
            var hw = wPx / 2, hd = dPx / 2;
            var pts = [rotPt(-hw, -hd), rotPt(hw, -hd), rotPt(hw, hd), rotPt(-hw, hd)];
            if (pointInPolygonImage(imgPt, pts)) return { index: i, volume: sv };
          }
        }
        return null;
      }

      function hitTestShadowVolumeHandles(screenPt, volume, imageToScreen, vpScale) {
        var mpp = (CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.scale && CALPINAGE_STATE.roof.scale.metersPerPixel) || 1;
        if (window.CalpinageCanvas && window.CalpinageCanvas.hitTestShadowVolumeHandles) {
          return window.CalpinageCanvas.hitTestShadowVolumeHandles(screenPt, volume, imageToScreen, vpScale, mpp);
        }
        if (!volume || volume.type !== "shadow_volume") return null;
        var wPx = (volume.width || 0.6) / mpp, dPx = (volume.depth || 0.6) / mpp;
        var rotDeg = typeof volume.rotation === "number" ? volume.rotation : 0;
        var rotRad = (rotDeg * Math.PI) / 180;
        var cos = Math.cos(rotRad), sin = Math.sin(rotRad);
        var cx = volume.x, cy = volume.y;
        var r = volume.shape === "tube" ? wPx / 2 : 0;
        var hw = volume.shape === "cube" ? wPx / 2 : r;
        var hd = volume.shape === "cube" ? dPx / 2 : r;
        var cornerLx = volume.shape === "tube" ? r * 0.707 : hw;
        var cornerLy = volume.shape === "tube" ? r * 0.707 : hd;
        var tol = 12;
        function rotPt(lx, ly) { return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos }; }
        var rightImg = rotPt(hw, 0), bottomImg = rotPt(0, hd), cornerImg = rotPt(cornerLx, cornerLy);
        var heightImg = { x: cx, y: cy - Math.max(wPx, dPx, r * 2) / 2 - 15 };
        var rotateImg = { x: cx, y: cy - Math.max(wPx, dPx, r * 2) / 2 - 35 };
        var rightSc = imageToScreen(rightImg), bottomSc = imageToScreen(bottomImg), cornerSc = imageToScreen(cornerImg);
        var heightSc = imageToScreen(heightImg), rotateSc = imageToScreen(rotateImg);
        if (Math.hypot(screenPt.x - rightSc.x, screenPt.y - rightSc.y) <= tol) return { handle: "right" };
        if (Math.hypot(screenPt.x - bottomSc.x, screenPt.y - bottomSc.y) <= tol) return { handle: "bottom" };
        if (Math.hypot(screenPt.x - cornerSc.x, screenPt.y - cornerSc.y) <= tol) return { handle: "corner" };
        if (Math.hypot(screenPt.x - heightSc.x, screenPt.y - heightSc.y) <= tol) return { handle: "height" };
        if (Math.hypot(screenPt.x - rotateSc.x, screenPt.y - rotateSc.y) <= tol) return { handle: "rotate" };
        return null;
      }

      function recomputeRoofPlanes() {
        var contours = (CALPINAGE_STATE.contours || []).filter(function (c) { return c.roofRole !== "chienAssis"; });
        var ridges = (CALPINAGE_STATE.ridges || []).filter(function (r) { return r.roofRole !== "chienAssis"; });
        CALPINAGE_STATE.planes = [];
        if (!contours.length) return;
        function projectPointOnSegment(pt, a, b) {
          var ax = a.x; var ay = a.y;
          var bx = b.x; var by = b.y;
          var px = pt.x; var py = pt.y;
          var abx = bx - ax; var aby = by - ay;
          var apx = px - ax; var apy = py - ay;
          var t = (apx * abx + apy * aby) / (abx * abx + aby * aby + 1e-10);
          t = Math.max(0, Math.min(1, t));
          return { x: ax + t * abx, y: ay + t * aby };
        }
        function distImg(a, b) {
          return Math.hypot(b.x - a.x, b.y - a.y);
        }
        function pointOnSegment(pt, segA, segB, tol) {
          var proj = projectPointOnSegment(pt, segA, segB);
          return distImg(pt, proj) <= tol;
        }
        var ra, rb;
        if (ridges.length === 0) {
          contours.forEach(function (c) {
            if (c && c.points && c.points.length >= 3) {
              CALPINAGE_STATE.planes.push({ points: c.points.slice() });
            }
          });
          return;
        }
        contours.forEach(function (contour) {
          if (!contour || !contour.points || contour.points.length < 3) return;
          var pts = contour.points;
          var scale = CALPINAGE_STATE.roof.scale && CALPINAGE_STATE.roof.scale.metersPerPixel;
          var tol = (typeof scale === "number" && scale > 0) ? 0.5 / scale : 2;
          var ridgesOnContour = [];
          for (var ri = 0; ri < ridges.length; ri++) {
            var r = ridges[ri];
            ra = resolveRidgePoint(r.a);
            rb = resolveRidgePoint(r.b);
            var aOn = false; var bOn = false;
            for (var i = 0; i < pts.length; i++) {
              var segB = pts[(i + 1) % pts.length];
              if (pointOnSegment(ra, pts[i], segB, tol)) aOn = true;
              if (pointOnSegment(rb, pts[i], segB, tol)) bOn = true;
            }
            if (aOn && bOn) ridgesOnContour.push(r);
          }
          if (ridgesOnContour.length === 0) {
            CALPINAGE_STATE.planes.push({ points: pts.slice() });
            return;
          }
          var r0 = ridgesOnContour[0];
          ra = resolveRidgePoint(r0.a);
          rb = resolveRidgePoint(r0.b);
          var idxA = -1; var idxB = -1; var tA = 0; var tB = 0;
          for (var i = 0; i < pts.length; i++) {
            var segB = pts[(i + 1) % pts.length];
            var projA = projectPointOnSegment(ra, pts[i], segB);
            if (distImg(ra, projA) <= tol) { idxA = i; tA = distImg(pts[i], ra) / (distImg(pts[i], segB) + 1e-10); break; }
          }
          for (var i = 0; i < pts.length; i++) {
            var segB = pts[(i + 1) % pts.length];
            var projB = projectPointOnSegment(rb, pts[i], segB);
            if (distImg(rb, projB) <= tol) { idxB = i; tB = distImg(pts[i], rb) / (distImg(pts[i], segB) + 1e-10); break; }
          }
          if (idxA < 0 || idxB < 0) {
            CALPINAGE_STATE.planes.push({ points: pts.slice() });
            return;
          }
          var full = [];
          var ia = -1; var ib = -1;
          for (var i = 0; i < pts.length; i++) {
            full.push(pts[i]);
            if (idxA === i) { ia = full.length; full.push({ x: ra.x, y: ra.y }); }
            if (idxB === i) { ib = full.length; full.push({ x: rb.x, y: rb.y }); }
          }
          if (ia < 0 || ib < 0) {
            CALPINAGE_STATE.planes.push({ points: pts.slice() });
            return;
          }
          var poly1 = []; var poly2 = [];
          var n = full.length;
          if (ia <= ib) {
            for (var k = ia; k <= ib; k++) poly1.push(full[k]);
            for (var k = ib; k < n; k++) poly2.push(full[k]);
            for (var k = 0; k <= ia; k++) poly2.push(full[k]);
          } else {
            for (var k = ia; k < n; k++) poly1.push(full[k]);
            for (var k = 0; k <= ib; k++) poly1.push(full[k]);
            for (var k = ib; k <= ia; k++) poly2.push(full[k]);
          }
          if (poly1.length >= 3) CALPINAGE_STATE.planes.push({ points: poly1 });
          if (poly2.length >= 3) CALPINAGE_STATE.planes.push({ points: poly2 });
        });
      }

      /**
       * Interpr?tation g?om?trique : contour + fa??tages + traits ??? graphe planaire ??? surfaces ferm?es ??? Pans.
       * Normalisation topologique (snap + fusion) puis split ? toutes intersections (dont T-junction), face-walk robuste.
       * Remplit state.pans (id, name, polygon). Ne modifie pas selectedPanId.
       * opts.excludeChienAssis = true pour exclure contours/traits/ridges chien-assis (historique).
       */
      function computePansFromGeometryCore(state, opts) {
        state = state || CALPINAGE_STATE;
        opts = opts || {};
        var excludeChienAssis = opts.excludeChienAssis === true;
        var resolveRp = opts.resolveRidgePoint || resolveRidgePoint;

        var edges = getEdgesFromState(state, { excludeChienAssis: excludeChienAssis });
        var contourEdges = edges.filter(function (e) { return e.kind === EDGE_CONTOUR; });
        var ridgeEdges = edges.filter(function (e) { return e.kind === EDGE_RIDGE; });
        var traitEdges = edges.filter(function (e) { return e.kind === EDGE_TRAIT; });

        var contourSegments = [];
        contourEdges.forEach(function (edge) {
          edgeSegments(edge, resolveRp).forEach(function (seg) {
            contourSegments.push([{ x: seg[0].x, y: seg[0].y }, { x: seg[1].x, y: seg[1].y }]);
          });
        });
        var ridgeSegments = [];
        ridgeEdges.forEach(function (edge) {
          edgeSegments(edge, resolveRp).forEach(function (seg) {
            ridgeSegments.push([{ x: seg[0].x, y: seg[0].y }, { x: seg[1].x, y: seg[1].y }]);
          });
        });
        var traitSegments = [];
        traitEdges.forEach(function (edge) {
          edgeSegments(edge, resolveRp).forEach(function (seg) {
            traitSegments.push([{ x: seg[0].x, y: seg[0].y }, { x: seg[1].x, y: seg[1].y }]);
          });
        });

        var SNAP_PX_SCREEN = 10;
        var vpScale = (typeof window !== "undefined" && typeof window.CALPINAGE_VIEWPORT_SCALE === "number") ? window.CALPINAGE_VIEWPORT_SCALE : 2;
        var snapImg = Math.max(0.5, SNAP_PX_SCREEN / vpScale);
        var MERGE_EPS_IMG = snapImg * 0.75;
        var TOL = 1e-9;
        var AREA_EPS = 4;

        function distImg(a, b) {
          return Math.hypot(b.x - a.x, b.y - a.y);
        }
        function projectPointOnSegment(pt, a, b) {
          var ax = a.x, ay = a.y, bx = b.x, by = b.y, px = pt.x, py = pt.y;
          var abx = bx - ax, aby = by - ay;
          var t = (abx * (px - ax) + aby * (py - ay)) / (abx * abx + aby * aby + 1e-20);
          t = Math.max(0, Math.min(1, t));
          return { x: ax + t * abx, y: ay + t * aby };
        }
        function pointOnSegment(pt, a, b, eps) {
          var proj = projectPointOnSegment(pt, a, b);
          return distImg(pt, proj) <= eps;
        }
        function segmentIntersection(a1, a2, b1, b2, extendT) {
          var ax = a2.x - a1.x, ay = a2.y - a1.y;
          var bx = b2.x - b1.x, by = b2.y - b1.y;
          var denom = ax * by - ay * bx;
          if (Math.abs(denom) < 1e-12) return null;
          var cx = b1.x - a1.x, cy = b1.y - a1.y;
          var t = (cx * by - cy * bx) / denom;
          var s = (cx * ay - cy * ax) / denom;
          var tol = extendT ? MERGE_EPS_IMG * 0.01 : TOL;
          if (t < -tol || t > 1 + tol || s < -tol || s > 1 + tol) return null;
          return { x: a1.x + t * ax, y: a1.y + t * ay, t: t, s: s };
        }
        function samePoint(p, q, eps) {
          return distImg(p, q) <= (eps != null ? eps : MERGE_EPS_IMG);
        }
        /* Snap d'un point vers sommets ou segments (image space). */
        function snapPointToGeometryImage(imgPt, allPoints, allSegs, thresholdImg) {
          var best = null, bestDist = thresholdImg;
          var i, p, d, proj;
          for (i = 0; i < allPoints.length; i++) {
            p = allPoints[i];
            d = distImg(imgPt, p);
            if (d < bestDist) { bestDist = d; best = { x: p.x, y: p.y }; }
          }
          if (best) return best;
          for (i = 0; i < allSegs.length; i++) {
            proj = projectPointOnSegment(imgPt, allSegs[i][0], allSegs[i][1]);
            d = distImg(imgPt, proj);
            if (d < bestDist) { bestDist = d; best = { x: proj.x, y: proj.y }; }
          }
          return best ? best : { x: imgPt.x, y: imgPt.y };
        }
        /* Tous les points de g?om?trie pour snap (via Edge API) */
        var allPointsForSnap = [];
        edges.forEach(function (edge) {
          edgeVertices(edge, resolveRp).forEach(function (pt) {
            if (pt && typeof pt.x === "number") allPointsForSnap.push({ x: pt.x, y: pt.y });
          });
        });
        var allSegsForSnap = contourSegments.slice();
        ridgeSegments.forEach(function (s) { allSegsForSnap.push(s); });
        traitSegments.forEach(function (s) { allSegsForSnap.push(s); });
        /* Snap des extr?mit?s traits et fa??tages */
        var snappedRidges = ridgeSegments.map(function (seg) {
          return [
            snapPointToGeometryImage(seg[0], allPointsForSnap, allSegsForSnap, snapImg),
            snapPointToGeometryImage(seg[1], allPointsForSnap, allSegsForSnap, snapImg)
          ];
        });
        var snappedTraits = traitSegments.map(function (seg) {
          return [
            snapPointToGeometryImage(seg[0], allPointsForSnap, allSegsForSnap, snapImg),
            snapPointToGeometryImage(seg[1], allPointsForSnap, allSegsForSnap, snapImg)
          ];
        });
        var allSegments = [];
        contourSegments.forEach(function (seg) {
          allSegments.push([{ x: seg[0].x, y: seg[0].y }, { x: seg[1].x, y: seg[1].y }]);
        });
        snappedRidges.forEach(function (seg) {
          allSegments.push([{ x: seg[0].x, y: seg[0].y }, { x: seg[1].x, y: seg[1].y }]);
        });
        snappedTraits.forEach(function (seg) {
          allSegments.push([{ x: seg[0].x, y: seg[0].y }, { x: seg[1].x, y: seg[1].y }]);
        });
        /* Nombre de segments de contour (premiers dans allSegments) pour projection des intersections sur le contour. */
        var numContourSegments = contourSegments.length;

        console.debug("[computePansFromGeometry] edges: contour=" + contourEdges.length + " trait=" + traitEdges.length + " ridge=" + ridgeEdges.length + " | allSegments=" + allSegments.length + " numContourSegments=" + numContourSegments);

        /* Split chaque segment ? toutes les intersections (croisement + T-junction).
         * Tout point d?intersection impliquant un segment de contour est projet? sur ce contour
         * pour ?viter des sommets l?g?rement hors contour (tol?rances) qui cassent la g?om?trie. */
        function splitSegmentAtIntersections(a, b, allSegs, segmentIndex, numContourSegs) {
          var points = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
          var eps = MERGE_EPS_IMG;
          var isCurrentContour = segmentIndex != null && numContourSegs != null && segmentIndex < numContourSegs;
          for (var i = 0; i < allSegs.length; i++) {
            var s = allSegs[i];
            var a1 = s[0], a2 = s[1];
            if (samePoint(a, a1, eps) && samePoint(b, a2, eps)) continue;
            if (samePoint(a, a2, eps) && samePoint(b, a1, eps)) continue;
            var inter = segmentIntersection(a, b, a1, a2, true);
            if (inter) {
              if (distImg(inter, a) > eps && distImg(inter, b) > eps) {
                /* Projeter sur le contour si l?un des deux segments est un segment de contour (m??me tol?rance que pointNearContour / MERGE_EPS_IMG). */
                if (numContourSegs != null) {
                  var isOtherContour = i < numContourSegs;
                  if (isOtherContour) inter = projectPointOnSegment(inter, a1, a2);
                  else if (isCurrentContour) inter = projectPointOnSegment(inter, a, b);
                }
                points.push(inter);
              }
            }
            if (pointOnSegment(a1, a, b, eps)) points.push({ x: a1.x, y: a1.y });
            if (pointOnSegment(a2, a, b, eps)) points.push({ x: a2.x, y: a2.y });
          }
          points.sort(function (p, q) { return distImg(a, p) - distImg(a, q); });
          var out = [];
          for (var k = 0; k < points.length - 1; k++) {
            var p1 = points[k], p2 = points[k + 1];
            if (distImg(p1, p2) < eps) continue;
            out.push([{ x: p1.x, y: p1.y }, { x: p2.x, y: p2.y }]);
          }
          return out;
        }
        var splitSegments = [];
        for (var si = 0; si < allSegments.length; si++) {
          var seg = allSegments[si];
          var parts = splitSegmentAtIntersections(seg[0], seg[1], allSegments, si, numContourSegments);
          for (var pi = 0; pi < parts.length; pi++) splitSegments.push(parts[pi]);
        }

        /* Fusion des sommets proches (dedup) */
        var vertexList = [];
        function getVertex(p) {
          for (var i = 0; i < vertexList.length; i++) {
            if (distImg(vertexList[i], p) < MERGE_EPS_IMG) return i;
          }
          var idx = vertexList.length;
          vertexList.push({ x: p.x, y: p.y });
          return idx;
        }
        var edges = [];
        splitSegments.forEach(function (seg) {
          var u = getVertex(seg[0]);
          var v = getVertex(seg[1]);
          if (u !== v) edges.push([u, v]);
        });

        var adj = {};
        edges.forEach(function (e) {
          var u = e[0], v = e[1];
          if (!adj[u]) adj[u] = [];
          adj[u].push(v);
          if (!adj[v]) adj[v] = [];
          adj[v].push(u);
        });

        function angleBetween(from, to) {
          var a = vertexList[from], b = vertexList[to];
          return Math.atan2(b.y - a.y, b.x - a.x);
        }
        function nextEdgeAt(vertex, incomingFrom) {
          var neighbors = adj[vertex] || [];
          if (neighbors.length === 0) return null;
          var inAngle = angleBetween(vertex, incomingFrom);
          var best = null;
          var bestDelta = Math.PI * 2;
          for (var n = 0; n < neighbors.length; n++) {
            var w = neighbors[n];
            if (w === incomingFrom) continue;
            var outAngle = angleBetween(vertex, w);
            var delta = outAngle - inAngle;
            while (delta <= -Math.PI) delta += 2 * Math.PI;
            while (delta > Math.PI) delta -= 2 * Math.PI;
            if (delta < 1e-6) continue;
            if (delta < bestDelta) {
              bestDelta = delta;
              best = w;
            }
          }
          return best;
        }

        function signedArea(poly) {
          var n = poly.length;
          if (n < 3) return 0;
          var a = 0;
          for (var i = 0; i < n; i++) {
            var j = (i + 1) % n;
            a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
          }
          return a * 0.5;
        }
        function pointInPolygon(pt, poly) {
          var n = poly.length;
          var inside = false;
          for (var i = 0, j = n - 1; i < n; j = i++) {
            var xi = poly[i].x, yi = poly[i].y;
            var xj = poly[j].x, yj = poly[j].y;
            if (yi === yj) continue;
            if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) inside = !inside;
          }
          return inside;
        }
        function pointNearContour(pt, contour, eps) {
          if (!contour || !contour.points || contour.points.length < 2) return false;
          var pts = contour.points;
          for (var i = 0; i < pts.length; i++) {
            var j = (i + 1) % pts.length;
            var proj = projectPointOnSegment(pt, pts[i], pts[j]);
            if (distImg(pt, proj) <= eps) return true;
          }
          return false;
        }

        var seenCycles = {};
        function cycleKey(cycle) {
          var minI = 0;
          for (var i = 1; i < cycle.length; i++) {
            if (vertexList[cycle[i]].y < vertexList[cycle[minI]].y || (vertexList[cycle[i]].y === vertexList[cycle[minI]].y && vertexList[cycle[i]].x < vertexList[cycle[minI]].x)) minI = i;
          }
          var s = "";
          for (var i = 0; i < cycle.length; i++) s += cycle[(minI + i) % cycle.length] + "-";
          return s;
        }

        var faces = [];
        edges.forEach(function (e) {
          var v0 = e[0], v1 = e[1];
          var path = [v0, v1];
          var cur = v1, prev = v0;
          while (path.length < 500) {
            var next = nextEdgeAt(cur, prev);
            if (next == null) break;
            if (next === v0) {
              faces.push(path.slice());
              break;
            }
            if (path.indexOf(next) >= 0) break;
            path.push(next);
            prev = cur;
            cur = next;
          }
        });

        var uniqueFaces = [];
        var debugFacesAll = [];
        faces.forEach(function (f) {
          var k = cycleKey(f);
          if (seenCycles[k]) return;
          seenCycles[k] = true;
          var poly = f.map(function (i) { return { x: vertexList[i].x, y: vertexList[i].y }; });
          var area = Math.abs(signedArea(poly));
          var cx = 0, cy = 0;
          poly.forEach(function (p) { cx += p.x; cy += p.y; });
          cx /= poly.length;
          cy /= poly.length;
          var insideBati = contourEdges.some(function (edge) {
            var c = edge.ref;
            return c && c.points && c.points.length >= 3 && (pointInPolygon({ x: cx, y: cy }, c.points) || pointNearContour({ x: cx, y: cy }, c, MERGE_EPS_IMG));
          });
          if (CALPINAGE_DEBUG_PANS) {
            debugFacesAll.push({
              polygon: poly.slice(),
              area: area,
              centroid: { x: cx, y: cy },
              insideContour: insideBati,
            });
          }
          if (area < AREA_EPS) return;
          if (!insideBati) return;
          uniqueFaces.push(poly);
        });

        state.pans = uniqueFaces.map(function (polygon, idx) {
          return {
            id: "pan-" + (idx + 1),
            name: "Pan " + (idx + 1),
            polygon: polygon,
            ridgeIds: [],
            obstacles: [],
          };
        });

        /* A-2.4 D?coupe logique : associer ? chaque pan les obstacles (polygones) qui l?intersectent ou sont dedans ??? toit principal uniquement */
        var polygonObstacles = (state.obstacles || []).filter(function (o) {
          return o && o.points && Array.isArray(o.points) && o.points.length >= 3 && o.roofRole !== "chienAssis";
        });
        for (var pi = 0; pi < state.pans.length; pi++) {
          var pan = state.pans[pi];
          var panPoly = pan.polygon;
          var panCx = 0, panCy = 0;
          for (var pk = 0; pk < panPoly.length; pk++) { panCx += panPoly[pk].x; panCy += panPoly[pk].y; }
          panCx /= panPoly.length; panCy /= panPoly.length;
          for (var oj = 0; oj < polygonObstacles.length; oj++) {
            var obs = polygonObstacles[oj];
            var obsCx = 0, obsCy = 0;
            for (var ok = 0; ok < obs.points.length; ok++) { obsCx += obs.points[ok].x; obsCy += obs.points[ok].y; }
            obsCx /= obs.points.length; obsCy /= obs.points.length;
            var overlap = pointInPolygon({ x: panCx, y: panCy }, obs.points) || pointInPolygon({ x: obsCx, y: obsCy }, panPoly);
            if (!overlap) {
              for (var ok = 0; ok < obs.points.length; ok++) {
                if (pointInPolygon(obs.points[ok], panPoly)) { overlap = true; break; }
              }
            }
            if (overlap) pan.obstacles.push(obs.id);
          }
        }

        if (CALPINAGE_DEBUG_PANS && state === CALPINAGE_STATE) {
          CALPINAGE_STATE.debugPansInfo = {
            vertexCount: vertexList.length,
            edgeCount: edges.length,
            faceCount: debugFacesAll.length,
            faces: debugFacesAll.map(function (f) {
              return { area: f.area, centroid: f.centroid, insideContour: f.insideContour };
            }),
          };
          CALPINAGE_STATE.debugFaces = debugFacesAll.map(function (f) { return f.polygon; });
          console.log("[Calpinage DEBUG PANS] sommets=" + vertexList.length + " ar??tes=" + edges.length + " faces d?tect?es=" + debugFacesAll.length);
          debugFacesAll.forEach(function (f, i) {
            console.log("  face " + (i + 1) + " aire=" + f.area.toFixed(2) + " centroid=(" + f.centroid.x.toFixed(2) + "," + f.centroid.y.toFixed(2) + ") insideContour=" + f.insideContour);
          });
        } else if (state === CALPINAGE_STATE) {
          CALPINAGE_STATE.debugPansInfo = null;
          CALPINAGE_STATE.debugFaces = null;
        }
      }

      /** Remplit CALPINAGE_STATE.pans (toit principal). */
      function computePansFromGeometry() {
        computePansFromGeometryCore(CALPINAGE_STATE, { excludeChienAssis: true });
      }

      /** Construit l'objet geometry pour export (sans persistance). Utilisé par CRM (onValidate) et par saveCalpinageState. */
      function buildGeometryForExport() {
        try {
          if (window.PV_LAYOUT_RULES) {
            CALPINAGE_STATE.pvParams.distanceLimitesCm = window.PV_LAYOUT_RULES.marginOuterCm;
            CALPINAGE_STATE.pvParams.espacementHorizontalCm = window.PV_LAYOUT_RULES.spacingXcm;
            CALPINAGE_STATE.pvParams.espacementVerticalCm = window.PV_LAYOUT_RULES.spacingYcm;
            var rulesOrient = (window.PV_LAYOUT_RULES.orientation || "portrait").toString().toLowerCase();
            CALPINAGE_STATE.pvParams.orientationPanneaux = (rulesOrient === "landscape" || rulesOrient === "paysage") ? "landscape" : "portrait";
          }
          var previousPansById = {};
          (CALPINAGE_STATE.pans || []).forEach(function (p) { if (p && p.id) previousPansById[p.id] = p; });
          computePansFromGeometry();
          ensurePanPointsWithHeights();
          /* Restaurer hauteurs et physical sur les pans recalcul?s pour persistance fiable. */
          CALPINAGE_STATE.pans.forEach(function (pan) {
            var prev = previousPansById[pan.id];
            if (!prev) return;
            if (prev.points && Array.isArray(prev.points) && prev.points.length >= 2) {
              pan.points = prev.points.map(function (pt) { return { x: pt.x, y: pt.y, h: typeof pt.h === "number" ? pt.h : 0, id: pt.id }; });
            }
            if (prev.physical) {
              pan.physical = pan.physical || {};
              pan.physical.slope = pan.physical.slope || { mode: "auto", computedDeg: null, valueDeg: null };
              pan.physical.orientation = pan.physical.orientation || { azimuthDeg: null, label: null };
              pan.physical.slope.mode = prev.physical.slope && (prev.physical.slope.mode === "manual" || prev.physical.slope.mode === "auto") ? prev.physical.slope.mode : "auto";
              pan.physical.slope.valueDeg = prev.physical.slope && typeof prev.physical.slope.valueDeg === "number" ? prev.physical.slope.valueDeg : null;
              if (prev.physical.orientation) {
                pan.physical.orientation.azimuthDeg = typeof prev.physical.orientation.azimuthDeg === "number" ? prev.physical.orientation.azimuthDeg : null;
                pan.physical.orientation.label = typeof prev.physical.orientation.label === "string" ? prev.physical.orientation.label : null;
              }
            }
          });
          ensurePansHavePoints();
          if (CalpinagePans.recomputeAllPanPhysicalProps && CALPINAGE_STATE.pans.length) {
            CalpinagePans.recomputeAllPanPhysicalProps(CALPINAGE_STATE.pans, getStateForPans());
          }
          if (CalpinagePans.panState) {
            CalpinagePans.panState.pans.length = 0;
            CALPINAGE_STATE.pans.forEach(function (p) { CalpinagePans.panState.pans.push(p); });
          }
          updatePansListUI();
          return {
            roofState: {
              map: CALPINAGE_STATE.roof.map,
              image: CALPINAGE_STATE.roof.image,
              scale: CALPINAGE_STATE.roof.scale,
              roof: CALPINAGE_STATE.roof.roof,
              contoursBati: CALPINAGE_STATE.contours.map(function (c) { return { id: c.id, points: c.points, roofRole: c.roofRole }; }),
              traits: CALPINAGE_STATE.traits.map(function (t) { return { id: t.id, a: t.a, b: t.b, roofRole: t.roofRole }; }),
              mesures: CALPINAGE_STATE.measures,
              ridges: CALPINAGE_STATE.ridges.map(function (r) { return { id: r.id, a: r.a, b: r.b, roofRole: r.roofRole }; }),
              planes: CALPINAGE_STATE.planes,
              obstacles: (CALPINAGE_STATE.obstacles || []).map(function (o) {
                if (!o || !o.points || !Array.isArray(o.points) || o.points.length < 3) return null;
                var out = { id: o.id, type: "polygon", points: o.points.map(function (p) { return { x: p.x, y: p.y }; }), roofRole: o.roofRole || null, kind: o.kind || "other", meta: o.meta && typeof o.meta === "object" ? o.meta : {} };
                if (o.shapeMeta && typeof o.shapeMeta === "object") out.shapeMeta = o.shapeMeta;
                return out;
              }).filter(Boolean),
              gps: (CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.gps) ? CALPINAGE_STATE.roof.gps : null
            },
            pans: CALPINAGE_STATE.pans,
            activePanId: CalpinagePans.panState.activePanId,
            selectedPanId: CALPINAGE_STATE.selectedPanId,
            phase: CALPINAGE_STATE.phase,
            roofSurveyLocked: CALPINAGE_STATE.roofSurveyLocked,
            validatedRoofData: CALPINAGE_STATE.validatedRoofData,
            pvParams: CALPINAGE_STATE.pvParams,
            placedPanels: CALPINAGE_STATE.placedPanels || [],
            shadowVolumes: CALPINAGE_STATE.shadowVolumes || [],
            roofExtensions: CALPINAGE_STATE.roofExtensions || [],
            frozenBlocks: (function () {
              var getFrozen = (window.pvPlacementEngine && window.pvPlacementEngine.getFrozenBlocks) || (window.ActivePlacementBlock && window.ActivePlacementBlock.getFrozenBlocks);
              return typeof getFrozen === "function" ? getFrozen() : [];
            })().map(function (bl) {
                  return {
                    id: bl.id,
                    panId: bl.panId,
                    panels: (bl.panels || []).map(function (p) { return { center: p.center, projection: p.projection, state: p.state, enabled: p.enabled !== false, localRotationDeg: typeof p.localRotationDeg === "number" ? p.localRotationDeg : 0 }; }),
                    rotation: bl.rotation,
                    orientation: (bl.orientation === "PORTRAIT" || bl.orientation === "PAYSAGE") ? bl.orientation : null,
                  };
                }),
            shading: CALPINAGE_STATE.shading?.normalized || null,
            panel: (function () {
              var p = window.PV_SELECTED_PANEL;
              var api = findPanelById(window.CALPINAGE_SELECTED_PANEL_ID) || (p ? findPanelById(p.id) : null) || p;
              if (!p && !api) return null;
              var src = api || p;
              return {
                id: src.id,
                brand: src.brand,
                name: src.name,
                model_ref: src.model_ref || src.model || src.reference,
                power_wc: Number(src.power_wc || src.powerWc) || 0,
                efficiency_pct: src.efficiency_pct != null ? src.efficiency_pct : src.efficiency,
                width_mm: Number(src.width_mm || src.widthMm) || 0,
                height_mm: Number(src.height_mm || src.heightMm) || 0
              };
            })(),
            totals: (function () {
              var totalPanels = (window.pvPlacementEngine && window.pvPlacementEngine.getAllPanels) ? (window.pvPlacementEngine.getAllPanels() || []).length : 0;
              var p = window.PV_SELECTED_PANEL;
              var api = findPanelById(window.CALPINAGE_SELECTED_PANEL_ID) || (p ? findPanelById(p.id) : null) || p;
              var powerWc = (api || p) && (api ? api.power_wc : p.powerWc) != null ? Number(api ? api.power_wc : p.powerWc) : 0;
              var totalPowerKwc = totalPanels > 0 && powerWc > 0 ? (totalPanels * powerWc) / 1000 : 0;
              return { panels_count: totalPanels, total_power_kwc: totalPowerKwc };
            })(),
            /* CP-006 — Onduleur sélectionné et totaux */
            inverter: (function () {
              var inv = window.PV_SELECTED_INVERTER || (window.CALPINAGE_SELECTED_INVERTER_ID ? findInverterById(window.CALPINAGE_SELECTED_INVERTER_ID) : null);
              if (!inv || !inv.id) return null;
              return {
                id: inv.id,
                brand: inv.brand,
                name: inv.name,
                model_ref: inv.model_ref,
                inverter_type: inv.inverter_type,
                nominal_power_kw: inv.nominal_power_kw,
                nominal_va: inv.nominal_va
              };
            })(),
            inverter_totals: (function () {
              var inv = window.PV_SELECTED_INVERTER || (window.CALPINAGE_SELECTED_INVERTER_ID ? findInverterById(window.CALPINAGE_SELECTED_INVERTER_ID) : null);
              var totalPanels = (window.pvPlacementEngine && window.pvPlacementEngine.getAllPanels) ? (window.pvPlacementEngine.getAllPanels() || []).length : 0;
              var p = window.PV_SELECTED_PANEL;
              var api = findPanelById(window.CALPINAGE_SELECTED_PANEL_ID) || (p ? findPanelById(p.id) : null) || p;
              var selectedPanel = api || p;
              var powerWc = selectedPanel && (selectedPanel.power_wc != null || selectedPanel.powerWc != null) ? Number(selectedPanel.power_wc || selectedPanel.powerWc) || 0 : 0;
              var totalPowerKwc = totalPanels > 0 && powerWc > 0 ? (totalPanels * powerWc) / 1000 : 0;
              var panelSpec = selectedPanel ? { power_wc: powerWc, isc_a: selectedPanel.isc_a, vmp_v: selectedPanel.vmp_v, strings: selectedPanel.strings } : null;
              var validation = inv ? validateInverterSizing({ totalPanels: totalPanels, totalPowerKwc: totalPowerKwc, inverter: inv, panelSpec: panelSpec }) : { requiredUnits: 0, isDcPowerOk: true, isCurrentOk: true, isMpptOk: true, isVoltageOk: true, warnings: [] };
              return {
                units_required: validation.requiredUnits,
                isDcPowerOk: validation.isDcPowerOk,
                isCurrentOk: validation.isCurrentOk,
                isMpptOk: validation.isMpptOk,
                isVoltageOk: validation.isVoltageOk,
                warnings: validation.warnings
              };
            })(),
            geometry3d: (function () {
              try {
                var ctx = typeof getHeightAtImgPoint === "function"
                  ? { getHeightAtImagePoint: function (x, y) { return getHeightAtImgPoint({ x: x, y: y }); } }
                  : null;
                var norm = normalizeCalpinageGeometry3DReady(CALPINAGE_STATE, ctx, {
                  getAllPanels: window.pvPlacementEngine && window.pvPlacementEngine.getAllPanels,
                  computePansFromGeometryCore: computePansFromGeometryCore,
                });
                return buildGeometry3DExportSection(norm, ctx);
              } catch (err) {
                if (typeof console !== "undefined") console.warn("[CALPINAGE] geometry3d export failed", err);
                return null;
              }
            })()
          };
        } catch (e) { return null; }
      }

      /** Instrumentation : identifie la propriété qui fait échouer JSON.stringify (référence circulaire, fonction, DOM, canvas, moteur). */
      function debugStringifyError(obj, label) {
        if (!obj || typeof obj !== "object") return;
        var seen = new WeakSet();
        var engineRefs = [];
        try {
          if (typeof window !== "undefined") {
            if (window.pvPlacementEngine) engineRefs.push(window.pvPlacementEngine);
            if (window.ActivePlacementBlock) engineRefs.push(window.ActivePlacementBlock);
          }
        } catch (e) {}
        function inspect(val, path) {
          if (val === null || typeof val !== "object") return;
          try {
            if (seen.has(val)) {
              console.log("  [CIRCULAR] " + path + " -> référence circulaire (objet déjà visité)");
              return;
            }
            seen.add(val);
            var type = typeof val;
            var isFunc = type === "function";
            var isDOM = val && type === "object" && typeof val.nodeType === "number";
            var isCanvas = val && type === "object" && val.tagName === "CANVAS";
            var isEngineRef = engineRefs.some(function (r) { return val === r; });
            if (isFunc) {
              console.log("  [FONCTION] " + path);
              return;
            }
            if (isDOM) {
              console.log("  [DOM] " + path + " nodeType=" + (val.nodeType || "?"));
              return;
            }
            if (isCanvas) {
              console.log("  [CANVAS] " + path);
              return;
            }
            if (isEngineRef) {
              console.log("  [REFERENCE MOTEUR] " + path);
              return;
            }
            try {
              JSON.stringify(val);
            } catch (e) {
              console.log("  [NON-SERIALISABLE] " + path + " -> " + (e && e.message));
              if (val && type === "object" && !Array.isArray(val)) {
                for (var k in val) {
                  if (Object.prototype.hasOwnProperty.call(val, k)) {
                    inspect(val[k], path + "." + k);
                  }
                }
              } else if (Array.isArray(val)) {
                for (var i = 0; i < val.length; i++) {
                  inspect(val[i], path + "[" + i + "]");
                }
              }
              return;
            }
            for (var key in val) {
              if (Object.prototype.hasOwnProperty.call(val, key)) {
                inspect(val[key], path + "." + key);
              }
            }
            if (Array.isArray(val)) {
              for (var j = 0; j < val.length; j++) {
                inspect(val[j], path + "[" + j + "]");
              }
            }
          } catch (traverseErr) {
            console.log("  [TRAVERSE ERR] " + path + " ->", traverseErr);
          }
        }
        inspect(obj, label || "obj");
      }

      function saveCalpinageState() {
        try {
          var data = buildGeometryForExport();
          if (!data) return;
          var sid = (typeof window !== "undefined" && window.CALPINAGE_STUDY_ID) || null;
          var vid = (typeof window !== "undefined" && window.CALPINAGE_VERSION_ID) || null;
          if (sid && vid) {
            try {
              var json = JSON.stringify(data);
              setCalpinageItem("state", sid, vid, json);
            } catch (e) {
              console.error("STRINGIFY ERROR DETAIL:", e);
              console.log("OBJECT STRUCTURE:", data);
              debugStringifyError(data, "data");
            }
          }
        } catch (e) {}
      }

      function pvSyncSaveRender() {
        if (window.__PV_SYNC_PENDING__) return;
        window.__PV_SYNC_PENDING__ = true;
        requestAnimationFrame(function () {
          try {
            if (typeof syncPlacedPanelsFromBlocks === "function") syncPlacedPanelsFromBlocks();
          } catch (e) {}
          try {
            if (typeof saveCalpinageState === "function") saveCalpinageState();
          } catch (e) {}
          try {
            if (typeof updatePowerSummary === "function") updatePowerSummary();
            if (typeof updateCalpinageValidateButton === "function") updateCalpinageValidateButton();
            if (typeof window.notifyPhase3ChecklistUpdate === "function") window.notifyPhase3ChecklistUpdate();
            if (typeof window.notifyPhase3SidebarUpdate === "function") window.notifyPhase3SidebarUpdate();
          } catch (e) {}
          try {
            if (typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
          } catch (e) {}
          window.__PV_SYNC_PENDING__ = false;
        });
      }

      /** CP-005 — Met ? jour l'affichage puissance totale (panneaux pos?s * power_wc). */
      function updatePowerSummary() {
        var summaryEl = container.querySelector("#pv-power-summary");
        var countEl = container.querySelector("#pv-panels-count");
        var kwcEl = container.querySelector("#pv-total-kwc");
        var totalPanels = (window.pvPlacementEngine && window.pvPlacementEngine.getAllPanels) ? (window.pvPlacementEngine.getAllPanels() || []).length : 0;
        var selectedPanel = findPanelById(window.CALPINAGE_SELECTED_PANEL_ID) || (window.PV_SELECTED_PANEL ? findPanelById(window.PV_SELECTED_PANEL.id) : null);
        if (!selectedPanel) selectedPanel = window.PV_SELECTED_PANEL;
        var powerWc = selectedPanel && (selectedPanel.power_wc != null || selectedPanel.powerWc != null) ? (Number(selectedPanel.power_wc || selectedPanel.powerWc) || 0) : 0;
        var totalPowerWc = totalPanels * powerWc;
        var totalPowerKwc = totalPowerWc / 1000;
        var kwcStr = totalPowerKwc > 0 ? totalPowerKwc.toFixed(2) : "0";
        if (summaryEl && countEl && kwcEl) {
          countEl.textContent = String(totalPanels);
          kwcEl.textContent = kwcStr;
          summaryEl.style.display = (CALPINAGE_STATE.currentPhase === "PV_LAYOUT") ? "block" : "none";
        }
        var liveCountEl = container.querySelector("#pv-live-panels-count");
        var liveKwcEl = container.querySelector("#pv-live-total-kwc");
        if (liveCountEl) liveCountEl.textContent = String(totalPanels);
        if (liveKwcEl) liveKwcEl.textContent = kwcStr + " kWc";
        if (typeof updateInvertersRequired === "function") updateInvertersRequired();
        if (typeof window.notifyPhase3ChecklistUpdate === "function") window.notifyPhase3ChecklistUpdate();
        if (typeof window.notifyPhase3SidebarUpdate === "function") window.notifyPhase3SidebarUpdate();
      }

      /**
       * CP-006 — Calcule et affiche le nombre d'onduleurs requis.
       * Utilise validateInverterSizing pour validation électrique enrichie.
       * P3-UI-SEPARATION : CENTRAL = comportement actuel ; MICRO = affichage dédié (1 micro/panneau, AC total).
       */
      function updateInvertersRequired() {
        var reqRow = container.querySelector("#pv-inverters-required-row");
        var reqEl = container.querySelector("#pv-inverters-required");
        var microInfoBlock = container.querySelector("#pv-micro-info-block");
        var microCountEl = container.querySelector("#pv-micro-count");
        var microAcTotalEl = container.querySelector("#pv-micro-ac-total");
        var inv = window.PV_SELECTED_INVERTER || (window.CALPINAGE_SELECTED_INVERTER_ID ? findInverterById(window.CALPINAGE_SELECTED_INVERTER_ID) : null);
        var totalPanels = (window.pvPlacementEngine && window.pvPlacementEngine.getAllPanels) ? (window.pvPlacementEngine.getAllPanels() || []).length : 0;
        var selectedPanel = findPanelById(window.CALPINAGE_SELECTED_PANEL_ID) || (window.PV_SELECTED_PANEL ? findPanelById(window.PV_SELECTED_PANEL.id) : null);
        if (!selectedPanel) selectedPanel = window.PV_SELECTED_PANEL;
        var powerWc = selectedPanel && (selectedPanel.power_wc != null || selectedPanel.powerWc != null) ? (Number(selectedPanel.power_wc || selectedPanel.powerWc) || 0) : 0;
        var totalPowerKwc = totalPanels > 0 && powerWc > 0 ? (totalPanels * powerWc) / 1000 : 0;
        var panelSpec = selectedPanel ? { power_wc: powerWc, isc_a: selectedPanel.isc_a, vmp_v: selectedPanel.vmp_v, strings: selectedPanel.strings } : null;
        var validation = inv ? validateInverterSizing({ totalPanels: totalPanels, totalPowerKwc: totalPowerKwc, inverter: inv, panelSpec: panelSpec }) : { requiredUnits: 0, isDcPowerOk: true, isCurrentOk: true, isMpptOk: true, isVoltageOk: true, warnings: [] };
        var units = validation.requiredUnits;
        var family = inv ? (normalizeInverterFamily(inv) || "CENTRAL") : "CENTRAL";
        if (family === "MICRO") {
          if (reqRow) {
            var spanEl = reqRow.querySelector("span");
            if (spanEl) spanEl.textContent = "Unit\u00E9s requises :";
            if (reqEl) reqEl.textContent = inv ? String(units) : "\u2014";
          }
          if (microInfoBlock) microInfoBlock.style.display = inv && totalPanels > 0 ? "block" : "none";
          if (microCountEl) microCountEl.textContent = inv ? String(units) : "\u2014";
          var acPowerKw = inv && (inv.nominal_power_kw != null || inv.max_dc_power_kw != null) ? (Number(inv.nominal_power_kw ?? inv.max_dc_power_kw) || 0) : 0;
          var acTotalKw = inv && totalPanels > 0 && acPowerKw > 0 ? totalPanels * acPowerKw : 0;
          if (microAcTotalEl) microAcTotalEl.textContent = inv && totalPanels > 0 ? acTotalKw.toFixed(2) : "\u2014";
        } else {
          if (reqRow) {
            var spanCentral = reqRow.querySelector("span");
            if (spanCentral) spanCentral.textContent = "Onduleurs requis :";
            if (reqEl) reqEl.textContent = inv ? String(units) : "\u2014";
          }
          if (microInfoBlock) microInfoBlock.style.display = "none";
        }
        var liveReqEl = container.querySelector("#pv-live-inverters-required");
        var liveInvEl = container.querySelector("#pv-live-inverter-name");
        var liveStatusEl = container.querySelector("#pv-live-inverter-status");
        var liveUnitsStr = inv ? String(units) : "\u2014";
        if (liveReqEl) liveReqEl.textContent = liveUnitsStr;
        if (liveInvEl) {
          if (inv) {
            var brand = (inv.brand || "").trim();
            var name = (inv.name || inv.model_ref || "").trim() || inv.id;
            var typeLabel = ((inv.inverter_type || "").toLowerCase() === "micro" ? "micro" : (inv.inverter_type || "").toLowerCase() === "string" ? "string" : "") || "";
            liveInvEl.textContent = brand ? (brand + " \u2014 " + name + (typeLabel ? " (" + typeLabel + ")" : "")) : (name + (typeLabel ? " (" + typeLabel + ")" : ""));
          } else {
            liveInvEl.textContent = "\u2014";
          }
        }
        if (liveStatusEl) {
          var hasMajor = !validation.isDcPowerOk || !validation.isCurrentOk;
          var catalogueIncomplet = validation.warnings.some(function (w) { return w.indexOf("Catalogue incomplet") >= 0; });
          var statusText, statusClass;
          if (!inv) {
            statusText = "\u2014";
            statusClass = "";
          } else if (catalogueIncomplet && family === "MICRO") {
            statusText = "\u26A0 \u00C0 compl\u00E9ter (catalogue)";
            statusClass = "pv-status-warning";
          } else if (catalogueIncomplet) {
            statusText = "\u2716 Incompatible";
            statusClass = "pv-status-error";
          } else if (validation.warnings.length === 0) {
            statusText = "\u2713 Compatible";
            statusClass = "pv-status-ok";
          } else if (hasMajor) {
            statusText = "\u2716 Incompatible";
            statusClass = "pv-status-error";
          } else {
            statusText = "\u26A0 Attention";
            statusClass = "pv-status-warning";
          }
          liveStatusEl.textContent = statusText;
          liveStatusEl.className = statusClass;
        }
        var liveWarningEl = container.querySelector("#pv-live-inverter-warning");
        if (liveWarningEl) {
          var mainWarning = validation.warnings.find(function (w) { return w.indexOf("Catalogue incomplet") >= 0; });
          if (mainWarning) {
            liveWarningEl.textContent = mainWarning;
            liveWarningEl.style.display = "block";
          } else {
            liveWarningEl.textContent = "";
            liveWarningEl.style.display = "none";
          }
        }
        if (typeof window.notifyPhase3SidebarUpdate === "function") window.notifyPhase3SidebarUpdate();
      }

      /** CP-005 — Désactive "Valider calpinage" si aucun panneau sélectionné, 0 panneaux posés, pas d'onduleur (CP-006), ou checklist Phase3 non OK. */
      function updateCalpinageValidateButton() {
        var btn = container.querySelector("#btn-validate-calpinage");
        if (!btn) return;
        var totalPanels = (window.pvPlacementEngine && window.pvPlacementEngine.getAllPanels) ? (window.pvPlacementEngine.getAllPanels() || []).length : 0;
        var hasPanel = !!(window.PV_SELECTED_PANEL && window.PV_SELECTED_PANEL.id) || !!(window.CALPINAGE_SELECTED_PANEL_ID);
        var hasInverter = !!(window.PV_SELECTED_INVERTER && window.PV_SELECTED_INVERTER.id) || !!(window.CALPINAGE_SELECTED_INVERTER_ID);
        var checklistOk = typeof window.getPhase3ChecklistOk === "function" ? window.getPhase3ChecklistOk() : true;
        var canValidate = hasPanel && totalPanels > 0 && hasInverter && checklistOk;
        btn.disabled = !canValidate;
        if (btn.title) {
          if (canValidate) btn.title = "Valider d\u00E9finitivement le calepinage et calculer le r\u00E9sultat";
          else if (!hasPanel) btn.title = "S\u00E9lectionnez un module photovolta\u00EFque";
          else if (!hasInverter) btn.title = "S\u00E9lectionnez un onduleur";
          else if (!checklistOk) btn.title = "Ratio DC/AC hors plage (0,8 \u00E0 1,4) ou checklist incompl\u00E8te";
          else btn.title = "Posez au moins un panneau pour valider";
        }
        if (typeof window.notifyPhase3ChecklistUpdate === "function") window.notifyPhase3ChecklistUpdate();
        if (typeof window.notifyPhase3SidebarUpdate === "function") window.notifyPhase3SidebarUpdate();
      }

      /** Données pour Phase3ChecklistPanel (lecture seule, source existante). P5-CHECKLIST-LOCKED */
      window.getPhase3ChecklistData = function getPhase3ChecklistData() {
        var totalPanels = (window.pvPlacementEngine && window.pvPlacementEngine.getAllPanels) ? (window.pvPlacementEngine.getAllPanels() || []).length : 0;
        var inv = window.PV_SELECTED_INVERTER || (window.CALPINAGE_SELECTED_INVERTER_ID ? findInverterById(window.CALPINAGE_SELECTED_INVERTER_ID) : null);
        var selectedPanel = findPanelById(window.CALPINAGE_SELECTED_PANEL_ID) || (window.PV_SELECTED_PANEL ? findPanelById(window.PV_SELECTED_PANEL.id) : null);
        if (!selectedPanel) selectedPanel = window.PV_SELECTED_PANEL;
        var powerWc = selectedPanel && (selectedPanel.power_wc != null || selectedPanel.powerWc != null) ? (Number(selectedPanel.power_wc || selectedPanel.powerWc) || 0) : 0;
        var totalDcKw = totalPanels > 0 && powerWc > 0 ? (totalPanels * powerWc) / 1000 : 0;
        var acPowerKw = inv && (inv.nominal_power_kw != null || inv.max_dc_power_kw != null) ? (Number(inv.nominal_power_kw ?? inv.max_dc_power_kw) || 0) : 0;
        var invName = inv ? ((inv.brand || "").trim() ? (inv.brand + " \u2014 " + ((inv.name || inv.model_ref || "").trim() || inv.id)) : ((inv.name || inv.model_ref || "").trim() || inv.id)) : "";
        var inverterFamily = inv ? (normalizeInverterFamily(inv) || "CENTRAL") : "CENTRAL";
        return {
          panelCount: totalPanels,
          totalDcKw: totalDcKw,
          selectedInverter: inv ? { name: invName, acPowerKw: acPowerKw > 0 ? acPowerKw : 1 } : null,
          inverterFamily: inverterFamily
        };
      };

      /** P5-CHECKLIST-LOCKED : CENTRAL = ratio bloquant, MICRO = ratio indicatif. */
      window.getPhase3ChecklistOk = function getPhase3ChecklistOk() {
        var d = window.getPhase3ChecklistData && window.getPhase3ChecklistData();
        if (!d) return true;
        if (d.panelCount <= 0 || !d.selectedInverter) return false;
        var family = d.inverterFamily || "CENTRAL";
        var acKw = d.selectedInverter.acPowerKw > 0 ? d.selectedInverter.acPowerKw : 0;
        var acTotalKw = family === "MICRO" ? d.panelCount * acKw : acKw;
        var ratio = acTotalKw > 0 ? d.totalDcKw / acTotalKw : null;
        if (family === "MICRO") return true;
        return ratio !== null && ratio >= 0.8;
      };

      /** Retourne geometry_json et calpinage_data pour callback onValidate (legacy mode). */
      function getCalpinageExportData() {
        try {
          if (typeof saveCalpinageState === "function") saveCalpinageState();
          var sid = (typeof window !== "undefined" && window.CALPINAGE_STUDY_ID) || null;
          var vid = (typeof window !== "undefined" && window.CALPINAGE_VERSION_ID) || null;
          var raw = getCalpinageItem("state", sid, vid);
          var geometryJson = raw ? JSON.parse(raw) : null;
          return { geometry_json: geometryJson, calpinage_data: geometryJson };
        } catch (e) { return { geometry_json: null, calpinage_data: null }; }
      }

      /** Chemin CRM (onValidate) : construit export sans saveCalpinageState, fetch, solarnext_token, smartpitch_last_result. */
      function getCalpinageExportDataForCRM() {
        try {
          var geometryJson = buildGeometryForExport();
          return { geometry_json: geometryJson, calpinage_data: geometryJson };
        } catch (e) {
          if (typeof console !== "undefined") console.error("[CALPINAGE] getCalpinageExportDataForCRM failed", e);
          return { geometry_json: null, calpinage_data: null };
        }
      }

      function updateValidateButton() {
        var btn = container.querySelector("#btn-validate-roof");
        var hint = container.querySelector("#zone-a-validate-hint");
        if (!btn) return;
        var can = canValidateRoofSurvey();
        btn.disabled = !can;
        if (typeof window.notifyPhase2SidebarUpdate === "function") {
          window.notifyPhase2SidebarUpdate();
        } else if (hint) {
          if (can) hint.textContent = "Cliquez pour figer le relev\u00E9 et passer \u00E0 l'implantation des panneaux.";
          else if (!isContourValid()) hint.textContent = "Dessinez d'abord un contour b\u00E2ti ferm\u00E9 (au moins 3 points).";
          else if ((CALPINAGE_STATE.pans || []).length < 1) hint.textContent = "Ajoutez au moins un fa\u00EEtage ou trait pour d\u00E9finir un pan.";
          else hint.textContent = "Contour b\u00E2ti et au moins un pan requis.";
        }
        if (typeof updatePhase2StepsUI === "function") updatePhase2StepsUI();
      }

      function getPhase2ValidateHint() {
        var can = canValidateRoofSurvey();
        if (can) return "Cliquez pour figer le relev\u00E9 et passer \u00E0 l'implantation des panneaux.";
        if (!isContourValid()) return "Dessinez d'abord un contour b\u00E2ti ferm\u00E9 (au moins 3 points).";
        if ((CALPINAGE_STATE.pans || []).length < 1) return "Ajoutez au moins un fa\u00EEtage ou trait pour d\u00E9finir un pan.";
        return "Contour b\u00E2ti et au moins un pan requis.";
      }

      window.getPhase2Data = function () {
        var contours = (CALPINAGE_STATE.contours || []).filter(function (c) { return c && c.roofRole !== "chienAssis"; });
        var ridges = (CALPINAGE_STATE.ridges || []).filter(function (r) { return r && r.roofRole !== "chienAssis"; });
        var obstacles = CALPINAGE_STATE.obstacles || [];
        var captured = !!(CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.image && CALPINAGE_STATE.roof.image.dataUrl);
        return {
          contourClosed: contours.some(function (c) { return c && c.points && c.points.length >= 3 && c.closed !== false; }),
          ridgeDefined: ridges.length > 0,
          heightsDefined: (function () {
            var ok = function (pt) { return pt && typeof pt.h === "number" && Number.isFinite(pt.h); };
            var i, j, pt;
            for (i = 0; i < contours.length; i++) {
              if (!contours[i].points) return false;
              for (j = 0; j < contours[i].points.length; j++) {
                pt = contours[i].points[j];
                if (!pt || !ok(pt)) return false;
              }
            }
            for (i = 0; i < ridges.length; i++) {
              if (!ridges[i].a || !ok(ridges[i].a) || !ridges[i].b || !ok(ridges[i].b)) return false;
            }
            var traits = (CALPINAGE_STATE.traits || []).filter(function (t) { return t && t.roofRole !== "chienAssis"; });
            for (i = 0; i < traits.length; i++) {
              if (!traits[i].a || !ok(traits[i].a) || !traits[i].b || !ok(traits[i].b)) return false;
            }
            return true;
          })(),
          obstaclesCount: obstacles.length,
          canValidate: canValidateRoofSurvey(),
          validateHint: getPhase2ValidateHint(),
          captured: captured
        };
      };

      function updatePhase2StepsUI() {
        if (CALPINAGE_STATE.currentPhase !== "ROOF_EDIT" || CALPINAGE_STATE.roofSurveyLocked) return;
        var ridges = (CALPINAGE_STATE.ridges || []).filter(function (r) { return r && r.roofRole !== "chienAssis"; });
        var obstacles = CALPINAGE_STATE.obstacles || [];
        var hasContour = isContourValid();
        var hasRidge = ridges.length > 0;
        var step3Unlocked = hasRidge;
        var heightsValid = areAllHeightsValid();
        var steps = [
          { id: "phase2-step-1", status: hasContour ? "completed" : "active" },
          { id: "phase2-step-2", status: !hasContour ? "inactive" : hasRidge ? "completed" : "active" },
          { id: "phase2-step-3", status: !step3Unlocked ? "inactive" : obstacles.length > 0 ? "completed" : "active" },
          { id: "phase2-step-4", status: !step3Unlocked ? "inactive" : heightsValid ? "completed" : "active" }
        ];
        steps.forEach(function (s) {
          var el = container.querySelector("#" + s.id);
          if (el) el.setAttribute("data-status", s.status);
        });
        if (typeof window.notifyPhase2SidebarUpdate === "function") window.notifyPhase2SidebarUpdate();
      }

      function updatePhaseUI() {
        var phase = CALPINAGE_STATE.phase;
        var locked = CALPINAGE_STATE.roofSurveyLocked;
        /* R?gle m?tier : un seul mode actif. Phase 2 = ROOF_EDIT, Phase 3 = PV_LAYOUT. */
        CALPINAGE_STATE.currentPhase = (phase === 3 || locked) ? "PV_LAYOUT" : "ROOF_EDIT";
        if (
          CALPINAGE_STATE.currentPhase === "PV_LAYOUT" &&
          !CALPINAGE_STATE.validatedRoofData
        ) {
          CALPINAGE_STATE.currentPhase = "ROOF_EDIT";
          updatePhaseUI();
          return;
        }
        var zoneA = container.querySelector("#zone-a");
        var bodyEl = container.querySelector("#calpinage-body");
        var titleEl = container.querySelector("#zone-a-phase-title");
        var descEl = container.querySelector("#zone-a-phase-desc");
        var validateBlock = container.querySelector("#zone-a-validate-block");
        var toolbar = container.querySelector("#zone-b-toolbar");
        if (CALPINAGE_STATE.currentPhase === "PV_LAYOUT") {
          drawState.activeTool = "panels";
          ensurePVSelectedPanel();
          window.CALPINAGE_ALLOWED = true;
          if (zoneA) zoneA.classList.add("phase-pv-layout");
          if (bodyEl) bodyEl.classList.add("phase-pv-layout");
          if (validateBlock) validateBlock.style.display = "none";
          if (toolbar) toolbar.classList.add("phase-locked");
          if (typeof window.syncPhase3LayoutUI === "function") window.syncPhase3LayoutUI();
          if (typeof window.syncPhase3ToolbarActiveTool === "function") window.syncPhase3ToolbarActiveTool();
          if (typeof updatePowerSummary === "function") updatePowerSummary();
          if (typeof updateCalpinageValidateButton === "function") updateCalpinageValidateButton();
        } else {
         if (zoneA) zoneA.classList.remove("phase-pv-layout");
if (bodyEl) bodyEl.classList.remove("phase-pv-layout");
if (titleEl) titleEl.textContent = "Phase 2 — Relevé toiture";
if (descEl) descEl.textContent = "Dessinez le toit réel : contour, faîtages, obstacles et mesures. Aucun panneau, aucun calcul solaire.";
if (validateBlock) validateBlock.style.display = "block";
if (toolbar) toolbar.classList.remove("phase-locked");
CALPINAGE_STATE.activeManipulationBlockId = null;
updateValidateButton();

        }
      }

      // CP-005 — Charger le catalogue panneaux via API avant tout
      // CP-006 — Charger le catalogue onduleurs via API
      (async function doLoad() {
        await Promise.all([loadPanelsFromApi(), loadInvertersFromApi()]);
        loadPvParams();
        // DEBUG: allow starting fresh without restoring previous calpinage
        var __fresh = false;
        try { __fresh = new URLSearchParams(location.search).get("fresh") === "1"; } catch(e) {}
        if (!__fresh) {
          var studyId = (function () { try { return new URLSearchParams(location.search).get("studyId"); } catch (e) { return null; } })();
          var versionId = (function () { try { return new URLSearchParams(location.search).get("versionId"); } catch (e) { return null; } })();
          if (!studyId && typeof window.CALPINAGE_STUDY_ID !== "undefined") studyId = window.CALPINAGE_STUDY_ID;
          if (!versionId && typeof window.CALPINAGE_VERSION_ID !== "undefined") versionId = window.CALPINAGE_VERSION_ID;
          if (studyId && versionId) {
            window.CALPINAGE_STUDY_ID = studyId;
            window.CALPINAGE_VERSION_ID = versionId;
          }
          var loaded = false;
          if (studyId && versionId) {
            try {
              var apiBase = (window.CALPINAGE_API_BASE != null ? window.CALPINAGE_API_BASE : (window.location && window.location.origin)) || "";
              var token = localStorage.getItem("solarnext_token");
              var headers = { "Content-Type": "application/json" };
              if (token) headers["Authorization"] = "Bearer " + token;
              var res = await fetch(apiBase + "/api/studies/" + encodeURIComponent(studyId) + "/versions/" + encodeURIComponent(versionId) + "/calpinage", { headers });
              if (res.ok) {
                var json = await res.json();
                if (json.ok && json.calpinageData && json.calpinageData.geometry_json) {
                  loadCalpinageState(json.calpinageData.geometry_json);
                  loaded = true;
                  if (typeof console !== "undefined" && console.log) console.log("[CALPINAGE] load: api ok");
                }
              } else if (res.status === 404) {
                if (typeof console !== "undefined" && console.log) console.log("[CalpinageOverlay] open studyId=" + studyId + " versionNumber=" + versionId + " — pas de calpinage existant (404), init vide");
              } else if (res.status >= 400 && res.status < 600) {
                if (typeof console !== "undefined" && console.warn) console.warn("[CALPINAGE] GET calpinage " + res.status + ", init vide");
              }
            } catch (e) {
              console.warn("[CALPINAGE] API load failed, falling back to localStorage", e);
            }
          }
          if (!loaded) {
            if (studyId && versionId) {
              var fallbackKey = getScopedKey(CALPINAGE_STORAGE_KEY, studyId, versionId);
              if (fallbackKey) {
                loadCalpinageState();
                if (typeof console !== "undefined" && console.log) console.log("[CALPINAGE] load: fallback localStorage scoped key=" + fallbackKey);
              }
            } else {
              if (typeof console !== "undefined" && console.warn) console.warn("[CALPINAGE] load: pas de fallback localStorage (studyId ou versionId manquant)");
            }
          }
        } else {
          console.log("[CALPINAGE] fresh=1 → skip loadCalpinageState()");
        }
        if (CALPINAGE_STATE.phase === 3 || CALPINAGE_STATE.roofSurveyLocked) {
          window.CALPINAGE_ALLOWED = true;
        }
        updatePansListUI();
        updatePhaseUI();
        if (typeof tryApplyInitialMapPosition === "function") tryApplyInitialMapPosition();
      })();

      (function initValidateRoofButton() {
        var btn = container.querySelector("#btn-validate-roof");
        if (!btn) return;
        addSafeListener(btn, "click", function () {
          if (!canValidateRoofSurvey()) return;
          CALPINAGE_STATE.validatedRoofData = buildValidatedRoofData();
          CALPINAGE_STATE.roofSurveyLocked = true;
          CALPINAGE_STATE.phase = 3;
          CALPINAGE_STATE.currentPhase = "PV_LAYOUT";
          window.CALPINAGE_ALLOWED = true;
          /* PV_RULES_INITIALIZED : mono-point dans loadCalpinageState() apr?s mapping pvParams ??? PV_LAYOUT_RULES. */
          saveCalpinageState();
          updatePhaseUI();
          if (false && window.CalpinageDP2Behavior && !window.CALPINAGE_DP2_INIT_DONE) {
            window.CALPINAGE_DP2_INIT_DONE = true;
            var canvasEl = container.querySelector("#calpinage-canvas-el");
            var toolbar = container.querySelector("#pv-layout-dp2-toolbar") || container.querySelector("#zone-b-toolbar");
            if (!window.CALPINAGE_DP2_STATE) {
              console.warn("[Calpinage DP2] CALPINAGE_DP2_STATE manquant.");
            } else if (!toolbar) {
              console.warn("[Calpinage DP2] Aucune toolbar trouv\u00E9e (pv-layout-dp2-toolbar, zone-b-toolbar).");
            } else if (!canvasEl) {
              console.warn("[Calpinage DP2] calpinage-canvas-el manquant.");
            }
            if (canvasEl && toolbar && window.CALPINAGE_DP2_STATE && window.CalpinagePanelsAdapter) {
              if (!window.CALPINAGE_DP2_STATE.currentTool) window.CALPINAGE_DP2_STATE.currentTool = "panels";
              var ENG = window.pvPlacementEngine;
              var dp2Options = {
                state: window.CALPINAGE_DP2_STATE,
                onRender: function () {
                  if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
                },
                getCanvasCoords: function (canvas, clientX, clientY) {
                  var rect = canvas.getBoundingClientRect();
                  var screen = { x: clientX - rect.left, y: clientY - rect.top };
                  return typeof window.calpinageScreenToImage === "function"
                    ? window.calpinageScreenToImage(screen)
                    : { x: screen.x, y: screen.y };
                },
                /* Pose de panneau = uniquement sur ghost moteur (calpinage.html mousedown). Plus de onPlacePanelDone / commitFromDP2. */
              };
              var adapter = window.CalpinagePanelsAdapter.create({
                getFrozenBlocks: function () { return ENG && ENG.getFrozenBlocks ? ENG.getFrozenBlocks() : []; },
                getActiveBlock: function () { return ENG && ENG.getActiveBlock ? ENG.getActiveBlock() : null; },
                getBlockById: function (id) { return ENG && ENG.getBlockById ? ENG.getBlockById(id) : null; },
                getBlockCenter: function (block) { return ENG && ENG.getBlockCenter && block ? ENG.getBlockCenter(block) : null; },
                getFocusBlock: function () { return ENG && ENG.getFocusBlock ? ENG.getFocusBlock() : null; },
                addPanelAtCenter: function (block, center, getCtx) { return ENG && ENG.addPanelAtCenter ? ENG.addPanelAtCenter(block, center, getCtx) : { success: false }; },
                createBlock: function (panId, center, rules, ctx) { return ENG && ENG.createBlock ? ENG.createBlock(panId, center, rules, ctx) : { success: false }; },
                endBlock: function () { if (ENG && ENG.endBlock) ENG.endBlock(); },
                recomputeBlockProjections: function (block, getCtx) { if (ENG && ENG.recomputeBlockProjections) ENG.recomputeBlockProjections(block, getCtx); },
                updatePanelValidationForBlock: function (block, getCtx) { if (ENG && ENG.updatePanelValidationForBlock) ENG.updatePanelValidationForBlock(block, getCtx); },
                getProjectionContextForPan: typeof getProjectionContextForPan === "function" ? getProjectionContextForPan : function () { return null; },
                requestRender: function () { if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER(); },
                pointInPolygonImage: typeof pointInPolygonImage === "function" ? pointInPolygonImage : function () { return false; },
                validatedRoofData: CALPINAGE_STATE.validatedRoofData || null,
                panIdFromBlock: function (block) { return block && block.panId; },
                setManipulationTransform: function (dx, dy, rotationDeg) { if (ENG && ENG.setManipulationTransform) ENG.setManipulationTransform(dx, dy, rotationDeg); },
                commitManipulation: function () { if (ENG && ENG.commitManipulation) ENG.commitManipulation(); },
                recomputeAllPlacementBlocksFromRules: typeof recomputeAllPlacementBlocksFromRules === "function" ? recomputeAllPlacementBlocksFromRules : function () {},
                saveCalpinageState: typeof saveCalpinageState === "function" ? saveCalpinageState : function () {},
              });
              window.CALPINAGE_DP2_ADAPTER = adapter;
              window.CALPINAGE_DP2_OPTIONS = dp2Options;
              window.CalpinageDP2Behavior.init(canvasEl, adapter, toolbar, dp2Options);
              if (typeof console !== "undefined" && console.log) {
                console.log("[Calpinage DP2] Init OK (adapter) ??? toolbar:", toolbar.id || toolbar.className, "currentTool:", window.CALPINAGE_DP2_STATE.currentTool);
              }
            }
          }
          if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
        });
      })();

      (function initBackToRoofButton() {
        var btn = container.querySelector("#btn-back-roof");
        if (!btn) return;
        var doBackToRoof = function () {
          CALPINAGE_STATE.phase = 2;
          CALPINAGE_STATE.currentPhase = "ROOF_EDIT";
          CALPINAGE_STATE.roofSurveyLocked = false;
          CALPINAGE_STATE.validatedRoofData = null;
          CALPINAGE_STATE.placedPanels = [];
          window.PV_RULES_INITIALIZED = false;
          var engReset = (window.pvPlacementEngine && window.pvPlacementEngine.reset) || (window.ActivePlacementBlock && window.ActivePlacementBlock.reset);
          if (typeof engReset === "function") {
            engReset();
          }
          window.CALPINAGE_ALLOWED = false;
          updatePhaseUI();
          saveCalpinageState();
          if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
        };
        addSafeListener(btn, "click", function () {
          if (typeof window.requestCalpinageConfirm !== "function") {
            if (typeof console !== "undefined" && console.error) console.error("[CALPINAGE] ConfirmProvider missing — destructive action blocked");
            return;
          }
          window.requestCalpinageConfirm({
            title: "Quitter la phase implantation ?",
            description: "Les modifications non validées seront perdues.",
            confirmLabel: "Quitter",
            cancelLabel: "Annuler",
            onConfirm: doBackToRoof
          });
        });
      })();

      (function initValidateCalpinageButton() {
        var btn = container.querySelector("#btn-validate-calpinage");
        if (!btn) return;
        addSafeListener(btn, "click", async function () {
          if (devLog) console.log("[CALPINAGE] Valider handler entry");
          var totalPanels = (window.pvPlacementEngine && window.pvPlacementEngine.getAllPanels) ? (window.pvPlacementEngine.getAllPanels() || []).length : 0;
          var hasPanel = !!(window.PV_SELECTED_PANEL && window.PV_SELECTED_PANEL.id) || !!(window.CALPINAGE_SELECTED_PANEL_ID);
          var hasInverter = !!(window.PV_SELECTED_INVERTER && window.PV_SELECTED_INVERTER.id) || !!(window.CALPINAGE_SELECTED_INVERTER_ID);
          if (!hasPanel) {
            if (typeof window.calpinageToast !== "undefined" && window.calpinageToast.error) {
              window.calpinageToast.error("S\u00E9lectionnez un module photovolta\u00EFque avant de valider.");
            } else if (typeof console !== "undefined") console.warn("[CALPINAGE]", "S\u00E9lectionnez un module photovolta\u00EFque avant de valider.");
            return;
          }
          if (!hasInverter) {
            if (typeof window.calpinageToast !== "undefined" && window.calpinageToast.error) {
              window.calpinageToast.error("S\u00E9lectionnez un onduleur avant de valider.");
            } else if (typeof console !== "undefined") console.warn("[CALPINAGE]", "S\u00E9lectionnez un onduleur avant de valider.");
            return;
          }
          if (totalPanels <= 0) {
            if (typeof window.calpinageToast !== "undefined" && window.calpinageToast.error) {
              window.calpinageToast.error("Posez au moins un panneau avant de valider le calpinage.");
            } else if (typeof console !== "undefined") console.warn("[CALPINAGE]", "Posez au moins un panneau avant de valider le calpinage.");
            return;
          }
          try {
            // DEV: Forcer une erreur pour tester l'affichage (activer via window.CALPINAGE_DEV_FORCE_ERROR = true)
            if (window.CALPINAGE_DEV_FORCE_ERROR) {
              throw new Error("Erreur de test (DEV_FORCE_ERROR)");
            }
            // === OMBRAGE — calcul au moment de la validation calpinage ===
            try {
              if (window.loadCalpinageHorizonMask) {
                window.loadCalpinageHorizonMask();
              }

              if (
                window.CALPINAGE_STATE &&
                window.CALPINAGE_STATE.roof &&
                !window.CALPINAGE_STATE.roof.gps &&
                window.CALPINAGE_STATE.roof.map &&
                window.CALPINAGE_STATE.roof.map.centerLatLng
              ) {
                window.CALPINAGE_STATE.roof.gps = {
                  lat: window.CALPINAGE_STATE.roof.map.centerLatLng.lat,
                  lon: window.CALPINAGE_STATE.roof.map.centerLatLng.lng
                };
              }

              if (window.computeCalpinageShading) {
                const res = window.computeCalpinageShading();
                if (res && window.normalizeCalpinageShading) {
                  window.normalizeCalpinageShading();
                }
              }
            } catch (e) {
              console.warn("Shading computation failed during calpinage validation", e);
            }

            var CALPINAGE_STATE = window.CALPINAGE_STATE;
            if (CALPINAGE_STATE) {
              CALPINAGE_STATE.calpinageValidated = true;
              CALPINAGE_STATE.calpinageValidatedAt = Date.now();
            }
            /* Chemin CRM unique : onValidate défini → return immédiatement, pas de legacy (saveCalpinageState, fetch, solarnext_token, smartpitch_last_result). */
            if (typeof options.onValidate === "function") {
              var data = getCalpinageExportDataForCRM();
              if (devLog) {
                try {
                  var geomSize = (data && data.geometry_json) ? JSON.stringify(data.geometry_json).length : 0;
                  console.log("[CALPINAGE] Valider: exportData size=" + geomSize + " calling onValidate");
                } catch (stringifyErr) {
                  console.error("STRINGIFY ERROR DETAIL (geometry_json):", stringifyErr);
                  console.log("OBJECT STRUCTURE (data.geometry_json):", data && data.geometry_json);
                }
              }
              options.onValidate(data);
              if (devLog) console.log("[CALPINAGE] Valider: onValidate returned");
              return; /* CRM : sortie immédiate, pas de POST legacy */
            }
            var raw = localStorage.getItem("smartpitch_last_result");
            if (raw) {
              var resultData = JSON.parse(raw);
              resultData.shading = (CALPINAGE_STATE && CALPINAGE_STATE.shading && CALPINAGE_STATE.shading.normalized) ? CALPINAGE_STATE.shading.normalized : null;
              resultData.calpinage = {
                validated: true,
                validatedAt: (CALPINAGE_STATE && CALPINAGE_STATE.calpinageValidatedAt) ? CALPINAGE_STATE.calpinageValidatedAt : Date.now(),
                panelCount: (window.pvPlacementEngine && window.pvPlacementEngine.getAllPanels) ? ((window.pvPlacementEngine.getAllPanels() || []).length) : 0,
                panelSpec: (window.PV_SELECTED_PANEL) ? window.PV_SELECTED_PANEL : null
              };
              try {
                var resultJson = JSON.stringify(resultData);
                localStorage.setItem("smartpitch_last_result", resultJson);
              } catch (e) {
                console.error("STRINGIFY ERROR DETAIL:", e);
                console.log("OBJECT STRUCTURE:", resultData);
                debugStringifyError(resultData, "resultData");
              }
            }
            /* CP-2 — Sauvegarde API si studyId/versionId présents */
            if (typeof saveCalpinageState === "function") saveCalpinageState();
            var studyId = window.CALPINAGE_STUDY_ID;
            var versionId = window.CALPINAGE_VERSION_ID;
            if (studyId && versionId) {
              try {
                var geoRaw = getCalpinageItem("state", studyId, versionId);
                var geometryJson = geoRaw ? JSON.parse(geoRaw) : null;
                if (geometryJson) {
                  var panelCount = (window.pvPlacementEngine && window.pvPlacementEngine.getAllPanels) ? (window.pvPlacementEngine.getAllPanels() || []).length : 0;
                  var shadingLossPct = (CALPINAGE_STATE && CALPINAGE_STATE.shading && CALPINAGE_STATE.shading.normalized && typeof CALPINAGE_STATE.shading.normalized.totalLossPct === "number") ? CALPINAGE_STATE.shading.normalized.totalLossPct : 0;
                  var panelWp = (window.PV_SELECTED_PANEL && window.PV_SELECTED_PANEL.powerWc) ? window.PV_SELECTED_PANEL.powerWc : 485;
                  var totalPowerKwc = panelCount > 0 ? (panelCount * panelWp) / 1000 : null;
                  var gps = (CALPINAGE_STATE && CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.gps) ? CALPINAGE_STATE.roof.gps : null;
                  var apiBase = (window.location && window.location.origin) || "";
                  var token = localStorage.getItem("solarnext_token");
                  var headers = { "Content-Type": "application/json" };
                  if (token) headers["Authorization"] = "Bearer " + token;
                  var body = {
                    geometry_json: geometryJson,
                    total_panels: panelCount,
                    total_power_kwc: totalPowerKwc,
                    annual_production_kwh: null,
                    total_loss_pct: shadingLossPct
                  };
                  var bodyJson;
                  try {
                    bodyJson = JSON.stringify(body);
                  } catch (e) {
                    console.error("STRINGIFY ERROR DETAIL (body):", e);
                    console.log("OBJECT STRUCTURE:", body);
                    debugStringifyError(body, "body");
                    throw e;
                  }
                  var res = await fetch(apiBase + "/api/studies/" + encodeURIComponent(studyId) + "/versions/" + encodeURIComponent(versionId) + "/calpinage", {
                    method: "POST",
                    headers: headers,
                    body: bodyJson
                  });
                  if (res.ok) {
                    console.log("[CALPINAGE] Sauvegarde API OK");
                  } else {
                    var errJson = await res.json().catch(function() { return {}; });
                    console.warn("[CALPINAGE] Sauvegarde API échouée:", errJson.error || res.status);
                  }
                }
              } catch (e) {
                console.warn("[CALPINAGE] Sauvegarde API erreur:", e);
              }
            }
          } catch (err) {
            console.error("[CALPINAGE] Erreur validation calpinage", err);
            try {
              if (typeof window.calpinageToast !== "undefined" && window.calpinageToast.error) {
                window.calpinageToast.error("Erreur lors de la validation du calpinage. Consultez la console pour plus de d\u00E9tails.");
              } else if (typeof window.showToast === "function") {
                window.showToast("Erreur validation calpinage", false);
              } else if (typeof console !== "undefined") {
                console.warn("[CALPINAGE]", "Erreur lors de la validation du calpinage.");
              }
            } catch (e) {
              if (typeof console !== "undefined") console.warn("[CALPINAGE]", "Erreur lors de la validation du calpinage.");
            }
          }
        });
      })();

      /* ========== Menu Phase 3 ??? Implantation des modules (UI ??? PV_LAYOUT_RULES) ========== */
      (function initPhase3LayoutMenu() {
        var rules = window.PV_LAYOUT_RULES;
        if (!rules) return;
        var portraitBtn = container.querySelector("#pv-layout-orient-portrait");
        var paysageBtn = container.querySelector("#pv-layout-orient-paysage");
        var marginInput = container.querySelector("#pv-layout-margin-cm");
        var spacingXInput = container.querySelector("#pv-layout-spacing-x-cm");
        var spacingYInput = container.querySelector("#pv-layout-spacing-y-cm");
        var panelSelect = container.querySelector("#pv-panel-select");
        var panelHint = container.querySelector("#pv-panel-select-hint");
        var inverterSelectCentral = container.querySelector("#pv-inverter-select-central");
        var inverterSelectMicro = container.querySelector("#pv-inverter-select-micro");

        function buildInverterOptionLabel(inv) {
          var brand = (inv.brand || "").trim();
          var name = (inv.name || inv.model_ref || "").trim() || inv.id;
          var type = (inv.inverter_type || "").toLowerCase();
          var typeLabel = type === "micro" ? "micro" : type === "string" ? "string" : type || "";
          return brand ? (brand + " \u2014 " + name + (typeLabel ? " (" + typeLabel + ")" : "")) : (name + (typeLabel ? " (" + typeLabel + ")" : ""));
        }

        function refreshInverterSelect() {
          var list = getInverterList();
          var centralList = list.filter(function (i) { return (i.inverter_family || "CENTRAL") === "CENTRAL"; });
          var microList = list.filter(function (i) { return (i.inverter_family || "CENTRAL") === "MICRO"; });
          var selectedId = (window.PV_SELECTED_INVERTER && window.PV_SELECTED_INVERTER.id) ? window.PV_SELECTED_INVERTER.id : (window.CALPINAGE_SELECTED_INVERTER_ID || "");
          var selectedFamily = (window.PV_SELECTED_INVERTER && window.PV_SELECTED_INVERTER.inverter_family) ? window.PV_SELECTED_INVERTER.inverter_family : (findInverterById(selectedId) && findInverterById(selectedId).inverter_family) || "CENTRAL";
          if (inverterSelectCentral) {
            inverterSelectCentral.innerHTML = "";
            var opt0c = document.createElement("option");
            opt0c.value = "";
            opt0c.textContent = "\u2014 Choisir un onduleur central \u2014";
            inverterSelectCentral.appendChild(opt0c);
            for (var i = 0; i < centralList.length; i++) {
              var inv = centralList[i];
              var opt = document.createElement("option");
              opt.value = inv.id;
              opt.textContent = buildInverterOptionLabel(inv);
              inverterSelectCentral.appendChild(opt);
            }
            inverterSelectCentral.value = selectedFamily === "CENTRAL" ? selectedId : "";
          }
          if (inverterSelectMicro) {
            inverterSelectMicro.innerHTML = "";
            var opt0m = document.createElement("option");
            opt0m.value = "";
            opt0m.textContent = "\u2014 Choisir un micro-onduleur \u2014";
            inverterSelectMicro.appendChild(opt0m);
            for (var j = 0; j < microList.length; j++) {
              var invM = microList[j];
              var optM = document.createElement("option");
              optM.value = invM.id;
              optM.textContent = buildInverterOptionLabel(invM);
              inverterSelectMicro.appendChild(optM);
            }
            inverterSelectMicro.value = selectedFamily === "MICRO" ? selectedId : "";
          }
          renderInverterCards(centralList, microList, selectedId, selectedFamily);
          updateInvertersRequired();
          updateCalpinageValidateButton();
        }

        function renderInverterCards(centralList, microList, selectedId, selectedFamily) {
          var cardsCentral = container.querySelector("#pv-inverter-cards-central");
          var cardsMicro = container.querySelector("#pv-inverter-cards-micro");
          if (!cardsCentral || !cardsMicro) return;
          function buildCard(inv, isActive) {
            var name = (inv.name || inv.model_ref || "").trim() || inv.id;
            var brand = (inv.brand || "").trim();
            var acKw = inv.nominal_power_kw != null ? Number(inv.nominal_power_kw) : (inv.nominal_va != null ? Number(inv.nominal_va) / 1000 : null);
            var acStr = acKw != null && !Number.isNaN(acKw) ? acKw + " kW AC" : "";
            var typeLabel = (inv.inverter_type || "").toLowerCase() === "micro" ? "Micro" : "Central";
            var meta = [acStr, typeLabel].filter(Boolean).join(" · ");
            var div = document.createElement("div");
            div.className = "p3-product-card" + (isActive ? " p3-card-active" : "");
            div.setAttribute("data-inverter-id", inv.id);
            div.setAttribute("role", "option");
            div.setAttribute("aria-selected", isActive ? "true" : "false");
            div.innerHTML = "<div class=\"p3-product-card-img\" aria-hidden=\"true\">&#9881;</div><div class=\"p3-product-card-name\">" + (brand ? brand + " — " : "") + (name || inv.id) + "</div><div class=\"p3-product-card-meta\">" + meta + "</div>";
            return div;
          }
          cardsCentral.innerHTML = "";
          for (var i = 0; i < centralList.length; i++) {
            var inv = centralList[i];
            cardsCentral.appendChild(buildCard(inv, selectedFamily === "CENTRAL" && inv.id === selectedId));
          }
          cardsMicro.innerHTML = "";
          for (var j = 0; j < microList.length; j++) {
            var invM = microList[j];
            cardsMicro.appendChild(buildCard(invM, selectedFamily === "MICRO" && invM.id === selectedId));
          }
        }

        function applyInverterSelection(id) {
          var inv = findInverterById(id);
          window.PV_SELECTED_INVERTER = inv || null;
          window.CALPINAGE_SELECTED_INVERTER_ID = id || null;
          savePvParams();
          refreshInverterSelect();
          if (typeof saveCalpinageState === "function") saveCalpinageState();
          if (typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
        }

        function onInverterCentralChange() {
          var id = inverterSelectCentral ? inverterSelectCentral.value : "";
          if (id && inverterSelectMicro) inverterSelectMicro.value = "";
          applyInverterSelection(id);
        }

        function onInverterMicroChange() {
          var id = inverterSelectMicro ? inverterSelectMicro.value : "";
          if (id && inverterSelectCentral) inverterSelectCentral.value = "";
          applyInverterSelection(id);
        }

        function refreshPanelSelect() {
          if (!panelSelect) return;
          var list = getPanelList();
          var selectedId = (window.PV_SELECTED_PANEL && window.PV_SELECTED_PANEL.id) ? window.PV_SELECTED_PANEL.id : (window.CALPINAGE_SELECTED_PANEL_ID || "");
          panelSelect.innerHTML = "";
          var opt0 = document.createElement("option");
          opt0.value = "";
          opt0.textContent = "\u2014 Choisir un panneau \u2014";
          panelSelect.appendChild(opt0);
          for (var i = 0; i < list.length; i++) {
            var p = list[i];
            var brand = (p.brand || "").trim();
            var name = (p.name || p.model_ref || "").trim() || p.id;
            var powerWc = (p.power_wc != null && p.power_wc !== "") ? (Number(p.power_wc) || p.power_wc) : "";
            var label = brand ? (brand + " \u2014 " + name + (powerWc ? " " + powerWc + "W" : "")) : (name + (powerWc ? " " + powerWc + "W" : ""));
            var opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = label;
            panelSelect.appendChild(opt);
          }
          panelSelect.value = selectedId;
          renderPanelCards(list, selectedId);
          if (panelHint) {
            if (!window.PV_SELECTED_PANEL) panelHint.textContent = "S\u00E9lectionnez un panneau pour poser des modules.";
            else panelHint.textContent = "";
          }
          updatePowerSummary();
          updateCalpinageValidateButton();
        }

        function renderPanelCards(list, selectedId) {
          var cardsEl = container.querySelector("#pv-panel-cards");
          if (!cardsEl) return;
          cardsEl.innerHTML = "";
          for (var i = 0; i < list.length; i++) {
            var p = list[i];
            var brand = (p.brand || "").trim();
            var name = (p.name || p.model_ref || "").trim() || p.id;
            var powerWc = (p.power_wc != null && p.power_wc !== "") ? (Number(p.power_wc) || p.power_wc) : "";
            var isActive = p.id === selectedId;
            var div = document.createElement("div");
            div.className = "p3-product-card" + (isActive ? " p3-card-active" : "");
            div.setAttribute("data-panel-id", p.id);
            div.setAttribute("role", "option");
            div.setAttribute("aria-selected", isActive ? "true" : "false");
            div.innerHTML = "<div class=\"p3-product-card-img\" aria-hidden=\"true\">&#9728;</div><div class=\"p3-product-card-name\">" + (brand ? brand + " — " : "") + (name || p.id) + "</div><div class=\"p3-product-card-meta\">" + (powerWc ? powerWc + " Wc" : "") + "</div>";
            cardsEl.appendChild(div);
          }
        }

        function onPanelSelectChange() {
          var id = panelSelect ? panelSelect.value : "";
          var spec = findPanelById(id);
          window.PV_SELECTED_PANEL = spec ? buildPVSelectedPanel(spec) : null;
          window.CALPINAGE_SELECTED_PANEL_ID = id || null;
          if (CALPINAGE_STATE.placedPanels && CALPINAGE_STATE.placedPanels.length > 0) {
            CALPINAGE_STATE.placedPanels = [];
            if (typeof saveCalpinageState === "function") saveCalpinageState();
          }
          savePvParams();
          refreshPanelSelect();
          updatePowerSummary();
          updateCalpinageValidateButton();
          if (typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
        }

        function syncUI() {
          var orient = (rules.orientation || "portrait").toString().toLowerCase();
          var ENG = window.pvPlacementEngine;
          var focusBlock = (ENG && typeof ENG.getFocusBlock === "function") ? ENG.getFocusBlock() : null;
          if (focusBlock && (focusBlock.orientation === "PORTRAIT" || focusBlock.orientation === "PAYSAGE" || focusBlock.orientation === "landscape" || focusBlock.orientation === "portrait")) orient = (focusBlock.orientation === "PAYSAGE" || focusBlock.orientation === "landscape") ? "landscape" : "portrait";
          if (portraitBtn) portraitBtn.setAttribute("aria-pressed", orient === "portrait" ? "true" : "false");
          if (paysageBtn) paysageBtn.setAttribute("aria-pressed", orient === "landscape" || orient === "paysage" ? "true" : "false");
          if (marginInput) marginInput.value = String(rules.marginOuterCm);
          if (spacingXInput) spacingXInput.value = String(rules.spacingXcm);
          if (spacingYInput) spacingYInput.value = String(rules.spacingYcm);
          var labelSpacingY = container.querySelector("label[for=\"pv-layout-spacing-y-cm\"]");
          if (labelSpacingY) {
            labelSpacingY.title = (orient === "landscape" || orient === "paysage")
              ? "Espacement entre rangées — Paysage : rangées = axe largeur"
              : "Espacement entre rangées — Portrait : rangées = axe hauteur";
          }
          refreshPanelSelect();
          refreshInverterSelect();
          if (typeof window.syncP3Topbar === "function") window.syncP3Topbar();
        }
        window.syncPhase3LayoutUI = syncUI;
        if (panelSelect) addSafeListener(panelSelect, "change", onPanelSelectChange);
        if (inverterSelectCentral) addSafeListener(inverterSelectCentral, "change", onInverterCentralChange);
        if (inverterSelectMicro) addSafeListener(inverterSelectMicro, "change", onInverterMicroChange);
        var panelCards = container.querySelector("#pv-panel-cards");
        var inverterCardsCentral = container.querySelector("#pv-inverter-cards-central");
        var inverterCardsMicro = container.querySelector("#pv-inverter-cards-micro");
        if (panelCards) addSafeListener(panelCards, "click", function (e) {
          var card = e.target && e.target.closest && e.target.closest("[data-panel-id]");
          if (card && panelSelect) {
            var id = card.getAttribute("data-panel-id");
            panelSelect.value = id || "";
            panelSelect.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
        if (inverterCardsCentral) addSafeListener(inverterCardsCentral, "click", function (e) {
          var card = e.target && e.target.closest && e.target.closest("[data-inverter-id]");
          if (card && inverterSelectCentral) {
            var id = card.getAttribute("data-inverter-id");
            inverterSelectCentral.value = id || "";
            inverterSelectCentral.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
        if (inverterCardsMicro) addSafeListener(inverterCardsMicro, "click", function (e) {
          var card = e.target && e.target.closest && e.target.closest("[data-inverter-id]");
          if (card && inverterSelectMicro) {
            var id = card.getAttribute("data-inverter-id");
            inverterSelectMicro.value = id || "";
            inverterSelectMicro.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
        function onOrientationChange(newOrientation) {
          var ENG = window.pvPlacementEngine;
          var focusBlock = (ENG && typeof ENG.getFocusBlock === "function") ? ENG.getFocusBlock() : null;
          var focusBlockOrientBefore = focusBlock ? focusBlock.orientation : null;
          /* Étape A — Toujours mettre à jour la règle globale (pose future) */
          rules.orientation = (newOrientation === "landscape" || newOrientation === "PAYSAGE") ? "landscape" : "portrait";
          savePvParams();
          if (focusBlock) {
            /* CAS 1 : focusBlock existe — modifier UNIQUEMENT ce bloc */
            var engineOrient = (newOrientation === "landscape" || newOrientation === "PAYSAGE") ? "PAYSAGE" : "PORTRAIT";
            var rotationBaseDeg = 0;
            focusBlock.orientation = engineOrient;
            focusBlock.rotationBaseDeg = rotationBaseDeg;
            var pivotPanelId = (CALPINAGE_STATE.selectedPlacedPanelId && CALPINAGE_STATE.selectedPlacedBlockId === focusBlock.id) ? CALPINAGE_STATE.selectedPlacedPanelId : null;
            recomputeActiveBlockProjectionsAndGhosts(pivotPanelId);
            if (window.DEBUG_ORIENTATION_TOGGLE && typeof getProjectionContextForBlock === "function") {
              var ctxDbg = getProjectionContextForBlock(focusBlock);
              var ghosts = (ENG.computeExpansionGhosts && typeof ENG.computeExpansionGhosts === "function") ? (ENG.computeExpansionGhosts(focusBlock, function () { return getProjectionContextForBlock(focusBlock); }) || []) : [];
              var firstProj = focusBlock.panels && focusBlock.panels[0] && focusBlock.panels[0].projection;
              var stepAlong = firstProj && typeof firstProj.halfLengthAlongSlopePx === "number" ? firstProj.halfLengthAlongSlopePx * 2 : null;
              var stepPerp = firstProj && typeof firstProj.halfLengthPerpPx === "number" ? firstProj.halfLengthPerpPx * 2 : null;
              console.log("[DEBUG_ORIENTATION_TOGGLE]", { blockOrientation: focusBlock.orientation, pvRulesSpacing: ctxDbg && ctxDbg.pvRules ? { spacingXcm: ctxDbg.pvRules.spacingXcm, spacingYcm: ctxDbg.pvRules.spacingYcm } : null, ghostsCount: ghosts.length, stepAlongPx: stepAlong, stepPerpPx: stepPerp });
            }
          } else {
            /* CAS 2 : aucun focusBlock — ne pas toucher aux blocs, uniquement sync UI */
          }
          if (typeof window !== "undefined" && window.__PV_AUDIT__ === true) {
            console.log("[PV_AUDIT][TOGGLE]", newOrientation, rules.orientation, !!focusBlock, focusBlock ? focusBlock.id : null, "orientBefore:" + focusBlockOrientBefore, "orientAfter:" + (focusBlock ? focusBlock.orientation : null), "frozenBlocksLoopExecuted:false");
          }
          if (typeof window.syncP3Topbar === "function") window.syncP3Topbar();
          syncUI();
          if (typeof pvSyncSaveRender === "function") pvSyncSaveRender(); else if (typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
          if (typeof window.notifyPhase3SidebarUpdate === "function") window.notifyPhase3SidebarUpdate();
        }
        if (portraitBtn) addSafeListener(portraitBtn, "click", function () { onOrientationChange("portrait"); });
        if (paysageBtn) addSafeListener(paysageBtn, "click", function () { onOrientationChange("landscape"); });
        window.setPvOrientation = onOrientationChange;
        function bindNumberInput(id, key, minVal) {
          var el = container.querySelector("#" + id);
          if (!el) return;
          addSafeListener(el, "change", function () {
            var n = parseInt(el.value, 10);
            if (!Number.isFinite(n) || n < minVal) n = minVal;
            rules[key] = n;
            el.value = String(n);
            savePvParams();
            recomputeAllPlacementBlocksFromRules();
            if (typeof window.syncP3Topbar === "function") window.syncP3Topbar();
            if (typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
          });
        }
        bindNumberInput("pv-layout-margin-cm", "marginOuterCm", 0);
        bindNumberInput("pv-layout-spacing-x-cm", "spacingXcm", 0);
        bindNumberInput("pv-layout-spacing-y-cm", "spacingYcm", 0);
        syncUI();
      })();

      /* ========== P3 Topbar — Barre horizontale Phase 3 (au-dessus du plan) ========== */
      (function initP3Topbar() {
        var rules = window.PV_LAYOUT_RULES;
        if (!rules) return;
        var topbar = container.querySelector("#p3-topbar");
        if (!topbar) return;
        var marginInput = container.querySelector("#pv-layout-margin-cm");
        var spacingXInput = container.querySelector("#pv-layout-spacing-x-cm");
        var spacingYInput = container.querySelector("#pv-layout-spacing-y-cm");
        var panelSelect = container.querySelector("#pv-panel-select");
        var inverterSelectCentral = container.querySelector("#pv-inverter-select-central");
        var inverterSelectMicro = container.querySelector("#pv-inverter-select-micro");
        var btnOpenSettings = container.querySelector("#btn-open-calpinage-settings");

        function syncP3Topbar() {
          var vSpacingX = container.querySelector("#p3-pill-spacing-x-value");
          var vSpacingY = container.querySelector("#p3-pill-spacing-y-value");
          var vMargin = container.querySelector("#p3-pill-margin-value");
          var vModule = container.querySelector("#p3-pill-module-value");
          var vMicro = container.querySelector("#p3-pill-micro-value");
          var vCentral = container.querySelector("#p3-pill-central-value");
          var pillSpacingY = container.querySelector("#p3-pill-spacing-y");
          if (vSpacingX) vSpacingX.textContent = String(rules.spacingXcm || 2);
          if (vSpacingY) vSpacingY.textContent = String(rules.spacingYcm || 4.5);
          if (pillSpacingY) {
            var orient = (rules.orientation || "portrait").toString().toLowerCase();
            pillSpacingY.title = orient === "landscape" || orient === "paysage"
              ? "Espacement entre rangées (cm) — Paysage : rangées = axe largeur"
              : "Espacement entre rangées (cm) — Portrait : rangées = axe hauteur";
          }
          if (vMargin) vMargin.textContent = String(rules.marginOuterCm || 20);
          if (vModule && panelSelect) {
            var opt = panelSelect.options[panelSelect.selectedIndex];
            vModule.textContent = opt && opt.value ? (opt.textContent || "Choisir…") : "Choisir…";
          }
          if (vMicro && inverterSelectMicro) {
            var optM = inverterSelectMicro.options[inverterSelectMicro.selectedIndex];
            vMicro.textContent = optM && optM.value ? (optM.textContent || "Choisir…") : "Choisir…";
          }
          if (vCentral && inverterSelectCentral) {
            var optC = inverterSelectCentral.options[inverterSelectCentral.selectedIndex];
            vCentral.textContent = optC && optC.value ? (optC.textContent || "Choisir…") : "Choisir…";
          }
        }
        window.syncP3Topbar = syncP3Topbar;

        function closeAllTechPopovers() {
          topbar.querySelectorAll(".p3-tech-popover.is-open").forEach(function (p) {
            p.classList.remove("is-open");
            p.setAttribute("aria-hidden", "true");
          });
        }

        var techMap = {
          "spacing-x": { inputId: "p3-popover-spacing-x-input", targetId: "pv-layout-spacing-x-cm", key: "spacingXcm", min: 0 },
          "spacing-y": { inputId: "p3-popover-spacing-y-input", targetId: "pv-layout-spacing-y-cm", key: "spacingYcm", min: 0 },
          "margin": { inputId: "p3-popover-margin-input", targetId: "pv-layout-margin-cm", key: "marginOuterCm", min: 0 }
        };

        ["spacing-x", "spacing-y", "margin"].forEach(function (tech) {
          var pill = container.querySelector("#p3-pill-" + (tech === "spacing-x" ? "spacing-x" : tech === "spacing-y" ? "spacing-y" : "margin"));
          var popover = container.querySelector("#p3-popover-" + (tech === "spacing-x" ? "spacing-x" : tech === "spacing-y" ? "spacing-y" : "margin"));
          var applyBtn = popover && popover.querySelector(".p3-popover-apply[data-tech=\"" + tech + "\"]");
          var targetEl = container.querySelector("#" + techMap[tech].targetId);
          if (!pill || !popover || !applyBtn || !targetEl) return;
          addSafeListener(pill, "click", function (e) {
            e.stopPropagation();
            var isOpen = popover.classList.contains("is-open");
            closeAllTechPopovers();
            if (!isOpen) {
              var val = rules[techMap[tech].key];
              var fallback = tech === "margin" ? 20 : tech === "spacing-x" ? 2 : 4.5;
              popover.querySelector("input").value = String(Number.isFinite(val) ? val : fallback);
              popover.classList.add("is-open");
              popover.setAttribute("aria-hidden", "false");
            }
          });
          addSafeListener(applyBtn, "click", function () {
            var inp = popover.querySelector("input");
            var n = parseInt(inp.value, 10);
            if (!Number.isFinite(n) || n < techMap[tech].min) n = techMap[tech].min;
            targetEl.value = String(n);
            targetEl.dispatchEvent(new Event("change", { bubbles: true }));
            closeAllTechPopovers();
          });
        });

        addSafeListener(container, "click", function (e) {
          if (!topbar.contains(e.target)) closeAllTechPopovers();
        });

        ["panel", "micro", "central"].forEach(function (product) {
          var pill = container.querySelector("#p3-pill-" + (product === "panel" ? "module" : product === "micro" ? "micro" : "central"));
          if (!pill) return;
          addSafeListener(pill, "click", function () {
            if (typeof window.openCatalogOverlay === "function") {
              window.openCatalogOverlay(product);
            } else if (btnOpenSettings) {
              btnOpenSettings.click();
              var productScrollMap = { panel: "pv-panel-selection-block", micro: "pv-inverter-micro-block", central: "pv-inverter-central-block" };
              setTimeout(function () {
                var section = container.querySelector("#" + productScrollMap[product]);
                if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
              }, 150);
            }
          });
        });

        syncP3Topbar();
      })();

      /* ========== R?gles d'implantation PV (Phase 3) ??? BLOQUANTES ==========
       * Utilis?es avant toute pose : si invalide, le panneau n'est pas pos?. Aucun repositionnement automatique.
       */
      (function initPlacementRules() {
        function cmToPx(cm, mpp) {
          if (!Number.isFinite(mpp) || mpp <= 0) return cm;
          return (cm / 100) / mpp;
        }
        function distPointToSegment(px, py, ax, ay, bx, by) {
          var abx = bx - ax, aby = by - ay;
          var apx = px - ax, apy = py - ay;
          var t = (apx * abx + apy * aby) / (abx * abx + aby * aby + 1e-20);
          t = Math.max(0, Math.min(1, t));
          var qx = ax + t * abx, qy = ay + t * aby;
          return Math.hypot(px - qx, py - qy);
        }
        function distPointToPolygon(px, py, polygon) {
          if (!polygon || polygon.length < 2) return Infinity;
          var d = Infinity;
          for (var i = 0, n = polygon.length; i < n; i++) {
            var j = (i + 1) % n;
            var segD = distPointToSegment(px, py, polygon[i].x, polygon[i].y, polygon[j].x, polygon[j].y);
            if (segD < d) d = segD;
          }
          return d;
        }
        /**
         * Distance minimale entre les sommets d'un ensemble de points et le contour d'un polygone (segments).
         * Utilis? pour la validation marge : panneau projet? (points) vs contour du pan.
         * @param {Array<{x: number, y: number}>} points - sommets du panneau projet? (panel.projection.points)
         * @param {Array<{x: number, y: number}>} polygon - contour du pan (ou obstacle)
         * @returns {number} distance minimale en px image
         */
        function minDistancePointsToPolygon(points, polygon) {
          if (!points || points.length === 0 || !polygon || polygon.length < 2) return Infinity;
          var d = Infinity;
          for (var i = 0; i < points.length; i++) {
            var pd = distPointToPolygon(points[i].x, points[i].y, polygon);
            if (pd < d) d = pd;
          }
          return d;
        }
        /**
         * Distance minimale entre deux polygones (sommet A ??? segments B, sommet B ??? segments A).
         * Utilis? pour la validation espacement entre panneaux projet?s.
         * @param {Array<{x: number, y: number}>} polyA - points du panneau A (projection.points)
         * @param {Array<{x: number, y: number}>} polyB - points du panneau B
         * @returns {number} distance minimale en px image
         */
        function minDistanceBetweenPolygons(polyA, polyB) {
          if (!polyA || polyA.length === 0 || !polyB || polyB.length < 2) return Infinity;
          var d = Infinity;
          for (var i = 0; i < polyA.length; i++) {
            var pd = distPointToPolygon(polyA[i].x, polyA[i].y, polyB);
            if (pd < d) d = pd;
          }
          for (var j = 0; j < polyB.length; j++) {
            var pd = distPointToPolygon(polyB[j].x, polyB[j].y, polyA);
            if (pd < d) d = pd;
          }
          return d;
        }
        /**
         * Valide la pose d?un panneau. R?gles BLOQUANTES.
         * @param {string} panId - id du pan (validatedRoofData.pans)
         * @param {number} centerX - centre en image (x)
         * @param {number} centerY - centre en image (y)
         * @param {number} widthPx - largeur panneau en px (signature conserv?e ; forme r?elle via computeProjectedPanelRect)
         * @param {number} heightPx - hauteur panneau en px (idem)
         * @returns {{ allowed: boolean, reason?: string }}
         */
        function validatePlacement(panId, centerX, centerY, widthPx, heightPx) {
          var data = CALPINAGE_STATE.validatedRoofData;
          var rules = window.PV_LAYOUT_RULES;
          if (!data || !data.pans) return { allowed: false, reason: "Données toiture manquantes." };
          if (!rules) return { allowed: false, reason: "Règles d'implantation PV manquantes." };
          var mpp = (data.scale && data.scale.metersPerPixel) || 1;
          var pan = data.pans.filter(function (p) { return p.id === panId; })[0];
          if (!pan || !pan.polygon || pan.polygon.length < 3) return { allowed: false, reason: "Pan invalide ou inconnu." };
          var ENG = window.pvPlacementEngine;
          var activeBlock = ENG && typeof ENG.getActiveBlock === "function" ? ENG.getActiveBlock() : null;
          var ctx = (activeBlock && activeBlock.panId === panId && typeof getProjectionContextForBlock === "function")
            ? getProjectionContextForBlock(activeBlock)
            : (typeof getProjectionContextForPan === "function" ? getProjectionContextForPan(panId) : null);
          var effRules = ctx && ctx.pvRules ? ctx.pvRules : null;
          if (!ctx || !ctx.roofParams || !ctx.panelParams) return { allowed: false, reason: "Contexte de projection indisponible." };
          if (!effRules) return { allowed: false, reason: "Règles d'espacement indisponibles pour le contexte." };
          var espHpx = cmToPx(effRules.spacingXcm || 0, mpp);
          var espVpx = cmToPx(effRules.spacingYcm || 0, mpp);
          var spacingRequiredPx = Math.max(espHpx, espVpx);
          var computeProjectedPanelRect = (typeof window !== "undefined" && window.computeProjectedPanelRect) || (typeof global !== "undefined" && global.computeProjectedPanelRect);
          if (typeof computeProjectedPanelRect !== "function") return { allowed: false, reason: "Calcul de projection indisponible." };
          var projOpt = { panelWidthMm: ctx.panelParams.panelWidthMm, panelHeightMm: ctx.panelParams.panelHeightMm, panelOrientation: ctx.panelParams.panelOrientation, roofSlopeDeg: ctx.roofParams.roofSlopeDeg, roofOrientationDeg: ctx.roofParams.roofOrientationDeg != null ? ctx.roofParams.roofOrientationDeg : 0, metersPerPixel: ctx.roofParams.metersPerPixel };
          if (ctx.roofParams.trueSlopeAxis && ctx.roofParams.truePerpAxis) { projOpt.trueSlopeAxis = ctx.roofParams.trueSlopeAxis; projOpt.truePerpAxis = ctx.roofParams.truePerpAxis; }
          if (typeof ctx.panelParams.localRotationDeg === "number") { projOpt.localRotationDeg = ctx.panelParams.localRotationDeg; }
          var proj;
          try {
            proj = computeProjectedPanelRect({ center: { x: centerX, y: centerY }, panelWidthMm: projOpt.panelWidthMm, panelHeightMm: projOpt.panelHeightMm, panelOrientation: projOpt.panelOrientation, roofSlopeDeg: projOpt.roofSlopeDeg, roofOrientationDeg: projOpt.roofOrientationDeg, metersPerPixel: projOpt.metersPerPixel, trueSlopeAxis: projOpt.trueSlopeAxis, truePerpAxis: projOpt.truePerpAxis, localRotationDeg: projOpt.localRotationDeg });
          } catch (e) {
            return { allowed: false, reason: "Erreur lors du calcul de la forme projet\u00E9e." };
          }
          if (!proj || !proj.points || proj.points.length < 4) return { allowed: false, reason: "Forme projet\u00E9e du panneau invalide." };
          var obstacles = CALPINAGE_STATE.obstacles || [];
          var obstacleIds = pan.obstacleIds || [];
          for (var oi = 0; oi < obstacleIds.length; oi++) {
            var obs = obstacles.filter(function (o) { return o.id === obstacleIds[oi]; })[0];
            if (!obs) continue;
            var ox = obs.x != null ? obs.x : (obs.points && obs.points.length ? obs.points.reduce(function (s, p) { return s + p.x; }, 0) / obs.points.length : 0);
            var oy = obs.y != null ? obs.y : (obs.points && obs.points.length ? obs.points.reduce(function (s, p) { return s + p.y; }, 0) / obs.points.length : 0);
            var ow = (obs.points && obs.points.length) ? Math.max.apply(null, obs.points.map(function (p) { return Math.abs(p.x - ox); })) * 2 || 10 : (obs.w || obs.r || 10);
            var oh = (obs.points && obs.points.length) ? Math.max.apply(null, obs.points.map(function (p) { return Math.abs(p.y - oy); })) * 2 || 10 : (obs.h || obs.r || 10);
            var obsPolygon = (obs.points && obs.points.length >= 3) ? obs.points : [{ x: ox - ow / 2, y: oy - oh / 2 }, { x: ox + ow / 2, y: oy - oh / 2 }, { x: ox + ow / 2, y: oy + oh / 2 }, { x: ox - ow / 2, y: oy + oh / 2 }];
            if (minDistanceBetweenPolygons(proj.points, obsPolygon) < 1e-6) return { allowed: false, reason: "Chevauchement avec un obstacle." };
          }
          var placed = CALPINAGE_STATE.placedPanels || [];
          for (var pi = 0; pi < placed.length; pi++) {
            var p = placed[pi];
            if (p.panId !== panId) continue;
            var otherProj;
            try {
              otherProj = computeProjectedPanelRect({ center: { x: p.x, y: p.y }, panelWidthMm: projOpt.panelWidthMm, panelHeightMm: projOpt.panelHeightMm, panelOrientation: projOpt.panelOrientation, roofSlopeDeg: projOpt.roofSlopeDeg, roofOrientationDeg: projOpt.roofOrientationDeg, metersPerPixel: projOpt.metersPerPixel, trueSlopeAxis: projOpt.trueSlopeAxis, truePerpAxis: projOpt.truePerpAxis, localRotationDeg: projOpt.localRotationDeg });
            } catch (e) {
              return { allowed: false, reason: "Impossible de calculer la forme d'un panneau existant." };
            }
            if (!otherProj || !otherProj.points || otherProj.points.length < 4) return { allowed: false, reason: "Forme d'un panneau existant invalide." };
            if (minDistanceBetweenPolygons(proj.points, otherProj.points) < spacingRequiredPx) return { allowed: false, reason: "Espacement insuffisant avec un panneau existant." };
          }
          return { allowed: true };
        }
        /**
         * Valide un panneau ? un centre donn? en utilisant UNIQUEMENT computeProjectedPanelRect pour la forme.
         * Utilis? pendant la manipulation du bloc (validation panneau par panneau).
         * @param {string} panId - id du pan
         * @param {number} centerX - centre en image (x)
         * @param {number} centerY - centre en image (y)
         * @param {Array<{ x: number, y: number, widthPx: number, heightPx: number }>} existingRects - autres panneaux (frozen + autres du bloc) pour espacement
         * @returns {boolean}
         */
        function validatePanelAtCenterForBlock(panId, centerX, centerY, existingRects) {
          if (!existingRects || !Array.isArray(existingRects)) {
            existingRects = [];
          }
          var data = CALPINAGE_STATE.validatedRoofData;
          var rules = window.PV_LAYOUT_RULES;
          if (!data || !data.pans || !rules) {
            if (typeof window !== "undefined") window.PV_LAYOUT_LAST_VALIDATION_REASON = "Données toiture ou règles manquantes.";
            return false;
          }
          var ENG = window.pvPlacementEngine;
          var block = ENG && ((typeof ENG.getFocusBlock === "function" && ENG.getFocusBlock()) || (typeof ENG.getActiveBlock === "function" && ENG.getActiveBlock()));
          var ctx = (block && block.panId === panId && typeof getProjectionContextForBlock === "function")
            ? getProjectionContextForBlock(block)
            : (typeof getProjectionContextForPan === "function" ? getProjectionContextForPan(panId) : null);
          if (!ctx || !ctx.roofParams || !ctx.panelParams) {
            if (typeof window !== "undefined") window.PV_LAYOUT_LAST_VALIDATION_REASON = "Contexte de projection incomplet.";
            return false;
          }
          var mpp = ctx.roofParams.metersPerPixel;
          if (typeof mpp !== "number" || !Number.isFinite(mpp) || mpp <= 0) {
            if (typeof window !== "undefined") window.PV_LAYOUT_LAST_VALIDATION_REASON = "\u00C9chelle (m/px) indisponible \u2014 recharge la vue ou refais la capture.";
            return false;
          }
          var computeProjectedPanelRect = (typeof window !== "undefined" && window.computeProjectedPanelRect) || (typeof global !== "undefined" && global.computeProjectedPanelRect);
          if (typeof computeProjectedPanelRect !== "function") {
            if (typeof window !== "undefined") window.PV_LAYOUT_LAST_VALIDATION_REASON = "Calcul de projection indisponible.";
            return false;
          }
          var projOpt = { panelWidthMm: ctx.panelParams.panelWidthMm, panelHeightMm: ctx.panelParams.panelHeightMm, panelOrientation: ctx.panelParams.panelOrientation, roofSlopeDeg: ctx.roofParams.roofSlopeDeg, roofOrientationDeg: ctx.roofParams.roofOrientationDeg != null ? ctx.roofParams.roofOrientationDeg : 0, metersPerPixel: ctx.roofParams.metersPerPixel };
          if (ctx.roofParams.trueSlopeAxis && ctx.roofParams.truePerpAxis) { projOpt.trueSlopeAxis = ctx.roofParams.trueSlopeAxis; projOpt.truePerpAxis = ctx.roofParams.truePerpAxis; }
          if (typeof ctx.panelParams.localRotationDeg === "number") { projOpt.localRotationDeg = ctx.panelParams.localRotationDeg; }
          var proj;
          try {
            proj = computeProjectedPanelRect({ center: { x: centerX, y: centerY }, panelWidthMm: projOpt.panelWidthMm, panelHeightMm: projOpt.panelHeightMm, panelOrientation: projOpt.panelOrientation, roofSlopeDeg: projOpt.roofSlopeDeg, roofOrientationDeg: projOpt.roofOrientationDeg, metersPerPixel: projOpt.metersPerPixel, trueSlopeAxis: projOpt.trueSlopeAxis, truePerpAxis: projOpt.truePerpAxis, localRotationDeg: projOpt.localRotationDeg });
          } catch (e) {
            if (typeof window !== "undefined") window.PV_LAYOUT_LAST_VALIDATION_REASON = "Erreur lors du calcul de la forme projet\u00E9e.";
            return false;
          }
          if (!proj || !proj.points || proj.points.length < 4) {
            if (typeof window !== "undefined") window.PV_LAYOUT_LAST_VALIDATION_REASON = "Forme projet\u00E9e du panneau invalide.";
            return false;
          }
          var effRules = ctx.pvRules;
          if (!effRules) {
            if (typeof window !== "undefined") window.PV_LAYOUT_LAST_VALIDATION_REASON = "Règles d'espacement indisponibles pour le contexte.";
            return false;
          }
          var espHpx = (Number.isFinite(effRules.spacingXcm) && mpp > 0) ? (effRules.spacingXcm / 100) / mpp : 0;
          var espVpx = (Number.isFinite(effRules.spacingYcm) && mpp > 0) ? (effRules.spacingYcm / 100) / mpp : 0;
          var spacingRequiredPx = Math.max(espHpx, espVpx);
          var pan = data.pans.filter(function (p) { return p.id === panId; })[0];
          if (!pan || !pan.polygon || pan.polygon.length < 3) {
            if (typeof window !== "undefined") window.PV_LAYOUT_LAST_VALIDATION_REASON = "Pan invalide ou inconnu.";
            return false;
          }
          var obstacleIds = pan.obstacleIds || [];
          var obstacles = CALPINAGE_STATE.obstacles || [];
          for (var oi = 0; oi < obstacleIds.length; oi++) {
            var obs = obstacles.filter(function (o) { return o.id === obstacleIds[oi]; })[0];
            if (!obs) continue;
            var ox = obs.x != null ? obs.x : (obs.points && obs.points.length ? obs.points.reduce(function (s, p) { return s + p.x; }, 0) / obs.points.length : 0);
            var oy = obs.y != null ? obs.y : (obs.points && obs.points.length ? obs.points.reduce(function (s, p) { return s + p.y; }, 0) / obs.points.length : 0);
            var ow = (obs.points && obs.points.length) ? Math.max.apply(null, obs.points.map(function (p) { return Math.abs(p.x - ox); })) * 2 || 10 : (obs.w || obs.r || 10);
            var oh = (obs.points && obs.points.length) ? Math.max.apply(null, obs.points.map(function (p) { return Math.abs(p.y - oy); })) * 2 || 10 : (obs.h || obs.r || 10);
            var obsPolygon = (obs.points && obs.points.length >= 3) ? obs.points : [{ x: ox - ow / 2, y: oy - oh / 2 }, { x: ox + ow / 2, y: oy - oh / 2 }, { x: ox + ow / 2, y: oy + oh / 2 }, { x: ox - ow / 2, y: oy + oh / 2 }];
            if (minDistanceBetweenPolygons(proj.points, obsPolygon) < 1e-6) {
              if (typeof window !== "undefined") window.PV_LAYOUT_LAST_VALIDATION_REASON = "Chevauchement avec un obstacle.";
              return false;
            }
          }
          var ridgeSegs = (ctx.roofConstraints && ctx.roofConstraints.ridgeSegments) || [];
          var traitSegs = (ctx.roofConstraints && ctx.roofConstraints.traitSegments) || [];
          var forbiddenSegs = ridgeSegs.concat(traitSegs);
          for (var fs = 0; fs < forbiddenSegs.length; fs++) {
            var seg = forbiddenSegs[fs];
            if (!seg || (Array.isArray(seg) ? seg.length < 2 : !seg.start || !seg.end)) continue;
            var s0 = Array.isArray(seg) ? seg[0] : seg.start;
            var s1 = Array.isArray(seg) ? seg[1] : seg.end;
            var dSeg = Infinity;
            for (var rpi = 0; rpi < proj.points.length; rpi++) {
              var dp = distPointToSegment(proj.points[rpi].x, proj.points[rpi].y, s0.x, s0.y, s1.x, s1.y);
              if (dp < dSeg) dSeg = dp;
            }
            if (dSeg < 1e-6) {
              if (typeof window !== "undefined") window.PV_LAYOUT_LAST_VALIDATION_REASON = "Chevauchement avec un trait ou le fa\u00EEtage.";
              return false;
            }
          }
          for (var ri = 0; ri < existingRects.length; ri++) {
            var r = existingRects[ri];
            if (!r || typeof r.x !== "number" || typeof r.y !== "number") continue;
            var rProj;
            try {
              rProj = computeProjectedPanelRect({ center: { x: r.x, y: r.y }, panelWidthMm: projOpt.panelWidthMm, panelHeightMm: projOpt.panelHeightMm, panelOrientation: projOpt.panelOrientation, roofSlopeDeg: projOpt.roofSlopeDeg, roofOrientationDeg: projOpt.roofOrientationDeg, metersPerPixel: projOpt.metersPerPixel, trueSlopeAxis: projOpt.trueSlopeAxis, truePerpAxis: projOpt.truePerpAxis, localRotationDeg: projOpt.localRotationDeg });
            } catch (e) {
              if (typeof window !== "undefined") window.PV_LAYOUT_LAST_VALIDATION_REASON = "Erreur calcul panneau existant.";
              return false;
            }
            if (!rProj || !rProj.points || rProj.points.length < 4) {
              if (typeof window !== "undefined") window.PV_LAYOUT_LAST_VALIDATION_REASON = "Forme d'un panneau existant invalide.";
              return false;
            }
            if (minDistanceBetweenPolygons(proj.points, rProj.points) < spacingRequiredPx) {
              if (typeof window !== "undefined") window.PV_LAYOUT_LAST_VALIDATION_REASON = "Espacement inter-panneaux insuffisant.";
              return false;
            }
          }
          return true;
        }
        function getPanelDimensions(orientationOverride) {
          var spec = window.PV_SELECTED_PANEL;
          var orientation = (orientationOverride != null && orientationOverride !== "")
            ? String(orientationOverride).toLowerCase()
            : ((window.PV_LAYOUT_RULES && window.PV_LAYOUT_RULES.orientation) ? String(window.PV_LAYOUT_RULES.orientation).toLowerCase() : "portrait");
          if (orientation === "paysage") orientation = "landscape";
          if (!spec || spec.widthM == null || spec.heightM == null) return null;
          if (orientation === "landscape") {
            return { widthM: spec.heightM, heightM: spec.widthM };
          }
          return { widthM: spec.widthM, heightM: spec.heightM };
        }
        /**
         * Pr?paration pose par clic : ? appeler depuis le gestionnaire de clic canvas en Phase 3.
         * Chaque clic tentera de poser un panneau ; le moteur v?rifie distances, orientation, pan actif.
         * Si invalide, le panneau n?est pas pos? (aucune exception manuelle).
         */
        function tryPlacePanelAtPoint(imgPt) {
          if (!CALPINAGE_STATE.validatedRoofData || !CALPINAGE_STATE.roofSurveyLocked) return { placed: false, reason: "Relev? non valid?." };
          if (!window.PV_SELECTED_PANEL) return { placed: false, reason: "Veuillez s\u00E9lectionner un panneau" };
          var activePanId = (typeof CalpinagePans !== "undefined" && CalpinagePans.panState) ? CalpinagePans.panState.activePanId : (CALPINAGE_STATE.selectedPanId || (CALPINAGE_STATE.validatedRoofData.pans[0] && CALPINAGE_STATE.validatedRoofData.pans[0].id));
          if (!activePanId) return { placed: false, reason: "Aucun pan actif." };
          var mpp = (CALPINAGE_STATE.validatedRoofData.scale && CALPINAGE_STATE.validatedRoofData.scale.metersPerPixel) || 1;
          var dims = getPanelDimensions();
          if (!dims || !Number.isFinite(dims.widthM) || !Number.isFinite(dims.heightM) || dims.widthM <= 0 || dims.heightM <= 0) return { placed: false, reason: "Dimensions du panneau s\u00E9lectionn\u00E9 invalides." };
          var wPx = dims.widthM / mpp;
          var hPx = dims.heightM / mpp;
          var result = validatePlacement(activePanId, imgPt.x, imgPt.y, wPx, hPx);
          if (!result.allowed) return { placed: false, reason: result.reason };
          return { placed: true, panId: activePanId, x: imgPt.x, y: imgPt.y, widthPx: wPx, heightPx: hPx };
        }
        window.CALPINAGE_PLACEMENT_RULES = {
          validatePlacement: validatePlacement,
          tryPlacePanelAtPoint: tryPlacePanelAtPoint,
          validatePanelAtCenterForBlock: validatePanelAtCenterForBlock,
          getPanelDimensions: getPanelDimensions,
        };
        window.getPanelDimensions = getPanelDimensions;
      })();

      /** Message d'erreur contextuel Phase 3 (refus placement). Discret, non bloquant, ~800 ms puis fade out. Pas de spam si m??me message d?j? visible. */
      (function initPvLayoutError() {
        var timeoutId = null;
        var currentMessage = "";
        window.showPvLayoutError = function (message) {
          var text = (message && String(message).trim()) || "Placement impossible";
          var el = container.querySelector("#pv-layout-error");
          if (!el) return;
          if (el.textContent === text && el.classList.contains("visible")) return;
          if (timeoutId) clearTimeout(timeoutId);
          currentMessage = text;
          el.textContent = text;
          el.style.display = "block";
          el.classList.add("visible");
          timeoutId = setTimeout(function () {
            el.classList.remove("visible");
            timeoutId = setTimeout(function () {
              el.style.display = "none";
              el.textContent = "";
              currentMessage = "";
              timeoutId = null;
            }, 120);
          }, 800);
        };
      })();

     function updateStateUI() {
        var captured = !!(CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.image && CALPINAGE_STATE.roof.image.dataUrl);
        if (stateCaptureText) {
          stateCaptureText.textContent = captured ? "Capture : effectuée" : "Capture : non effectuée";
        }
        if (zoneB) {
          zoneB.classList.toggle("capture-done", captured);
        }
        var stepsEl = container.querySelector("#phase2-steps");
        if (stepsEl) stepsEl.style.display = captured ? "" : "none";
        if (typeof updatePhase2StepsUI === "function") updatePhase2StepsUI();
        if (typeof window.notifyPhase2SidebarUpdate === "function") window.notifyPhase2SidebarUpdate();
}

      updateStateUI();

      /* Barre d?outils Phase 2 : un seul outil actif ? la fois ; Contour b??ti = crosshair, autres d?sactiv?s */
      (function initToolbar() {
        var toolbar = container.querySelector("#zone-b-toolbar");
        if (!toolbar) return;
        var buttons = toolbar.querySelectorAll(".calpinage-tool-btn:not(#calpinage-tool-obstacle):not(#calpinage-btn-height-edit):not(#calpinage-tool-dessin-toiture):not(#calpinage-tool-roof-extension)");
        var obstacleBtn = container.querySelector("#calpinage-tool-obstacle");
        var heightEditBtn = container.querySelector("#calpinage-btn-height-edit");
        var obstacleDropdown = container.querySelector("#calpinage-obstacle-dropdown");
        var dessinToitureTrigger = container.querySelector("#calpinage-tool-dessin-toiture");
        var dessinToitureDropdown = container.querySelector("#calpinage-dessin-toiture-dropdown");
        var ACTIVE = "calpinage-tool-active";
        var DESSIN_TOOLS = ["contour", "trait", "ridge"];
        function updateCursor() {
          if (!canvasEl) return;
          var t = drawState.activeTool;
          if (t === "heightEdit") { canvasEl.style.cursor = "pointer"; return; }
          var isCrosshair = t === "contour" || t === "mesure" || t === "trait" || t === "ridge" || t === "obstacle";
          canvasEl.style.cursor = isCrosshair ? "crosshair" : "default";
        }
        function updateToolbarActiveUI(toolName) {
          var isHeightEdit = toolName === "heightEdit";
          buttons.forEach(function (b) {
            var dataTool = b.getAttribute("data-tool");
            var isActive = !isHeightEdit && dataTool && dataTool === toolName;
            b.setAttribute("aria-pressed", isActive ? "true" : "false");
            b.classList.toggle(ACTIVE, isActive);
          });
          if (dessinToitureTrigger) {
            var dessinActive = !isHeightEdit && DESSIN_TOOLS.indexOf(toolName) >= 0;
            dessinToitureTrigger.setAttribute("aria-pressed", dessinActive ? "true" : "false");
            dessinToitureTrigger.classList.toggle(ACTIVE, dessinActive);
          }
          if (dessinToitureDropdown) {
            dessinToitureDropdown.querySelectorAll(".calpinage-tool-dessin-option").forEach(function (opt) {
              var optTool = opt.getAttribute("data-tool");
              opt.classList.toggle(ACTIVE, !isHeightEdit && optTool === toolName);
              opt.setAttribute("aria-pressed", (!isHeightEdit && optTool === toolName) ? "true" : "false");
            });
          }
          if (obstacleBtn) {
            obstacleBtn.setAttribute("aria-pressed", (!isHeightEdit && toolName === "obstacle") ? "true" : "false");
            obstacleBtn.classList.toggle(ACTIVE, !isHeightEdit && toolName === "obstacle");
          }
          if (heightEditBtn) {
            heightEditBtn.setAttribute("aria-pressed", isHeightEdit ? "true" : "false");
            heightEditBtn.classList.toggle(ACTIVE, isHeightEdit);
          }
        }
        /** Exclusivité stricte : désactive TOUS les autres outils, cleanup, installe le nouvel outil. */
        function activateTool(toolName) {
          if (!toolName) toolName = "contour";
          if (typeof devLog !== "undefined" && devLog) console.log("[activateTool]", toolName);
          var prevHeightEdit = CALPINAGE_STATE.heightEditMode;
          var prevTool = drawState.activeTool;
          if (prevHeightEdit && toolName !== "heightEdit") {
            exitHeightEdit(true);
          }
          if (toolName === "heightEdit") {
            CALPINAGE_STATE.heightEditMode = true;
            drawState.activeTool = "heightEdit";
            drawState.selectedContourIndex = null;
            drawState.selectedRidgeIndex = null;
            drawState.selectedTraitIndex = null;
            drawState.selectedObstacleIndex = null;
            drawState.selectedContourIds = [];
            drawState.selectedRidgeIds = [];
            drawState.selectedTraitIds = [];
            /* Ne pas appeler initHeights() : les hauteurs utilisateur ne doivent jamais être écrasées à l'entrée dans le mode. */
            computePansFromGeometry();
            ensurePanPointsWithHeights();
            if (window.CalpinagePans && CalpinagePans.recomputeAllPanPhysicalProps && CALPINAGE_STATE.pans.length) {
              CalpinagePans.recomputeAllPanPhysicalProps(CALPINAGE_STATE.pans, getStateForPans());
            }
            updatePansListUI();
            CALPINAGE_STATE.selectedHeightPoint = null;
            CALPINAGE_STATE.selectedHeightPoints = [];
          } else {
            drawState.activeTool = toolName;
            if (toolName !== "select") drawState.selectedRoofExtensionIndex = null;
            if (toolName !== "contour" && toolName !== "obstacle") {
              drawState.selectedObstacleIndex = null;
              drawState.draggingObstacleOffset = null;
              drawState.draggingObstacleHandle = null;
              drawState.resizeObstacleStart = null;
              if (CALPINAGE_STATE.activeObstacle) CALPINAGE_STATE.activeObstacle.points = [];
            }
          }
          updateToolbarActiveUI(toolName);
          updateCursor();
          if (typeof window.notifyPhase2SidebarUpdate === "function") window.notifyPhase2SidebarUpdate();
        }
        function applyTool(toolName) {
          activateTool(toolName);
        }
        var roofExtensionDropdown = container.querySelector("#calpinage-roof-extension-dropdown");
        function setActive(btn) {
          if (obstacleDropdown) obstacleDropdown.hidden = true;
          if (dessinToitureDropdown) dessinToitureDropdown.hidden = true;
          if (roofExtensionDropdown) roofExtensionDropdown.hidden = true;
          var nextTool = btn ? (btn.getAttribute("data-tool") || "contour") : "contour";
          applyTool(nextTool);
        }
        function setObstacleActive(shape) {
          if (CALPINAGE_STATE.heightEditMode) exitHeightEdit(true);
          drawState.activeTool = "obstacle";
          drawState.obstacleShape = shape;
          if (shape !== "polygon" && CALPINAGE_STATE.activeObstacle) CALPINAGE_STATE.activeObstacle.points = [];
          if (dessinToitureDropdown) dessinToitureDropdown.hidden = true;
          updateToolbarActiveUI("obstacle");
          updateCursor();
          if (typeof window.notifyPhase2SidebarUpdate === "function") window.notifyPhase2SidebarUpdate();
        }
        window.getPhase2ActiveTool = function () {
          return drawState.activeTool || "select";
        };
        buttons.forEach(function (btn) {
          addSafeListener(btn, "click", function () {
            if (obstacleDropdown) obstacleDropdown.hidden = true;
            if (dessinToitureDropdown) dessinToitureDropdown.hidden = true;
            if (roofExtensionDropdown) roofExtensionDropdown.hidden = true;
            setActive(btn);
          });
        });
        if (dessinToitureTrigger && dessinToitureDropdown) {
          addSafeListener(dessinToitureTrigger, "click", function (e) {
            e.stopPropagation();
            if (obstacleDropdown) obstacleDropdown.hidden = true;
            if (roofExtensionDropdown) roofExtensionDropdown.hidden = true;
            dessinToitureDropdown.hidden = !dessinToitureDropdown.hidden;
          });
          dessinToitureDropdown.querySelectorAll(".calpinage-tool-dessin-option").forEach(function (opt) {
            addSafeListener(opt, "click", function (e) {
              e.stopPropagation();
              var tool = opt.getAttribute("data-tool");
              if (tool) applyTool(tool);
              dessinToitureDropdown.hidden = true;
            });
          });
        }
        if (heightEditBtn) {
          addSafeListener(heightEditBtn, "click", function () {
            if (obstacleDropdown) obstacleDropdown.hidden = true;
            if (dessinToitureDropdown) dessinToitureDropdown.hidden = true;
            if (roofExtensionDropdown) roofExtensionDropdown.hidden = true;
            if (CALPINAGE_STATE.heightEditMode) {
              exitHeightEdit(true);
              updateToolbarActiveUI(drawState.activeTool || "select");
              updateCursor();
            } else {
              activateTool("heightEdit");
            }
            if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
          });
        }
        if (obstacleBtn && obstacleDropdown) {
          addSafeListener(obstacleBtn, "click", function (e) {
            e.stopPropagation();
            if (dessinToitureDropdown) dessinToitureDropdown.hidden = true;
            var svDrop = container.querySelector("#calpinage-shadow-volume-dropdown");
            if (svDrop) svDrop.hidden = true;
            if (roofExtensionDropdown) roofExtensionDropdown.hidden = true;
            obstacleDropdown.hidden = !obstacleDropdown.hidden;
          });
          obstacleDropdown.querySelectorAll(".calpinage-tool-obstacle-option").forEach(function (opt) {
            addSafeListener(opt, "click", function (e) {
              e.stopPropagation();
              var shape = opt.getAttribute("data-obstacle-shape");
              if (shape) setObstacleActive(shape);
              obstacleDropdown.hidden = true;
            });
          });
        }
        var shadowVolumeBtn = container.querySelector("#calpinage-tool-shadow-volume");
        var shadowVolumeDropdown = container.querySelector("#calpinage-shadow-volume-dropdown");
        if (shadowVolumeBtn && shadowVolumeDropdown) {
          addSafeListener(shadowVolumeBtn, "click", function (e) {
            e.stopPropagation();
            if (obstacleDropdown) obstacleDropdown.hidden = true;
            if (dessinToitureDropdown) dessinToitureDropdown.hidden = true;
            if (roofExtensionDropdown) roofExtensionDropdown.hidden = true;
            shadowVolumeDropdown.hidden = !shadowVolumeDropdown.hidden;
          });
          shadowVolumeDropdown.querySelectorAll(".calpinage-tool-obstacle-option").forEach(function (opt) {
            addSafeListener(opt, "click", function (e) {
              e.stopPropagation();
              var shape = opt.getAttribute("data-shadow-shape");
              if (shape === "cube" || shape === "tube") {
                window.CALPINAGE_MODE = "CREATE_SHADOW_VOLUME";
                drawState.shadowVolumeCreateShape = shape;
                shadowVolumeDropdown.hidden = true;
                if (canvasEl) canvasEl.style.cursor = "crosshair";
                if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
              }
            });
          });
        }
        var roofExtensionBtn = container.querySelector("#calpinage-tool-roof-extension");
        if (roofExtensionBtn && roofExtensionDropdown) {
          addSafeListener(roofExtensionBtn, "click", function (e) {
            e.stopPropagation();
            if (obstacleDropdown) obstacleDropdown.hidden = true;
            if (dessinToitureDropdown) dessinToitureDropdown.hidden = true;
            if (shadowVolumeDropdown) shadowVolumeDropdown.hidden = true;
            roofExtensionDropdown.hidden = !roofExtensionDropdown.hidden;
          });
          roofExtensionDropdown.querySelectorAll("[data-dormer-tool]").forEach(function (opt) {
            addSafeListener(opt, "click", function (e) {
              e.stopPropagation();
              var tool = opt.getAttribute("data-dormer-tool");
              if (!tool) return;
              var target = getDormerEditTarget();
              var targetIdx = drawState.dormerEditRxIndex != null ? drawState.dormerEditRxIndex : drawState.selectedRoofExtensionIndex;
              if (tool === "contour") {
                drawState.dormerDraft = createRoofExtensionDormerDraft("dormer", { x: 0, y: 0 });
                drawState.dormerEditRxIndex = null;
                window.CALPINAGE_MODE = MODE_DORMER_CONTOUR;
                drawState.dormerActiveTool = "contour";
              } else if (tool === "hips") {
                if (target && target.contour && target.contour.closed && target.contour.points && target.contour.points.length >= 3) {
                  drawState.dormerEditRxIndex = targetIdx;
                  drawState.dormerDraft = null;
                  target.hips = target.hips || { left: null, right: null };
                  window.CALPINAGE_MODE = MODE_DORMER_HIPS;
                  drawState.dormerActiveTool = "hips";
                } else {
                  if (typeof window.calpinageToast !== "undefined" && window.calpinageToast.warning) {
                    window.calpinageToast.warning("Veuillez d'abord tracer et fermer le contour du chien assis, puis le s\u00E9lectionner.");
                  } else if (typeof console !== "undefined") console.warn("[CALPINAGE]", "Veuillez d'abord tracer et fermer le contour du chien assis.");
                  return;
                }
              } else if (tool === "ridge") {
                if (target && target.contour && target.contour.closed && target.hips && target.hips.left && target.hips.right && target.hips.left.b && target.hips.right.b) {
                  drawState.dormerEditRxIndex = targetIdx;
                  drawState.dormerDraft = null;
                  var ridgeOrigin = intersectLines(
                    target.hips.left.b, target.hips.left.a,
                    target.hips.right.b, target.hips.right.a
                  );
                  if (!ridgeOrigin) {
                    if (typeof window.calpinageToast !== "undefined" && window.calpinageToast.error) {
                      window.calpinageToast.error("Impossible de calculer la jonction des ar\u00EAtiers.");
                    } else if (typeof console !== "undefined") console.warn("[CALPINAGE]", "Impossible de calculer la jonction des ar\u00EAtiers.");
                    return;
                  }
                  target.ridgeOrigin = ridgeOrigin;
                  target.ridge = { a: { x: ridgeOrigin.x, y: ridgeOrigin.y }, b: null };
                  window.CALPINAGE_MODE = MODE_DORMER_RIDGE;
                  drawState.dormerActiveTool = "ridge";
                } else {
                  if (typeof window.calpinageToast !== "undefined" && window.calpinageToast.warning) {
                    window.calpinageToast.warning("Contour ferm\u00E9 et 2 ar\u00EAtiers requis. S\u00E9lectionnez un chien assis avec ar\u00EAtiers pos\u00E9s.");
                  } else if (typeof console !== "undefined") console.warn("[CALPINAGE]", "Contour ferm\u00E9 et 2 ar\u00EAtiers requis.");
                  return;
                }
              }
              roofExtensionDropdown.hidden = true;
              if (canvasEl) canvasEl.style.cursor = "crosshair";
              if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
            });
          });
        }
        var btnDelete = toolbar.querySelector(".calpinage-btn-delete");
        var onDeleteClick = function () {
          if (deleteCurrentSelection) deleteCurrentSelection();
        };
        if (btnDelete) addSafeListener(btnDelete, "click", onDeleteClick);
        addSafeListener(container, "click", function () {
          if (obstacleDropdown) obstacleDropdown.hidden = true;
          if (dessinToitureDropdown) dessinToitureDropdown.hidden = true;
          if (shadowVolumeDropdown) shadowVolumeDropdown.hidden = true;
          if (roofExtensionDropdown) roofExtensionDropdown.hidden = true;
        });
        var firstBtn = buttons[0];
        if (firstBtn) applyTool(firstBtn.getAttribute("data-tool") || "contour"); else applyTool("contour");
      })();

      (function initPhase3Toolbar() {
        var ph3Toolbar = container.querySelector("#pv-layout-dp2-toolbar");
        if (!ph3Toolbar) return;
        var btnPanels = container.querySelector("#pv-tool-panels");
        var btnSelect = container.querySelector("#pv-tool-select");
        var ACTIVE = "calpinage-tool-active";
        function syncPhase3ToolbarActiveTool() {
          var t = (drawState.activeTool === "panels" || drawState.activeTool === "select") ? drawState.activeTool : "panels";
          window.CALPINAGE_INTERACTION_MODE = (t === "select") ? "SELECT" : "CALPINAGE";
          if (btnPanels) {
            btnPanels.classList.toggle(ACTIVE, t === "panels");
            btnPanels.setAttribute("aria-pressed", t === "panels" ? "true" : "false");
          }
          if (btnSelect) {
            btnSelect.classList.toggle(ACTIVE, t === "select");
            btnSelect.setAttribute("aria-pressed", t === "select" ? "true" : "false");
          }
        }
        window.syncPhase3ToolbarActiveTool = syncPhase3ToolbarActiveTool;
        window.getPhase3ActiveTool = function () {
          return (drawState.activeTool === "panels" || drawState.activeTool === "select") ? drawState.activeTool : "panels";
        };
        if (btnPanels) {
          addSafeListener(btnPanels, "click", function () {
            drawState.activeTool = "panels";
            window.CALPINAGE_INTERACTION_MODE = "CALPINAGE";
            syncPhase3ToolbarActiveTool();
            if (typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
            if (typeof window.notifyPhase3SidebarUpdate === "function") window.notifyPhase3SidebarUpdate();
          });
        }
        if (btnSelect) {
          addSafeListener(btnSelect, "click", function () {
            drawState.activeTool = "select";
            window.CALPINAGE_INTERACTION_MODE = "SELECT";
            syncPhase3ToolbarActiveTool();
            if (typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
            if (typeof window.notifyPhase3SidebarUpdate === "function") window.notifyPhase3SidebarUpdate();
          });
        }
      })();

      var waitForGoogleMapsIntervalId = null;
      function waitForGoogleMaps(cb) {
        if (typeof window !== "undefined" && window.__CALPINAGE_GOOGLE_READY__) {
          cb();
          return;
        }
        var deadline = Date.now() + 5000;
        waitForGoogleMapsIntervalId = setInterval(function () {
          if (typeof window !== "undefined" && window.__CALPINAGE_GOOGLE_READY__) {
            clearInterval(waitForGoogleMapsIntervalId);
            waitForGoogleMapsIntervalId = null;
            cb();
            return;
          }
          if (Date.now() >= deadline) {
            clearInterval(waitForGoogleMapsIntervalId);
            waitForGoogleMapsIntervalId = null;
            if (typeof console !== "undefined" && console.error) console.error("[CALPINAGE] Google Maps failed to initialize");
            cb();
          }
        }, 50);
      }
      cleanupTasks.push(function () {
        if (waitForGoogleMapsIntervalId != null) {
          clearInterval(waitForGoogleMapsIntervalId);
          waitForGoogleMapsIntervalId = null;
        }
      });

      /** Reset strict état capture au cleanup : remet la map visible, supprime l'image figée, réinitialise les flags.
       * Idempotent : peut être appelé 2 fois sans erreur. Le capture mode ne doit jamais persister entre ouvertures. */
      cleanupTasks.push(function () {
        try {
          if (typeof window !== "undefined" && window.CALPINAGE_STATE && window.CALPINAGE_STATE.roof) {
            window.CALPINAGE_STATE.roof.image = null;
          }
          delete window.calpinageViewRotation;
          if (mapContainer && mapContainer.isConnected) {
            mapContainer.classList.remove("hidden");
          }
          if (canvasWrapper && canvasWrapper.isConnected) {
            canvasWrapper.classList.remove("visible");
          }
          if (zoneB && zoneB.isConnected) {
            zoneB.classList.remove("capture-done");
          }
          if (stateCaptureText && stateCaptureText.isConnected) {
            stateCaptureText.textContent = "Capture : non effectuée";
          }
        } catch (e) {
          if (typeof console !== "undefined" && console.warn) console.warn("[CALPINAGE] cleanup reset capture", e);
        }
      });

      function showMap() {
        mapContainer.classList.remove("hidden");
        canvasWrapper.classList.remove("visible");
        delete window.calpinageViewRotation;
      }

      function showCanvas() {
        mapContainer.classList.add("hidden");
        canvasWrapper.classList.add("visible");
        var north = CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.roof && CALPINAGE_STATE.roof.roof.north;
        window.calpinageViewRotation = (north && typeof north.angleDeg === "number") ? north.angleDeg : 0;
      }

      /**
       * ??chelle DP4 : m??me formule que le module DP4 (Web Mercator, zoom + latitude).
       * Ne pas modifier sans alignement avec frontend/dp-tool/dp-app.js.
       */
      function metersPerPixelDP4(lat, zoom) {
        if (typeof lat !== "number" || !Number.isFinite(lat) || typeof zoom !== "number" || !Number.isFinite(zoom)) return null;
        return (INITIAL_RES * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
      }

      function onCapture() {
        if (!mapApi) return Promise.reject(new Error("Carte non pr\u00EAte"));
        return mapApi.capture().then(function (result) {
          var state = mapApi.getState();
          var centerLatLng = state.centerLatLng;
          var zoom = typeof state.zoom === "number" ? state.zoom : null;
          var bearingDeg = state.bearing != null ? state.bearing : 0;
          var lat = centerLatLng && typeof centerLatLng.lat === "number" ? centerLatLng.lat : null;
          var mpp = metersPerPixelDP4(lat, zoom);

          // console.log("[SCALE DEBUG] capture image size:", result.image.width, result.image.height);
          // console.log("[SCALE DEBUG] metersPerPixel =", mpp, "(from metersPerPixelDP4(lat, zoom), file: calpinage.html, function: onCapture)");

          CALPINAGE_STATE.roof.map = {
            provider: "google",
            centerLatLng: centerLatLng,
            zoom: zoom,
            bearing: bearingDeg,
          };
          CALPINAGE_STATE.roof.image = {
            dataUrl: result.image.dataUrl,
            width: result.image.width,
            height: result.image.height,
            cssWidth: result.image.cssWidth,
            cssHeight: result.image.cssHeight,
          };
          CALPINAGE_STATE.roof.scale = {
            metersPerPixel: (typeof mpp === "number" && mpp > 0) ? mpp : null,
            source: "google-dp4",
          };
          // console.log("[SCALE DEBUG] scale source = CALPINAGE_STATE.roof.scale", { metersPerPixel: CALPINAGE_STATE.roof.scale.metersPerPixel, source: CALPINAGE_STATE.roof.scale.source });
          CALPINAGE_STATE.roof.roof = CALPINAGE_STATE.roof.roof || { north: null };
          CALPINAGE_STATE.roof.roof.north = {
            mode: "auto-google",
            angleDeg: -bearingDeg,
          };

          showCanvas();
          waitForContainerSize(canvasWrapper, startCanvasWithImage);
          updateStateUI();
          saveCalpinageState();
        });
      }

      if (btnCapture) {
        addSafeListener(btnCapture, "click", function () {
          var p = onCapture();
          if (p && typeof p.then === "function") {
            p.catch(function (err) { console.error("[Calpinage] onCapture", err); });
          }
        });
      }

      function startCanvasWithImage() {
        if (currentCanvasEngine) {
          if (typeof window !== "undefined") window.CALPINAGE_RENDER = null;
          if (renderRafId != null && typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(renderRafId);
            renderRafId = null;
          }
          currentCanvasEngine.destroy();
          currentCanvasEngine = null;
        }
        var engine = new CalpinageCanvas.CanvasEngine(canvasEl, canvasWrapper);
        currentCanvasEngine = engine;
        var vp = new CalpinageCanvas.Viewport();
        var imgW = CALPINAGE_STATE.roof.image.width;
        var imgH = CALPINAGE_STATE.roof.image.height;
        vp.scale = Math.min(engine.width / imgW, engine.height / imgH) * 0.9;
        vp.offset.x = engine.width / 2 - (imgW / 2) * vp.scale;
        vp.offset.y = engine.height / 2 + (imgH / 2) * vp.scale;

        var panStart = null;
        var VERTEX_HIT_RADIUS = 8;

        function imageToScreen(imgPt) {
          var world = { x: imgPt.x, y: imgH - imgPt.y };
          return vp.worldToScreen(world);
        }
        function screenToImage(screen) {
          var world = vp.screenToWorld(screen);
          return { x: world.x, y: imgH - world.y };
        }
        window.calpinageScreenToImage = screenToImage;
        function getMouseScreen(e) {
          var rect = canvasEl.getBoundingClientRect();
          return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        }
        function hitVertex(screenPt, contour) {
          if (!contour || !contour.points.length) return -1;
          for (var i = 0; i < contour.points.length; i++) {
            var s = imageToScreen(contour.points[i]);
            if (Math.hypot(s.x - screenPt.x, s.y - screenPt.y) <= VERTEX_HIT_RADIUS) return i;
          }
          return -1;
        }
        /** Hit-test sommet du pan (uniquement pour le pan en ?dition). Retourne { panId, pointIndex } ou null. */
        function hitTestPanVertex(screenPt, pan) {
          if (!pan || !pan.polygon || pan.polygon.length < 2) return null;
          for (var i = 0; i < pan.polygon.length; i++) {
            var pt = pan.polygon[i];
            var s = imageToScreen({ x: pt.x, y: pt.y });
            if (Math.hypot(s.x - screenPt.x, s.y - screenPt.y) <= VERTEX_HIT_RADIUS) return { panId: pan.id, pointIndex: i };
          }
          return null;
        }
        /** Indique si le point (x,y) image est utilis? par un autre pan que celui d?id excludePanId (sommet partag?). */
        function isVertexShared(imgX, imgY, excludePanId) {
          var pans = CALPINAGE_STATE.pans || [];
          var tol = 1; /* pixel image */
          for (var i = 0; i < pans.length; i++) {
            if (pans[i].id === excludePanId || !pans[i].polygon) continue;
            for (var j = 0; j < pans[i].polygon.length; j++) {
              var p = pans[i].polygon[j];
              if (Math.abs(p.x - imgX) < tol && Math.abs(p.y - imgY) < tol) return true;
            }
          }
          return false;
        }
        function distSegmentScreen(screenPt, imgA, imgB) {
          var a = imageToScreen(imgA);
          var b = imageToScreen(imgB);
          var ax = a.x; var ay = a.y;
          var bx = b.x; var by = b.y;
          var px = screenPt.x; var py = screenPt.y;
          var abx = bx - ax; var aby = by - ay;
          var apx = px - ax; var apy = py - ay;
          var t = (apx * abx + apy * aby) / (abx * abx + aby * aby + 1e-10);
          t = Math.max(0, Math.min(1, t));
          var qx = ax + t * abx; var qy = ay + t * aby;
          return Math.hypot(px - qx, py - qy);
        }
        function distancePointToSegment(pt, a, b) {
          var proj = projectPointOnSegment(pt, a, b);
          return Math.hypot(pt.x - proj.x, pt.y - proj.y);
        }
        function hitTestRidge(imgPt, ridge, tolerancePx) {
          tolerancePx = tolerancePx == null ? 8 : tolerancePx;
          var tolImg = Math.max(0.5, tolerancePx / vp.scale);
          return distancePointToSegment(imgPt, ridge.a, ridge.b) < tolImg;
        }
        function hitTestPoint(imgPt, p, tolerancePx) {
          tolerancePx = tolerancePx == null ? 8 : tolerancePx;
          var tolImg = Math.max(0.5, tolerancePx / vp.scale);
          return Math.hypot(imgPt.x - p.x, imgPt.y - p.y) < tolImg;
        }
        function hitContour(screenPt) {
          var list = CALPINAGE_STATE.contours;
          for (var ci = 0; ci < list.length; ci++) {
            var c = list[ci];
            if (!c || !c.points || c.points.length < 2) continue;
            var v = hitVertex(screenPt, c);
            if (v >= 0) return { kind: "contour", contourIndex: ci, vertexIndex: v };
            var pts = c.points;
            for (var i = 0; i < pts.length; i++) {
              var j = (i + 1) % pts.length;
              if (distSegmentScreen(screenPt, pts[i], pts[j]) <= VERTEX_HIT_RADIUS) return { kind: "contour", contourIndex: ci, vertexIndex: null, segmentIndex: i };
            }
          }
          return null;
        }
        function hitMesure(screenPt) {
          for (var i = 0; i < CALPINAGE_STATE.measures.length; i++) {
            var m = CALPINAGE_STATE.measures[i];
            if (!m || !m.a || !m.b) continue;
            if (distSegmentScreen(screenPt, m.a, m.b) <= VERTEX_HIT_RADIUS) return i;
          }
          return -1;
        }
        function hitRidge(screenPt) {
          var list = CALPINAGE_STATE.ridges;
          for (var i = 0; i < list.length; i++) {
            var r = list[i];
            if (!r || !r.a || !r.b) continue;
            var ra = resolveRidgePoint(r.a);
            var rb = resolveRidgePoint(r.b);
            var sa = imageToScreen(ra);
            var sb = imageToScreen(rb);
            if (Math.hypot(screenPt.x - sa.x, screenPt.y - sa.y) <= VERTEX_HIT_RADIUS) return { ridgeIndex: i, pointIndex: 0 };
            if (Math.hypot(screenPt.x - sb.x, screenPt.y - sb.y) <= VERTEX_HIT_RADIUS) return { ridgeIndex: i, pointIndex: 1 };
            if (distSegmentScreen(screenPt, ra, rb) <= VERTEX_HIT_RADIUS) return { ridgeIndex: i, pointIndex: null };
          }
          return null;
        }
        function hitTrait(screenPt) {
          var list = CALPINAGE_STATE.traits || [];
          for (var i = 0; i < list.length; i++) {
            var t = list[i];
            if (!t || !t.a || !t.b) continue;
            var sa = imageToScreen(t.a);
            var sb = imageToScreen(t.b);
            if (Math.hypot(screenPt.x - sa.x, screenPt.y - sa.y) <= VERTEX_HIT_RADIUS) return { traitIndex: i, pointIndex: 0 };
            if (Math.hypot(screenPt.x - sb.x, screenPt.y - sb.y) <= VERTEX_HIT_RADIUS) return { traitIndex: i, pointIndex: 1 };
            if (distSegmentScreen(screenPt, t.a, t.b) <= VERTEX_HIT_RADIUS) return { traitIndex: i, pointIndex: "segment" };
          }
          return null;
        }
        /** Hit-test extension toiture (chien assis) : sommets contour, arêtiers, faîtage, puis corps. Priorité : points avant corps. */
        function hitTestRoofExtension(screenPt) {
          var imgPt = screenToImage(screenPt);
          var rxList = CALPINAGE_STATE.roofExtensions || [];
          for (var ri = rxList.length - 1; ri >= 0; ri--) {
            var rx = rxList[ri];
            if (!rx) continue;
            var pts = rx.contour && rx.contour.points ? rx.contour.points : [];
            for (var i = 0; i < pts.length; i++) {
              var s = imageToScreen(pts[i]);
              if (Math.hypot(s.x - screenPt.x, s.y - screenPt.y) <= VERTEX_HIT_RADIUS) {
                return { rxIndex: ri, type: "contour", subtype: "vertex", index: i, pointRef: pts[i] };
              }
            }
            for (var i = 0; i < pts.length; i++) {
              var a = pts[i];
              var b = pts[(i + 1) % pts.length];
              if (distSegmentScreen(screenPt, a, b) <= VERTEX_HIT_RADIUS) {
                return { rxIndex: ri, type: "body", subtype: "contour-edge" };
              }
            }
            if (rx.ridge && rx.ridge.a && rx.ridge.b) {
              var ra = imageToScreen(rx.ridge.a);
              var rb = imageToScreen(rx.ridge.b);
              if (Math.hypot(ra.x - screenPt.x, ra.y - screenPt.y) <= VERTEX_HIT_RADIUS) {
                return { rxIndex: ri, type: "ridge", subtype: "a", pointRef: rx.ridge.a };
              }
              if (Math.hypot(rb.x - screenPt.x, rb.y - screenPt.y) <= VERTEX_HIT_RADIUS) {
                return { rxIndex: ri, type: "ridge", subtype: "b", pointRef: rx.ridge.b };
              }
            }
            if (rx.hips) {
              if (rx.hips.left && rx.hips.left.a) {
                var la = imageToScreen(rx.hips.left.a);
                if (Math.hypot(la.x - screenPt.x, la.y - screenPt.y) <= VERTEX_HIT_RADIUS) {
                  return { rxIndex: ri, type: "hip", subtype: "left-a", pointRef: rx.hips.left.a };
                }
              }
              if (rx.hips.left && rx.hips.left.b) {
                var lb = imageToScreen(rx.hips.left.b);
                if (Math.hypot(lb.x - screenPt.x, lb.y - screenPt.y) <= VERTEX_HIT_RADIUS) {
                  return { rxIndex: ri, type: "hip", subtype: "left-b", pointRef: rx.hips.left.b };
                }
              }
              if (rx.hips.right && rx.hips.right.a) {
                var rha = imageToScreen(rx.hips.right.a);
                if (Math.hypot(rha.x - screenPt.x, rha.y - screenPt.y) <= VERTEX_HIT_RADIUS) {
                  return { rxIndex: ri, type: "hip", subtype: "right-a", pointRef: rx.hips.right.a };
                }
              }
              if (rx.hips.right && rx.hips.right.b) {
                var rhb = imageToScreen(rx.hips.right.b);
                if (Math.hypot(rhb.x - screenPt.x, rhb.y - screenPt.y) <= VERTEX_HIT_RADIUS) {
                  return { rxIndex: ri, type: "hip", subtype: "right-b", pointRef: rx.hips.right.b };
                }
              }
            }
            if (pts.length >= 3 && typeof pointInPolygonImage === "function" && pointInPolygonImage(imgPt, pts)) {
              return { rxIndex: ri, type: "body", subtype: "contour" };
            }
            if (rx.ridge && rx.ridge.a && rx.ridge.b && distSegmentScreen(screenPt, rx.ridge.a, rx.ridge.b) <= VERTEX_HIT_RADIUS) {
              return { rxIndex: ri, type: "body", subtype: "ridge" };
            }
            if (rx.hips && rx.hips.left && rx.hips.left.a && rx.hips.left.b && distSegmentScreen(screenPt, rx.hips.left.a, rx.hips.left.b) <= VERTEX_HIT_RADIUS) {
              return { rxIndex: ri, type: "body", subtype: "hip-left" };
            }
            if (rx.hips && rx.hips.right && rx.hips.right.a && rx.hips.right.b && distSegmentScreen(screenPt, rx.hips.right.a, rx.hips.right.b) <= VERTEX_HIT_RADIUS) {
              return { rxIndex: ri, type: "body", subtype: "hip-right" };
            }
          }
          return null;
        }
        function getContourSegments(points, closed) {
          if (closed === undefined) closed = true;
          var segments = [];
          for (var i = 0; i < points.length - 1; i++) {
            segments.push([points[i], points[i + 1]]);
          }
          if (closed && points.length > 2) {
            segments.push([points[points.length - 1], points[0]]);
          }
          return segments;
        }
        function segmentLengthMeters(a, b) {
          var scale = CALPINAGE_STATE.roof.scale && CALPINAGE_STATE.roof.scale.metersPerPixel;
          // console.log("[SCALE DEBUG] scale source = CALPINAGE_STATE.roof.scale.metersPerPixel (segmentLengthMeters)", scale);
          if (!scale || typeof scale !== "number") return null;
          var dx = b.x - a.x;
          var dy = b.y - a.y;
          return Math.hypot(dx, dy) * scale;
        }
        function projectPointOnSegment(pt, a, b) {
          var ax = a.x; var ay = a.y;
          var bx = b.x; var by = b.y;
          var px = pt.x; var py = pt.y;
          var abx = bx - ax; var aby = by - ay;
          var apx = px - ax; var apy = py - ay;
          var t = (apx * abx + apy * aby) / (abx * abx + aby * aby + 1e-10);
          t = Math.max(0, Math.min(1, t));
          return { x: ax + t * abx, y: ay + t * aby };
        }
        function distImg(a, b) {
          return Math.hypot(b.x - a.x, b.y - a.y);
        }
        function snapPointToGeometry(imgPt, contours, traits, ridges, thresholdPx, extraContourPoints) {
          thresholdPx = thresholdPx == null ? SNAP_DIST_PX : thresholdPx;
          var thresholdImg = Math.max(0.5, thresholdPx / vp.scale);
          var best = null;
          var bestDist = Infinity;
          var state = { contours: contours || [], traits: traits || [], ridges: ridges || [] };
          var edges = getEdgesFromState(state);

          /* 1) SNAP SUR SOMMETS ??? extraContourPoints puis edges (priorit? identique) */
          if (extraContourPoints && extraContourPoints.length > 0) {
            for (var i = 0; i < extraContourPoints.length; i++) {
              var p = extraContourPoints[i];
              var d = Math.hypot(imgPt.x - p.x, imgPt.y - p.y);
              if (d < thresholdImg && d < bestDist) {
                bestDist = d;
                best = { x: p.x, y: p.y, source: { type: EDGE_CONTOUR, id: null, pointIndex: i } };
              }
            }
          }
          var contourIndex = 0;
          for (var ei = 0; ei < edges.length; ei++) {
            var edge = edges[ei];
            var verts = edgeVertices(edge);
            for (var vi = 0; vi < verts.length; vi++) {
              var p = verts[vi];
              if (!p || typeof p.x !== "number") continue;
              var d = Math.hypot(imgPt.x - p.x, imgPt.y - p.y);
              if (d < thresholdImg && d < bestDist) {
                bestDist = d;
                var src = { type: edge.kind, id: edge.id, pointIndex: vi };
                if (edge.kind === EDGE_CONTOUR) src.contourIndex = contourIndex;
                best = { x: p.x, y: p.y, source: src };
              }
            }
            if (edge.kind === EDGE_CONTOUR) contourIndex++;
          }

          /* 2) SI UN SOMMET EST TROUV?? ??? RETOUR IMM??DIAT */
          if (best) return best;

          /* 3) SNAP SUR SEGMENTS ??? extraContourSegments puis edges */
          function considerSegment(x, y, src) {
            var d = distImg(imgPt, { x: x, y: y });
            if (d < thresholdImg && d < bestDist) {
              bestDist = d;
              best = { x: x, y: y, source: src };
            }
          }
          if (extraContourPoints && extraContourPoints.length > 1) {
            for (var i = 0; i < extraContourPoints.length - 1; i++) {
              var a = extraContourPoints[i];
              var b = extraContourPoints[i + 1];
              var proj = edgeProjectPointToSegment(imgPt, a, b);
              considerSegment(proj.x, proj.y, { type: EDGE_CONTOUR, id: null, pointIndex: null });
            }
          }
          contourIndex = 0;
          for (var ej = 0; ej < edges.length; ej++) {
            var edge2 = edges[ej];
            var segs = edgeSegments(edge2);
            for (var si = 0; si < segs.length; si++) {
              var seg = segs[si];
              var proj = edgeProjectPointToSegment(imgPt, seg[0], seg[1]);
              var src = { type: edge2.kind, id: edge2.id, pointIndex: null };
              if (edge2.kind === EDGE_CONTOUR) src.contourIndex = contourIndex;
              considerSegment(proj.x, proj.y, src);
            }
            if (edge2.kind === EDGE_CONTOUR) contourIndex++;
          }

          return best ? { x: best.x, y: best.y, source: best.source } : null;
        }
        function segmentIntersection(a1, a2, b1, b2) {
          var ax = a2.x - a1.x; var ay = a2.y - a1.y;
          var bx = b2.x - b1.x; var by = b2.y - b1.y;
          var denom = ax * by - ay * bx;
          if (Math.abs(denom) < 1e-10) return null;
          var cx = b1.x - a1.x; var cy = b1.y - a1.y;
          var t = (cx * by - cy * bx) / denom;
          var s = (cx * ay - cy * ax) / denom;
          if (t < 0 || t > 1 || s < 0 || s > 1) return null;
          return { x: a1.x + t * ax, y: a1.y + t * ay };
        }
        function splitSegmentByRidges(segA, segB, ridges, traits) {
          var points = [{ x: segA.x, y: segA.y }, { x: segB.x, y: segB.y }];
          ridges = ridges || [];
          traits = traits || [];
          ridges.forEach(function (r) {
            if (!r || !r.a || !r.b) return;
            var ra = resolveRidgePoint(r.a);
            var rb = resolveRidgePoint(r.b);
            var inter = segmentIntersection(segA, segB, ra, rb);
            if (inter) points.push(inter);
          });
          traits.forEach(function (t) {
            if (!t || !t.a || !t.b) return;
            var inter = segmentIntersection(segA, segB, t.a, t.b);
            if (inter) points.push(inter);
          });
          points.sort(function (p1, p2) { return distImg(segA, p1) - distImg(segA, p2); });
          var out = [];
          for (var i = 0; i < points.length - 1; i++) {
            var s1 = points[i];
            var s2 = points[i + 1];
            if (distImg(s1, s2) < 1e-6) continue;
            out.push([s1, s2]);
          }
          return out;
        }
        function drawSegmentLabelHalo(ctx, screenMid, text) {
          ctx.font = "12px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 4;
          ctx.strokeText(text, screenMid.x, screenMid.y);
          ctx.fillStyle = "#000";
          ctx.fillText(text, screenMid.x, screenMid.y);
        }
        function drawContourMeasurements(ctx, contour) {
          if (!contour || !contour.points || contour.points.length < 2) return;
          var segments = getContourSegments(contour.points, contour.closed);
          var ridges = CALPINAGE_STATE.ridges || [];
          for (var i = 0; i < segments.length; i++) {
            var a = segments[i][0];
            var b = segments[i][1];
            var subSegments = splitSegmentByRidges(a, b, ridges, CALPINAGE_STATE.traits);
            for (var j = 0; j < subSegments.length; j++) {
              var s1 = subSegments[j][0];
              var s2 = subSegments[j][1];
              var lenM = segmentLengthMeters(s1, s2);
              if (lenM == null) continue;
              var midX = (s1.x + s2.x) / 2;
              var midY = (s1.y + s2.y) / 2;
              var screenMid = imageToScreen({ x: midX, y: midY });
              var text = lenM.toFixed(2).replace(".", ",") + " m";
              drawSegmentLabelHalo(ctx, screenMid, text);
            }
          }
        }
        function drawContourSegmentLabels(ctx, contour) {
          if (!contour || !contour.points || contour.points.length < 2) return;
          var segments = getContourSegments(contour.points, contour.closed);
          var ridges = CALPINAGE_STATE.ridges || [];
          for (var i = 0; i < segments.length; i++) {
            var a = segments[i][0];
            var b = segments[i][1];
            var subSegments = splitSegmentByRidges(a, b, ridges, CALPINAGE_STATE.traits);
            for (var j = 0; j < subSegments.length; j++) {
              var s1 = subSegments[j][0];
              var s2 = subSegments[j][1];
              var lenM = segmentLengthMeters(s1, s2);
              if (lenM == null) continue;
              var midX = (s1.x + s2.x) / 2;
              var midY = (s1.y + s2.y) / 2;
              var screenMid = imageToScreen({ x: midX, y: midY });
              var text = lenM.toFixed(2).replace(".", ",") + " m";
              drawSegmentLabelHalo(ctx, screenMid, text);
            }
          }
        }
        function drawLiveContourMeasure(ctx) {
          var pts = CALPINAGE_STATE.activeContour.points;
          var hover = CALPINAGE_STATE.activeContour.hoverPoint;
          if (!hover || pts.length === 0) return;
          var last = pts[pts.length - 1];
          var lenM = segmentLengthMeters(last, hover);
          if (!lenM) return;
          var midX = (last.x + hover.x) / 2;
          var midY = (last.y + hover.y) / 2;
          var sa = imageToScreen(last);
          var sb = imageToScreen(hover);
          ctx.strokeStyle = "rgba(201, 164, 73, 0.8)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(sa.x, sa.y);
          ctx.lineTo(sb.x, sb.y);
          ctx.stroke();
          ctx.setLineDash([]);
          var screenMid = imageToScreen({ x: midX, y: midY });
          var text = lenM.toFixed(2).replace(".", ",") + " m";
          drawSegmentLabelHalo(ctx, screenMid, text);
        }
        function drawLiveTrait(ctx) {
          if (drawState.activeTool !== "trait" || !drawState.traitLineStart) return;
          ctx.save();
          var sa = imageToScreen(drawState.traitLineStart);
          if (typeof sa.x !== "number" || typeof sa.y !== "number" || !Number.isFinite(sa.x) || !Number.isFinite(sa.y)) {
            ctx.restore();
            return;
          }
          function drawTraitSnapIndicator(screenPt, snapSource, hasAnySnap) {
            var isVertexSnap = snapSource && typeof snapSource.pointIndex === "number";
            var isSegmentSnap = (hasAnySnap && !isVertexSnap);
            var hasSnap = isVertexSnap || isSegmentSnap;
            ctx.save();
            ctx.fillStyle = hasSnap ? "#22c55e" : "#9ca3af";
            ctx.strokeStyle = hasSnap ? "#16a34a" : "#6b7280";
            ctx.lineWidth = 1.5;
            if (isSegmentSnap) {
              var s = 5;
              ctx.beginPath();
              ctx.moveTo(screenPt.x, screenPt.y - s);
              ctx.lineTo(screenPt.x + s, screenPt.y);
              ctx.lineTo(screenPt.x, screenPt.y + s);
              ctx.lineTo(screenPt.x - s, screenPt.y);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            } else {
              ctx.beginPath();
              ctx.arc(screenPt.x, screenPt.y, 5, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
            ctx.restore();
          }
          var startSource = drawState.traitLineStart.source || null;
          var startHasSnap = !!(startSource);
          drawTraitSnapIndicator(sa, startSource, startHasSnap);
          /* Preview segment (traitLineStart ??? souris) ; fallback sur point de d?part si pas encore de souris */
          var endPt = drawState.traitSnapPreview || drawState.lastMouseImage || drawState.traitLineStart;
          var sb = imageToScreen(endPt);
          var hasSnapEdge = drawState.traitSnapEdge && typeof drawState.traitSnapEdge.x === "number";
          var endSnapSource = hasSnapEdge ? null : (drawState.traitSnapPreviewSource || null);
          var endHasSnap = hasSnapEdge || !!drawState.traitSnapPreviewSource;
          if (Number.isFinite(sb.x) && Number.isFinite(sb.y)) {
            ctx.strokeStyle = endHasSnap ? "#00aa00" : "#666";
            ctx.lineWidth = endHasSnap ? 2.5 : 1.5;
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.moveTo(sa.x, sa.y);
            ctx.lineTo(sb.x, sb.y);
            ctx.stroke();
            ctx.setLineDash([]);
            drawTraitSnapIndicator(sb, endSnapSource, endHasSnap);
          }
          ctx.restore();
        }
        function drawLiveRidge(ctx) {
          var r = CALPINAGE_STATE.activeRidge;
          function drawSnapIndicator(screenPt, snapSource, hasAnySnap) {
            var isVertexSnap = snapSource && typeof snapSource.pointIndex === "number";
            var isSegmentSnap = (hasAnySnap && !isVertexSnap);
            var hasSnap = isVertexSnap || isSegmentSnap;
            ctx.save();
            ctx.fillStyle = hasSnap ? "#22c55e" : "#9ca3af";
            ctx.strokeStyle = hasSnap ? "#16a34a" : "#6b7280";
            ctx.lineWidth = 1.5;
            if (isSegmentSnap) {
              var s = 5;
              ctx.beginPath();
              ctx.moveTo(screenPt.x, screenPt.y - s);
              ctx.lineTo(screenPt.x + s, screenPt.y);
              ctx.lineTo(screenPt.x, screenPt.y + s);
              ctx.lineTo(screenPt.x - s, screenPt.y);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            } else {
              ctx.beginPath();
              ctx.arc(screenPt.x, screenPt.y, 5, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();
            }
            ctx.restore();
          }
          if (!r.a || !r.hover) {
            if (!r.a && (r.snapEdge || r.hoverSnap || r.hover)) {
              var ptImg = r.snapEdge || (r.hoverSnap && r.hoverSnap.point) || r.hover;
              var ss = imageToScreen(ptImg);
              var src = r.hoverSnap && r.hoverSnap.source ? r.hoverSnap.source : null;
              var hasAny = !!(r.snapEdge || (r.hoverSnap && r.hoverSnap.point));
              drawSnapIndicator(ss, src, hasAny);
            }
            return;
          }

          var pa = resolveRidgePoint(r.a);
          var ph = r.hover && typeof r.hover.x === "number" ? r.hover : null;
          if (!ph) return;
          var sa = imageToScreen(pa);
          var sb = imageToScreen(ph);
          var lenM = segmentLengthMeters(pa, ph);
          var mid = { x: (pa.x + ph.x) / 2, y: (pa.y + ph.y) / 2 };
          var screenMid = imageToScreen(mid);
          var hasSnap = r.snapEdge || (r.hoverSnap && r.hoverSnap.point);
          var snapSrc = r.hoverSnap && r.hoverSnap.source ? r.hoverSnap.source : null;
          ctx.save();
          ctx.strokeStyle = hasSnap ? "#00aa00" : "rgba(201, 164, 73, 0.8)";
          ctx.lineWidth = 2.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(sa.x, sa.y);
          ctx.lineTo(sb.x, sb.y);
          ctx.stroke();
          ctx.setLineDash([]);
          drawSnapIndicator(sb, snapSrc, hasSnap);
          ctx.restore();
          if (lenM != null) {
            var text = lenM.toFixed(2).replace(".", ",") + " m";
            drawSegmentLabelHalo(ctx, screenMid, text);
          }
        }

        var roofImg = new Image();
        roofImg.onload = function () {
          recomputeRoofPlanes();
          function getManipulationHandlePositions(block) {
            if (!block || !block.panels) return null;
            var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (var i = 0; i < block.panels.length; i++) {
              var proj = block.panels[i].projection;
              if (!proj || !proj.points) continue;
              for (var j = 0; j < proj.points.length; j++) {
                var p = proj.points[j];
                minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
              }
            }
            if (minX === Infinity) return null;
            var centerX = (minX + maxX) / 2;
            var topY = minY;
            var bottomY = maxY;
            var blockHeight = maxY - minY;
            var offset = Math.max(18, blockHeight * 0.12);
            return {
              rotate: { x: centerX, y: topY - offset },
              move: { x: centerX, y: bottomY + offset },
              topY: topY,
              bottomY: bottomY,
              centerX: centerX
            };
          }
          var MANIPULATION_HANDLE_RADIUS_IMG = 18;
          addSafeListener(canvasEl, "pointerdown", function (e) {
            var rect = canvasEl.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var y = e.clientY - rect.top;
            if (window.__CALPINAGE_ROTATE_HITTEST && window.__CALPINAGE_ROTATE_HITTEST(canvasEl, x, y)) {
              return;
            }
            console.log("[MD] start", { activeTool: drawState.activeTool });
            var traitBtnEl = container.querySelector("#calpinage-tool-trait");
            if (traitBtnEl && traitBtnEl.classList.contains("calpinage-tool-active") && drawState.activeTool !== "trait") {
              drawState.activeTool = "trait";
            }
            if (e.button !== 0) {
              console.log("[MD] blocked by button (not left)");
              return;
            }
            /* Pan uniquement via Ctrl + glisser : pas de bouton Pan. En mode heightEdit, CTRL sert à la multi-sélection. */
            if (e.ctrlKey && !CALPINAGE_STATE.heightEditMode) {
              panStart = { x: e.clientX, y: e.clientY };
              return;
            }
            console.log("[PH3 DEBUG] pointerdown", {
              roofSurveyLocked: CALPINAGE_STATE.roofSurveyLocked,
              currentPhase: CALPINAGE_STATE.currentPhase,
              drawActiveTool: drawState.activeTool,
              dp2CurrentTool: (window.CALPINAGE_DP2_STATE && CALPINAGE_DP2_STATE.currentTool) ? CALPINAGE_DP2_STATE.currentTool : null,
              phase3Wanted: "PV_LAYOUT",
            });
            // Phase 3 (PV_LAYOUT) ne dépend PAS de drawState.activeTool (outil Phase 2).
            // On ne doit pas bloquer la pose / sélection de panneaux à cause d'un outil Phase 2.
            var isDormerMode = window.CALPINAGE_MODE === MODE_CREATE_DORMER || window.CALPINAGE_MODE === MODE_DORMER_CONTOUR || window.CALPINAGE_MODE === MODE_DORMER_RIDGE || window.CALPINAGE_MODE === MODE_DORMER_HIPS;
            if (
              CALPINAGE_STATE.roofSurveyLocked &&
              CALPINAGE_STATE.currentPhase !== "PV_LAYOUT" &&
              window.CALPINAGE_MODE !== "CREATE_SHADOW_VOLUME" &&
              !isDormerMode &&
              !CALPINAGE_STATE.heightEditMode
            ) {
              return;
            }
            var screen = getMouseScreen(e);
            var imgPt = screenToImage(screen);

            if (window.CALPINAGE_MODE === MODE_DORMER_HIPS) {
              var draft = getDormerEditTarget();
              if (!draft) return;
              var contourPts = draft.contour && draft.contour.points ? draft.contour.points : [];
              if (!contourPts || contourPts.length < 3) return;
              /* 1er arêtier : départ sur contour */
              if (!draft.hips.left) {
                var startSnap = snapToContourEdge(imgPt, contourPts, 15);
                if (!startSnap) return;
                draft.hips.left = { a: startSnap, b: null };
                if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
                return;
              }
              /* 2e clic : fin 1er arêtier (point libre) */
              if (draft.hips.left.b === null) {
                draft.hips.left.b = { x: imgPt.x, y: imgPt.y };
                if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
                return;
              }
              /* 3e clic : départ 2e arêtier sur contour */
              if (!draft.hips.right) {
                var startSnap2 = snapToContourEdge(imgPt, contourPts, 15);
                if (!startSnap2) return;
                draft.hips.right = { a: startSnap2, b: null };
                if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
                return;
              }
              /* 4e clic : fin 2e arêtier (snap sur 1er ou libre) */
              if (draft.hips.right.b === null) {
                var snapOnFirst = snapToSegment(imgPt, draft.hips.left.a, draft.hips.left.b, 15);
                draft.hips.right.b = snapOnFirst ? { x: snapOnFirst.x, y: snapOnFirst.y } : { x: imgPt.x, y: imgPt.y };
                var intersection = intersectLines(
                  draft.hips.left.a, draft.hips.left.b,
                  draft.hips.right.a, draft.hips.right.b
                );
                draft.ridgeOrigin = intersection;
                draft.stage = "HIPS";
                drawState.dormerEditRxIndex = null;
                window.CALPINAGE_MODE = null;
                drawState.dormerActiveTool = null;
                if (canvasEl) canvasEl.style.cursor = "default";
                if (typeof saveCalpinageState === "function") saveCalpinageState();
                if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
                return;
              }
              return;
            }
            if (window.CALPINAGE_MODE === MODE_DORMER_CONTOUR) {
              if (!drawState.dormerDraft) return;
              var pts = drawState.dormerDraft.contour.points;
              var pts0 = pts[0];
              if (pts.length >= 3 && pts0) {
                var firstScreen = imageToScreen(pts0);
                if (Math.hypot(screen.x - firstScreen.x, screen.y - firstScreen.y) <= CLOSE_THRESHOLD_PX) {
                  drawState.dormerDraft.contour.closed = true;
                  var idx = pushRoofExtensionFromContour(drawState.dormerDraft);
                  drawState.selectedRoofExtensionIndex = idx >= 0 ? idx : null;
                  drawState.dormerDraft = null;
                  drawState.dormerActiveTool = null;
                  drawState.dormerEditRxIndex = null;
                  window.CALPINAGE_MODE = null;
                  if (canvasEl) canvasEl.style.cursor = "default";
                  if (typeof saveCalpinageState === "function") saveCalpinageState();
                  if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
                  return;
                }
              }
              pts.push({ x: imgPt.x, y: imgPt.y });
              if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
              return;
            }

            if (window.CALPINAGE_MODE === MODE_DORMER_RIDGE) {
              var draft = getDormerEditTarget();
              if (!draft || !draft.ridge) return;
              var ridge = draft.ridge;
              if (!ridge.a) return;
              if (!ridge.b) {
                var snapVertex = draft.contour && draft.contour.points
                  ? snapToDormerVertex(imgPt, draft.contour.points, 15)
                  : null;
                ridge.b = snapVertex ? { x: snapVertex.x, y: snapVertex.y } : { x: imgPt.x, y: imgPt.y };
                draft.stage = "COMPLETE";
                drawState.dormerEditRxIndex = null;
                window.CALPINAGE_MODE = null;
                drawState.dormerActiveTool = null;
                if (canvasEl) canvasEl.style.cursor = "default";
                if (typeof saveCalpinageState === "function") saveCalpinageState();
                if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
                return;
              }
              return;
            }

            if (window.CALPINAGE_MODE === MODE_CREATE_DORMER) {
              if (drawState.dormerStep === 1) {
                drawState.dormerDraft = createRoofExtensionDormerDraft("dormer", imgPt);
                drawState.dormerStep = 2;
                return;
              }
              if (drawState.dormerStep === 2) {
                if (!drawState.dormerDraft) return;
                drawState.dormerDraft.contour.points.push({
                  x: imgPt.x,
                  y: imgPt.y
                });
                if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
                return;
              }
              // Étape 3 : dessin du faîtage
              if (drawState.dormerStep === 3) {
                if (!drawState.dormerDraft) return;
                if (!drawState.dormerDraft.ridge.a) {
                  drawState.dormerDraft.ridge.a = { x: imgPt.x, y: imgPt.y };
                  if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
                  return;
                }
                if (!drawState.dormerDraft.ridge.b) {
                  drawState.dormerDraft.ridge.b = { x: imgPt.x, y: imgPt.y };
                  drawState.dormerStep = 4; // prochaine étape = arêtiers
                  if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
                  return;
                }
              }
            }

            /* CREATE_SHADOW_VOLUME : priorité absolue — clic démarre placement, drag resize live, mouseup commit */
            if (window.CALPINAGE_MODE === "CREATE_SHADOW_VOLUME" && drawState.shadowVolumeCreateShape) {
              var p = imgPt;
              var shape = drawState.shadowVolumeCreateShape;

              var v = {
                id: "shadow_" + Date.now() + "_" + Math.floor(Math.random() * 1e6),
                type: "shadow_volume",
                shape: shape,
                x: p.x,
                y: p.y,
                width: 0.01,
                depth: 0.01,
                height: 1.0,
                rotation: 0,
                baseZ: getHeightAtImgPoint(p)
              };

              CALPINAGE_STATE.shadowVolumes = CALPINAGE_STATE.shadowVolumes || [];
              CALPINAGE_STATE.shadowVolumes.push(v);

              drawState.selectedShadowVolumeIndex = CALPINAGE_STATE.shadowVolumes.length - 1;
              drawState.isPlacingShadowVolume = true;
              drawState.shadowVolumePlaceStart = { x: p.x, y: p.y };
              setInteractionState(InteractionStates.CREATING);

              if (canvasEl && e.pointerId != null && canvasEl.setPointerCapture) canvasEl.setPointerCapture(e.pointerId);

              if (typeof saveCalpinageState === "function") saveCalpinageState();
              if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
              try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
              return;
            }

            /* SHADOW INTERACTION — Phase 2 + Phase 3 */
            var svList = CALPINAGE_STATE.shadowVolumes || [];
            if (svList.length > 0 && (CALPINAGE_STATE.currentPhase === "ROOF_EDIT" || CALPINAGE_STATE.currentPhase === "PV_LAYOUT")) {
              if (window.CALPINAGE_IS_MANIPULATING) { /* fallthrough */ } else {
                var selSvIdx = drawState.selectedShadowVolumeIndex;
                if (
                  selSvIdx != null &&
                  CALPINAGE_STATE.shadowVolumes &&
                  selSvIdx >= 0 &&
                  selSvIdx < CALPINAGE_STATE.shadowVolumes.length
                ) {
                  var handleHit = hitTestShadowVolumeHandles(screen, svList[selSvIdx], imageToScreen, vp.scale);
                  if (handleHit) {
                    drawState.draggingShadowVolumeHandle = handleHit.handle;
                    drawState.resizeShadowVolumeStart = { volume: svList[selSvIdx], imgPt: { x: imgPt.x, y: imgPt.y }, width: svList[selSvIdx].width, depth: svList[selSvIdx].depth, height: svList[selSvIdx].height, rotation: svList[selSvIdx].rotation };
                    if (handleHit.handle === "rotate") {
                      drawState.shadowVolumeRotateStart = { angle: typeof svList[selSvIdx].rotation === "number" ? svList[selSvIdx].rotation : 0, centerImg: { x: svList[selSvIdx].x, y: svList[selSvIdx].y }, startImg: { x: imgPt.x, y: imgPt.y } };
                      setInteractionState(InteractionStates.ROTATING);
                    } else {
                      setInteractionState(InteractionStates.RESIZING);
                    }
                    try { canvasEl.setPointerCapture(e.pointerId); } catch (_) {}
                    return;
                  }
                }
                var svHit = hitTestShadowVolume(imgPt);
                if (svHit) {
                  drawState.selectedShadowVolumeIndex = svHit.index;
                  /* drag sur le corps (pas handle) => move */
                  drawState.draggingShadowVolumeMove = true;
                  setInteractionState(InteractionStates.DRAGGING);
                  var v = CALPINAGE_STATE.shadowVolumes[svHit.index];
                  drawState.shadowVolumeMoveStart = { x: imgPt.x, y: imgPt.y, cx: v.x, cy: v.y };
                  if (canvasEl && e.pointerId != null && canvasEl.setPointerCapture) canvasEl.setPointerCapture(e.pointerId);
                  if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
                  return;
                }
                if (selSvIdx != null) {
                  drawState.selectedShadowVolumeIndex = null;
                  if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
                }
              }
            }

            // --- ROOF OBSTACLE INTERACTION (RECT + CIRCLE) ---
            // Position : AVANT le bloc PV_LAYOUT
            if (
              CALPINAGE_STATE.obstacles &&
              CALPINAGE_STATE.obstacles.length > 0 &&
              !window.CALPINAGE_IS_MANIPULATING
            ) {

              var obsList = CALPINAGE_STATE.obstacles;
              var selIdx = drawState.selectedObstacleIndex;

              // --- 1) HANDLE PRIORITY ---
              var hasShapeMeta = selIdx != null && obsList[selIdx] && obsList[selIdx].shapeMeta &&
                (obsList[selIdx].shapeMeta.originalType === "circle" || obsList[selIdx].shapeMeta.originalType === "rect");
              if (hasShapeMeta) {

                var obs = obsList[selIdx];

                if (CalpinageCanvas && CalpinageCanvas.hitTestObstacleHandles) {

                  var handleHit = CalpinageCanvas.hitTestObstacleHandles(
                    screen,
                    obs,
                    imageToScreen,
                    vp.scale
                  );

                  if (handleHit) {

                    drawState.draggingObstacleHandle = handleHit.handle;

                    var m = obs.shapeMeta;
                    var center = { x: m.centerX, y: m.centerY };

                    if (handleHit.handle === "rotate") {

                      drawState.resizeObstacleStart = {
                        index: selIdx,
                        cx: center.x,
                        cy: center.y,
                        startAngle: typeof m.angle === "number" ? m.angle : 0,
                        startMouseAngle: Math.atan2(imgPt.y - center.y, imgPt.x - center.x)
                      };

                      setInteractionState(InteractionStates.ROTATING);

                    } else {

                      var resizeStart = { index: selIdx, shapeMeta: JSON.parse(JSON.stringify(m)) };
                      if (m.originalType === "rect" && typeof handleHit.handle === "number") {
                        var hw0 = m.width / 2, hh0 = m.height / 2;
                        var opp = handleHit.handle === 0 ? 2 : handleHit.handle === 1 ? 3 : handleHit.handle === 2 ? 0 : 1;
                        var cornersLocal = [{ x: -hw0, y: -hh0 }, { x: hw0, y: -hh0 }, { x: hw0, y: hh0 }, { x: -hw0, y: hh0 }];
                        resizeStart.startCenter = { x: center.x, y: center.y };
                        resizeStart.startWidth = m.width;
                        resizeStart.startHeight = m.height;
                        resizeStart.startAngle = typeof m.angle === "number" ? m.angle : 0;
                        resizeStart.oppositeLocal = { x: cornersLocal[opp].x, y: cornersLocal[opp].y };
                      }
                      drawState.resizeObstacleStart = resizeStart;

                      setInteractionState(InteractionStates.RESIZING);
                    }

                    if (canvasEl.setPointerCapture && e.pointerId != null) {
                      try { canvasEl.setPointerCapture(e.pointerId); } catch (_) {}
                      drawState.activePointerId = e.pointerId;
                    }

                    if (typeof window.CALPINAGE_RENDER === "function") {
                      window.CALPINAGE_RENDER();
                    }

                    return; // 🔴 STOP → ne pas aller vers PV_LAYOUT
                  }
                }
              }

              // --- 2) BODY HIT ---
              var tolImgBody = (vp && typeof vp.scale === "number") ? Math.max(0.5, 8 / vp.scale) : 0.5;
              for (var i = obsList.length - 1; i >= 0; i--) {

                var o = obsList[i];
                if (!o) continue;

                var isHit = false;

                if (o.shapeMeta && (!o.points || !Array.isArray(o.points) || o.points.length < 3) && typeof obstacleRecalcFromShapeMeta === "function") {
                  obstacleRecalcFromShapeMeta(o);
                }

                if (o.points && Array.isArray(o.points) && o.points.length >= 3) {
                  isHit = pointInPolygonImage(imgPt, o.points);
                } else if (o.shapeMeta) {
                  var m = o.shapeMeta;
                  if (m.originalType === "circle" && typeof m.centerX === "number" && typeof m.centerY === "number" && typeof m.radius === "number") {
                    var d = Math.hypot(imgPt.x - m.centerX, imgPt.y - m.centerY);
                    isHit = d <= m.radius + tolImgBody;
                  } else if (m.originalType === "rect" && typeof m.centerX === "number" && typeof m.centerY === "number" && typeof m.width === "number" && typeof m.height === "number") {
                    var hw = m.width / 2, hh = m.height / 2;
                    var a = typeof m.angle === "number" ? m.angle : 0;
                    var c = Math.cos(a), s = Math.sin(a);
                    var corners = [
                      { x: m.centerX - hw * c + hh * s, y: m.centerY - hw * s - hh * c },
                      { x: m.centerX + hw * c + hh * s, y: m.centerY + hw * s - hh * c },
                      { x: m.centerX + hw * c - hh * s, y: m.centerY + hw * s + hh * c },
                      { x: m.centerX - hw * c - hh * s, y: m.centerY - hw * s + hh * c }
                    ];
                    isHit = pointInPolygonImage(imgPt, corners);
                  }
                }

                if (isHit) {

                  drawState.selectedObstacleIndex = i;
                  drawState.lastMouseImage = imgPt;

                  var ref = o.shapeMeta && typeof o.shapeMeta.centerX === "number" && typeof o.shapeMeta.centerY === "number"
                    ? { x: o.shapeMeta.centerX, y: o.shapeMeta.centerY }
                    : (o.points && o.points.length > 0 ? o.points[0] : { x: imgPt.x, y: imgPt.y });

                  drawState.draggingObstacleOffset = {
                    dx: imgPt.x - ref.x,
                    dy: imgPt.y - ref.y
                  };

                  setInteractionState(InteractionStates.DRAGGING);

                  if (canvasEl.setPointerCapture && e.pointerId != null) {
                    try { canvasEl.setPointerCapture(e.pointerId); } catch (_) {}
                    drawState.activePointerId = e.pointerId;
                  }

                  if (typeof window.CALPINAGE_RENDER === "function") {
                    window.CALPINAGE_RENDER();
                  }

                  return; // 🔴 STOP → ne pas aller vers PV_LAYOUT
                }
              }

              // --- 3) EMPTY CLICK ---
              if (selIdx != null) {
                drawState.selectedObstacleIndex = null;
                if (typeof window.CALPINAGE_RENDER === "function") {
                  window.CALPINAGE_RENDER();
                }
              }
            }

            /* Phase 3 : mode "panels" = ajout uniquement ; mode "select" = sélection / déplacement / suppression bloc (clavier). */
            if (CALPINAGE_STATE.currentPhase === "PV_LAYOUT") {
              if (window.CALPINAGE_IS_MANIPULATING) return;
              var data = CALPINAGE_STATE.validatedRoofData;
              if (!data || !data.pans) {
                console.log("[PV] Pas de données toiture.");
                return;
              }
              var ENG = window.pvPlacementEngine;
              if (!ENG || typeof ENG.getFocusBlock !== "function") {
                console.log("[PV] Module pvPlacementEngine indisponible.");
                return;
              }
              var focusBlock = ENG.getFocusBlock ? ENG.getFocusBlock() : null;
              var activeBlock = ENG.getActiveBlock ? ENG.getActiveBlock() : null;
              /* S'assurer que le bloc focus a des projections (sinon getManipulationHandlePositions retourne null et move/rotate ne démarrent jamais). */
              if (focusBlock && typeof ENG.recomputeBlock === "function") {
                var ctxHandles = typeof getProjectionContextForBlock === "function" ? getProjectionContextForBlock(focusBlock) : (typeof getProjectionContextForPan === "function" ? getProjectionContextForPan(focusBlock.panId) : null);
                if (ctxHandles) ENG.recomputeBlock(focusBlock.id, window.PV_LAYOUT_RULES, ctxHandles);
              }

              /* Hit-test poignées rotation / déplacement AVANT tout le reste (priorité poignées > panneaux > ghosts) */
              var blockForHandles = focusBlock;
              if (blockForHandles && typeof getManipulationHandlePositions === "function") {
                var handles = getManipulationHandlePositions(blockForHandles);
                if (handles) {
                  var dxR = imgPt.x - handles.rotate.x, dyR = imgPt.y - handles.rotate.y;
                  var dxM = imgPt.x - handles.move.x, dyM = imgPt.y - handles.move.y;
                  var r2 = MANIPULATION_HANDLE_RADIUS_IMG * MANIPULATION_HANDLE_RADIUS_IMG;
                  if (dxR * dxR + dyR * dyR <= r2) {
                    if (typeof ENG.setActiveBlock === "function") ENG.setActiveBlock(blockForHandles.id);
                    if (typeof ENG.beginManipulation === "function") ENG.beginManipulation(blockForHandles.id);
                    window.CALPINAGE_IS_MANIPULATING = true;
                    setInteractionState(InteractionStates.ROTATING);
                    var centerImg = ENG.getBlockCenter && ENG.getBlockCenter(blockForHandles);
                    calpinageHandleDrag = {
                      type: "rotate",
                      blockId: blockForHandles.id,
                      startImg: { x: imgPt.x, y: imgPt.y },
                      centerImg: centerImg || null,
                      startAngleRad: centerImg ? Math.atan2(imgPt.y - centerImg.y, imgPt.x - centerImg.x) : 0,
                      lastAngleRad: centerImg ? Math.atan2(imgPt.y - centerImg.y, imgPt.x - centerImg.x) : 0
                    };
                    try { canvasEl.setPointerCapture(e.pointerId); } catch(_) {}
                    return;
                  }
                  if (dxM * dxM + dyM * dyM <= r2) {
                    if (typeof ENG.setActiveBlock === "function") ENG.setActiveBlock(blockForHandles.id);
                    if (typeof ENG.beginManipulation === "function") ENG.beginManipulation(blockForHandles.id);
                    window.CALPINAGE_IS_MANIPULATING = true;
                    setInteractionState(InteractionStates.DRAGGING);
                    var centerImgMove = ENG.getBlockCenter && ENG.getBlockCenter(blockForHandles);
                    calpinageHandleDrag = {
                      type: "move",
                      blockId: blockForHandles.id,
                      startImg: { x: imgPt.x, y: imgPt.y },
                      centerImg: centerImgMove || null,
                      startImgX: imgPt.x,
                      startImgY: imgPt.y,
                      lastImgX: imgPt.x,
                      lastImgY: imgPt.y
                    };
                    try { canvasEl.setPointerCapture(e.pointerId); } catch(_) {}
                    return;
                  }
                }
              }

              /* MODE SELECT : aucun clic ne supprime. Sélection → manipulation (handles) → modification (menu / Suppr). */

              if (drawState.activeTool === "select") {
                /* Mode Sélectionner : clic sur bloc => setActiveBlock ; clic vide => clearSelection. Pas d'ajout, pas de suppression au clic. */
                if (typeof hitTestFrozenBlock === "function") {
                  var frozenHitSel = hitTestFrozenBlock(imgPt);
                  if (frozenHitSel) {
                    var setRes = ENG.setActiveBlock(frozenHitSel.blockId);
                    if (setRes && setRes.success) {
                      setInteractionState(InteractionStates.SELECTED);
                      CALPINAGE_STATE.activeManipulationBlockId = frozenHitSel.blockId;
                      window.PV_LAYOUT_STATE = PV_LAYOUT_FLOW.SELECT;
                      var block = ENG.getFocusBlock ? ENG.getFocusBlock() : null;
                      if (block) {
                        var ctxPan = typeof getProjectionContextForBlock === "function" ? getProjectionContextForBlock(block) : getProjectionContextForPan(block.panId);
                        if (ctxPan) {
                          ENG.recomputeBlock(block.id, window.PV_LAYOUT_RULES, ctxPan);
                          if (typeof ENG.updatePanelValidationForBlock === "function") {
                            var getCtxFn = function () { return getProjectionContextForBlock(block); };
                            ENG.updatePanelValidationForBlock(block, getCtxFn);
                          }
                        }
                      }
                      if (typeof window.syncPhase3LayoutUI === "function") window.syncPhase3LayoutUI();
                      if (typeof pvSyncSaveRender === "function") pvSyncSaveRender();
                    }
                    return;
                  }
                }
                if (focusBlock && typeof hitTestFocusBlockPanelId === "function") {
                  var hitSel = hitTestFocusBlockPanelId(imgPt);
                  if (hitSel && hitSel.panelId) {
                    CALPINAGE_STATE.selectedPlacedPanelId = hitSel.panelId;
                    CALPINAGE_STATE.selectedPlacedBlockId = hitSel.blockId;
                    return;
                  }
                }
                var panAtPointSel = null;
                for (var si = 0; si < data.pans.length; si++) {
                  if (data.pans[si].polygon && pointInPolygonImage(imgPt, data.pans[si].polygon)) { panAtPointSel = data.pans[si]; break; }
                }
                if (focusBlock && !panAtPointSel) {
                  if (typeof ENG.clearSelection === "function") ENG.clearSelection();
                  CALPINAGE_STATE.activeManipulationBlockId = null;
                  syncPlacedPanelsFromBlocks();
                  if (typeof saveCalpinageState === "function") saveCalpinageState();
                  if (typeof window.syncPhase3LayoutUI === "function") window.syncPhase3LayoutUI();
                  if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
                  return;
                }
                if (focusBlock && panAtPointSel) {
                  var hitPanelSel = typeof hitTestFocusBlockPanelIndex === "function" && hitTestFocusBlockPanelIndex(imgPt) >= 0;
                  if (!hitPanelSel && typeof ENG.clearSelection === "function") {
                    ENG.clearSelection();
                    CALPINAGE_STATE.activeManipulationBlockId = null;
                    if (typeof window.syncPhase3LayoutUI === "function") window.syncPhase3LayoutUI();
                    if (typeof pvSyncSaveRender === "function") pvSyncSaveRender();
                  }
                }
                return;
              }

              /* Mode "Ajouter panneaux" (CALPINAGE) : clic sur un panneau du bloc actif => supprimer ce panneau. Inactif en MODE SELECT. */
              if (window.CALPINAGE_INTERACTION_MODE !== "SELECT") {
                if (focusBlock && typeof hitTestFocusBlockPanelId === "function") {
                  var hitRm = hitTestFocusBlockPanelId(imgPt);
                  if (hitRm && hitRm.panelId) {
                    CALPINAGE_STATE.selectedPlacedPanelId = hitRm.panelId;
                    CALPINAGE_STATE.selectedPlacedBlockId = hitRm.blockId;
                    var blockRm = ENG.getFocusBlock ? ENG.getFocusBlock() : focusBlock;
                    var getCtxRm = function () { return (typeof getProjectionContextForBlock === "function" ? getProjectionContextForBlock(blockRm) : getProjectionContextForPan(blockRm.panId)); };
                    if (blockRm && typeof ENG.removePanelById === "function") {
                      var isLastPanel = blockRm.panels && blockRm.panels.length === 1;
                      if (isLastPanel && typeof window.requestCalpinageConfirm === "function") {
                        window.requestCalpinageConfirm({
                          title: "Supprimer ce bloc ?",
                          description: "Le dernier panneau du bloc sera supprimé. Le bloc entier sera supprimé.",
                          confirmLabel: "Supprimer",
                          cancelLabel: "Annuler",
                          onConfirm: function () {
                            ENG.removePanelById(blockRm, hitRm.panelId, getCtxRm);
                            if (typeof ENG.removeBlock === "function") ENG.removeBlock(blockRm.id);
                            if (typeof recomputeAllPlacementBlocksFromRules === "function") recomputeAllPlacementBlocksFromRules(true);
                            if (typeof pvSyncSaveRender === "function") pvSyncSaveRender();
                          }
                        });
                      } else if (isLastPanel) {
                        if (typeof console !== "undefined" && console.error) console.error("[CALPINAGE] ConfirmProvider missing — destructive action blocked");
                      } else {
                        ENG.removePanelById(blockRm, hitRm.panelId, getCtxRm);
                        if (blockRm.panels && blockRm.panels.length === 0 && typeof ENG.removeBlock === "function") {
                          ENG.removeBlock(blockRm.id);
                        }
                        if (typeof recomputeAllPlacementBlocksFromRules === "function") recomputeAllPlacementBlocksFromRules(true);
                        if (typeof pvSyncSaveRender === "function") pvSyncSaveRender();
                      }
                    }
                    return;
                  }
                }
              }

              /* Mode "panels" : clic sur un bloc figé => le rendre sélectionné et manipulable (sans changer d'outil). */
              if (typeof hitTestFrozenBlock === "function") {
                var frozenHitPanels = hitTestFrozenBlock(imgPt);
                if (frozenHitPanels) {
                  var setResPanels = ENG.setActiveBlock(frozenHitPanels.blockId);
                  if (setResPanels && setResPanels.success) {
                    setInteractionState(InteractionStates.SELECTED);
                    CALPINAGE_STATE.activeManipulationBlockId = frozenHitPanels.blockId;
                    window.PV_LAYOUT_STATE = PV_LAYOUT_FLOW.SELECT;
                    var blockPanels = ENG.getFocusBlock ? ENG.getFocusBlock() : null;
                    if (blockPanels) {
                      var ctxPanP = typeof getProjectionContextForBlock === "function" ? getProjectionContextForBlock(blockPanels) : getProjectionContextForPan(blockPanels.panId);
                      if (ctxPanP) {
                        ENG.recomputeBlock(blockPanels.id, window.PV_LAYOUT_RULES, ctxPanP);
                        if (typeof ENG.updatePanelValidationForBlock === "function") {
                          var getCtxFnP = function () { return getProjectionContextForBlock(blockPanels); };
                          ENG.updatePanelValidationForBlock(blockPanels, getCtxFnP);
                        }
                      }
                    }
                    if (typeof window.syncPhase3LayoutUI === "function") window.syncPhase3LayoutUI();
                    if (typeof pvSyncSaveRender === "function") pvSyncSaveRender();
                  }
                  return;
                }
              }

              /* Mode "panels" (Ajouter panneaux) : ghost add, create block, clearSelection. Aucune suppression au clic. */
              if (!window.PV_SELECTED_PANEL) ensurePVSelectedPanel();
              if (!window.PV_SELECTED_PANEL) console.log("[PV] Aucun panneau disponible");

              /* Clic sur ghost => création panneau à cet emplacement */
              if (window.PV_SELECTED_PANEL && activeBlock && typeof ENG.computeExpansionGhosts === "function" && typeof pointInPolygonImage === "function") {
                var getCtxGhost = function () { return (typeof getProjectionContextForBlock === "function" ? getProjectionContextForBlock(activeBlock) : getProjectionContextForPan(activeBlock.panId)); };
                var ghosts = ENG.computeExpansionGhosts(activeBlock, getCtxGhost);
                if (Array.isArray(ghosts)) {
                  for (var gi = 0; gi < ghosts.length; gi++) {
                    var g = ghosts[gi];
                    if (g.projection && g.projection.points && g.projection.points.length >= 3 && pointInPolygonImage(imgPt, g.projection.points)) {
                      var res = ENG.addPanelAtCenter(activeBlock, g.center, getCtxGhost);
                      if (res && res.success) {
                        if (typeof recomputeAllPlacementBlocksFromRules === "function") recomputeAllPlacementBlocksFromRules(true);
                        if (typeof saveCalpinageState === "function") saveCalpinageState();
                        if (typeof pvSyncSaveRender === "function") pvSyncSaveRender();
                      }
                      return;
                    }
                  }
                }
              }
              /* En mode "panels" : pas de sélection au clic sur un bloc figé (on ne fait rien). */
              /* 3b) Clic sur un autre pan que le bloc actif : figer le bloc courant et cr?er un nouveau bloc sur le pan cliqu? */
              var panAtPointEarly = null;
              for (var i = 0; i < data.pans.length; i++) {
                if (data.pans[i].polygon && pointInPolygonImage(imgPt, data.pans[i].polygon)) {
                  panAtPointEarly = data.pans[i];
                  break; /* un seul pan au clic : sortir d?s qu'un pan est trouv? */
                }
              }
              if (window.PV_SELECTED_PANEL && activeBlock && panAtPointEarly && panAtPointEarly.id !== activeBlock.panId) {
                window.PV_LAYOUT_STATE = PV_LAYOUT_FLOW.VALIDATE;
                ENG.endBlock();
                window.PV_LAYOUT_STATE = PV_LAYOUT_FLOW.SELECT;
                var ctxNew = getProjectionContextForPan(panAtPointEarly.id);
                var rulesForCreate = Object.assign({}, window.PV_LAYOUT_RULES || {});
                rulesForCreate.orientation = (rulesForCreate.orientation === "landscape" || rulesForCreate.orientation === "paysage") ? "PAYSAGE" : "PORTRAIT";
                var resultNew = ENG.createBlock(panAtPointEarly.id, { x: imgPt.x, y: imgPt.y }, rulesForCreate, ctxNew);
                if (!resultNew.success && typeof window.showPvLayoutError === "function") {
                  window.showPvLayoutError(resultNew.reason || "Placement impossible");
                } else if (resultNew.success) {
                  window.PV_LAYOUT_STATE = PV_LAYOUT_FLOW.ADD;
                  var newBlockOther = ENG.getFocusBlock ? ENG.getFocusBlock() : (ENG.getActiveBlock ? ENG.getActiveBlock() : null);
                  if (newBlockOther) CALPINAGE_STATE.activeManipulationBlockId = newBlockOther.id;
                  if (typeof recomputeAllPlacementBlocksFromRules === "function") recomputeAllPlacementBlocksFromRules();
                }
                if (typeof pvSyncSaveRender === "function") pvSyncSaveRender();
                return;
              }
              /* 4) Clic sur pan vide / 5) Clic dans le vide => d?s?lectionner tout (clearSelection) */
              var panAtPoint = panAtPointEarly != null ? panAtPointEarly : null;
              if (panAtPoint == null) {
                for (var i = 0; i < data.pans.length; i++) {
                  if (data.pans[i].polygon && pointInPolygonImage(imgPt, data.pans[i].polygon)) {
                    panAtPoint = data.pans[i];
                    break;
                  }
                }
              }
              if (focusBlock && !panAtPoint) {
                  if (typeof ENG.clearSelection === "function") ENG.clearSelection();
                  CALPINAGE_STATE.activeManipulationBlockId = null;
                  syncPlacedPanelsFromBlocks();
                  if (typeof saveCalpinageState === "function") saveCalpinageState();
                  if (typeof window.syncPhase3LayoutUI === "function") window.syncPhase3LayoutUI();
                  if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") {
                    requestAnimationFrame(window.CALPINAGE_RENDER);
                  }
                return;
              }
              if (focusBlock && panAtPoint) {
                var hitPanel = focusBlock && typeof hitTestFocusBlockPanelIndex === "function" && hitTestFocusBlockPanelIndex(imgPt) >= 0;
                if (!hitPanel && typeof ENG.clearSelection === "function") {
                  ENG.clearSelection();
                  CALPINAGE_STATE.activeManipulationBlockId = null;
                  if (typeof window.syncPhase3LayoutUI === "function") window.syncPhase3LayoutUI();
                  if (typeof pvSyncSaveRender === "function") pvSyncSaveRender();
                }
                return;
              }
              if (window.PV_SELECTED_PANEL && !activeBlock && panAtPoint) {
                var ctxCreate = getProjectionContextForPan(panAtPoint.id);
                var rulesForCreate = Object.assign({}, window.PV_LAYOUT_RULES || {});
                rulesForCreate.orientation = (rulesForCreate.orientation === "landscape" || rulesForCreate.orientation === "paysage") ? "PAYSAGE" : "PORTRAIT";
                var result = ENG.createBlock(panAtPoint.id, { x: imgPt.x, y: imgPt.y }, rulesForCreate, ctxCreate);
                if (result.success) {
                  window.PV_LAYOUT_STATE = PV_LAYOUT_FLOW.ADD;
                  var newBlock = ENG.getFocusBlock ? ENG.getFocusBlock() : (ENG.getActiveBlock ? ENG.getActiveBlock() : null);
                  if (newBlock) CALPINAGE_STATE.activeManipulationBlockId = newBlock.id;
                  if (typeof recomputeAllPlacementBlocksFromRules === "function") recomputeAllPlacementBlocksFromRules();
                } else if (!result.success && typeof window.showPvLayoutError === "function") {
                  window.showPvLayoutError(result.reason || "Placement impossible");
                }
                if (typeof pvSyncSaveRender === "function") pvSyncSaveRender();
                return;
              }
              return;
            }

            if (CALPINAGE_STATE.heightEditMode) {
              var hit = hitTestHeightPoints(imgPt, imageToScreen, screenToImage);
              if (!hit) {
                if (heightEditDraftValue != null) commitHeightEdit();
                exitHeightEdit(false);
                return;
              }
              if (e.ctrlKey) {
                var pts = CALPINAGE_STATE.selectedHeightPoints;
                var exists = pts && pts.some(function (p) { return p.type === hit.type && p.index === hit.index && p.pointIndex === hit.pointIndex; });
                if (exists) {
                  CALPINAGE_STATE.selectedHeightPoints = (pts || []).filter(function (p) { return !(p.type === hit.type && p.index === hit.index && p.pointIndex === hit.pointIndex); });
                  CALPINAGE_STATE.selectedHeightPoint = CALPINAGE_STATE.selectedHeightPoints[0] || null;
                } else {
                  CALPINAGE_STATE.selectedHeightPoints = (pts || []).concat([hit]);
                  CALPINAGE_STATE.selectedHeightPoint = hit;
                }
              } else {
                CALPINAGE_STATE.selectedHeightPoint = hit;
                CALPINAGE_STATE.selectedHeightPoints = [hit];
                /* Reset draft pour afficher immédiatement la hauteur du nouveau point (sans clic vide) */
                heightEditDraftValue = null;
                heightEditInplaceRollbackValues = [];
              }
              requestAnimationFrame(render);
              return;
            }
            /* Outil Obstacle — cercle : drag (1 clic, drag, release) ; rect : drag ; polygon : clic = point, fermeture par proximité du premier */
            if (drawState.activeTool === "obstacle" && drawState.obstacleShape) {
              if (drawState.obstacleShape === "rect") {
                /* rect : création par drag, gérée après hit-test (hit.type == null) */
              } else {
                if (drawState.obstacleShape === "polygon") {
                  var activeObs = CALPINAGE_STATE.activeObstacle;
                  if (activeObs.points.length >= 3) {
                    var firstScreen = imageToScreen(activeObs.points[0]);
                    var distToFirst = Math.hypot(screen.x - firstScreen.x, screen.y - firstScreen.y);
                    if (distToFirst <= CLOSE_THRESHOLD_PX) {
                      var pts = activeObs.points.slice();
                      var id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "obs-" + Date.now();
                      CALPINAGE_STATE.obstacles.push({
                        id: id,
                        points: pts,
                        kind: "polygon",
                        roofRole: "obstacle"
                      });
                      drawState.selectedObstacleIndex = CALPINAGE_STATE.obstacles.length - 1;
                      activeObs.points = [];
                      activeObs.hover = null;
                      saveCalpinageState();
                      if (typeof recomputeAllPlacementBlocksFromRules === "function") recomputeAllPlacementBlocksFromRules();
                      if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
                      return;
                    }
                  }
                  var snapped = snapPointToGeometry(imgPt, CALPINAGE_STATE.contours, CALPINAGE_STATE.traits, CALPINAGE_STATE.ridges, SNAP_DIST_PX, activeObs.points);
                  var pt = snapped ? { x: snapped.x, y: snapped.y } : { x: imgPt.x, y: imgPt.y };
                  if (activeObs.points.length === 0) {
                    activeObs.points = [{ x: pt.x, y: pt.y }];
                    activeObs.hover = null;
                    setInteractionState(InteractionStates.CREATING);
                  } else {
                    activeObs.points.push({ x: pt.x, y: pt.y });
                    activeObs.hover = null;
                  }
                  if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
                  return;
                }
              }
            }
            /* Hit-test unifié : roofExtensions → shadowVolumes → obstacles → ridge → trait → mesure → contour — UNIFIED-HITTEST-WIRED */
            var hit = unifiedHitTest({
              screenPt: screen,
              screenToImage: screenToImage,
              imageToScreen: imageToScreen,
              obstacles: CALPINAGE_STATE.obstacles || [],
              roofExtensions: CALPINAGE_STATE.roofExtensions || [],
              shadowVolumes: CALPINAGE_STATE.shadowVolumes || [],
              context: {
                activeTool: drawState.activeTool,
                phase: CALPINAGE_STATE.currentPhase,
                ridges: CALPINAGE_STATE.ridges || [],
                traits: CALPINAGE_STATE.traits || [],
                measures: CALPINAGE_STATE.measures || [],
                contours: CALPINAGE_STATE.contours || [],
                resolveRidgePoint: resolveRidgePoint,
                metersPerPixel: (CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.scale && CALPINAGE_STATE.roof.scale.metersPerPixel) || 1,
                vpScale: vp.scale,
                selectedObstacleIndex: drawState.selectedObstacleIndex,
              },
            });
            /* 🔥 PRIORITÉ : test des handles obstacle AVANT désélection */
            if (
              drawState.activeTool === "select" &&
              drawState.selectedObstacleIndex != null &&
              hit && hit.type == null
            ) {
              var selIdx = drawState.selectedObstacleIndex;
              var obstacles = CALPINAGE_STATE.obstacles;
              var obsAtSel = obstacles && obstacles[selIdx];

              if (obsAtSel && CalpinageCanvas.hitTestObstacleHandles) {
                var hasShapeMeta = obsAtSel.shapeMeta && (obsAtSel.shapeMeta.originalType === "circle" || obsAtSel.shapeMeta.originalType === "rect");
                if (hasShapeMeta) {
                  var handleHit = CalpinageCanvas.hitTestObstacleHandles(
                    screen,
                    obsAtSel,
                    imageToScreen,
                    vp.scale
                  );

                  if (handleHit) {
                    drawState.draggingObstacleHandle = handleHit.handle;
                    var o = obsAtSel;
                    var m = o.shapeMeta || {};
                    var center = { x: m.centerX, y: m.centerY };
                    var resizeStart;
                    if (handleHit.handle === "rotate") {
                      setInteractionState(InteractionStates.ROTATING);
                      resizeStart = {
                        index: selIdx,
                        cx: center.x,
                        cy: center.y,
                        startAngle: typeof m.angle === "number" ? m.angle : 0,
                        startMouseAngle: Math.atan2(imgPt.y - center.y, imgPt.x - center.x),
                      };
                      drawState.resizeObstacleStart = resizeStart;
                      startInteraction({
                        type: "rotateObstacle",
                        target: o,
                        initialState: JSON.parse(JSON.stringify(o)),
                        meta: { handle: "rotate", index: selIdx, resizeStart: resizeStart },
                      });
                    } else {
                      setInteractionState(InteractionStates.RESIZING);
                      resizeStart = { index: selIdx, shapeMeta: JSON.parse(JSON.stringify(m)) };
                      if (m.originalType === "rect" && typeof handleHit.handle === "number") {
                        var hw0 = m.width / 2, hh0 = m.height / 2;
                        var opp = handleHit.handle === 0 ? 2 : handleHit.handle === 1 ? 3 : handleHit.handle === 2 ? 0 : 1;
                        var cornersLocal = [{ x: -hw0, y: -hh0 }, { x: hw0, y: -hh0 }, { x: hw0, y: hh0 }, { x: -hw0, y: hh0 }];
                        resizeStart.startCenter = { x: center.x, y: center.y };
                        resizeStart.startWidth = m.width;
                        resizeStart.startHeight = m.height;
                        resizeStart.startAngle = typeof m.angle === "number" ? m.angle : 0;
                        resizeStart.oppositeLocal = { x: cornersLocal[opp].x, y: cornersLocal[opp].y };
                      }
                      drawState.resizeObstacleStart = resizeStart;
                      startInteraction({
                        type: "resizeObstacle",
                        target: o,
                        initialState: JSON.parse(JSON.stringify(o)),
                        meta: { handle: handleHit.handle, index: selIdx, shapeMeta: JSON.parse(JSON.stringify(m)) },
                      });
                    }
                    if (canvasEl && e.pointerId != null && canvasEl.setPointerCapture) {
                      canvasEl.setPointerCapture(e.pointerId);
                      drawState.activePointerId = e.pointerId;
                    }
                    if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
                    return;
                  }
                }
              }
            }
            /* DÉSÉLECTION PROPRE AU CLIC VIDE — reset complet quand aucun hit détecté (Phase 2 centralisation) */
            if (hit && hit.type == null) {
              if (
                drawState.activeTool === "obstacle" &&
                drawState.obstacleShape === "circle"
              ) {
                var imgCircle = screenToImage(screen);
                drawState.obstacleCircleStartPoint = imgCircle;
                var idCircle = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "obs-" + Date.now();
                var ptsCircle = obstacleCircleToPoints(imgCircle.x, imgCircle.y, 0);
                CALPINAGE_STATE.obstacles.push({
                  id: idCircle,
                  type: "polygon",
                  points: ptsCircle,
                  shapeMeta: { originalType: "circle", centerX: imgCircle.x, centerY: imgCircle.y, radius: 0 },
                });
                drawState.obstacleCircleTempIndex = CALPINAGE_STATE.obstacles.length - 1;
                drawState.dragMode = "circleCreation";
                setInteractionState(InteractionStates.CREATING);
                if (canvasEl && e.pointerId != null && canvasEl.setPointerCapture) canvasEl.setPointerCapture(e.pointerId);
                if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
                return;
              }
              if (drawState.activeTool === "obstacle" && drawState.obstacleShape === "rect") {
                drawState.obstacleRectStartPoint = { x: imgPt.x, y: imgPt.y };
                var id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "obs-" + Date.now();
                var pts = obstacleRectToPoints(imgPt.x, imgPt.y, 0.01, 0.01);
                CALPINAGE_STATE.obstacles.push({
                  id: id,
                  type: "polygon",
                  points: pts,
                  shapeMeta: { originalType: "rect", centerX: imgPt.x, centerY: imgPt.y, width: 0, height: 0 },
                });
                drawState.obstacleRectTempIndex = CALPINAGE_STATE.obstacles.length - 1;
                drawState.dragMode = "rectangleCreation";
                setInteractionState(InteractionStates.CREATING);
                if (canvasEl && e.pointerId != null && canvasEl.setPointerCapture) canvasEl.setPointerCapture(e.pointerId);
                saveCalpinageState();
                if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
                return;
              }
              clearSelection();
              drawState.dragMode = null;
              drawState.draggingObstacleOffset = null;
              drawState.draggingObstacleHandle = null;
              if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
            }
            /* Phase 2 — Outil Obstacle : clic sur obstacle existant = sélection + drag (pose uniquement) */
            if (drawState.activeTool === "obstacle" && !drawState.obstacleShape && hit && hit.type === "obstacle") {
              selectEntityFromHit(hit);
              var obs = hit.data.obstacle;
              var ref = CalpinageCanvas.getObstacleCenter ? CalpinageCanvas.getObstacleCenter(obs) : ((obs.shapeMeta && typeof obs.shapeMeta.centerX === "number") ? { x: obs.shapeMeta.centerX, y: obs.shapeMeta.centerY } : (obs.points && obs.points.length ? (function () { var cx = 0, cy = 0; obs.points.forEach(function (p) { cx += p.x; cy += p.y; }); return { x: cx / obs.points.length, y: cy / obs.points.length }; }()) : { x: 0, y: 0 }));
              CALPINAGE_STATE.selectedPanId = null;
              CALPINAGE_STATE.editingPanId = null;
              CALPINAGE_STATE.selectedPointId = null;
              updatePansListUI();
              CALPINAGE_STATE.selected = { type: null, id: null, pointIndex: null };
              drawState.selectedContourIds = [];
              drawState.selectedRidgeIds = [];
              drawState.selectedTraitIds = [];
              var offsetSelect = { dx: imgPt.x - ref.x, dy: imgPt.y - ref.y };
              drawState.draggingObstacleOffset = offsetSelect;
              setInteractionState(InteractionStates.DRAGGING);
              startInteraction({
                type: "dragObstacle",
                target: obs,
                initialState: JSON.parse(JSON.stringify(obs)),
                meta: { index: hit.index, offset: offsetSelect },
              });
              if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
              return;
            }
            /* Outil Contour b??ti ??? comportement DP4 : clic = point, fermeture par double-clic ou clic proche du premier */
            if (drawState.activeTool === "contour") {
              var activeContour = CALPINAGE_STATE.activeContour;
              if (activeContour.points.length >= 3) {
                var firstScreen = imageToScreen(activeContour.points[0]);
                var distToFirst = Math.hypot(screen.x - firstScreen.x, screen.y - firstScreen.y);
                if (distToFirst <= CLOSE_THRESHOLD_PX) {
                  var pts = activeContour.points.slice();
                  CALPINAGE_STATE.contours.push({
                    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "c-" + Date.now(),
                    points: pts,
                    closed: true,
                  });
                  activeContour.points = [];
                  activeContour.hoverPoint = null;
                  saveCalpinageState();
                  if (typeof updateValidateButton === "function") updateValidateButton();
                  return;
                }
              }
              /* Sélection contextuelle : si hit.type === "contour", laisser drag (ne pas ajouter de point) */
              if (hit && hit.type === "contour") {
                var hcContour = { contourIndex: hit.index, vertexIndex: hit.subType === "vertex" ? hit.data.vertexIndex : null, segmentIndex: hit.subType === "segment" ? hit.data.segmentIndex : null };
                if (hcContour && hcContour.contourIndex >= 0) {
                  drawState.selectedContourIndex = hcContour.contourIndex;
                  if (typeof hcContour.vertexIndex === "number") {
                    drawState.draggingVertexIndex = hcContour.vertexIndex;
                    drawState.dragMode = "contour-vertex";
                    drawState.dragBase = { contourIndex: drawState.selectedContourIndex, vertexIndex: drawState.draggingVertexIndex };
                    drawState.dragLastMouseImg = { x: imgPt.x, y: imgPt.y };
                    drawState.snapPreview = null;
                  }
                  if (hcContour.vertexIndex === null && typeof hcContour.segmentIndex === "number") {
                    var contour = CALPINAGE_STATE.contours[hcContour.contourIndex];
                    if (contour && contour.points && contour.roofRole !== "chienAssis") {
                      var prevPt = contour.points[hcContour.segmentIndex];
                      var nextPt = contour.points[(hcContour.segmentIndex + 1) % contour.points.length];
                      var interpH = (typeof prevPt.h === "number" && typeof nextPt.h === "number") ? (prevPt.h + nextPt.h) / 2 : (typeof prevPt.h === "number" ? prevPt.h : (typeof nextPt.h === "number" ? nextPt.h : DEFAULT_HEIGHT_GUTTER));
                      var newPt = clonePointPreserveHeight({ x: imgPt.x, y: imgPt.y });
                      contour.points.splice(hcContour.segmentIndex + 1, 0, newPt);
                      var fc = (CALPINAGE_STATE.contours || []).filter(function (c) { return c.roofRole !== "chienAssis"; });
                      var ci = fc.indexOf(contour);
                      if (ci >= 0) applyHeightToSelectedPoints(interpH, [{ type: "contour", index: ci, pointIndex: hcContour.segmentIndex + 1 }]);
                      if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
                    }
                  }
                  return;
                }
              }
              if (activeContour.points.length === 0) {
                drawState.selectedContourIndex = null;
                var snapped = snapPointToGeometry(imgPt, CALPINAGE_STATE.contours, CALPINAGE_STATE.traits, CALPINAGE_STATE.ridges, SNAP_DIST_PX);
                var pt = snapped ? { x: snapped.x, y: snapped.y } : { x: imgPt.x, y: imgPt.y };
                activeContour.points = [{ x: pt.x, y: pt.y }];
                activeContour.hoverPoint = null;
                return;
              }
              var snapped = snapPointToGeometry(imgPt, CALPINAGE_STATE.contours, CALPINAGE_STATE.traits, CALPINAGE_STATE.ridges, SNAP_DIST_PX, activeContour.points);
              var pt = snapped ? { x: snapped.x, y: snapped.y } : { x: imgPt.x, y: imgPt.y };
              activeContour.points.push({ x: pt.x, y: pt.y });
              activeContour.hoverPoint = null;
              return;
            }
            /* Outil Mesure ??? s?lection d'une mesure existante ou cr?ation (clic A puis clic B) */
            if (drawState.activeTool === "mesure") {
              if (drawState.measureLineStart == null) {
                var hmMesure = hit.type === "mesure" ? hit.index : -1;
                if (hmMesure >= 0) {
                  drawState.selectedMesureIndex = hmMesure;
                  drawState.selectedContourIndex = null;
                  drawState.selectedRidgeIndex = null;
                  drawState.selectedTraitIndex = null;
                  drawState.draggingMesureStartImage = { x: imgPt.x, y: imgPt.y };
                  if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
                  console.log("[MD] return mesure hit existing", hmMesure);
                  return;
                }
                drawState.measureLineStart = { x: imgPt.x, y: imgPt.y };
                console.log("[MD] return mesure first point");
                return;
              }
              CALPINAGE_STATE.measures.push({
                id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "m-" + Date.now(),
                a: { x: drawState.measureLineStart.x, y: drawState.measureLineStart.y },
                b: { x: imgPt.x, y: imgPt.y },
              });
              drawState.measureLineStart = null;
              saveCalpinageState();
              console.log("[MD] return mesure segment done");
              return;
            }
            /* Outil Trait ??? 2 clics = ligne ouverte (ar??te g?om?trique), snap automatique prioritaire ; attach stock? pour hauteurs (contour/fa??tage). */
            if (drawState.activeTool === "trait") {
              /* S?lection contextuelle : clic sur trait existant = s?lection/drag sans ajouter de point */
              if (hit && hit.type === "trait") {
                var ht = { traitIndex: hit.index, pointIndex: hit.subType === "segment" ? "segment" : hit.data.pointIndex };
                drawState.selectedRoofExtensionIndex = null;
                var tSel = CALPINAGE_STATE.traits[ht.traitIndex];
                CALPINAGE_STATE.selectedPanId = null;
                CALPINAGE_STATE.editingPanId = null;
                CALPINAGE_STATE.selectedPointId = null;
                updatePansListUI();
                CALPINAGE_STATE.selected = { type: "trait", id: ht.traitIndex, pointIndex: ht.pointIndex };
                drawState.selectedTraitIndex = ht.traitIndex;
                drawState.selectedTraitIds = (tSel && tSel.id) ? [tSel.id] : [];
                drawState.selectedContourIds = [];
                drawState.selectedRidgeIds = [];
                drawState.selectedContourIndex = null;
                drawState.selectedMesureIndex = null;
                drawState.selectedRidgeIndex = null;
                drawState.selectedObstacleIndex = null;
                drawState.draggingObstacleOffset = null;
                drawState.draggingRidgePoint = null;
                drawState.draggingRidgeOffset = null;
                drawState.draggingVertexIndex = null;
                drawState.draggingMesureStartImage = null;
                drawState.draggingTraitPoint = ht.pointIndex;
                if (ht.pointIndex === "segment") {
                  var traitSel = CALPINAGE_STATE.traits[ht.traitIndex];
                  drawState.draggingTraitSegmentStart = { a: { x: traitSel.a.x, y: traitSel.a.y }, b: { x: traitSel.b.x, y: traitSel.b.y }, mouse: { x: imgPt.x, y: imgPt.y } };
                  drawState.dragMode = "trait-move";
                  drawState.dragBase = { traitIndex: ht.traitIndex };
                  drawState.dragLastMouseImg = { x: imgPt.x, y: imgPt.y };
                } else {
                  drawState.draggingTraitSegmentStart = null;
                  drawState.dragMode = ht.pointIndex === 0 ? "trait-endA" : "trait-endB";
                  drawState.dragBase = { traitIndex: ht.traitIndex };
                  drawState.dragLastMouseImg = null;
                }
                requestAnimationFrame(render);
                return;
              }
              var buildingContours = (CALPINAGE_STATE.contours || []).filter(function (c) { return c.roofRole !== "chienAssis"; });
              var snapEdge = snapToAllRoofEdges(imgPt, 15);
              var snapped = snapPointToGeometry(imgPt, CALPINAGE_STATE.contours, CALPINAGE_STATE.traits, CALPINAGE_STATE.ridges, SNAP_DIST_PX);
              var pt = snapEdge ? { x: snapEdge.x, y: snapEdge.y } : (snapped ? { x: snapped.x, y: snapped.y } : { x: imgPt.x, y: imgPt.y });
              if (drawState.traitLineStart == null) {
                if (!snapEdge && !snapped) drawState.traitHintMessageUntil = Date.now() + 800;
                drawState.traitLineStart = { x: pt.x, y: pt.y, source: snapped && snapped.source ? snapped.source : null };
                drawState.lastMouseImage = { x: pt.x, y: pt.y };
                requestAnimationFrame(render);
                return;
              }
              var start = drawState.traitLineStart;
              var aAttach = start.source || null;
              var bAttach = snapped && snapped.source ? snapped.source : null;
              var newTrait = {
                id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "t-" + Date.now(),
                a: { x: start.x, y: start.y, attach: aAttach },
                b: { x: pt.x, y: pt.y, attach: bAttach },
              };
              CALPINAGE_STATE.traits.push(newTrait);
              var ft = (CALPINAGE_STATE.traits || []).filter(function (t) { return t.roofRole !== "chienAssis"; });
              var ti = ft.length - 1;
              if (newTrait.a && typeof newTrait.a.h !== "number") applyHeightToSelectedPoints(getTraitEndpointHeight(newTrait.a, newTrait.a, CALPINAGE_STATE), [{ type: "trait", index: ti, pointIndex: 0 }]);
              if (newTrait.b && typeof newTrait.b.h !== "number") applyHeightToSelectedPoints(getTraitEndpointHeight(newTrait.b, newTrait.b, CALPINAGE_STATE), [{ type: "trait", index: ti, pointIndex: 1 }]);
              drawState.traitLineStart = null;
              drawState.traitSnapPreview = null;
              drawState.traitSnapPreviewSource = null;
              drawState.traitSnapEdge = null;
              saveCalpinageState();
              requestAnimationFrame(render);
              return;
            }
            /* Outil Fa??tage ??? 2 points sur contour ou trait ; au clic on valide le point snap? au hover si pr?sent (collage ? l?approche). */
            if (drawState.activeTool === "ridge") {
              /* S?lection contextuelle : clic sur ridge existant = s?lection/drag sans ajouter de point */
              if (hit && hit.type === "ridge") {
                var hr = { ridgeIndex: hit.index, pointIndex: hit.subType === "vertex" ? hit.data.pointIndex : null };
                drawState.selectedRoofExtensionIndex = null;
                var rSel = CALPINAGE_STATE.ridges[hr.ridgeIndex];
                CALPINAGE_STATE.selectedPanId = null;
                CALPINAGE_STATE.editingPanId = null;
                CALPINAGE_STATE.selectedPointId = null;
                updatePansListUI();
                CALPINAGE_STATE.selected = { type: "ridge", id: hr.ridgeIndex, pointIndex: hr.pointIndex };
                drawState.selectedRidgeIndex = hr.ridgeIndex;
                drawState.selectedRidgeIds = (rSel && rSel.id) ? [rSel.id] : [];
                drawState.selectedContourIds = [];
                drawState.selectedTraitIds = [];
                drawState.selectedContourIndex = null;
                drawState.selectedMesureIndex = null;
                drawState.selectedTraitIndex = null;
                drawState.selectedObstacleIndex = null;
                drawState.draggingObstacleOffset = null;
                drawState.draggingVertexIndex = null;
                drawState.draggingMesureStartImage = null;
                drawState.draggingTraitPoint = null;
                drawState.draggingTraitSegmentStart = null;
                var ridge = CALPINAGE_STATE.ridges[hr.ridgeIndex];
                var ra = resolveRidgePoint(ridge.a);
                if (hr.pointIndex === null) {
                  drawState.draggingRidgePoint = null;
                  drawState.draggingRidgeOffset = { dx: imgPt.x - ra.x, dy: imgPt.y - ra.y };
                  drawState.dragMode = "ridge-move";
                  drawState.dragBase = {
                    ridgeIndex: drawState.selectedRidgeIndex,
                    a: { x: ridge.a.x, y: ridge.a.y, attach: ridge.a.attach || null },
                    b: { x: ridge.b.x, y: ridge.b.y, attach: ridge.b.attach || null }
                  };
                  drawState.dragLastMouseImg = { x: imgPt.x, y: imgPt.y };
                } else {
                  drawState.draggingRidgePoint = hr.pointIndex;
                  drawState.draggingRidgeOffset = null;
                  drawState.dragMode = drawState.draggingRidgePoint === 0 ? "ridge-endA" : "ridge-endB";
                  drawState.dragBase = { ridgeIndex: drawState.selectedRidgeIndex, end: drawState.draggingRidgePoint === 0 ? "a" : "b" };
                  drawState.dragLastMouseImg = null;
                }
                requestAnimationFrame(render);
                return;
              }
              var activeRidge = CALPINAGE_STATE.activeRidge;
              var buildingContours = (CALPINAGE_STATE.contours || []).filter(function (c) { return c.roofRole !== "chienAssis"; });
              var snapEdge = snapToRoofContourEdge(imgPt, buildingContours, 15);
              var snapped = snapEdge ? { x: snapEdge.x, y: snapEdge.y, source: null } : (activeRidge.hoverSnap ? { x: activeRidge.hoverSnap.point.x, y: activeRidge.hoverSnap.point.y, source: activeRidge.hoverSnap.source || null } : snapPointToGeometry(imgPt, CALPINAGE_STATE.contours, CALPINAGE_STATE.traits, CALPINAGE_STATE.ridges, SNAP_DIST_PX));
              if (!snapped) {
                if (!activeRidge.a) {
                  drawState.ridgeHintMessageUntil = Date.now() + 800;
                  requestAnimationFrame(render);
                  setTimeout(function () { requestAnimationFrame(render); }, 850);
                }
                return;
              }
              if (!activeRidge.a) {
                activeRidge.a = { x: snapped.x, y: snapped.y, attach: snapped.source || null };
              } else {
                activeRidge.b = { x: snapped.x, y: snapped.y, attach: snapped.source || null };
                CALPINAGE_STATE.ridges.push({
                  id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : "r-" + Date.now(),
                  a: { x: activeRidge.a.x, y: activeRidge.a.y, attach: activeRidge.a.attach || null },
                  b: { x: activeRidge.b.x, y: activeRidge.b.y, attach: activeRidge.b.attach || null },
                  roofRole: "main",
                });
                activeRidge.a = null;
                activeRidge.b = null;
                activeRidge.hover = null;
                activeRidge.hoverSnap = null;
                activeRidge.snapEdge = null;
                recomputeRoofPlanes();
                saveCalpinageState();
                if (typeof updateValidateButton === "function") updateValidateButton();
              }
              console.log("[MD] return ridge");
              return;
            }
            /* Outil S?lection ??? extension toiture (chien assis) puis obstacles, fa??tages, traits, contours ; clic vide = pan */
            if (drawState.activeTool === "select") {
              /* Phase 2 — Centralisation : sélection via selectEntityFromHit */
              if (hit && hit.type != null) {
                selectEntityFromHit(hit);
              } else {
                clearSelection();
              }
              /* Mode édition obstacle — handles AVANT vertex/segment/drag (fix resize coin rectangle) */
              if ((hit && (hit.type === "obstacle-vertex" || hit.type === "obstacle-segment" || hit.type === "obstacle")) || drawState.selectedObstacleIndex != null) {
                var obstacles = CALPINAGE_STATE.obstacles || [];
                var selIdx = drawState.selectedObstacleIndex;
                var obsAtSel =
                  selIdx !== null &&
                  CALPINAGE_STATE.obstacles &&
                  selIdx >= 0 &&
                  selIdx < CALPINAGE_STATE.obstacles.length
                    ? obstacles[selIdx]
                    : null;
                var hasShapeMeta = obsAtSel && obsAtSel.shapeMeta && (obsAtSel.shapeMeta.originalType === "circle" || obsAtSel.shapeMeta.originalType === "rect");
                /* 1️⃣ Test handles AVANT tout drag du corps — coin → resize, handle rotation → rotate */
                if (obsAtSel && CalpinageCanvas.hitTestObstacleHandles && hasShapeMeta) {
                  var handleHit = CalpinageCanvas.hitTestObstacleHandles(screen, obsAtSel, imageToScreen, vp.scale);
                  if (handleHit) {
                    drawState.draggingObstacleHandle = handleHit.handle;
                    var o = obsAtSel;
                    var m = o.shapeMeta || {};
                    var center = { x: m.centerX, y: m.centerY };
                    var resizeStart;
                    if (handleHit.handle === "rotate") {
                      setInteractionState(InteractionStates.ROTATING);
                      resizeStart = {
                        index: selIdx,
                        cx: center.x,
                        cy: center.y,
                        startAngle: typeof m.angle === "number" ? m.angle : 0,
                        startMouseAngle: Math.atan2(imgPt.y - center.y, imgPt.x - center.x),
                      };
                      drawState.resizeObstacleStart = resizeStart;
                      startInteraction({
                        type: "rotateObstacle",
                        target: o,
                        initialState: JSON.parse(JSON.stringify(o)),
                        meta: { handle: "rotate", index: selIdx, resizeStart: resizeStart },
                      });
                    } else {
                      setInteractionState(InteractionStates.RESIZING);
                      resizeStart = { index: selIdx, shapeMeta: JSON.parse(JSON.stringify(m)) };
                      if (m.originalType === "rect" && typeof handleHit.handle === "number") {
                        var hw0 = m.width / 2, hh0 = m.height / 2;
                        var opp = handleHit.handle === 0 ? 2 : handleHit.handle === 1 ? 3 : handleHit.handle === 2 ? 0 : 1;
                        var cornersLocal = [{ x: -hw0, y: -hh0 }, { x: hw0, y: -hh0 }, { x: hw0, y: hh0 }, { x: -hw0, y: hh0 }];
                        resizeStart.startCenter = { x: center.x, y: center.y };
                        resizeStart.startWidth = m.width;
                        resizeStart.startHeight = m.height;
                        resizeStart.startAngle = typeof m.angle === "number" ? m.angle : 0;
                        resizeStart.oppositeLocal = { x: cornersLocal[opp].x, y: cornersLocal[opp].y };
                      }
                      drawState.resizeObstacleStart = resizeStart;
                      startInteraction({
                        type: "resizeObstacle",
                        target: o,
                        initialState: JSON.parse(JSON.stringify(o)),
                        meta: { handle: handleHit.handle, index: selIdx, shapeMeta: JSON.parse(JSON.stringify(m)) },
                      });
                    }
                    if (canvasEl && e.pointerId != null && canvasEl.setPointerCapture) {
                      canvasEl.setPointerCapture(e.pointerId);
                      drawState.activePointerId = e.pointerId;
                    }
                    if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
                    return;
                  }
                }
                /* 2️⃣ Sinon vertex (polygone sans shapeMeta) */
                if (hit && hit.type === "obstacle-vertex" && hit.obstacleIndex != null && hit.vertexIndex != null) {
                  drawState.selectedVertexIndex = hit.vertexIndex;
                  drawState.draggingVertex = { obstacleIndex: hit.obstacleIndex, vertexIndex: hit.vertexIndex };
                  setInteractionState(InteractionStates.DRAGGING);
                  if (canvasEl && e.pointerId != null && canvasEl.setPointerCapture) canvasEl.setPointerCapture(e.pointerId);
                  return;
                }
                /* 3️⃣ Segment (polygone) */
                if (hit && hit.type === "obstacle-segment") {
                  var o = CALPINAGE_STATE.obstacles[hit.obstacleIndex];
                  var insertIndex = hit.segmentIndex + 1;
                  o.points.splice(insertIndex, 0, { x: imgPt.x, y: imgPt.y });
                  drawState.draggingVertex = { obstacleIndex: hit.obstacleIndex, vertexIndex: insertIndex };
                  setInteractionState(InteractionStates.DRAGGING);
                  if (canvasEl && e.pointerId != null && canvasEl.setPointerCapture) canvasEl.setPointerCapture(e.pointerId);
                  if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
                  return;
                }
                /* 4️⃣ Drag corps */
                if (hit && hit.type === "obstacle") {
                  CALPINAGE_STATE.selectedPanId = null;
                  updatePansListUI();
                  CALPINAGE_STATE.selected = { type: null, id: null, pointIndex: null };
                  drawState.selectedObstacleIndex = hit.index;
                  drawState.selectedContourIds = [];
                  drawState.selectedRidgeIds = [];
                  drawState.selectedTraitIds = [];
                  drawState.selectedContourIndex = null;
                  drawState.selectedMesureIndex = null;
                  drawState.selectedRidgeIndex = null;
                  drawState.selectedTraitIndex = null;
                  drawState.draggingObstacleHandle = null;
                  drawState.resizeObstacleStart = null;
                  var obs = hit.data.obstacle;
                  var ref = (obs.shapeMeta && typeof obs.shapeMeta.centerX === "number") ? { x: obs.shapeMeta.centerX, y: obs.shapeMeta.centerY } : (obs.points && obs.points.length ? (function () { var cx = 0, cy = 0; obs.points.forEach(function (p) { cx += p.x; cy += p.y; }); return { x: cx / obs.points.length, y: cy / obs.points.length }; }()) : { x: 0, y: 0 });
                  var offset = { dx: imgPt.x - ref.x, dy: imgPt.y - ref.y };
                  drawState.draggingObstacleOffset = offset;
                  setInteractionState(InteractionStates.DRAGGING);
                  startInteraction({
                    type: "dragObstacle",
                    target: obs,
                    initialState: JSON.parse(JSON.stringify(obs)),
                    meta: { index: hit.index, offset: offset },
                  });
                  return;
                }
                drawState.selectedObstacleIndex = null;
                drawState.draggingObstacleOffset = null;
                drawState.draggingObstacleHandle = null;
                drawState.resizeObstacleStart = null;
                CALPINAGE_STATE.selected = { type: null, id: null, pointIndex: null };
                return;
              }
              if (hit && hit.type === "roofExtension") {
                var rxHitCompat = { rxIndex: hit.index, type: hit.subType === "body" ? "body" : "contour", subtype: hit.subType, index: (hit.data && (hit.data.vertexIndex != null || hit.data.segmentIndex != null)) ? (hit.data.vertexIndex ?? hit.data.segmentIndex) : 0, pointRef: hit.data && hit.data.pointRef };
                drawState.selectedRoofExtensionIndex = rxHitCompat.rxIndex;
                drawState.selectedContourIndex = null;
                drawState.selectedRidgeIndex = null;
                drawState.selectedTraitIndex = null;
                drawState.selectedObstacleIndex = null;
                drawState.selectedContourIds = [];
                drawState.selectedRidgeIds = [];
                drawState.selectedTraitIds = [];
                if (rxHitCompat.type !== "body" && rxHitCompat.pointRef) {
                  drawState.dragMode = "roofExtensionVertex";
                  drawState.dragBase = { rxIndex: rxHitCompat.rxIndex, type: rxHitCompat.type, subtype: rxHitCompat.subtype, index: rxHitCompat.index, pointRef: rxHitCompat.pointRef };
                  drawState.dragOffset = { dx: rxHitCompat.pointRef.x - imgPt.x, dy: rxHitCompat.pointRef.y - imgPt.y };
                  drawState.dragLastMouseImg = { x: imgPt.x, y: imgPt.y };
                  drawState.rxDragSnap = null;
                  drawState.snapPreview = null;
                } else {
                  drawState.dragMode = null;
                  drawState.dragBase = null;
                }
                if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
                console.log("[MD] return select hit roofExtension", rxHitCompat.type, rxHitCompat.subtype);
                return;
              }
              drawState.isSelectingBox = true;
              drawState.selectionBoxStart = screenToImage(screen);
              drawState.selectionBoxEnd = null;
              var obstacles = CALPINAGE_STATE.obstacles || [];
              /* [DEV] window.CALPINAGE_DEBUG_MEASURE = true pour logs clics mesure */
              if (window.CALPINAGE_DEBUG_MEASURE) {
                var _hm = hit.type === "mesure" ? hit.index : -1;
                var _hc = hit.type === "contour" ? { contourIndex: hit.index } : null;
                console.log("[MD mesure]", "tool=" + drawState.activeTool, "hitMesure=" + _hm, "hitContour=" + (_hc ? _hc.contourIndex : "null"), "selectedMesureIndex=" + drawState.selectedMesureIndex, "isSelectingBox=" + drawState.isSelectingBox);
              }
              if (hit.type === "ridge") {
                var hr = { ridgeIndex: hit.index, pointIndex: hit.subType === "vertex" ? hit.data.pointIndex : null };
                drawState.selectedRoofExtensionIndex = null;
                var rSel = CALPINAGE_STATE.ridges[hr.ridgeIndex];
                CALPINAGE_STATE.selectedPanId = null;
                CALPINAGE_STATE.editingPanId = null;
                CALPINAGE_STATE.selectedPointId = null;
                updatePansListUI();
                CALPINAGE_STATE.selected = { type: "ridge", id: hr.ridgeIndex, pointIndex: hr.pointIndex };
                drawState.selectedRidgeIndex = hr.ridgeIndex;
                drawState.selectedRidgeIds = (rSel && rSel.id) ? [rSel.id] : [];
                drawState.selectedContourIds = [];
                drawState.selectedTraitIds = [];
                drawState.selectedContourIndex = null;
                drawState.selectedMesureIndex = null;
                drawState.selectedTraitIndex = null;
                drawState.selectedObstacleIndex = null;
                drawState.draggingObstacleOffset = null;
                drawState.draggingVertexIndex = null;
                drawState.draggingMesureStartImage = null;
                drawState.draggingTraitPoint = null;
                drawState.draggingTraitSegmentStart = null;
                var ridge = CALPINAGE_STATE.ridges[hr.ridgeIndex];
                var ra = resolveRidgePoint(ridge.a);
                if (hr.pointIndex === null) {
                  drawState.draggingRidgePoint = null;
                  drawState.draggingRidgeOffset = { dx: imgPt.x - ra.x, dy: imgPt.y - ra.y };
                  drawState.dragMode = "ridge-move";
                  drawState.dragBase = {
                    ridgeIndex: drawState.selectedRidgeIndex,
                    a: { x: ridge.a.x, y: ridge.a.y, attach: ridge.a.attach || null },
                    b: { x: ridge.b.x, y: ridge.b.y, attach: ridge.b.attach || null }
                  };
                  drawState.dragLastMouseImg = { x: imgPt.x, y: imgPt.y };
                } else {
                  drawState.draggingRidgePoint = hr.pointIndex;
                  drawState.draggingRidgeOffset = null;
                  drawState.dragMode = drawState.draggingRidgePoint === 0 ? "ridge-endA" : "ridge-endB";
                  drawState.dragBase = { ridgeIndex: drawState.selectedRidgeIndex, end: drawState.draggingRidgePoint === 0 ? "a" : "b" };
                  drawState.dragLastMouseImg = null;
                }
                console.log("[MD] return select hit ridge");
                return;
              }
              if (hit.type === "trait") {
                var ht = { traitIndex: hit.index, pointIndex: hit.subType === "segment" ? "segment" : hit.data.pointIndex };
                drawState.selectedRoofExtensionIndex = null;
                var tSel = CALPINAGE_STATE.traits[ht.traitIndex];
                CALPINAGE_STATE.selectedPanId = null;
                CALPINAGE_STATE.editingPanId = null;
                CALPINAGE_STATE.selectedPointId = null;
                updatePansListUI();
                CALPINAGE_STATE.selected = { type: "trait", id: ht.traitIndex, pointIndex: ht.pointIndex };
                drawState.selectedTraitIndex = ht.traitIndex;
                drawState.selectedTraitIds = (tSel && tSel.id) ? [tSel.id] : [];
                drawState.selectedContourIds = [];
                drawState.selectedRidgeIds = [];
                drawState.selectedContourIndex = null;
                drawState.selectedMesureIndex = null;
                drawState.selectedRidgeIndex = null;
                drawState.selectedObstacleIndex = null;
                drawState.draggingObstacleOffset = null;
                drawState.draggingRidgePoint = null;
                drawState.draggingRidgeOffset = null;
                drawState.draggingVertexIndex = null;
                drawState.draggingMesureStartImage = null;
                drawState.draggingTraitPoint = ht.pointIndex;
                if (ht.pointIndex === "segment") {
                  var traitSel = CALPINAGE_STATE.traits[ht.traitIndex];
                  drawState.draggingTraitSegmentStart = { a: { x: traitSel.a.x, y: traitSel.a.y }, b: { x: traitSel.b.x, y: traitSel.b.y }, mouse: { x: imgPt.x, y: imgPt.y } };
                  drawState.dragMode = "trait-move";
                  drawState.dragBase = { traitIndex: ht.traitIndex };
                  drawState.dragLastMouseImg = { x: imgPt.x, y: imgPt.y };
                } else {
                  drawState.draggingTraitSegmentStart = null;
                  drawState.dragMode = ht.pointIndex === 0 ? "trait-endA" : "trait-endB";
                  drawState.dragBase = { traitIndex: ht.traitIndex };
                  drawState.dragLastMouseImg = null;
                }
                console.log("[MD] return select hit trait");
                return;
              }
              /* Priorité mesure avant contour : clics consécutifs sur mesures doivent mettre à jour la sélection même si mesure dessinée sur un contour */
              if (hit.type === "mesure") {
                drawState.selectedRoofExtensionIndex = null;
                CALPINAGE_STATE.selectedPanId = null;
                CALPINAGE_STATE.editingPanId = null;
                CALPINAGE_STATE.selectedPointId = null;
                updatePansListUI();
                CALPINAGE_STATE.selected = { type: null, id: null, pointIndex: null };
                drawState.isSelectingBox = false;
                drawState.selectionBoxStart = null;
                drawState.selectionBoxEnd = null;
                drawState.selectedMesureIndex = hit.index;
                drawState.selectedContourIds = [];
                drawState.selectedRidgeIds = [];
                drawState.selectedTraitIds = [];
                drawState.selectedContourIndex = null;
                drawState.selectedRidgeIndex = null;
                drawState.selectedTraitIndex = null;
                drawState.selectedObstacleIndex = null;
                drawState.draggingObstacleOffset = null;
                drawState.draggingRidgePoint = null;
                drawState.draggingRidgeOffset = null;
                drawState.draggingTraitPoint = null;
                drawState.draggingTraitSegmentStart = null;
                drawState.draggingMesureStartImage = { x: imgPt.x, y: imgPt.y };
                if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
                console.log("[MD] return select hit mesure");
                return;
              }
              if (hit.type === "contour") {
                var hc = { contourIndex: hit.index, vertexIndex: hit.subType === "vertex" ? hit.data.vertexIndex : null, segmentIndex: hit.subType === "segment" ? hit.data.segmentIndex : null };
                drawState.selectedRoofExtensionIndex = null;
                var cSel = CALPINAGE_STATE.contours[hc.contourIndex];
                CALPINAGE_STATE.selectedPanId = null;
                CALPINAGE_STATE.editingPanId = null;
                CALPINAGE_STATE.selectedPointId = null;
                updatePansListUI();
                CALPINAGE_STATE.selected = { type: null, id: null, pointIndex: null };
                drawState.selectedContourIndex = hc.contourIndex;
                drawState.selectedContourIds = (cSel && cSel.id) ? [cSel.id] : [];
                drawState.selectedRidgeIds = [];
                drawState.selectedTraitIds = [];
                drawState.selectedMesureIndex = null;
                drawState.selectedRidgeIndex = null;
                drawState.selectedTraitIndex = null;
                drawState.selectedObstacleIndex = null;
                drawState.draggingObstacleOffset = null;
                drawState.draggingRidgePoint = null;
                drawState.draggingRidgeOffset = null;
                drawState.draggingTraitPoint = null;
                drawState.draggingTraitSegmentStart = null;
                if (typeof hc.vertexIndex === "number") {
                  drawState.draggingVertexIndex = hc.vertexIndex;
                  drawState.dragMode = "contour-vertex";
                  drawState.dragBase = { contourIndex: drawState.selectedContourIndex, vertexIndex: drawState.draggingVertexIndex };
                  drawState.dragLastMouseImg = { x: imgPt.x, y: imgPt.y };
                  drawState.snapPreview = null;
                }
                console.log("[MD] return select hit contour");
                return;
              }
              var hitPan = hitTestPan(imgPt);
              if (!CALPINAGE_STATE.heightEditMode && !hitPan && !CALPINAGE_STATE.editingPanId) {
                drawState.selectedRoofExtensionIndex = null;
                CALPINAGE_STATE.selectedPanId = null;
                if (typeof CalpinagePans !== "undefined" && CalpinagePans.panState) CalpinagePans.panState.activePanId = null;
                CALPINAGE_STATE.selected = { type: null, id: null, pointIndex: null };
                drawState.isSelectingBox = false;
                drawState.selectionBoxStart = null;
                drawState.selectionBoxEnd = null;
                drawState.selectedContourIndex = null;
                drawState.selectedMesureIndex = null;
                drawState.selectedRidgeIndex = null;
                drawState.selectedTraitIndex = null;
                drawState.selectedContourIds = [];
                drawState.selectedRidgeIds = [];
                drawState.selectedTraitIds = [];
                drawState.selectedObstacleIndex = null;
                updatePansListUI();
                if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
                return;
              }
              if (CALPINAGE_STATE.editingPanId) {
                var editPan = CALPINAGE_STATE.pans.filter(function (p) { return p.id === CALPINAGE_STATE.editingPanId; })[0];
                var hitVert = editPan ? hitTestPanVertex(screen, editPan) : null;
                if (hitVert) {
                  CALPINAGE_STATE.selectedPointId = hitVert.panId + "-" + hitVert.pointIndex;
                  updatePansListUI();
                  requestAnimationFrame(render);
                  console.log("[MD] return select hit pan vertex");
                  return;
                }
                if (hitPan && hitPan.id === CALPINAGE_STATE.editingPanId) {
                  /* Clic sur le pan en ?dition mais pas sur un sommet : garder l??tat */
                  requestAnimationFrame(render);
                  return;
                }
                /* Clic hors pan en ?dition : quitter le mode ?dition */
                CALPINAGE_STATE.editingPanId = null;
                CALPINAGE_STATE.selectedPointId = null;
                if (!hitPan) {
                  CALPINAGE_STATE.selectedPanId = null;
                  if (typeof CalpinagePans !== "undefined" && CalpinagePans.panState) CalpinagePans.panState.activePanId = null;
                }
                updatePansListUI();
                requestAnimationFrame(render);
                if (hitPan) {
                  CALPINAGE_STATE.selectedPanId = hitPan.id;
                  if (typeof CalpinagePans !== "undefined" && CalpinagePans.recomputePanPhysicalProps) CalpinagePans.recomputePanPhysicalProps(hitPan, getStateForPans());
                  updatePansListUI();
                  drawState.selectedContourIds = [];
                  drawState.selectedRidgeIds = [];
                  drawState.selectedTraitIds = [];
                  drawState.selectedContourIndex = null;
                  drawState.selectedMesureIndex = null;
                  drawState.selectedRidgeIndex = null;
                  drawState.selectedTraitIndex = null;
                  drawState.selectedObstacleIndex = null;
                }
                CALPINAGE_STATE.selected = { type: null, id: null, pointIndex: null };
                console.log("[MD] exit edit pan");
                return;
              }
              if (hitPan) {
                CALPINAGE_STATE.selectedPanId = hitPan.id;
                if (typeof CalpinagePans !== "undefined" && CalpinagePans.panState) CalpinagePans.panState.activePanId = hitPan.id;
                CALPINAGE_STATE.selectedPointId = null;
                if (typeof CalpinagePans !== "undefined" && CalpinagePans.recomputePanPhysicalProps) CalpinagePans.recomputePanPhysicalProps(hitPan, getStateForPans());
                updatePansListUI();
                CALPINAGE_STATE.selected = { type: null, id: null, pointIndex: null };
                drawState.selectedContourIds = [];
                drawState.selectedRidgeIds = [];
                drawState.selectedTraitIds = [];
                drawState.selectedContourIndex = null;
                drawState.selectedMesureIndex = null;
                drawState.selectedRidgeIndex = null;
                drawState.selectedTraitIndex = null;
                drawState.selectedObstacleIndex = null;
                drawState.draggingObstacleOffset = null;
                drawState.draggingRidgePoint = null;
                drawState.draggingRidgeOffset = null;
                drawState.draggingVertexIndex = null;
                drawState.draggingMesureStartImage = null;
                drawState.draggingTraitPoint = null;
                drawState.draggingTraitSegmentStart = null;
                console.log("[MD] return select hit pan");
                return;
              }
              CALPINAGE_STATE.selected = { type: null, id: null, pointIndex: null };
              CALPINAGE_STATE.selectedPanId = null;
              if (typeof CalpinagePans !== "undefined" && CalpinagePans.panState) CalpinagePans.panState.activePanId = null;
              CALPINAGE_STATE.editingPanId = null;
              CALPINAGE_STATE.selectedPointId = null;
              CALPINAGE_STATE.selectedHeightPoint = null;
              drawState.selectedContourIndex = null;
              drawState.selectedMesureIndex = null;
              drawState.selectedRidgeIndex = null;
              drawState.selectedTraitIndex = null;
              drawState.selectedContourIds = [];
              drawState.selectedRidgeIds = [];
              drawState.selectedTraitIds = [];
                drawState.selectedObstacleIndex = null;
                drawState.draggingObstacleOffset = null;
                drawState.draggingRidgePoint = null;
              drawState.draggingRidgeOffset = null;
              drawState.draggingVertexIndex = null;
              drawState.draggingMesureStartImage = null;
              drawState.draggingTraitPoint = null;
              drawState.draggingTraitSegmentStart = null;
              updatePansListUI();
              if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
              console.log("[MD] select fallthrough (no hit)");
            }
          });

          addSafeListener(canvasEl, "dblclick", function (e) {
            e.preventDefault();
            if (CALPINAGE_STATE.roofExtensions && CALPINAGE_STATE.roofExtensions.length > 0) {
              var imgPt = screenToImage(getMouseScreen(e));
              for (var i = CALPINAGE_STATE.roofExtensions.length - 1; i >= 0; i--) {
                var rx = CALPINAGE_STATE.roofExtensions[i];
                if (rx.ridge && hitTestRidge(imgPt, rx.ridge, 8)) {
                  openDormerHeightOverlay(rx, i);
                  return;
                }
              }
            }
            /* SHADOW VOLUME OVERLAY — Phase 2 + Phase 3 */
            if (
              (CALPINAGE_STATE.currentPhase === "ROOF_EDIT" || CALPINAGE_STATE.currentPhase === "PV_LAYOUT") &&
              drawState.selectedShadowVolumeIndex != null &&
              CALPINAGE_STATE.shadowVolumes &&
              drawState.selectedShadowVolumeIndex >= 0 &&
              drawState.selectedShadowVolumeIndex < CALPINAGE_STATE.shadowVolumes.length
            ) {
              var screenDb = getMouseScreen(e);
              var imgPtDb = screenToImage(screenDb);
              var svHitDb = hitTestShadowVolume(imgPtDb);
              if (svHitDb && svHitDb.index === drawState.selectedShadowVolumeIndex && typeof window.showShadowVolumeOverlay === "function") {
                window.showShadowVolumeOverlay(svHitDb.index, svHitDb.volume);
                return;
              }
            }
            if (drawState.activeTool === "select") {
              var screen = getMouseScreen(e);
              var imgPt = screenToImage(screen);
              var hitPan = hitTestPan(imgPt);
              if (hitPan && CALPINAGE_STATE.selectedPanId === hitPan.id) {
                CALPINAGE_STATE.editingPanId = hitPan.id;
                CALPINAGE_STATE.selectedPointId = null;
                updatePansListUI();
                requestAnimationFrame(render);
                console.log("[MD] enter pan edit mode");
                return;
              }
              return;
            }
            if (
              drawState.activeTool === "select" &&
              drawState.selectedObstacleIndex != null &&
              CALPINAGE_STATE.obstacles &&
              drawState.selectedObstacleIndex >= 0 &&
              drawState.selectedObstacleIndex < CALPINAGE_STATE.obstacles.length
            ) {
              var obstacles = CALPINAGE_STATE.obstacles || [];
              var o = obstacles[drawState.selectedObstacleIndex];
              if (o && o.shapeMeta && (o.shapeMeta.originalType === "circle" || o.shapeMeta.originalType === "rect")) {
                var mpp = (CALPINAGE_STATE.validatedRoofData && CALPINAGE_STATE.validatedRoofData.scale && CALPINAGE_STATE.validatedRoofData.scale.metersPerPixel) ? CALPINAGE_STATE.validatedRoofData.scale.metersPerPixel : (CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.scale && CALPINAGE_STATE.roof.scale.metersPerPixel) ? CALPINAGE_STATE.roof.scale.metersPerPixel : null;
                if (mpp && mpp > 0 && typeof window.showObstacleDimOverlay === "function") {
                  window.showObstacleDimOverlay(drawState.selectedObstacleIndex, o, mpp, function () { saveCalpinageState(); if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER); });
                }
                return;
              }
              return;
            }
            if (drawState.activeTool !== "contour") return;
            var activeContour = CALPINAGE_STATE.activeContour;
            if (activeContour.points.length >= 3) {
              var pts = activeContour.points.slice();
              while (pts.length > 3 && Math.hypot(pts[pts.length - 1].x - pts[pts.length - 2].x, pts[pts.length - 1].y - pts[pts.length - 2].y) < 2) {
                pts.pop();
              }
              CALPINAGE_STATE.contours.push({
                id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "c-" + Date.now(),
                points: pts,
                closed: true,
              });
              activeContour.points = [];
              activeContour.hoverPoint = null;
              saveCalpinageState();
              if (typeof updateValidateButton === "function") updateValidateButton();
            }
          });

          var handleWindowMousemove = function (e) {
            var screen = getMouseScreen(e);
            var imgPt = screenToImage(screen);
            if (drawState.draggingObstacleHandle != null && drawState.resizeObstacleStart != null) {
              var MIN_OBSTACLE_PX = 10;
              var obsList = CALPINAGE_STATE.obstacles || [];
              var start = drawState.resizeObstacleStart;
              var o = obsList[start.index];
              if (!o || !o.shapeMeta) return;
              var m = o.shapeMeta;
              var h = drawState.draggingObstacleHandle;
              if (h === "rotate") {
                var a = Math.atan2(imgPt.y - start.cy, imgPt.x - start.cx);
                m.angle = start.startAngle + (a - start.startMouseAngle);
                obstacleRecalcFromShapeMeta(o);
                updateInteraction({ imgPt: { x: imgPt.x, y: imgPt.y }, angle: m.angle });
                return;
              }
              if (m.originalType === "circle" && h === "radius") {
                var r = Math.hypot(imgPt.x - m.centerX, imgPt.y - m.centerY);
                m.radius = Math.max(MIN_OBSTACLE_PX, r);
                obstacleRecalcFromShapeMeta(o);
                updateInteraction({ imgPt: { x: imgPt.x, y: imgPt.y }, radius: m.radius });
                return;
              }
              if (m.originalType === "rect" && typeof h === "number" && start.oppositeLocal) {
                var cx0 = start.startCenter.x, cy0 = start.startCenter.y;
                var a0 = start.startAngle;
                var c = Math.cos(a0), s = Math.sin(a0);
                var dx = imgPt.x - cx0, dy = imgPt.y - cy0;
                var mouseLocalX = dx * c + dy * s;
                var mouseLocalY = -dx * s + dy * c;
                var ox = start.oppositeLocal.x, oy = start.oppositeLocal.y;
                var newW = Math.max(MIN_OBSTACLE_PX, Math.abs(mouseLocalX - ox));
                var newH = Math.max(MIN_OBSTACLE_PX, Math.abs(mouseLocalY - oy));
                if (e.shiftKey) {
                  var sq = Math.max(newW, newH);
                  newW = sq;
                  newH = sq;
                }
                var newCenterLocalX = (mouseLocalX + ox) / 2;
                var newCenterLocalY = (mouseLocalY + oy) / 2;
                var newCenterWorldX = cx0 + newCenterLocalX * c - newCenterLocalY * s;
                var newCenterWorldY = cy0 + newCenterLocalX * s + newCenterLocalY * c;
                m.width = newW;
                m.height = newH;
                m.centerX = newCenterWorldX;
                m.centerY = newCenterWorldY;
                obstacleRecalcFromShapeMeta(o);
                updateInteraction({ imgPt: { x: imgPt.x, y: imgPt.y }, width: newW, height: newH });
                return;
              }
              return;
            }
            if (drawState.draggingVertex) {
              var dv = drawState.draggingVertex;
              var obsListV = CALPINAGE_STATE.obstacles || [];
              var oV = obsListV[dv.obstacleIndex];
              if (oV && oV.points && oV.points[dv.vertexIndex]) {
                oV.points[dv.vertexIndex].x = imgPt.x;
                oV.points[dv.vertexIndex].y = imgPt.y;
                if (typeof requestAnimationFrame !== "undefined" && typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
              }
              return;
            }
            if (
              drawState.draggingObstacleOffset != null &&
              drawState.selectedObstacleIndex != null &&
              CALPINAGE_STATE.obstacles &&
              drawState.selectedObstacleIndex >= 0 &&
              drawState.selectedObstacleIndex < CALPINAGE_STATE.obstacles.length
            ) {
              var obsList = CALPINAGE_STATE.obstacles || [];
              var o = obsList[drawState.selectedObstacleIndex];
              if (o) {
                var off = drawState.draggingObstacleOffset;
                if (o.shapeMeta) {
                  var newX = imgPt.x - off.dx, newY = imgPt.y - off.dy;
                  o.shapeMeta.centerX = newX;
                  o.shapeMeta.centerY = newY;
                  obstacleRecalcFromShapeMeta(o);
                  drawState.draggingObstacleOffset = { dx: imgPt.x - newX, dy: imgPt.y - newY };
                  updateInteraction({ imgPt: { x: imgPt.x, y: imgPt.y }, center: { x: newX, y: newY } });
                } else if (o.points && o.points.length) {
                  var ref = { x: 0, y: 0 };
                  o.points.forEach(function (p) { ref.x += p.x; ref.y += p.y; });
                  ref.x /= o.points.length;
                  ref.y /= o.points.length;
                  var dx = (imgPt.x - off.dx) - ref.x, dy = (imgPt.y - off.dy) - ref.y;
                  o.points.forEach(function (p) { p.x += dx; p.y += dy; });
                  updateInteraction({ imgPt: { x: imgPt.x, y: imgPt.y }, points: o.points });
                }
              }
              return;
            }
            if (drawState.dragMode === "roofExtensionVertex" && drawState.dragBase) {
              var base = drawState.dragBase;
              var rxList = CALPINAGE_STATE.roofExtensions || [];
              var rx = rxList[base.rxIndex];
              if (!rx || !base.pointRef) return;

              var off = drawState.dragOffset || { dx: 0, dy: 0 };
              var imgTarget = { x: imgPt.x + off.dx, y: imgPt.y + off.dy };
              base.pointRef.x = imgTarget.x;
              base.pointRef.y = imgTarget.y;

              if (e && e.ctrlKey) {
                drawState.rxDragSnap = null;
              } else {
                softSnapRoofExtensionVertex(imgTarget, base.pointRef, base.rxIndex, (vp && typeof vp.scale === "number") ? vp.scale : 1, false);
              }
              drawState.snapPreview = null;

              window.CALPINAGE_RENDER();
              return;
            }
            if (drawState.dragMode === "contour-vertex" && drawState.dragBase) {
              var ci = drawState.dragBase.contourIndex;
              var vi = drawState.dragBase.vertexIndex;
              var c = (CALPINAGE_STATE.contours || [])[ci];
              if (!c || !c.points || c.points[vi] == null) return;

              // 1) position r?elle = souris (fluide, pixel par pixel) — préserver h
              c.points[vi] = clonePointPreserveHeight(c.points[vi], { x: imgPt.x, y: imgPt.y });

              // 2) snap VISUEL uniquement (aimant) ??? MAIS on ignore le snap sur le m??me contour (sinon auto-accroche ? ses propres segments/sommets)
              var sp = snapPointToGeometry(
                imgPt,
                CALPINAGE_STATE.contours,
                CALPINAGE_STATE.traits,
                CALPINAGE_STATE.ridges,
                SNAP_DIST_PX
              );

              // Filtrage : refuser snap vers le contour en cours (source = contour m??me index)
              if (sp && sp.source && sp.source.type === "contour" && sp.source.contourIndex === ci) {
                sp = null;
              }

              drawState.snapPreview = sp ? { x: sp.x, y: sp.y } : null;

              // 3) pendant drag : PAS de recompute, PAS de save
              return;
            }
            if (drawState.draggingMesureStartImage !== null && drawState.selectedMesureIndex !== null) {
              var m = CALPINAGE_STATE.measures[drawState.selectedMesureIndex];
              if (m && m.a && m.b) {
                var start = drawState.draggingMesureStartImage;
                var dx = imgPt.x - start.x;
                var dy = imgPt.y - start.y;
                m.a.x += dx; m.a.y += dy;
                m.b.x += dx; m.b.y += dy;
                drawState.draggingMesureStartImage = { x: imgPt.x, y: imgPt.y };
                saveCalpinageState();
              }
              return;
            }
            if (drawState.dragMode === "ridge-move" && drawState.dragBase) {
              var base = drawState.dragBase;
              var idx = base.ridgeIndex;
              var list = CALPINAGE_STATE.ridges || [];
              var r = list[idx];
              if (r) {
                var dx = imgPt.x - drawState.dragLastMouseImg.x;
                var dy = imgPt.y - drawState.dragLastMouseImg.y;
                drawState.dragLastMouseImg = { x: imgPt.x, y: imgPt.y };
                r.a.x += dx; r.a.y += dy;
                r.b.x += dx; r.b.y += dy;
                recomputeRoofPlanes();
                saveCalpinageState();
              }
              return;
            }
            if (drawState.dragMode === "ridge-endA" && drawState.dragBase) {
              var r = (CALPINAGE_STATE.ridges || [])[drawState.dragBase.ridgeIndex];
              if (!r) return;

              r.a.x = imgPt.x;
              r.a.y = imgPt.y;

              var sp = snapPointToGeometry(
                imgPt,
                CALPINAGE_STATE.contours,
                CALPINAGE_STATE.traits,
                CALPINAGE_STATE.ridges,
                SNAP_DIST_PX
              );
              drawState.snapPreview = sp ? { x: sp.x, y: sp.y } : null;

              return;
            }
            if (drawState.dragMode === "ridge-endB" && drawState.dragBase) {
              var r = (CALPINAGE_STATE.ridges || [])[drawState.dragBase.ridgeIndex];
              if (!r) return;

              r.b.x = imgPt.x;
              r.b.y = imgPt.y;

              var sp = snapPointToGeometry(
                imgPt,
                CALPINAGE_STATE.contours,
                CALPINAGE_STATE.traits,
                CALPINAGE_STATE.ridges,
                SNAP_DIST_PX
              );
              drawState.snapPreview = sp ? { x: sp.x, y: sp.y } : null;

              return;
            }
            if (drawState.dragMode === "trait-move" && drawState.dragBase) {
              var list = CALPINAGE_STATE.traits || [];
              var t = list[drawState.dragBase.traitIndex];
              if (t) {
                var dx = imgPt.x - drawState.dragLastMouseImg.x;
                var dy = imgPt.y - drawState.dragLastMouseImg.y;
                drawState.dragLastMouseImg = { x: imgPt.x, y: imgPt.y };
                t.a.x += dx; t.a.y += dy;
                t.b.x += dx; t.b.y += dy;
                recomputeRoofPlanes();
                saveCalpinageState();
              }
              return;
            }
            if (drawState.dragMode === "trait-endA" && drawState.dragBase) {
              var t = (CALPINAGE_STATE.traits || [])[drawState.dragBase.traitIndex];
              if (!t) return;

              t.a.x = imgPt.x;
              t.a.y = imgPt.y;

              var sp = snapPointToGeometry(
                imgPt,
                CALPINAGE_STATE.contours,
                CALPINAGE_STATE.traits,
                CALPINAGE_STATE.ridges,
                SNAP_DIST_PX
              );
              drawState.snapPreview = sp ? { x: sp.x, y: sp.y } : null;

              return;
            }
            if (drawState.dragMode === "trait-endB" && drawState.dragBase) {
              var t = (CALPINAGE_STATE.traits || [])[drawState.dragBase.traitIndex];
              if (!t) return;

              t.b.x = imgPt.x;
              t.b.y = imgPt.y;

              var sp = snapPointToGeometry(
                imgPt,
                CALPINAGE_STATE.contours,
                CALPINAGE_STATE.traits,
                CALPINAGE_STATE.ridges,
                SNAP_DIST_PX
              );
              drawState.snapPreview = sp ? { x: sp.x, y: sp.y } : null;

              return;
            }
            if (panStart) {
              var dx = e.clientX - panStart.x;
              var dy = e.clientY - panStart.y;
              panStart = { x: e.clientX, y: e.clientY };
              vp.pan(dx, dy);
              if (canvasEl) canvasEl.style.cursor = "grabbing";
            }
            if (drawState.isSelectingBox && drawState.selectionBoxStart) {
              drawState.selectionBoxEnd = screenToImage(screen);
            }
          };
          window.addEventListener("mousemove", handleWindowMousemove);
          function handlePointerOrMouseUp(e) {
            if (drawState.dragMode === "circleCreation") {
              var obsCircleUp = CALPINAGE_STATE.obstacles[drawState.obstacleCircleTempIndex];
              if (!obsCircleUp || !obsCircleUp.shapeMeta || (obsCircleUp.shapeMeta.radius || 0) < 3) {
                CALPINAGE_STATE.obstacles.pop();
                if (typeof saveCalpinageState === "function") saveCalpinageState();
              } else {
                drawState.selectedObstacleIndex = drawState.obstacleCircleTempIndex;
                drawState.activeTool = "select";
                if (typeof saveCalpinageState === "function") saveCalpinageState();
                if (typeof recomputeAllPlacementBlocksFromRules === "function") recomputeAllPlacementBlocksFromRules();
              }
              drawState.dragMode = null;
              drawState.obstacleCircleStartPoint = null;
              drawState.obstacleCircleTempIndex = null;
              if (canvasEl && e.pointerId != null && canvasEl.releasePointerCapture) {
                try { canvasEl.releasePointerCapture(e.pointerId); } catch (_) {}
              }
              if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
              resetInteractionState();
              return;
            }
            if (drawState.dragMode === "rectangleCreation") {
              var obstacles = CALPINAGE_STATE.obstacles || [];
              var idx = drawState.obstacleRectTempIndex;
              var obs = idx != null && idx >= 0 && idx < obstacles.length ? obstacles[idx] : null;
              var sp = drawState.obstacleRectStartPoint;
              if (obs && obs.shapeMeta && sp) {
                var dx = obs.shapeMeta.width || 0;
                var dy = obs.shapeMeta.height || 0;
                var ww = Math.abs(dx);
                var hh = Math.abs(dy);
                if (ww >= 3 && hh >= 3) {
                  var cx = sp.x + dx / 2;
                  var cy = sp.y + dy / 2;
                  obs.shapeMeta.centerX = cx;
                  obs.shapeMeta.centerY = cy;
                  obs.shapeMeta.width = ww;
                  obs.shapeMeta.height = hh;
                  obs.points = obstacleRectToPoints(cx, cy, ww, hh);
                  drawState.selectedObstacleIndex = idx;
                  drawState.activeTool = "select";
                  if (typeof saveCalpinageState === "function") saveCalpinageState();
                  if (typeof recomputeAllPlacementBlocksFromRules === "function") recomputeAllPlacementBlocksFromRules();
                } else {
                  obstacles.splice(idx, 1);
                  drawState.selectedObstacleIndex = null;
                  if (typeof saveCalpinageState === "function") saveCalpinageState();
                }
              }
              drawState.dragMode = null;
              drawState.obstacleRectStartPoint = null;
              drawState.obstacleRectTempIndex = null;
              if (canvasEl && e.pointerId != null && canvasEl.releasePointerCapture) {
                try { canvasEl.releasePointerCapture(e.pointerId); } catch (_) {}
              }
              if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
              resetInteractionState();
              return;
            }
            if (drawState.isPlacingShadowVolume) {
              drawState.isPlacingShadowVolume = false;
              drawState.shadowVolumePlaceStart = null;
              window.CALPINAGE_MODE = null;
              drawState.shadowVolumeCreateShape = null;
              if (canvasEl && e.pointerId != null && canvasEl.releasePointerCapture) {
                try { canvasEl.releasePointerCapture(e.pointerId); } catch (_) {}
              }
              if (canvasEl) canvasEl.style.cursor = "default";
              if (typeof saveCalpinageState === "function") saveCalpinageState();
              if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
              resetInteractionState();
              return;
            }
            if (drawState.draggingShadowVolumeMove) {
              drawState.draggingShadowVolumeMove = false;
              drawState.shadowVolumeMoveStart = null;
              if (canvasEl && e.pointerId != null && canvasEl.releasePointerCapture) {
                try { canvasEl.releasePointerCapture(e.pointerId); } catch (_) {}
              }
              if (typeof saveCalpinageState === "function") saveCalpinageState();
              if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
              resetInteractionState();
              return;
            }
            if (CALPINAGE_STATE && CALPINAGE_STATE.currentPhase === "PV_LAYOUT" && window.CALPINAGE_IS_MANIPULATING) {
              var ENG = window.pvPlacementEngine;
              if (ENG && typeof ENG.commitManipulation === "function") ENG.commitManipulation();
              window.CALPINAGE_IS_MANIPULATING = false;
              calpinageHandleDrag = null;
              if (e && e.pointerId != null && typeof canvasEl !== "undefined" && canvasEl) { try { canvasEl.releasePointerCapture(e.pointerId); } catch(_) {} }
              if (typeof pvSyncSaveRender === "function") pvSyncSaveRender();
              else if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
              /* ne pas return -> laisser le cleanup général (snapPreview, dragMode, etc.) s'exécuter */
            }
            if (e.button === 0) {
              if (CALPINAGE_STATE.currentPhase === "PV_LAYOUT" && window.CALPINAGE_IS_MANIPULATING) {
                var ENG = window.pvPlacementEngine;
                if (ENG && typeof ENG.commitManipulation === "function") ENG.commitManipulation();
                window.CALPINAGE_IS_MANIPULATING = false;
                calpinageHandleDrag = null;
                if (typeof pvSyncSaveRender === "function") pvSyncSaveRender();
                else if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
                if (e.pointerId != null && canvasEl) { try { canvasEl.releasePointerCapture(e.pointerId); } catch(_) {} }
              }
              /* Ne pas r?initialiser traitLineStart / measureLineStart ici : le 2e clic doit compl?ter le segment (trait ou mesure). */
              if (drawState.isSelectingBox && drawState.selectionBoxStart && drawState.selectionBoxEnd) {
                var startScreen = imageToScreen(drawState.selectionBoxStart);
                var endScreen = getMouseScreen(e);
                var distPx = Math.hypot(endScreen.x - startScreen.x, endScreen.y - startScreen.y);
                if (distPx >= 5) {
                  var a = drawState.selectionBoxStart;
                  var b = drawState.selectionBoxEnd;
                  var minX = Math.min(a.x, b.x);
                  var minY = Math.min(a.y, b.y);
                  var maxX = Math.max(a.x, b.x);
                  var maxY = Math.max(a.y, b.y);
                  drawState.selectedContourIds = [];
                  drawState.selectedRidgeIds = [];
                  drawState.selectedTraitIds = [];
                  drawState.selectedContourIndex = null;
                  drawState.selectedRidgeIndex = null;
                  drawState.selectedTraitIndex = null;
                  CALPINAGE_STATE.contours.forEach(function (c) {
                    if (!c || !c.points || c.points.length < 2) return;
                    var pts = c.points;
                    var hit = false;
                    for (var i = 0; i < pts.length - 1; i++) {
                      if (segIntersectsBox(pts[i], pts[i + 1], minX, minY, maxX, maxY)) { hit = true; break; }
                    }
                    if (!hit && c.closed && pts.length >= 2) {
                      if (segIntersectsBox(pts[pts.length - 1], pts[0], minX, minY, maxX, maxY)) hit = true;
                    }
                    if (hit) drawState.selectedContourIds.push(c.id);
                  });
                  CALPINAGE_STATE.ridges.forEach(function (r) {
                    if (!r || !r.a || !r.b) return;
                    var raPt = resolveRidgePoint(r.a);
                    var rbPt = resolveRidgePoint(r.b);
                    if (segIntersectsBox(raPt, rbPt, minX, minY, maxX, maxY)) drawState.selectedRidgeIds.push(r.id);
                  });
                  CALPINAGE_STATE.traits.forEach(function (t) {
                    if (!t || !t.a || !t.b) return;
                    if (segIntersectsBox(t.a, t.b, minX, minY, maxX, maxY)) drawState.selectedTraitIds.push(t.id);
                  });
                }
              }
              drawState.isSelectingBox = false;
              drawState.selectionBoxStart = null;
              drawState.selectionBoxEnd = null;
              panStart = null;
              if (drawState.dragMode === "ridge-move" && drawState.dragBase) {
                var base = drawState.dragBase;
                var list = CALPINAGE_STATE.ridges || [];
                var r = list[base.ridgeIndex];
                if (r) {
                  var aSn = snapPointToGeometry({ x: r.a.x, y: r.a.y }, CALPINAGE_STATE.contours, CALPINAGE_STATE.traits, CALPINAGE_STATE.ridges, SNAP_DIST_PX);
                  var bSn = snapPointToGeometry({ x: r.b.x, y: r.b.y }, CALPINAGE_STATE.contours, CALPINAGE_STATE.traits, CALPINAGE_STATE.ridges, SNAP_DIST_PX);
                  if (aSn) { r.a.x = aSn.x; r.a.y = aSn.y; r.a.attach = aSn.source || null; } else { r.a.attach = null; }
                  if (bSn) { r.b.x = bSn.x; r.b.y = bSn.y; r.b.attach = bSn.source || null; } else { r.b.attach = null; }
                  recomputeRoofPlanes();
                  saveCalpinageState();
                }
              }
              if (drawState.dragMode === "ridge-endA" && drawState.dragBase) {
                var r = (CALPINAGE_STATE.ridges || [])[drawState.dragBase.ridgeIndex];
                if (r) {
                  var aSn = snapPointToGeometry({ x: r.a.x, y: r.a.y }, CALPINAGE_STATE.contours, CALPINAGE_STATE.traits, CALPINAGE_STATE.ridges, SNAP_DIST_PX);
                  if (aSn) { r.a.x = aSn.x; r.a.y = aSn.y; r.a.attach = aSn.source || null; } else { r.a.attach = null; }
                  recomputeRoofPlanes();
                  saveCalpinageState();
                }
              }
              if (drawState.dragMode === "ridge-endB" && drawState.dragBase) {
                var r = (CALPINAGE_STATE.ridges || [])[drawState.dragBase.ridgeIndex];
                if (r) {
                  var bSn = snapPointToGeometry({ x: r.b.x, y: r.b.y }, CALPINAGE_STATE.contours, CALPINAGE_STATE.traits, CALPINAGE_STATE.ridges, SNAP_DIST_PX);
                  if (bSn) { r.b.x = bSn.x; r.b.y = bSn.y; r.b.attach = bSn.source || null; } else { r.b.attach = null; }
                  recomputeRoofPlanes();
                  saveCalpinageState();
                }
              }
              if (drawState.dragMode === "trait-move" && drawState.dragBase) {
                var t = (CALPINAGE_STATE.traits || [])[drawState.dragBase.traitIndex];
                if (t) {
                  var aSn = snapPointToGeometry({ x: t.a.x, y: t.a.y }, CALPINAGE_STATE.contours, CALPINAGE_STATE.traits, CALPINAGE_STATE.ridges, SNAP_DIST_PX);
                  var bSn = snapPointToGeometry({ x: t.b.x, y: t.b.y }, CALPINAGE_STATE.contours, CALPINAGE_STATE.traits, CALPINAGE_STATE.ridges, SNAP_DIST_PX);
                  if (aSn) { t.a.x = aSn.x; t.a.y = aSn.y; t.a.attach = aSn.source || null; } else { t.a.attach = null; }
                  if (bSn) { t.b.x = bSn.x; t.b.y = bSn.y; t.b.attach = bSn.source || null; } else { t.b.attach = null; }
                  var ftIdx = (CALPINAGE_STATE.traits || []).filter(function (x) { return x.roofRole !== "chienAssis"; }).indexOf(t);
                  if (ftIdx >= 0) {
                    if (typeof t.a.h !== "number") applyHeightToSelectedPoints(getTraitEndpointHeight(t.a, t.a, CALPINAGE_STATE), [{ type: "trait", index: ftIdx, pointIndex: 0 }]);
                    if (typeof t.b.h !== "number") applyHeightToSelectedPoints(getTraitEndpointHeight(t.b, t.b, CALPINAGE_STATE), [{ type: "trait", index: ftIdx, pointIndex: 1 }]);
                  }
                  recomputeRoofPlanes();
                  saveCalpinageState();
                }
              }
              if (drawState.dragMode === "trait-endA" && drawState.dragBase) {
                var t = (CALPINAGE_STATE.traits || [])[drawState.dragBase.traitIndex];
                if (t) {
                  var aSn = snapPointToGeometry({ x: t.a.x, y: t.a.y }, CALPINAGE_STATE.contours, CALPINAGE_STATE.traits, CALPINAGE_STATE.ridges, SNAP_DIST_PX);
                  if (aSn) { t.a.x = aSn.x; t.a.y = aSn.y; t.a.attach = aSn.source || null; } else { t.a.attach = null; }
                  var ftIdx = (CALPINAGE_STATE.traits || []).filter(function (x) { return x.roofRole !== "chienAssis"; }).indexOf(t);
                  if (ftIdx >= 0 && typeof t.a.h !== "number") applyHeightToSelectedPoints(getTraitEndpointHeight(t.a, t.a, CALPINAGE_STATE), [{ type: "trait", index: ftIdx, pointIndex: 0 }]);
                  recomputeRoofPlanes();
                  saveCalpinageState();
                }
              }
              if (drawState.dragMode === "trait-endB" && drawState.dragBase) {
                var t = (CALPINAGE_STATE.traits || [])[drawState.dragBase.traitIndex];
                if (t) {
                  var bSn = snapPointToGeometry({ x: t.b.x, y: t.b.y }, CALPINAGE_STATE.contours, CALPINAGE_STATE.traits, CALPINAGE_STATE.ridges, SNAP_DIST_PX);
                  if (bSn) { t.b.x = bSn.x; t.b.y = bSn.y; t.b.attach = bSn.source || null; } else { t.b.attach = null; }
                  var ftIdx = (CALPINAGE_STATE.traits || []).filter(function (x) { return x.roofRole !== "chienAssis"; }).indexOf(t);
                  if (ftIdx >= 0 && typeof t.b.h !== "number") applyHeightToSelectedPoints(getTraitEndpointHeight(t.b, t.b, CALPINAGE_STATE), [{ type: "trait", index: ftIdx, pointIndex: 1 }]);
                  recomputeRoofPlanes();
                  saveCalpinageState();
                }
              }
              if (drawState.dragMode === "roofExtensionVertex" && drawState.dragBase) {
                var baseRx = drawState.dragBase;
                var rxList = CALPINAGE_STATE.roofExtensions || [];
                var rx = rxList[baseRx.rxIndex];

                if (rx && baseRx.pointRef) {
                  if (!(e && e.ctrlKey) && (e && e.shiftKey) && drawState.rxDragSnap && drawState.rxDragSnap.active && drawState.rxDragSnap.x != null && drawState.rxDragSnap.y != null) {
                    baseRx.pointRef.x = drawState.rxDragSnap.x;
                    baseRx.pointRef.y = drawState.rxDragSnap.y;
                  }
                  if (typeof saveCalpinageState === "function") saveCalpinageState();
                  if (typeof recomputeAllPlacementBlocksFromRules === "function") {
                    recomputeAllPlacementBlocksFromRules(true);
                  }
                  window.CALPINAGE_RENDER();
                }

                drawState.snapPreview = null;
                drawState.dragMode = null;
                drawState.dragBase = null;
                drawState.dragOffset = null;
                drawState.rxDragSnap = null;
              }
              if (drawState.dragMode === "contour-vertex" && drawState.dragBase) {
                var ci = drawState.dragBase.contourIndex;
                var vi = drawState.dragBase.vertexIndex;
                var c = (CALPINAGE_STATE.contours || [])[ci];
                if (c && c.points && c.points[vi]) {
                  var cur = { x: c.points[vi].x, y: c.points[vi].y };

                  var sp = snapPointToGeometry(
                    cur,
                    CALPINAGE_STATE.contours,
                    CALPINAGE_STATE.traits,
                    CALPINAGE_STATE.ridges,
                    SNAP_DIST_PX
                  );

                  // Filtrage : ne pas snapper sur le m??me contour
                  if (sp && sp.source && sp.source.type === "contour" && sp.source.contourIndex === ci) {
                    sp = null;
                  }

                  if (sp) c.points[vi] = clonePointPreserveHeight(c.points[vi], { x: sp.x, y: sp.y });
                }

                // snapPreview OFF apr?s validation
                drawState.snapPreview = null;

                // IMPORTANT : ici seulement (au rel??chement) ??? recalcul + save
                recomputeRoofPlanes();
                saveCalpinageState();
              }
              if (drawState.dragMode === "ridge-move" || drawState.dragMode === "ridge-endA" || drawState.dragMode === "ridge-endB" || drawState.dragMode === "trait-move" || drawState.dragMode === "trait-endA" || drawState.dragMode === "trait-endB" || drawState.dragMode === "contour-vertex" || drawState.dragMode === "roofExtensionVertex") {
              }
              /* Clic vide Phase PV_LAYOUT : hit-test au point rel??ch? ; si aucun hit panneau => clearSelection.
               * En mode "Ajouter panneaux", ne pas clear au mouseup si le bloc a encore des panneaux (évite clear après suppression d'un panneau). */
              if (CALPINAGE_STATE.currentPhase === "PV_LAYOUT") {
                if (window.CALPINAGE_IS_MANIPULATING) { /* ne pas clearSelection pendant une manip */ } else {
                  var ENGup = window.pvPlacementEngine;
                  var focusUp = ENGup && ENGup.getFocusBlock ? ENGup.getFocusBlock() : null;
                  if (focusUp) {
                    var screenUp = getMouseScreen(e);
                    var imgPtUp = screenToImage(screenUp);
                    var hitPanelUp = focusUp && typeof hitTestFocusBlockPanelIndex === "function" && hitTestFocusBlockPanelIndex(imgPtUp) >= 0;
                    var keepActive = focusUp.panels && focusUp.panels.length > 0;
                    if (!hitPanelUp && !keepActive && typeof ENGup.clearSelection === "function") {
                      ENGup.clearSelection();
                      CALPINAGE_STATE.activeManipulationBlockId = null;
                      if (typeof window.syncPhase3LayoutUI === "function") window.syncPhase3LayoutUI();
                      if (typeof pvSyncSaveRender === "function") pvSyncSaveRender();
                    }
                  }
                }
              }
              drawState.snapPreview = null;
              drawState.dragMode = null;
              drawState.dragBase = null;
              drawState.dragOffset = null;
              drawState.rxDragSnap = null;
              drawState.dragLastMouseImg = null;
              drawState.draggingVertexIndex = null;
              drawState.draggingMesureStartImage = null;
              drawState.draggingRidgePoint = null;
              drawState.draggingRidgeOffset = null;
              drawState.draggingTraitPoint = null;
              drawState.draggingTraitSegmentStart = null;
              if (drawState.draggingVertex) {
                saveCalpinageState();
                drawState.draggingVertex = null;
                resetInteractionState();
              }
              if (drawState.draggingObstacleOffset != null || (drawState.draggingObstacleHandle != null && drawState.resizeObstacleStart != null)) {
                commitInteraction(saveCalpinageState);
              }
              if (drawState.activePointerId != null && canvasEl && typeof canvasEl.releasePointerCapture === "function") {
                try { canvasEl.releasePointerCapture(drawState.activePointerId); } catch (err) {}
                drawState.activePointerId = null;
              }
              drawState.dragMode = null;
              drawState.draggingObstacleOffset = null;
              drawState.draggingObstacleHandle = null;
              if (drawState.draggingShadowVolumeHandle != null && drawState.resizeShadowVolumeStart != null) {
                if (typeof saveCalpinageState === "function") saveCalpinageState();
              }
              drawState.draggingObstacleOffset = null;
            drawState.draggingObstacleHandle = null;
            drawState.draggingVertex = null;
            drawState.resizeObstacleStart = null;
            drawState.draggingShadowVolumeHandle = null;
              drawState.resizeShadowVolumeStart = null;
              drawState.draggingVertex = null;
              drawState.shadowVolumeRotateStart = null;
              drawState.draggingShadowVolumeMove = false;
              drawState.shadowVolumeMoveStart = null;
              /* Ne pas r?initialiser traitLineStart / measureLineStart au mouseup : le 2e clic finalise le segment (trait ou mesure). */
              if (drawState.activeTool !== "trait") drawState.traitLineStart = null;
              if (drawState.activeTool !== "mesure") drawState.measureLineStart = null;
              // STATE SAFETY NET — ensure IDLE after any pointer release
              resetInteractionState();
              if (process.env.NODE_ENV !== "production") {
                const s = getInteractionState();
                if (s !== InteractionStates.IDLE) {
                  console.warn("[STATE] Not IDLE after pointerup:", s);
                }
              }
            }
            resetInteractionState();
            drawState.selectedVertexIndex = null;
          }
          window.addEventListener("mouseup", handlePointerOrMouseUp);
          window.addEventListener("pointerup", handlePointerOrMouseUp);
          addSafeListener(canvasEl, "pointerleave", function () {
            // IMPORTANT: ne pas annuler une manip PV en cours (sinon move/rotate "meurt" dès qu'on sort du canvas)
            if (CALPINAGE_STATE && CALPINAGE_STATE.currentPhase === "PV_LAYOUT" && window.CALPINAGE_IS_MANIPULATING) {
              return;
            }

            if (window.CALPINAGE_IS_MANIPULATING) {
              var ENGpl = window.pvPlacementEngine;
              if (ENGpl && typeof ENGpl.cancelManipulation === "function") ENGpl.cancelManipulation();
              window.CALPINAGE_IS_MANIPULATING = false;
              calpinageHandleDrag = null;
              if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
            }
          });
          var handleWindowMouseleave = function () {
            if (CALPINAGE_STATE && CALPINAGE_STATE.currentPhase === "PV_LAYOUT" && window.CALPINAGE_IS_MANIPULATING) {
              return; // IMPORTANT: ne pas annuler une manip PV en cours
            }
            if (window.CALPINAGE_IS_MANIPULATING) {
              var ENGml = window.pvPlacementEngine;
              if (ENGml && typeof ENGml.cancelManipulation === "function") ENGml.cancelManipulation();
              window.CALPINAGE_IS_MANIPULATING = false;
              calpinageHandleDrag = null;
              if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
            }
            panStart = null;
            if (drawState.dragMode === "circleCreation") {
              var idxCircle = drawState.obstacleCircleTempIndex;
              if (idxCircle != null && CALPINAGE_STATE.obstacles && idxCircle >= 0 && idxCircle < CALPINAGE_STATE.obstacles.length) {
                CALPINAGE_STATE.obstacles.splice(idxCircle, 1);
                if (typeof saveCalpinageState === "function") saveCalpinageState();
              }
            }
            if (drawState.dragMode === "rectangleCreation") {
              var idx = drawState.obstacleRectTempIndex;
              if (idx != null && CALPINAGE_STATE.obstacles && idx >= 0 && idx < CALPINAGE_STATE.obstacles.length) {
                CALPINAGE_STATE.obstacles.splice(idx, 1);
                if (typeof saveCalpinageState === "function") saveCalpinageState();
              }
            }
            drawState.dragMode = null;
            drawState.dragBase = null;
            drawState.dragLastMouseImg = null;
            drawState.draggingVertexIndex = null;
            drawState.draggingMesureStartImage = null;
            drawState.draggingRidgePoint = null;
            drawState.draggingRidgeOffset = null;
            if (drawState.activePointerId != null && canvasEl && typeof canvasEl.releasePointerCapture === "function") {
              try { canvasEl.releasePointerCapture(drawState.activePointerId); } catch (err) {}
              drawState.activePointerId = null;
            }
            drawState.draggingObstacleHandle = null;
            drawState.draggingVertex = null;
            drawState.resizeObstacleStart = null;
            drawState.draggingShadowVolumeHandle = null;
            drawState.resizeShadowVolumeStart = null;
            drawState.shadowVolumeRotateStart = null;
            drawState.draggingTraitPoint = null;
            drawState.draggingTraitSegmentStart = null;
            drawState.traitSnapPreview = null;
            drawState.traitSnapPreviewSource = null;
            drawState.traitSnapEdge = null;
            drawState.snapPreview = null;
            drawState.lastMouseImage = null;
            drawState.hoverNearFirstPoint = false;
            drawState.traitLineStart = null;
            drawState.measureLineStart = null;
            drawState.isSelectingBox = false;
            drawState.selectionBoxStart = null;
            drawState.selectionBoxEnd = null;
            drawState.obstacleAnchor = null;
            drawState.obstacleCircleStartPoint = null;
            drawState.obstacleCircleTempIndex = null;
            drawState.obstacleRectStartPoint = null;
            drawState.obstacleRectTempIndex = null;
            drawState.hoverNearFirstPointObstacle = false;
            drawState.hoverNearFirstPointDormer = false;
            drawState.hoverPanId = null;
            drawState.contourHoverSnapSource = null;
            if (CALPINAGE_STATE.activeContour) CALPINAGE_STATE.activeContour.hoverPoint = null;
            CALPINAGE_STATE.activeRidge.hover = null;
            CALPINAGE_STATE.activeRidge.hoverSnap = null;
            CALPINAGE_STATE.activeRidge.snapEdge = null;
            if (CALPINAGE_STATE.activeObstacle) CALPINAGE_STATE.activeObstacle.hover = null;
          };
          window.addEventListener("mouseleave", handleWindowMouseleave);
          addSafeListener(canvasEl, "mousemove", function (e) {
            if (window.CALPINAGE_IS_MANIPULATING && calpinageHandleDrag) {
              var ENG = window.pvPlacementEngine;
              if (ENG && typeof ENG.setManipulationTransform === "function") {
                var screen = getMouseScreen(e);
                var imgPt = screenToImage(screen);
                if (calpinageHandleDrag.type === "rotate") {
                  var center = calpinageHandleDrag.centerImg;
                  if (center) {
                    var currentAngleRad = Math.atan2(imgPt.y - center.y, imgPt.x - center.x);
                    var rotTotalDeg = (currentAngleRad - calpinageHandleDrag.startAngleRad) * 180 / Math.PI;
                    ENG.setManipulationTransform(0, 0, rotTotalDeg);
                  }
                } else if (calpinageHandleDrag.type === "move") {
                  var dxTotal = imgPt.x - calpinageHandleDrag.startImgX;
                  var dyTotal = imgPt.y - calpinageHandleDrag.startImgY;
                  ENG.setManipulationTransform(dxTotal, dyTotal, 0);
                }
                if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
              }
              return;
            }
            if (drawState.draggingShadowVolumeHandle && drawState.resizeShadowVolumeStart) {
              var screenMv = getMouseScreen(e);
              var imgPtMv = screenToImage(screenMv);
              var vol = drawState.resizeShadowVolumeStart.volume;
              var start = drawState.resizeShadowVolumeStart;
              var mpp = (CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.scale && CALPINAGE_STATE.roof.scale.metersPerPixel) || 1;
              if (drawState.draggingShadowVolumeHandle === "rotate" && drawState.shadowVolumeRotateStart) {
                var rotStart = drawState.shadowVolumeRotateStart;
                var center = rotStart.centerImg || { x: vol.x, y: vol.y };
                var startAngle = Math.atan2(rotStart.startImg.y - center.y, rotStart.startImg.x - center.x);
                var currAngle = Math.atan2(imgPtMv.y - center.y, imgPtMv.x - center.x);
                vol.rotation = rotStart.angle + (currAngle - startAngle) * 180 / Math.PI;
              } else if (drawState.draggingShadowVolumeHandle === "height") {
                var dyH = imgPtMv.y - start.imgPt.y;
                vol.height = Math.max(0.1, start.height - dyH * mpp);
                drawState.resizeShadowVolumeStart.imgPt = { x: imgPtMv.x, y: imgPtMv.y };
                drawState.resizeShadowVolumeStart.height = vol.height;
              } else if (drawState.draggingShadowVolumeHandle === "right") {
                var dx = imgPtMv.x - start.imgPt.x;
                var dy = imgPtMv.y - start.imgPt.y;
                var rotRad = ((typeof vol.rotation === "number" ? vol.rotation : 0) * Math.PI) / 180;
                var proj = dx * Math.cos(rotRad) + dy * Math.sin(rotRad);
                vol.width = Math.max(0.1, start.width + proj * mpp);
              } else if (drawState.draggingShadowVolumeHandle === "bottom") {
                var dxB = imgPtMv.x - start.imgPt.x;
                var dyB = imgPtMv.y - start.imgPt.y;
                var rotRadB = ((typeof vol.rotation === "number" ? vol.rotation : 0) * Math.PI) / 180;
                var projB = -dxB * Math.sin(rotRadB) + dyB * Math.cos(rotRadB);
                vol.depth = Math.max(0.1, start.depth + projB * mpp);
              } else if (drawState.draggingShadowVolumeHandle === "corner") {
                var dxC = imgPtMv.x - start.imgPt.x;
                var dyC = imgPtMv.y - start.imgPt.y;
                var rotRadC = ((typeof vol.rotation === "number" ? vol.rotation : 0) * Math.PI) / 180;
                var cosC = Math.cos(rotRadC), sinC = Math.sin(rotRadC);
                var projW = dxC * cosC + dyC * sinC;
                var projD = -dxC * sinC + dyC * cosC;
                vol.width = Math.max(0.1, start.width + projW * mpp);
                vol.depth = Math.max(0.1, start.depth + projD * mpp);
                drawState.resizeShadowVolumeStart.imgPt = { x: imgPtMv.x, y: imgPtMv.y };
                drawState.resizeShadowVolumeStart.width = vol.width;
                drawState.resizeShadowVolumeStart.depth = vol.depth;
              } else if (drawState.draggingShadowVolumeHandle === "right" || drawState.draggingShadowVolumeHandle === "bottom") {
                drawState.resizeShadowVolumeStart.imgPt = { x: imgPtMv.x, y: imgPtMv.y };
                drawState.resizeShadowVolumeStart.width = vol.width;
                drawState.resizeShadowVolumeStart.depth = vol.depth;
              }
              if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
              return;
            }
            var screen = getMouseScreen(e);
            var imgPt = screenToImage(screen);
            drawState.lastMouseImage = imgPt;
            /* Phase 3 : hover poignées rotation / déplacement pour curseur grab | move */
            if (CALPINAGE_STATE.currentPhase === "PV_LAYOUT") {
              var ENGmm = window.pvPlacementEngine;
              var focusMm = ENGmm && ENGmm.getFocusBlock ? ENGmm.getFocusBlock() : null;
              if (focusMm && typeof getManipulationHandlePositions === "function") {
                var h = getManipulationHandlePositions(focusMm);
                if (h) {
                  var r2 = MANIPULATION_HANDLE_RADIUS_IMG * MANIPULATION_HANDLE_RADIUS_IMG;
                  var dr = (imgPt.x - h.rotate.x) * (imgPt.x - h.rotate.x) + (imgPt.y - h.rotate.y) * (imgPt.y - h.rotate.y);
                  var dm = (imgPt.x - h.move.x) * (imgPt.x - h.move.x) + (imgPt.y - h.move.y) * (imgPt.y - h.move.y);
                  if (dr <= r2) drawState.ph3HandleHover = "rotate";
                  else if (dm <= r2) drawState.ph3HandleHover = "move";
                  else drawState.ph3HandleHover = null;
                } else drawState.ph3HandleHover = null;
              } else drawState.ph3HandleHover = null;
              if (typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
            } else drawState.ph3HandleHover = null;
            var activeContour = CALPINAGE_STATE.activeContour;
            if (drawState.activeTool === "contour" && activeContour.points.length > 0) {
              var snapped = snapPointToGeometry(imgPt, CALPINAGE_STATE.contours, CALPINAGE_STATE.traits, CALPINAGE_STATE.ridges, SNAP_DIST_PX, activeContour.points);
              activeContour.hoverPoint = snapped ? { x: snapped.x, y: snapped.y } : { x: imgPt.x, y: imgPt.y };
              drawState.contourHoverSnapSource = snapped && snapped.source ? snapped.source : null;
            } else {
              drawState.contourHoverSnapSource = null;
            }
            if (drawState.activeTool === "ridge") {
              var buildingContours = (CALPINAGE_STATE.contours || []).filter(function (c) { return c.roofRole !== "chienAssis"; });
              var snapEdge = snapToRoofContourEdge(imgPt, buildingContours, 15);
              if (snapEdge) {
                CALPINAGE_STATE.activeRidge.hover = { x: snapEdge.x, y: snapEdge.y };
                CALPINAGE_STATE.activeRidge.hoverSnap = { point: { x: snapEdge.x, y: snapEdge.y }, source: null };
                CALPINAGE_STATE.activeRidge.snapEdge = { x: snapEdge.x, y: snapEdge.y };
              } else {
                var snapped = snapPointToGeometry(imgPt, CALPINAGE_STATE.contours, CALPINAGE_STATE.traits, CALPINAGE_STATE.ridges, SNAP_DIST_PX);
                CALPINAGE_STATE.activeRidge.hover = snapped ? { x: snapped.x, y: snapped.y } : imgPt;
                CALPINAGE_STATE.activeRidge.hoverSnap = snapped ? { point: { x: snapped.x, y: snapped.y }, source: snapped.source || null } : null;
                CALPINAGE_STATE.activeRidge.snapEdge = null;
              }
            } else {
              CALPINAGE_STATE.activeRidge.hover = null;
              CALPINAGE_STATE.activeRidge.hoverSnap = null;
              CALPINAGE_STATE.activeRidge.snapEdge = null;
            }
            if (drawState.activeTool === "trait" && drawState.traitLineStart) {
              var buildingContours = (CALPINAGE_STATE.contours || []).filter(function (c) { return c.roofRole !== "chienAssis"; });
              var snapEdge = snapToAllRoofEdges(imgPt, 15);
              var snapped = snapPointToGeometry(imgPt, CALPINAGE_STATE.contours, CALPINAGE_STATE.traits, CALPINAGE_STATE.ridges, SNAP_DIST_PX);
              if (snapEdge) {
                drawState.traitSnapPreview = { x: snapEdge.x, y: snapEdge.y };
                drawState.traitSnapPreviewSource = null;
                drawState.traitSnapEdge = { x: snapEdge.x, y: snapEdge.y };
              } else {
                drawState.traitSnapPreview = snapped ? snapped : { x: imgPt.x, y: imgPt.y };
                drawState.traitSnapPreviewSource = snapped && snapped.source ? snapped.source : null;
                drawState.traitSnapEdge = null;
              }
              requestAnimationFrame(render);
            } else {
              drawState.traitSnapPreview = null;
              drawState.traitSnapPreviewSource = null;
              drawState.traitSnapEdge = null;
            }
            if (drawState.activeTool === "obstacle" && drawState.obstacleShape === "polygon" && CALPINAGE_STATE.activeObstacle.points.length > 0) {
              var snappedObs = snapPointToGeometry(imgPt, CALPINAGE_STATE.contours, CALPINAGE_STATE.traits, CALPINAGE_STATE.ridges, SNAP_DIST_PX, CALPINAGE_STATE.activeObstacle.points);
              CALPINAGE_STATE.activeObstacle.hover = snappedObs ? { x: snappedObs.x, y: snappedObs.y } : { x: imgPt.x, y: imgPt.y };
              requestAnimationFrame(render);
            } else if (CALPINAGE_STATE.activeObstacle) {
              CALPINAGE_STATE.activeObstacle.hover = null;
            }
            /* Feedback fermeture contour : highlight du 1er point si curseur proche (DP4) */
            if (drawState.activeTool === "contour" && activeContour.points.length >= 3) {
              var firstScreen = imageToScreen(activeContour.points[0]);
              drawState.hoverNearFirstPoint = (Math.hypot(screen.x - firstScreen.x, screen.y - firstScreen.y) <= CLOSE_THRESHOLD_PX);
            } else {
              drawState.hoverNearFirstPoint = false;
            }
            /* Feedback fermeture polygone obstacle : highlight du 1er point si curseur proche */
            if (drawState.activeTool === "obstacle" && drawState.obstacleShape === "polygon" && CALPINAGE_STATE.activeObstacle.points.length >= 3) {
              var firstScreenObs = imageToScreen(CALPINAGE_STATE.activeObstacle.points[0]);
              drawState.hoverNearFirstPointObstacle = (Math.hypot(screen.x - firstScreenObs.x, screen.y - firstScreenObs.y) <= CLOSE_THRESHOLD_PX);
            } else {
              drawState.hoverNearFirstPointObstacle = false;
            }
            /* Feedback fermeture contour dormer : highlight du 1er point si curseur proche */
            if (window.CALPINAGE_MODE === MODE_DORMER_CONTOUR && drawState.dormerDraft) {
              var pts = drawState.dormerDraft.contour.points;
              if (pts.length >= 3 && pts[0]) {
                var firstScreenD = imageToScreen(pts[0]);
                drawState.hoverNearFirstPointDormer = (Math.hypot(screen.x - firstScreenD.x, screen.y - firstScreenD.y) <= CLOSE_THRESHOLD_PX);
              } else {
                drawState.hoverNearFirstPointDormer = false;
              }
            } else {
              drawState.hoverNearFirstPointDormer = false;
            }
            if (window.CALPINAGE_MODE === MODE_DORMER_CONTOUR || window.CALPINAGE_MODE === MODE_DORMER_HIPS || window.CALPINAGE_MODE === MODE_DORMER_RIDGE) {
              if (typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
            }
            var hitPanHover = hitTestPan(imgPt);
            var newHoverPanId = hitPanHover ? hitPanHover.id : null;
            if (newHoverPanId !== drawState.hoverPanId) {
              drawState.hoverPanId = newHoverPanId;
              if (typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
            }
          });
          addSafeListener(canvasEl, "pointermove", function (e) {
            const interactionState = getInteractionState();
            debugStateConsistency(drawState);
            // READ-ONLY guard (no behavior change)
            if (interactionState === "IDLE") {
              // Nothing to block yet — debug only
            }
            /* Cercle toiture : resize pendant le drag (1 clic, drag, release = validé) */
            if (drawState.dragMode === "circleCreation" && drawState.obstacleCircleStartPoint != null && drawState.obstacleCircleTempIndex != null) {
              var screenCircle = getMouseScreen(e);
              var imgCircle = screenToImage(screenCircle);
              var startCircle = drawState.obstacleCircleStartPoint;
              var dxCircle = imgCircle.x - startCircle.x;
              var dyCircle = imgCircle.y - startCircle.y;
              var radiusCircle = Math.sqrt(dxCircle * dxCircle + dyCircle * dyCircle);
              var obsCircle = CALPINAGE_STATE.obstacles[drawState.obstacleCircleTempIndex];
              if (obsCircle && obsCircle.shapeMeta) {
                obsCircle.shapeMeta.radius = radiusCircle;
                obsCircle.points = obstacleCircleToPoints(obsCircle.shapeMeta.centerX, obsCircle.shapeMeta.centerY, radiusCircle);
              }
              if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
              return;
            }
            /* Rectangle toiture : resize pendant le drag (même sensation que cube ombrant) */
            if (drawState.dragMode === "rectangleCreation" && drawState.obstacleRectStartPoint && drawState.obstacleRectTempIndex != null) {
              var screenRect = getMouseScreen(e);
              var imgPtRect = screenToImage(screenRect);
              drawState.lastMouseImage = imgPtRect;
              var obstacles = CALPINAGE_STATE.obstacles || [];
              var tempObs = obstacles[drawState.obstacleRectTempIndex];
              if (tempObs && tempObs.shapeMeta && tempObs.shapeMeta.originalType === "rect") {
                var sp = drawState.obstacleRectStartPoint;
                var dx = imgPtRect.x - sp.x;
                var dy = imgPtRect.y - sp.y;
                var ww = dx;
                var hh = dy;
                var cx = sp.x + ww / 2;
                var cy = sp.y + hh / 2;
                tempObs.shapeMeta.width = ww;
                tempObs.shapeMeta.height = hh;
                tempObs.shapeMeta.centerX = cx;
                tempObs.shapeMeta.centerY = cy;
                tempObs.points = obstacleRectToPoints(cx, cy, Math.abs(ww) || 0.01, Math.abs(hh) || 0.01);
                if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
              }
              return;
            }
            /* Placement live shadow volume : resize pendant le drag */
            if (
              drawState.isPlacingShadowVolume &&
              drawState.selectedShadowVolumeIndex != null &&
              CALPINAGE_STATE.shadowVolumes &&
              drawState.selectedShadowVolumeIndex >= 0 &&
              drawState.selectedShadowVolumeIndex < CALPINAGE_STATE.shadowVolumes.length
            ) {
              var idx = drawState.selectedShadowVolumeIndex;
              var v = CALPINAGE_STATE.shadowVolumes[idx];
              if (v) {
                var screenPm = getMouseScreen(e);
                var p = screenToImage(screenPm);
                var sx = drawState.shadowVolumePlaceStart.x;
                var sy = drawState.shadowVolumePlaceStart.y;
                var mpp = (CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.scale && CALPINAGE_STATE.roof.scale.metersPerPixel) || 1;
                v.width = Math.max(0.05, Math.abs(p.x - sx) * 2 * mpp);
                v.depth = Math.max(0.05, Math.abs(p.y - sy) * 2 * mpp);
                v.x = sx;
                v.y = sy;
                if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
              }
              return;
            }
            /* Move shadow volume : drag sur le corps */
            if (
              drawState.draggingShadowVolumeMove &&
              drawState.shadowVolumeMoveStart &&
              drawState.selectedShadowVolumeIndex != null &&
              CALPINAGE_STATE.shadowVolumes &&
              drawState.selectedShadowVolumeIndex >= 0 &&
              drawState.selectedShadowVolumeIndex < CALPINAGE_STATE.shadowVolumes.length
            ) {
              var idxMv = drawState.selectedShadowVolumeIndex;
              var vMv = CALPINAGE_STATE.shadowVolumes[idxMv];
              if (vMv) {
                var screenMv2 = getMouseScreen(e);
                var pMv = screenToImage(screenMv2);
                var st = drawState.shadowVolumeMoveStart;
                vMv.x = st.cx + (pMv.x - st.x);
                vMv.y = st.cy + (pMv.y - st.y);
                if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
              }
              return;
            }
            if (window.CALPINAGE_IS_MANIPULATING && calpinageHandleDrag) {
              var ENG = window.pvPlacementEngine;
              if (ENG && typeof ENG.setManipulationTransform === "function") {
                var screen = getMouseScreen(e);
                var imgPt = screenToImage(screen);
                if (calpinageHandleDrag.type === "rotate") {
                  var center = calpinageHandleDrag.centerImg;
                  if (center) {
                    var currentAngleRad = Math.atan2(imgPt.y - center.y, imgPt.x - center.x);
                    var rotTotalDeg = (currentAngleRad - calpinageHandleDrag.startAngleRad) * 180 / Math.PI;
                    ENG.setManipulationTransform(0, 0, rotTotalDeg);
                  }
                } else if (calpinageHandleDrag.type === "move") {
                  var dxTotal = imgPt.x - calpinageHandleDrag.startImgX;
                  var dyTotal = imgPt.y - calpinageHandleDrag.startImgY;
                  ENG.setManipulationTransform(dxTotal, dyTotal, 0);
                }
                if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
              }
              return;
            }
            var screen = getMouseScreen(e);
            var imgPt = screenToImage(screen);
            drawState.lastMouseImage = imgPt;
            /* Phase 3 : hover poignées rotation / déplacement pour curseur grab | move */
            if (CALPINAGE_STATE.currentPhase === "PV_LAYOUT") {
              var ENGmm = window.pvPlacementEngine;
              var focusMm = ENGmm && ENGmm.getFocusBlock ? ENGmm.getFocusBlock() : null;
              if (focusMm && typeof getManipulationHandlePositions === "function") {
                var h = getManipulationHandlePositions(focusMm);
                if (h) {
                  var r2 = MANIPULATION_HANDLE_RADIUS_IMG * MANIPULATION_HANDLE_RADIUS_IMG;
                  var dr = (imgPt.x - h.rotate.x) * (imgPt.x - h.rotate.x) + (imgPt.y - h.rotate.y) * (imgPt.y - h.rotate.y);
                  var dm = (imgPt.x - h.move.x) * (imgPt.x - h.move.x) + (imgPt.y - h.move.y) * (imgPt.y - h.move.y);
                  if (dr <= r2) drawState.ph3HandleHover = "rotate";
                  else if (dm <= r2) drawState.ph3HandleHover = "move";
                  else drawState.ph3HandleHover = null;
                } else drawState.ph3HandleHover = null;
              } else drawState.ph3HandleHover = null;
              if (typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
            } else drawState.ph3HandleHover = null;
            var activeContour = CALPINAGE_STATE.activeContour;
            if (drawState.activeTool === "contour" && activeContour.points.length > 0) {
              var snapped = snapPointToGeometry(imgPt, CALPINAGE_STATE.contours, CALPINAGE_STATE.traits, CALPINAGE_STATE.ridges, SNAP_DIST_PX, activeContour.points);
              activeContour.hoverPoint = snapped ? { x: snapped.x, y: snapped.y } : { x: imgPt.x, y: imgPt.y };
              drawState.contourHoverSnapSource = snapped && snapped.source ? snapped.source : null;
            } else {
              drawState.contourHoverSnapSource = null;
            }
            if (drawState.activeTool === "ridge") {
              var buildingContours = (CALPINAGE_STATE.contours || []).filter(function (c) { return c.roofRole !== "chienAssis"; });
              var snapEdge = snapToRoofContourEdge(imgPt, buildingContours, 15);
              if (snapEdge) {
                CALPINAGE_STATE.activeRidge.hover = { x: snapEdge.x, y: snapEdge.y };
                CALPINAGE_STATE.activeRidge.hoverSnap = { point: { x: snapEdge.x, y: snapEdge.y }, source: null };
                CALPINAGE_STATE.activeRidge.snapEdge = { x: snapEdge.x, y: snapEdge.y };
              } else {
                var snapped = snapPointToGeometry(imgPt, CALPINAGE_STATE.contours, CALPINAGE_STATE.traits, CALPINAGE_STATE.ridges, SNAP_DIST_PX);
                CALPINAGE_STATE.activeRidge.hover = snapped ? { x: snapped.x, y: snapped.y } : imgPt;
                CALPINAGE_STATE.activeRidge.hoverSnap = snapped ? { point: { x: snapped.x, y: snapped.y }, source: snapped.source || null } : null;
                CALPINAGE_STATE.activeRidge.snapEdge = null;
              }
            } else {
              CALPINAGE_STATE.activeRidge.hover = null;
              CALPINAGE_STATE.activeRidge.hoverSnap = null;
              CALPINAGE_STATE.activeRidge.snapEdge = null;
            }
            if (drawState.activeTool === "trait" && drawState.traitLineStart) {
              var buildingContours = (CALPINAGE_STATE.contours || []).filter(function (c) { return c.roofRole !== "chienAssis"; });
              var snapEdge = snapToAllRoofEdges(imgPt, 15);
              var snapped = snapPointToGeometry(imgPt, CALPINAGE_STATE.contours, CALPINAGE_STATE.traits, CALPINAGE_STATE.ridges, SNAP_DIST_PX);
              if (snapEdge) {
                drawState.traitSnapPreview = { x: snapEdge.x, y: snapEdge.y };
                drawState.traitSnapPreviewSource = null;
                drawState.traitSnapEdge = { x: snapEdge.x, y: snapEdge.y };
              } else {
                drawState.traitSnapPreview = snapped ? snapped : { x: imgPt.x, y: imgPt.y };
                drawState.traitSnapPreviewSource = snapped && snapped.source ? snapped.source : null;
                drawState.traitSnapEdge = null;
              }
              requestAnimationFrame(render);
            } else {
              drawState.traitSnapPreview = null;
              drawState.traitSnapPreviewSource = null;
              drawState.traitSnapEdge = null;
            }
            if (drawState.activeTool === "obstacle" && drawState.obstacleShape === "polygon" && CALPINAGE_STATE.activeObstacle.points.length > 0) {
              var snappedObs = snapPointToGeometry(imgPt, CALPINAGE_STATE.contours, CALPINAGE_STATE.traits, CALPINAGE_STATE.ridges, SNAP_DIST_PX, CALPINAGE_STATE.activeObstacle.points);
              CALPINAGE_STATE.activeObstacle.hover = snappedObs ? { x: snappedObs.x, y: snappedObs.y } : { x: imgPt.x, y: imgPt.y };
              requestAnimationFrame(render);
            } else if (CALPINAGE_STATE.activeObstacle) {
              CALPINAGE_STATE.activeObstacle.hover = null;
            }
            /* Feedback fermeture contour : highlight du 1er point si curseur proche (DP4) */
            if (drawState.activeTool === "contour" && activeContour.points.length >= 3) {
              var firstScreen = imageToScreen(activeContour.points[0]);
              drawState.hoverNearFirstPoint = (Math.hypot(screen.x - firstScreen.x, screen.y - firstScreen.y) <= CLOSE_THRESHOLD_PX);
            } else {
              drawState.hoverNearFirstPoint = false;
            }
            /* Feedback fermeture polygone obstacle : highlight du 1er point si curseur proche */
            if (drawState.activeTool === "obstacle" && drawState.obstacleShape === "polygon" && CALPINAGE_STATE.activeObstacle.points.length >= 3) {
              var firstScreenObs = imageToScreen(CALPINAGE_STATE.activeObstacle.points[0]);
              drawState.hoverNearFirstPointObstacle = (Math.hypot(screen.x - firstScreenObs.x, screen.y - firstScreenObs.y) <= CLOSE_THRESHOLD_PX);
            } else {
              drawState.hoverNearFirstPointObstacle = false;
            }
            /* Feedback fermeture contour dormer : highlight du 1er point si curseur proche */
            if (window.CALPINAGE_MODE === MODE_DORMER_CONTOUR && drawState.dormerDraft) {
              var pts = drawState.dormerDraft.contour.points;
              if (pts.length >= 3 && pts[0]) {
                var firstScreenD = imageToScreen(pts[0]);
                drawState.hoverNearFirstPointDormer = (Math.hypot(screen.x - firstScreenD.x, screen.y - firstScreenD.y) <= CLOSE_THRESHOLD_PX);
              } else {
                drawState.hoverNearFirstPointDormer = false;
              }
            } else {
              drawState.hoverNearFirstPointDormer = false;
            }
            if (window.CALPINAGE_MODE === MODE_DORMER_CONTOUR || window.CALPINAGE_MODE === MODE_DORMER_HIPS || window.CALPINAGE_MODE === MODE_DORMER_RIDGE) {
              if (typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
            }
            // Debug state (temporary)
            if (process.env.NODE_ENV !== "production") {
              // console.log("[STATE]", interactionState);
            }
          });
          /* DELETE-ROOFEXTENSION-SECURED */
          deleteCurrentSelection = function (e) {
            /* Shadow volume : Delete/Backspace supprime le volume sélectionné (priorité) */
            if (
              drawState.selectedShadowVolumeIndex != null &&
              CALPINAGE_STATE.shadowVolumes &&
              drawState.selectedShadowVolumeIndex >= 0 &&
              drawState.selectedShadowVolumeIndex < CALPINAGE_STATE.shadowVolumes.length
            ) {
              var idxDel = drawState.selectedShadowVolumeIndex;
              if (CALPINAGE_STATE.shadowVolumes[idxDel]) {
                CALPINAGE_STATE.shadowVolumes.splice(idxDel, 1);
                drawState.selectedObstacleIndex = null;
                drawState.selectedShadowVolumeIndex = null;
                drawState.selectedRoofExtensionIndex = null;
                if (typeof saveCalpinageState === "function") saveCalpinageState();
                if (typeof window.CALPINAGE_RENDER === "function") window.CALPINAGE_RENDER();
                if (e) e.preventDefault();
              }
              return;
            }
            /* Suppression roof extension */
            if (drawState.selectedRoofExtensionIndex != null) {
              var idx = drawState.selectedRoofExtensionIndex;
              if (
                CALPINAGE_STATE.roofExtensions &&
                idx >= 0 &&
                idx < CALPINAGE_STATE.roofExtensions.length
              ) {
                CALPINAGE_STATE.roofExtensions.splice(idx, 1);
                drawState.selectedObstacleIndex = null;
                drawState.selectedShadowVolumeIndex = null;
                drawState.selectedRoofExtensionIndex = null;
                if (typeof saveCalpinageState === "function") saveCalpinageState();
                if (typeof window.CALPINAGE_RENDER === "function") requestAnimationFrame(window.CALPINAGE_RENDER);
                if (e) e.preventDefault();
                return;
              }
            }
            /* Phase 3 : suppression explicite uniquement au clavier (Suppr = bloc sélectionné). Aucune suppression au clic. */
            if (CALPINAGE_STATE.currentPhase === "PV_LAYOUT") {
              if (window.CALPINAGE_IS_MANIPULATING) return;
              var ENG = window.pvPlacementEngine;
              if (ENG && ENG.getFocusBlock && ENG.getFocusBlock()) {
                var blockId = ENG.getFocusBlock().id;
                var doRemoveBlock = function () {
                  ENG.removeBlock(blockId);
                  if (typeof pvSyncSaveRender === "function") pvSyncSaveRender();
                  else {
                    if (typeof updatePowerSummary === "function") updatePowerSummary();
                    if (typeof updateCalpinageValidateButton === "function") updateCalpinageValidateButton();
                    if (typeof window.notifyPhase3ChecklistUpdate === "function") window.notifyPhase3ChecklistUpdate();
                    if (typeof window.notifyPhase3SidebarUpdate === "function") window.notifyPhase3SidebarUpdate();
                  }
                };
                if (typeof window.requestCalpinageConfirm !== "function") {
                  if (typeof console !== "undefined" && console.error) console.error("[CALPINAGE] ConfirmProvider missing — destructive action blocked");
                  return;
                }
                window.requestCalpinageConfirm({
                  title: "Supprimer ce bloc ?",
                  description: "Le bloc sélectionné sera définitivement supprimé.",
                  confirmLabel: "Supprimer",
                  cancelLabel: "Annuler",
                  onConfirm: doRemoveBlock
                });
                if (e) e.preventDefault();
              }
              return;
            }
            if (drawState.selectedContourIndex !== null && CALPINAGE_STATE.contours[drawState.selectedContourIndex]) {
              CALPINAGE_STATE.contours.splice(drawState.selectedContourIndex, 1);
              drawState.selectedContourIndex = null;
              drawState.draggingVertexIndex = null;
              saveCalpinageState();
              if (e) e.preventDefault();
              return;
            }
            if (drawState.selectedMesureIndex !== null && CALPINAGE_STATE.measures[drawState.selectedMesureIndex]) {
              CALPINAGE_STATE.measures.splice(drawState.selectedMesureIndex, 1);
              drawState.selectedMesureIndex = null;
              saveCalpinageState();
              if (e) e.preventDefault();
              return;
            }
            if (drawState.selectedTraitIndex !== null && CALPINAGE_STATE.traits[drawState.selectedTraitIndex]) {
              CALPINAGE_STATE.traits.splice(drawState.selectedTraitIndex, 1);
              CALPINAGE_STATE.selected = { type: null, id: null, pointIndex: null };
              drawState.selectedTraitIndex = null;
              drawState.draggingTraitPoint = null;
              drawState.draggingTraitSegmentStart = null;
              recomputeRoofPlanes();
              saveCalpinageState();
              if (e) e.preventDefault();
              return;
            }
            if (drawState.selectedRidgeIndex !== null && CALPINAGE_STATE.ridges[drawState.selectedRidgeIndex]) {
              CALPINAGE_STATE.ridges.splice(drawState.selectedRidgeIndex, 1);
              CALPINAGE_STATE.selected = { type: null, id: null, pointIndex: null };
              drawState.selectedRidgeIndex = null;
              drawState.draggingRidgePoint = null;
              drawState.draggingRidgeOffset = null;
              recomputeRoofPlanes();
              saveCalpinageState();
              if (e) e.preventDefault();
              return;
            }
            if (
              drawState.selectedObstacleIndex != null &&
              CALPINAGE_STATE.obstacles &&
              drawState.selectedObstacleIndex >= 0 &&
              drawState.selectedObstacleIndex < CALPINAGE_STATE.obstacles.length
            ) {
              CALPINAGE_STATE.obstacles.splice(drawState.selectedObstacleIndex, 1);
              drawState.selectedObstacleIndex = null;
              drawState.selectedShadowVolumeIndex = null;
              drawState.selectedRoofExtensionIndex = null;
              drawState.draggingObstacleOffset = null;
              saveCalpinageState();
              if (e) e.preventDefault();
              return;
            }
            /* POLYGON VERTEX DELETE */
            if (
              drawState.draggingVertex == null &&
              drawState.selectedObstacleIndex != null &&
              CALPINAGE_STATE.obstacles &&
              CALPINAGE_STATE.obstacles[drawState.selectedObstacleIndex] &&
              Array.isArray(CALPINAGE_STATE.obstacles[drawState.selectedObstacleIndex].points)
            ) {
              const o = CALPINAGE_STATE.obstacles[drawState.selectedObstacleIndex];
              const vertexIndex = drawState.selectedVertexIndex;

              if (
                typeof vertexIndex === "number" &&
                o.points.length > 3 &&
                vertexIndex >= 0 &&
                vertexIndex < o.points.length
              ) {
                o.points.splice(vertexIndex, 1);
                drawState.selectedVertexIndex = null;
                saveCalpinageState();
                requestAnimationFrame(window.CALPINAGE_RENDER);
                if (e) e.preventDefault();
              }
            }
          };

          var handleWindowKeydown = function (e) {
            var tag = e.target && e.target.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
            if (e.target && e.target.isContentEditable) return;
            var zoneA = container.querySelector("#zone-a");
            var allowDeleteInZoneA = (e.key === "Delete" || e.key === "Backspace") && CALPINAGE_STATE.currentPhase === "PV_LAYOUT" && window.pvPlacementEngine && window.pvPlacementEngine.getFocusBlock && window.pvPlacementEngine.getFocusBlock();
            if (zoneA && e.target && zoneA.contains(e.target) && !allowDeleteInZoneA) return;
            if (e.key === "Delete" || e.key === "Backspace") {
              deleteCurrentSelection(e);
              e.preventDefault();
              return;
            }
            if (e.key === "Escape") {
              if (drawState.activeTool === "trait" && drawState.traitLineStart) {
                drawState.traitLineStart = null;
                drawState.traitSnapPreview = null;
                drawState.traitSnapPreviewSource = null;
                drawState.traitSnapEdge = null;
                requestAnimationFrame(render);
                e.preventDefault();
                return;
              }
              if (drawState.activeTool === "ridge" && CALPINAGE_STATE.activeRidge.a && !CALPINAGE_STATE.activeRidge.b) {
                CALPINAGE_STATE.activeRidge.a = null;
                CALPINAGE_STATE.activeRidge.b = null;
                CALPINAGE_STATE.activeRidge.hover = null;
                CALPINAGE_STATE.activeRidge.hoverSnap = null;
                requestAnimationFrame(render);
                e.preventDefault();
                return;
              }
              if (drawState.activeTool === "contour" && CALPINAGE_STATE.activeContour && CALPINAGE_STATE.activeContour.points.length > 0) {
                CALPINAGE_STATE.activeContour.points.pop();
                if (CALPINAGE_STATE.activeContour.points.length === 0) CALPINAGE_STATE.activeContour.hoverPoint = null;
                requestAnimationFrame(render);
                e.preventDefault();
                return;
              }
              if (drawState.dragMode === "circleCreation") {
                var idxCircleEsc = drawState.obstacleCircleTempIndex;
                if (idxCircleEsc != null && CALPINAGE_STATE.obstacles && idxCircleEsc >= 0 && idxCircleEsc < CALPINAGE_STATE.obstacles.length) {
                  CALPINAGE_STATE.obstacles.splice(idxCircleEsc, 1);
                  if (typeof saveCalpinageState === "function") saveCalpinageState();
                }
                drawState.dragMode = null;
                drawState.obstacleCircleStartPoint = null;
                drawState.obstacleCircleTempIndex = null;
                requestAnimationFrame(render);
                e.preventDefault();
              }
              if (drawState.dragMode === "rectangleCreation") {
                var idx = drawState.obstacleRectTempIndex;
                if (idx != null && CALPINAGE_STATE.obstacles && idx >= 0 && idx < CALPINAGE_STATE.obstacles.length) {
                  CALPINAGE_STATE.obstacles.splice(idx, 1);
                  if (typeof saveCalpinageState === "function") saveCalpinageState();
                }
                drawState.dragMode = null;
                drawState.obstacleRectStartPoint = null;
                drawState.obstacleRectTempIndex = null;
                requestAnimationFrame(render);
                e.preventDefault();
              }
              if (drawState.obstacleAnchor != null) {
                drawState.obstacleAnchor = null;
                requestAnimationFrame(render);
                e.preventDefault();
              }
              if (drawState.obstacleShape === "polygon" && CALPINAGE_STATE.activeObstacle) {
                var p = CALPINAGE_STATE.activeObstacle.points;
                if (p && p.length > 0) {
                  CALPINAGE_STATE.activeObstacle.points = [];
                  CALPINAGE_STATE.activeObstacle.hover = null;
                  requestAnimationFrame(render);
                  e.preventDefault();
                }
              }
              return;
            }
          };
          window.addEventListener("keydown", handleWindowKeydown);

          cleanupTasks.push(function () {
            drawState.ridgeHintMessageUntil = 0;
            drawState.traitHintMessageUntil = 0;
            drawState.traitSnapPreview = null;
            drawState.traitSnapPreviewSource = null;
            drawState.traitSnapEdge = null;
            window.removeEventListener("mousemove", handleWindowMousemove);
            window.removeEventListener("mouseup", handlePointerOrMouseUp);
            window.removeEventListener("pointerup", handlePointerOrMouseUp);
            window.removeEventListener("mouseleave", handleWindowMouseleave);
            window.removeEventListener("keydown", handleWindowKeydown);
            var tb = container.querySelector("#zone-b-toolbar");
            if (tb) {
              var badge = tb.querySelector(".contour-badge-ux");
              if (badge) badge.remove();
            }
          });

          addSafeListener(canvasEl, "wheel", function (e) {
            e.preventDefault();
            var rect = canvasEl.getBoundingClientRect();
            var center = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            var factor = e.deltaY > 0 ? 0.9 : 1.1;
            vp.zoom(factor, center);
          }, { passive: false });

          function render() {
            if (!engine || engine._destroyed) {
              return;
            }
            engine.resize();
            engine.clear();
            if (typeof window !== "undefined") window.CALPINAGE_VIEWPORT_SCALE = vp.scale;
            var ctx = engine.ctx;
            var s = vp.scale;
            var ox = vp.offset.x;
            var oy = vp.offset.y;
            ctx.save();
            ctx.transform(s, 0, 0, -s, ox, oy);
            ctx.drawImage(roofImg, 0, 0, imgW, imgH, 0, imgH, imgW, -imgH);
            ctx.restore();

            var selContourIds = new Set(drawState.selectedContourIds || []);
            var selRidgeIds = new Set(drawState.selectedRidgeIds || []);
            var selTraitIds = new Set(drawState.selectedTraitIds || []);

            /* 1. Image d?j? dessin?e ci-dessus. */
            /* 2. Contours b??ti main ??? traits + fill */
            for (var ci = 0; ci < CALPINAGE_STATE.contours.length; ci++) {
              var c = CALPINAGE_STATE.contours[ci];
              if (!c || !c.points || c.points.length < 2 || c.roofRole === "chienAssis") continue;
              var pts = c.points;
              var isSelContour = selContourIds.has(c.id);
              ctx.beginPath();
              var first = imageToScreen(pts[0]);
              ctx.moveTo(first.x, first.y);
              for (var i = 1; i < pts.length; i++) {
                var p = imageToScreen(pts[i]);
                ctx.lineTo(p.x, p.y);
              }
              if (c.closed) ctx.closePath();
              ctx.strokeStyle = "#c9a449";
              ctx.lineWidth = isSelContour ? 3 : 2;
              ctx.setLineDash([]);
              ctx.stroke();
              if (c.closed) {
                ctx.fillStyle = "rgba(201, 164, 73, 0.12)";
                ctx.fill();
              }
            }
            /* 2b. Traits main ??? ligne bleue + label */
            for (var ti = 0; ti < (CALPINAGE_STATE.traits || []).length; ti++) {
              var tr = CALPINAGE_STATE.traits[ti];
              if (!tr || !tr.a || !tr.b || tr.roofRole === "chienAssis") continue;
              var tra = imageToScreen(tr.a);
              var trb = imageToScreen(tr.b);
              var isSelTrait = selTraitIds.has(tr.id);
              ctx.strokeStyle = "#3b82f6";
              ctx.lineWidth = isSelTrait ? 3 : 2;
              ctx.setLineDash([]);
              ctx.beginPath();
              ctx.moveTo(tra.x, tra.y);
              ctx.lineTo(trb.x, trb.y);
              ctx.stroke();
              var lenM = segmentLengthMeters(tr.a, tr.b);
              if (lenM != null) {
                var midT = imageToScreen({ x: (tr.a.x + tr.b.x) / 2, y: (tr.a.y + tr.b.y) / 2 });
                drawSegmentLabelHalo(ctx, midT, lenM.toFixed(2).replace(".", ",") + " m");
              }
            }
            /* 3. Fa??tages main ??? segment + label */
            for (var ri = 0; ri < CALPINAGE_STATE.ridges.length; ri++) {
              var ridge = CALPINAGE_STATE.ridges[ri];
              if (!ridge || !ridge.a || !ridge.b || ridge.roofRole === "chienAssis") continue;
              var raPt = resolveRidgePoint(ridge.a);
              var rbPt = resolveRidgePoint(ridge.b);
              var ra = imageToScreen(raPt);
              var rb = imageToScreen(rbPt);
              var isSelRidge = selRidgeIds.has(ridge.id);
              ctx.strokeStyle = "orange";
              ctx.lineWidth = isSelRidge ? 3 : 2;
              ctx.setLineDash([]);
              ctx.beginPath();
              ctx.moveTo(ra.x, ra.y);
              ctx.lineTo(rb.x, rb.y);
              ctx.stroke();
              var lenM = segmentLengthMeters(raPt, rbPt);
              if (lenM != null) {
                var mid = imageToScreen({ x: (raPt.x + rbPt.x) / 2, y: (raPt.y + rbPt.y) / 2 });
                drawSegmentLabelHalo(ctx, mid, lenM.toFixed(2).replace(".", ",") + " m");
              }
            }
            /* 4a. Hover pan : eclaircissement subtil + bordure doree (priorite < selection) */
            if (drawState.hoverPanId && drawState.hoverPanId !== CALPINAGE_STATE.selectedPanId) {
              var hoverPan = CALPINAGE_STATE.pans.filter(function (p) { return p.id === drawState.hoverPanId; })[0];
              var hoverPoly = hoverPan && (hoverPan.points && hoverPan.points.length >= 3 ? hoverPan.points : hoverPan.polygon);
              if (hoverPoly && hoverPoly.length >= 3) {
                ctx.beginPath();
                var hp0 = imageToScreen(hoverPoly[0]);
                ctx.moveTo(hp0.x, hp0.y);
                for (var hpi = 1; hpi < hoverPoly.length; hpi++) {
                  var hpp = imageToScreen(hoverPoly[hpi]);
                  ctx.lineTo(hpp.x, hpp.y);
                }
                ctx.closePath();
                ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
                ctx.fill();
                ctx.strokeStyle = "#C39847";
                ctx.lineWidth = 1.2;
                ctx.stroke();
              }
            }
            /* 4. Surlignage du pan s?lectionn? uniquement (overlay l?ger, or clair / blanc chaud) */
            if (CALPINAGE_STATE.selectedPanId) {
              var selPan = CALPINAGE_STATE.pans.filter(function (p) { return p.id === CALPINAGE_STATE.selectedPanId; })[0];
              if (selPan && selPan.polygon && selPan.polygon.length >= 3) {
                ctx.beginPath();
                var sp0 = imageToScreen(selPan.polygon[0]);
                ctx.moveTo(sp0.x, sp0.y);
                for (var spi = 1; spi < selPan.polygon.length; spi++) {
                  var spp = imageToScreen(selPan.polygon[spi]);
                  ctx.lineTo(spp.x, spp.y);
                }
                ctx.closePath();
                ctx.fillStyle = "rgba(255, 248, 220, 0.42)";
                ctx.fill();
              }
            }
            /* 4d. Sommets du pan en ?dition : visibles uniquement si editingPanId === pan.id */
            if (CALPINAGE_STATE.editingPanId) {
              var editPan = CALPINAGE_STATE.pans.filter(function (p) { return p.id === CALPINAGE_STATE.editingPanId; })[0];
              if (editPan && editPan.polygon && editPan.polygon.length >= 2) {
                var selectedPointId = CALPINAGE_STATE.selectedPointId || "";
                for (var vi = 0; vi < editPan.polygon.length; vi++) {
                  var v = editPan.polygon[vi];
                  var vScreen = imageToScreen({ x: v.x, y: v.y });
                  var isSelected = selectedPointId === editPan.id + "-" + vi;
                  var shared = isVertexShared(v.x, v.y, editPan.id);
                  ctx.beginPath();
                  ctx.arc(vScreen.x, vScreen.y, isSelected ? 7 : (shared ? 6 : 5), 0, Math.PI * 2);
                  if (isSelected) {
                    ctx.fillStyle = "#1a73e8";
                    ctx.strokeStyle = "#fff";
                    ctx.lineWidth = 2;
                    ctx.fill();
                    ctx.stroke();
                  } else if (shared) {
                    ctx.fillStyle = "rgba(255, 152, 0, 0.9)";
                    ctx.strokeStyle = "#fff";
                    ctx.lineWidth = 1.5;
                    ctx.fill();
                    ctx.stroke();
                  } else {
                    ctx.fillStyle = "rgba(201, 164, 73, 0.95)";
                    ctx.strokeStyle = "rgba(255,255,255,0.8)";
                    ctx.lineWidth = 1;
                    ctx.fill();
                    ctx.stroke();
                  }
                }
              }
            }
            /* 4c. Obstacles toiture (apr?s pans, avant panneaux) ??? stroke gris fonc?, fill gris clair semi-transparent */
            var obstaclePreview = null;
            /* Cercle : création par drag (circleCreation) — preview via obstacles[] ; rect : idem via obstacles[] */
            /* 4c-1b. Polygone obstacle en cours de dessin (activeObstacle) */
            var activeObsPts = (drawState.obstacleShape === "polygon" && CALPINAGE_STATE.activeObstacle) ? CALPINAGE_STATE.activeObstacle.points : [];
            if (activeObsPts.length >= 1) {
              var hoverObs = CALPINAGE_STATE.activeObstacle.hover;
              ctx.strokeStyle = "#5a3a3a";
              ctx.lineWidth = 1.5;
              ctx.setLineDash([]);
              ctx.beginPath();
              var oFirst = imageToScreen(activeObsPts[0]);
              ctx.moveTo(oFirst.x, oFirst.y);
              for (var ok = 1; ok < activeObsPts.length; ok++) {
                var oP = imageToScreen(activeObsPts[ok]);
                ctx.lineTo(oP.x, oP.y);
              }
              if (hoverObs) {
                var oLast = imageToScreen(activeObsPts[activeObsPts.length - 1]);
                var oHover = imageToScreen(hoverObs);
                ctx.lineTo(oHover.x, oHover.y);
              } else if (drawState.lastMouseImage) {
                var oLast = imageToScreen(activeObsPts[activeObsPts.length - 1]);
                var oMouse = imageToScreen(drawState.lastMouseImage);
                ctx.lineTo(oMouse.x, oMouse.y);
              }
              ctx.stroke();
              ctx.fillStyle = "#1f2937";
              for (var om = 0; om < activeObsPts.length; om++) {
                var oSc = imageToScreen(activeObsPts[om]);
                ctx.beginPath();
                var rObs = (om === 0 && drawState.hoverNearFirstPointObstacle) ? 7 : 5;
                ctx.arc(oSc.x, oSc.y, rObs, 0, Math.PI * 2);
                if (om === 0 && drawState.hoverNearFirstPointObstacle) {
                  ctx.fillStyle = "#c9a449";
                  ctx.fill();
                  ctx.strokeStyle = "#1f2937";
                  ctx.lineWidth = 2;
                  ctx.stroke();
                  ctx.fillStyle = "#1f2937";
                } else {
                  ctx.fill();
                }
              }
            }
            /* 4c-2. Obstacles polygones (A-2) ??? contour + remplissage semi-transparent, label si dispo */
            var obstaclesList = CALPINAGE_STATE.obstacles || [];
            var obstacleSelectedIndexRaw = drawState.activeTool === "select" ? drawState.selectedObstacleIndex : -1;
            var obstacleSelectedIndex =
              obstacleSelectedIndexRaw != null &&
              CALPINAGE_STATE.obstacles &&
              obstacleSelectedIndexRaw >= 0 &&
              obstacleSelectedIndexRaw < CALPINAGE_STATE.obstacles.length
                ? obstacleSelectedIndexRaw
                : -1;
            for (var oi = 0; oi < obstaclesList.length; oi++) {
              var o = obstaclesList[oi];
              if (!o || !o.points || !Array.isArray(o.points) || o.points.length < 3) continue;
              var sel = obstacleSelectedIndex === oi;
              ctx.beginPath();
              var p0 = imageToScreen(o.points[0]);
              ctx.moveTo(p0.x, p0.y);
              for (var pi = 1; pi < o.points.length; pi++) {
                var ps = imageToScreen(o.points[pi]);
                ctx.lineTo(ps.x, ps.y);
              }
              ctx.closePath();
              ctx.fillStyle = sel ? "rgba(180, 100, 60, 0.35)" : "rgba(120, 80, 80, 0.28)";
              ctx.fill();
              ctx.strokeStyle = sel ? "#8b4513" : "#5a3a3a";
              ctx.lineWidth = sel ? 2.5 : 1.5;
              ctx.setLineDash([]);
              ctx.stroke();
              var label = (o.meta && o.meta.label) || o.kind || "";
              if (label) {
                var cx = 0, cy = 0;
                o.points.forEach(function (p) { cx += p.x; cy += p.y; });
                cx /= o.points.length;
                cy /= o.points.length;
                var sc = imageToScreen({ x: cx, y: cy });
                ctx.fillStyle = "#333";
                ctx.font = "11px sans-serif";
                ctx.fillText(label, sc.x - 20, sc.y + 4);
              }
            }
            if (CalpinageCanvas.drawObstacles) {
              CalpinageCanvas.drawObstacles(ctx, CALPINAGE_STATE.obstacles || [], imageToScreen, obstaclePreview, vp.scale, obstacleSelectedIndex);
            }
            var rxList = CALPINAGE_STATE.roofExtensions || [];
            if (rxList.length > 0) {
              ctx.save();
              var rxActivePointRef = (drawState.dragMode === "roofExtensionVertex" && drawState.dragBase) ? drawState.dragBase.pointRef : null;
              rxList.forEach(function (rx, ri) {
                var sel = drawState.selectedRoofExtensionIndex === ri;
                ctx.strokeStyle = "#000000";
                ctx.lineWidth = sel ? 3 : 2;
                var pts = rx.contour && rx.contour.points ? rx.contour.points : [];
                if (pts.length > 0) {
                  ctx.beginPath();
                  var p0 = imageToScreen(pts[0]);
                  ctx.moveTo(p0.x, p0.y);
                  for (var i = 1; i < pts.length; i++) {
                    var pi = imageToScreen(pts[i]);
                    ctx.lineTo(pi.x, pi.y);
                  }
                  ctx.closePath();
                  ctx.stroke();
                }
                if (rx.ridge && rx.ridge.a && rx.ridge.b) {
                  ctx.beginPath();
                  var ra = imageToScreen(rx.ridge.a);
                  var rb = imageToScreen(rx.ridge.b);
                  ctx.moveTo(ra.x, ra.y);
                  ctx.lineTo(rb.x, rb.y);
                  ctx.stroke();
                }
                if (rx.hips) {
                  if (rx.hips.left && rx.hips.left.a && rx.hips.left.b) {
                    ctx.beginPath();
                    var la = imageToScreen(rx.hips.left.a);
                    var lb = imageToScreen(rx.hips.left.b);
                    ctx.moveTo(la.x, la.y);
                    ctx.lineTo(lb.x, lb.y);
                    ctx.stroke();
                  }
                  if (rx.hips.right && rx.hips.right.a && rx.hips.right.b) {
                    ctx.beginPath();
                    var ra1 = imageToScreen(rx.hips.right.a);
                    var rb1 = imageToScreen(rx.hips.right.b);
                    ctx.moveTo(ra1.x, ra1.y);
                    ctx.lineTo(rb1.x, rb1.y);
                    ctx.stroke();
                  }
                }
                if (sel && drawState.activeTool === "select") {
                  var allPts = [];
                  pts.forEach(function (p) { allPts.push({ p: p, kind: "contour" }); });
                  if (rx.ridge && rx.ridge.a) allPts.push({ p: rx.ridge.a, kind: "ridge-a" });
                  if (rx.ridge && rx.ridge.b) allPts.push({ p: rx.ridge.b, kind: "ridge-b" });
                  if (rx.hips && rx.hips.left) {
                    if (rx.hips.left.a) allPts.push({ p: rx.hips.left.a, kind: "hip-left-a" });
                    if (rx.hips.left.b) allPts.push({ p: rx.hips.left.b, kind: "hip-left-b" });
                  }
                  if (rx.hips && rx.hips.right) {
                    if (rx.hips.right.a) allPts.push({ p: rx.hips.right.a, kind: "hip-right-a" });
                    if (rx.hips.right.b) allPts.push({ p: rx.hips.right.b, kind: "hip-right-b" });
                  }
                  allPts.forEach(function (item) {
                    var sc = imageToScreen(item.p);
                    ctx.beginPath();
                    ctx.arc(sc.x, sc.y, 6, 0, Math.PI * 2);
                    var isActive = rxActivePointRef === item.p;
                    ctx.fillStyle = isActive ? "#22c55e" : "#ffffff";
                    ctx.strokeStyle = "#000000";
                    ctx.lineWidth = 2;
                    ctx.fill();
                    ctx.stroke();
                  });
                }
              });
              ctx.restore();
            }
            /* Ombre chien assis (roofExtensions) — projection au sol selon soleil */
            var sunVec = window.__CALPINAGE_SUN_VECTOR;
            if (sunVec) {
              var mpp = (CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.scale && CALPINAGE_STATE.roof.scale.metersPerPixel) || 1;
              (CALPINAGE_STATE.roofExtensions || []).forEach(function (rx) {
                if (!rx.ridgeHeightRelM) return;
                var p1 = rx.ridge.a;
                var p2 = rx.ridge.b;
                var p3 = rx.hips && rx.hips.left ? rx.hips.left.b : null;
                var p4 = rx.hips && rx.hips.right ? rx.hips.right.b : null;
                if (!p1 || !p2 || !p3 || !p4) return;
                var s1 = projectShadowPoint(p1, rx.ridgeHeightRelM, sunVec, mpp);
                var s2 = projectShadowPoint(p2, rx.ridgeHeightRelM, sunVec, mpp);
                if (!s1 || !s2) return;
                ctx.save();
                ctx.fillStyle = "rgba(255,140,0,0.25)";
                ctx.beginPath();
                ctx.moveTo(imageToScreen(p3).x, imageToScreen(p3).y);
                ctx.lineTo(imageToScreen(p4).x, imageToScreen(p4).y);
                ctx.lineTo(imageToScreen(s2).x, imageToScreen(s2).y);
                ctx.lineTo(imageToScreen(s1).x, imageToScreen(s1).y);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
              });
            }
            var dormerDraftForRender = drawState.dormerDraft || getDormerEditTarget();
            if (CALPINAGE_STATE.currentPhase !== "PV_LAYOUT" && dormerDraftForRender) {
              drawState.dormerSnapActive = false;
              var pts = dormerDraftForRender.contour && dormerDraftForRender.contour.points ? dormerDraftForRender.contour.points : [];
              var ridge = dormerDraftForRender.ridge;
              var imgMousePt = drawState.lastMouseImage;
              function drawPointMarker(pt) {
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
                ctx.fillStyle = "#000000";
                ctx.fill();
              }
              if (pts.length > 0) {
                ctx.save();
                ctx.strokeStyle = "#000000";
                ctx.lineWidth = 2;
                ctx.beginPath();
                var d0 = imageToScreen(pts[0]);
                ctx.moveTo(d0.x, d0.y);
                for (var i = 1; i < pts.length; i++) {
                  var di = imageToScreen(pts[i]);
                  ctx.lineTo(di.x, di.y);
                }
                if (dormerDraftForRender.contour && dormerDraftForRender.contour.closed) {
                  ctx.closePath();
                }
                ctx.stroke();
                ctx.restore();
                for (var i = 0; i < pts.length; i++) {
                  drawPointMarker(imageToScreen(pts[i]));
                }
              }
              if ((drawState.dormerStep === 2 || window.CALPINAGE_MODE === MODE_DORMER_CONTOUR) && pts.length > 0 && imgMousePt && (!dormerDraftForRender.contour || !dormerDraftForRender.contour.closed)) {
                ctx.save();
                ctx.strokeStyle = "#666";
                ctx.setLineDash([5, 5]);
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                var lastSc = imageToScreen(pts[pts.length - 1]);
                var mouseSc = imageToScreen(imgMousePt);
                ctx.moveTo(lastSc.x, lastSc.y);
                ctx.lineTo(mouseSc.x, mouseSc.y);
                ctx.stroke();
                ctx.restore();
              }
              if (window.CALPINAGE_MODE === MODE_DORMER_CONTOUR && pts.length >= 3 && pts[0] && drawState.hoverNearFirstPointDormer) {
                ctx.save();
                ctx.strokeStyle = "#00aa00";
                ctx.lineWidth = 2;
                ctx.beginPath();
                var p0Sc = imageToScreen(pts[0]);
                ctx.arc(p0Sc.x, p0Sc.y, 7, 0, Math.PI * 2);
                ctx.stroke();
                ctx.fillStyle = "#00aa00";
                ctx.font = "11px Arial";
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillText("Fermeture", p0Sc.x, p0Sc.y + 10);
                ctx.restore();
              }
              if (ridge && ridge.a) {
                ctx.save();
                ctx.strokeStyle = "#000000";
                ctx.lineWidth = 2;
                ctx.beginPath();
                var sa = imageToScreen(ridge.a);
                ctx.moveTo(sa.x, sa.y);
                if (ridge.b) {
                  var sb = imageToScreen(ridge.b);
                  ctx.lineTo(sb.x, sb.y);
                }
                ctx.stroke();
                ctx.restore();
                drawPointMarker(imageToScreen(ridge.a));
                if (ridge.b) drawPointMarker(imageToScreen(ridge.b));
              }
              var hips = dormerDraftForRender.hips;
              if (hips) {
                ctx.save();
                ctx.strokeStyle = "#000000";
                ctx.lineWidth = 2;
                if (hips.left && hips.left.a && hips.left.b) {
                  ctx.beginPath();
                  ctx.moveTo(imageToScreen(hips.left.a).x, imageToScreen(hips.left.a).y);
                  ctx.lineTo(imageToScreen(hips.left.b).x, imageToScreen(hips.left.b).y);
                  ctx.stroke();
                }
                if (hips.right && hips.right.a && hips.right.b) {
                  ctx.beginPath();
                  ctx.moveTo(imageToScreen(hips.right.a).x, imageToScreen(hips.right.a).y);
                  ctx.lineTo(imageToScreen(hips.right.b).x, imageToScreen(hips.right.b).y);
                  ctx.stroke();
                }
                ctx.restore();
              }
              if (window.CALPINAGE_MODE === MODE_DORMER_RIDGE && ridge && ridge.a && !ridge.b && imgMousePt) {
                var draft = dormerDraftForRender;
                var snapVertex = draft && draft.contour && draft.contour.points
                  ? snapToDormerVertex(imgMousePt, draft.contour.points, 15)
                  : null;
                var roofContours = (CALPINAGE_STATE.contours || []).filter(function (c) { return c.roofRole !== "chienAssis"; });
                var ridgeSnap = snapToRoofContour(imgMousePt, roofContours, 15);
                if (snapVertex) drawState.dormerSnapActive = true;
                else if (ridgeSnap) drawState.dormerSnapActive = true;
                var ridgeEndPt = snapVertex || ridgeSnap || imgMousePt;
                var hasSnap = !!snapVertex || !!ridgeSnap;
                ctx.save();
                ctx.strokeStyle = hasSnap ? "#00aa00" : "#666";
                ctx.setLineDash([5, 5]);
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                var raSc = imageToScreen(ridge.a);
                var endSc = imageToScreen(ridgeEndPt);
                ctx.moveTo(raSc.x, raSc.y);
                ctx.lineTo(endSc.x, endSc.y);
                ctx.stroke();
                if (snapVertex) {
                  ctx.beginPath();
                  ctx.arc(endSc.x, endSc.y, 6, 0, Math.PI * 2);
                  ctx.fillStyle = "#00dd00";
                  ctx.fill();
                } else if (ridgeSnap) {
                  ctx.beginPath();
                  ctx.arc(endSc.x, endSc.y, 5, 0, Math.PI * 2);
                  ctx.fillStyle = "#ff8800";
                  ctx.fill();
                }
                ctx.restore();
              }
              if (window.CALPINAGE_MODE === MODE_DORMER_HIPS && imgMousePt) {
                var draft = dormerDraftForRender;
                var hips = draft.hips;
                var contourPts = draft.contour.points;
                ctx.save();
                ctx.setLineDash([5, 5]);
                ctx.lineWidth = 1.5;
                if (!hips.left && contourPts && contourPts.length >= 3) {
                  var startSnap = snapToContourEdge(imgMousePt, contourPts, 15);
                  if (startSnap) drawState.dormerSnapActive = true;
                  ctx.strokeStyle = startSnap ? "#00aa00" : "#666";
                  ctx.beginPath();
                  ctx.moveTo(imageToScreen(startSnap || imgMousePt).x, imageToScreen(startSnap || imgMousePt).y);
                  ctx.lineTo(imageToScreen(imgMousePt).x, imageToScreen(imgMousePt).y);
                  ctx.stroke();
                  if (startSnap) {
                    ctx.beginPath();
                    ctx.arc(imageToScreen(startSnap).x, imageToScreen(startSnap).y, 5, 0, Math.PI * 2);
                    ctx.fillStyle = "#0066ff";
                    ctx.fill();
                  }
                } else if (hips.left && hips.left.b === null) {
                  ctx.strokeStyle = "#666";
                  ctx.beginPath();
                  ctx.moveTo(imageToScreen(hips.left.a).x, imageToScreen(hips.left.a).y);
                  ctx.lineTo(imageToScreen(imgMousePt).x, imageToScreen(imgMousePt).y);
                  ctx.stroke();
                } else if (!hips.right && contourPts && contourPts.length >= 3) {
                  var startSnap2 = snapToContourEdge(imgMousePt, contourPts, 15);
                  if (startSnap2) drawState.dormerSnapActive = true;
                  ctx.strokeStyle = startSnap2 ? "#00aa00" : "#666";
                  ctx.beginPath();
                  ctx.moveTo(imageToScreen(startSnap2 || imgMousePt).x, imageToScreen(startSnap2 || imgMousePt).y);
                  ctx.lineTo(imageToScreen(imgMousePt).x, imageToScreen(imgMousePt).y);
                  ctx.stroke();
                  if (startSnap2) {
                    ctx.beginPath();
                    ctx.arc(imageToScreen(startSnap2).x, imageToScreen(startSnap2).y, 5, 0, Math.PI * 2);
                    ctx.fillStyle = "#0066ff";
                    ctx.fill();
                  }
                } else if (hips.right && hips.right.b === null) {
                  var snapOnFirst = snapToSegment(imgMousePt, hips.left.a, hips.left.b, 15);
                  if (snapOnFirst) drawState.dormerSnapActive = true;
                  var endPt = snapOnFirst || imgMousePt;
                  ctx.strokeStyle = snapOnFirst ? "#00aa00" : "#666";
                  ctx.beginPath();
                  ctx.moveTo(imageToScreen(hips.right.a).x, imageToScreen(hips.right.a).y);
                  ctx.lineTo(imageToScreen(endPt).x, imageToScreen(endPt).y);
                  ctx.stroke();
                  if (snapOnFirst) {
                    ctx.beginPath();
                    ctx.arc(imageToScreen(snapOnFirst).x, imageToScreen(snapOnFirst).y, 5, 0, Math.PI * 2);
                    ctx.fillStyle = "#00aa00";
                    ctx.fill();
                  }
                }
                ctx.restore();
              }
            }
            if (window.CALPINAGE_MODE === MODE_CREATE_DORMER || window.CALPINAGE_MODE === MODE_DORMER_CONTOUR || window.CALPINAGE_MODE === MODE_DORMER_RIDGE || window.CALPINAGE_MODE === MODE_DORMER_HIPS) {
              ctx.save();
              ctx.fillStyle = "rgba(0,0,0,0.7)";
              ctx.font = "14px Arial";
              var text = "";
              if (window.CALPINAGE_MODE === MODE_DORMER_CONTOUR) {
                text = "Tracez le contour — Cliquez près du 1er point pour fermer";
              }
              if (window.CALPINAGE_MODE === MODE_DORMER_HIPS) {
                text = "1er arêtier : contour → intérieur | 2e arêtier : contour → snap sur 1er";
              }
              if (window.CALPINAGE_MODE === MODE_DORMER_RIDGE) {
                text = "Cliquez pour définir l'extrémité du faîtage";
              }
              if (text) {
                ctx.fillText(text, 20, 30);
              }
              ctx.restore();
            }
            /* ========== Phase 3 ??? Rendu visuel panneaux et fant??mes ==========
             * Utilise UNIQUEMENT les projections fournies et l'?tat (valide/invalide).
             * Aucun calcul g?om?trique, aucun test m?tier.
             *
             * Style panneaux : rectangle ext?rieur gris (vide), surface int?rieure noire,
             * marge visuelle = ?paisseur du cadre. Lisible ? tous les zooms.
             * ??tats : normal = cadre gris ; invalide = cadre rouge, int?rieur noir inchang? (pure visuel).
             *
             * Fant??mes : affich?s uniquement s'ils sont valides (moteur), projection r?elle,
             * contour l?ger pointill?, couleur neutre (gris clair). Jamais rouge, jamais remplis.
             *
             * Ordre de dessin : 1) panneaux fig?s, 2) panneaux bloc actif, 3) fant??mes, 4) aides optionnelles.
             */
            /* SHADOW_VOLUMES : footprint orange — Phase 2 + Phase 3 */
            var svList = CALPINAGE_STATE.shadowVolumes || [];
            if (svList.length > 0) {
              var mpp = (CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.scale && CALPINAGE_STATE.roof.scale.metersPerPixel) || 1;
              for (var svi = 0; svi < svList.length; svi++) {
                var sv = svList[svi];
                if (!sv || sv.type !== "shadow_volume") continue;
                var wPx = (sv.width || 0.6) / mpp;
                var dPx = (sv.depth || 0.6) / mpp;
                var rotDeg = typeof sv.rotation === "number" ? sv.rotation : 0;
                var cx = sv.x, cy = sv.y;
                var rotRad = (rotDeg * Math.PI) / 180;
                var cos = Math.cos(rotRad), sin = Math.sin(rotRad);
                function rotatePoint(x, y, ox, oy) {
                  var dx = x - ox, dy = y - oy;
                  return { x: ox + dx * cos - dy * sin, y: oy + dx * sin + dy * cos };
                }
                if (sv.shape === "tube") {
                  var r = wPx / 2;
                  var sc = imageToScreen({ x: cx, y: cy });
                  var rScreen = r * vp.scale;
                  ctx.beginPath();
                  ctx.arc(sc.x, sc.y, Math.max(2, rScreen), 0, Math.PI * 2);
                  ctx.fillStyle = "rgba(255,140,0,0.15)";
                  ctx.fill();
                  ctx.strokeStyle = "#ff8c00";
                  ctx.lineWidth = 2;
                  ctx.stroke();
                } else {
                  var hw = wPx / 2, hd = dPx / 2;
                  var pts = [
                    rotatePoint(cx - hw, cy - hd, cx, cy),
                    rotatePoint(cx + hw, cy - hd, cx, cy),
                    rotatePoint(cx + hw, cy + hd, cx, cy),
                    rotatePoint(cx - hw, cy + hd, cx, cy)
                  ];
                  ctx.beginPath();
                  var sp0 = imageToScreen(pts[0]);
                  ctx.moveTo(sp0.x, sp0.y);
                  for (var pti = 1; pti < pts.length; pti++) {
                    var sp = imageToScreen(pts[pti]);
                    ctx.lineTo(sp.x, sp.y);
                  }
                  ctx.closePath();
                  ctx.fillStyle = "rgba(255,140,0,0.15)";
                  ctx.fill();
                  ctx.strokeStyle = "#ff8c00";
                  ctx.lineWidth = 2;
                  ctx.stroke();
                }
              }
            }
            /* SHADOW HANDLES — Phase 2 + Phase 3 (design premium rotation via CalpinageCanvas) */
            if ((CALPINAGE_STATE.currentPhase === "ROOF_EDIT" || CALPINAGE_STATE.currentPhase === "PV_LAYOUT")) {
              var svSel = drawState.selectedShadowVolumeIndex;
              if (
                svSel != null &&
                CALPINAGE_STATE.shadowVolumes &&
                svSel >= 0 &&
                svSel < CALPINAGE_STATE.shadowVolumes.length &&
                svList[svSel]
              ) {
                var svSelVol = svList[svSel];
                var mppH = (CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.scale && CALPINAGE_STATE.roof.scale.metersPerPixel) || 1;
                var svHoveredRotate = false;
                if (drawState.lastMouseImage && window.CalpinageCanvas && window.CalpinageCanvas.hitTestShadowVolumeHandles) {
                  var screenMouseSv = imageToScreen(drawState.lastMouseImage);
                  var svHandleHit = window.CalpinageCanvas.hitTestShadowVolumeHandles(screenMouseSv, svSelVol, imageToScreen, vp.scale, mppH);
                  svHoveredRotate = !!(svHandleHit && svHandleHit.handle === "rotate");
                }
                if (window.CalpinageCanvas && window.CalpinageCanvas.drawShadowVolumeHandles) {
                  window.CalpinageCanvas.drawShadowVolumeHandles(ctx, svSelVol, imageToScreen, vp.scale, mppH, svHoveredRotate);
                }
              }
            }
            if (CALPINAGE_STATE.currentPhase === "PV_LAYOUT" && window.pvPlacementEngine) {
              var ENG = window.pvPlacementEngine;
              var PANEL_OUTLINE_ACTIVE = "#C39847";
              var PANEL_OUTLINE_SELECTED = "#C39847";
              var PANEL_OUTLINE_FROZEN = "#e5e7eb";
              var PANEL_OUTLINE_INVALID = "#ef4444";
              var PANEL_FILL = "#13171B";
              var PANEL_BORDER = "#242A2F";

              var sunVec = window.__CALPINAGE_SUN_VECTOR;
              var mpp = (CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.scale && CALPINAGE_STATE.roof.scale.metersPerPixel) || 1;
              var rxList = CALPINAGE_STATE.roofExtensions || [];
              var dormerShadowPolys = [];
              if (rxList.length > 0 && sunVec) {
                for (var i = 0; i < rxList.length; i++) {
                  var poly = computeDormerShadowPolygon(rxList[i], sunVec, mpp);
                  if (poly) dormerShadowPolys.push(poly);
                }
              }
              var dormerShadedCount = 0;

              function buildPanelPathSimple(ctx, screenPts) {
                if (!screenPts || screenPts.length < 3) return;
                ctx.moveTo(screenPts[0].x, screenPts[0].y);
                for (var i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i].x, screenPts[i].y);
                ctx.closePath();
              }
              function drawPanelPolygon(ctx, points, imageToScreen, frameColor, lineWidth, dashArray, outlineOnly, glow) {
                if (!points || points.length < 3) return;
                var screenPts = [];
                for (var si = 0; si < points.length; si++) screenPts.push(imageToScreen(points[si]));
                ctx.save();
                ctx.lineJoin = "round";
                ctx.lineCap = "round";
                ctx.shadowBlur = 0;
                ctx.setLineDash([]);
                ctx.globalCompositeOperation = "source-over";
                ctx.globalAlpha = 1;
                if (!outlineOnly) {
                  ctx.beginPath();
                  buildPanelPathSimple(ctx, screenPts);
                  ctx.fillStyle = PANEL_FILL;
                  ctx.fill();
                  ctx.save();
                  ctx.beginPath();
                  buildPanelPathSimple(ctx, screenPts);
                  ctx.clip();
                  if (screenPts.length >= 4) {
                    var p0 = screenPts[0], p1 = screenPts[1], p2 = screenPts[2], p3 = screenPts[3];
                    var wPx = Math.hypot(p1.x - p0.x, p1.y - p0.y);
                    var hPx = Math.hypot(p3.x - p0.x, p3.y - p0.y);
                    var cellSize = Math.max(4, Math.min(wPx, hPx) / 10);
                    var cols = Math.max(4, Math.min(30, Math.floor(wPx / cellSize)));
                    var rows = Math.max(4, Math.min(30, Math.floor(hPx / cellSize)));
                    ctx.strokeStyle = "rgba(255,255,255,0.30)";
                    ctx.lineWidth = 1;
                    for (var ci = 1; ci < cols; ci++) {
                      var t = ci / cols;
                      var startX = p0.x + (p3.x - p0.x) * t;
                      var startY = p0.y + (p3.y - p0.y) * t;
                      var endX = p1.x + (p2.x - p1.x) * t;
                      var endY = p1.y + (p2.y - p1.y) * t;
                      ctx.beginPath();
                      ctx.moveTo(startX, startY);
                      ctx.lineTo(endX, endY);
                      ctx.stroke();
                    }
                    for (var cj = 1; cj < rows; cj++) {
                      var t = cj / rows;
                      var startX = p0.x + (p1.x - p0.x) * t;
                      var startY = p0.y + (p1.y - p0.y) * t;
                      var endX = p3.x + (p2.x - p3.x) * t;
                      var endY = p3.y + (p2.y - p3.y) * t;
                      ctx.beginPath();
                      ctx.moveTo(startX, startY);
                      ctx.lineTo(endX, endY);
                      ctx.stroke();
                    }
                  }
                  ctx.restore();
                  ctx.strokeStyle = PANEL_BORDER;
                  ctx.lineWidth = 1.2;
                  ctx.setLineDash([]);
                  ctx.beginPath();
                  buildPanelPathSimple(ctx, screenPts);
                  ctx.stroke();
                }
                ctx.strokeStyle = frameColor;
                ctx.lineWidth = lineWidth != null ? lineWidth : 2;
                ctx.setLineDash(dashArray || []);
                if (glow) {
                  ctx.shadowColor = "rgba(195,152,71,0.6)";
                  ctx.shadowBlur = 10;
                }
                ctx.beginPath();
                buildPanelPathSimple(ctx, screenPts);
                ctx.stroke();
                if (glow) ctx.shadowBlur = 0;
                ctx.globalAlpha = 1;
                ctx.globalCompositeOperation = "source-over";
                ctx.restore();
              }
              /** Pendant manipulation : dessine le panneau en appliquant uniquement dx/dy/rotation (aucun recalcul métier). */
              function drawPanelWithTransform(ctx, panel, block, imageToScreen, frameColor, lineWidth, dashArray, outlineOnly, glow) {
                if (!panel || !panel.projection || !panel.projection.points || panel.projection.points.length < 3) return;
                var t = block.manipulationTransform;
                if (!t) return;
                var center = ENG.getBlockCenter ? ENG.getBlockCenter(block) : null;
                if (!center) return;
                var cos = Math.cos((t.rotationDeg || 0) * Math.PI / 180);
                var sin = Math.sin((t.rotationDeg || 0) * Math.PI / 180);
                var ox = (t.offsetX || 0), oy = (t.offsetY || 0);
                var pts = [];
                for (var ti = 0; ti < panel.projection.points.length; ti++) {
                  var p = panel.projection.points[ti];
                  var dx = p.x - center.x, dy = p.y - center.y;
                  pts.push({ x: center.x + dx * cos - dy * sin + ox, y: center.y + dx * sin + dy * cos + oy });
                }
                drawPanelPolygon(ctx, pts, imageToScreen, frameColor, lineWidth, dashArray, outlineOnly, glow);
              }

              var focusBlock = ENG.getFocusBlock ? ENG.getFocusBlock() : null;
              var activeBl = ENG.getActiveBlock ? ENG.getActiveBlock() : null;
              var visibleScreenPtsForHandles = [];
              var selectedBlockScreenPts = null;
              var selectedBlockForTooltip = null;

              /* drawBlockSelectionShadow supprimé : grand rectangle noir PANEL_FILL + contour masquait la précision de pose */

              function drawBlockSelectionBorderAndTooltip(ctx, screenPts, block) {
                if (!screenPts || screenPts.length < 3 || !block) return;
                var minX = screenPts[0].x, maxX = screenPts[0].x, minY = screenPts[0].y, maxY = screenPts[0].y;
                for (var i = 1; i < screenPts.length; i++) {
                  var pt = screenPts[i];
                  if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
                  if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
                }
                ctx.save();
                /* Contour englobant doré supprimé : masquait la précision de pose près des obstacles */
                var centerX = (minX + maxX) / 2;
                var topY = minY;
                var tooltipY = topY - 18;
                var nbPanels = block.panels ? block.panels.length : 0;
                var selPanel = window.PV_SELECTED_PANEL || (window.CALPINAGE_SELECTED_PANEL_ID && typeof findPanelById === "function" ? findPanelById(window.CALPINAGE_SELECTED_PANEL_ID) : null);
                var powerWc = selPanel && (selPanel.power_wc != null || selPanel.powerWc != null) ? (Number(selPanel.power_wc || selPanel.powerWc) || 0) : 0;
                var totalKwc = nbPanels > 0 && powerWc > 0 ? (nbPanels * powerWc) / 1000 : 0;
                var kwcStr = totalKwc > 0 ? totalKwc.toFixed(2) : "0";
                var txt1 = nbPanels === 1 ? "1 panneau" : nbPanels + " panneaux";
                var txt2 = kwcStr + " kWc";
                ctx.font = "11px system-ui, -apple-system, sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                var m1 = ctx.measureText(txt1);
                var m2 = ctx.measureText(txt2);
                var tw = Math.max(m1.width, m2.width) + 20;
                var th = 40;
                var tx = centerX - tw / 2;
                var ty = tooltipY - th / 2;
                ctx.fillStyle = "rgba(15,15,15,0.92)";
                ctx.strokeStyle = "#C39847";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(tx + 8, ty);
                ctx.lineTo(tx + tw - 8, ty);
                ctx.quadraticCurveTo(tx + tw, ty, tx + tw, ty + 8);
                ctx.lineTo(tx + tw, ty + th - 8);
                ctx.quadraticCurveTo(tx + tw, ty + th, tx + tw - 8, ty + th);
                ctx.lineTo(tx + 8, ty + th);
                ctx.quadraticCurveTo(tx, ty + th, tx, ty + th - 8);
                ctx.lineTo(tx, ty + 8);
                ctx.quadraticCurveTo(tx, ty, tx + 8, ty);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = "#e5e7eb";
                ctx.fillText(txt1, centerX, ty + th / 2 - 8);
                ctx.fillText(txt2, centerX, ty + th / 2 + 8);
                ctx.restore();
              }

              /* 1) Panneaux fig?s : FROZEN (1.5 px) ou SELECTED (2.5 px) si bloc focus ; d?sactiv?s = contour ghost */
              var frozen = ENG.getFrozenBlocks();
              for (var fi = 0; fi < frozen.length; fi++) {
                var bl = frozen[fi];
                if (!bl.panels) continue;
                var isSelectedFrozen = focusBlock && focusBlock.id === bl.id && !activeBl;
                if (isSelectedFrozen) {
                  var frozenScreenPts = [];
                  for (var fpi = 0; fpi < bl.panels.length; fpi++) {
                    var fproj = bl.panels[fpi].projection;
                    if (fproj && fproj.points) {
                      for (var fk = 0; fk < fproj.points.length; fk++) frozenScreenPts.push(imageToScreen(fproj.points[fk]));
                    }
                  }
                  if (frozenScreenPts.length >= 3) {
                    selectedBlockScreenPts = frozenScreenPts;
                    selectedBlockForTooltip = bl;
                  }
                }
                var outlineColor = isSelectedFrozen ? PANEL_OUTLINE_SELECTED : PANEL_OUTLINE_FROZEN;
                var outlineWidth = isSelectedFrozen ? 2.5 : 1.5;
                for (var pi = 0; pi < bl.panels.length; pi++) {
                  var p = bl.panels[pi];
                  var proj = p.projection;
                  if (!proj || !proj.points) continue;
                  if (p.enabled === false) {
                    drawPanelPolygon(ctx, proj.points, imageToScreen, outlineColor, outlineWidth, [6, 4], true, isSelectedFrozen);
                  } else {
                    drawPanelPolygon(ctx, proj.points, imageToScreen, outlineColor, outlineWidth, [], false, isSelectedFrozen);
                  }
                  if (vp && typeof vp.scale === "number" && focusBlock && bl.id === focusBlock.id && !activeBl) {
                    for (var vk = 0; vk < proj.points.length; vk++) visibleScreenPtsForHandles.push(imageToScreen(proj.points[vk]));
                  }
                  var panelPoly = proj.points;
                  var center = getPanelCenterFromPoly(panelPoly);
                  var isDormerShaded = dormerShadowPolys.some(function (poly) { return pointInPolygon(center, poly); });
                  if (isDormerShaded) {
                    dormerShadedCount++;
                    ctx.save();
                    ctx.fillStyle = "rgba(0,0,0,0.18)";
                    ctx.beginPath();
                    var sp0 = imageToScreen(panelPoly[0]);
                    ctx.moveTo(sp0.x, sp0.y);
                    for (var k = 1; k < panelPoly.length; k++) {
                      var spk = imageToScreen(panelPoly[k]);
                      ctx.lineTo(spk.x, spk.y);
                    }
                    ctx.closePath();
                    ctx.fill();
                    ctx.restore();
                  }
                }
              }

              /* 2) Bloc actif : pendant manipulation = pure transformation visuelle ; sinon projection métier */
              if (activeBl && activeBl.panels && focusBlock && activeBl.id === focusBlock.id) {
                var activeScreenPts = [];
                for (var api = 0; api < activeBl.panels.length; api++) {
                  var ap = activeBl.panels[api];
                  var apoly = null;
                  if (window.CALPINAGE_IS_MANIPULATING && activeBl.manipulationTransform && ap.projection && ap.projection.points) {
                    var centerAct = ENG.getBlockCenter ? ENG.getBlockCenter(activeBl) : null;
                    if (centerAct) {
                      var t = activeBl.manipulationTransform;
                      var cos = Math.cos((t.rotationDeg || 0) * Math.PI / 180);
                      var sin = Math.sin((t.rotationDeg || 0) * Math.PI / 180);
                      var ox = t.offsetX || 0, oy = t.offsetY || 0;
                      apoly = [];
                      for (var ti = 0; ti < ap.projection.points.length; ti++) {
                        var pt = ap.projection.points[ti];
                        var dx = pt.x - centerAct.x, dy = pt.y - centerAct.y;
                        apoly.push({ x: centerAct.x + dx * cos - dy * sin + ox, y: centerAct.y + dx * sin + dy * cos + oy });
                      }
                    }
                  } else {
                    var effProj = ENG.getEffectivePanelProjection ? ENG.getEffectivePanelProjection(activeBl, api) : null;
                    if (effProj && effProj.points) apoly = effProj.points;
                  }
                  if (apoly) for (var ak = 0; ak < apoly.length; ak++) activeScreenPts.push(imageToScreen(apoly[ak]));
                }
                if (activeScreenPts.length >= 3) {
                  selectedBlockScreenPts = activeScreenPts;
                  selectedBlockForTooltip = activeBl;
                }
              }
              if (activeBl && activeBl.panels) {
                for (var pi = 0; pi < activeBl.panels.length; pi++) {
                  var p = activeBl.panels[pi];
                  var isInvalid = p.state === "invalid";
                  var outlineColor = isInvalid ? PANEL_OUTLINE_INVALID : PANEL_OUTLINE_ACTIVE;
                  var outlineWidth = isInvalid ? 3 : 2.5;
                  var dash = isInvalid ? [6, 4] : [];
                  var panelPolyAct = null;
                  if (window.CALPINAGE_IS_MANIPULATING && activeBl.manipulationTransform) {
                    drawPanelWithTransform(ctx, p, activeBl, imageToScreen, outlineColor, outlineWidth, dash, false, !isInvalid);
                    if (p.projection && p.projection.points) {
                      var centerAct = ENG.getBlockCenter ? ENG.getBlockCenter(activeBl) : null;
                      if (centerAct) {
                        var t = activeBl.manipulationTransform;
                        var cos = Math.cos((t.rotationDeg || 0) * Math.PI / 180);
                        var sin = Math.sin((t.rotationDeg || 0) * Math.PI / 180);
                        var ox = t.offsetX || 0, oy = t.offsetY || 0;
                        panelPolyAct = [];
                        for (var ti = 0; ti < p.projection.points.length; ti++) {
                          var pt = p.projection.points[ti];
                          var dx = pt.x - centerAct.x, dy = pt.y - centerAct.y;
                          panelPolyAct.push({ x: centerAct.x + dx * cos - dy * sin + ox, y: centerAct.y + dx * sin + dy * cos + oy });
                        }
                      }
                    }
                  } else {
                    var effProj = ENG.getEffectivePanelProjection(activeBl, pi);
                    if (!effProj || !effProj.points) continue;
                    drawPanelPolygon(ctx, effProj.points, imageToScreen, outlineColor, outlineWidth, dash, false, !isInvalid);
                    panelPolyAct = effProj.points;
                  }
                  if (panelPolyAct) {
                    if (vp && typeof vp.scale === "number" && focusBlock && activeBl.id === focusBlock.id) {
                      for (var vk = 0; vk < panelPolyAct.length; vk++) visibleScreenPtsForHandles.push(imageToScreen(panelPolyAct[vk]));
                    }
                    var centerAct = getPanelCenterFromPoly(panelPolyAct);
                    var isDormerShadedAct = dormerShadowPolys.some(function (poly) { return pointInPolygon(centerAct, poly); });
                    if (isDormerShadedAct) {
                      dormerShadedCount++;
                      ctx.save();
                      ctx.fillStyle = "rgba(0,0,0,0.18)";
                      ctx.beginPath();
                      var sp0Act = imageToScreen(panelPolyAct[0]);
                      ctx.moveTo(sp0Act.x, sp0Act.y);
                      for (var k = 1; k < panelPolyAct.length; k++) {
                        var spkAct = imageToScreen(panelPolyAct[k]);
                        ctx.lineTo(spkAct.x, spkAct.y);
                      }
                      ctx.closePath();
                      ctx.fill();
                      ctx.restore();
                    }
                  }
                }
              }
              /* 3) Ghosts moteur (expansion) : affich?s pour le bloc actif. Tous les ghosts retourn?s par le moteur sont dessin?s, aucun filtrage. */
              if (activeBl && ENG.computeExpansionGhosts && (typeof getProjectionContextForBlock === "function" || typeof getProjectionContextForPan === "function")) {
                var getCtxForGhosts = function () { return typeof getProjectionContextForBlock === "function" ? getProjectionContextForBlock(activeBl) : getProjectionContextForPan(activeBl.panId); };
                var ghosts = ENG.computeExpansionGhosts(activeBl, getCtxForGhosts);
                if (Array.isArray(ghosts)) {
                  for (var gi = 0; gi < ghosts.length; gi++) {
                    var g = ghosts[gi];
                    if (!g || !g.center || !g.projection || !g.projection.points) continue;
                    ctx.save();
                    ctx.fillStyle = "rgba(200,200,200,0.35)";
                    ctx.strokeStyle = "rgba(160,160,160,0.6)";
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    var gp0 = imageToScreen(g.projection.points[0]);
                    ctx.moveTo(gp0.x, gp0.y);
                    for (var gk = 1; gk < g.projection.points.length; gk++) {
                      var gpk = imageToScreen(g.projection.points[gk]);
                      ctx.lineTo(gpk.x, gpk.y);
                    }
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                    ctx.restore();
                  }
                }
              }
              /* B2.1 ??? Fl?che sens de pente du pan actif (overlay lecture seule, fa??tage ??? goutti?re) */
              if (activeBl && (typeof getProjectionContextForBlock === "function" || typeof getProjectionContextForPan === "function")) {
                var panCtx = typeof getProjectionContextForBlock === "function" ? getProjectionContextForBlock(activeBl) : getProjectionContextForPan(activeBl.panId);
                if (panCtx && panCtx.roofParams && typeof panCtx.roofParams.roofAzimuthDeg === "number") {
                  var adapter = window.CALPINAGE_DP2_ADAPTER;
                  var centerImg = adapter && typeof adapter.getBlockCenter === "function" ? adapter.getBlockCenter(activeBl) : null;
                  if (centerImg) {
                    var centerScr = imageToScreen(centerImg);
                    var angleRad = (panCtx.roofParams.roofAzimuthDeg - 90) * Math.PI / 180;
                    var L = 50;
                    var endScr = {
                      x: centerScr.x + Math.cos(angleRad) * L,
                      y: centerScr.y + Math.sin(angleRad) * L
                    };
                    ctx.save();
                    ctx.strokeStyle = "rgba(255, 200, 80, 0.9)";
                    ctx.lineWidth = 2;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(centerScr.x, centerScr.y);
                    ctx.lineTo(endScr.x, endScr.y);
                    ctx.stroke();
                    var head = 8;
                    var a1 = angleRad + Math.PI * 0.8;
                    var a2 = angleRad - Math.PI * 0.8;
                    ctx.beginPath();
                    ctx.moveTo(endScr.x, endScr.y);
                    ctx.lineTo(endScr.x + Math.cos(a1) * head, endScr.y + Math.sin(a1) * head);
                    ctx.moveTo(endScr.x, endScr.y);
                    ctx.lineTo(endScr.x + Math.cos(a2) * head, endScr.y + Math.sin(a2) * head);
                    ctx.stroke();
                    ctx.restore();
                  }
                }
              }
              /* Couche sélection bloc : bordure nette + mini infobulle (après panneaux, avant handles) */
              if (focusBlock && selectedBlockScreenPts && selectedBlockForTooltip) {
                drawBlockSelectionBorderAndTooltip(ctx, selectedBlockScreenPts, selectedBlockForTooltip);
              }
              /* Poignées rotation / déplacement du bloc focus (lignes premium + boutons) */
              if (
                CALPINAGE_STATE.currentPhase === "PV_LAYOUT" &&
                vp &&
                typeof vp.scale === "number" &&
                focusBlock &&
                (visibleScreenPtsForHandles.length >= 3 || typeof getManipulationHandlePositions === "function")
              ) {
                var rScr = null, mScr = null, topScr = null, bottomScr = null;
                if (visibleScreenPtsForHandles.length >= 3) {
                  var vMinX = visibleScreenPtsForHandles[0].x, vMaxX = visibleScreenPtsForHandles[0].x;
                  var vMinY = visibleScreenPtsForHandles[0].y, vMaxY = visibleScreenPtsForHandles[0].y;
                  for (var vi = 1; vi < visibleScreenPtsForHandles.length; vi++) {
                    var vpt = visibleScreenPtsForHandles[vi];
                    if (vpt.x < vMinX) vMinX = vpt.x; if (vpt.x > vMaxX) vMaxX = vpt.x;
                    if (vpt.y < vMinY) vMinY = vpt.y; if (vpt.y > vMaxY) vMaxY = vpt.y;
                  }
                  var vCenterX = (vMinX + vMaxX) / 2;
                  var vTopY = vMinY;
                  var vBottomY = vMaxY;
                  var vBlockHeight = vMaxY - vMinY;
                  var vOffset = Math.max(18, vBlockHeight * 0.12);
                  rScr = { x: vCenterX, y: vTopY - vOffset };
                  mScr = { x: vCenterX, y: vBottomY + vOffset };
                  topScr = { x: vCenterX, y: vTopY };
                  bottomScr = { x: vCenterX, y: vBottomY };
                } else if (typeof getManipulationHandlePositions === "function") {
                  var posHandles = getManipulationHandlePositions(focusBlock);
                  if (posHandles) {
                    rScr = imageToScreen(posHandles.rotate);
                    mScr = imageToScreen(posHandles.move);
                    topScr = imageToScreen({ x: posHandles.centerX, y: posHandles.topY });
                    bottomScr = imageToScreen({ x: posHandles.centerX, y: posHandles.bottomY });
                  }
                }
                if (rScr && mScr && topScr && bottomScr) {
                  ctx.save();
                  ctx.strokeStyle = "rgba(255,255,255,0.25)";
                  ctx.lineWidth = 1;
                  ctx.beginPath();
                  ctx.moveTo(topScr.x, topScr.y);
                  ctx.lineTo(rScr.x, rScr.y);
                  ctx.stroke();
                  ctx.beginPath();
                  ctx.moveTo(bottomScr.x, bottomScr.y);
                  ctx.lineTo(mScr.x, mScr.y);
                  ctx.stroke();
                  /* Rotation handle : cercle plein 8px, fill #C39847, stroke rgba(0,0,0,0.35), shadowBlur 1.5, pas d'icône */
                  var radiusRotate = 8, radiusMove = 5;
                  ctx.shadowBlur = 1.5;
                  ctx.fillStyle = "#C39847";
                  ctx.strokeStyle = "rgba(0,0,0,0.35)";
                  ctx.lineWidth = 1;
                  ctx.beginPath();
                  ctx.arc(rScr.x, rScr.y, radiusRotate, 0, Math.PI * 2);
                  ctx.fill();
                  ctx.stroke();
                  ctx.shadowBlur = 0;
                  /* Move handle : cercle blanc 5px, stroke #C39847, pas d'ombre, pas d'icône */
                  ctx.fillStyle = "#ffffff";
                  ctx.strokeStyle = "#C39847";
                  ctx.lineWidth = 1;
                  ctx.beginPath();
                  ctx.arc(mScr.x, mScr.y, radiusMove, 0, Math.PI * 2);
                  ctx.fill();
                  ctx.stroke();
                  ctx.restore();
                }
              }
              /* Message ajout de bloc : visible lorsqu'aucun focus */
              var pvHintEl = container.querySelector("#pv-add-block-hint");
              if (pvHintEl) pvHintEl.style.display = focusBlock ? "none" : "block";

              ctx.save();
              ctx.fillStyle = "rgba(0,0,0,0.7)";
              ctx.font = "14px Arial";
              ctx.fillText("Panneaux ombragés (chien assis) : " + dormerShadedCount, 20, 50);
              ctx.restore();

              /* Aucun state.panels : les panneaux sont uniquement ceux du calpinage (blocs). DP2 utilise l'adapter. */
            }
            /* 4b. Debug pans : overlay semi-transparent de toutes les faces d?tect?es (CALPINAGE_DEBUG_PANS=1) */
            if (typeof CALPINAGE_DEBUG_PANS !== "undefined" && CALPINAGE_DEBUG_PANS && CALPINAGE_STATE.debugFaces && CALPINAGE_STATE.debugFaces.length) {
              var colors = ["rgba(255,99,71,0.25)", "rgba(70,130,180,0.25)", "rgba(50,205,50,0.25)", "rgba(255,215,0,0.25)", "rgba(186,85,211,0.25)", "rgba(0,206,209,0.25)"];
              CALPINAGE_STATE.debugFaces.forEach(function (poly, idx) {
                if (!poly || poly.length < 3) return;
                ctx.beginPath();
                var d0 = imageToScreen(poly[0]);
                ctx.moveTo(d0.x, d0.y);
                for (var di = 1; di < poly.length; di++) {
                  var dp = imageToScreen(poly[di]);
                  ctx.lineTo(dp.x, dp.y);
                }
                ctx.closePath();
                ctx.fillStyle = colors[idx % colors.length];
                ctx.fill();
                ctx.strokeStyle = "rgba(0,0,0,0.4)";
                ctx.lineWidth = 1;
                ctx.stroke();
              });
            }
            /* 5. Labels de segments (contour main uniquement) */
            for (var ci = 0; ci < CALPINAGE_STATE.contours.length; ci++) {
              var c = CALPINAGE_STATE.contours[ci];
              if (c && c.points && c.points.length >= 2 && c.closed && c.roofRole !== "chienAssis") drawContourSegmentLabels(ctx, c);
            }
            var activeContourPts = CALPINAGE_STATE.activeContour.points;
            if (activeContourPts.length >= 2) {
              drawContourSegmentLabels(ctx, { points: activeContourPts, closed: false });
            }
            /* 5. Contour actif + mesures live */
            var hoverPt = CALPINAGE_STATE.activeContour.hoverPoint;
            if (activeContourPts.length >= 1) {
              ctx.strokeStyle = "#c9a449";
              ctx.lineWidth = 2;
              ctx.setLineDash([]);
              ctx.beginPath();
              var dFirst = imageToScreen(activeContourPts[0]);
              ctx.moveTo(dFirst.x, dFirst.y);
              for (var k = 1; k < activeContourPts.length; k++) {
                var dP = imageToScreen(activeContourPts[k]);
                ctx.lineTo(dP.x, dP.y);
              }
              if (hoverPt) {
                var lastSc = imageToScreen(activeContourPts[activeContourPts.length - 1]);
                var mouseSc = imageToScreen(hoverPt);
                ctx.lineTo(mouseSc.x, mouseSc.y);
              } else if (drawState.lastMouseImage) {
                var lastSc = imageToScreen(activeContourPts[activeContourPts.length - 1]);
                var mouseSc = imageToScreen(drawState.lastMouseImage);
                ctx.lineTo(mouseSc.x, mouseSc.y);
              }
              ctx.stroke();
              ctx.fillStyle = "#1f2937";
              for (var m = 0; m < activeContourPts.length; m++) {
                var dSc = imageToScreen(activeContourPts[m]);
                ctx.beginPath();
                var r = (m === 0 && drawState.hoverNearFirstPoint) ? 7 : 5;
                ctx.arc(dSc.x, dSc.y, r, 0, Math.PI * 2);
                if (m === 0 && drawState.hoverNearFirstPoint) {
                  ctx.fillStyle = "#c9a449";
                  ctx.fill();
                  ctx.strokeStyle = "#1f2937";
                  ctx.lineWidth = 2;
                  ctx.stroke();
                  ctx.fillStyle = "#1f2937";
                } else {
                  ctx.fill();
                }
              }
              if (hoverPt) {
                var snapSrc = drawState.contourHoverSnapSource;
                var isVertexSnap = snapSrc && typeof snapSrc.pointIndex === "number";
                var isSegmentSnap = snapSrc && snapSrc.pointIndex == null;
                var scHover = imageToScreen(hoverPt);
                ctx.fillStyle = (isVertexSnap || isSegmentSnap) ? "#22c55e" : "#9ca3af";
                ctx.strokeStyle = (isVertexSnap || isSegmentSnap) ? "#16a34a" : "#6b7280";
                ctx.lineWidth = 1.5;
                if (isSegmentSnap) {
                  var s = 5;
                  ctx.beginPath();
                  ctx.moveTo(scHover.x, scHover.y - s);
                  ctx.lineTo(scHover.x + s, scHover.y);
                  ctx.lineTo(scHover.x, scHover.y + s);
                  ctx.lineTo(scHover.x - s, scHover.y);
                  ctx.closePath();
                  ctx.fill();
                  ctx.stroke();
                } else {
                  ctx.beginPath();
                  ctx.arc(scHover.x, scHover.y, 5, 0, Math.PI * 2);
                  ctx.fill();
                  ctx.stroke();
                }
              }
              if (drawState.hoverNearFirstPoint && activeContourPts.length >= 3) {
                var firstSc = imageToScreen(activeContourPts[0]);
                ctx.font = "11px system-ui, sans-serif";
                ctx.fillStyle = "rgba(0,0,0,0.7)";
                ctx.strokeStyle = "#fff";
                ctx.lineWidth = 2;
                ctx.textAlign = "center";
                ctx.textBaseline = "bottom";
                var tip = "Cliquer pour fermer le contour";
                var tx = firstSc.x, ty = firstSc.y - 12;
                ctx.strokeText(tip, tx, ty);
                ctx.fillText(tip, tx, ty);
              }
            }
            drawLiveContourMeasure(ctx);
            drawLiveTrait(ctx);
            drawLiveRidge(ctx);
            if (drawState.activeTool === "ridge" && Date.now() < drawState.ridgeHintMessageUntil) {
              ctx.save();
              ctx.font = "13px system-ui, sans-serif";
              ctx.fillStyle = "rgba(0,0,0,0.75)";
              ctx.strokeStyle = "#fff";
              ctx.lineWidth = 2;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              var cw = canvasEl ? canvasEl.width : 800;
              var ch = canvasEl ? canvasEl.height : 600;
              var msg = "Placez le départ sur une arête du contour";
              ctx.strokeText(msg, cw / 2, ch / 2);
              ctx.fillText(msg, cw / 2, ch / 2);
              ctx.restore();
            }
            if (drawState.activeTool === "trait" && Date.now() < drawState.traitHintMessageUntil) {
              ctx.save();
              ctx.font = "13px system-ui, sans-serif";
              ctx.fillStyle = "rgba(0,0,0,0.75)";
              ctx.strokeStyle = "#fff";
              ctx.lineWidth = 2;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              var cwT = canvasEl ? canvasEl.width : 800;
              var chT = canvasEl ? canvasEl.height : 600;
              var msgT = "Astuce : accrochez l'arête à un bord existant pour plus de précision";
              ctx.strokeText(msgT, cwT / 2, chT / 2);
              ctx.fillText(msgT, cwT / 2, chT / 2);
              ctx.restore();
            }
            /* 7. Mode éditer les hauteurs : tous les points source visibles (contour / faîtage / trait) */
            if (CALPINAGE_STATE.heightEditMode) {
              var contours = (CALPINAGE_STATE.contours || []).filter(function (c) { return c.roofRole !== "chienAssis"; });
              var ridges = (CALPINAGE_STATE.ridges || []).filter(function (r) { return r.roofRole !== "chienAssis"; });
              var traits = (CALPINAGE_STATE.traits || []).filter(function (t) { return t.roofRole !== "chienAssis"; });
              var pts = CALPINAGE_STATE.selectedHeightPoints;
              var sel = (pts && pts.length) ? pts[0] : CALPINAGE_STATE.selectedHeightPoint;
              function isHeightPointSelected(type, idx, pIdx) {
                if (pts && pts.length) return pts.some(function (p) { return p.type === type && p.index === idx && p.pointIndex === pIdx; });
                return sel && sel.type === type && sel.index === idx && sel.pointIndex === pIdx;
              }
              var RAD = 6;
              var RAD_SEL = 8;
              for (var ci = 0; ci < contours.length; ci++) {
                var c = contours[ci];
                if (!c || !c.points) continue;
                for (var j = 0; j < c.points.length; j++) {
                  var sc = imageToScreen(c.points[j]);
                  var isSel = isHeightPointSelected("contour", ci, j);
                  ctx.fillStyle = isSel ? "#c9a449" : "#1f2937";
                  ctx.beginPath();
                  ctx.arc(sc.x, sc.y, isSel ? RAD_SEL : RAD, 0, Math.PI * 2);
                  ctx.fill();
                  if (isSel) { ctx.strokeStyle = "#c9a449"; ctx.lineWidth = 2; ctx.stroke(); }
                }
              }
              for (var ri = 0; ri < ridges.length; ri++) {
                var ridge = ridges[ri];
                if (!ridge || !ridge.a || !ridge.b) continue;
                var raPt = resolveRidgePoint(ridge.a);
                var rbPt = resolveRidgePoint(ridge.b);
                var ra = imageToScreen(raPt);
                var rb = imageToScreen(rbPt);
                for (var endIdx = 0; endIdx < 2; endIdx++) {
                  var rSc = endIdx === 0 ? ra : rb;
                  var isSel = isHeightPointSelected("ridge", ri, endIdx);
                  ctx.fillStyle = isSel ? "orange" : "#b45309";
                  ctx.beginPath();
                  ctx.arc(rSc.x, rSc.y, isSel ? RAD_SEL : RAD, 0, Math.PI * 2);
                  ctx.fill();
                  if (isSel) { ctx.strokeStyle = "orange"; ctx.lineWidth = 2; ctx.stroke(); }
                }
              }
              for (var ti = 0; ti < traits.length; ti++) {
                var tr = traits[ti];
                if (!tr || !tr.a || !tr.b) continue;
                var ta = imageToScreen(tr.a);
                var tb = imageToScreen(tr.b);
                for (var endIdx = 0; endIdx < 2; endIdx++) {
                  var tSc = endIdx === 0 ? ta : tb;
                  var isSel = isHeightPointSelected("trait", ti, endIdx);
                  ctx.fillStyle = isSel ? "#3b82f6" : "#1e40af";
                  ctx.beginPath();
                  ctx.arc(tSc.x, tSc.y, isSel ? RAD_SEL : RAD, 0, Math.PI * 2);
                  ctx.fill();
                  if (isSel) { ctx.strokeStyle = "#3b82f6"; ctx.lineWidth = 2; ctx.stroke(); }
                }
              }
              if (typeof updateHeightEditInplaceOverlay === "function") updateHeightEditInplaceOverlay(imageToScreen, canvasEl);
            } else {
            /* 7b. Poign?es s?lection ??? sommets contour, traits, fa??tage A/B, mesure (quand mode hauteurs OFF) */
            for (var ci = 0; ci < CALPINAGE_STATE.contours.length; ci++) {
              var c = CALPINAGE_STATE.contours[ci];
              if (!c || !c.points || c.points.length < 2) continue;
              var contourSelected = (drawState.activeTool === "contour" || drawState.activeTool === "select") && (drawState.selectedContourIndex === ci || selContourIds.has(c.id));
              if (contourSelected) {
                ctx.fillStyle = "#1f2937";
                for (var j = 0; j < c.points.length; j++) {
                  var sc = imageToScreen(c.points[j]);
                  ctx.beginPath();
                  ctx.arc(sc.x, sc.y, 5, 0, Math.PI * 2);
                  ctx.fill();
                }
              }
            }
            for (var ti = 0; ti < (CALPINAGE_STATE.traits || []).length; ti++) {
              var t = CALPINAGE_STATE.traits[ti];
              if (!t || !t.a || !t.b) continue;
              var ta = imageToScreen(t.a);
              var tb = imageToScreen(t.b);
              if ((drawState.activeTool === "select" && drawState.selectedTraitIndex === ti) || selTraitIds.has(t.id)) {
                ctx.fillStyle = "#1f2937";
                ctx.beginPath();
                ctx.arc(ta.x, ta.y, 5, 0, Math.PI * 2);
                ctx.arc(tb.x, tb.y, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "rgba(100, 149, 237, 0.35)";
                ctx.beginPath();
                ctx.arc(ta.x, ta.y, 6, 0, Math.PI * 2);
                ctx.arc(tb.x, tb.y, 6, 0, Math.PI * 2);
                ctx.fill();
              }
            }
            for (var ri = 0; ri < CALPINAGE_STATE.ridges.length; ri++) {
              var ridge = CALPINAGE_STATE.ridges[ri];
              if (!ridge || !ridge.a || !ridge.b) continue;
              var raPt = resolveRidgePoint(ridge.a);
              var rbPt = resolveRidgePoint(ridge.b);
              var ra = imageToScreen(raPt);
              var rb = imageToScreen(rbPt);
              if (((drawState.activeTool === "select" || drawState.activeTool === "ridge") && drawState.selectedRidgeIndex === ri) || selRidgeIds.has(ridge.id)) {
                ctx.fillStyle = "#1f2937";
                ctx.beginPath();
                ctx.arc(ra.x, ra.y, 5, 0, Math.PI * 2);
                ctx.arc(rb.x, rb.y, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "rgba(180, 83, 9, 0.35)";
                ctx.beginPath();
                ctx.arc(ra.x, ra.y, 6, 0, Math.PI * 2);
                ctx.arc(rb.x, rb.y, 6, 0, Math.PI * 2);
                ctx.fill();
              }
            }
            }
            /* drawMeasures() ??? TOUJOURS (ind?pendant de l?outil actif, toujours visible (S?lection / Contour / Fa??tage / etc.) ; segment + label m ; ne modifie aucune g?om?trie */
            var scaleMperPx = CALPINAGE_STATE.roof.scale && typeof CALPINAGE_STATE.roof.scale.metersPerPixel === "number" ? CALPINAGE_STATE.roof.scale.metersPerPixel : 0;
            // console.log("[SCALE DEBUG] scale source = CALPINAGE_STATE.roof.scale.metersPerPixel (before 2D measures draw)", scaleMperPx);
            for (var mi = 0; mi < CALPINAGE_STATE.measures.length; mi++) {
              var mes = CALPINAGE_STATE.measures[mi];
              if (!mes || !mes.a || !mes.b) continue;
              var sa = imageToScreen(mes.a);
              var sb = imageToScreen(mes.b);
              ctx.strokeStyle = "#2ecc71";
              ctx.lineWidth = 1.5;
              ctx.setLineDash([]);
              ctx.beginPath();
              ctx.moveTo(sa.x, sa.y);
              ctx.lineTo(sb.x, sb.y);
              ctx.stroke();
              if (scaleMperPx > 0) {
                var dx = mes.b.x - mes.a.x;
                var dy = mes.b.y - mes.a.y;
                var distancePixels = Math.hypot(dx, dy);
                var lenM = distancePixels * scaleMperPx;
                var mid = imageToScreen({ x: (mes.a.x + mes.b.x) / 2, y: (mes.a.y + mes.b.y) / 2 });
                ctx.font = "12px system-ui, sans-serif";
                ctx.fillStyle = "#1f2937";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(lenM.toFixed(2).replace(".", ",") + " m", mid.x, mid.y);
              }
              if (drawState.selectedMesureIndex === mi) {
                ctx.fillStyle = "rgba(46, 204, 113, 0.3)";
                ctx.beginPath();
                ctx.arc(sa.x, sa.y, 6, 0, Math.PI * 2);
                ctx.arc(sb.x, sb.y, 6, 0, Math.PI * 2);
                ctx.fill();
              }
            }
            /* Pr?visualisation outil Mesure : A ??? souris */
            if (drawState.activeTool === "mesure" && drawState.measureLineStart && drawState.lastMouseImage) {
              var ma = imageToScreen(drawState.measureLineStart);
              var mm = imageToScreen(drawState.lastMouseImage);
              ctx.strokeStyle = "rgba(46, 204, 113, 0.8)";
              ctx.lineWidth = 1.5;
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.moveTo(ma.x, ma.y);
              ctx.lineTo(mm.x, mm.y);
              ctx.stroke();
              if (scaleMperPx > 0) {
                var pdx = drawState.lastMouseImage.x - drawState.measureLineStart.x;
                var pdy = drawState.lastMouseImage.y - drawState.measureLineStart.y;
                var prevM = Math.hypot(pdx, pdy) * scaleMperPx;
                var midP = { x: (ma.x + mm.x) / 2, y: (ma.y + mm.y) / 2 };
                ctx.setLineDash([]);
                ctx.font = "12px system-ui, sans-serif";
                ctx.fillStyle = "#1f2937";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(prevM.toFixed(2).replace(".", ",") + " m", midP.x, midP.y);
              }
            }

            if (window.CALPINAGE_MODE === MODE_CREATE_DORMER || window.CALPINAGE_MODE === MODE_DORMER_CONTOUR || window.CALPINAGE_MODE === MODE_DORMER_RIDGE || window.CALPINAGE_MODE === MODE_DORMER_HIPS) {
              var dormerPointer = (window.CALPINAGE_MODE === MODE_DORMER_CONTOUR && drawState.hoverNearFirstPointDormer) || ((drawState.dormerDraft || getDormerEditTarget()) && drawState.dormerSnapActive === true);
              canvasEl.style.cursor = dormerPointer ? "pointer" : "crosshair";
            } else if (window.CALPINAGE_IS_MANIPULATING && calpinageHandleDrag) {
              canvasEl.style.cursor = calpinageHandleDrag.type === "rotate" ? "grabbing" : "move";
            } else if (drawState.draggingObstacleHandle === "rotate") {
              canvasEl.style.cursor = "grabbing";
            } else if (drawState.draggingShadowVolumeHandle === "rotate") {
              canvasEl.style.cursor = "grabbing";
            } else if (CALPINAGE_STATE.currentPhase === "PV_LAYOUT" && drawState.ph3HandleHover) {
              canvasEl.style.cursor = drawState.ph3HandleHover === "rotate" ? "grab" : "move";
            } else {
              var obstacleHoverRotate = false;
              if (drawState.selectedObstacleIndex != null && drawState.lastMouseImage && window.CalpinageCanvas && window.CalpinageCanvas.hitTestObstacleHandles) {
                var obsListCur = CALPINAGE_STATE.obstacles || [];
                var selIdxCur = drawState.selectedObstacleIndex;
                var obsAtSelCur = selIdxCur >= 0 && selIdxCur < obsListCur.length ? obsListCur[selIdxCur] : null;
                if (obsAtSelCur && obsAtSelCur.shapeMeta && (obsAtSelCur.shapeMeta.originalType === "circle" || obsAtSelCur.shapeMeta.originalType === "rect")) {
                  var screenMouseCur = imageToScreen(drawState.lastMouseImage);
                  var handleHitCur = window.CalpinageCanvas.hitTestObstacleHandles(screenMouseCur, obsAtSelCur, imageToScreen, vp.scale);
                  obstacleHoverRotate = !!(handleHitCur && handleHitCur.handle === "rotate");
                }
              }
              var svHoveredRotate = false;
              if (drawState.selectedShadowVolumeIndex != null && drawState.lastMouseImage && window.CalpinageCanvas && window.CalpinageCanvas.hitTestShadowVolumeHandles) {
                var svListCur = CALPINAGE_STATE.shadowVolumes || [];
                var svSelCur = drawState.selectedShadowVolumeIndex;
                var svAtSelCur = svSelCur >= 0 && svSelCur < svListCur.length ? svListCur[svSelCur] : null;
                if (svAtSelCur && svAtSelCur.type === "shadow_volume") {
                  var mppCur = (CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.scale && CALPINAGE_STATE.roof.scale.metersPerPixel) || 1;
                  var screenMouseSv = imageToScreen(drawState.lastMouseImage);
                  var svHandleHitCur = window.CalpinageCanvas.hitTestShadowVolumeHandles(screenMouseSv, svAtSelCur, imageToScreen, vp.scale, mppCur);
                  svHoveredRotate = !!(svHandleHitCur && svHandleHitCur.handle === "rotate");
                }
              }
              if (obstacleHoverRotate || svHoveredRotate) {
                canvasEl.style.cursor = "grab";
              } else {
                canvasEl.style.cursor = (drawState.activeTool === "contour" && drawState.hoverNearFirstPoint) || (drawState.activeTool === "obstacle" && drawState.obstacleShape === "polygon" && drawState.hoverNearFirstPointObstacle) || (drawState.activeTool === "ridge" && CALPINAGE_STATE.activeRidge.snapEdge) || (drawState.activeTool === "trait" && drawState.traitLineStart && drawState.traitSnapEdge) ? "pointer" : (drawState.activeTool === "contour" || drawState.activeTool === "mesure" || drawState.activeTool === "trait" || drawState.activeTool === "ridge" || drawState.activeTool === "obstacle") ? "crosshair" : "default";
              }
            }

            if (
              drawState.isSelectingBox &&
              drawState.selectionBoxStart &&
              drawState.selectionBoxEnd
            ) {
              var a = imageToScreen(drawState.selectionBoxStart);
              var b = imageToScreen(drawState.selectionBoxEnd);
              ctx.save();
              ctx.setLineDash([6, 4]);
              ctx.strokeStyle = "#3b82f6";
              ctx.lineWidth = 2;
              ctx.strokeRect(
                Math.min(a.x, b.x),
                Math.min(a.y, b.y),
                Math.abs(b.x - a.x),
                Math.abs(b.y - a.y)
              );
              ctx.restore();
            }

            if (drawState.dragMode === "roofExtensionVertex" && drawState.rxDragSnap && drawState.rxDragSnap.active && drawState.rxDragSnap.x != null && drawState.rxDragSnap.y != null && drawState.dragBase && drawState.dragBase.pointRef) {
              var rxSnapPt = imageToScreen({ x: drawState.rxDragSnap.x, y: drawState.rxDragSnap.y });
              var rxMousePt = imageToScreen(drawState.dragBase.pointRef);
              ctx.save();
              ctx.beginPath();
              ctx.arc(rxSnapPt.x, rxSnapPt.y, 6, 0, Math.PI * 2);
              ctx.fillStyle = "rgba(234,179,8,0.4)";
              ctx.fill();
              ctx.strokeStyle = "rgba(201,164,73,0.9)";
              ctx.lineWidth = 2;
              ctx.setLineDash([]);
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(rxMousePt.x, rxMousePt.y);
              ctx.lineTo(rxSnapPt.x, rxSnapPt.y);
              ctx.setLineDash([4, 3]);
              ctx.strokeStyle = "rgba(201,164,73,0.6)";
              ctx.stroke();
              ctx.restore();
            }
            if (drawState.snapPreview) {
              var sp = imageToScreen(drawState.snapPreview);
              ctx.save();
              ctx.beginPath();
              ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
              ctx.strokeStyle = "rgba(201,164,73,0.9)";
              ctx.lineWidth = 2;
              ctx.setLineDash([]);
              ctx.stroke();
              ctx.restore();
            }

            if (CALPINAGE_STATE.currentPhase === "PV_LAYOUT" && window.CalpinageDP2Behavior && window.CALPINAGE_DP2_STATE && window.CALPINAGE_DP2_ADAPTER) {
              var dp2Opts = window.CALPINAGE_DP2_OPTIONS || {};
              dp2Opts.imageToScreen = imageToScreen;
              dp2Opts.imgH = imgH;
              window.CalpinageDP2Behavior.render(window.CALPINAGE_DP2_STATE, window.CALPINAGE_DP2_ADAPTER, canvasEl, dp2Opts);
            }

            if (typeof window !== "undefined" && window.__CALPINAGE_DEBUG_HANDLES__ === true && drawState.activeTool === "select") {
              var handleHitLabel = "none";
              if (drawState.selectedObstacleIndex != null && drawState.lastMouseImage && window.CalpinageCanvas && window.CalpinageCanvas.hitTestObstacleHandles) {
                var obsListDbg = CALPINAGE_STATE.obstacles || [];
                var selIdxDbg = drawState.selectedObstacleIndex;
                var obsAtSelDbg = selIdxDbg >= 0 && selIdxDbg < obsListDbg.length ? obsListDbg[selIdxDbg] : null;
                if (obsAtSelDbg && obsAtSelDbg.shapeMeta && (obsAtSelDbg.shapeMeta.originalType === "circle" || obsAtSelDbg.shapeMeta.originalType === "rect")) {
                  var screenMouseDbg = imageToScreen(drawState.lastMouseImage);
                  var handleHitDbg = window.CalpinageCanvas.hitTestObstacleHandles(screenMouseDbg, obsAtSelDbg, imageToScreen, vp.scale);
                  if (handleHitDbg) {
                    handleHitLabel = handleHitDbg.handle === "rotate" ? "rotate" : handleHitDbg.handle === "radius" ? "radius" : String(handleHitDbg.handle);
                  }
                }
              }
              var draggingHandleLabel = drawState.draggingObstacleHandle != null ? String(drawState.draggingObstacleHandle) : "null";
              var selObsLabel = drawState.selectedObstacleIndex != null ? String(drawState.selectedObstacleIndex) : "null";
              var debugText = "handleHit: " + handleHitLabel + "  selObs=" + selObsLabel + "  draggingHandle=" + draggingHandleLabel;
              ctx.save();
              ctx.setTransform(1, 0, 0, 1, 0, 0);
              ctx.font = "12px monospace";
              ctx.fillStyle = "rgba(0,0,0,0.7)";
              ctx.fillRect(8, 8, 320, 22);
              ctx.fillStyle = "#00ff88";
              ctx.fillText(debugText, 12, 22);
              ctx.restore();
            }

            var toolbar = container.querySelector("#zone-b-toolbar");
            if (toolbar && drawState.activeTool === "contour" && CALPINAGE_STATE.activeContour && CALPINAGE_STATE.activeContour.points.length > 0) {
              var badgeEl = toolbar.querySelector(".contour-badge-ux");
              if (!badgeEl) {
                badgeEl = document.createElement("span");
                badgeEl.className = "contour-badge-ux";
                badgeEl.style.cssText = "margin-left:8px;padding:2px 8px;font-size:11px;background:rgba(201,164,73,0.2);color:#c9a449;border-radius:var(--sg-radius-sm);";
                toolbar.appendChild(badgeEl);
              }
              badgeEl.textContent = "Contour en cours (" + CALPINAGE_STATE.activeContour.points.length + " points)";
              badgeEl.style.display = "";
            } else if (toolbar) {
              var badgeEl = toolbar.querySelector(".contour-badge-ux");
              if (badgeEl) badgeEl.style.display = "none";
            }

            window.CALPINAGE_RENDER = render;
            if (!engine._destroyed) {
              renderRafId = requestAnimationFrame(render);
            }
          }
          render();
        };
        roofImg.src = CALPINAGE_STATE.roof.image.dataUrl;
      }

      function waitForContainerSize(container, callback) {
        var attempts = 0;
        function check() {
          var rect = container.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            if (devLog) {
              console.log("[CALPINAGE] container size before init: " + rect.width + " x " + rect.height);
            }
            callback();
          } else if (attempts < 10) {
            attempts++;
            requestAnimationFrame(check);
          } else {
            console.warn("[CALPINAGE] container never got size");
            callback();
          }
        }
        check();
      }

      function doSwitchProvider(src) {
        if (window.calpinageMap && window.calpinageMap.destroy) {
          window.calpinageMap.destroy();
        }
        var mapContainerEl = container.querySelector("#map-container");
        function applyNewProvider() {
          window.calpinageMap = CalpinageMap.createMapProvider(src, mapContainerEl);
          mapApi = window.calpinageMap;
          if (mapApi && typeof mapApi === "object") mapApi.switchProvider = doSwitchProvider;
          if (typeof window !== "undefined") window.calpinageMap = mapApi;
          updateStateUI();
          if (CALPINAGE_STATE.roof.image) {
            showCanvas();
            waitForContainerSize(canvasWrapper, startCanvasWithImage);
          }
          if (typeof setupMapDragListener === "function") setupMapDragListener();
          if (typeof applyCenterOnLayerChange === "function") applyCenterOnLayerChange();
          resizeCanvasToContainer();
        }
        if (src === "geoportail-ortho") {
          applyNewProvider();
        } else {
          waitForGoogleMaps(applyNewProvider);
        }
      }

      function doInitMap() {
        var defaultSource = (typeof window !== "undefined" && window.__CALPINAGE_INITIAL_PROVIDER__) || "google";
        mapApi = CalpinageMap.createMapProvider(defaultSource, mapContainer);
        if (mapApi && typeof mapApi === "object") mapApi.switchProvider = doSwitchProvider;
        if (typeof window !== "undefined") window.calpinageMap = mapApi;
        updateStateUI();
        if (CALPINAGE_STATE.roof.image) {
          showCanvas();
          waitForContainerSize(canvasWrapper, startCanvasWithImage);
        }
        if (typeof tryApplyInitialMapPosition === "function") tryApplyInitialMapPosition();
        if (typeof setupMapDragListener === "function") setupMapDragListener();
        resizeCanvasToContainer();
      }

      function doResizeMap() {
        var m = window.calpinageMap;
        if (!m) return;
        if (typeof m.invalidateSize === "function") m.invalidateSize();
        else if (typeof m.resize === "function") m.resize();
      }

      /**
       * Resize centralisé : canvas = taille réelle du container (getBoundingClientRect).
       * Si container width/height = 0 → retry court (RAF, max 10). Appelle aussi doResizeMap.
       */
      function resizeCanvasToContainer() {
        if (!canvasWrapper || !canvasEl) return;
        var attempts = 0;
        function doResize() {
          resizeRafId = null;
          var rect = canvasWrapper.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            if (currentCanvasEngine) currentCanvasEngine.resize();
            doResizeMap();
          } else if (attempts < 10) {
            attempts++;
            resizeRafId = requestAnimationFrame(doResize);
          }
        }
        if (resizeRafId != null) cancelAnimationFrame(resizeRafId);
        resizeRafId = requestAnimationFrame(doResize);
      }

      resizeHandler = function () { resizeCanvasToContainer(); };
      window.addEventListener("resize", resizeHandler);

      var defaultSource = (typeof window !== "undefined" && window.__CALPINAGE_INITIAL_PROVIDER__) || "google";
      function afterMapReady() {
        doInitMap();
        setTimeout(doResizeMap, 0);
      }
      if (defaultSource === "geoportail-ortho") {
        waitForContainerSize(mapContainer, afterMapReady);
      } else {
        waitForGoogleMaps(function () {
          waitForContainerSize(mapContainer, afterMapReady);
        });
      }

      cleanupTasks.push(function () {
        if (resizeHandler && typeof window !== "undefined") {
          window.removeEventListener("resize", resizeHandler);
          resizeHandler = null;
        }
        if (resizeRafId != null && typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(resizeRafId);
          resizeRafId = null;
        }
        if (typeof window !== "undefined") window.CALPINAGE_RENDER = null;
        if (renderRafId != null && typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(renderRafId);
          renderRafId = null;
        }
        if (currentCanvasEngine) {
          currentCanvasEngine.destroy();
          currentCanvasEngine = null;
        }
        if (typeof window !== "undefined" && window.calpinageMap && typeof window.calpinageMap.destroy === "function") {
          try {
            window.calpinageMap.destroy();
            if (devLog) console.debug("[Calpinage] Map destroyed cleanly");
          } catch (e) {
            if (typeof console !== "undefined") console.warn("[CALPINAGE] Map destroy failed", e);
          }
        }
        if (typeof window !== "undefined") window.calpinageMap = null;
      });
    })();
  })();
  (function () {
    var block = container.querySelector("#calpinage-settings-block");
    var placeholder = container.querySelector("#calpinage-settings-placeholder");
    var slot = container.querySelector("#calpinage-settings-content-slot");
    var overlay = container.querySelector("#calpinage-settings-overlay");
    if (!block || !placeholder || !slot || !overlay) return;
    var backdrop = container.querySelector("#calpinage-settings-backdrop");
    function openOverlay() {
      slot.appendChild(block);
      overlay.style.display = "flex";
      overlay.classList.add("p3-overlay-open");
    }
    function closeOverlay() {
      overlay.classList.remove("p3-overlay-open");
      placeholder.appendChild(block);
      overlay.style.display = "none";
    }
    addSafeListener(container.querySelector("#btn-open-calpinage-settings"), "click", openOverlay);
    addSafeListener(container.querySelector("#btn-close-calpinage-settings"), "click", closeOverlay);
    if (backdrop) addSafeListener(backdrop, "click", closeOverlay);
    addSafeListener(container, "keydown", function (e) {
      if (e.key === "Escape" && overlay.style.display === "block") closeOverlay();
    });
  })();
  /* ========== P3 Catalog Overlay — Overlay catalogue unique (Step 2, SAFE MODE) ========== */
  (function initP3CatalogOverlay() {
    var CATALOG_PAGE_SIZE = 40;
    var p3RecentSelections = { panel: [], micro: [], central: [] };

    function getCatalogDataByType(type) {
      if (type === "panel") {
        return window.SOLARNEXT_PANELS || [];
      }
      if (type === "micro") {
        return (window.SOLARNEXT_INVERTERS || []).filter(function (inv) { return inv.inverter_family === "MICRO"; });
      }
      if (type === "central") {
        return (window.SOLARNEXT_INVERTERS || []).filter(function (inv) { return inv.inverter_family !== "MICRO"; });
      }
      return [];
    }

    function filterBySearch(items, searchText, type) {
      var q = (searchText || "").trim().toLowerCase();
      if (!q) return items;
      return items.filter(function (item) {
        var name = (item.name || item.model_ref || "").trim() || item.id || "";
        var brand = (item.brand || "").trim();
        return (name && name.toLowerCase().indexOf(q) >= 0) || (brand && brand.toLowerCase().indexOf(q) >= 0);
      });
    }

    function addToRecent(type, id) {
      if (!id) return;
      var arr = p3RecentSelections[type] || [];
      arr = arr.filter(function (x) { return x !== id; });
      arr.unshift(id);
      p3RecentSelections[type] = arr.slice(0, 10);
    }

    function renderCatalog(type, searchText, offset) {
      var listEl = container.querySelector("#p3-catalog-list");
      var recentsEl = container.querySelector("#p3-catalog-recents");
      var suggestionsEl = container.querySelector("#p3-catalog-suggestions");
      var loadMoreBtn = container.querySelector("#p3-catalog-load-more");
      if (!listEl) return;

      var allItems = getCatalogDataByType(type);
      var filtered = filterBySearch(allItems, searchText, type);
      var end = offset + CATALOG_PAGE_SIZE;
      var page = filtered.slice(0, end);
      var hasMore = end < filtered.length;

      var panelSelect = container.querySelector("#pv-panel-select");
      var inverterSelectCentral = container.querySelector("#pv-inverter-select-central");
      var inverterSelectMicro = container.querySelector("#pv-inverter-select-micro");
      var selectedId = "";
      if (type === "panel" && panelSelect) selectedId = panelSelect.value || "";
      if (type === "micro" && inverterSelectMicro) selectedId = inverterSelectMicro.value || "";
      if (type === "central" && inverterSelectCentral) selectedId = inverterSelectCentral.value || "";

      function buildPanelCard(p) {
        var brand = (p.brand || "").trim();
        var name = (p.name || p.model_ref || "").trim() || p.id;
        var powerWc = (p.power_wc != null && p.power_wc !== "") ? (Number(p.power_wc) || p.power_wc) : "";
        var isActive = p.id === selectedId;
        var div = document.createElement("div");
        div.className = "p3-product-card" + (isActive ? " p3-card-active" : "");
        div.setAttribute("data-panel-id", p.id);
        div.setAttribute("role", "option");
        div.setAttribute("aria-selected", isActive ? "true" : "false");
        div.innerHTML = "<div class=\"p3-product-card-img\" aria-hidden=\"true\">&#9728;</div><div class=\"p3-product-card-name\">" + (brand ? brand + " — " : "") + (name || p.id) + "</div><div class=\"p3-product-card-meta\">" + (powerWc ? powerWc + " Wc" : "") + "</div>";
        return div;
      }

      function buildInverterCard(inv) {
        var name = (inv.name || inv.model_ref || "").trim() || inv.id;
        var brand = (inv.brand || "").trim();
        var acKw = inv.nominal_power_kw != null ? Number(inv.nominal_power_kw) : (inv.nominal_va != null ? Number(inv.nominal_va) / 1000 : null);
        var acStr = acKw != null && !Number.isNaN(acKw) ? acKw + " kW AC" : "";
        var typeLabel = (inv.inverter_type || "").toLowerCase() === "micro" ? "Micro" : "Central";
        var meta = [acStr, typeLabel].filter(Boolean).join(" · ");
        var isActive = inv.id === selectedId;
        var div = document.createElement("div");
        div.className = "p3-product-card" + (isActive ? " p3-card-active" : "");
        div.setAttribute("data-inverter-id", inv.id);
        div.setAttribute("role", "option");
        div.setAttribute("aria-selected", isActive ? "true" : "false");
        div.innerHTML = "<div class=\"p3-product-card-img\" aria-hidden=\"true\">&#9881;</div><div class=\"p3-product-card-name\">" + (brand ? brand + " — " : "") + (name || inv.id) + "</div><div class=\"p3-product-card-meta\">" + meta + "</div>";
        return div;
      }

      listEl.innerHTML = "";
      if (type === "panel") {
        page.forEach(function (p) { listEl.appendChild(buildPanelCard(p)); });
      } else {
        page.forEach(function (inv) { listEl.appendChild(buildInverterCard(inv)); });
      }

      if (loadMoreBtn) loadMoreBtn.disabled = !hasMore;

      var recents = (p3RecentSelections[type] || []).filter(function (id) {
        return type === "panel" ? (typeof findPanelById === "function" && findPanelById(id)) : (typeof findInverterById === "function" && findInverterById(id));
      });
      if (recents.length > 0 && !searchText) {
        recentsEl.innerHTML = "<div class=\"p3-catalog-recents-title\">Récents</div><div class=\"p3-cards-grid\" id=\"p3-catalog-recents-grid\"></div>";
        var grid = recentsEl.querySelector("#p3-catalog-recents-grid");
        if (grid) {
          recents.forEach(function (id) {
            var item = type === "panel" ? (typeof findPanelById === "function" ? findPanelById(id) : null) : (typeof findInverterById === "function" ? findInverterById(id) : null);
            if (item) {
              var card = type === "panel" ? buildPanelCard(item) : buildInverterCard(item);
              grid.appendChild(card);
            }
          });
        }
      } else {
        recentsEl.innerHTML = "";
      }
      suggestionsEl.innerHTML = "";
    }

    function closeCatalogOverlay() {
      var overlay = container.querySelector("#p3-catalog-overlay");
      if (overlay) overlay.classList.remove("is-open");
    }

    function openCatalogOverlay(type) {
      if (type !== "panel" && type !== "micro" && type !== "central") return;
      var overlay = container.querySelector("#p3-catalog-overlay");
      var titleEl = container.querySelector("#p3-catalog-title");
      var searchEl = container.querySelector("#p3-catalog-search");
      if (!overlay || !titleEl) return;

      var titles = { panel: "Choisir un module", micro: "Choisir un micro-onduleur", central: "Choisir un onduleur central" };
      titleEl.textContent = titles[type] || "Catalogue";
      if (searchEl) {
        searchEl.value = "";
        searchEl.placeholder = "Rechercher par nom ou marque…";
      }
      overlay.dataset.catalogType = type;
      overlay.dataset.catalogOffset = "0";
      renderCatalog(type, "", 0);
      overlay.classList.add("is-open");
      if (searchEl) searchEl.focus();
    }

    window.openCatalogOverlay = openCatalogOverlay;

    var overlay = container.querySelector("#p3-catalog-overlay");
    var backdrop = overlay && overlay.querySelector(".p3-catalog-backdrop");
    var closeBtn = container.querySelector("#p3-catalog-close");
    var searchEl = container.querySelector("#p3-catalog-search");
    var loadMoreBtn = container.querySelector("#p3-catalog-load-more");

    if (backdrop) addSafeListener(backdrop, "click", closeCatalogOverlay);
    if (closeBtn) addSafeListener(closeBtn, "click", closeCatalogOverlay);
    addSafeListener(container, "keydown", function (e) {
      if (e.key === "Escape") {
        var ov = container.querySelector("#p3-catalog-overlay");
        if (ov && ov.classList.contains("is-open")) closeCatalogOverlay();
      }
    });

    if (searchEl) {
      addSafeListener(searchEl, "input", function () {
        var type = overlay && overlay.dataset.catalogType;
        if (!type) return;
        overlay.dataset.catalogOffset = "0";
        renderCatalog(type, searchEl.value, 0);
      });
    }

    if (loadMoreBtn) {
      addSafeListener(loadMoreBtn, "click", function () {
        var type = overlay && overlay.dataset.catalogType;
        if (!type) return;
        var offset = parseInt(overlay.dataset.catalogOffset || "0", 10) + CATALOG_PAGE_SIZE;
        overlay.dataset.catalogOffset = String(offset);
        renderCatalog(type, searchEl ? searchEl.value : "", offset);
      });
    }

    addSafeListener(container, "click", function (e) {
      var overlayEl = container.querySelector("#p3-catalog-overlay");
      if (!overlayEl || !overlayEl.classList.contains("is-open")) return;
      var type = overlayEl.dataset.catalogType;
      if (!type) return;

      var panelCard = e.target && e.target.closest && e.target.closest("[data-panel-id]");
      var invCard = e.target && e.target.closest && e.target.closest("[data-inverter-id]");

      var id = null;
      if (panelCard && type === "panel") id = panelCard.getAttribute("data-panel-id");
      if (invCard && (type === "micro" || type === "central")) id = invCard.getAttribute("data-inverter-id");

      if (!id) return;

      var panelSelect = container.querySelector("#pv-panel-select");
      var inverterSelectCentral = container.querySelector("#pv-inverter-select-central");
      var inverterSelectMicro = container.querySelector("#pv-inverter-select-micro");

      if (type === "panel" && panelSelect) {
        panelSelect.value = id || "";
        panelSelect.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (type === "micro" && inverterSelectMicro) {
        if (inverterSelectCentral) inverterSelectCentral.value = "";
        inverterSelectMicro.value = id || "";
        inverterSelectMicro.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (type === "central" && inverterSelectCentral) {
        if (inverterSelectMicro) inverterSelectMicro.value = "";
        inverterSelectCentral.value = id || "";
        inverterSelectCentral.dispatchEvent(new Event("change", { bubbles: true }));
      }

      addToRecent(type, id);
      if (typeof window.syncP3Topbar === "function") window.syncP3Topbar();
      closeCatalogOverlay();
    });
  })();
  (function () {
    function drawHorizonMask(canvas, horizon) {
      var ctx = canvas.getContext("2d");
      var cx = canvas.width / 2;
      var cy = canvas.height / 2;
      var R = Math.min(cx, cy) - 20;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1;
      [0, 15, 30].forEach(function (deg) {
        var r = R * (1 - deg / 90);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.beginPath();
      horizon.forEach(function (h, i) {
        var az = (h.azimuth - 90) * Math.PI / 180;
        var el = Math.max(0, Math.min(90, h.elevation_deg));
        var r = R * (1 - el / 90);
        var x = cx + Math.cos(az) * r;
        var y = cy + Math.sin(az) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = "rgba(255,180,0,0.35)";
      ctx.strokeStyle = "#f5b400";
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }
    window.showHorizonMaskOverlay = function () {
      if (!innerRoot || !innerRoot.isConnected) return;
      var data = window.CALPINAGE_STATE && window.CALPINAGE_STATE.horizonMask && window.CALPINAGE_STATE.horizonMask.data;
      if (!data || !Array.isArray(data.horizon)) return;
      var overlay = innerRoot.querySelector("#horizon-mask-overlay");
      if (overlay) overlay.remove();
      overlay = document.createElement("div");
      overlay.id = "horizon-mask-overlay";
      overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:9999;display:flex;align-items:center;justify-content:center;";
      var canvas = document.createElement("canvas");
      canvas.width = 500;
      canvas.height = 500;
      overlay.appendChild(canvas);
      addSafeListener(overlay, "click", function () { overlay.remove(); });
      innerRoot.appendChild(overlay);
      drawHorizonMask(canvas, data.horizon);
    };
    function updateHorizonMaskButtonState() {
      var btn = container.querySelector("#btn-show-horizon-mask");
      if (!btn) return;
      if (window.loadCalpinageHorizonMask) window.loadCalpinageHorizonMask();
      var data = window.CALPINAGE_STATE && window.CALPINAGE_STATE.horizonMask && window.CALPINAGE_STATE.horizonMask.data;
      var hasData = data && Array.isArray(data.horizon) && data.horizon.length > 0;
      btn.disabled = !hasData;
    }
    var btn = container.querySelector("#btn-show-horizon-mask");
    if (btn) {
      addSafeListener(btn, "click", window.showHorizonMaskOverlay);
      updateHorizonMaskButtonState();
    }
  })();

  (function initHouseModelV2Preview() {
    var HOUSEMODEL_V2 = typeof window !== "undefined" && window.HOUSEMODEL_V2;
    var btn = container.querySelector("#btn-preview-3d");
    var overlay = container.querySelector("#calpinage-preview-3d-overlay");
    var container3d = container.querySelector("#calpinage-preview-3d-container");
    var btnClose = container.querySelector("#btn-close-preview-3d");
    if (!btn || !overlay || !container3d) return;
    if (HOUSEMODEL_V2) btn.style.display = "inline-block";
    else return;

    var phase3ViewerInstance = null;
    function withBase(path) {
      var base = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL) || "/";
      var b = base.endsWith("/") ? base : base + "/";
      var p = path.startsWith("/") ? path.slice(1) : path;
      return b + p;
    }

    addSafeListener(btn, "click", async function () {
      try {
        var ctx = typeof getHeightAtImgPoint === "function"
          ? { getHeightAtImagePoint: function (x, y) { return getHeightAtImgPoint({ x: x, y: y }); } }
          : null;
        var norm = normalizeCalpinageGeometry3DReady(CALPINAGE_STATE, ctx, {
          getAllPanels: window.pvPlacementEngine && window.pvPlacementEngine.getAllPanels,
          computePansFromGeometryCore: computePansFromGeometryCore,
        });
        var mpp = (CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.scale && CALPINAGE_STATE.roof.scale.metersPerPixel) || 1;
        var buildingContours = (norm.index && norm.index.byType && norm.index.byType.BUILDING_CONTOUR) || [];
        var originPx = { x: 0, y: 0 };
        if (buildingContours.length > 0 && buildingContours[0].footprintPx && buildingContours[0].footprintPx.length > 0) {
          originPx = computeCentroidPx(buildingContours[0].footprintPx);
        }
        var houseModel = houseModelV2(norm.entities, { metersPerPixel: mpp, originPx: originPx });

        if (!window.THREE) {
          await loadScriptOnce("https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js");
        }
        if (!window.Phase3Viewer) {
          await loadScriptOnce(withBase("calpinage/phase3/phase3Viewer.js"));
        }
        if (!window.Phase3Viewer || !window.Phase3Viewer.initPhase3Viewer) {
          console.warn("[HOUSEMODEL_V2] Phase3Viewer non chargé");
          return;
        }
        if (phase3ViewerInstance && phase3ViewerInstance.dispose) phase3ViewerInstance.dispose();
        container3d.innerHTML = "";
        phase3ViewerInstance = window.Phase3Viewer.initPhase3Viewer(container3d, houseModel);
        overlay.style.display = "block";
      } catch (err) {
        console.error("[HOUSEMODEL_V2] Erreur aperçu 3D", err);
      }
    });

    addSafeListener(btnClose, "click", function () {
      overlay.style.display = "none";
      if (phase3ViewerInstance && phase3ViewerInstance.dispose) phase3ViewerInstance.dispose();
      phase3ViewerInstance = null;
    });
  })();

  window.buildFinalCalpinageJSON = function () {
    if (!CALPINAGE_STATE || !CALPINAGE_STATE.validatedRoofData) return null;
    if (!window.PV_SELECTED_PANEL) return null;

    var lat = CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.gps ? CALPINAGE_STATE.roof.gps.lat : undefined;
    var lon = CALPINAGE_STATE.roof && CALPINAGE_STATE.roof.gps ? CALPINAGE_STATE.roof.gps.lon : undefined;

    if (typeof lat !== "number" || typeof lon !== "number" || Number.isNaN(lat) || Number.isNaN(lon)) {
      throw new Error("GPS coordinates required for shading calculation");
    }

    const panels = window.pvPlacementEngine?.getAllPanels
      ? window.pvPlacementEngine.getAllPanels()
      : [];

    const shading = (CALPINAGE_STATE.shading && CALPINAGE_STATE.shading.normalized)
      ? {
          totalLossPct: CALPINAGE_STATE.shading.normalized.totalLossPct,
          panelCount: CALPINAGE_STATE.shading.normalized.panelCount,
          perPanel: CALPINAGE_STATE.shading.normalized.perPanel,
          computedAt: CALPINAGE_STATE.shading.normalized.computedAt
        }
      : null;

    var rulesOrient = (window.PV_LAYOUT_RULES && window.PV_LAYOUT_RULES.orientation) ? String(window.PV_LAYOUT_RULES.orientation).toLowerCase() : "portrait";
    var exportOrientation = (rulesOrient === "landscape" || rulesOrient === "paysage") ? "landscape" : "portrait";

    return {
      meta: {
        generatedAt: Date.now(),
        version: "calpinage-v1"
      },

      orientation: exportOrientation,

      panelSpec: {
        id: PV_SELECTED_PANEL.id,
        brand: PV_SELECTED_PANEL.brand,
        model: PV_SELECTED_PANEL.model,
        reference: PV_SELECTED_PANEL.reference || null,
        powerWc: PV_SELECTED_PANEL.powerWc,
        widthM: PV_SELECTED_PANEL.widthM,
        heightM: PV_SELECTED_PANEL.heightM,
        technology: PV_SELECTED_PANEL.technology || null,
        efficiency: PV_SELECTED_PANEL.efficiency || null
      },

      panels: {
        count: panels.length,
        orientation: panels[0]?.orientation || null,
        layout: panels
      },

      roof: {
        pans: CALPINAGE_STATE.validatedRoofData.pans.map(p => ({
          id: p.id,
          orientationDeg: p.orientationDeg,
          tiltDeg: p.tiltDeg,
          surfaceM2: p.surfaceM2
        })),
        scale: CALPINAGE_STATE.validatedRoofData.scale,
        north: CALPINAGE_STATE.validatedRoofData.north || null
      },

      shading: shading,

      geometry3d: (function () {
        try {
          var ctx = typeof getHeightAtImgPoint === "function"
            ? { getHeightAtImagePoint: function (x, y) { return getHeightAtImgPoint({ x: x, y: y }); } }
            : null;
          var norm = normalizeCalpinageGeometry3DReady(CALPINAGE_STATE, ctx, {
            getAllPanels: window.pvPlacementEngine && window.pvPlacementEngine.getAllPanels,
            computePansFromGeometryCore: computePansFromGeometryCore,
          });
          return buildGeometry3DExportSection(norm, ctx);
        } catch (err) {
          if (typeof console !== "undefined") console.warn("[CALPINAGE] geometry3d export failed", err);
          return null;
        }
      })()
    };
  };

  /* Cleanup : listeners, RAF, intervals, puis reset complet pour isolation par studyId/versionId.
   * Aucun état global ne doit persister entre études. */
  function cleanup() {
    container.__CALPINAGE_MOUNTED__ = false;
    container.__CALPINAGE_TEARDOWN__ = null;
    if (devLog) {
      console.log("[CALPINAGE] cleanup start tasks=" + cleanupTasks.length);
    }
    var tasks = cleanupTasks.slice();
    cleanupTasks.length = 0;
    tasks.forEach(function (fn) {
      try { fn(); } catch (err) { if (typeof console !== "undefined") console.warn("[CALPINAGE] cleanup error", err); }
    });
    /* Reset moteurs PV (blocs figés, panneaux posés) — singletons window qui persistent sinon */
    try {
      var engReset = (typeof window !== "undefined" && window.pvPlacementEngine && window.pvPlacementEngine.reset) ||
        (typeof window !== "undefined" && window.ActivePlacementBlock && window.ActivePlacementBlock.reset);
      if (typeof engReset === "function") engReset();
    } catch (e) { if (typeof console !== "undefined") console.warn("[CALPINAGE] engine reset error", e); }
    /* Reset CalpinagePans.panState (pans, activePanId) */
    try {
      if (typeof window !== "undefined" && window.CalpinagePans && window.CalpinagePans.panState) {
        var ps = window.CalpinagePans.panState;
        if (Array.isArray(ps.pans)) ps.pans.length = 0;
        ps.activePanId = null;
        ps.activePoint = null;
      }
    } catch (e) { if (typeof console !== "undefined") console.warn("[CALPINAGE] CalpinagePans reset error", e); }
    /* Supprimer toute référence window pour éviter fuite d'état entre études */
    if (typeof window !== "undefined") {
      try { delete window.CALPINAGE_STATE; } catch (_) {}
      window.CALPINAGE_STUDY_ID = null;
      window.CALPINAGE_VERSION_ID = null;
      window.PV_SELECTED_PANEL = null;
      window.CALPINAGE_SELECTED_PANEL_ID = null;
      window.PV_SELECTED_INVERTER = null;
      window.CALPINAGE_SELECTED_INVERTER_ID = null;
      window.CALPINAGE_ALLOWED = false;
    }
    /* Vider le container pour que le prochain init (étude B) ne trouve pas #calpinage-root et réinjecte proprement */
    try {
      if (container && container.firstChild) {
        while (container.firstChild) container.removeChild(container.firstChild);
      }
    } catch (e) { if (typeof console !== "undefined") console.warn("[CALPINAGE] container clear error", e); }
    _calpinageInitInFlight = false;
    if (devLog) {
      console.log("[CALPINAGE] cleanup done (state isolated, ready for next study)");
    }
  };
  container.__CALPINAGE_MOUNTED__ = true;
  container.__CALPINAGE_TEARDOWN__ = cleanup;
  return cleanup;
}
