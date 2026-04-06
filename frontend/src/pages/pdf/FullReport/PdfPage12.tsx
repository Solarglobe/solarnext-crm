/**
 * Page 12 — Environnement
 * Donut autoconsommation + KPI CO2, arbres, voitures
 */

import React from "react";
import DonutP12 from "./components/DonutP12";

interface P12Data {
  meta?: Record<string, unknown>;
  env?: { autocons_pct?: number };
  v_co2?: string;
  v_trees?: string;
  v_cars?: string;
  v_co2_25?: string;
  v_trees_25?: string;
  v_cars_25?: string;
}

const EMPTY = "—";

function val(v: unknown): string {
  if (v == null || v === "") return EMPTY;
  return String(v);
}

export default function PdfPage12({ data }: { data?: P12Data }) {
  const meta = data?.meta ?? {};
  const autoconsPct = data?.env?.autocons_pct ?? 0;

  return (
    <div className="pdf-page">
      <h2 className="pdf-title">Environnement</h2>
      <div className="pdf-meta">
        <span>{val(meta.client)}</span>
        <span>{val(meta.ref)}</span>
        <span>{val(meta.date)}</span>
      </div>
      <div className="pdf-p12-content">
        <div className="pdf-p12-donut">
          <DonutP12 autoconsPct={autoconsPct} />
        </div>
        <div className="pdf-p12-kpis">
          <div className="pdf-kpi-card">
            <span className="pdf-kpi-label">CO₂ évité (an 1)</span>
            <span className="pdf-kpi-value">{val(data?.v_co2)}</span>
          </div>
          <div className="pdf-kpi-card">
            <span className="pdf-kpi-label">Arbres équivalents (an 1)</span>
            <span className="pdf-kpi-value">{val(data?.v_trees)}</span>
          </div>
          <div className="pdf-kpi-card">
            <span className="pdf-kpi-label">Voitures équivalentes (an 1)</span>
            <span className="pdf-kpi-value">{val(data?.v_cars)}</span>
          </div>
          <div className="pdf-kpi-card">
            <span className="pdf-kpi-label">CO₂ évité (25 ans)</span>
            <span className="pdf-kpi-value">{val(data?.v_co2_25)}</span>
          </div>
          <div className="pdf-kpi-card">
            <span className="pdf-kpi-label">Arbres (25 ans)</span>
            <span className="pdf-kpi-value">{val(data?.v_trees_25)}</span>
          </div>
          <div className="pdf-kpi-card">
            <span className="pdf-kpi-label">Voitures (25 ans)</span>
            <span className="pdf-kpi-value">{val(data?.v_cars_25)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
