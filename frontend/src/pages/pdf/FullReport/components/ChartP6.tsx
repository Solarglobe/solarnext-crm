/**
 * Chart P6 — Barres empilées
 * direct PV (#86D8F1), batterie (#B3F4C4), réseau (#CFCBFF)
 */

import { useMemo } from "react";

interface ChartP6Props {
  dir: number[];
  bat: number[];
  grid: number[];
}

const W = 400;
const H = 180;
const PAD = { t: 20, r: 20, b: 30, l: 50 };
const COLORS = { dir: "#86D8F1", bat: "#B3F4C4", grid: "#CFCBFF" };

export default function ChartP6({ dir, bat, grid }: ChartP6Props) {
  const { bars, maxTot } = useMemo(() => {
    const d = dir.length >= 12 ? dir : [...dir, ...Array(12 - dir.length).fill(0)];
    const b = bat.length >= 12 ? bat : [...bat, ...Array(12 - bat.length).fill(0)];
    const g = grid.length >= 12 ? grid : [...grid, ...Array(12 - grid.length).fill(0)];
    const bars = d.slice(0, 12).map((dv, i) => ({
      dir: dv,
      bat: b[i] ?? 0,
      grid: g[i] ?? 0,
      tot: (dv ?? 0) + (b[i] ?? 0) + (g[i] ?? 0),
    }));
    const maxTot = Math.max(1, ...bars.map((x) => x.tot));
    return { bars, maxTot };
  }, [dir, bat, grid]);

  const barW = (W - PAD.l - PAD.r) / 12 - 4;
  const chartH = H - PAD.t - PAD.b;

  return (
    <svg className="chart-p6" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
      {bars.map((bar, i) => {
        const x = PAD.l + i * ((W - PAD.l - PAD.r) / 12) + 2;
        let yAcc = PAD.t + chartH;
        const scale = chartH / maxTot;
        const segs = [
          { val: bar.dir, color: COLORS.dir },
          { val: bar.bat, color: COLORS.bat },
          { val: bar.grid, color: COLORS.grid },
        ];
        return segs.map((seg, j) => {
          const h = seg.val * scale;
          yAcc -= h;
          return (
            <rect key={`${i}-${j}`} x={x} y={yAcc} width={barW} height={h} fill={seg.color} />
          );
        });
      })}
      {["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"].map((m, i) => (
        <text key={i} x={PAD.l + (i + 0.5) * ((W - PAD.l - PAD.r) / 12)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--sn-text-secondary, #9FA8C7)">{m}</text>
      ))}
      <g className="chart-p6-legend">
        <rect x={W - 120} y={8} width={12} height={8} fill={COLORS.dir} />
        <text x={W - 105} y={16} fontSize={9} fill="var(--sn-text-primary)">PV direct</text>
        <rect x={W - 120} y={24} width={12} height={8} fill={COLORS.bat} />
        <text x={W - 105} y={32} fontSize={9} fill="var(--sn-text-primary)">Batterie</text>
        <rect x={W - 120} y={40} width={12} height={8} fill={COLORS.grid} />
        <text x={W - 105} y={48} fontSize={9} fill="var(--sn-text-primary)">Réseau</text>
      </g>
    </svg>
  );
}
