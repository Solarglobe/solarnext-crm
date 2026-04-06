/**
 * Page 11 — Finance
 */

import React from "react";

interface P11Data {
  meta?: Record<string, unknown>;
  data?: { capex_ttc?: number; kwc?: number; battery_kwh?: number; economies_annuelles_25?: number[] };
}

const EMPTY = "—";

function val(v: unknown): string {
  if (v == null || v === "") return EMPTY;
  return String(v);
}

function num(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

export default function PdfPage11({ data }: { data?: P11Data }) {
  const meta = data?.meta ?? {};
  const d = data?.data ?? {};
  const economies = d.economies_annuelles_25 ?? [];
  const total25 = economies.reduce((a, b) => a + b, 0);

  return (
    <div className="pdf-page">
      <h2 className="pdf-title">Finance</h2>
      <div className="pdf-meta">
        <span>{val(meta.client)}</span>
        <span>{val(meta.ref)}</span>
        <span>{val(meta.date)}</span>
      </div>
      <div className="pdf-kpi-grid">
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">Capex TTC</span>
          <span className="pdf-kpi-value">{num(d.capex_ttc).toLocaleString("fr-FR")} €</span>
        </div>
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">Puissance</span>
          <span className="pdf-kpi-value">{num(d.kwc)} kWc</span>
        </div>
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">Batterie</span>
          <span className="pdf-kpi-value">{num(d.battery_kwh)} kWh</span>
        </div>
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">Économies 25 ans</span>
          <span className="pdf-kpi-value">{total25.toLocaleString("fr-FR")} €</span>
        </div>
      </div>
    </div>
  );
}
