/**
 * Page 1 — Couverture / Synthèse
 * KPI : Puissance, Autonomie, TRI, Gains
 */

import React from "react";

interface P1Data {
  p1_auto?: Record<string, unknown>;
}

const EMPTY = "—";

function val(v: unknown): string {
  if (v == null || v === "") return EMPTY;
  return String(v);
}

export default function PdfPage1({ data }: { data?: P1Data }) {
  const a = data?.p1_auto ?? {};
  const autonomieStr: string = a.p1_k_autonomie != null ? `${String(a.p1_k_autonomie)} %` : EMPTY;
  const triStr: string = a.p1_k_tri != null ? `${String(a.p1_k_tri)} %` : EMPTY;
  const gainsStr: string = a.p1_k_gains != null ? `${Number(a.p1_k_gains).toLocaleString("fr-FR")} €` : EMPTY;

  return (
    <div className="pdf-page">
      <h1 className="pdf-title">Étude photovoltaïque</h1>
      <div className="pdf-meta">
        <span>{val(a.p1_client)}</span>
        <span>{val(a.p1_ref)}</span>
        <span>{val(a.p1_date)}</span>
      </div>
      <p className="pdf-why">{val(a.p1_why)}</p>
      <div className="pdf-kpi-grid">
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">Puissance</span>
          <span className="pdf-kpi-value">{val(a.p1_k_puissance)} kWc</span>
        </div>
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">Autonomie</span>
          <span className="pdf-kpi-value">{autonomieStr}</span>
        </div>
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">TRI</span>
          <span className="pdf-kpi-value">{triStr}</span>
        </div>
        <div className="pdf-kpi-card">
          <span className="pdf-kpi-label">Gains 25 ans</span>
          <span className="pdf-kpi-value">{gainsStr}</span>
        </div>
      </div>
      <div className="pdf-params">
        {a.p1_param_kva ? <span>Compteur : {val(a.p1_param_kva)}</span> : null}
        {a.p1_param_reseau ? <span>Réseau : {val(a.p1_param_reseau)}</span> : null}
        {a.p1_param_conso ? <span>Conso : {val(a.p1_param_conso)}</span> : null}
      </div>
    </div>
  );
}
