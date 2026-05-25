/**
 * Inline3DViewerBridge — Monte SolarScene3DViewer dans #zone-c-3d.
 * Le viewer est monté une seule fois et reste en vie tant que le composant existe.
 *
 * Prompt 6 — scène unifiée :
 * - Bascule 3D : `getOrBuildOfficialSolarScene3DFromCalpinageRuntime` (cache par signature structurelle).
 * - Même runtime / même repère que la 2D ; le toggle ne change que la vue.
 * - Listener unique sur `CALPINAGE_OFFICIAL_RUNTIME_STRUCTURAL_CHANGE` (Prompt 7) : rebuild si signature change.
 */

import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { getCalpinageWindow } from "../calpinageWindowGlobals";
import { SolarScene3DViewer } from "../canonical3d/viewer/SolarScene3DViewer";
import { buildEmergencySolarScene3DFromRuntime } from "../canonical3d/emergency/buildEmergencySolarScene3DFromRuntime";
import { reportOfficialSolarPipelineFailure } from "../canonical3d/dev/officialSolarScenePipelineFailure";
import { optimalSingleBuildingLegacyRoofMapOptions } from "../integration/mapCalpinageToCanonicalNearShading";
import { getOrBuildOfficialSolarScene3DFromCalpinageRuntime } from "../canonical3d/scene/officialSolarScene3DGateway";
import { CALPINAGE_OFFICIAL_RUNTIME_STRUCTURAL_CHANGE } from "../canonical3d/scene/sceneRuntimeStructuralSignature";
import { useCalpinageFeatures } from "../features/CalpinageFeatureContext";
import { getPvLayout3dProductCapabilityReport } from "../runtime/pvPlacement3dProduct";
import type { OfficialRuntimeStructuralChangePayload } from "../runtime/emitOfficialRuntimeStructuralChange";
import type { SolarScene3D } from "../canonical3d/types/solarScene3d";
import type { RoofVertexXYEdit } from "../runtime/applyRoofVertexXYEdit";
import type { GroundPlaneImageData } from "../canonical3d/viewer/GroundPlaneTexture";
import type { CalpinagePanProvenanceEntry } from "../canonical3d/viewer/inspection/buildPickProvenance2DViewModel";
import { Canonical3DViewerErrorBoundary } from "../canonical3d/product/Canonical3DProductMount";
import { syncRoofPansMirrorFromPans } from "../legacy/phase2RoofDerivedModel";
import { getCalpinageRuntime } from "../runtime/calpinageRuntime";
import {
  applyRoofVertexHeightEdit,
  readCalpinagePanVertexHeightM,
  resolveCalpinagePanPolygonPointsForHeightEdit,
  type RoofVertexHeightEdit,
} from "../runtime/applyRoofVertexHeightEdit";
import { applyRoofVertexXYEdit } from "../runtime/applyRoofVertexXYEdit";
import { applyCanonical3DWorldContractToRoof } from "../runtime/canonical3DWorldContract";
import { emitOfficialRuntimeStructuralChange } from "../runtime/emitOfficialRuntimeStructuralChange";
import { rebuildPanPlanarHeightsAfterZEdit } from "../runtime/rebuildPanPlanarHeightsAfterZEdit";
import { validateCalpinageRuntimeAfterRoofEdit } from "../runtime/validateCalpinageRuntimeAfterRoofEdit";
import {
  canRedoRoofModeling,
  canUndoRoofModeling,
  pushRoofModelingPastSnapshot,
  redoRoofModeling,
  undoRoofModeling,
} from "../runtime/roofModelingHistory";
import {
  applyStructuralHeightEdit,
  type StructuralHeightEdit,
} from "../runtime/applyStructuralRidgeHeightEdit";
import {
  applyRoofHeightAssistant,
  summarizeRoofHeightAssistantRuntime,
  type RoofHeightAssistantCommand,
} from "../runtime/applyRoofHeightAssistant";
import { emitRoofVertexZTelemetry } from "../runtime/roofVertexZEditTelemetry";

const MOUNT_ID = "zone-c-3d";

/** Limite le spam de toasts lors d’éditions répétées (drag, micro-mouvements). */
const CALPINAGE_ROOF_EDIT_ERROR_TOAST_DEBOUNCE_MS = 1400;

/**
 * FA-ARCH-1 — État module-level intentionnel (singleton).
 * `Inline3DViewerBridge` n’est monté qu’une seule fois par session de calpinage
 * (portail React dans `#zone-c-3d`). Si plusieurs instances coexistaient (cas non prévu),
 * ce debounce partagé est conservatif : il supprime des toasts redondants au lieu d’en
 * générer des faux. Risque : faible. Alternative : déplacer dans un ref composant si
 * le multi-instance devient une exigence.
 */
let lastCalpinageRoofEditErrorToastKey = "";
let lastCalpinageRoofEditErrorToastAt = 0;

function showCalpinageRoofEditErrorToast(message: string): void {
  const toast = (window as unknown as { calpinageToast?: { error?: (m: string) => void } }).calpinageToast;
  if (!toast?.error) return;
  const now = Date.now();
  if (message === lastCalpinageRoofEditErrorToastKey && now - lastCalpinageRoofEditErrorToastAt < CALPINAGE_ROOF_EDIT_ERROR_TOAST_DEBOUNCE_MS) {
    return;
  }
  lastCalpinageRoofEditErrorToastKey = message;
  lastCalpinageRoofEditErrorToastAt = now;
  toast.error(message);
}

const ROOF_VERTEX_COMMIT_MIN_M = -2;
const ROOF_VERTEX_COMMIT_MAX_M = 30;

function assertRoofVertexEditTarget(
  runtime: Record<string, unknown>,
  panId: string,
  vertexIndex: number,
): boolean {
  if (typeof panId !== "string" || panId.length === 0) {
    console.warn("[3D EDIT] Invalid vertex target", { reason: "empty_pan_id", panId, vertexIndex });
    return false;
  }
  if (!Number.isInteger(vertexIndex) || vertexIndex < 0) {
    console.warn("[3D EDIT] Invalid vertex target", { reason: "bad_vertex_index", panId, vertexIndex });
    return false;
  }
  const pans = runtime.pans;
  if (!Array.isArray(pans)) {
    console.warn("[3D EDIT] Invalid vertex target", { reason: "pans_missing", panId, vertexIndex });
    return false;
  }
  const pan = pans.find((p) => p && typeof p === "object" && String((p as Record<string, unknown>).id) === panId) as
    | Record<string, unknown>
    | undefined;
  if (!pan) {
    console.warn("[3D EDIT] Invalid vertex target", { reason: "pan_not_found", panId, vertexIndex });
    return false;
  }
  const poly = resolveCalpinagePanPolygonPointsForHeightEdit(pan);
  if (!poly) {
    console.warn("[3D EDIT] Invalid vertex target", { reason: "polygon_missing", panId, vertexIndex });
    return false;
  }
  if (vertexIndex >= poly.points.length) {
    console.warn("[3D EDIT] Invalid vertex target", {
      reason: "vertex_out_of_range",
      panId,
      vertexIndex,
      vertexCount: poly.points.length,
    });
    return false;
  }
  return true;
}

/**
 * Retourne les panneaux PV actuellement posés, en excluant le bloc actif non-figé
 * (panneau fantôme flottant pendant une pose en cours).
 *
 * @param pvLayoutMode - true si le mode produit pose PV 3D est actif (flag A2).
 *   Doit être passé depuis `useCalpinageFeatures().pvLayoutMode` dans le composant.
 */
function getAllPanelsFromRuntime(pvLayoutMode: boolean): unknown[] {
  try {
    const eng = getCalpinageRuntime()?.getPlacementEngine();
    if (!eng) return [];
    const allPanels = (eng.getAllPanels() ?? []) as unknown[];
    const w =
      typeof window !== "undefined"
        ? (window as unknown as {
            __CALPINAGE_VIEW_MODE__?: string;
            CALPINAGE_STATE?: { currentPhase?: string };
          })
        : null;
    const pvLayout3DActive =
      w?.__CALPINAGE_VIEW_MODE__ === "3D" &&
      pvLayoutMode === true &&
      w.CALPINAGE_STATE?.currentPhase === "PV_LAYOUT";
    if (pvLayout3DActive) return allPanels;
    // Exclure les panneaux du bloc actif s'il n'est pas figé.
    // Un bloc actif non-frozen a des coordonnées temporaires (pose en cours) qui
    // projettent le panneau hors-image → plan incliné → panneau fantôme flottant.
    const engRaw = eng as unknown as Record<string, unknown>;
    const activeBlock =
      typeof engRaw["getActiveBlock"] === "function"
        ? (engRaw["getActiveBlock"]() as { id?: string } | null)
        : null;
    if (!activeBlock?.id) return allPanels;
    const frozenBlocks =
      typeof engRaw["getFrozenBlocks"] === "function"
        ? (engRaw["getFrozenBlocks"]() as Array<{ id?: string }>)
        : [];
    const activeInFrozen = frozenBlocks.some((b) => b?.id === activeBlock.id);
    if (activeInFrozen) return allPanels; // bloc actif = sélection d'un figé → pas de ghost
    // Bloc actif non figé → on l'exclut du rendu 3D
    const prefix = activeBlock.id + "_";
    return allPanels.filter((p) => {
      if (!p || typeof p !== "object") return true;
      const pid = (p as { id?: unknown }).id;
      return typeof pid !== "string" || !pid.startsWith(prefix);
    });
  } catch {
    /* ignore */
  }
  return [];
}

function syncRoofDerivedMirrors(runtime: Record<string, unknown>): void {
  try {
    syncRoofPansMirrorFromPans(runtime);
  } catch {
    /* ignore */
  }
  const roof = runtime.roof;
  if (roof && typeof roof === "object") {
    try {
      applyCanonical3DWorldContractToRoof(roof);
    } catch {
      /* ignore */
    }
  }
}

function rollbackPansAndSync(runtime: Record<string, unknown>, pansSnapshot: unknown): void {
  runtime.pans = JSON.parse(JSON.stringify(pansSnapshot)) as unknown[];
  syncRoofDerivedMirrors(runtime);
}

function firstPanIdForStructuralValidation(runtime: Record<string, unknown>): string {
  const pans = runtime.pans;
  if (!Array.isArray(pans) || pans.length === 0) return "__structural_ridge__";
  const p0 = pans[0];
  if (p0 && typeof p0 === "object" && typeof (p0 as { id?: unknown }).id === "string") {
    return String((p0 as { id: string }).id);
  }
  return "__structural_ridge__";
}

/** Restaure `target` (même référence que `CALPINAGE_STATE`) depuis un snapshot JSON profond. */
function restoreCalpinageRuntimeFromSnapshot(target: Record<string, unknown>, snapshot: Record<string, unknown>): void {
  const keys = [...Object.keys(target)];
  for (const k of keys) {
    delete target[k];
  }
  for (const [k, v] of Object.entries(snapshot)) {
    target[k] = JSON.parse(JSON.stringify(v)) as unknown;
  }
}

/** Même rafraîchissement que la fin du flux 2D après changement de hauteur (`calpinage.module.js`). */
function refreshLegacyCalpinage2DAfterPanVertexHeightEdit(): void {
  try {
    const fn = (
      window as unknown as { __calpinageRefreshLegacyUiAfterPanVertexHeightEdit?: () => void }
    ).__calpinageRefreshLegacyUiAfterPanVertexHeightEdit;
    if (typeof fn === "function") fn();
  } catch {
    /* ignore */
  }
}

type CalpinageCommitRoofVertexHeightLike2DResult =
  | { readonly ok: true; readonly rollback?: () => void }
  | { readonly ok: false; readonly code?: string; readonly message?: string };

/**
 * Si le runtime est `window.CALPINAGE_STATE` et le module legacy est monté : même pipeline que l’outil
 * hauteur 2D (`applyHeightToSelectedPoints` + `computePansFromGeometry`). Sinon null → fallback TS.
 */
function tryCommitRoofVertexHeightLike2D(
  panId: string,
  vertexIndex: number,
  heightM: number,
  runtime: Record<string, unknown>,
): CalpinageCommitRoofVertexHeightLike2DResult | null {
  const w = window as unknown as {
    CALPINAGE_STATE?: unknown;
    __calpinageCommitRoofVertexHeightLike2D?: (
      id: string,
      vi: number,
      hm: number,
    ) => CalpinageCommitRoofVertexHeightLike2DResult;
  };
  if (typeof w.__calpinageCommitRoofVertexHeightLike2D !== "function") return null;
  if (runtime !== w.CALPINAGE_STATE) return null;
  return w.__calpinageCommitRoofVertexHeightLike2D(panId, vertexIndex, heightM);
}

function extractCalpinagePansForProvenance(state: unknown): CalpinagePanProvenanceEntry[] | undefined {
  const pans = (state as { pans?: unknown } | null | undefined)?.pans;
  if (!Array.isArray(pans)) return undefined;
  const out: CalpinagePanProvenanceEntry[] = [];
  for (const raw of pans) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = r.id;
    if (typeof id !== "string" || id.length === 0) continue;
    const resolved = resolveCalpinagePanPolygonPointsForHeightEdit(r);
    let polygonPx: { x: number; y: number; h?: number }[] | undefined;
    if (resolved) {
      polygonPx = [];
      for (const p of resolved.points) {
        if (!p || typeof p !== "object") continue;
        const q = p as Record<string, unknown>;
        const x = Number(q.x);
        const y = Number(q.y);
        const hRaw = q.h ?? q.heightM;
        const h = typeof hRaw === "number" && Number.isFinite(hRaw) ? hRaw : undefined;
        if (Number.isFinite(x) && Number.isFinite(y)) {
          polygonPx.push(h !== undefined ? { x, y, h } : { x, y });
        }
      }
    }
    out.push({ id, polygonPx: polygonPx && polygonPx.length > 0 ? polygonPx : undefined });
  }
  return out.length > 0 ? out : undefined;
}

function extractGroundImage(state: Record<string, unknown> | null): GroundPlaneImageData | null {
  if (!state) return null;
  const roof = state.roof as Record<string, unknown> | undefined;
  const img = roof?.image as Record<string, unknown> | undefined;
  if (!img || typeof img.dataUrl !== "string" || typeof img.width !== "number" || typeof img.height !== "number") return null;
  if (img.width <= 0 || img.height <= 0) return null;
  return { dataUrl: img.dataUrl, widthPx: img.width, heightPx: img.height };
}

/**
 * Source de vérité runtime : **d’abord** `window.CALPINAGE_STATE` (celui que le canvas 2D et `saveCalpinageState`
 * utilisent), puis éventuellement une copie React passée en prop — jamais l’inverse, sinon l’édition 3D ne
 * persiste pas comme le 2D.
 */
function resolveCalpinageRuntime(calpinageStateProp: unknown | undefined): Record<string, unknown> | null {
  const w = typeof window !== "undefined" ? (window as unknown as { CALPINAGE_STATE?: unknown }).CALPINAGE_STATE : null;
  if (w != null && typeof w === "object") return w as Record<string, unknown>;
  if (calpinageStateProp != null && typeof calpinageStateProp === "object") {
    return calpinageStateProp as Record<string, unknown>;
  }
  return null;
}

function Inline3DViewer({
  calpinageState: calpinageStateProp,
  setCalpinageState,
  runtimeNotifyEpoch = 0,
}: {
  readonly calpinageState?: unknown;
  readonly setCalpinageState?: (next: unknown) => void;
  /** Incrémenté par le parent après mutation runtime — force resync React + rebuild 3D. */
  readonly runtimeNotifyEpoch?: number;
}) {
  const [scene, setScene] = useState<SolarScene3D | null>(null);
  const [groundImage, setGroundImage] = useState<GroundPlaneImageData | null>(null);
  const [calpinagePansForProvenance, setCalpinagePansForProvenance] = useState<
    CalpinagePanProvenanceEntry[] | undefined
  >(undefined);
  const [error, setError] = useState<string | null>(null);
  const lastDisplayedStructuralSignatureRef = useRef<string | null>(null);
  const pendingStructuralEventRef = useRef<OfficialRuntimeStructuralChangePayload | null>(null);
  const forceNextSceneRebuildRef = useRef(false);
  /**
   * FIX-1 — Verrou édition interne bridge.
   * Levé juste avant `emitOfficialRuntimeStructuralChange()` dans les handlers de commit
   * (handleRoofVertexHeightCommit, handleRoofVertexXYCommit, handleStructuralRidgeHeightCommit,
   * handleRoofHeightAssistantApply). Permet à `onStructuralChange` de ne pas re-déclencher
   * `buildScene()` pour cet event : le handler appelle `buildScene()` lui-même juste après.
   */
  const isBridgeInternalEditRef = useRef(false);
  /**
   * FIX-2 — Suppression du rebuild par prop-change après `notifyParentState()`.
   * Levé dans `notifyParentState()` avant `setCalpinageState` — consommé et vidé dans
   * l'useEffect dépendant de `calpinageStateProp` pour éviter le 3e `buildScene()` déclenché
   * par le re-render parent qui suit la notification.
   */
  const skipNextPropChangeBuildRef = useRef(false);
  /**
   * FIX-5 — Suppression du rebuild `PV_MOVE_SYNC` déclenché par `pvSyncSaveRender` (RAF).
   * `handlePanelMoveCommit` fait déjà un `buildScene()` immédiat avec force ; le RAF ultérieur
   * déclencherait un 2e `buildScene()` avec force qui évicterait le cache frais inutilement.
   */
  const suppressNextPvMoveSyncBuildRef = useRef(false);

  // ── Feature flags 3D — A2 : lecture via Context (plus de window.__CALPINAGE_3D_*__) ──
  const {
    vertexZEdit,
    vertexXYEdit,
    ridgeHeightEdit,
    pvLayoutMode,
  } = useCalpinageFeatures();

  /**
   * Version liée du panneau-getter, capturant `pvLayoutMode` depuis le Context.
   * Stable tant que pvLayoutMode ne change pas (flags résolus une seule fois au montage).
   */
  const getAllPanelsForRuntime = useCallback(
    () => getAllPanelsFromRuntime(pvLayoutMode),
    [pvLayoutMode],
  );

  const buildScene = useCallback(() => {
    try {
      const state = resolveCalpinageRuntime(calpinageStateProp);
      if (!state) {
        setCalpinagePansForProvenance(undefined);
        setError("Données calpinage non disponibles");
        return;
      }
      const structuralChangeEventDetail = pendingStructuralEventRef.current;
      pendingStructuralEventRef.current = null;
      const forceStructuralRebuild = forceNextSceneRebuildRef.current;
      forceNextSceneRebuildRef.current = false;
      const displayReconstruction =
        typeof window !== "undefined" &&
        (window as unknown as { __CALPINAGE_3D_ROOF_DISPLAY_FIDELITY__?: string })
          .__CALPINAGE_3D_ROOF_DISPLAY_FIDELITY__ === "reconstruction";
      const optimalSingleBuilding =
        typeof window !== "undefined" &&
        (window as unknown as { __CALPINAGE_OPTIMAL_SINGLE_BUILDING_3D__?: boolean })
          .__CALPINAGE_OPTIMAL_SINGLE_BUILDING_3D__ === true;
      const result = getOrBuildOfficialSolarScene3DFromCalpinageRuntime(state, {
        previouslyDisplayedSceneRuntimeSignature: lastDisplayedStructuralSignatureRef.current,
        structuralChangeEventDetail,
        ...(displayReconstruction ? { roofGeometryFidelityMode: "reconstruction" as const } : {}),
        ...(optimalSingleBuilding ? { legacyRoofMapOptions: optimalSingleBuildingLegacyRoofMapOptions() } : {}),
        ...(forceStructuralRebuild ? { forceStructuralRebuild: true } : {}),
        // T13 : accès typé via façade runtime — cohérent avec L.117 du même fichier.
        // getAllPanelsForRuntime() exclut le bloc actif non figé (panneau fantôme flottant).
        getAllPanels: getAllPanelsForRuntime,
      });
      if (import.meta.env.DEV) {
        const s = result.sceneSyncDiagnostics;
        console.debug("[Inline3DViewer] scene sync", {
          sceneSyncStatus: s.sceneSyncStatus,
          usedSceneCache: s.usedSceneCache,
          signature: s.sceneRuntimeSignature,
          rebuildCount: s.rebuildCountForCurrentSignature,
          lastStructuralChangeReason: s.lastStructuralChangeReason,
          rebuildTriggeredByEvent: s.rebuildTriggeredByEvent,
        });
        console.log("[3D-RUNTIME][ENTRY]", {
          path: "getOrBuildOfficialSolarScene3DFromCalpinageRuntime",
          ok: result.ok,
          hasScene: result.scene != null,
          usedSceneCache: s.usedSceneCache,
          autopsyLegacyPath: result.autopsyLegacyPath ?? "unknown",
        });
      }
      if (result.ok && result.scene) {
        lastDisplayedStructuralSignatureRef.current = result.sceneStructuralSignatures.sceneRuntimeSignature;
        if (import.meta.env.DEV) {
          (window as unknown as { __LAST_3D_BRIDGE__?: Record<string, unknown> }).__LAST_3D_BRIDGE__ = {
            mode: "official",
            officialOk: true,
            usedSceneCache: result.sceneSyncDiagnostics.usedSceneCache,
            autopsyLegacyPath: result.autopsyLegacyPath ?? "unknown",
            sceneSyncStatus: result.sceneSyncDiagnostics.sceneSyncStatus,
          };
          console.log("[3D-RUNTIME][MODE]", {
            bridge: "official",
            cacheHit: result.sceneSyncDiagnostics.usedSceneCache,
            autopsyLegacyPath: result.autopsyLegacyPath ?? "unknown",
          });
        }
        setScene(result.scene);
        setGroundImage(extractGroundImage(state));
        setCalpinagePansForProvenance(extractCalpinagePansForProvenance(state));
        setError(null);
      } else {
        reportOfficialSolarPipelineFailure({
          where: "Inline3DViewerBridge.buildScene",
          stage: "gateway_ready_but_scene_missing_or_ok_false_before_emergency",
          diagnostics: result.diagnostics,
          extra: {
            officialOk: result.ok,
            hasScene: result.scene != null,
            sceneSyncStatus: result.sceneSyncDiagnostics.sceneSyncStatus,
            usedSceneCache: result.sceneSyncDiagnostics.usedSceneCache,
            signature: result.sceneStructuralSignatures.sceneRuntimeSignature,
          },
        });
        const emergency = buildEmergencySolarScene3DFromRuntime(state);
        if (emergency) {
          lastDisplayedStructuralSignatureRef.current = "emergency-fallback";
          if (import.meta.env.DEV) {
            (window as unknown as { __LAST_3D_BRIDGE__?: Record<string, unknown> }).__LAST_3D_BRIDGE__ = {
              mode: "emergency",
              officialOk: false,
              usedSceneCache: false,
              autopsyLegacyPath: "emergency",
              afterOfficialFail: true,
            };
            console.log("[3D-RUNTIME][MODE]", { bridge: "emergency", reason: "official_ok_false_or_no_scene" });
          }
          setScene(emergency);
          setGroundImage(extractGroundImage(state));
          setCalpinagePansForProvenance(extractCalpinagePansForProvenance(state));
          setError(null);
          if (import.meta.env.DEV) {
            console.info("[3D-EMERGENCY][SUCCESS]", { mode: "bridge_fallback_after_official_fail" });
          }
        } else {
          setCalpinagePansForProvenance(undefined);
          setError("Scène 3D non éligible — relevé toiture incomplet");
          if (import.meta.env.DEV) {
            console.warn("[3D-EMERGENCY][FAIL]", { mode: "bridge_fallback_exhausted" });
          }
        }
      }
    } catch (e) {
      if (import.meta.env.DEV) {
        console.error("[Inline3DViewer] buildScene error:", e);
      }
      reportOfficialSolarPipelineFailure({
        where: "Inline3DViewerBridge.buildScene",
        stage: "uncaught_exception",
        exception: e,
      });
      try {
        const state = resolveCalpinageRuntime(calpinageStateProp);
        const emergency = state ? buildEmergencySolarScene3DFromRuntime(state) : null;
        if (emergency) {
          lastDisplayedStructuralSignatureRef.current = "emergency-fallback";
          if (import.meta.env.DEV) {
            (window as unknown as { __LAST_3D_BRIDGE__?: Record<string, unknown> }).__LAST_3D_BRIDGE__ = {
              mode: "emergency",
              officialOk: false,
              usedSceneCache: false,
              autopsyLegacyPath: "emergency",
              afterOfficialThrow: true,
            };
            console.log("[3D-RUNTIME][MODE]", { bridge: "emergency", reason: "throw" });
          }
          setScene(emergency);
          setGroundImage(extractGroundImage(state));
          setCalpinagePansForProvenance(extractCalpinagePansForProvenance(state));
          setError(null);
          if (import.meta.env.DEV) {
            console.info("[3D-EMERGENCY][SUCCESS]", { mode: "bridge_fallback_after_official_throw" });
          }
          return;
        }
      } catch {
        /* ignore */
      }
      const msg = e instanceof Error ? e.message : String(e);
      setCalpinagePansForProvenance(undefined);
      setError(msg);
      if (import.meta.env.DEV) {
        console.warn("[3D-EMERGENCY][FAIL]", { mode: "bridge_throw_and_emergency_exhausted" });
      }
    }
  }, [calpinageStateProp, getAllPanelsForRuntime]);

  /**
   * FA-EVENT-1 — Ref stable vers buildScene.
   * Permet à l'effect d'enregistrement des événements window de ne s'exécuter qu'une seule
   * fois (deps: []) sans jamais capturer une closure périmée de buildScene.
   * Sans ce pattern, tout changement de `calpinageStateProp` (= chaque mutation runtime)
   * déclenchait un removeEventListener + addEventListener, créant une fenêtre de temps
   * (~1 tick React) où un event CALPINAGE_OFFICIAL_RUNTIME_STRUCTURAL_CHANGE pouvait être perdu.
   */
  const buildSceneRef = useRef(buildScene);
  buildSceneRef.current = buildScene;

  useEffect(() => {
    if (calpinageStateProp !== undefined) {
      // FIX-2 : si ce changement de prop provient de notifyParentState() interne, le handler
      // a déjà appelé buildScene() directement — ne pas déclencher un 2e rebuild.
      if (skipNextPropChangeBuildRef.current) {
        skipNextPropChangeBuildRef.current = false;
        return;
      }
      buildScene();
    }
  }, [calpinageStateProp, buildScene]);

  useEffect(() => {
    if (runtimeNotifyEpoch > 0) {
      buildScene();
    }
  }, [runtimeNotifyEpoch, buildScene]);

  /**
   * Verrouille la manipulation PV sur le canvas 2D quand le modeleur 3D toiture est actif (vue 3D).
   * Lit vertexZEdit / vertexXYEdit depuis le Context (A2) au lieu de window.__CALPINAGE_3D_*__.
   * Écrit toujours __CALPINAGE_3D_ROOF_VERTEX_EDIT_ACTIVE__ sur window (flag DERIVÉ lu par le legacy).
   */
  useEffect(() => {
    const sync = () => {
      const w = window as Window & { __CALPINAGE_3D_ROOF_VERTEX_EDIT_ACTIVE__?: boolean };
      const mode3d = (window as unknown as { __CALPINAGE_VIEW_MODE__?: string }).__CALPINAGE_VIEW_MODE__ === "3D";
      w.__CALPINAGE_3D_ROOF_VERTEX_EDIT_ACTIVE__ = mode3d && (vertexZEdit || vertexXYEdit);
    };
    sync();
    window.addEventListener("calpinage:viewmode", sync);
    return () => {
      window.removeEventListener("calpinage:viewmode", sync);
      const w = window as Window & { __CALPINAGE_3D_ROOF_VERTEX_EDIT_ACTIVE__?: boolean };
      delete w.__CALPINAGE_3D_ROOF_VERTEX_EDIT_ACTIVE__;
    };
  }, [vertexZEdit, vertexXYEdit]);

  // FA-EVENT-1 : deps=[] — enregistrement une seule fois au montage.
  // buildSceneRef.current est toujours la version fraîche (mis à jour après chaque render).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    function onViewMode(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.mode === "3D") {
        buildSceneRef.current();
      }
    }
    function onStructuralChange(e: Event) {
      const is3d = getCalpinageWindow().__CALPINAGE_VIEW_MODE__ === "3D";
      const detail = (e as CustomEvent<OfficialRuntimeStructuralChangePayload>).detail;
      if (is3d && detail && typeof detail === "object" && typeof detail.reason === "string") {
        // FIX-5 : PV_MOVE_SYNC / PV_PLACEMENT_SYNC émis par pvSyncSaveRender (RAF) après un
        // handlePanelMoveCommit — buildScene() a déjà été appelé immédiatement avec force rebuild.
        // Consommer le flag et sortir sans rebuild : le cache frais doit être préservé.
        if (
          suppressNextPvMoveSyncBuildRef.current &&
          (detail.reason === "PV_MOVE_SYNC" || detail.reason === "PV_PLACEMENT_SYNC")
        ) {
          suppressNextPvMoveSyncBuildRef.current = false;
          return;
        }
        pendingStructuralEventRef.current = detail;
        /**
         * Les actions PV (pose, déplacement, suppression panneau) ne changent pas la géométrie
         * structurelle du toit, donc la signature de cache scène reste identique → buildScene()
         * renverrait la scène cachée sans les nouveaux panneaux.
         * On invalide le cache explicitement pour forcer un rebuild complet avec les panneaux à jour.
         */
        if (
          detail.reason === "PV_PLACEMENT_SYNC" ||
          detail.reason === "PV_MOVE_SYNC" ||
          detail.reason === "PV_DELETE_SYNC" ||
          (Array.isArray(detail.changedDomains) &&
            detail.changedDomains.includes("pv") &&
            !detail.changedDomains.some((d: string) =>
              ["contours", "ridges", "traits", "pans"].includes(d),
            ))
        ) {
          lastDisplayedStructuralSignatureRef.current = null;
          forceNextSceneRebuildRef.current = true;
        }
      }
      if (is3d) {
        // FIX-1 : un handler interne bridge a levé ce flag avant d'émettre l'event structurel.
        // Il appelle buildScene() lui-même — ne pas déclencher un rebuild redondant ici.
        if (isBridgeInternalEditRef.current) return;
        buildSceneRef.current();
        // LOT3-C7 (Bridge) : après chaque buildScene() structurel, déclencher un refresh overlay
        // dans le viewer via RAF. Le RAF garantit que React a commité le setScene() avant que
        // l'overlay lise readPvLayout3dOverlayState() → pas de race overlay/scene.
        // Sans ce dispatch, pvLayout3dOverlayState restait stale après validation / autofill
        // → selectedPanels contenait des panneaux supprimés → handles dans le vide.
        requestAnimationFrame(() => {
          window.dispatchEvent(new Event("calpinage:pv3d-overlay-changed"));
        });
      }
    }
    window.addEventListener("calpinage:viewmode", onViewMode);
    window.addEventListener(CALPINAGE_OFFICIAL_RUNTIME_STRUCTURAL_CHANGE, onStructuralChange);

    if (getCalpinageWindow().__CALPINAGE_VIEW_MODE__ === "3D") {
      buildSceneRef.current();
    }

    return () => {
      window.removeEventListener("calpinage:viewmode", onViewMode);
      window.removeEventListener(CALPINAGE_OFFICIAL_RUNTIME_STRUCTURAL_CHANGE, onStructuralChange);
    };
  }, []);

  const handleRebuild = useCallback(() => {
    buildScene();
  }, [buildScene]);

  /**
   * Appelé immédiatement après `finalizePvMoveFrom3d` dans SolarScene3DViewer.
   * Invalide le cache gateway + force un rebuild 3D synchrone (sans attendre le RAF de
   * pvSyncSaveRender) pour que l'InstancedMesh reflète les nouvelles positions aussitôt que
   * possible → élimine la fenêtre de temps où l'ancienne position reste visible (bug fantôme).
   */
  const handlePanelMoveCommit = useCallback(() => {
    lastDisplayedStructuralSignatureRef.current = null;
    forceNextSceneRebuildRef.current = true;
    // FIX-5 : pvSyncSaveRender (RAF) va émettre PV_MOVE_SYNC après ce buildScene() immédiat.
    // Marquer le flag pour que onStructuralChange ignore cet event redondant et préserve le
    // cache frais construit ici avec force rebuild.
    suppressNextPvMoveSyncBuildRef.current = true;
    buildScene();
  }, [buildScene]);

  const [roofHistSeq, setRoofHistSeq] = useState(0);
  const bumpRoofHist = useCallback(() => setRoofHistSeq((n) => n + 1), []);

  // ── Feature flags depuis Context (A2 — plus de lecture window.__CALPINAGE_3D_*__) ──
  const enableVertexZEditFlag = vertexZEdit;
  const zDragBridgeUnarmedLoggedRef = useRef(false);
  const enableVertexXYEditFlag = vertexXYEdit;
  const enableStructuralRidgeHeightEditFlag = ridgeHeightEdit;
  const enableModelingHistory =
    enableVertexZEditFlag || enableVertexXYEditFlag || enableStructuralRidgeHeightEditFlag;

  const enablePvLayout3dFlag = pvLayoutMode;
  const pvLayout3dCapabilities = getPvLayout3dProductCapabilityReport();
  const pvLayout3dCapabilitiesMissingKey = pvLayout3dCapabilities.missing.join("|");
  const rootRt = resolveCalpinageRuntime(calpinageStateProp);
  const pvLayoutPhase =
    rootRt != null &&
    typeof rootRt === "object" &&
    (rootRt as { currentPhase?: string }).currentPhase === "PV_LAYOUT";
  const mode3d =
    typeof window !== "undefined" &&
    (window as unknown as { __CALPINAGE_VIEW_MODE__?: string }).__CALPINAGE_VIEW_MODE__ === "3D";
  const pvLayout3DActive = enablePvLayout3dFlag && pvLayout3dCapabilities.ready && pvLayoutPhase && mode3d;

  useEffect(() => {
    if (!import.meta.env.DEV || !enablePvLayout3dFlag || pvLayout3dCapabilities.ready) return;
    console.warn("[CALPINAGE][PV_3D_PRODUCT_UNARMED]", {
      missing: pvLayout3dCapabilities.missing,
    });
  }, [enablePvLayout3dFlag, pvLayout3dCapabilities.ready, pvLayout3dCapabilitiesMissingKey]);

  useEffect(() => {
    if (!import.meta.env.DEV || !scene || zDragBridgeUnarmedLoggedRef.current) return;
    if (!enableVertexZEditFlag) {
      zDragBridgeUnarmedLoggedRef.current = true;
      console.warn("[3D DRAG] Z edit disabled or unarmed", {
        cause: "CalpinageFeatureContext.vertexZEdit !== true",
      });
    }
  }, [scene, enableVertexZEditFlag]);

  const notifyParentState = useCallback(
    (root: Record<string, unknown>) => {
      // FIX-2 : le handler appelant notifyParentState va appeler buildScene() lui-même.
      // Supprimer le rebuild déclenché par la propagation prop-change qui suivra ce setCalpinageState.
      skipNextPropChangeBuildRef.current = true;
      setCalpinageState?.(JSON.parse(JSON.stringify(root)) as unknown);
    },
    [setCalpinageState],
  );

  /**
   * Édition Z : écrit dans `CALPINAGE_STATE` (priorité {@link resolveCalpinageRuntime}) puis
   * 1) si possible, même chaîne que le 2D (`__calpinageCommitRoofVertexHeightLike2D` → `computePansFromGeometry` + save),
   * 2) sinon `applyRoofVertexHeightEdit` + reconstruction planaire du pan + refresh legacy (`saveCalpinageState` / render),
   * puis validation et rebuild 3D.
   */
  const handleRoofVertexHeightCommit = useCallback(
    (edit: RoofVertexHeightEdit) => {
      const dragSessionId = edit.trace?.dragSessionId ?? null;
      const traceSource = edit.trace?.source ?? "unknown";
      emitRoofVertexZTelemetry({
        event: "roof_vertex_z_commit_attempt",
        panId: edit.panId,
        vertexIndex: edit.vertexIndex,
        heightM: edit.heightM,
        dragSessionId,
        source: traceSource,
      });
      if (import.meta.env.DEV) {
        console.log("[3D DRAG] commit request", {
          panId: edit.panId,
          vertexIndex: edit.vertexIndex,
          heightM: edit.heightM,
          dragSessionId,
          source: traceSource,
        });
      }
      const root = resolveCalpinageRuntime(calpinageStateProp);
      if (!root) {
        emitRoofVertexZTelemetry({
          event: "roof_vertex_z_commit_rejected",
          panId: edit.panId,
          vertexIndex: edit.vertexIndex,
          heightM: edit.heightM,
          dragSessionId,
          source: traceSource,
          reasonCode: "RUNTIME_NULL",
        });
        if (import.meta.env.DEV) {
          const w = typeof window !== "undefined" ? (window as unknown as { CALPINAGE_STATE?: unknown }).CALPINAGE_STATE : undefined;
          console.warn("[3D DRAG] commit aborted", {
            reason: "runtime null",
            hasWindowCalpinageState: w != null && typeof w === "object",
            hasCalpinageStateProp: calpinageStateProp != null && typeof calpinageStateProp === "object",
          });
        }
        return;
      }
      if (!assertRoofVertexEditTarget(root, edit.panId, edit.vertexIndex)) {
        emitRoofVertexZTelemetry({
          event: "roof_vertex_z_commit_rejected",
          panId: edit.panId,
          vertexIndex: edit.vertexIndex,
          heightM: edit.heightM,
          dragSessionId,
          source: traceSource,
          reasonCode: "INVALID_TARGET",
        });
        if (import.meta.env.DEV) {
          console.warn("[3D DRAG] commit aborted", { reason: "invalid target", panId: edit.panId, vertexIndex: edit.vertexIndex });
        }
        return;
      }
      if (
        !Number.isFinite(edit.heightM) ||
        edit.heightM < ROOF_VERTEX_COMMIT_MIN_M ||
        edit.heightM > ROOF_VERTEX_COMMIT_MAX_M
      ) {
        emitRoofVertexZTelemetry({
          event: "roof_vertex_z_commit_rejected",
          panId: edit.panId,
          vertexIndex: edit.vertexIndex,
          heightM: edit.heightM,
          dragSessionId,
          source: traceSource,
          reasonCode: "OUT_OF_RANGE",
          reasonDetail: `[${ROOF_VERTEX_COMMIT_MIN_M},${ROOF_VERTEX_COMMIT_MAX_M}]`,
        });
        if (import.meta.env.DEV) {
          console.warn("[3D DRAG] commit aborted", {
            reason: "out of range",
            panId: edit.panId,
            vertexIndex: edit.vertexIndex,
            heightM: edit.heightM,
            minM: ROOF_VERTEX_COMMIT_MIN_M,
            maxM: ROOF_VERTEX_COMMIT_MAX_M,
          });
        }
        console.warn("[3D EDIT] Height commit rejected (out of range)", {
          panId: edit.panId,
          vertexIndex: edit.vertexIndex,
          heightM: edit.heightM,
          minM: ROOF_VERTEX_COMMIT_MIN_M,
          maxM: ROOF_VERTEX_COMMIT_MAX_M,
        });
        return;
      }
      const pansBefore = Array.isArray(root.pans) ? JSON.parse(JSON.stringify(root.pans)) : null;

      if (import.meta.env.DEV) {
        console.log("[3D DRAG] commit runtime vertex h (before any path)", {
          panId: edit.panId,
          vertexIndex: edit.vertexIndex,
          hRead: readCalpinagePanVertexHeightM(root, edit.panId, edit.vertexIndex),
          requestedHeightM: edit.heightM,
        });
      }

      const emitHeightSuccess = (sourceAction: string) => {
        emitRoofVertexZTelemetry({
          event: "roof_vertex_z_commit_applied",
          panId: edit.panId,
          vertexIndex: edit.vertexIndex,
          heightM: edit.heightM,
          dragSessionId,
          source: traceSource,
          pipeline: sourceAction,
        });
        if (import.meta.env.DEV) {
          console.log("[3D DRAG] commit emitHeightSuccess before notifyParentState", {
            sourceAction,
            hRead: readCalpinagePanVertexHeightM(root, edit.panId, edit.vertexIndex),
          });
        }
        if (enableModelingHistory && pansBefore != null) pushRoofModelingPastSnapshot(pansBefore);
        console.log("[3D EDIT] Height applied", {
          panId: edit.panId,
          vertexIndex: edit.vertexIndex,
          heightM: edit.heightM,
          sourceAction,
        });
        notifyParentState(root);
        if (import.meta.env.DEV) {
          console.log("[3D DRAG] commit after notifyParentState");
        }
        // FIX-1 : lever le verrou pour que onStructuralChange ignore cet event (emit sync).
        isBridgeInternalEditRef.current = true;
        emitOfficialRuntimeStructuralChange({
          reason: "ROOF_VERTEX_HEIGHT_EDIT",
          changedDomains: ["pans"],
          debug: { sourceFile: "Inline3DViewerBridge.tsx", sourceAction },
        });
        isBridgeInternalEditRef.current = false;
        if (enableModelingHistory) bumpRoofHist();
        if (import.meta.env.DEV) {
          console.log("[3D DRAG] commit calling buildScene()");
        }
        buildScene();
        if (import.meta.env.DEV) {
          console.log("[3D DRAG] commit buildScene() invoked (async rebuild)");
        }
      };

      const legacy = tryCommitRoofVertexHeightLike2D(edit.panId, edit.vertexIndex, edit.heightM, root);
      if (legacy != null && legacy.ok) {
        syncRoofDerivedMirrors(root);
        /**
         * Même garantie que le chemin TS : le legacy met à jour le graphe structurel puis `computePansFromGeometry`,
         * mais les `h` des sommets du polygone pan peuvent ne pas être coplanaires au sens du validateur 3D
         * (RMS plan). On recale le pan sur un plan monde en pivotant sur la hauteur **effective** du sommet cible.
         */
        const hPivot = readCalpinagePanVertexHeightM(root, edit.panId, edit.vertexIndex);
        if (hPivot == null) {
          legacy.rollback?.();
          showCalpinageRoofEditErrorToast("Hauteur du sommet introuvable après application (legacy).");
          if (import.meta.env.DEV) console.warn("[CALPINAGE][roof-edit-legacy-planar] missing vertex h");
          emitRoofVertexZTelemetry({
            event: "roof_vertex_z_commit_rejected",
            panId: edit.panId,
            vertexIndex: edit.vertexIndex,
            heightM: edit.heightM,
            dragSessionId,
            source: traceSource,
            reasonCode: "LEGACY_VERTEX_H_MISSING",
          });
          return;
        }
        const planarLegacy = rebuildPanPlanarHeightsAfterZEdit(root, {
          panId: edit.panId,
          vertexIndex: edit.vertexIndex,
          heightM: hPivot,
        });
        if (!planarLegacy.ok) {
          legacy.rollback?.();
          showCalpinageRoofEditErrorToast(planarLegacy.message);
          if (import.meta.env.DEV) console.warn("[CALPINAGE][roof-edit-legacy-planar]", planarLegacy);
          emitRoofVertexZTelemetry({
            event: "roof_vertex_z_commit_rejected",
            panId: edit.panId,
            vertexIndex: edit.vertexIndex,
            heightM: edit.heightM,
            dragSessionId,
            source: traceSource,
            reasonCode: "LEGACY_PLANAR_REBUILD_FAILED",
            reasonDetail: planarLegacy.code,
          });
          return;
        }
        syncRoofDerivedMirrors(root);
        const post = validateCalpinageRuntimeAfterRoofEdit(root, {
          editedPanId: edit.panId,
          getAllPanels: getAllPanelsForRuntime,
        });
        if (!post.ok) {
          legacy.rollback?.();
          showCalpinageRoofEditErrorToast(post.userMessage);
          if (import.meta.env.DEV) console.warn("[CALPINAGE][roof-edit-validate]", post);
          emitRoofVertexZTelemetry({
            event: "roof_vertex_z_commit_rejected",
            panId: edit.panId,
            vertexIndex: edit.vertexIndex,
            heightM: edit.heightM,
            dragSessionId,
            source: traceSource,
            reasonCode: "VALIDATION_FAILED",
            reasonDetail: post.codes.join(","),
          });
          return;
        }
        refreshLegacyCalpinage2DAfterPanVertexHeightEdit();
        emitHeightSuccess("__calpinageCommitRoofVertexHeightLike2D+rebuildPanPlanarHeightsAfterZEdit");
        return;
      }
      if (legacy != null && !legacy.ok && legacy.code !== "NO_STRUCTURAL_HIT") {
        showCalpinageRoofEditErrorToast(legacy.message ?? "Édition hauteur refusée.");
        if (import.meta.env.DEV) console.warn("[CALPINAGE][vertex-z-edit-like2d]", legacy);
        emitRoofVertexZTelemetry({
          event: "roof_vertex_z_commit_rejected",
          panId: edit.panId,
          vertexIndex: edit.vertexIndex,
          heightM: edit.heightM,
          dragSessionId,
          source: traceSource,
          reasonCode: "LEGACY_COMMIT_FAILED",
          reasonDetail: legacy.code,
        });
        return;
      }

      if (import.meta.env.DEV) {
        console.log("[3D DRAG] commit before applyRoofVertexHeightEdit (TS path)", {
          hRead: readCalpinagePanVertexHeightM(root, edit.panId, edit.vertexIndex),
        });
      }
      const r = applyRoofVertexHeightEdit(root, edit);
      if (!r.ok) {
        if (import.meta.env.DEV) console.warn("[CALPINAGE][vertex-z-edit]", r);
        emitRoofVertexZTelemetry({
          event: "roof_vertex_z_commit_rejected",
          panId: edit.panId,
          vertexIndex: edit.vertexIndex,
          heightM: edit.heightM,
          dragSessionId,
          source: traceSource,
          reasonCode: "APPLY_ROOF_VERTEX_HEIGHT_FAILED",
          reasonDetail: r.code,
        });
        return;
      }
      if (import.meta.env.DEV) {
        console.log("[3D DRAG] commit after applyRoofVertexHeightEdit (TS path)", {
          hRead: readCalpinagePanVertexHeightM(root, edit.panId, edit.vertexIndex),
        });
      }
      const planar = rebuildPanPlanarHeightsAfterZEdit(root, edit);
      if (!planar.ok) {
        if (pansBefore != null) rollbackPansAndSync(root, pansBefore);
        showCalpinageRoofEditErrorToast(planar.message);
        if (import.meta.env.DEV) console.warn("[CALPINAGE][planar-rebuild]", planar);
        emitRoofVertexZTelemetry({
          event: "roof_vertex_z_commit_rejected",
          panId: edit.panId,
          vertexIndex: edit.vertexIndex,
          heightM: edit.heightM,
          dragSessionId,
          source: traceSource,
          reasonCode: "PLANAR_REBUILD_FAILED",
          reasonDetail: planar.code,
        });
        return;
      }
      syncRoofDerivedMirrors(root);
      const post = validateCalpinageRuntimeAfterRoofEdit(root, {
        editedPanId: edit.panId,
        getAllPanels: getAllPanelsForRuntime,
      });
      if (!post.ok) {
        if (pansBefore != null) rollbackPansAndSync(root, pansBefore);
        showCalpinageRoofEditErrorToast(post.userMessage);
        if (import.meta.env.DEV) console.warn("[CALPINAGE][roof-edit-validate]", post);
        emitRoofVertexZTelemetry({
          event: "roof_vertex_z_commit_rejected",
          panId: edit.panId,
          vertexIndex: edit.vertexIndex,
          heightM: edit.heightM,
          dragSessionId,
          source: traceSource,
          reasonCode: "VALIDATION_FAILED",
          reasonDetail: post.codes.join(","),
        });
        return;
      }
      refreshLegacyCalpinage2DAfterPanVertexHeightEdit();
      emitHeightSuccess(
        legacy != null && !legacy.ok && legacy.code === "NO_STRUCTURAL_HIT"
          ? "applyRoofVertexHeightEdit+rebuildPanPlanarHeightsAfterZEdit(no-structural-snap)"
          : "applyRoofVertexHeightEdit+rebuildPanPlanarHeightsAfterZEdit",
      );
    },
    [bumpRoofHist, buildScene, calpinageStateProp, enableModelingHistory, getAllPanelsForRuntime, notifyParentState],
  );

  const handleRoofVertexXYCommit = useCallback(
    (edit: RoofVertexXYEdit) => {
      const root = resolveCalpinageRuntime(calpinageStateProp);
      if (!root) return;
      if (!assertRoofVertexEditTarget(root, edit.panId, edit.vertexIndex)) return;
      const pansBefore = Array.isArray(root.pans) ? JSON.parse(JSON.stringify(root.pans)) : null;
      const r = applyRoofVertexXYEdit(root, edit);
      if (!r.ok) {
        const toast = (window as unknown as { calpinageToast?: { warning?: (m: string) => void } }).calpinageToast;
        toast?.warning?.(`Édition XY refusée : ${r.message}`);
        if (import.meta.env.DEV) console.warn("[CALPINAGE][vertex-xy-edit]", r);
        return;
      }
      syncRoofDerivedMirrors(root);
      const post = validateCalpinageRuntimeAfterRoofEdit(root, {
        editedPanId: edit.panId,
        getAllPanels: getAllPanelsForRuntime,
      });
      if (!post.ok) {
        if (pansBefore != null) rollbackPansAndSync(root, pansBefore);
        showCalpinageRoofEditErrorToast(post.userMessage);
        if (import.meta.env.DEV) console.warn("[CALPINAGE][roof-edit-validate]", post);
        return;
      }
      if (enableModelingHistory && pansBefore != null) pushRoofModelingPastSnapshot(pansBefore);
      notifyParentState(root);
      // FIX-1 : verrou pour que onStructuralChange ignore cet event (emit synchrone).
      isBridgeInternalEditRef.current = true;
      emitOfficialRuntimeStructuralChange({
        reason: "ROOF_VERTEX_XY_EDIT",
        changedDomains: ["pans"],
        debug: { sourceFile: "Inline3DViewerBridge.tsx", sourceAction: "applyRoofVertexXYEdit" },
      });
      isBridgeInternalEditRef.current = false;
      if (enableModelingHistory) bumpRoofHist();
      buildScene();
    },
    [bumpRoofHist, buildScene, calpinageStateProp, enableModelingHistory, getAllPanelsForRuntime, notifyParentState],
  );

  const handleStructuralRidgeHeightCommit = useCallback(
    (edit: StructuralHeightEdit) => {
      const root = resolveCalpinageRuntime(calpinageStateProp);
      if (!root) return;
      const stateBefore = JSON.parse(JSON.stringify(root)) as Record<string, unknown>;
      const pansBefore = Array.isArray(root.pans) ? JSON.parse(JSON.stringify(root.pans)) : null;
      const r = applyStructuralHeightEdit(root, edit);
      if (!r.ok) {
        showCalpinageRoofEditErrorToast(r.message);
        return;
      }
      syncRoofDerivedMirrors(root);
      const post = validateCalpinageRuntimeAfterRoofEdit(root, {
        editedPanId: firstPanIdForStructuralValidation(root),
        getAllPanels: getAllPanelsForRuntime,
        validateSlopeOnAllPans: true,
        scopePanGeometryErrorsToEditedPanId: false,
      });
      if (!post.ok) {
        restoreCalpinageRuntimeFromSnapshot(root, stateBefore);
        syncRoofDerivedMirrors(root);
        showCalpinageRoofEditErrorToast(post.userMessage);
        return;
      }
      if (enableModelingHistory && pansBefore != null) pushRoofModelingPastSnapshot(pansBefore);
      refreshLegacyCalpinage2DAfterPanVertexHeightEdit();
      notifyParentState(root);
      // FIX-1 : verrou pour que onStructuralChange ignore cet event (emit synchrone).
      isBridgeInternalEditRef.current = true;
      emitOfficialRuntimeStructuralChange({
        reason: "STRUCTURAL_HEIGHT_EDIT",
        changedDomains: ["contours", "ridges", "traits", "pans"],
        debug: { sourceFile: "Inline3DViewerBridge.tsx", sourceAction: "applyStructuralHeightEdit" },
      });
      isBridgeInternalEditRef.current = false;
      if (enableModelingHistory) bumpRoofHist();
      buildScene();
    },
    [bumpRoofHist, buildScene, calpinageStateProp, enableModelingHistory, getAllPanelsForRuntime, notifyParentState],
  );

  const handleRoofHeightAssistantApply = useCallback(
    (command: RoofHeightAssistantCommand) => {
      const root = resolveCalpinageRuntime(calpinageStateProp);
      if (!root) return;
      const stateBefore = JSON.parse(JSON.stringify(root)) as Record<string, unknown>;
      const pansBefore = Array.isArray(root.pans) ? JSON.parse(JSON.stringify(root.pans)) : null;
      const r = applyRoofHeightAssistant(root, command);
      if (!r.ok) {
        restoreCalpinageRuntimeFromSnapshot(root, stateBefore);
        syncRoofDerivedMirrors(root);
        showCalpinageRoofEditErrorToast(r.message);
        return;
      }
      syncRoofDerivedMirrors(root);
      const post = validateCalpinageRuntimeAfterRoofEdit(root, {
        editedPanId: firstPanIdForStructuralValidation(root),
        getAllPanels: getAllPanelsForRuntime,
        validateSlopeOnAllPans: true,
        scopePanGeometryErrorsToEditedPanId: false,
      });
      if (!post.ok) {
        restoreCalpinageRuntimeFromSnapshot(root, stateBefore);
        syncRoofDerivedMirrors(root);
        showCalpinageRoofEditErrorToast(post.userMessage);
        return;
      }
      if (enableModelingHistory && pansBefore != null) pushRoofModelingPastSnapshot(pansBefore);
      refreshLegacyCalpinage2DAfterPanVertexHeightEdit();
      notifyParentState(root);
      // FIX-1 : verrou pour que onStructuralChange ignore cet event (emit synchrone).
      isBridgeInternalEditRef.current = true;
      emitOfficialRuntimeStructuralChange({
        reason: "ROOF_HEIGHT_ASSISTANT",
        changedDomains: ["contours", "ridges", "traits", "pans"],
        debug: { sourceFile: "Inline3DViewerBridge.tsx", sourceAction: "applyRoofHeightAssistant" },
      });
      isBridgeInternalEditRef.current = false;
      if (enableModelingHistory) bumpRoofHist();
      buildScene();
    },
    [bumpRoofHist, buildScene, calpinageStateProp, enableModelingHistory, getAllPanelsForRuntime, notifyParentState],
  );

  const roofHeightAssistant = useMemo(() => {
    if (!enableStructuralRidgeHeightEditFlag || pvLayout3DActive) return null;
    const root = resolveCalpinageRuntime(calpinageStateProp);
    if (!root) return null;
    const summary = summarizeRoofHeightAssistantRuntime(root);
    if (summary.contourPointCount + summary.ridgeEndpointCount + summary.traitEndpointCount === 0) return null;
    return {
      ...summary,
      defaultEaveHeightM: 4,
      defaultRidgeHeightM: 7,
      defaultTraitHeightM: 5.5,
      onApply: handleRoofHeightAssistantApply,
    };
  }, [calpinageStateProp, enableStructuralRidgeHeightEditFlag, handleRoofHeightAssistantApply, pvLayout3DActive, runtimeNotifyEpoch]);

  const roofModelingHistory = useMemo(() => {
    if (!enableModelingHistory) return null;
    return {
      canUndo: canUndoRoofModeling(),
      canRedo: canRedoRoofModeling(),
      onUndo: () => {
        const st = resolveCalpinageRuntime(calpinageStateProp);
        if (!st) return;
        if (undoRoofModeling(st)) {
          notifyParentState(st);
          bumpRoofHist();
          // C3-FIX — Force rebuild même si la signature structurelle retrouvée après undo
          // correspond à une entrée encore en cache (scenario : edit → undo → même état).
          // Sans ce flag, le cache retourne la scène de l'état courant (avant undo) si les
          // deux états ont la même signature → toiture affichée reste figée après undo.
          lastDisplayedStructuralSignatureRef.current = null;
          forceNextSceneRebuildRef.current = true;
          buildScene();
        }
      },
      onRedo: () => {
        const st = resolveCalpinageRuntime(calpinageStateProp);
        if (!st) return;
        if (redoRoofModeling(st)) {
          notifyParentState(st);
          bumpRoofHist();
          // C3-FIX — Idem undo : forcer rebuild pour éviter cache stale sur même signature.
          lastDisplayedStructuralSignatureRef.current = null;
          forceNextSceneRebuildRef.current = true;
          buildScene();
        }
      },
    };
  }, [bumpRoofHist, buildScene, calpinageStateProp, enableModelingHistory, notifyParentState, roofHistSeq]);

  if (error) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: 12,
        color: "#94a3b8",
        fontSize: 14,
        padding: 24,
        textAlign: "center",
      }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
          <line x1="12" y1="22.08" x2="12" y2="12"/>
        </svg>
        <p style={{ margin: 0 }}>{error}</p>
        <button
          type="button"
          onClick={handleRebuild}
          style={{
            padding: "8px 18px",
            borderRadius: 8,
            border: "1px solid rgba(99,102,241,0.35)",
            background: "rgba(99,102,241,0.08)",
            color: "#6366F1",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Réessayer
        </button>
      </div>
    );
  }

  if (!scene) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        color: "#64748b",
        fontSize: 13,
      }}>
        En attente de bascule 3D…
      </div>
    );
  }

  return (
    <Canonical3DViewerErrorBoundary>
      <SolarScene3DViewer
        scene={scene}
        runtimeScene={scene}
        height="100%"
        showRoof
        showRoofEdges
        showExtensions
        showPanels
        showPanelShading
        showShadingLegend={false}
        showSun={false}
        groundImage={groundImage ?? undefined}
        showDebugOverlay={!!getCalpinageWindow().__CALPINAGE_3D_DEBUG__}
        showXYAlignmentOverlay={
          !!getCalpinageWindow().__CALPINAGE_3D_XY_OVERLAY__ || !!getCalpinageWindow().__CALPINAGE_3D_DEBUG__
        }
        debugRuntime={resolveCalpinageRuntime(calpinageStateProp) ?? getCalpinageWindow().CALPINAGE_STATE}
        calpinagePansForProvenance={calpinagePansForProvenance}
        /**
         * En phase PV_LAYOUT, l'édition toiture (Z / XY / arête structurelle) est désactivée :
         * les deux modes sont mutuellement exclusifs pour éviter le conflit de handlers
         * (clic pan → pose panneau PV, pas sélection de sommet).
         */
        inspectMode={enableModelingHistory && !pvLayout3DActive}
        pvLayout3DInteractionMode={pvLayout3DActive}
        onPanelMoveCommit={pvLayout3DActive ? handlePanelMoveCommit : undefined}
        panSelection3DMode={(enableVertexZEditFlag || enableVertexXYEditFlag) && !pvLayout3DActive}
        enableRoofVertexZEdit={enableVertexZEditFlag && !pvLayout3DActive}
        onRoofVertexHeightCommit={enableVertexZEditFlag && !pvLayout3DActive ? handleRoofVertexHeightCommit : undefined}
        enableRoofVertexXYEdit={enableVertexXYEditFlag && !pvLayout3DActive}
        onRoofVertexXYCommit={enableVertexXYEditFlag && !pvLayout3DActive ? handleRoofVertexXYCommit : undefined}
        enableStructuralRidgeHeightEdit={enableStructuralRidgeHeightEditFlag && !pvLayout3DActive}
        onStructuralRidgeHeightCommit={
          enableStructuralRidgeHeightEditFlag && !pvLayout3DActive ? handleStructuralRidgeHeightCommit : undefined
        }
        roofHeightAssistant={roofHeightAssistant}
        roofModelingHistory={roofModelingHistory}
      />
    </Canonical3DViewerErrorBoundary>
  );
}

export type Inline3DViewerBridgeProps = {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  /** Si fourni, source du runtime à la place de `window.CALPINAGE_STATE` pour rebuild / édition. */
  readonly calpinageState?: unknown;
  /** Après mutation ou undo/redo réussi : clone JSON du runtime pour intégration React contrôlée. */
  readonly setCalpinageState?: (next: unknown) => void;
  /** Compteur externe (ex. incrémenté par le parent à chaque mutation) pour rerendre le viewer monté par createRoot. */
  readonly runtimeNotifyEpoch?: number;
};

export function Inline3DViewerBridge({
  containerRef,
  calpinageState,
  setCalpinageState,
  runtimeNotifyEpoch = 0,
}: Inline3DViewerBridgeProps) {
  const rootRef = useRef<ReturnType<typeof createRoot> | null>(null);
  /**
   * FA-ROOT-1 — Guard container stale.
   * Mémorise l'élément DOM sur lequel le React root a été créé.
   * Si le DOM legacy reconstruit `#zone-c-3d` (remount externe sans démontage du Bridge),
   * on détecte le changement d'élément, on démonte l'ancien root et on en crée un nouveau
   * sur le nouvel élément — évite le rendu silencieusement dans un nœud détaché.
   */
  const mountedOnRef = useRef<HTMLElement | null>(null);
  const setCalpinageStateRef = useRef(setCalpinageState);
  setCalpinageStateRef.current = setCalpinageState;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const mount = container.querySelector("#" + MOUNT_ID) as HTMLElement | null;
    if (!mount || !mount.isConnected) return;

    // FA-ROOT-1: si le DOM a été reconstruit (nouvel élément), purger l'ancien root
    if (rootRef.current && mountedOnRef.current !== mount) {
      rootRef.current.unmount();
      rootRef.current = null;
      mountedOnRef.current = null;
    }

    if (!rootRef.current) {
      rootRef.current = createRoot(mount);
      mountedOnRef.current = mount;
    }
    rootRef.current.render(
      <Inline3DViewer
        calpinageState={calpinageState}
        setCalpinageState={(next) => setCalpinageStateRef.current?.(next)}
        runtimeNotifyEpoch={runtimeNotifyEpoch}
      />,
    );
  }, [containerRef, calpinageState, runtimeNotifyEpoch]);

  useEffect(
    () => () => {
      rootRef.current?.unmount();
      rootRef.current = null;
      mountedOnRef.current = null;
    },
    [],
  );

  return null;
}

export default Inline3DViewerBridge;
