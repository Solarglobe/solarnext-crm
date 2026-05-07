/**
 * Tableau de bord — pilotage direction (données serveur, hiérarchie visuelle premium).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Card } from "../components/ui/Card";
import {
  fetchDashboardOverview,
  type DashboardOverview,
  type DashboardRange,
} from "../services/dashboard.service";
import { fetchLeadsMeta, type LeadsMeta } from "../services/leads.service";
import { getUserPermissions } from "../services/auth.service";
import "./dashboard-page.css";

function isEmptyish(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string" && v.trim() === "") return true;
  return false;
}

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function eur(v: number | null | undefined, opts?: { fraction?: number }) {
  if (isEmptyish(v)) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: opts?.fraction ?? 0,
    maximumFractionDigits: opts?.fraction ?? 2,
  });
}

function pct(v: number | null | undefined) {
  if (isEmptyish(v)) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
}

/** Affichage jours (évite NaN / trop de décimales) */
function fmtDays(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const rounded = Math.round(n * 100) / 100;
  if (rounded % 1 === 0) return `${rounded} j`;
  return `${rounded.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} j`;
}

function fmtDay(d: string) {
  try {
    return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
  } catch {
    return d;
  }
}

/** Potentiel pipeline en libellé court (k€ / M€) */
function fmtPotentiel(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M€`;
  }
  return `${Math.round(n / 1000).toLocaleString("fr-FR")} k€`;
}

/** Variantes sn-badge pour légende pipeline (pas de couleur inline). */
function pipelineLegendBadgeClass(i: number, closed: boolean): string {
  if (closed) return "sn-badge sn-badge-neutral";
  const cycle = ["sn-badge-info", "sn-badge-warn", "sn-badge-success"] as const;
  return `sn-badge ${cycle[i % cycle.length]}`;
}

const RANGE_OPTIONS: { value: DashboardRange; label: string }[] = [
  { value: "7d", label: "7 jours" },
  { value: "30d", label: "30 jours" },
  { value: "90d", label: "90 jours" },
  { value: "12m", label: "12 mois" },
  { value: "custom", label: "Personnalisé" },
];

type SeriesKey = "leads" | "sent" | "signed" | "invoices" | "cash";

const SERIES_LABELS: Record<SeriesKey, string> = {
  leads: "Leads",
  sent: "Devis envoyés",
  signed: "Devis signés",
  invoices: "Factures",
  cash: "Encaissements",
};

type InsightAlert = { id: string; text: string; tone: "danger" | "warn" | "info" };

function insightToneBadgeClass(tone: InsightAlert["tone"]): string {
  if (tone === "danger") return "sn-badge sn-badge-danger";
  if (tone === "warn") return "sn-badge sn-badge-warn";
  return "sn-badge sn-badge-info";
}

function buildDashboardInsight(
  d: DashboardOverview,
  kpis: NonNullable<DashboardOverview["global_kpis"]>,
  fc: NonNullable<DashboardOverview["forecast"]>
): { headline: string; alerts: InsightAlert[]; metrics: { label: string; value: string }[] } {
  const alerts: InsightAlert[] = [];
  const overdue = safeNum(fc.overdue_invoices_amount);
  const cash30 = safeNum(fc.expected_cash_short_term_30d_ttc);
  const weighted = safeNum(fc.weighted_pipeline_ttc);
  const rev = safeNum(kpis.revenue_signed_accepted_in_period);
  const cohort = safeNum(kpis.sign_rate_cohort_created_pct);
  const stock = safeNum(kpis.sign_rate_stock_pct);

  if (overdue > 0) {
    const tone: InsightAlert["tone"] =
      cash30 > 0 && overdue > cash30 * 0.25 ? "danger" : "warn";
    alerts.push({
      id: "overdue",
      text: `Impayés / retard : ${eur(overdue)}`,
      tone,
    });
  }

  const mo = d.margin_overview;
  if (mo && safeNum(mo.lines_excluded_count) > 0 && alerts.length < 2) {
    const n = Math.round(safeNum(mo.lines_excluded_count));
    alerts.push({
      id: "material",
      text: `${n} ligne${n > 1 ? "s" : ""} sans coût d’achat exclue${n > 1 ? "s" : ""} du périmètre matériel (période).`,
      tone: "info",
    });
  }

  if (cohort > 0 && stock > 0 && cohort < stock - 8) {
    alerts.push({
      id: "conv",
      text: "Conversion récente sous le niveau du stock ouvert — à surveiller.",
      tone: "info",
    });
  }

  let headline =
    "Vue d’ensemble sur la période : signatures, trésorerie et pipeline sur votre périmètre.";
  if (rev > 0 && weighted > rev * 2.5) {
    headline =
      "Pipeline élevé par rapport au CA signé — prioriser la conversion et les relances.";
  } else if (overdue > 10_000 && overdue > cash30 * 0.1) {
    headline = "L’activité progresse, mais la pression impayés mérite une attention immédiate.";
  } else if (cohort >= stock - 3 && cohort > 0) {
    headline = "Bon niveau de conversion sur la période, trésorerie et pipeline à cadrer.";
  }

  const metrics = [
    { label: "CA signé", value: eur(kpis.revenue_signed_accepted_in_period) },
    { label: "Signatures", value: String(kpis.quotes_accepted_in_period_count ?? "—") },
  ];

  return { headline, alerts: alerts.slice(0, 2), metrics };
}

function sumStagePotential(stages: DashboardOverview["pipeline"]["leads_by_stage"]): number {
  return stages.reduce((s, x) => s + safeNum(x.total_potential_revenue), 0);
}

/** Tendance textuelle à partir de la timeline (sans backend). */
function buildTimelineTrendSentence(
  rows: DashboardOverview["activity_timeline"],
  vis: Record<SeriesKey, boolean>
): string | null {
  if (!rows.length || rows.length < 8) return null;
  const mid = Math.floor(rows.length / 2);
  const first = rows.slice(0, mid);
  const second = rows.slice(mid);
  const sum = (chunk: typeof rows, key: keyof (typeof rows)[0]) =>
    chunk.reduce((a, r) => a + safeNum(r[key] as unknown as number), 0);
  const parts: string[] = [];
  if (vis.signed) {
    const a = sum(first, "quotes_signed");
    const b = sum(second, "quotes_signed");
    if (a > 0 || b > 0) {
      parts.push(b >= a * 1.1 ? "signatures en hausse sur la fenêtre affichée" : b <= a * 0.9 ? "signatures en retrait" : "signatures stables");
    }
  }
  if (vis.cash) {
    const a = sum(first, "cash_collected");
    const b = sum(second, "cash_collected");
    if (a > 0 || b > 0) {
      parts.push(b >= a * 1.1 ? "encaissements en hausse" : b <= a * 0.9 ? "encaissements en baisse" : "encaissements stables");
    }
  }
  if (!parts.length) return null;
  return parts.slice(0, 2).join(" · ");
}

function TimelineSparkline({
  rows,
  accessor,
}: {
  rows: DashboardOverview["activity_timeline"];
  accessor: "quotes_signed" | "cash_collected";
}) {
  const vals = rows.map((r) => safeNum(r[accessor]));
  if (!vals.length) return null;
  const max = Math.max(...vals, 1);
  const w = 120;
  const h = 36;
  const pad = 2;
  const span = Math.max(vals.length - 1, 1);
  let pts = vals.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / span;
    const y = h - pad - (v / max) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  if (pts.length === 1) {
    const v = vals[0];
    const y = h - pad - (v / max) * (h - pad * 2);
    pts = [`${pad},${y.toFixed(1)}`, `${w - pad},${y.toFixed(1)}`];
  }
  return (
    <svg className="sn-dashboard-sparkline" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts.join(" ")}
      />
    </svg>
  );
}

/* ─── Gauge circulaire SVG (taux de conversion) ───────────────────────────── */
function ConversionGauge({ pctValue, label }: { pctValue: number; label: string }) {
  const r = 52;
  const cx = 64;
  const cy = 64;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pctValue));
  const dash = (clamped / 100) * circumference;
  const gap = circumference - dash;
  // couleur selon valeur
  const color = clamped >= 60 ? "#22c55e" : clamped >= 35 ? "#7c3aed" : "#f59e0b";
  return (
    <div className="sn-dashboard-gauge">
      <svg viewBox="0 0 128 128" className="sn-dashboard-gauge__svg" aria-hidden>
        {/* piste */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeWidth="10" className="sn-dashboard-gauge__track" />
        {/* arc valeur */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${gap}`}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: "stroke-dasharray 0.6s ease" }}
        />
        <text x={cx} y={cy - 4} textAnchor="middle" className="sn-dashboard-gauge__value" fill={color}>
          {clamped.toLocaleString("fr-FR", { maximumFractionDigits: 0 })}%
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" className="sn-dashboard-gauge__sub">
          {label}
        </text>
      </svg>
    </div>
  );
}

/* ─── Mini sparkline inline pour KPI cards ───────────────────────────────── */
function KpiSparkline({ values, color = "#7c3aed" }: { values: number[]; color?: string }) {
  if (!values.length || values.every((v) => v === 0)) return null;
  const max = Math.max(...values, 1);
  const w = 80;
  const h = 28;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * w;
    const y = h - 2 - ((v / max) * (h - 4));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  // Aire de remplissage
  const areaPoints = `0,${h} ${pts.join(" ")} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="sn-dashboard-kpi-sparkline" aria-hidden>
      <defs>
        <linearGradient id={`kpi-grad-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#kpi-grad-${color.replace("#","")})`} />
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={pts.join(" ")} />
    </svg>
  );
}

/* ─── Trend badge (flèche + delta) ──────────────────────────────────────────*/
function TrendBadge({ current, previous, formatter }: { current: number; previous: number; formatter: (v: number) => string }) {
  if (!previous || previous === 0) return null;
  const delta = current - previous;
  const pctChange = (delta / previous) * 100;
  const isUp = delta >= 0;
  const isNeutral = Math.abs(pctChange) < 2;
  if (isNeutral) return <span className="sn-dashboard-trend sn-dashboard-trend--neutral">→ stable</span>;
  return (
    <span className={`sn-dashboard-trend ${isUp ? "sn-dashboard-trend--up" : "sn-dashboard-trend--down"}`}>
      {isUp ? "↑" : "↓"} {Math.abs(pctChange).toFixed(0)}%
      <span className="sn-dashboard-trend__abs"> ({isUp ? "+" : ""}{formatter(delta)})</span>
    </span>
  );
}

/* ─── Area Chart timeline (remplace la table) ───────────────────────────────*/
const CHART_COLORS: Record<SeriesKey, string> = {
  leads: "#7c3aed",
  sent: "#a78bfa",
  signed: "#22c55e",
  invoices: "#f59e0b",
  cash: "#0ea5e9",
};

function TimelineAreaChart({
  rows,
  seriesVis,
}: {
  rows: DashboardOverview["activity_timeline"];
  seriesVis: Record<SeriesKey, boolean>;
}) {
  if (!rows.length) return null;

  const data = rows.map((r) => ({
    date: fmtDay(String(r.date)),
    leads: seriesVis.leads ? safeNum(r.leads_created) : undefined,
    sent: seriesVis.sent ? safeNum(r.quotes_sent) : undefined,
    signed: seriesVis.signed ? safeNum(r.quotes_signed) : undefined,
    invoices: seriesVis.invoices ? safeNum(r.invoices_issued) : undefined,
    cash: seriesVis.cash ? safeNum(r.cash_collected) : undefined,
  }));

  const hasCash = seriesVis.cash;
  const countSeries = (Object.keys(seriesVis) as SeriesKey[]).filter((k) => seriesVis[k] && k !== "cash").length;

  return (
    <div className="sn-dashboard-areachart-wrap">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <defs>
            {(Object.keys(CHART_COLORS) as SeriesKey[]).map((k) => (
              <linearGradient key={k} id={`grad-${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART_COLORS[k]} stopOpacity={0.22} />
                <stop offset="95%" stopColor={CHART_COLORS[k]} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border, rgba(148,163,184,0.12))" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "var(--text-secondary, #9FA8C7)" }}
            axisLine={false}
            tickLine={false}
            interval={Math.floor(data.length / 6)}
          />
          {/* Axe Y gauche pour counts */}
          {countSeries > 0 && (
            <YAxis
              yAxisId="count"
              tick={{ fontSize: 11, fill: "var(--text-secondary, #9FA8C7)" }}
              axisLine={false}
              tickLine={false}
              width={28}
              allowDecimals={false}
            />
          )}
          {/* Axe Y droit pour cash */}
          {hasCash && (
            <YAxis
              yAxisId="cash"
              orientation="right"
              tick={{ fontSize: 11, fill: "var(--text-secondary, #9FA8C7)" }}
              axisLine={false}
              tickLine={false}
              width={56}
              tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)}
            />
          )}
          <RechartsTooltip
            contentStyle={{
              background: "var(--surface, #12172B)",
              border: "1px solid var(--border, rgba(255,255,255,0.1))",
              borderRadius: "8px",
              fontSize: "12px",
              color: "var(--text-primary, #E8ECF8)",
            }}
            labelStyle={{ fontWeight: 600, marginBottom: 4 }}
            formatter={(value: number, name: string) => {
              if (name === "cash") return [eur(value), "Encaissements"];
              return [value, SERIES_LABELS[name as SeriesKey] ?? name];
            }}
          />
          {(Object.keys(seriesVis) as SeriesKey[]).map((k) => {
            if (!seriesVis[k]) return null;
            const isCash = k === "cash";
            return (
              <Area
                key={k}
                type="monotone"
                dataKey={k}
                yAxisId={isCash ? "cash" : "count"}
                stroke={CHART_COLORS[k]}
                strokeWidth={2}
                fill={`url(#grad-${k})`}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
                name={k}
              />
            );
          })}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─── Donut Chart sources ────────────────────────────────────────────────── */
const DONUT_COLORS = ["#7c3aed", "#0ea5e9", "#22c55e", "#f59e0b", "#ec4899", "#14b8a6"];

function SourceDonutChart({ rows }: { rows: DashboardOverview["acquisition_performance"] }) {
  if (!rows.length) return null;
  const data = rows.map((r, i) => ({
    name: r.source_name,
    value: safeNum(r.leads_count),
    signed: safeNum(r.quotes_signed_count),
    color: DONUT_COLORS[i % DONUT_COLORS.length],
  })).filter((d) => d.value > 0);

  if (!data.length) return null;

  return (
    <div className="sn-dashboard-donut-wrap">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={80}
            paddingAngle={3}
            dataKey="value"
          >
            {data.map((entry, i) => (
              <Cell key={entry.name} fill={entry.color} strokeWidth={0} />
            ))}
          </Pie>
          <RechartsTooltip
            contentStyle={{
              background: "var(--surface, #12172B)",
              border: "1px solid var(--border, rgba(255,255,255,0.1))",
              borderRadius: "8px",
              fontSize: "12px",
              color: "var(--text-primary, #E8ECF8)",
            }}
            formatter={(value: number, name: string) => [`${value} leads`, name]}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [meta, setMeta] = useState<LeadsMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [canFilterScope, setCanFilterScope] = useState(false);
  const [commercialExpanded, setCommercialExpanded] = useState(false);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [seriesVis, setSeriesVis] = useState<Record<SeriesKey, boolean>>({
    leads: true,
    sent: false,
    signed: true,
    invoices: false,
    cash: true,
  });

  const range = (searchParams.get("range") as DashboardRange) || "30d";
  const dateFrom = searchParams.get("date_from") || "";
  const dateTo = searchParams.get("date_to") || "";
  const assignedUserId = searchParams.get("assigned_user_id") || "";
  const sourceId = searchParams.get("source_id") || "";

  useEffect(() => {
    getUserPermissions()
      .then((p) => {
        const perms = p.permissions ?? [];
        setCanFilterScope(
          perms.includes("lead.read.all") || perms.includes("quote.manage") || perms.includes("invoice.manage")
        );
      })
      .catch(() => setCanFilterScope(false));
  }, []);

  useEffect(() => {
    fetchLeadsMeta()
      .then(setMeta)
      .catch(() => setMeta(null));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const d = await fetchDashboardOverview({
        range,
        date_from: range === "custom" ? dateFrom || undefined : undefined,
        date_to: range === "custom" ? dateTo || undefined : undefined,
        assigned_user_id: assignedUserId || null,
        source_id: sourceId || null,
      });
      setData(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [range, dateFrom, dateTo, assignedUserId, sourceId]);

  useEffect(() => {
    load();
  }, [load]);

  const updateParam = (key: string, value: string) => {
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (!value) n.delete(key);
        else n.set(key, value);
        return n;
      },
      { replace: true }
    );
  };

  const kpis = data?.global_kpis;
  const fc = data?.forecast;

  const pipelineTotal = useMemo(() => {
    if (!data) return 0;
    return data.pipeline.leads_by_stage.reduce((s, x) => s + (x.leads_count || 0), 0);
  }, [data]);

  const pipelinePotentialTotal = useMemo(() => {
    if (!data?.pipeline) return 0;
    return sumStagePotential(data.pipeline.leads_by_stage);
  }, [data]);

  const isEmptyCohort = useMemo(() => {
    if (!kpis) return false;
    return (
      kpis.leads_total_cohort_created === 0 &&
      kpis.quotes_cohort_created_total === 0 &&
      kpis.revenue_signed_accepted_in_period === 0
    );
  }, [kpis]);

  const timelineRows = data?.activity_timeline ?? [];
  const timelineTail = useMemo(() => {
    if (timelineRows.length <= 31) return timelineRows;
    return timelineRows.slice(-31);
  }, [timelineRows]);

  const insight = useMemo(() => {
    if (!data || !kpis || !fc) return null;
    return buildDashboardInsight(data, kpis, fc);
  }, [data, kpis, fc]);

  const trendSentence = useMemo(
    () => (timelineRows.length ? buildTimelineTrendSentence(timelineRows, seriesVis) : null),
    [timelineRows, seriesVis]
  );

  const maxCommercialRev = useMemo(() => {
    const rows = data?.commercial_performance ?? [];
    return Math.max(...rows.map((r) => safeNum(r.revenue_signed_ttc)), 1);
  }, [data?.commercial_performance]);

  const maxSourceRev = useMemo(() => {
    const rows = data?.acquisition_performance ?? [];
    return Math.max(...rows.map((r) => safeNum(r.revenue_signed_ttc)), 1);
  }, [data?.acquisition_performance]);

  const toggleSeries = (k: SeriesKey) => {
    setSeriesVis((s) => ({ ...s, [k]: !s[k] }));
  };

  return (
    <div className="sn-dashboard-wrap">
      <header className="sn-dashboard-header">
        <div className="sn-dashboard-header__top">
          <div className="sn-dashboard-header__titles">
            <h1 className="sn-dashboard-page-title">Tableau de bord</h1>
            <p className="sn-dashboard-sub">Pilotage commercial et trésorerie</p>
          </div>
          {data?.meta && (
            <div className="sn-dashboard-header__period" role="status">
              <span className="sn-dashboard-header__period-label">Période active</span>
              <span className="sn-dashboard-header__period-dates">
                {new Date(data.meta.period.start).toLocaleDateString("fr-FR")} —{" "}
                {new Date(data.meta.period.end).toLocaleDateString("fr-FR")}
              </span>
              <span className="sn-dashboard-header__period-meta">
                {data.meta.date_mode === "custom_range" ? "Plage fixe" : "Glissant"} ·{" "}
                {data.meta.applied_filters.scope === "self" ? "Vos dossiers" : "Organisation"}
              </span>
            </div>
          )}
        </div>

        <div className="sn-dashboard-filters sn-dashboard-filters--compact">
          <label>
            Période
            <select value={range} onChange={(e) => updateParam("range", e.target.value)} disabled={loading}>
              {RANGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {range === "custom" && (
            <>
              <label>
                Du
                <input type="date" value={dateFrom} onChange={(e) => updateParam("date_from", e.target.value)} />
              </label>
              <label>
                Au
                <input type="date" value={dateTo} onChange={(e) => updateParam("date_to", e.target.value)} />
              </label>
            </>
          )}
          <label>
            Commercial
            <select
              value={assignedUserId}
              onChange={(e) => updateParam("assigned_user_id", e.target.value)}
              disabled={loading || !canFilterScope}
              title={!canFilterScope ? "Restreint à votre périmètre (lecture limitée)" : undefined}
            >
              <option value="">Tous</option>
              {(meta?.users ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email || u.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Source
            <select value={sourceId} onChange={(e) => updateParam("source_id", e.target.value)} disabled={loading}>
              <option value="">Toutes</option>
              {(meta?.sources ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {loading && (
        <div className="sn-dashboard-loading" aria-busy="true">
          <div className="sn-dashboard-loading__grid sn-dashboard-loading__grid--hero">
            <div className="sn-dashboard-loading__card sn-dashboard-loading__card--primary" />
            <div className="sn-dashboard-loading__grid-secondary">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="sn-dashboard-loading__card" />
              ))}
            </div>
          </div>
          <p className="sn-dashboard-loading__text">Chargement des indicateurs…</p>
        </div>
      )}

      {err && (
        <Card variant="app" className="sn-dashboard-error sn-card">
          <p className="sn-dashboard-error__title">Impossible de charger le tableau de bord</p>
          <p className="sn-dashboard-error__msg">{err}</p>
        </Card>
      )}

      {!loading && !err && data?.meta?.formulas && (
        <details className="sn-dashboard-formulas">
          <summary>Définitions des indicateurs (cohorte, stock, méthodes)</summary>
          <ul>
            {Object.entries(data.meta.formulas ?? {}).map(([k, v]) => (
              <li key={k}>
                <strong>{k}</strong> — {v}
              </li>
            ))}
          </ul>
        </details>
      )}

      {!loading && !err && isEmptyCohort && (
        <div className="sn-dashboard-empty-banner">
          Aucun lead ni devis sur la période sélectionnée — élargissez la fenêtre ou retirez un filtre.
        </div>
      )}

      {/* Bandeau insight + hero */}
      {!loading && !err && insight && kpis && fc && (
        <>
          <section className="sn-dashboard-insight sn-dashboard-insight--premium" aria-label="Synthèse IA">
            <div className="sn-dashboard-insight__icon" aria-hidden>✦</div>
            <div className="sn-dashboard-insight__body">
              <p className="sn-dashboard-insight__headline">{insight.headline}</p>
              {insight.alerts.length > 0 && (
                <ul className="sn-dashboard-insight__alerts">
                  {insight.alerts.map((a) => (
                    <li key={a.id} className="sn-dashboard-insight__alert">
                      <span className={insightToneBadgeClass(a.tone)}>{a.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="sn-dashboard-insight__metrics">
              {insight.metrics.map((m) => (
                <div key={m.label} className="sn-dashboard-insight__metric">
                  <span className="sn-dashboard-insight__metric-label">{m.label}</span>
                  <span className="sn-dashboard-insight__metric-value sn-dashboard-num">{m.value}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="sn-dashboard-section sn-dashboard-section--hero-kpi" aria-labelledby="sn-dashboard-hero-heading">
            <h2 id="sn-dashboard-hero-heading" className="sn-dashboard-section-title">
              Synthèse financière
            </h2>

            <div className="sn-dashboard-hero-layout">
              <div className="sn-dashboard-hero-primary">
                <article
                  className="sn-dashboard-kpi-card sn-dashboard-kpi-card--primary sn-dashboard-kpi-card--mega sn-card"
                  title="Chiffre d’affaires des devis acceptés, comptabilisés selon la date d’acceptation dans la fenêtre sélectionnée."
                >
                  <div className="sn-dashboard-kpi-card__accent" aria-hidden />
                  <div className="sn-dashboard-kpi-label">CA signé (période)</div>
                  <div className="sn-dashboard-kpi-value sn-dashboard-kpi-value--xl sn-dashboard-num">
                    {eur(kpis.revenue_signed_accepted_in_period)}
                  </div>
                  <p className="sn-dashboard-kpi-sub">TTC · date d’acceptation dans la période</p>
                  <p className="sn-dashboard-kpi-hint">
                    Cohorte création (déjà signés) :{" "}
                    <span className="sn-dashboard-num">{eur(kpis.revenue_signed_created_in_period)}</span>
                  </p>
                </article>
                <div className="sn-dashboard-hero-strip">
                  <span>
                    CA facturé (période) : <strong className="sn-dashboard-num">{eur(kpis.revenue_invoiced_ttc)}</strong>
                  </span>
                  <span className="sn-dashboard-hero-strip__sep" aria-hidden>
                    ·
                  </span>
                  <span>
                    Signatures (période) :{" "}
                    <strong className="sn-dashboard-num">{kpis.quotes_accepted_in_period_count}</strong>
                  </span>
                </div>
              </div>

              <div className="sn-dashboard-hero-secondary">
                <article
                  className="sn-dashboard-kpi-card sn-dashboard-kpi-card--secondary sn-card"
                  title="Paiements enregistrés sur la période (filtrés par lead si renseigné)."
                >
                  <div className="sn-dashboard-kpi-card__accent sn-dashboard-kpi-card__accent--subtle" aria-hidden />
                  <div className="sn-dashboard-kpi-label">Encaissé</div>
                  <div className="sn-dashboard-kpi-value sn-dashboard-num">{eur(kpis.cash_collected_ttc)}</div>
                  <KpiSparkline values={timelineTail.map((r) => safeNum(r.cash_collected))} color="#0ea5e9" />
                  <p className="sn-dashboard-kpi-sub">TTC · encaissements sur la période</p>
                </article>
                <article
                  className="sn-dashboard-kpi-card sn-dashboard-kpi-card--secondary sn-card"
                  title="Soldes restants sur factures ouvertes, périmètre filtre appliqué."
                >
                  <div className="sn-dashboard-kpi-card__accent sn-dashboard-kpi-card__accent--subtle" aria-hidden />
                  <div className="sn-dashboard-kpi-label">Reste à encaisser</div>
                  <div className="sn-dashboard-kpi-value sn-dashboard-num">{eur(kpis.remaining_to_collect_ttc)}</div>
                  <p className="sn-dashboard-kpi-sub">TTC · factures ouvertes</p>
                </article>
                <article
                  className="sn-dashboard-kpi-card sn-dashboard-kpi-card--secondary sn-card"
                  title="Montant TTC des devis prêts ou envoyés non signés — instantané."
                >
                  <div className="sn-dashboard-kpi-card__accent sn-dashboard-kpi-card__accent--subtle" aria-hidden />
                  <div className="sn-dashboard-kpi-label">Pipeline à signer</div>
                  <div className="sn-dashboard-kpi-value sn-dashboard-num">{eur(fc.pipeline_quotes_to_sign_ttc)}</div>
                  <KpiSparkline values={timelineTail.map((r) => safeNum(r.quotes_signed))} color="#7c3aed" />
                  <p className="sn-dashboard-kpi-sub">Instantané · non signés</p>
                </article>
                <article
                  className="sn-dashboard-kpi-card sn-dashboard-kpi-card--secondary sn-dashboard-kpi-card--gauge sn-card"
                  title="Devis créés sur la période déjà acceptés ÷ devis créés. Stock : taux instantané sur l’ouvert."
                >
                  <div className="sn-dashboard-kpi-card__accent sn-dashboard-kpi-card__accent--subtle" aria-hidden />
                  <div className="sn-dashboard-kpi-label">Conversion devis → signé</div>
                  <ConversionGauge
                    pctValue={safeNum(kpis.sign_rate_cohort_created_pct)}
                    label="cohorte"
                  />
                  <p className="sn-dashboard-kpi-sub">Cohorte création sur la période</p>
                  <p className="sn-dashboard-kpi-hint">
                    Stock ouvert : <span className="sn-dashboard-num">{pct(kpis.sign_rate_stock_pct)}</span>
                  </p>
                </article>
                <article
                  className="sn-dashboard-kpi-card sn-dashboard-kpi-card--secondary sn-card"
                  title="Délai moyen entre envoi du devis et acceptation, pour les devis acceptés dans la période."
                >
                  <div className="sn-dashboard-kpi-card__accent sn-dashboard-kpi-card__accent--subtle" aria-hidden />
                  <div className="sn-dashboard-kpi-label">Délai moyen</div>
                  <div className="sn-dashboard-kpi-value sn-dashboard-num">{fmtDays(kpis.avg_sent_to_sign_days)}</div>
                  <p className="sn-dashboard-kpi-sub">Envoyé → signé</p>
                  <p className="sn-dashboard-kpi-hint">
                    Création → acceptation :{" "}
                    <span className="sn-dashboard-num">{fmtDays(kpis.avg_quote_cycle_days)}</span>
                  </p>
                </article>
                <article
                  className="sn-dashboard-kpi-card sn-dashboard-kpi-card--secondary sn-card"
                  title="Pipeline commercial pondéré par probabilité de signature."
                >
                  <div className="sn-dashboard-kpi-card__accent sn-dashboard-kpi-card__accent--subtle" aria-hidden />
                  <div className="sn-dashboard-kpi-label">Pipeline pondéré</div>
                  <div className="sn-dashboard-kpi-value sn-dashboard-num">{eur(weighted)}</div>
                  <p className="sn-dashboard-kpi-sub">{fc.weighted_method_short ?? fc.weighted_method}</p>
                </article>
              </div>
            </div>
          </section>
        </>
      )}

      <nav className="sn-dashboard-actions" aria-label="Raccourcis">
        <Link className="sn-dashboard-action-link" to="/leads">
          Pipeline leads
        </Link>
        <Link className="sn-dashboard-action-link" to="/quotes">
          Devis
        </Link>
        <Link className="sn-dashboard-action-link" to="/finance">
          Trésorerie
        </Link>
        <Link className="sn-dashboard-action-link" to="/invoices">
          Factures
        </Link>
      </nav>

      {/* Pipeline */}
      {data?.pipeline && (
        <section className="sn-dashboard-section" aria-label="Pipeline">
          <h2 className="sn-dashboard-section-title">Pipeline commercial</h2>
          <p className="sn-dashboard-pipeline-summary">
            <span className="sn-dashboard-num">
              <strong>{data.pipeline.pipeline_summary.open_leads_count}</strong> leads ouverts
            </span>
            <span className="sn-dashboard-pipeline-summary__sep">·</span>
            <span className="sn-dashboard-num">
              <strong>{fmtPotentiel(pipelinePotentialTotal)}</strong> de potentiel estimé
            </span>
            <span className="sn-dashboard-pipeline-summary__sep">·</span>
            <span className="sn-dashboard-pipeline-summary__muted">
              {data.pipeline.pipeline_summary.lost_leads_count} perdus ·{" "}
              {data.pipeline.pipeline_summary.clients_active_count ??
                data.pipeline.pipeline_summary.signed_leads_count}{" "}
              clients actifs · {data.pipeline.pipeline_summary.archived_leads_count} archivés
            </span>
          </p>
          <div className="sn-dashboard-summary-sn-row">
            <span className="sn-badge sn-badge-info">
              Ouverts <strong>{data.pipeline.pipeline_summary.open_leads_count}</strong>
            </span>
            <span className="sn-badge sn-badge-danger">
              Perdus <strong>{data.pipeline.pipeline_summary.lost_leads_count}</strong>
            </span>
            <span className="sn-badge sn-badge-success">
              Clients{" "}
              <strong>
                {data.pipeline.pipeline_summary.clients_active_count ??
                  data.pipeline.pipeline_summary.signed_leads_count}
              </strong>
            </span>
            <span className="sn-badge sn-badge-warn">
              Archivés <strong>{data.pipeline.pipeline_summary.archived_leads_count}</strong>
            </span>
          </div>
          {data.pipeline.notes?.summary_badges && (
            <p className="sn-dashboard-micro-note">{data.pipeline.notes.summary_badges}</p>
          )}

          <Card variant="premium" padding="md" className="sn-dashboard-pipeline-card">
            <div className="sn-dashboard-pipeline-bar" role="img" aria-label="Répartition des leads ouverts par étape">
              {pipelineTotal > 0 ? (
                data.pipeline.leads_by_stage.map((st, i) => {
                  const w = (100 * st.leads_count) / pipelineTotal;
                  if (st.leads_count === 0) return null;
                  return (
                    <div
                      key={st.stage_id}
                      className={`sn-dashboard-pipeline-seg${st.is_closed ? " sn-dashboard-pipeline-seg--closed" : ""}`}
                      style={{
                        flex: `${w} 1 0`,
                        minWidth: "2%",
                      }}
                      title={`${st.stage_name}: ${st.leads_count}`}
                    >
                      {st.leads_count}
                    </div>
                  );
                })
              ) : (
                <div className="sn-dashboard-pipeline-empty">Aucun lead ouvert sur ce périmètre.</div>
              )}
            </div>

            <div className="sn-dashboard-pipeline-legend">
              {data.pipeline.leads_by_stage.map((st, i) => (
                <span key={st.stage_id} className="sn-dashboard-pipeline-legend__item">
                  <span className={pipelineLegendBadgeClass(i, st.is_closed)} aria-hidden />
                  <span className="sn-dashboard-pipeline-legend__name">{st.stage_name}</span>
                  <span className="sn-dashboard-pipeline-legend__count sn-dashboard-num">{st.leads_count}</span>
                </span>
              ))}
            </div>

            <div className="sn-dashboard-stage-grid">
              {data.pipeline.leads_by_stage.map((st, i) => (
                <div
                  key={st.stage_id}
                  className={`sn-dashboard-stage-tile${st.is_closed ? " sn-dashboard-stage-tile--closed" : ""}`}
                >
                  <div className="sn-dashboard-stage-tile__name">{st.stage_name}</div>
                  <div className="sn-dashboard-stage-tile__count sn-dashboard-num">{st.leads_count}</div>
                  {st.total_potential_revenue > 0 ? (
                    <div className="sn-dashboard-stage-tile__pot">
                      <span className="sn-dashboard-num">{eur(st.total_potential_revenue)}</span>{" "}
                      <span className="sn-dashboard-stage-tile__pot-label">potentiel estim.</span>
                    </div>
                  ) : (
                    <div className="sn-dashboard-stage-tile__pot sn-dashboard-stage-tile__pot--muted">—</div>
                  )}
                  <div
                    className={`sn-dashboard-stage-tile__bar${st.is_closed ? " sn-dashboard-stage-tile__bar--closed" : " sn-dashboard-stage-tile__bar--open"}`}
                    aria-hidden
                  />
                </div>
              ))}
            </div>
            {data.pipeline.notes?.potential_revenue && (
              <p className="sn-dashboard-micro-note">{data.pipeline.notes.potential_revenue}</p>
            )}

            <details className="sn-dashboard-conv-details">
              <summary>Conversion lead → devis (détail analyste)</summary>
              <div className="sn-dashboard-conv-grid">
                <div>
                  <h3 className="sn-dashboard-subhead">Cohorte création</h3>
                  <p className="sn-dashboard-conv-big sn-dashboard-num">
                    {pct(data.pipeline.lead_conversion_summary.cohort_created.lead_to_quote_rate)}
                  </p>
                  <p className="sn-dashboard-micro-note">
                    {data.pipeline.lead_conversion_summary.cohort_created.leads_with_quote_count} /{" "}
                    {data.pipeline.lead_conversion_summary.cohort_created.leads_total} leads ·{" "}
                    <em>{data.pipeline.lead_conversion_summary.cohort_created.formula}</em>
                  </p>
                </div>
                <div>
                  <h3 className="sn-dashboard-subhead">Stock ouvert</h3>
                  <p className="sn-dashboard-conv-big sn-dashboard-num">
                    {pct(data.pipeline.lead_conversion_summary.stock_open_leads.lead_to_quote_rate)}
                  </p>
                  <p className="sn-dashboard-micro-note">
                    {data.pipeline.lead_conversion_summary.stock_open_leads.open_leads_with_quote_count} /{" "}
                    {data.pipeline.lead_conversion_summary.stock_open_leads.open_leads_count} ouverts ·{" "}
                    <em>{data.pipeline.lead_conversion_summary.stock_open_leads.formula}</em>
                  </p>
                </div>
              </div>
            </details>
          </Card>
        </section>
      )}

      {/* Commerciaux */}
      {data?.commercial_performance && (
        <section className="sn-dashboard-section" aria-label="Performance commerciale">
          <div className="sn-dashboard-section-head">
            <h2 className="sn-dashboard-section-title">Équipe commerciale</h2>
            <button
              type="button"
              className="sn-dashboard-table-toggle"
              onClick={() => setCommercialExpanded((v) => !v)}
            >
              {commercialExpanded ? "Vue compacte" : "Toutes les colonnes"}
            </button>
          </div>
          <div className="sn-dashboard-table-wrap">
            <table
              className={`sn-ui-table sn-dashboard-table sn-dashboard-table--pilotage${commercialExpanded ? " sn-dashboard-table--expanded" : ""}`}
            >
              <thead>
                <tr>
                  <th className="sn-dashboard-th-narrow">#</th>
                  <th className="sn-dashboard-th--key">Commercial</th>
                  <th className="sn-dashboard-th--secondary">Leads créés</th>
                  <th className="sn-dashboard-th--secondary">Devis</th>
                  <th className="sn-dashboard-th--secondary">Envoyés</th>
                  <th className="sn-dashboard-th--num sn-dashboard-th--key">Signés</th>
                  <th className="sn-dashboard-th--num sn-dashboard-th--key">Taux</th>
                  <th className="sn-dashboard-th--num sn-dashboard-th--key">CA signé</th>
                  <th className="sn-dashboard-th--secondary sn-dashboard-th--num">Panier moy.</th>
                  <th className="sn-dashboard-th--num sn-dashboard-th--key">Délai</th>
                </tr>
              </thead>
              <tbody>
                {data.commercial_performance.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="sn-dashboard-table-empty">
                      Aucun lead créé sur la période pour ce filtre.
                    </td>
                  </tr>
                ) : (
                  data.commercial_performance.map((r) => {
                    const rev = safeNum(r.revenue_signed_ttc);
                    const barPct = Math.min(100, (rev / maxCommercialRev) * 100);
                    return (
                      <tr
                        key={r.user_id ?? "_none"}
                        className={r.rank === 1 ? "sn-dashboard-tr-top" : undefined}
                      >
                        <td className="sn-dashboard-td-rank sn-dashboard-num">{r.rank}</td>
                        <td className="sn-dashboard-td-name">
                          {r.display_name}
                          {r.rank === 1 && <span className="sn-badge sn-badge-success">Top CA</span>}
                        </td>
                        <td className="sn-dashboard-td--secondary sn-dashboard-num">{r.leads_created_count}</td>
                        <td className="sn-dashboard-td--secondary sn-dashboard-num">{r.quotes_count}</td>
                        <td className="sn-dashboard-td--secondary sn-dashboard-num">{r.quotes_sent_count}</td>
                        <td className="sn-dashboard-td-num sn-dashboard-num">{r.quotes_signed_count}</td>
                        <td className="sn-dashboard-td-num sn-dashboard-num" title={r.sign_rate_formula}>
                          {pct(r.sign_rate)}
                        </td>
                        <td className="sn-dashboard-td-money">
                          <span className="sn-dashboard-cell-bar-wrap" aria-hidden>
                            <span className="sn-dashboard-cell-bar" style={{ width: `${barPct}%` }} />
                          </span>
                          <span className="sn-dashboard-num">{eur(r.revenue_signed_ttc)}</span>
                        </td>
                        <td className="sn-dashboard-td--secondary sn-dashboard-td-num sn-dashboard-num">
                          {r.avg_quote_value_ttc != null ? eur(r.avg_quote_value_ttc) : "—"}
                        </td>
                        <td className="sn-dashboard-td-num sn-dashboard-num">{fmtDays(r.avg_time_to_sign_days)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Sources */}
      {data?.acquisition_performance && (
        <section className="sn-dashboard-section" aria-label="Acquisition">
          <div className="sn-dashboard-section-head">
            <h2 className="sn-dashboard-section-title">Acquisition par source</h2>
            <button
              type="button"
              className="sn-dashboard-table-toggle"
              onClick={() => setSourcesExpanded((v) => !v)}
            >
              {sourcesExpanded ? "Vue compacte" : "Toutes les colonnes"}
            </button>
          </div>

          {/* Layout donut + tableau côte à côte */}
          <div className="sn-dashboard-sources-layout">
            <SourceDonutChart rows={data.acquisition_performance} />
            <div className="sn-dashboard-sources-table-wrap">
              <div className="sn-dashboard-table-wrap">
                <table
                  className={`sn-ui-table sn-dashboard-table sn-dashboard-table--sources sn-dashboard-table--pilotage${sourcesExpanded ? " sn-dashboard-table--expanded" : ""}`}
            >
              <thead>
                <tr>
                  <th className="sn-dashboard-th-narrow">#</th>
                  <th className="sn-dashboard-th--key">Source</th>
                  <th className="sn-dashboard-th--num sn-dashboard-th--key">Leads</th>
                  <th className="sn-dashboard-th--secondary sn-dashboard-th--num">Devis</th>
                  <th className="sn-dashboard-th--num sn-dashboard-th--key">Signés</th>
                  <th className="sn-dashboard-th--secondary sn-dashboard-th--num">Lead → devis</th>
                  <th className="sn-dashboard-th--num sn-dashboard-th--key">Taux sign.</th>
                  <th className="sn-dashboard-th--num sn-dashboard-th--key">CA signé</th>
                  <th className="sn-dashboard-th--secondary sn-dashboard-th--num">Panier moy.</th>
                </tr>
              </thead>
              <tbody>
                {data.acquisition_performance.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="sn-dashboard-table-empty">
                      Aucune source sur la période.
                    </td>
                  </tr>
                ) : (
                  data.acquisition_performance.map((r, idx) => {
                    const rev = safeNum(r.revenue_signed_ttc);
                    const barPct = Math.min(100, (rev / maxSourceRev) * 100);
                    return (
                      <tr key={r.source_id} className={idx === 0 ? "sn-dashboard-tr-top" : undefined}>
                        <td className="sn-dashboard-td-rank sn-dashboard-num">{idx + 1}</td>
                        <td className="sn-dashboard-td-name">
                          {r.source_name}
                          {idx === 0 && <span className="sn-badge sn-badge-info">Top volume</span>}
                        </td>
                        <td className="sn-dashboard-td-num sn-dashboard-num">{r.leads_count}</td>
                        <td className="sn-dashboard-td--secondary sn-dashboard-td-num sn-dashboard-num">
                          {r.quotes_count}
                        </td>
                        <td className="sn-dashboard-td-num sn-dashboard-num">{r.quotes_signed_count}</td>
                        <td className="sn-dashboard-td--secondary sn-dashboard-td-num sn-dashboard-num" title={r.lead_to_quote_formula}>
                          {pct(r.lead_to_quote_rate)}
                        </td>
                        <td className="sn-dashboard-td-num sn-dashboard-num" title={r.quote_sign_formula}>
                          {pct(r.quote_sign_rate)}
                        </td>
                        <td className="sn-dashboard-td-money">
                          <span className="sn-dashboard-cell-bar-wrap" aria-hidden>
                            <span className="sn-dashboard-cell-bar" style={{ width: `${barPct}%` }} />
                          </span>
                          <span className="sn-dashboard-num" title={r.revenue_signed_formula}>
                            {eur(r.revenue_signed_ttc)}
                          </span>
                        </td>
                        <td className="sn-dashboard-td--secondary sn-dashboard-td-num sn-dashboard-num">
                          {r.avg_quote_value_ttc != null ? eur(r.avg_quote_value_ttc) : "—"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
                </table>
              </div>
            </div>{/* end sn-dashboard-sources-table-wrap */}
          </div>{/* end sn-dashboard-sources-layout */}
        </section>
      )}

      {/* Marge matériel */}
      {data?.margin_overview && (
        <section className="sn-dashboard-section" aria-label="Marge matériel">
          <h2 className="sn-dashboard-section-title">Marge matériel</h2>
          <p className="sn-dashboard-margin-intro">
            Calculée uniquement sur les lignes avec coût d’achat (matériel). Les prestations (installation, services) sont
            exclues.
          </p>
          {data.margin_overview.lines_excluded_count > 0 && (
            <p className="sn-dashboard-micro-note sn-dashboard-micro-note--emphasis">
              <strong className="sn-dashboard-num">{data.margin_overview.lines_excluded_count}</strong> ligne
              {data.margin_overview.lines_excluded_count > 1 ? "s" : ""} de devis exclue
              {data.margin_overview.lines_excluded_count > 1 ? "s" : ""} du calcul sur la période (sans prix d’achat).
            </p>
          )}
          <Card variant="premium" padding="md" className="sn-dashboard-margin-card">
            <div className="sn-dashboard-kpi-grid sn-dashboard-kpi-grid--margin sn-dashboard-kpi-grid--material">
              <div className="sn-dashboard-kpi-card sn-dashboard-kpi-card--secondary sn-dashboard-kpi-card--flat">
                <div className="sn-dashboard-kpi-label">Marge HT matériel</div>
                <div className="sn-dashboard-kpi-value sn-dashboard-num">{eur(data.margin_overview.material_margin_ht)}</div>
              </div>
              <div className="sn-dashboard-kpi-card sn-dashboard-kpi-card--secondary sn-dashboard-kpi-card--flat">
                <div className="sn-dashboard-kpi-label">Taux de marge matériel</div>
                <div className="sn-dashboard-kpi-value sn-dashboard-num">{pct(data.margin_overview.material_margin_pct)}</div>
              </div>
              <div className="sn-dashboard-kpi-card sn-dashboard-kpi-card--secondary sn-dashboard-kpi-card--flat">
                <div className="sn-dashboard-kpi-label">CA HT matériel / coût matériel</div>
                <div className="sn-dashboard-kpi-value sn-dashboard-kpi-value--split sn-dashboard-num">
                  {eur(data.margin_overview.material_sales_ht)} / {eur(data.margin_overview.material_purchase_ht)}
                </div>
              </div>
            </div>
            <p className="sn-dashboard-micro-note">
              Périmètre : {data.margin_overview.quotes_in_period_count} devis accepté
              {data.margin_overview.quotes_in_period_count > 1 ? "s" : ""} sur la période sélectionnée.
            </p>
          </Card>

          {data.margin_top_quotes.length > 0 && (
            <>
              <h3 className="sn-dashboard-section-title sn-dashboard-section-title--sub">Principaux devis</h3>
              <div className="sn-dashboard-table-wrap">
                <table className="sn-ui-table sn-dashboard-table sn-dashboard-table--pilotage">
                  <thead>
                    <tr>
                      <th>Devis</th>
                      <th>Client / lead</th>
                      <th className="sn-dashboard-th--num">Lignes excl.</th>
                      <th className="sn-dashboard-th--num">Marge HT</th>
                      <th className="sn-dashboard-th--num">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.margin_top_quotes.map((m) => (
                      <tr key={m.quote_id}>
                        <td>
                          <Link to={`/quotes/${m.quote_id}`}>{m.quote_number || m.quote_id.slice(0, 8)}</Link>
                        </td>
                        <td>{m.entity_label || "—"}</td>
                        <td className="sn-dashboard-td-num sn-dashboard-num">
                          {m.lines_excluded_count > 0 ? m.lines_excluded_count : "—"}
                        </td>
                        <td className="sn-dashboard-td-num sn-dashboard-num">{m.margin_ht != null ? eur(m.margin_ht) : "—"}</td>
                        <td className="sn-dashboard-td-num sn-dashboard-num">{m.margin_pct != null ? pct(m.margin_pct) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {/* Activité */}
      {data?.activity_recent_7d && (
        <section className="sn-dashboard-section" aria-label="Activité">
          <h2 className="sn-dashboard-section-title">Activité &amp; tendance</h2>

          <div className="sn-dashboard-callout sn-dashboard-callout--accent">
            <strong>Rythme (7 jours glissants)</strong> — indépendant de la période sélectionnée ci-dessus. Comparez-le à la
            tendance pour mesurer le court terme.
          </div>

          <Card variant="app" padding="md" className="sn-dashboard-activity-card">
            <div className="sn-dashboard-kpi-grid sn-dashboard-kpi-grid--compact">
              <div>
                <div className="sn-dashboard-kpi-label">Leads créés</div>
                <div className="sn-dashboard-kpi-value sn-dashboard-num">{data.activity_recent_7d.leads_created_7d}</div>
              </div>
              <div>
                <div className="sn-dashboard-kpi-label">Devis envoyés</div>
                <div className="sn-dashboard-kpi-value sn-dashboard-num">{data.activity_recent_7d.quotes_sent_7d}</div>
              </div>
              <div>
                <div className="sn-dashboard-kpi-label">Devis signés</div>
                <div className="sn-dashboard-kpi-value sn-dashboard-num">{data.activity_recent_7d.quotes_signed_7d}</div>
              </div>
              <div>
                <div className="sn-dashboard-kpi-label">Factures</div>
                <div className="sn-dashboard-kpi-value sn-dashboard-num">{data.activity_recent_7d.invoices_issued_7d}</div>
              </div>
              <div>
                <div className="sn-dashboard-kpi-label">Encaissements</div>
                <div className="sn-dashboard-kpi-value sn-dashboard-num">{eur(data.activity_recent_7d.cash_collected_7d)}</div>
              </div>
            </div>
            {data.activity_recent_7d.note && <p className="sn-dashboard-micro-note">{data.activity_recent_7d.note}</p>}
          </Card>

          {timelineTail.length > 0 && (
            <>
              <div className="sn-dashboard-trend-head">
                <h3 className="sn-dashboard-section-title sn-dashboard-section-title--sub sn-dashboard-section-title--inline">
                  Tendance sur la période sélectionnée
                </h3>
                {trendSentence && <p className="sn-dashboard-trend-line">{trendSentence}</p>}
              </div>
              {/* Toggles séries */}
              <div className="sn-dashboard-timeline-toggles" role="group" aria-label="Séries affichées">
                {(Object.keys(SERIES_LABELS) as SeriesKey[]).map((k) => (
                  <label key={k} className="sn-dashboard-timeline-toggle" style={{ "--toggle-color": CHART_COLORS[k] } as React.CSSProperties}>
                    <input type="checkbox" checked={seriesVis[k]} onChange={() => toggleSeries(k)} />
                    <span className="sn-dashboard-timeline-toggle__dot" style={{ background: CHART_COLORS[k] }} aria-hidden />
                    {SERIES_LABELS[k]}
                  </label>
                ))}
              </div>

              {/* Area Chart principal */}
              <Card variant="app" padding="none" className="sn-dashboard-chart-card">
                <TimelineAreaChart rows={timelineTail} seriesVis={seriesVis} />
              </Card>

              {timelineRows.length > 31 && (
                <p className="sn-dashboard-micro-note">
                  {timelineTail.length} derniers jours affichés sur {timelineRows.length} (lisibilité).
                </p>
              )}

              {/* Tableau détail replié */}
              <details className="sn-dashboard-timeline-details">
                <summary className="sn-dashboard-timeline-details__toggle">Voir le détail jour par jour</summary>
                <div className="sn-dashboard-timeline-wrap">
                  <table className="sn-ui-table sn-dashboard-timeline-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        {seriesVis.leads && <th>Leads</th>}
                        {seriesVis.sent && <th>Envoyés</th>}
                        {seriesVis.signed && <th>Signés</th>}
                        {seriesVis.invoices && <th>Factures</th>}
                        {seriesVis.cash && <th>Encais.</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {timelineTail.map((row) => (
                        <tr key={String(row.date)}>
                          <td className="sn-dashboard-timeline-date">{fmtDay(String(row.date))}</td>
                          {seriesVis.leads && <td className="sn-dashboard-num">{row.leads_created}</td>}
                          {seriesVis.sent && <td className="sn-dashboard-num">{row.quotes_sent}</td>}
                          {seriesVis.signed && <td className="sn-dashboard-num">{row.quotes_signed}</td>}
                          {seriesVis.invoices && <td className="sn-dashboard-num">{row.invoices_issued}</td>}
                          {seriesVis.cash && <td className="sn-dashboard-num">{eur(row.cash_collected, { fraction: 0 })}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </section>
      )}

      {/* Prévisionnel */}
      {data?.forecast && (
        <section className="sn-dashboard-section" aria-label="Prévisionnel">
          <h2 className="sn-dashboard-section-title">Prévisions court terme</h2>
          <p className="sn-dashboard-section-lead">
            Projection cash et pipeline — les montants du pipeline instantané complètent la synthèse financière
            ci-dessus (pondération pour le scénario).
          </p>
          <Card variant="app" padding="md" className="sn-dashboard-forecast-card">
            <div className="sn-dashboard-forecast-grid sn-dashboard-forecast-grid--priority">
              <div className="sn-dashboard-forecast-item sn-dashboard-forecast-item--emphasis">
                <small>Pipeline pondéré (TTC)</small>
                <strong className="sn-dashboard-num">{eur(data.forecast.weighted_pipeline_ttc)}</strong>
                <span className="sn-dashboard-forecast-method">{data.forecast.weighted_method}</span>
              </div>
              <div className="sn-dashboard-forecast-item sn-dashboard-forecast-item--emphasis">
                <small>Cash attendu (&lt; 30 j.)</small>
                <strong className="sn-dashboard-num">{eur(data.forecast.expected_cash_short_term_30d_ttc)}</strong>
              </div>
              <div className="sn-dashboard-forecast-item sn-dashboard-forecast-item--danger">
                <small>Impayés / retard</small>
                <strong className="sn-dashboard-num">{eur(data.forecast.overdue_invoices_amount)}</strong>
                <Link className="sn-dashboard-forecast-link" to="/finance">
                  Voir trésorerie
                </Link>
              </div>
              <div className="sn-dashboard-forecast-item sn-dashboard-forecast-item--muted">
                <small>Pipeline brut à signer (TTC)</small>
                <strong className="sn-dashboard-num">{eur(data.forecast.pipeline_quotes_to_sign_ttc)}</strong>
                <span className="sn-dashboard-forecast-note">Instantané — aussi affiché en synthèse</span>
              </div>
            </div>
            <p className="sn-dashboard-forecast-foot">
              Pondération : READY_TO_SEND 50 % · SENT 65 % — hypothèse explicite, non probabiliste avancée.
            </p>
          </Card>
        </section>
      )}
    </div>
  );
}
