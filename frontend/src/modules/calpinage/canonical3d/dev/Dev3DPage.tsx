/**
 * Sandbox 3D canonical — plein écran, hors UX métier.
 * Route : /dev/3d (active uniquement si `import.meta.env.DEV`).
 */

import type { CSSProperties } from "react";
import { useEffect, useMemo } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { isCalpinage3DRuntimeDebugEnabled } from "../../core/calpinage3dRuntimeDebug";
import {
  computeRoofShellAlignmentDiagnostics,
  formatRoofShellAlignmentOneLine,
} from "../diagnostics/computeRoofShellAlignmentDiagnostics";
import type { SolarScene3D } from "../types/solarScene3d";
import { SolarScene3DViewer } from "../viewer/SolarScene3DViewer";
import { isPremiumHouse3DViewMode } from "../viewer/premium/premiumHouse3DViewModes";
import { compareLegacyAndCanonical3D } from "./compareLegacyAndCanonical3D";
import { useDev3DScene } from "./useDev3DScene";

const headerStyle: CSSProperties = {
  flexShrink: 0,
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "10px 16px",
  padding: "8px 12px",
  fontFamily: "ui-monospace, monospace",
  fontSize: 12,
  lineHeight: 1.4,
  color: "#e2e8f0",
  background: "#0f172a",
  borderBottom: "1px solid #334155",
};

const mainStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  position: "relative",
  background: "#020617",
};

const errorStyle: CSSProperties = {
  padding: 24,
  color: "#fecaca",
  fontFamily: "ui-monospace, monospace",
  fontSize: 13,
  maxWidth: 560,
};

function DebugStrip({
  mode,
  runtimeSource,
  scene,
  roofShellAlignLine,
}: {
  readonly mode: string;
  readonly runtimeSource: string;
  readonly scene: SolarScene3D;
  readonly roofShellAlignLine: string | null;
}) {
  const c = scene.coherence;
  const pans = scene.roofModel.roofPlanePatches.length;
  const panels = scene.pvPanels.length;
  const obs = scene.obstacleVolumes.length;
  const ext = scene.extensionVolumes.length;
  const trace = scene.sourceTrace != null;
  const grade = c?.sceneQualityGrade ?? "—";
  const geom = c?.confidence.geometryConfidence ?? "—";

  return (
    <header style={headerStyle}>
      <span>
        <strong>dev/3d</strong> · mode={mode} · runtime={runtimeSource}
      </span>
      <span>
        pans={pans} · panels={panels} · obstacles={obs} · extensions={ext}
      </span>
      <span>
        sourceTrace={trace ? "yes" : "no"} · grade={grade} · geometryConfidence={geom}
      </span>
      {roofShellAlignLine != null ? (
        <span style={{ width: "100%", opacity: 0.92, fontSize: 11, color: "#a5b4fc" }} data-testid="dev-3d-shell-align">
          {roofShellAlignLine}
        </span>
      ) : null}
      <span style={{ opacity: 0.75 }}>
        Query · demo | runtime · inspect=1 · parity=1 · view=presentation|technical|validation|pv · sessionStorage «
        solarnext_dev_3d_runtime_json »
      </span>
    </header>
  );
}

const parityPreStyle: CSSProperties = {
  flexShrink: 0,
  maxHeight: "38vh",
  overflow: "auto",
  margin: 0,
  padding: 10,
  fontFamily: "ui-monospace, monospace",
  fontSize: 11,
  lineHeight: 1.35,
  color: "#e2e8f0",
  background: "#020617",
  borderTop: "1px solid #334155",
};

export default function Dev3DPage() {
  if (!import.meta.env.DEV) {
    return <Navigate to="/" replace />;
  }

  const [params] = useSearchParams();
  const inspectMode = params.get("inspect") === "1";
  const debugOverlay = params.get("debug") !== "0";
  const parity = params.get("parity") === "1";
  const viewParam = params.get("view");
  const premiumViewMode = isPremiumHouse3DViewMode(viewParam) ? viewParam : undefined;

  const state = useDev3DScene();

  const parityReport = useMemo(() => {
    if (!parity || state.status !== "ok" || state.mode !== "runtime" || !state.runtimeBuildInput) {
      return null;
    }
    return compareLegacyAndCanonical3D(state.runtimeBuildInput);
  }, [parity, state]);

  const roofShellAlignLine = useMemo(() => {
    if (!isCalpinage3DRuntimeDebugEnabled() || state.status !== "ok") return null;
    return formatRoofShellAlignmentOneLine(computeRoofShellAlignmentDiagnostics(state.scene));
  }, [state]);

  useEffect(() => {
    if (!parityReport) return;
    console.info("[dev/3d parity]", parityReport.overall.status, parityReport.overall.summary);
  }, [parityReport]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100%", overflow: "hidden" }}>
      {state.status === "ok" ? (
        <>
          <DebugStrip
            mode={state.mode}
            runtimeSource={state.runtimeSource}
            scene={state.scene}
            roofShellAlignLine={roofShellAlignLine}
          />
          {parity && parityReport ? (
            <pre style={parityPreStyle} data-testid="dev-3d-parity-report">
              {JSON.stringify(parityReport, null, 2)}
            </pre>
          ) : null}
          {parity && state.mode === "runtime" && !state.runtimeBuildInput ? (
            <pre style={parityPreStyle}>Parité : `runtimeBuildInput` indisponible (mode demo ?).</pre>
          ) : null}
          <main style={mainStyle}>
            <div style={{ position: "absolute", inset: 0, minHeight: 0 }}>
              <SolarScene3DViewer
                scene={state.scene}
                height="100%"
                showRoof
                showRoofEdges
                showObstacles
                showExtensions
                showPanels
                showPanelShading
                showSun
                inspectMode={inspectMode}
                showDebugOverlay={debugOverlay}
                premiumViewMode={premiumViewMode}
                showPremiumViewModeToolbar
                showCameraViewModeToggle
              />
            </div>
          </main>
        </>
      ) : state.status === "loading" ? (
        <main style={mainStyle}>
          <div style={errorStyle}>Chargement de la scène demo…</div>
        </main>
      ) : (
        <>
          <header style={headerStyle}>
            <strong>dev/3d</strong> · mode={state.mode} · erreur
          </header>
          {parity && state.runtimeBuildInput ? (
            <pre style={parityPreStyle} data-testid="dev-3d-parity-report-error">
              {JSON.stringify(compareLegacyAndCanonical3D(state.runtimeBuildInput), null, 2)}
            </pre>
          ) : null}
          <main style={mainStyle}>
            <div style={errorStyle}>{state.message}</div>
          </main>
        </>
      )}
    </div>
  );
}
