/**
 * P4 — Graphique premium production annuelle
 * Courbes Catmull-Rom → Bézier, gradients, rendu haut de gamme.
 * Production solaire, consommation, énergie utilisée directement, batterie (si > 0).
 */

import React, { useMemo } from "react";

const MONTHS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Aoû", "Sep", "Oct", "Nov", "Déc"];

function catmullRom2bezier(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x},${pts[0].y}`;
  const H = 600;
  const PAD_B = 55;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

interface ChartP4ProductionProps {
  production: number[];
  consommation: number[];
  autoconso: number[];
  batterie?: number[];
}

export default function ChartP4Production({
  production,
  consommation,
  autoconso,
  batterie = [],
}: ChartP4ProductionProps) {
  const rows = useMemo(() => {
    const prod = production.length >= 12 ? production : [...production, ...Array(12 - production.length).fill(0)];
    const conso = consommation.length >= 12 ? consommation : [...consommation, ...Array(12 - consommation.length).fill(0)];
    const auto = autoconso.length >= 12 ? autoconso : [...autoconso, ...Array(12 - autoconso.length).fill(0)];
    const batt = batterie.length >= 12 ? batterie : [...batterie, ...Array(12 - batterie.length).fill(0)];
    return prod.map((p, i) => ({
      prod: Number(p) || 0,
      conso: Number(conso[i]) || 0,
      auto: Number(auto[i]) || 0,
      batt: Number(batt[i]) || 0,
    }));
  }, [production, consommation, autoconso, batterie]);

  const PADDING_LEFT = 85;
  const PADDING_RIGHT = 55;
  const W = 2200;
  const H = 600;
  const PAD_B = 55;
  const PAD_T = 15;
  const chartWidth = W - PADDING_LEFT - PADDING_RIGHT;

  const { maxY, scaleX, paths, hasBatt } = useMemo(() => {
    const max = Math.max(
      1,
      ...rows.map((r) => Math.max(r.prod, r.conso, r.auto, r.batt))
    );
    const scaleXFn = (i: number) =>
      PADDING_LEFT + (i * chartWidth) / (MONTHS.length - 1);
    const scaleYFn = (v: number) =>
      H - PAD_B - (v / max) * (H - PAD_T - PAD_B);

    const toPoints = (key: "prod" | "conso" | "auto" | "batt") =>
      rows.map((r, i) => ({ x: scaleXFn(i), y: scaleYFn(r[key] || 0) }));

    const consoPts = toPoints("conso");
    const prodPts = toPoints("prod");
    const autoPts = toPoints("auto");
    const battPts = toPoints("batt");

    const dConso = catmullRom2bezier(consoPts);
    const dProd = catmullRom2bezier(prodPts);
    const dAuto = catmullRom2bezier(autoPts);
    const dBatt = catmullRom2bezier(battPts);

    const dArea = (d: string, pts: { x: number; y: number }[]) => {
      if (pts.length === 0) return "";
      const first = pts[0];
      const last = pts[pts.length - 1];
      return `${d} L ${last.x},${H - PAD_B} L ${first.x},${H - PAD_B} Z`;
    };

    return {
      maxY: max,
      scaleX: scaleXFn,
      paths: {
        conso: { d: dConso, area: dArea(dConso, consoPts) },
        prod: { d: dProd, area: dArea(dProd, prodPts) },
        auto: { d: dAuto, area: dArea(dAuto, autoPts) },
        batt: { d: dBatt, area: dArea(dBatt, battPts) },
      },
      hasBatt: rows.some((r) => r.batt > 0),
    };
  }, [rows]);

  return (
    <svg
      id="p4-chart"
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "100%", display: "block" }}
      aria-label="Graphique production et consommation annuelles"
    >
      <defs>
        <linearGradient id="p4-grad-prod" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F9D27C" />
          <stop offset="100%" stopColor="#E6B653" />
        </linearGradient>
        <linearGradient id="p4-grad-prod-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C29226" stopOpacity={0.55} />
          <stop offset="100%" stopColor="#C29226" stopOpacity={0} />
        </linearGradient>
        <linearGradient id="p4-grad-conso" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3E4D82" />
          <stop offset="100%" stopColor="#1B2A59" />
        </linearGradient>
        <linearGradient id="p4-grad-conso-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1B2A59" stopOpacity={0.5} />
          <stop offset="100%" stopColor="#1B2A59" stopOpacity={0} />
        </linearGradient>
        <linearGradient id="p4-grad-auto" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4FD1DF" />
          <stop offset="100%" stopColor="#0091A4" />
        </linearGradient>
        <linearGradient id="p4-grad-auto-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0091A4" stopOpacity={0.5} />
          <stop offset="100%" stopColor="#0091A4" stopOpacity={0} />
        </linearGradient>
        <linearGradient id="p4-grad-batt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#55E6A8" />
          <stop offset="100%" stopColor="#1EC27A" />
        </linearGradient>
        <linearGradient id="p4-grad-batt-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1EC27A" stopOpacity={0.5} />
          <stop offset="100%" stopColor="#1EC27A" stopOpacity={0} />
        </linearGradient>
        <filter id="p4-soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={12} result="blur" />
          <feOffset dy={4} result="offsetBlur" />
          <feBlend in="SourceGraphic" in2="offsetBlur" mode="normal" />
        </filter>
      </defs>

      {/* Grille */}
      {[0, 1, 2, 3, 4, 5, 6].map((t) => {
        const v = (maxY * t) / 6;
        const y = H - PAD_B - (v / maxY) * (H - PAD_T - PAD_B);
        return (
          <g key={t}>
            <line
              x1={PADDING_LEFT}
              x2={W - PADDING_RIGHT}
              y1={y}
              y2={y}
              stroke="rgba(0,0,0,.07)"
            />
            <text
              x={PADDING_LEFT - 8}
              y={y + 4}
              textAnchor="end"
              fill="#555"
              fontSize={13}
              fontWeight={600}
            >
              {Math.round(v)}
            </text>
          </g>
        );
      })}

      {/* Axe X */}
      <line
        x1={PADDING_LEFT}
        y1={H - PAD_B}
        x2={W - PADDING_RIGHT}
        y2={H - PAD_B}
        stroke="#999"
      />

      {/* Labels mois */}
      {MONTHS.map((m, i) => (
        <text
          key={m}
          x={scaleX(i)}
          y={H - 20}
          textAnchor="middle"
          fill="#222"
          fontSize={14}
          fontWeight={700}
        >
          {m}
        </text>
      ))}

      {/* Courbes + zones */}
      {paths.conso.d && (
        <>
          <path d={paths.conso.area} fill="url(#p4-grad-conso-area)" opacity={1} />
          <path
            d={paths.conso.d}
            fill="none"
            stroke="url(#p4-grad-conso)"
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#p4-soft-shadow)"
          />
        </>
      )}
      {paths.prod.d && (
        <>
          <path d={paths.prod.area} fill="url(#p4-grad-prod-area)" opacity={1} />
          <path
            d={paths.prod.d}
            fill="none"
            stroke="url(#p4-grad-prod)"
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#p4-soft-shadow)"
          />
        </>
      )}
      {paths.auto.d && rows.some((r) => r.auto > 0) && (
        <>
          <path d={paths.auto.area} fill="url(#p4-grad-auto-area)" opacity={1} />
          <path
            d={paths.auto.d}
            fill="none"
            stroke="url(#p4-grad-auto)"
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#p4-soft-shadow)"
          />
        </>
      )}
      {hasBatt && paths.batt.d && (
        <>
          <path d={paths.batt.area} fill="url(#p4-grad-batt-area)" opacity={1} />
          <path
            d={paths.batt.d}
            fill="none"
            stroke="url(#p4-grad-batt)"
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#p4-soft-shadow)"
          />
        </>
      )}
    </svg>
  );
}
