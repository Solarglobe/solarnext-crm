/**
 * Graphique d’évolution des gains cumulés par scénario (25 ans).
 * Données : scenario.finance.annual_cashflows (year, total_eur, cumul_eur).
 * Reçoit orderedScenarios: (ScenarioV2 | null)[] — n’utilise que les scénarios non null.
 * Si un seul scénario disponible : message invitant à activer les options batterie.
 */

import React, { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { ScenarioV2 } from "./ScenarioComparisonTable";

const COLORS = [
  "#C39847",
  "#4A90E2",
  "#27AE60",
  "#E67E22",
];

interface CashflowEntry {
  year?: number;
  total_eur?: number;
  cumul_eur?: number;
}

function buildChartData(scenarios: ScenarioV2[]): Record<string, unknown>[] {
  const years: Record<number, Record<string, unknown>> = {};

  scenarios.forEach((scenario) => {
    const label = scenario.label ?? scenario.id ?? "";
    const flows = scenario.finance?.annual_cashflows as CashflowEntry[] | undefined;
    if (!Array.isArray(flows)) return;
    flows.forEach((flow) => {
      const y = flow?.year;
      if (y == null || !Number.isFinite(y)) return;
      if (!years[y]) {
        years[y] = { year: y };
      }
      const cumul = flow.cumul_eur;
      const key = String(label);
      if (key) (years[y] as Record<string, unknown>)[key] = cumul != null && Number.isFinite(cumul) ? cumul : null;
    });
  });

  return Object.values(years).sort(
    (a, b) => (a.year as number) - (b.year as number)
  );
}

interface ScenarioEconomicsChartProps {
  /** 3 slots (BASE, BATTERY_PHYSICAL, BATTERY_VIRTUAL) — seuls les non null sont utilisés pour le graphique */
  orderedScenarios: (ScenarioV2 | null)[];
  className?: string;
  height?: number;
}

export default function ScenarioEconomicsChart({
  orderedScenarios,
  className = "",
  height = 400,
}: ScenarioEconomicsChartProps) {
  const validScenarios = useMemo(
    () => orderedScenarios.filter((s): s is ScenarioV2 => s != null),
    [orderedScenarios]
  );

  const chartData = useMemo(() => buildChartData(validScenarios), [validScenarios]);

  const hasData =
    chartData.length > 0 &&
    validScenarios.some(
      (s) =>
        Array.isArray(s.finance?.annual_cashflows) &&
        (s.finance.annual_cashflows as unknown[]).length > 0
    );

  const singleScenarioHint = validScenarios.length === 1;

  if (validScenarios.length === 0) {
    return null;
  }

  if (!hasData) {
    return (
      <div className={`scenario-economics-chart-empty ${className}`}>
        <p>Aucune donnée de cashflows pour afficher le graphique.</p>
        <style>{`
          .scenario-economics-chart-empty {
            padding: 24px;
            text-align: center;
            color: var(--sn-text-secondary, #9FA8C7);
            font-size: 14px;
            background: var(--sn-bg-surface, #1a1f2e);
            border-radius: 12px;
            border: 1px solid var(--sn-border-soft, rgba(255,255,255,0.08));
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className={`scenario-economics-chart-wrapper ${className}`}>
      {singleScenarioHint && (
        <p
          className="sg-helper"
          style={{
            margin: "0 0 12px 0",
            color: "var(--sn-text-secondary)",
            fontSize: 14,
          }}
        >
          Activez les options batterie dans le devis technique pour comparer plusieurs scénarios.
        </p>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={chartData}
          margin={{ top: 16, right: 16, left: 8, bottom: 24 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--sn-border-soft, rgba(255,255,255,0.1))" />
          <XAxis
            dataKey="year"
            label={{ value: "Années", position: "insideBottom", offset: -8 }}
            stroke="var(--sn-text-secondary, #9FA8C7)"
            tick={{ fill: "var(--sn-text-secondary, #9FA8C7)", fontSize: 12 }}
          />
          <YAxis
            stroke="var(--sn-text-secondary, #9FA8C7)"
            tick={{ fill: "var(--sn-text-secondary, #9FA8C7)", fontSize: 12 }}
            tickFormatter={(v) => `${Math.round(Number(v) / 1000)} k€`}
          />
          <Tooltip
            formatter={(value: unknown) =>
              typeof value === "number" && Number.isFinite(value)
                ? `${value.toLocaleString("fr-FR")} €`
                : "—"
            }
            contentStyle={{
              background: "var(--sn-bg-elevated, #1a1f2e)",
              border: "1px solid var(--sn-border-soft, rgba(255,255,255,0.08))",
              borderRadius: "8px",
              color: "var(--sn-text-primary)",
            }}
            labelStyle={{ color: "var(--sn-text-secondary, #9FA8C7)" }}
          />
          <Legend
            wrapperStyle={{ paddingTop: "8px" }}
            formatter={(value) => <span style={{ color: "var(--sn-text-primary)" }}>{value}</span>}
          />
          {validScenarios.map((scenario, i) => {
            const label = scenario.label ?? scenario.id;
            return (
              <Line
                key={scenario.id}
                type="monotone"
                dataKey={label}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2.5}
                dot={false}
                connectNulls
                name={label}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
      <style>{`
        .scenario-economics-chart-wrapper {
          background: var(--sn-bg-surface, #1a1f2e);
          border-radius: 12px;
          border: 1px solid var(--sn-border-soft, rgba(255,255,255,0.08));
          padding: 16px;
          min-height: 280px;
        }
        @media (max-width: 640px) {
          .scenario-economics-chart-wrapper { min-height: 260px; padding: 12px; }
        }
      `}</style>
    </div>
  );
}
