/**
 * Chart P8 — Courbes profil journée
 * pv (#FFD54F), load (#CFCFCF), charge (#A6E3AE), discharge (#2E8B57)
 */

import { useMemo } from "react";

interface ChartP8Props {
  pv: number[];
  load: number[];
  charge: number[];
  discharge: number[];
}

const W = 400;
const H = 180;
const PAD = { t: 20, r: 20, b: 30, l: 50 };
const COLORS = { pv: "#FFD54F", load: "#CFCFCF", charge: "#A6E3AE", discharge: "#2E8B57" };

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

export default function ChartP8({ pv, load, charge, discharge }: ChartP8Props) {
  const { paths } = useMemo(() => {
    const all = [...pv, ...load, ...charge, ...discharge].filter(Number.isFinite);
    const max = Math.max(0.01, ...all);
    return {
      maxVal: max,
      paths: {
        pv: buildPath(pv, max),
        load: buildPath(load, max),
        charge: buildPath(charge, max),
        discharge: buildPath(discharge, max),
      },
    };
  }, [pv, load, charge, discharge]);

  return (
    <svg className="chart-p8" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
      {paths.pv && <path d={paths.pv} fill="none" stroke={COLORS.pv} strokeWidth={2} />}
      {paths.load && <path d={paths.load} fill="none" stroke={COLORS.load} strokeWidth={2} />}
      {paths.charge && <path d={paths.charge} fill="none" stroke={COLORS.charge} strokeWidth={2} />}
      {paths.discharge && <path d={paths.discharge} fill="none" stroke={COLORS.discharge} strokeWidth={2} />}
      {[0, 6, 12, 18, 24].map((h) => (
        <text key={h} x={PAD.l + (h / 24) * (W - PAD.l - PAD.r)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--sn-text-secondary, #9FA8C7)">{h}h</text>
      ))}
      <g className="chart-p8-legend">
        <rect x={W - 100} y={8} width={12} height={8} fill={COLORS.pv} />
        <text x={W - 85} y={16} fontSize={9} fill="var(--sn-text-primary)">PV</text>
        <rect x={W - 100} y={24} width={12} height={8} fill={COLORS.load} />
        <text x={W - 85} y={32} fontSize={9} fill="var(--sn-text-primary)">Charge</text>
        <rect x={W - 100} y={40} width={12} height={8} fill={COLORS.charge} />
        <text x={W - 85} y={48} fontSize={9} fill="var(--sn-text-primary)">Charge</text>
        <rect x={W - 100} y={56} width={12} height={8} fill={COLORS.discharge} />
        <text x={W - 85} y={64} fontSize={9} fill="var(--sn-text-primary)">Décharge</text>
      </g>
    </svg>
  );
}
