/**
 * Overlay puissance totale installée — coin supérieur droit du viewer.
 *
 * Composant HTML pur (pas de R3F) positionné en CSS absolute sur le wrapper du viewer.
 * Masqué automatiquement quand aucun panneau n'est posé (panelCount === 0).
 *
 * `totalPowerWc` et `panelCount` sont calculés dans SolarScene3DViewer depuis
 * la puissance catalogue/snapshot du module sélectionné, sans estimation locale.
 */

import { formatKwcFr } from "../../../power/installedPvPower";

// ── Types publics ─────────────────────────────────────────────────────────────

export interface PowerIndicatorProps {
  readonly totalPowerWc: number | null;
  readonly panelCount: number;
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function PowerIndicator3D({ totalPowerWc, panelCount }: PowerIndicatorProps) {
  if (panelCount === 0) return null;
  const hasPower = totalPowerWc != null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={
        hasPower
          ? `Puissance installée : ${formatKwcFr(totalPowerWc)} kilowatts-crête pour ${panelCount} panneau${panelCount > 1 ? "x" : ""}`
          : `Puissance installée indisponible pour ${panelCount} panneau${panelCount > 1 ? "x" : ""}`
      }
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        zIndex: 500,
        background: "rgba(9, 13, 21, 0.84)",
        border: "1px solid rgba(255, 255, 255, 0.11)",
        borderRadius: 8,
        padding: "6px 13px",
        display: "flex",
        alignItems: "center",
        gap: 0,
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: 13,
        fontWeight: 600,
        pointerEvents: "none",
        backdropFilter: "blur(10px)",
        boxShadow: "0 2px 14px rgba(0, 0, 0, 0.40)",
        userSelect: "none",
        letterSpacing: "-0.01em",
        lineHeight: 1,
      }}
    >
      {/* Puissance kWc */}
      <span style={{ color: hasPower ? "#93c5fd" : "#fbbf24" }}>
        {hasPower ? `${formatKwcFr(totalPowerWc)}\u00a0kWc` : "Puissance indisponible"}
      </span>

      {/* Séparateur */}
      <span style={{ color: "#3d4f6e", margin: "0 7px", fontWeight: 300, fontSize: 15 }}>—</span>

      {/* Nombre de panneaux */}
      <span style={{ color: "#94a3b8", fontWeight: 500 }}>
        {panelCount}&nbsp;panneau{panelCount > 1 ? "x" : ""}
      </span>
    </div>
  );
}
