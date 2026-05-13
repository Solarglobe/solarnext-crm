/**
 * Page 9 — Impact : gains cumulés sur 25 ans (scénario unique, scenarios_v2)
 * Aligné sur fullReport.p9 (pdfViewModel.mapper).
 */

import React from "react";
import ChartP9 from "./components/ChartP9";

interface P9Scenario {
  label?: string;
  cumul_25y?: number[];
  roi_year?: number | null;
  capex_eur?: number | null;
  avg_savings_eur_year?: number | null;
  final_cumul?: number | null;
}

interface P9Data {
  meta?: (Record<string, unknown> & { horizon_years_pdf?: number }) | undefined;
  scenario?: P9Scenario | null;
  error?: string | null;
  warnings?: string[];
}

const EMPTY = "—";

function val(v: unknown): string {
  if (v == null || v === "") return EMPTY;
  return String(v);
}

function fmtEuro(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return EMPTY;
  const sign = v < 0 ? "- " : "";
  return sign + Math.abs(Math.round(v)).toLocaleString("fr-FR") + " €";
}

function fmtRoiAns(y: number | null | undefined): string {
  if (y == null || !Number.isFinite(Number(y))) return EMPTY;
  const r = Math.round(Number(y));
  if (r <= 0) return EMPTY;
  return r === 1 ? "1 an" : `${r} ans`;
}

export default function PdfPage9({ data }: { data?: P9Data }) {
  const meta = data?.meta ?? {};
  const rawH = meta.horizon_years_pdf;
  const horizonYears =
    typeof rawH === "number" && Number.isFinite(rawH) && rawH > 0 ? Math.floor(rawH) : 25;

  const sc = data?.scenario ?? null;
  const finalNet =
    sc?.final_cumul != null && Number.isFinite(Number(sc.final_cumul)) ? Number(sc.final_cumul) : null;
  const series = sc?.cumul_25y ?? [];

  return (
    <div className="pdf-page">
      <h2 className="pdf-title">Impact — gains cumulés ({horizonYears} ans)</h2>
      <div className="pdf-meta">
        <span>{val(meta.client)}</span>
        <span>{val(meta.ref)}</span>
        <span>{val(meta.date)}</span>
      </div>
      <div className="pdf-hero-impact" style={{ textAlign: "center", margin: "12px 0" }}>
        <div style={{ fontSize: 11, opacity: 0.85 }}>Gain net estimé sur {horizonYears} ans</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#C39847" }}>
          {finalNet != null ? `${finalNet >= 0 ? "+ " : ""}${Math.abs(Math.round(finalNet)).toLocaleString("fr-FR")} €` : EMPTY}
        </div>
        {sc?.label ? <div style={{ fontSize: 10, marginTop: 6 }}>Scénario : {val(sc.label)}</div> : null}
      </div>
      <div className="pdf-chart-zone">
        <ChartP9 scenario={{ label: val(sc?.label), cumul_25y: series, roi_year: sc?.roi_year ?? null }} />
      </div>
      <div className="pdf-kpi-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">Investissement (TTC)</span>
          <span className="pdf-kpi-value">{fmtEuro(sc?.capex_eur ?? null)}</span>
        </div>
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">Économies annuelles moy.</span>
          <span className="pdf-kpi-value">{fmtEuro(sc?.avg_savings_eur_year ?? null)}</span>
        </div>
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">Rentabilité estimée</span>
          <span className="pdf-kpi-value">{fmtRoiAns(sc?.roi_year ?? null)}</span>
        </div>
      </div>
    </div>
  );
}
