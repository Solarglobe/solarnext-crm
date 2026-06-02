/**
 * ChartHorizonProfile — Profil d'horizon du site (V1 Sprint 3)
 * SVG pur, thème sombre SolarNext.
 *
 * Affiche la courbe d'horizon réelle (masque terrain/bâti) du site.
 * V1 : courbe + zone remplie gold + axes azimut/élévation + repères cardinaux.
 * V2 (Sprint suivant) : trajectoires solaires solstices/équinoxe.
 *
 * Convention azimut : index 0 = 0° (Nord), chaque pas = 2°, 180 valeurs = 360°.
 * Élévation : degrés au-dessus de l'horizontale.
 */

import { useMemo } from "react";

export interface ChartHorizonProfileProps {
  /** Masque horizon : 180 valeurs d'élévation (°), index i → azimut i*2° */
  horizonMaskArray: number[] | null | undefined;
}

// ── Layout SVG ──────────────────────────────────────────────────────────────
const VW      = 270;
const VH      = 210;
const PAD_L   = 26;   // axe Y (élévation)
const PAD_R   = 6;
const PAD_T   = 10;
const PAD_B   = 24;   // labels azimut
const CW      = VW - PAD_L - PAD_R;   // 238
const CH      = VH - PAD_T - PAD_B;   // 176

// Couleurs
const C_FILL_STOP0 = "#C39847";  // gold opaque en haut
const C_FILL_STOP1 = "#C39847";  // gold transparent en bas
const C_STROKE     = "#D4AC5A";
const C_GRID       = "rgba(255,255,255,0.07)";
const C_CARDINAL   = "rgba(255,255,255,0.20)";
const C_LABEL      = "#9FA8C7";
const C_BASE       = "rgba(255,255,255,0.15)";

// Cardinaux : azimut → label
const CARDINALS: Array<{ az: number; label: string }> = [
  { az: 0,   label: "N" },
  { az: 90,  label: "E" },
  { az: 180, label: "S" },
  { az: 270, label: "O" },
  { az: 360, label: "N" },
];

function xFromAz(az: number): number {
  return PAD_L + (az / 360) * CW;
}

function yFromEl(el: number, maxEl: number): number {
  return PAD_T + CH - Math.max(0, el / maxEl) * CH;
}

export default function ChartHorizonProfile({ horizonMaskArray }: ChartHorizonProfileProps) {
  // ── Données absentes ────────────────────────────────────────────────────
  const hasData = Array.isArray(horizonMaskArray) && horizonMaskArray.length >= 2;

  const { maxEl, pathD, areaD } = useMemo(() => {
    if (!hasData || !horizonMaskArray) {
      return { maxEl: 30, pathD: "", areaD: "" };
    }

    // Normaliser à 180 points (un par 2°)
    // Si moins de 180 valeurs, on interpole linéairement
    const n = horizonMaskArray.length;
    const pts: Array<{ x: number; y: number; el: number }> = [];

    // Calculer le max d'élévation pour calibrer l'axe Y
    const rawMax = Math.max(...horizonMaskArray.filter(Number.isFinite));
    // Arrondir au 5° supérieur, minimum 15°
    const mEl = Math.max(15, Math.ceil((rawMax + 2) / 5) * 5);

    for (let i = 0; i <= 180; i++) {
      const az = i * 2; // 0° à 360°
      // Interpoler si le tableau a moins de 181 valeurs
      const idx = (i / 180) * (n - 1);
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, n - 1);
      const t = idx - lo;
      const el = (horizonMaskArray[lo] ?? 0) * (1 - t) + (horizonMaskArray[hi] ?? 0) * t;
      const safeEl = Number.isFinite(el) ? Math.max(0, el) : 0;
      pts.push({ x: xFromAz(az), y: yFromEl(safeEl, mEl), el: safeEl });
    }

    // Chemin courbe (polyline lissée — lignes droites pour robustesse PDF)
    const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

    // Zone fermée (remplie sous la courbe)
    const baseline = PAD_T + CH;
    const area = `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${baseline} L${pts[0].x.toFixed(1)},${baseline} Z`;

    return { maxEl: mEl, pathD: linePath, areaD: area };
  }, [horizonMaskArray, hasData]);

  // ── Ticks Y (élévation) ─────────────────────────────────────────────────
  const yTicks = useMemo(() => {
    const step = maxEl <= 20 ? 5 : maxEl <= 40 ? 10 : 15;
    const ticks: number[] = [];
    for (let v = 0; v <= maxEl; v += step) ticks.push(v);
    return ticks;
  }, [maxEl]);

  // ── Rendu absence de données ─────────────────────────────────────────────
  if (!hasData) {
    return (
      <div style={{
        width: "100%", height: "100%",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 4,
      }}>
        <div style={{ fontSize: "10pt", color: "#9FA8C7", fontWeight: 500 }}>Profil horizon</div>
        <div style={{ fontSize: "8pt", color: "#9FA8C7", opacity: 0.5 }}>
          Données non disponibles pour ce site
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        style={{ width: "100%", flex: 1, display: "block", overflow: "visible" }}
        aria-label="Profil d'horizon du site"
      >
        <defs>
          <linearGradient id="chp-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={C_FILL_STOP0} stopOpacity={0.35} />
            <stop offset="100%" stopColor={C_FILL_STOP1} stopOpacity={0.06} />
          </linearGradient>
        </defs>

        {/* ── Lignes cardinales verticales (N, E, S, O) ── */}
        {CARDINALS.filter(c => c.az < 360).map(({ az, label }) => {
          const x = xFromAz(az);
          return (
            <g key={az}>
              <line
                x1={x} x2={x}
                y1={PAD_T} y2={PAD_T + CH}
                stroke={C_CARDINAL}
                strokeWidth={0.7}
                strokeDasharray="2,3"
              />
              <text
                x={x} y={PAD_T + CH + 14}
                textAnchor="middle"
                fill={C_LABEL}
                fontSize={8.5}
                fontWeight={600}
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* ── Grille Y (élévation) ── */}
        {yTicks.map((v) => {
          const y = yFromEl(v, maxEl);
          return (
            <g key={v}>
              <line
                x1={PAD_L} x2={VW - PAD_R}
                y1={y} y2={y}
                stroke={v === 0 ? C_BASE : C_GRID}
                strokeWidth={v === 0 ? 1 : 0.7}
                strokeDasharray={v === 0 ? undefined : "3,3"}
              />
              <text
                x={PAD_L - 3} y={y + 3}
                textAnchor="end"
                fill={C_LABEL}
                fontSize={7}
              >
                {v}°
              </text>
            </g>
          );
        })}

        {/* ── Zone remplie sous la courbe ── */}
        {areaD && (
          <path d={areaD} fill="url(#chp-fill)" />
        )}

        {/* ── Courbe horizon ── */}
        {pathD && (
          <path
            d={pathD}
            fill="none"
            stroke={C_STROKE}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* ── Labels azimut (degrés, intermédiaires discrets) ── */}
        {[45, 135, 225, 315].map((az) => (
          <text
            key={az}
            x={xFromAz(az)}
            y={PAD_T + CH + 14}
            textAnchor="middle"
            fill={C_LABEL}
            fontSize={6.5}
            opacity={0.6}
          >
            {az}°
          </text>
        ))}

        {/* ── Axe X label ── */}
        <text
          x={PAD_L + CW / 2}
          y={VH - 1}
          textAnchor="middle"
          fill={C_LABEL}
          fontSize={6.5}
          opacity={0.5}
        >
          Azimut (°)
        </text>

        {/* ── Axe Y label ── */}
        <text
          x={8}
          y={PAD_T + CH / 2}
          textAnchor="middle"
          fill={C_LABEL}
          fontSize={6.5}
          opacity={0.5}
          transform={`rotate(-90, 8, ${PAD_T + CH / 2})`}
        >
          Élév. (°)
        </text>
      </svg>

      {/* ── Légende ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        justifyContent: "center", paddingBottom: 2,
      }}>
        <span style={{
          width: 14, height: 8,
          background: "linear-gradient(to bottom, rgba(195,152,71,0.5), rgba(195,152,71,0.1))",
          border: `1px solid ${C_STROKE}`,
          borderRadius: 2,
          display: "inline-block",
        }} />
        <span style={{ fontSize: "7.5pt", color: C_LABEL }}>
          Horizon terrain / bâti
        </span>
      </div>
    </div>
  );
}
