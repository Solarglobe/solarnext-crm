/**
 * Inline3DViewerBridge — Monte SolarScene3DViewer dans #zone-c-3d.
 * Le viewer est monté une seule fois et reste en vie tant que le composant existe.
 * Il écoute l'événement `calpinage:viewmode` pour savoir quand rebuild la scène.
 */

import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { SolarScene3DViewer } from "../canonical3d/viewer/SolarScene3DViewer";
import { buildSolarScene3DFromCalpinageRuntime } from "../canonical3d/buildSolarScene3DFromCalpinageRuntime";
import type { SolarScene3D } from "../canonical3d/types/solarScene3d";
import type { GroundPlaneImageData } from "../canonical3d/viewer/GroundPlaneTexture";
import { Canonical3DViewerErrorBoundary } from "../canonical3d/product/Canonical3DProductMount";

const MOUNT_ID = "zone-c-3d";

function extractGroundImage(state: any): GroundPlaneImageData | null {
  const img = state?.roof?.image;
  if (!img?.dataUrl || typeof img.width !== "number" || typeof img.height !== "number") return null;
  if (img.width <= 0 || img.height <= 0) return null;
  return { dataUrl: img.dataUrl, widthPx: img.width, heightPx: img.height };
}

function Inline3DViewer() {
  const [scene, setScene] = useState<SolarScene3D | null>(null);
  const [groundImage, setGroundImage] = useState<GroundPlaneImageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buildScene = useCallback(() => {
    try {
      const state = (window as any).CALPINAGE_STATE;
      if (!state) {
        setError("Données calpinage non disponibles");
        return;
      }
      const result = buildSolarScene3DFromCalpinageRuntime(state);
      if (result.ok && result.scene) {
        setScene(result.scene);
        setGroundImage(extractGroundImage(state));
        setError(null);
      } else {
        setError("Scène 3D non éligible — relevé toiture incomplet");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      if (import.meta.env.DEV) {
        console.error("[Inline3DViewer] buildScene error:", e);
      }
    }
  }, []);

  useEffect(() => {
    function onViewMode(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.mode === "3D") {
        buildScene();
      }
    }
    window.addEventListener("calpinage:viewmode", onViewMode);

    if ((window as any).__CALPINAGE_VIEW_MODE__ === "3D") {
      buildScene();
    }

    return () => {
      window.removeEventListener("calpinage:viewmode", onViewMode);
    };
  }, [buildScene]);

  const handleRebuild = useCallback(() => {
    buildScene();
  }, [buildScene]);

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
            border: "1px solid rgba(195,152,71,0.4)",
            background: "rgba(195,152,71,0.1)",
            color: "#c39847",
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
        height="100%"
        showRoof
        showRoofEdges
        showObstacles
        showExtensions
        showPanels
        showPanelShading
        showShadingLegend={false}
        showSun={false}
        groundImage={groundImage ?? undefined}
        showDebugOverlay={!!(window as any).__CALPINAGE_3D_DEBUG__}
        showXYAlignmentOverlay={
          !!(window as any).__CALPINAGE_3D_XY_OVERLAY__ || !!(window as any).__CALPINAGE_3D_DEBUG__
        }
        debugRuntime={(window as any).CALPINAGE_STATE}
      />
    </Canonical3DViewerErrorBoundary>
  );
}

export function Inline3DViewerBridge({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const rootRef = useRef<ReturnType<typeof createRoot> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const mount = container.querySelector("#" + MOUNT_ID) as HTMLElement | null;
    if (!mount || !mount.isConnected) return;

    if (!rootRef.current) {
      rootRef.current = createRoot(mount);
    }
    rootRef.current.render(<Inline3DViewer />);

    return () => {
      rootRef.current?.render(null);
    };
  }, [containerRef]);

  return null;
}
