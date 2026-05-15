/**
 * Chart P2 — Line chart 25 ans (Recharts)
 * Sans solaire (noir pointillé), Avec solaire (doré #C39847)
 */

import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend } from "recharts";

interface ChartP2Props {
  labels: string[];
  sans: number[];
  avec: number[];
}

export default function ChartP2({ labels, sans, avec }: ChartP2Props) {
  const data = labels.map((label, i) => ({
    label,
    sans: sans[i] ?? 0,
    avec: avec[i] ?? 0,
  }));

  if (data.length === 0) {
    return <div className="chart-p2-empty">Aucune donnée</div>;
  }

  return (
    <div className="chart-p2">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--sn-border-soft, rgba(255,255,255,0.1))" />
          <XAxis dataKey="label" stroke="var(--sn-text-secondary, #9FA8C7)" tick={{ fill: "var(--sn-text-secondary)", fontSize: 10 }} />
          <YAxis stroke="var(--sn-text-secondary)" tick={{ fill: "var(--sn-text-secondary)", fontSize: 10 }} tickFormatter={(v) => `${Math.round(Number(v) / 1000)} k`} />
          <Legend wrapperStyle={{ fontSize: 11 }} formatter={(value) => <span style={{ color: "var(--sn-text-primary, #E8ECF8)" }}>{value}</span>} />
          <Line type="monotone" dataKey="sans" name="Sans solaire" stroke="#4A5568" strokeWidth={2} strokeDasharray="5 5" dot={false} />
          <Line type="monotone" dataKey="avec" name="Avec solaire" stroke="#C39847" strokeWidth={2.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
