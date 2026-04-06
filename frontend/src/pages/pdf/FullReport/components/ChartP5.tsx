/**
 * Chart P5 — SVG courbes journée type 24h
 * Production, Consommation, Batterie
 */

import React, { useMemo } from "react";

interface ChartP5Props {
  production: number[];
  consommation: number[];
  batterie: number[];
}

const W = 400;
const H = 180;
const PAD = { t: 20, r: 20, b: 30, l: 50 };
const COLORS = { prod: "#C39847", conso: "#4A90E2", batt: "#2E8B57" };

function buildPath(values: number[], maxVal: number): string {
  if (values.length === 0 || maxVal <= 0) return "";
  const arr = values.length >= 24 ? values : [...values, ...Array(24 - values.length).fill(0)];
  const step = (W - PAD.l - PAD.r) / 23;
  const pts = arr.slice(0, 24).map((v, i) => {
    const x = PAD.l + i * step;
    const y = PAD.t + H - PAD.t - PAD.b - (v / maxVal) * (H - PAD.t - PAD.b);
    return { x, y };
  });
  return pts.reduce((acc, p, i) => acc + (i === 0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`), "");
}

export default function ChartP5({ production, consommation, batterie }: ChartP5Props) {
  const { maxVal, paths } = useMemo(() => {
    const all = [...production, ...consommation, ...batterie].filter(Number.isFinite);
    const max = Math.max(0.01, ...all);
    return {
      maxVal: max,
      paths: {
        prod: buildPath(production, max),
        conso: buildPath(consommation, max),
        batt: buildPath(batterie, max),
      },
    };
  }, [production, consommation, batterie]);

  return (
    <svg className="chart-p5" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
      {paths.prod && <path d={paths.prod} fill="none" stroke={COLORS.prod} strokeWidth={2} />}
      {paths.conso && <path d={paths.conso} fill="none" stroke={COLORS.conso} strokeWidth={2} />}
      {paths.batt && <path d={paths.batt} fill="none" stroke={COLORS.batt} strokeWidth={2} />}
      {[0, 6, 12, 18, 24].map((h) => (
        <text key={h} x={PAD.l + (h / 24) * (W - PAD.l - PAD.r)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--sn-text-secondary, #9FA8C7)">{h}h</text>
      ))}
      <g className="chart-p5-legend">
        <rect x={W - 100} y={8} width={12} height={8} fill={COLORS.prod} />
        <text x={W - 85} y={16} fontSize={9} fill="var(--sn-text-primary)">Production</text>
        <rect x={W - 100} y={24} width={12} height={8} fill={COLORS.conso} />
        <text x={W - 85} y={32} fontSize={9} fill="var(--sn-text-primary)">Consommation</text>
        <rect x={W - 100} y={40} width={12} height={8} fill={COLORS.batt} />
        <text x={W - 85} y={48} fontSize={9} fill="var(--sn-text-primary)">Batterie</text>
      </g>
    </svg>
  );
}
