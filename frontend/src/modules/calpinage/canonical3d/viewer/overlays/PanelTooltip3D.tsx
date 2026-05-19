/**
 * Tooltip HTML flottant sur un panneau PV survolé — @react-three/drei Html.
 *
 * Affiché uniquement quand `panelId !== null`. Positionné au centre 3D du panneau
 * (worldPosition), légèrement au-dessus de la surface (+0.15 m selon la normale).
 *
 * Tilt et azimut calculés depuis `outwardNormal` (convention SolarNext : X=Est, Y=Nord, Z=Up).
 * Puissance estimée à 215 Wc/m² (monocristallin standard) — pas de logique métier externe.
 */

import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { PvPanelSurface3D } from "../../types/pv-panel-3d";

// ── Types publics ─────────────────────────────────────────────────────────────

export interface PanelTooltipProps {
  /** null = tooltip masqué */
  readonly panelId: string | null;
  readonly panel: PvPanelSurface3D | null;
  readonly worldPosition: THREE.Vector3 | null;
}

// ── Helpers géométriques ──────────────────────────────────────────────────────

/** Inclinaison depuis l'horizontale (0° = toit plat, 90° = vertical). */
function computeTiltDeg(n: { x: number; y: number; z: number }): number {
  // Convention Z=Up : tilt = angle entre la normale et Z (zenith)
  const clampedZ = Math.max(-1, Math.min(1, n.z));
  return Math.round(Math.acos(clampedZ) * 180 / Math.PI);
}

/**
 * Azimut météo (0=Nord, 90=Est, 180=Sud, 270=Ouest).
 * Projection de la normale sur le plan XY, puis atan2(x, y).
 */
function computeAzimuthDeg(n: { x: number; y: number; z: number }): number {
  const azRad = Math.atan2(n.x, n.y); // atan2(Est, Nord)
  return Math.round(((azRad * 180 / Math.PI) + 360) % 360);
}

/** Estimation puissance crête : mono-Si 215 Wc/m² × surface réelle. */
function estimatePanelPowerWc(panel: PvPanelSurface3D): number {
  return Math.round(panel.widthM * panel.heightM * 215);
}

/** Tronque l'ID pour affichage (max 8 caractères, ellipsis si trop long). */
function formatPanelId(id: string): string {
  return id.length > 8 ? `…${id.slice(-7)}` : id;
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function PanelTooltip3D({ panelId, panel, worldPosition }: PanelTooltipProps) {
  if (!panelId || !panel || !worldPosition) return null;

  const tiltDeg     = computeTiltDeg(panel.outwardNormal);
  const azimuthDeg  = computeAzimuthDeg(panel.outwardNormal);
  const powerWc     = estimatePanelPowerWc(panel);

  // Légèrement surélevé au-dessus de la surface
  const pos: [number, number, number] = [
    worldPosition.x + panel.outwardNormal.x * 0.18,
    worldPosition.y + panel.outwardNormal.y * 0.18,
    worldPosition.z + panel.outwardNormal.z * 0.18,
  ];

  return (
    <Html
      position={pos}
      style={{ pointerEvents: "none" }}
      center
      zIndexRange={[200, 300]}
      occlude={false}
    >
      <div
        style={{
          background: "rgba(9, 13, 21, 0.90)",
          border: "1px solid rgba(255, 255, 255, 0.13)",
          borderRadius: 7,
          padding: "7px 11px",
          color: "#e2e8f0",
          fontSize: 12,
          fontFamily: "system-ui, -apple-system, sans-serif",
          whiteSpace: "nowrap",
          boxShadow: "0 4px 18px rgba(0, 0, 0, 0.48)",
          backdropFilter: "blur(8px)",
          lineHeight: 1.6,
          minWidth: 148,
          userSelect: "none",
        }}
      >
        {/* En-tête ID */}
        <div style={{ color: "#7b8fb0", fontSize: 10, letterSpacing: "0.05em", marginBottom: 4 }}>
          Panneau {formatPanelId(panelId)}
        </div>

        {/* Puissance — valeur principale */}
        <div
          style={{
            fontWeight: 700,
            fontSize: 15,
            color: "#93c5fd",
            marginBottom: 5,
            letterSpacing: "-0.01em",
          }}
        >
          {powerWc.toLocaleString("fr-FR")} Wc
        </div>

        {/* Grille inclinaison / azimut */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            columnGap: 10,
            rowGap: 2,
            fontSize: 11,
          }}
        >
          <span style={{ color: "#7b8fb0" }}>Inclinaison</span>
          <span style={{ color: "#cbd5e1" }}>{tiltDeg}°</span>
          <span style={{ color: "#7b8fb0" }}>Azimut</span>
          <span style={{ color: "#cbd5e1" }}>{azimuthDeg}°</span>
        </div>
      </div>
    </Html>
  );
}
