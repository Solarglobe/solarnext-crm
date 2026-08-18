import type { ViewerReliabilityState } from "./viewerReliabilityState";

export function ViewerReliabilityOverlay({ reliability }: { readonly reliability: ViewerReliabilityState }) {
  if (reliability.kind === "ready") return null;
  const tone =
    reliability.kind === "invalid" || reliability.kind === "error"
      ? { border: "rgba(220,38,38,0.45)", bg: "rgba(127,29,29,0.88)", color: "#fee2e2" }
      : { border: "rgba(245,158,11,0.45)", bg: "rgba(120,53,15,0.88)", color: "#ffedd5" };
  return (
    <div
      role="status"
      data-testid="viewer-reliability-notice"
      data-reliability-kind={reliability.kind}
      data-scene-source={reliability.source}
      data-geometry-truth-status={reliability.geometryTruthStatus}
      style={{
        position: "absolute",
        top: 8,
        left: 8,
        zIndex: 1300,
        maxWidth: "min(460px, calc(100% - 16px))",
        padding: "9px 11px",
        borderRadius: 6,
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        color: tone.color,
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: 12,
        lineHeight: 1.4,
        boxShadow: "0 12px 28px rgba(0,0,0,0.28)",
        pointerEvents: "none",
      }}
    >
      <strong style={{ display: "block", fontSize: 12 }}>{reliability.userMessage}</strong>
      {reliability.stale && reliability.lastKnownGoodGeneration != null ? (
        <span style={{ display: "block", marginTop: 2, opacity: 0.9 }}>
          Dernière vue fiable affichée : génération {reliability.lastKnownGoodGeneration}.
        </span>
      ) : null}
    </div>
  );
}
