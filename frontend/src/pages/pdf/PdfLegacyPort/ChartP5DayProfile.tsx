/**
 * P5 — Journée type (kW) : même langage visuel que ChartP4Production (aires + splines premium).
 * Données : production_kw, consommation_kw, batterie_kw (24 points) ; autocons = min(prod, conso) / h.
 * Axe Y : un seul max(kW) pour toutes les séries — pas de double échelle ; courbes comparables à l’identique.
 */

import React, { useMemo } from "react";

const N = 24;

function catmullRom2bezier(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x},${pts[0].y}`;
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

interface ChartP5DayProfileProps {
  production_kw: number[];
  consommation_kw: number[];
  batterie_kw?: number[];
}

export default function ChartP5DayProfile({
  production_kw,
  consommation_kw,
  batterie_kw = [],
}: ChartP5DayProfileProps) {
  const rows = useMemo(() => {
    const pad = (arr: number[]) =>
      arr.length >= N ? arr.slice(0, N) : [...arr, ...Array(N - arr.length).fill(0)];
    const p = pad(production_kw.map((x) => Number(x) || 0));
    const c = pad(consommation_kw.map((x) => Number(x) || 0));
    const b = pad(batterie_kw.map((x) => Number(x) || 0));
    return p.map((prod, i) => {
      const conso = c[i] ?? 0;
      return {
        prod,
        conso,
        auto: Math.min(prod, conso),
        batt: b[i] ?? 0,
      };
    });
  }, [production_kw, consommation_kw, batterie_kw]);

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
      ...rows.map((r) => Math.max(r.prod, r.conso, r.auto, Math.abs(r.batt)))
    );
    const scaleXFn = (i: number) => PADDING_LEFT + (i * chartWidth) / (N - 1);
    const scaleYFn = (v: number) => H - PAD_B - (v / max) * (H - PAD_T - PAD_B);

    const toPoints = (key: "prod" | "conso" | "auto" | "batt") =>
      rows.map((r, i) => {
        const raw = key === "batt" ? Math.max(0, r.batt) : r[key] || 0;
        return { x: scaleXFn(i), y: scaleYFn(raw) };
      });

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
      hasBatt: rows.some((r) => Math.abs(r.batt) > 1e-9),
    };
  }, [rows]);

  return (
    <svg
      id="p5-chart"
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "100%", display: "block" }}
      aria-label="Graphique puissance journée type"
    >
      <defs>
        <linearGradient id="p5-grad-prod" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F9D27C" />
          <stop offset="100%" stopColor="#E6B653" />
        </linearGradient>
        <linearGradient id="p5-grad-prod-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C29226" stopOpacity={0.55} />
          <stop offset="100%" stopColor="#C29226" stopOpacity={0} />
        </linearGradient>
        <linearGradient id="p5-grad-conso" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3E4D82" />
          <stop offset="100%" stopColor="#1B2A59" />
        </linearGradient>
        <linearGradient id="p5-grad-conso-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1B2A59" stopOpacity={0.5} />
          <stop offset="100%" stopColor="#1B2A59" stopOpacity={0} />
        </linearGradient>
        <linearGradient id="p5-grad-auto" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4FD1DF" />
          <stop offset="100%" stopColor="#0091A4" />
        </linearGradient>
        <linearGradient id="p5-grad-auto-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0091A4" stopOpacity={0.5} />
          <stop offset="100%" stopColor="#0091A4" stopOpacity={0} />
        </linearGradient>
        <linearGradient id="p5-grad-batt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#55E6A8" />
          <stop offset="100%" stopColor="#1EC27A" />
        </linearGradient>
        <linearGradient id="p5-grad-batt-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1EC27A" stopOpacity={0.5} />
          <stop offset="100%" stopColor="#1EC27A" stopOpacity={0} />
        </linearGradient>
        <filter id="p5-soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={12} result="blur" />
          <feOffset dy={4} result="offsetBlur" />
          <feBlend in="SourceGraphic" in2="offsetBlur" mode="normal" />
        </filter>
      </defs>

      {[0, 1, 2, 3, 4, 5, 6].map((t) => {
        const v = (maxY * t) / 6;
        const y = H - PAD_B - (v / maxY) * (H - PAD_T - PAD_B);
        return (
          <g key={t}>
            <line x1={PADDING_LEFT} x2={W - PADDING_RIGHT} y1={y} y2={y} stroke="rgba(0,0,0,.07)" />
            <text x={PADDING_LEFT - 8} y={y + 4} textAnchor="end" fill="#555" fontSize={13} fontWeight={600}>
              {maxY >= 20 ? Math.round(v) : Number(v.toFixed(2))}
            </text>
          </g>
        );
      })}

      <line x1={PADDING_LEFT} y1={H - PAD_B} x2={W - PADDING_RIGHT} y2={H - PAD_B} stroke="#999" />

      {Array.from({ length: 12 }, (_, k) => k * 2).map((h) => (
        <text
          key={h}
          x={scaleX(h)}
          y={H - 20}
          textAnchor="middle"
          fill="#222"
          fontSize={14}
          fontWeight={700}
        >
          {h}h
        </text>
      ))}

      {paths.conso.d && (
        <>
          <path d={paths.conso.area} fill="url(#p5-grad-conso-area)" opacity={1} />
          <path
            d={paths.conso.d}
            fill="none"
            stroke="url(#p5-grad-conso)"
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#p5-soft-shadow)"
          />
        </>
      )}
      {paths.prod.d && (
        <>
          <path d={paths.prod.area} fill="url(#p5-grad-prod-area)" opacity={1} />
          <path
            d={paths.prod.d}
            fill="none"
            stroke="url(#p5-grad-prod)"
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#p5-soft-shadow)"
          />
        </>
      )}
      {paths.auto.d && rows.some((r) => r.auto > 0) && (
        <>
          <path d={paths.auto.area} fill="url(#p5-grad-auto-area)" opacity={1} />
          <path
            d={paths.auto.d}
            fill="none"
            stroke="url(#p5-grad-auto)"
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#p5-soft-shadow)"
          />
        </>
      )}
      {hasBatt && paths.batt.d && (
        <>
          <path d={paths.batt.area} fill="url(#p5-grad-batt-area)" opacity={1} />
          <path
            d={paths.batt.d}
            fill="none"
            stroke="url(#p5-grad-batt)"
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#p5-soft-shadow)"
          />
        </>
      )}
    </svg>
  );
}
