/**
 * ChartShadingMonthly — Barres empilées far/near par mois + ligne combined
 * SVG pur, thème sombre SolarNext. Sprint 2.
 *
 * Données : monthlyFactors[12] { month, farPct, nearPct, combinedPct }
 * Far    : #C39847 (gold) — horizon lointain
 * Near   : #4A90E2 (bleu) — masques proches
 * Combined line : #E8ECF8 (blanc cassé) — tirets fins
 */

import { useMemo } from "react";

const MONTHS_SHORT = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jui", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];

export interface ShadingMonthlyFactor {
  month:       number;   // 1-12
  farPct:      number;   // % perte horizon lointain
  nearPct:     number;   // % perte masques proches
  combinedPct: number;   // % perte totale combinée
}

interface ChartShadingMonthlyProps {
  data: ShadingMonthlyFactor[] | null | undefined;
}

// ── Layout SVG ──────────────────────────────────────────────────────────────
const VW        = 560;   // viewBox width
const VH        = 260;   // viewBox height
const PAD_L     = 34;    // axe Y
const PAD_R     = 10;
const PAD_T     = 14;    // espace en haut
const PAD_B     = 28;    // labels mois
const CHART_W   = VW - PAD_L - PAD_R;
const CHART_H   = VH - PAD_T - PAD_B;
const BAR_GAP   = 0.35;  // fraction de la largeur barre réservée à l'espacement

const COLOR_FAR      = "#C39847";
const COLOR_NEAR     = "#4A90E2";
const COLOR_LINE     = "#E8ECF8";
const COLOR_GRID     = "rgba(255,255,255,0.07)";
const COLOR_LABEL    = "#9FA8C7";
const COLOR_ZERO     = "rgba(255,255,255,0.15)";

export default function ChartShadingMonthly({ data }: ChartShadingMonthlyProps) {

  const sorted = useMemo(() => {
    if (!Array.isArray(data) || data.length === 0) return null;
    const arr = [...data].sort((a, b) => a.month - b.month);
    // S'assurer qu'on a 12 mois
    if (arr.length < 12) return null;
    return arr;
  }, [data]);

  // ── Pas de données ────────────────────────────────────────────────────────
  if (!sorted) {
    return (
      <div style={{
        width: "100%", height: "100%",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 4,
      }}>
        <div style={{ fontSize: "10pt", color: "#9FA8C7", fontWeight: 500 }}>Pertes mensuelles</div>
        <div style={{ fontSize: "8pt", color: "#9FA8C7", opacity: 0.5 }}>Données non disponibles</div>
      </div>
    );
  }

  // ── Calculs géométrie ─────────────────────────────────────────────────────
  const maxPct = useMemo(() => {
    const m = Math.max(...sorted.map((d) => d.combinedPct));
    // Arrondir au 5% supérieur, minimum 5
    return Math.max(5, Math.ceil(m / 5) * 5);
  }, [sorted]);

  const N         = 12;
  const slotW     = CHART_W / N;
  const barW      = slotW * (1 - BAR_GAP);
  const barOffset = slotW * BAR_GAP / 2;

  function xBar(i: number): number {
    return PAD_L + i * slotW + barOffset;
  }

  function yFromPct(pct: number): number {
    return PAD_T + CHART_H - (pct / maxPct) * CHART_H;
  }

  function hFromPct(pct: number): number {
    return (pct / maxPct) * CHART_H;
  }

  // Points pour la ligne combined (centre de chaque barre, top)
  const combinedPts = sorted.map((d, i) => ({
    x: xBar(i) + barW / 2,
    y: yFromPct(d.combinedPct),
  }));
  const combinedLine = combinedPts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  // Graduations Y : 0, max/2, max
  const yTicks = [0, maxPct / 2, maxPct];

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        style={{ width: "100%", flex: 1, display: "block", overflow: "visible" }}
        aria-label="Pertes d'ombrage mensuelles"
      >
        <defs>
          {/* Gradient far */}
          <linearGradient id="csm-grad-far" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#D4AC5A" />
            <stop offset="100%" stopColor="#B08530" />
          </linearGradient>
          {/* Gradient near */}
          <linearGradient id="csm-grad-near" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5FA8F5" />
            <stop offset="100%" stopColor="#2D6FC8" />
          </linearGradient>
        </defs>

        {/* ── Grille horizontale ── */}
        {yTicks.map((v, ti) => {
          const y = yFromPct(v);
          return (
            <g key={ti}>
              <line
                x1={PAD_L} x2={VW - PAD_R}
                y1={y} y2={y}
                stroke={ti === 0 ? COLOR_ZERO : COLOR_GRID}
                strokeWidth={0.8}
                strokeDasharray={ti === 0 ? undefined : "3,3"}
              />
              <text
                x={PAD_L - 3} y={y + 3.5}
                textAnchor="end"
                fill={COLOR_LABEL}
                fontSize={8}
              >
                {v % 1 === 0 ? `${v}%` : `${v.toFixed(1)}%`}
              </text>
            </g>
          );
        })}

        {/* ── Barres empilées far (bas) + near (haut) ── */}
        {sorted.map((d, i) => {
          const x   = xBar(i);
          const hF  = hFromPct(d.farPct);
          const hN  = hFromPct(d.nearPct);
          const yF  = yFromPct(d.farPct);            // base far = baseline
          const yN  = yF - hN;                        // near empilé au-dessus

          return (
            <g key={d.month}>
              {/* Segment far (horizon lointain) */}
              {hF > 0.5 && (
                <rect
                  x={x} y={yF}
                  width={barW} height={hF}
                  fill="url(#csm-grad-far)"
                  opacity={0.88}
                  rx={1.5}
                />
              )}
              {/* Segment near (masques proches) */}
              {hN > 0.5 && (
                <rect
                  x={x} y={yN}
                  width={barW} height={hN}
                  fill="url(#csm-grad-near)"
                  opacity={0.88}
                  rx={1.5}
                />
              )}
              {/* Valeur combined en haut de barre si barre assez haute */}
              {d.combinedPct >= (maxPct * 0.12) && (
                <text
                  x={x + barW / 2}
                  y={yFromPct(d.combinedPct) - 3}
                  textAnchor="middle"
                  fill={COLOR_LINE}
                  fontSize={7}
                  fontWeight={500}
                  opacity={0.8}
                >
                  {d.combinedPct.toFixed(1)}%
                </text>
              )}
            </g>
          );
        })}

        {/* ── Ligne combined (tirets) ── */}
        <path
          d={combinedLine}
          fill="none"
          stroke={COLOR_LINE}
          strokeWidth={1.2}
          strokeDasharray="4,3"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.55}
        />
        {/* Points sur la ligne combined */}
        {combinedPts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={1.8} fill={COLOR_LINE} opacity={0.6} />
        ))}

        {/* ── Labels mois ── */}
        {sorted.map((d, i) => (
          <text
            key={d.month}
            x={xBar(i) + barW / 2}
            y={VH - 8}
            textAnchor="middle"
            fill={COLOR_LABEL}
            fontSize={8}
          >
            {MONTHS_SHORT[d.month - 1] ?? d.month}
          </text>
        ))}

        {/* ── Ligne de base ── */}
        <line
          x1={PAD_L} x2={VW - PAD_R}
          y1={PAD_T + CHART_H} y2={PAD_T + CHART_H}
          stroke={COLOR_ZERO}
          strokeWidth={1}
        />
      </svg>

      {/* ── Légende ── */}
      <div style={{ display: "flex", flexDirection: "row", gap: 14, justifyContent: "center", paddingBottom: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "7.5pt", color: COLOR_LABEL }}>
          <span style={{ width: 12, height: 8, background: COLOR_FAR, borderRadius: 2, display: "inline-block", opacity: 0.9 }} />
          Horizon lointain (far)
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "7.5pt", color: COLOR_LABEL }}>
          <span style={{ width: 12, height: 8, background: COLOR_NEAR, borderRadius: 2, display: "inline-block", opacity: 0.9 }} />
          Masques proches (near)
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "7.5pt", color: COLOR_LABEL }}>
          <span style={{ width: 18, height: 1.5, background: COLOR_LINE, display: "inline-block", opacity: 0.6, borderRadius: 1, verticalAlign: "middle" }} />
          Total combiné
        </div>
      </div>
    </div>
  );
}
