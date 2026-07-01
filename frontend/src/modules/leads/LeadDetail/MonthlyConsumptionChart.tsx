/**
 * Graphique bâtons de la consommation mensuelle (kWh) — fiche lead + modale compteur.
 * Source : profil horaire 8760 (mode PDL, aligné janv→déc) ou 12 valeurs mensuelles (mode MENSUEL).
 */

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

const MONTH_LABELS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Sommes mensuelles calendaire (janv→déc) d'un profil horaire 8760. */
export function monthlySumsFromHourly8760(hourly: number[] | null | undefined): number[] | null {
  if (!Array.isArray(hourly) || hourly.length !== 8760) return null;
  const out: number[] = [];
  let cursor = 0;
  for (let m = 0; m < 12; m++) {
    const hours = DAYS_IN_MONTH[m] * 24;
    let s = 0;
    for (let i = 0; i < hours; i++) s += Number(hourly[cursor + i]) || 0;
    out.push(Math.round(s));
    cursor += hours;
  }
  return out;
}

interface MonthlyConsumptionChartProps {
  /** Profil horaire 8760 h (mode PDL) — prioritaire sur monthlyKwh */
  hourly?: number[] | null;
  /** 12 valeurs mensuelles en kWh (mode MENSUEL / saisie manuelle) */
  monthlyKwh?: Array<number | null | undefined> | null;
  title?: string;
}

export default function MonthlyConsumptionChart({
  hourly,
  monthlyKwh,
  title = "Consommation mensuelle (kWh)",
}: MonthlyConsumptionChartProps) {
  const fromHourly = monthlySumsFromHourly8760(hourly);
  const values =
    fromHourly ??
    (Array.isArray(monthlyKwh) && monthlyKwh.length === 12
      ? monthlyKwh.map((v) => Math.round(Number(v) || 0))
      : null);

  if (!values || !values.some((v) => v > 0)) return null;

  const data = values.map((kwh, i) => ({ mois: MONTH_LABELS[i], kwh }));

  return (
    <div className="crm-lead-monthly-chart" style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{title}</div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border, #e5e7eb)" />
          <XAxis dataKey="mois" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval={0} />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
          <Tooltip formatter={(value) => `${Number(value).toLocaleString("fr-FR")} kWh`} />
          <Bar dataKey="kwh" name="Conso" fill="var(--primary, #7C3AED)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
