/**
 * Overlay puissance totale installée — coin supérieur droit du viewer.
 *
 * Composant HTML pur (pas de R3F) positionné en CSS absolute sur le wrapper du viewer.
 * Masqué automatiquement quand aucun panneau n'est posé (panelCount === 0).
 *
 * `totalPowerWc` et `panelCount` sont calculés dans SolarScene3DViewer via useMemo
 * sur `scene.pvPanels` — mis à jour en temps réel à chaque ajout / suppression.
 */

// ── Types publics ─────────────────────────────────────────────────────────────

export interface PowerIndicatorProps {
  readonly totalPowerWc: number;
  readonly panelCount: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Formate la puissance en kWc avec une décimale, séparateur FR ("," + espace insécable). */
function formatKwc(totalWc: number): string {
  const kWc = totalWc / 1000;
  return kWc.toLocaleString("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function PowerIndicator3D({ totalPowerWc, panelCount }: PowerIndicatorProps) {
  if (panelCount === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Puissance installée : ${formatKwc(totalPowerWc)} kilowatts-crête pour ${panelCount} panneau${panelCount > 1 ? "x" : ""}`}
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
      <span style={{ color: "#93c5fd" }}>
        {formatKwc(totalPowerWc)}&nbsp;kWc
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
