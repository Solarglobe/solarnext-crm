/**
 * Panneau d’inspection technique — overlay discret, mode debug / contrôle qualité.
 */

import type { CSSProperties } from "react";
import type { SceneInspectionViewModel } from "./inspection/sceneInspectionTypes";

const panelStyle: CSSProperties = {
  position: "absolute",
  top: 10,
  right: 10,
  zIndex: 3,
  width: "min(320px, 42vw)",
  maxHeight: "min(70vh, 520px)",
  overflow: "auto",
  padding: "12px 14px",
  borderRadius: 10,
  background: "rgba(16, 19, 26, 0.88)",
  backdropFilter: "blur(10px)",
  border: "1px solid rgba(255,255,255,0.1)",
  boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: 12,
  lineHeight: 1.45,
  color: "rgba(248, 250, 252, 0.94)",
  pointerEvents: "auto",
};

const titleStyle: CSSProperties = {
  fontWeight: 600,
  letterSpacing: "0.03em",
  fontSize: 11,
  textTransform: "uppercase" as const,
  opacity: 0.85,
  marginBottom: 10,
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  paddingBottom: 8,
};

const rowLabel: CSSProperties = {
  color: "rgba(148, 163, 184, 0.95)",
  minWidth: 118,
  flexShrink: 0,
};

export interface SceneInspectionPanel3DProps {
  readonly model: SceneInspectionViewModel | null;
  readonly onDismiss?: () => void;
}

export function SceneInspectionPanel3D({ model, onDismiss }: SceneInspectionPanel3DProps) {
  return (
    <div style={panelStyle} data-testid="scene-inspection-panel-3d">
      {model == null ? (
        <>
          <div style={titleStyle}>Inspection</div>
          <div style={{ opacity: 0.75 }}>Aucune sélection</div>
          <div style={{ marginTop: 8, fontSize: 11, opacity: 0.55 }}>
            Cliquez un pan, un panneau ou un volume pour inspecter.
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
              borderBottom: "1px solid rgba(255,255,255,0.08)",
              paddingBottom: 8,
            }}
          >
            <div style={{ ...titleStyle, marginBottom: 0, borderBottom: "none", paddingBottom: 0, flex: 1 }}>{model.title}</div>
            {onDismiss != null && (
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Fermer l’inspection"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "inherit",
                  borderRadius: 6,
                  padding: "2px 8px",
                  fontSize: 11,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                Effacer
              </button>
            )}
          </div>
          <dl style={{ margin: 0 }}>
            {model.rows.map((r, idx) => (
              <div
                key={`${idx}-${r.label}`}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "5px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                <dt style={rowLabel}>{r.label}</dt>
                <dd style={{ margin: 0, flex: 1, wordBreak: "break-word" }}>{r.value}</dd>
              </div>
            ))}
          </dl>
          {model.warnings.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 11, opacity: 0.8, marginBottom: 6 }}>Alertes</div>
              <ul style={{ margin: 0, paddingLeft: 18, color: "rgba(251, 191, 36, 0.92)" }}>
                {model.warnings.map((w, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
