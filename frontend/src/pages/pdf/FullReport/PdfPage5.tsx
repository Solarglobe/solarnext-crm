/**
 * Page 5 — Journée type
 * SVG courbes : production, consommation, batterie (24h)
 */

import React from "react";
import ChartP5 from "./components/ChartP5";

interface P5Data {
  meta?: Record<string, unknown>;
  production_kw?: number[];
  consommation_kw?: number[];
  batterie_kw?: number[];
}

const EMPTY = "—";

function val(v: unknown): string {
  if (v == null || v === "") return EMPTY;
  return String(v);
}

export default function PdfPage5({ data }: { data?: P5Data }) {
  const meta = data?.meta ?? {};
  const prod = data?.production_kw ?? [];
  const conso = data?.consommation_kw ?? [];
  const batt = data?.batterie_kw ?? [];

  return (
    <div className="pdf-page">
      <h2 className="pdf-title">Journée type</h2>
      <div className="pdf-meta">
        <span>{val(meta.client)}</span>
        <span>{val(meta.ref)}</span>
        <span>{val(meta.date)}</span>
      </div>
      <div className="pdf-chart-zone">
        <ChartP5 production={prod} consommation={conso} batterie={batt} />
      </div>
    </div>
  );
}
