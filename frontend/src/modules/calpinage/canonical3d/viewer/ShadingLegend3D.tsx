/**
 * Légende discrète — lecture qualitative, pas échelle technique.
 */

import type { CSSProperties } from "react";
import type { PanelVisualShadingSummary } from "../types/panelVisualShading";

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
  readonly summary?: PanelVisualShadingSummary | null;
}

function pctFr(value: number | null): string {
  if (value == null) return "-";
  return `${value.toLocaleString("fr-FR", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 1,
  })} %`;
}

function summaryRows(summary: PanelVisualShadingSummary | null | undefined): Array<[string, string]> {
  if (!summary) return [];
  const rows: Array<[string, string]> = [["Perte totale", pctFr(summary.totalLossPct)]];
  rows.push(["Proche", pctFr(summary.nearLossPct)]);
  rows.push(["Lointain", pctFr(summary.farLossPct)]);
  if (summary.panelCount != null) rows.push(["Panneaux", String(summary.panelCount)]);
  return rows;
}

export function ShadingLegend3D({ mode, summary }: ShadingLegend3DProps) {
  const rows = summaryRows(summary);
  if (mode === "unavailable") {
    return (
      <div style={wrap} data-testid="shading-legend-3d">
        <div style={{ fontWeight: 600, letterSpacing: "0.02em", opacity: 0.95 }}>Ombrage</div>
        <div style={{ marginTop: 4, opacity: 0.75 }}>
          {summary?.blockingReason ? "Calcul ombrage indisponible." : "Lecture shading non disponible pour ce dossier."}
        </div>
        {rows.length > 0 && (
          <div style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 7 }}>
            {rows.map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span style={{ opacity: 0.75 }}>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={wrap} data-testid="shading-legend-3d">
      {rows.length > 0 && (
        <div style={{ marginBottom: 9, borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: 8 }}>
          <div style={{ fontWeight: 600, letterSpacing: "0.02em", opacity: 0.95 }}>Resultat ombrage</div>
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 4 }}>
              <span style={{ opacity: 0.75 }}>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      )}
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
