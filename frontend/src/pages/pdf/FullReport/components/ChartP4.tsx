/**
 * Chart P4 — SVG courbes 12 mois
 * Production (or), Consommation (bleu), Autoconso (turquoise), Batterie (vert)
 */

import { useMemo } from "react";

interface ChartP4Props {
  production: number[];
  consommation: number[];
  autoconso: number[];
  batterie: number[];
}

const W = 400;
const H = 180;
const PAD = { t: 20, r: 20, b: 30, l: 50 };
const COLORS = { prod: "#C39847", conso: "#4A90E2", auto: "#40E0D0", batt: "#2E8B57" };

function buildPath(values: number[], maxVal: number, _color: string): string {
  if (values.length === 0 || maxVal <= 0) return "";
  const step = (W - PAD.l - PAD.r) / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => {
    const x = PAD.l + i * step;
    const y = PAD.t + H - PAD.t - PAD.b - (v / maxVal) * (H - PAD.t - PAD.b);
    return { x, y };
  });
  return pts.reduce((acc, p, i) => acc + (i === 0 ? `M ${p.x} ${p.y}` : ` L ${p.x} ${p.y}`), "");
}

export default function ChartP4({ production, consommation, autoconso, batterie }: ChartP4Props) {
  const { paths } = useMemo(() => {
    const all = [...production, ...consommation, ...autoconso, ...batterie].filter(Number.isFinite);
    const max = Math.max(1, ...all);
    const prod = production.length >= 12 ? production : [...production, ...Array(12 - production.length).fill(0)];
    const conso = consommation.length >= 12 ? consommation : [...consommation, ...Array(12 - consommation.length).fill(0)];
    const auto = autoconso.length >= 12 ? autoconso : [...autoconso, ...Array(12 - autoconso.length).fill(0)];
    const batt = batterie.length >= 12 ? batterie : [...batterie, ...Array(12 - batterie.length).fill(0)];
    return {
      maxVal: max,
      paths: {
        prod: buildPath(prod, max, COLORS.prod),
        conso: buildPath(conso, max, COLORS.conso),
        auto: buildPath(auto, max, COLORS.auto),
        batt: buildPath(batt, max, COLORS.batt),
      },
    };
  }, [production, consommation, autoconso, batterie]);

  const months = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

  return (
    <svg className="chart-p4" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="p4-prod" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor={COLORS.prod} stopOpacity="0.3" /><stop offset="100%" stopColor={COLORS.prod} stopOpacity="0" /></linearGradient>
        <linearGradient id="p4-conso" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor={COLORS.conso} stopOpacity="0.3" /><stop offset="100%" stopColor={COLORS.conso} stopOpacity="0" /></linearGradient>
      </defs>
      {paths.prod && <path d={paths.prod} fill="none" stroke={COLORS.prod} strokeWidth={2} />}
      {paths.conso && <path d={paths.conso} fill="none" stroke={COLORS.conso} strokeWidth={2} />}
      {paths.auto && <path d={paths.auto} fill="none" stroke={COLORS.auto} strokeWidth={2} />}
      {paths.batt && <path d={paths.batt} fill="none" stroke={COLORS.batt} strokeWidth={2} />}
      {months.map((m, i) => (
        <text key={i} x={PAD.l + (i / 11) * (W - PAD.l - PAD.r)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--sn-text-secondary, #9FA8C7)">{m}</text>
      ))}
      <text x={8} y={PAD.t + 14} fontSize={9} fill="var(--sn-text-secondary)">kWh</text>
      <g className="chart-p4-legend">
        <rect x={W - 120} y={8} width={12} height={8} fill={COLORS.prod} />
        <text x={W - 105} y={16} fontSize={9} fill="var(--sn-text-primary)">Production</text>
        <rect x={W - 120} y={24} width={12} height={8} fill={COLORS.conso} />
        <text x={W - 105} y={32} fontSize={9} fill="var(--sn-text-primary)">Consommation</text>
        <rect x={W - 120} y={40} width={12} height={8} fill={COLORS.auto} />
        <text x={W - 105} y={48} fontSize={9} fill="var(--sn-text-primary)">Autoconso</text>
        <rect x={W - 120} y={56} width={12} height={8} fill={COLORS.batt} />
        <text x={W - 105} y={64} fontSize={9} fill="var(--sn-text-primary)">Batterie</text>
      </g>
    </svg>
  );
}
