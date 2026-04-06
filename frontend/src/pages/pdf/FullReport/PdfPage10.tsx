/**
 * Page 10 — Synthèse finale
 */

import React from "react";

interface P10Data {
  meta?: Record<string, unknown>;
  best?: Record<string, unknown>;
  hyp?: Record<string, unknown>;
}

const EMPTY = "—";

function val(v: unknown): string {
  if (v == null || v === "") return EMPTY;
  return String(v);
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export default function PdfPage10({ data }: { data?: P10Data }) {
  const meta = data?.meta ?? {};
  const best = data?.best ?? {};

  return (
    <div className="pdf-page">
      <h2 className="pdf-title">Synthèse</h2>
      <div className="pdf-meta">
        <span>{val(meta.client)}</span>
        <span>{val(meta.ref)}</span>
        <span>{val(meta.date)}</span>
      </div>
      <div className="pdf-kpi-grid pdf-kpi-large">
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">Puissance</span>
          <span className="pdf-kpi-value">{best.kwc != null ? `${best.kwc} kWc` : EMPTY}</span>
        </div>
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">ROI</span>
          <span className="pdf-kpi-value">{best.roi_years != null ? `${best.roi_years} ans` : EMPTY}</span>
        </div>
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">TRI</span>
          <span className="pdf-kpi-value">{num(best.tri_pct) != null ? `${num(best.tri_pct)} %` : EMPTY}</span>
        </div>
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">LCOE</span>
          <span className="pdf-kpi-value">{num(best.lcoe_eur_kwh) != null ? `${num(best.lcoe_eur_kwh)?.toFixed(3)} €/kWh` : EMPTY}</span>
        </div>
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">Économies an 1</span>
          <span className="pdf-kpi-value">{num(best.savings_year1_eur) != null ? `${num(best.savings_year1_eur)?.toLocaleString("fr-FR")} €` : EMPTY}</span>
        </div>
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">Gains 25 ans</span>
          <span className="pdf-kpi-value">{num(best.gains_25_eur) != null ? `${num(best.gains_25_eur)?.toLocaleString("fr-FR")} €` : EMPTY}</span>
        </div>
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">Autoprod</span>
          <span className="pdf-kpi-value">{num(best.autoprod_pct) != null ? `${num(best.autoprod_pct)} %` : EMPTY}</span>
        </div>
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">Autonomie</span>
          <span className="pdf-kpi-value">{num(best.autonomy_pct) != null ? `${num(best.autonomy_pct)} %` : EMPTY}</span>
        </div>
      </div>
      <div className="pdf-section">
        <div className="pdf-section-title">Configuration</div>
        <div className="pdf-value">Modules : {val(best.modules_label)}</div>
        <div className="pdf-value">Onduleur : {val(best.inverter_label)}</div>
      </div>
    </div>
  );
}
