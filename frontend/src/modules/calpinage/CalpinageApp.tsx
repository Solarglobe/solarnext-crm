import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { installEmitOfficialRuntimeStructuralChangeOnWindow } from "./runtime/emitOfficialRuntimeStructuralChange";
import { installRoofModelingHistoryOnWindow } from "./runtime/roofModelingHistory";
import { initCalpinage } from "./legacy/calpinage.module.js";
import { ensureCalpinageDeps, resetCalpinageDepsCache } from "./legacy/loadCalpinageDeps";
import { getUiShadingSnapshot } from "./shading/getUiShadingSnapshot";
import { getDsmOverlayManager } from "./dsmOverlay";
import { Phase2SidebarBridge } from "./components/Phase2SidebarBridge";
import { Phase3SidebarBridge } from "./components/Phase3SidebarBridge";
import { Inline3DViewerBridge } from "./components/Inline3DViewerBridge";
import { logCanonical3DFlagResolutionOnce } from "./canonical3d/featureFlags";
import {
  getPvLayout3dProductRolloutResolution,
  getPvPlaceProbeRolloutResolution,
  logPvLayout3dRolloutOnce,
} from "./runtime/pvLayout3dRollout";
import { emitRoofVertexZTelemetry } from "./runtime/roofVertexZEditTelemetry";
import { getCrmApiBase } from "@/config/crmApiBase";
import { ConfirmProvider } from "./ui/ConfirmProvider";
import { ToastProvider } from "./ui/ToastProvider";

const DEV = typeof import.meta !== "undefined" && import.meta.env?.DEV;

type Props = {
  studyId: string;
  versionId: string;
  onValidate?: (data: unknown) => void;
};

export default function CalpinageApp({
  studyId,
  versionId,
  onValidate
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cancelledRef = useRef(false);
  const teardownRef = useRef<(() => void) | null>(null);
  const initInFlightRef = useRef(false);
  const hasInitializedRef = useRef(false);
  const retryRequestedRef = useRef(false);
  const onValidateRef = useRef(onValidate);

  useEffect(() => {
    onValidateRef.current = onValidate;
  }, [onValidate]);

  useEffect(() => {
    logCanonical3DFlagResolutionOnce();
  }, []);

  useLayoutEffect(() => installEmitOfficialRuntimeStructuralChangeOnWindow(), []);
  useLayoutEffect(() => {
    const off = installRoofModelingHistoryOnWindow();
    return () => off();
  }, []);

  /**
   * Mode édition sommet toiture en 3D (Z / XY) — flags globaux pour le bridge + viewer.
   * Priorité : localStorage (`calpinage_3d_vertex_z` / `calpinage_3d_vertex_xy`, valeurs "0"|"1")
   * puis VITE_* ; défaut Z activé (produit), XY désactivé sauf override.
   */
  useLayoutEffect(() => {
    type W = Window & {
      __CALPINAGE_3D_VERTEX_Z_EDIT__?: boolean;
      __CALPINAGE_3D_VERTEX_XY_EDIT__?: boolean;
      __CALPINAGE_3D_RIDGE_HEIGHT_EDIT__?: boolean;
      /** Pass 4 — sonde technique pose PV 3D → Phase 3 (désactivé par défaut). */
      __CALPINAGE_3D_PV_PLACE_PROBE__?: boolean;
      /** Pass 5 — pose / déplacement PV en 3D (produit, phase PV_LAYOUT). */
      __CALPINAGE_3D_PV_LAYOUT_MODE__?: boolean;
    };
    const w = window as W;
    const readTri = (lsKey: string, envKey: string, defaultOn: boolean): boolean => {
      try {
        const ls = localStorage.getItem(lsKey);
        if (ls === "0") return false;
        if (ls === "1") return true;
      } catch {
        /* ignore */
      }
      const env = import.meta.env as Record<string, string | boolean | undefined>;
      const raw = env[envKey];
      if (raw === "false" || raw === false) return false;
      if (raw === "true" || raw === true) return true;
      return defaultOn;
    };
    w.__CALPINAGE_3D_VERTEX_Z_EDIT__ = readTri("calpinage_3d_vertex_z", "VITE_CALPINAGE_3D_VERTEX_Z_EDIT", true);
    w.__CALPINAGE_3D_VERTEX_XY_EDIT__ = readTri("calpinage_3d_vertex_xy", "VITE_CALPINAGE_3D_VERTEX_XY_EDIT", false);
    w.__CALPINAGE_3D_RIDGE_HEIGHT_EDIT__ = readTri("calpinage_3d_ridge_h", "VITE_CALPINAGE_3D_RIDGE_HEIGHT_EDIT", false);
    const probeRes = getPvPlaceProbeRolloutResolution();
    w.__CALPINAGE_3D_PV_PLACE_PROBE__ = probeRes.value;
    const pvLayoutRes = getPvLayout3dProductRolloutResolution();
    logPvLayout3dRolloutOnce(pvLayoutRes);
    w.__CALPINAGE_3D_PV_LAYOUT_MODE__ = pvLayoutRes.value;
    return () => {
      delete w.__CALPINAGE_3D_VERTEX_Z_EDIT__;
      delete w.__CALPINAGE_3D_VERTEX_XY_EDIT__;
      delete w.__CALPINAGE_3D_RIDGE_HEIGHT_EDIT__;
      delete w.__CALPINAGE_3D_PV_PLACE_PROBE__;
      delete w.__CALPINAGE_3D_PV_LAYOUT_MODE__;
    };
  }, []);

  /** Vérif télémétrie Z : dans la console, `__CALPINAGE_ROOF_Z_TELEMETRY_PING__()` → une ligne `[CALPINAGE][ROOF_Z_TELEMETRY]`. */
  useLayoutEffect(() => {
    const w = window as Window & { __CALPINAGE_ROOF_Z_TELEMETRY_PING__?: () => void };
    w.__CALPINAGE_ROOF_Z_TELEMETRY_PING__ = () => {
      emitRoofVertexZTelemetry({ event: "roof_vertex_z_diagnostic_ping" });
    };
    return () => {
      delete w.__CALPINAGE_ROOF_Z_TELEMETRY_PING__;
    };
  }, []);

  /** Parité UI ↔ serveur : lecture seule, appelable depuis la console ou un POST /calc avec body JSON. */
  useEffect(() => {
    const w = window as Window & {
      __SOLARNEXT_GET_UI_SHADING_SNAPSHOT__?: () => ReturnType<typeof getUiShadingSnapshot>;
    };
    w.__SOLARNEXT_GET_UI_SHADING_SNAPSHOT__ = () => getUiShadingSnapshot();
    return () => {
      if (w.__SOLARNEXT_GET_UI_SHADING_SNAPSHOT__) {
        delete w.__SOLARNEXT_GET_UI_SHADING_SNAPSHOT__;
      }
    };
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  /** Synchronise le bridge 3D (createRoot) avec les mutations `CALPINAGE_STATE` hors React. */
  const [calpinageRuntimeNotifyEpoch, setCalpinageRuntimeNotifyEpoch] = useState(0);

  const runInit = useCallback(async (isRetry = false) => {
    if (initInFlightRef.current) {
      if (DEV && typeof console !== "undefined") {
        console.warn("[CalpinageApp] init already in flight, scheduling retry");
      }
      retryRequestedRef.current = true;
      return;
    }
    initInFlightRef.current = true;
    setLoading(true);
    setError(null);
    if (DEV && typeof console !== "undefined") {
      console.log("[CalpinageApp] init start");
    }
    try {
      const apiBase = getCrmApiBase() || (typeof window !== "undefined" ? window.location.origin : "");
      if (typeof window !== "undefined" && apiBase) {
        (window as unknown as { CALPINAGE_API_BASE?: string }).CALPINAGE_API_BASE = apiBase;
      }
      // Ne JAMAIS appeler initCalpinage avant ensureCalpinageDeps (garantit window.google)
      await ensureCalpinageDeps();
      if (cancelledRef.current) return;
      const container = containerRef.current;
      if (!container) {
        if (DEV && typeof console !== "undefined") {
          console.log("[CalpinageApp] init skipped: no container");
        }
        if (!isRetry) {
          queueMicrotask(() => runInit(true));
        }
        return;
      }

      const teardown = initCalpinage(container, {
        studyId,
        versionId,
        onValidate: (data: unknown) => onValidateRef.current?.(data)
      });
      teardownRef.current = typeof teardown === "function" ? teardown : null;
      hasInitializedRef.current = true;
      if (DEV && typeof console !== "undefined") {
        console.log("[CalpinageApp] init done");
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      console.error("[CALPINAGE] Erreur chargement dépendances:", err.message, err);
    } finally {
      initInFlightRef.current = false;
      if (!cancelledRef.current) setLoading(false);
      if (retryRequestedRef.current) {
        retryRequestedRef.current = false;
        queueMicrotask(() => runInit(true));
      }
    }
  }, [studyId, versionId]);

  const handleRetry = useCallback(() => {
    hasInitializedRef.current = false;
    resetCalpinageDepsCache();
    runInit();
  }, [runInit]);

  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;
    cancelledRef.current = false;
    runInit();
    return () => {
      if (DEV && typeof console !== "undefined") {
        console.log("[CalpinageApp] unmount cleanup");
      }
      cancelledRef.current = true;
      hasInitializedRef.current = false;
      retryRequestedRef.current = false;
      const dsm = getDsmOverlayManager();
      if (dsm) dsm.destroy();
      const cleanup = teardownRef.current;
      if (cleanup) {
        cleanup();
        teardownRef.current = null;
      }
    };
  }, [runInit]);

  return (
    <ToastProvider>
      <ConfirmProvider>
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0
        }}
      >
        {/* Container vide — le legacy y injecte innerRoot, ne jamais y mettre d'enfants React */}
        <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", flex: 1, minHeight: 0 }}
      />
      {!loading && !error && (
        <>
          <Phase2SidebarBridge containerRef={containerRef} />
          <Phase3SidebarBridge containerRef={containerRef} />
          <Inline3DViewerBridge
            containerRef={containerRef}
            runtimeNotifyEpoch={calpinageRuntimeNotifyEpoch}
            setCalpinageState={() => setCalpinageRuntimeNotifyEpoch((n) => n + 1)}
          />
        </>
      )}
      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted, #6b7280)",
            fontSize: "14px",
            background: "rgba(14,14,26,0.9)",
            zIndex: 10
          }}
        >
          Chargement des cartes…
        </div>
      )}
      {error && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            background: "rgba(14,14,26,0.95)",
            zIndex: 20
          }}
        >
          <div
            style={{
              maxWidth: "480px",
              padding: "24px",
              borderRadius: "var(--sg-radius-md)",
              background: "var(--card, #0f172a)",
              border: "1px solid var(--line, rgba(255,255,255,0.1))",
              boxShadow: "var(--sg-shadow-soft)"
            }}
          >
            <h2 style={{ margin: "0 0 12px 0", fontSize: "18px", fontWeight: 600, color: "#b91c1c" }}>
              {/clé Google Maps|VITE_GOOGLE_MAPS_API_KEY/.test(error.message)
                ? "Configuration Calpinage (Google Maps)"
                : "Erreur chargement Calpinage"}
            </h2>
            <p style={{ margin: "0 0 20px 0", fontSize: "14px", color: "var(--muted, #94a3b8)", lineHeight: 1.5 }}>
              {error.message}
            </p>
            <button
              type="button"
              onClick={handleRetry}
              style={{
                padding: "10px 20px",
                borderRadius: "var(--sg-radius-sm)",
                border: "none",
                background: "#7c3aed",
                color: "#fff",
                fontSize: "14px",
                fontWeight: 500,
                cursor: "pointer"
              }}
            >
              Réessayer
            </button>
          </div>
        </div>
      )}
      </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}
