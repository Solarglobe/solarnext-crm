/**
 * Légende discrète — lecture qualitative, pas échelle technique.
 */

import type { CSSProperties } from "react";

const wrap: CSSProperties = {
  position: "absolute",
  right: 10,
  bottom: 10,
  zIndex: 2,
  padding: "10px 12px",
  borderRadius: 8,
  background: "rgba(18, 21, 28, 0.72)",
  backdropFilter: "blur(8px)",
  border: "1px solid rgba(255,255,255,0.08)",
  fontSize: 11,
  lineHeight: 1.45,
  color: "rgba(248, 250, 252, 0.88)",
  maxWidth: 200,
  pointerEvents: "none",
  fontFamily: "system-ui, sans-serif",
};

const row = (opts?: { first?: boolean }): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginTop: opts?.first ? 8 : 6,
});

const dotStyle = (hex: string): CSSProperties => ({
  width: 10,
  height: 10,
  borderRadius: 2,
  background: hex,
  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
  flexShrink: 0,
});

export interface ShadingLegend3DProps {
  readonly mode: "active" | "unavailable";
}

export function ShadingLegend3D({ mode }: ShadingLegend3DProps) {
  if (mode === "unavailable") {
    return (
      <div style={wrap} data-testid="shading-legend-3d">
        <div style={{ fontWeight: 600, letterSpacing: "0.02em", opacity: 0.95 }}>Ombrage</div>
        <div style={{ marginTop: 4, opacity: 0.75 }}>Lecture shading non disponible pour ce dossier.</div>
      </div>
    );
  }

  return (
    <div style={wrap} data-testid="shading-legend-3d">
      <div style={{ fontWeight: 600, letterSpacing: "0.02em", opacity: 0.95 }}>Ensoleillement relatif</div>
      <div style={row({ first: true })}>
        <span style={dotStyle("#d6c28a")} />
        Très favorable
      </div>
      <div style={row()}>
        <span style={dotStyle("#b88c45")} />
        Correct
      </div>
      <div style={row()}>
        <span style={dotStyle("#7a4e2e")} />
        À surveiller
      </div>
      <div style={row()}>
        <span style={dotStyle("#6b7280")} />
        Donnée indisponible
      </div>
    </div>
  );
}
