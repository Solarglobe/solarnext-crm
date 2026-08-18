import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { SolarScene3D } from "../types/solarScene3d";
import {
  resolveRoofTruthBadge,
  type RoofMissingHeightAlert,
  type RoofTruthBadgeModel,
  type RoofTruthBadgeTone,
} from "./roofTruthBadges";

export interface RoofTruthBadgeScreenModel extends RoofTruthBadgeModel {
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}

const ROOF_TRUTH_BADGE_TOKENS: Record<
  RoofTruthBadgeTone,
  {
    readonly dot: string;
    readonly text: string;
    readonly border: string;
    readonly background: string;
  }
> = {
  measured: {
    dot: "#22c55e",
    text: "#dcfce7",
    border: "rgba(34,197,94,0.38)",
    background: "rgba(6,78,59,0.74)",
  },
  deduced: {
    dot: "#38bdf8",
    text: "#e0f2fe",
    border: "rgba(56,189,248,0.36)",
    background: "rgba(12,74,110,0.74)",
  },
  generic: {
    dot: "#f59e0b",
    text: "#fffbeb",
    border: "rgba(245,158,11,0.42)",
    background: "rgba(120,53,15,0.76)",
  },
  incoherent: {
    dot: "#ef4444",
    text: "#fee2e2",
    border: "rgba(239,68,68,0.48)",
    background: "rgba(127,29,29,0.78)",
  },
};

function roofTruthBadgesSignature(badges: readonly RoofTruthBadgeScreenModel[]): string {
  return badges
    .map((b) => `${b.panId}:${b.truthClass}:${b.visible ? 1 : 0}:${b.x.toFixed(0)},${b.y.toFixed(0)}`)
    .join("|");
}

function roofPatchBadgeAnchor(patch: SolarScene3D["roofModel"]["roofPlanePatches"][number]): THREE.Vector3 | null {
  const c = patch.centroid;
  const n = patch.normal;
  if (
    !c ||
    !n ||
    !Number.isFinite(c.x) ||
    !Number.isFinite(c.y) ||
    !Number.isFinite(c.z) ||
    !Number.isFinite(n.x) ||
    !Number.isFinite(n.y) ||
    !Number.isFinite(n.z)
  ) {
    return null;
  }
  return new THREE.Vector3(c.x + n.x * 0.18, c.y + n.y * 0.18, c.z + n.z * 0.18);
}

export function RoofTruthBadgesProjector({
  scene,
  enabled,
  onProjected,
}: {
  readonly scene: SolarScene3D;
  readonly enabled: boolean;
  readonly onProjected: (badges: RoofTruthBadgeScreenModel[]) => void;
}) {
  const { camera, gl } = useThree();
  const lastSigRef = useRef("");
  const projectionAccRef = useRef(0);

  useEffect(() => {
    if (!enabled) onProjected([]);
  }, [enabled, onProjected]);

  useFrame((_, delta) => {
    if (!enabled) {
      if (lastSigRef.current !== "empty") {
        lastSigRef.current = "empty";
        onProjected([]);
      }
      return;
    }
    projectionAccRef.current += delta;
    if (projectionAccRef.current < 0.1) return;
    projectionAccRef.current = 0;
    const rect = gl.domElement.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const badges: RoofTruthBadgeScreenModel[] = scene.roofModel.roofPlanePatches.flatMap((patch) => {
      const anchor = roofPatchBadgeAnchor(patch);
      if (!anchor) return [];
      const projected = anchor.clone().project(camera);
      if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !Number.isFinite(projected.z)) return [];
      const x = ((projected.x + 1) / 2) * width;
      const y = ((-projected.y + 1) / 2) * height;
      const badge = resolveRoofTruthBadge(scene, patch);
      const visible =
        projected.z >= -1 &&
        projected.z <= 1 &&
        x >= -36 &&
        y >= -18 &&
        x <= width + 36 &&
        y <= height + 18;
      return [{ ...badge, x, y, visible }];
    });
    const sig = roofTruthBadgesSignature(badges);
    if (sig !== lastSigRef.current) {
      lastSigRef.current = sig;
      onProjected(badges);
    }
  });

  return null;
}

export function RoofTruthBadgesOverlay({
  badges,
  visible,
}: {
  readonly badges: readonly RoofTruthBadgeScreenModel[];
  readonly visible: boolean;
}) {
  if (!visible || badges.length === 0) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="roof-truth-badges-overlay"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 6,
        pointerEvents: "none",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {badges.filter((b) => b.visible).map((b) => {
        const tokens = ROOF_TRUTH_BADGE_TOKENS[b.tone];
        return (
          <div
            key={b.panId}
            data-testid={`roof-truth-badge-${b.panId}`}
            data-roof-truth={b.truthClass}
            title={b.title}
            style={{
              position: "absolute",
              left: b.x,
              top: b.y,
              transform: "translate(-50%, -50%)",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              height: 22,
              maxWidth: 112,
              padding: "0 8px",
              borderRadius: 999,
              border: `1px solid ${tokens.border}`,
              background: tokens.background,
              color: tokens.text,
              boxShadow: "0 8px 20px rgba(0,0,0,0.28)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              fontSize: 10,
              fontWeight: 700,
              lineHeight: "22px",
              letterSpacing: 0,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: tokens.dot,
                boxShadow: `0 0 0 2px ${tokens.border}`,
                flex: "0 0 auto",
              }}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function MissingHeightAlertsOverlay({
  alerts,
  visible,
}: {
  readonly alerts: readonly RoofMissingHeightAlert[];
  readonly visible: boolean;
}) {
  if (!visible || alerts.length === 0) return null;
  const defaultCount = alerts.filter((a) => a.kind === "default").length;
  const averageCount = alerts.length - defaultCount;
  return (
    <div data-testid="missing-height-alerts-3d" role="status" aria-label="Alertes hauteur manquante" style={{
      position: "absolute",
      left: 10,
      bottom: 10,
      zIndex: 7,
      width: "min(360px, calc(100% - 20px))",
      padding: "10px 12px",
      borderRadius: 8,
      border: "1px solid rgba(245,158,11,0.28)",
      background: "rgba(24, 20, 14, 0.82)",
      color: "rgba(255,251,235,0.95)",
      boxShadow: "0 12px 28px rgba(0,0,0,0.28)",
      backdropFilter: "blur(10px)",
      WebkitBackdropFilter: "blur(10px)",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      pointerEvents: "none",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: defaultCount > 0 ? "#f59e0b" : "#38bdf8",
          boxShadow: "0 0 0 3px rgba(245,158,11,0.16)",
          flex: "0 0 auto",
        }} />
        <div style={{ fontSize: 12, fontWeight: 800, lineHeight: "16px", letterSpacing: 0 }}>
          Hauteurs a completer
        </div>
        <div style={{ marginLeft: "auto", fontSize: 10, lineHeight: "16px", color: "rgba(254,243,199,0.72)", whiteSpace: "nowrap" }}>
          {alerts.length} pan{alerts.length > 1 ? "s" : ""}
        </div>
      </div>
      <div style={{ marginTop: 5, fontSize: 11, lineHeight: "15px", color: "rgba(254,243,199,0.78)" }}>
        {defaultCount > 0 ? `${defaultCount} par defaut` : null}
        {defaultCount > 0 && averageCount > 0 ? " · " : null}
        {averageCount > 0 ? `${averageCount} moyenne/deduite` : null}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
        {alerts.slice(0, 8).map((alert) => (
          <span
            key={`${alert.panId}-${alert.kind}`}
            data-testid={`missing-height-alert-pan-${alert.panId}`}
            title={alert.detail}
            style={{
              maxWidth: 110,
              padding: "3px 6px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.10)",
              fontSize: 10,
              lineHeight: "12px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            Pan {alert.panId} · {alert.kind === "default" ? "defaut" : "moyenne"}
          </span>
        ))}
        {alerts.length > 8 ? (
          <span style={{ fontSize: 10, lineHeight: "18px", opacity: 0.72 }}>+{alerts.length - 8}</span>
        ) : null}
      </div>
    </div>
  );
}

export function MultiPanDiagnosticsOverlay({
  scene,
  visible,
}: {
  readonly scene: SolarScene3D;
  readonly visible: boolean;
}) {
  const diag = scene.metadata.roofMultiPanDiagnostics;
  if (!visible || !diag || diag.relationCount === 0) return null;
  const blocking = !diag.okForPvLayout;
  const tone = blocking
    ? { border: "rgba(248,113,113,0.35)", bg: "rgba(35, 18, 18, 0.84)", dot: "#ef4444", text: "rgba(254,242,242,0.96)" }
    : { border: "rgba(34,197,94,0.28)", bg: "rgba(12, 32, 25, 0.78)", dot: "#22c55e", text: "rgba(220,252,231,0.94)" };
  const items = diag.items.filter((i) => i.severity !== "info").slice(0, 4);
  return (
    <div data-testid="multi-pan-diagnostics-3d" role="status" aria-label="Diagnostic multi-pans" style={{
      position: "absolute",
      left: 10,
      top: 10,
      zIndex: 7,
      width: "min(380px, calc(100% - 20px))",
      padding: "10px 12px",
      borderRadius: 8,
      border: `1px solid ${tone.border}`,
      background: tone.bg,
      color: tone.text,
      boxShadow: "0 12px 28px rgba(0,0,0,0.28)",
      backdropFilter: "blur(10px)",
      WebkitBackdropFilter: "blur(10px)",
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      pointerEvents: "none",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: tone.dot, boxShadow: `0 0 0 3px ${tone.border}`, flex: "0 0 auto" }} />
        <div style={{ fontSize: 12, fontWeight: 800, lineHeight: "16px", letterSpacing: 0 }}>
          Multi-pans {blocking ? "a verifier" : "OK"}
        </div>
        <div style={{ marginLeft: "auto", fontSize: 10, lineHeight: "16px", opacity: 0.72, whiteSpace: "nowrap" }}>
          {diag.relationCount} jonction{diag.relationCount > 1 ? "s" : ""}
        </div>
      </div>
      <div style={{ marginTop: 5, fontSize: 11, lineHeight: "15px", opacity: 0.78 }}>
        {diag.summaryFr}
      </div>
      {items.length > 0 ? (
        <div style={{ display: "grid", gap: 5, marginTop: 8 }}>
          {items.map((item) => (
            <div key={`${item.edgeId}-${item.kind}-${item.panIds.join("-")}`} title={item.codes.join(", ")} style={{
              display: "flex",
              gap: 7,
              alignItems: "flex-start",
              padding: "6px 7px",
              borderRadius: 6,
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.08)",
              fontSize: 10,
              lineHeight: "14px",
            }}>
              <span style={{ fontWeight: 800, color: item.severity === "error" ? "#fecaca" : "#fde68a" }}>
                {item.panIds.join(" / ")}
              </span>
              <span style={{ opacity: 0.82 }}>{item.messageFr}</span>
            </div>
          ))}
          {diag.items.filter((i) => i.severity !== "info").length > items.length ? (
            <div style={{ fontSize: 10, lineHeight: "14px", opacity: 0.62, paddingLeft: 2 }}>
              +{diag.items.filter((i) => i.severity !== "info").length - items.length} autre(s) jonction(s)
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
