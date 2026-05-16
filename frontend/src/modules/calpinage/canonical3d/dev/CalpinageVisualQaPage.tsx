import type { CSSProperties } from "react";
import { useMemo } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { buildSolarScene3DFromCalpinageRuntime } from "../buildSolarScene3DFromCalpinageRuntime";
import { SolarScene3DViewer } from "../viewer/SolarScene3DViewer";
import { isPremiumHouse3DViewMode } from "../viewer/premium/premiumHouse3DViewModes";
import {
  getRuntime3DFixture,
  listRuntime3DFixtureIds,
  runtimeFixtureWithStrictRootPans,
  type Runtime3DFixtureBundle,
} from "./runtime3DFixtureBattery";

type Point2D = { readonly x: number; readonly y: number };

const shell: CSSProperties = {
  width: "100vw",
  height: "100vh",
  overflow: "hidden",
  display: "grid",
  gridTemplateRows: "48px 1fr",
  background: "#0b1020",
  color: "#e5eefb",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
};

const header: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  padding: "0 16px",
  borderBottom: "1px solid rgba(148, 163, 184, 0.28)",
  background: "#111827",
  fontSize: 12,
};

const stage: CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateColumns: "minmax(280px, 32%) 1fr",
};

const panel2d: CSSProperties = {
  position: "relative",
  minWidth: 0,
  minHeight: 0,
  padding: 14,
  background: "#f8fafc",
  color: "#0f172a",
  borderRight: "1px solid rgba(15, 23, 42, 0.14)",
};

const viewerWrap: CSSProperties = {
  position: "relative",
  minWidth: 0,
  minHeight: 0,
  background: "#020617",
};

function asArray(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
}

function readPoints(raw: Record<string, unknown>): readonly Point2D[] {
  const direct = raw.points;
  if (Array.isArray(direct)) return direct.filter(isPoint);
  const polygon = raw.polygonPx;
  if (Array.isArray(polygon)) return polygon.filter(isPoint);
  const contour = raw.contour;
  if (contour && typeof contour === "object") {
    const points = (contour as Record<string, unknown>).points;
    if (Array.isArray(points)) return points.filter(isPoint);
  }
  return [];
}

function isPoint(value: unknown): value is Point2D {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { x?: unknown }).x === "number" &&
    typeof (value as { y?: unknown }).y === "number"
  );
}

function pointString(points: readonly Point2D[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

function bounds(all: readonly Point2D[]): { readonly minX: number; readonly minY: number; readonly w: number; readonly h: number } {
  if (all.length === 0) return { minX: 0, minY: 0, w: 900, h: 620 };
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const minX = Math.min(...xs) - 60;
  const minY = Math.min(...ys) - 60;
  const maxX = Math.max(...xs) + 60;
  const maxY = Math.max(...ys) + 60;
  return { minX, minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function visualKey(raw: Record<string, unknown>): string {
  const meta = raw.meta;
  if (meta && typeof meta === "object" && typeof (meta as { businessObstacleId?: unknown }).businessObstacleId === "string") {
    return (meta as { businessObstacleId: string }).businessObstacleId;
  }
  return String(raw.kind ?? raw.type ?? "obstacle");
}

function obstacleColors(key: string): { readonly fill: string; readonly stroke: string; readonly dash?: string } {
  if (key.includes("chimney")) return { fill: "#fed7aa", stroke: "#9a3412" };
  if (key.includes("roof_window")) return { fill: "#ccfbf1", stroke: "#0f766e" };
  if (key.includes("vmc")) return { fill: "#bae6fd", stroke: "#0369a1" };
  if (key.includes("antenna")) return { fill: "#e2e8f0", stroke: "#334155" };
  if (key.includes("keepout")) return { fill: "#fee2e2", stroke: "#dc2626", dash: "8 6" };
  if (key.includes("tree")) return { fill: "#bbf7d0", stroke: "#166534", dash: "10 7" };
  return { fill: "#e5e7eb", stroke: "#475569" };
}

function FixturePlan2D({ bundle }: { readonly bundle: Runtime3DFixtureBundle }) {
  const runtime = bundle.runtime;
  const pans = asArray(runtime.pans ?? (runtime.roof as Record<string, unknown> | undefined)?.roofPans);
  const obstacles = [...asArray(runtime.obstacles), ...asArray(runtime.shadowVolumes)];
  const extensions = asArray(runtime.roofExtensions);
  const panels = bundle.panels.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  const all = [...pans, ...obstacles, ...extensions, ...panels].flatMap(readPoints);
  const b = bounds(all);

  return (
    <section style={panel2d} data-testid="visual-qa-plan-2d">
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0, marginBottom: 8 }}>Phase 2 - plan 2D</div>
      <svg viewBox={`${b.minX} ${b.minY} ${b.w} ${b.h}`} width="100%" height="calc(100% - 24px)" role="img">
        <rect x={b.minX} y={b.minY} width={b.w} height={b.h} fill="#f8fafc" />
        {pans.map((pan, index) => (
          <polygon
            key={`pan-${String(pan.id ?? index)}`}
            points={pointString(readPoints(pan))}
            fill={index % 2 === 0 ? "#dbeafe" : "#dcfce7"}
            stroke="#1e293b"
            strokeWidth={2}
          />
        ))}
        {extensions.map((ext, index) => (
          <polygon
            key={`ext-${String(ext.id ?? index)}`}
            points={pointString(readPoints(ext))}
            fill="#fef3c7"
            stroke="#b45309"
            strokeWidth={2}
          />
        ))}
        {panels.map((panel, index) => (
          <polygon
            key={`pv-${String(panel.id ?? index)}`}
            points={pointString(readPoints(panel))}
            fill="#0f766e"
            stroke="#022c22"
            strokeWidth={1.5}
            opacity={0.88}
          />
        ))}
        {obstacles.map((obs, index) => {
          const c = obstacleColors(visualKey(obs));
          return (
            <polygon
              key={`obs-${String(obs.id ?? index)}`}
              points={pointString(readPoints(obs))}
              fill={c.fill}
              stroke={c.stroke}
              strokeWidth={2}
              strokeDasharray={c.dash}
              opacity={0.86}
            />
          );
        })}
      </svg>
    </section>
  );
}

export default function CalpinageVisualQaPage() {
  if (!import.meta.env.DEV) return <Navigate to="/" replace />;

  const [params] = useSearchParams();
  const requested = params.get("fixture") ?? "visual_qa_premium_complex";
  const bundle = getRuntime3DFixture(requested) ?? getRuntime3DFixture("visual_qa_premium_complex")!;
  const viewParam = params.get("view");
  const premiumViewMode = isPremiumHouse3DViewMode(viewParam) ? viewParam : "validation";

  const state = useMemo(() => {
    const runtime = runtimeFixtureWithStrictRootPans(bundle.runtime);
    return buildSolarScene3DFromCalpinageRuntime(runtime, { getAllPanels: () => bundle.panels });
  }, [bundle]);

  if (!state.ok || !state.scene) {
    return (
      <div style={shell}>
        <header style={header}>Calpinage Visual QA - erreur</header>
        <main style={{ padding: 24 }}>{state.diagnostics.errors[0]?.message ?? "Scene invalide"}</main>
      </div>
    );
  }

  return (
    <div style={shell} data-testid="visual-qa-root">
      <header style={header}>
        <strong>Calpinage Visual QA</strong>
        <span>{bundle.title}</span>
        <span>
          fixtures={listRuntime3DFixtureIds().length} | pans={state.scene.roofModel.roofPlanePatches.length} |
          obstacles={state.scene.obstacleVolumes.length} | extensions={state.scene.extensionVolumes.length} |
          panneaux={state.scene.pvPanels.length}
        </span>
      </header>
      <main style={stage} data-testid="visual-qa-stage">
        <FixturePlan2D bundle={bundle} />
        <section style={viewerWrap} data-testid="visual-qa-viewer-3d">
          <SolarScene3DViewer
            scene={state.scene}
            height="100%"
            showRoof
            showRoofTruthBadges
            showMissingHeightAlerts
            showMultiPanDiagnostics
            showRoofEdges
            showObstacles
            showExtensions
            showPanels
            showPanelShading
            showShadingLegend
            showSun
            showDebugOverlay={false}
            inspectMode
            premiumViewMode={premiumViewMode}
            cameraViewMode="SCENE_3D"
            showCameraViewModeToggle={false}
          />
        </section>
      </main>
    </div>
  );
}
