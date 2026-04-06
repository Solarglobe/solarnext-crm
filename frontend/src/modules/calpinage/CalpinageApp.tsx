import { useCallback, useEffect, useRef, useState } from "react";
import { initCalpinage } from "./legacy/calpinage.module.js";
import { ensureCalpinageDeps, resetCalpinageDepsCache } from "./legacy/loadCalpinageDeps";
import { getUiShadingSnapshot } from "./shading/getUiShadingSnapshot";
import { getDsmOverlayManager } from "./dsmOverlay";
import { Phase2SidebarBridge } from "./components/Phase2SidebarBridge";
import { Phase3SidebarBridge } from "./components/Phase3SidebarBridge";
import { Inline3DViewerBridge } from "./components/Inline3DViewerBridge";
import { logCanonical3DFlagResolutionOnce } from "./canonical3d/featureFlags";
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
      const apiBase = import.meta.env?.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "");
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
          <Inline3DViewerBridge containerRef={containerRef} />
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
              Erreur chargement Calpinage
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
