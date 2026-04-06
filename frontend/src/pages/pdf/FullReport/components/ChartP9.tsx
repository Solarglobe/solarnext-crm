/**
 * Chart P9 — Courbe cumulée unique (25 ans), style sobre
 */

import React, { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis, ReferenceLine } from "recharts";

interface ChartP9Props {
  scenario: { label: string; cumul_25y: number[]; roi_year?: number | null };
}

export default function ChartP9({ scenario }: ChartP9Props) {
  const data = useMemo(() => {
    const s = scenario.cumul_25y ?? [];
    return Array.from({ length: 25 }, (_, i) => ({
      year: i + 1,
      cumul: Number(s[i] ?? 0),
    }));
  }, [scenario.cumul_25y]);

  const roiY = scenario.roi_year != null && scenario.roi_year > 0 && scenario.roi_year <= 25 ? Math.round(scenario.roi_year) : null;

  if (!data.length) {
    return <div className="chart-p9-empty">Aucune donnée</div>;
  }

  return (
    <div className="chart-p9">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 8, bottom: 24 }}>
          <defs>
            <linearGradient id="p9chartFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#C39847" stopOpacity={0.35} />
              <stop offset="55%" stopColor="#C39847" stopOpacity={0.1} />
              <stop offset="100%" stopColor="#C39847" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
          <XAxis dataKey="year" stroke="#888" tick={{ fill: "#666", fontSize: 10 }} tickFormatter={(v) => `An ${v}`} />
          <YAxis stroke="#888" tick={{ fill: "#666", fontSize: 10 }} tickFormatter={(v) => `${Math.round(Number(v) / 1000)} k`} />
          {roiY != null ? <ReferenceLine x={roiY} stroke="#9A7634" strokeDasharray="4 4" /> : null}
          <Area type="monotone" dataKey="cumul" name={scenario.label || "Gain cumulé"} stroke="#C39847" strokeWidth={2.5} fill="url(#p9chartFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
