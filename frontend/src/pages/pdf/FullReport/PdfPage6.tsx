/**
 * Page 6 — Répartition consommation
 * Barres empilées : direct PV, batterie, réseau
 */

import ChartP6 from "./components/ChartP6";

interface P6Data {
  p6?: {
    meta?: Record<string, unknown>;
    price?: number;
    dir?: number[];
    bat?: number[];
    grid?: number[];
    tot?: number[];
  };
}

const EMPTY = "—";

function val(v: unknown): string {
  if (v == null || v === "") return EMPTY;
  return String(v);
}

export default function PdfPage6({ data }: { data?: P6Data }) {
  const p6 = data?.p6 ?? {};
  const meta = p6.meta ?? {};
  const dir = p6.dir ?? [];
  const bat = p6.bat ?? [];
  const grid = p6.grid ?? [];
  const tot = p6.tot ?? [];
  const rawPrice = p6.price;
  const price =
    typeof rawPrice === "number" && Number.isFinite(rawPrice) ? rawPrice : null;

  const totDir = dir.reduce((a, b) => a + b, 0);
  const totBat = bat.reduce((a, b) => a + b, 0);
  const totGrid = grid.reduce((a, b) => a + b, 0);
  const totConso = tot.reduce((a, b) => a + b, 0) || 1;
  const autonomiePct = totConso > 0 ? Math.round((1 - totGrid / totConso) * 100) : 0;
  const autoPct = totConso > 0 ? Math.round(((totDir + totBat) / totConso) * 100) : 0;
  const gridEur = price != null ? (totGrid * price).toFixed(0) : "—";

  return (
    <div className="pdf-page">
      <h2 className="pdf-title">Répartition consommation</h2>
      <div className="pdf-meta">
        <span>{val(meta.client)}</span>
        <span>{val(meta.ref)}</span>
        <span>{val(meta.date)}</span>
      </div>
      <div className="pdf-chart-zone">
        <ChartP6 dir={dir} bat={bat} grid={grid} />
      </div>
      <div className="pdf-kpi-grid">
        <div className="pdf-kpi-card"><span className="pdf-kpi-label">Autonomie</span><span className="pdf-kpi-value">{autonomiePct} %</span></div>
        <div className="pdf-kpi-card"><span className="pdf-kpi-label">Autoconso</span><span className="pdf-kpi-value">{autoPct} %</span></div>
        <div className="pdf-kpi-card"><span className="pdf-kpi-label">Réseau</span><span className="pdf-kpi-value">{totGrid.toLocaleString("fr-FR")} kWh</span></div>
        <div className="pdf-kpi-card"><span className="pdf-kpi-label">Coût réseau</span><span className="pdf-kpi-value">{gridEur} €</span></div>
      </div>
    </div>
  );
}
