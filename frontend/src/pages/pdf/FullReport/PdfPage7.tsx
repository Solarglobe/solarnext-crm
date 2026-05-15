/**
 * Page 7 — Origine / Destination énergie
 * Barres segmentées (origine conso, destination prod)
 */


interface P7Data {
  meta?: Record<string, unknown>;
  pct?: Record<string, number>;
  c_grid?: number;
  p_surplus?: number;
}

const EMPTY = "—";

function val(v: unknown): string {
  if (v == null || v === "") return EMPTY;
  return String(v);
}

export default function PdfPage7({ data }: { data?: P7Data }) {
  const meta = data?.meta ?? {};
  const pct = data?.pct ?? {};
  const pSurplus = data?.p_surplus ?? 0;

  const cPv = pct.c_pv_pct ?? 0;
  const cBat = pct.c_bat_pct ?? 0;
  const cGridPct = pct.c_grid_pct ?? 0;
  const pAuto = pct.p_auto_pct ?? 0;
  const pBat = pct.p_bat_pct ?? 0;
  const pSurplusPct = pct.p_surplus_pct ?? 0;

  return (
    <div className="pdf-page">
      <h2 className="pdf-title">Origine / Destination énergie</h2>
      <div className="pdf-meta">
        <span>{val(meta.client)}</span>
        <span>{val(meta.ref)}</span>
        <span>{val(meta.date)}</span>
      </div>
      <div className="pdf-p7-visual">
        <div className="pdf-p7-section">
          <div className="pdf-p7-label">Origine consommation</div>
          <div className="pdf-p7-bar">
            <span className="pdf-p7-seg pdf-p7-pv" style={{ width: `${cPv}%` }} />
            <span className="pdf-p7-seg pdf-p7-bat" style={{ width: `${cBat}%` }} />
            <span className="pdf-p7-seg pdf-p7-grid" style={{ width: `${cGridPct}%` }} />
          </div>
          <div className="pdf-p7-legend">
            <span>PV direct {cPv}%</span>
            <span>Batterie {cBat}%</span>
            <span>Réseau {cGridPct}%</span>
          </div>
        </div>
        <div className="pdf-p7-section">
          <div className="pdf-p7-label">Destination production</div>
          <div className="pdf-p7-bar">
            <span className="pdf-p7-seg pdf-p7-auto" style={{ width: `${pAuto}%` }} />
            <span className="pdf-p7-seg pdf-p7-bat" style={{ width: `${pBat}%` }} />
            <span className="pdf-p7-seg pdf-p7-surplus" style={{ width: `${pSurplusPct}%` }} />
          </div>
          <div className="pdf-p7-legend">
            <span>Autoconso {pAuto}%</span>
            <span>Batterie {pBat}%</span>
            <span>Surplus {pSurplusPct}%</span>
          </div>
        </div>
      </div>
      <div className="pdf-kpi-grid">
        <div className="pdf-kpi-card"><span className="pdf-kpi-label">Autonomie</span><span className="pdf-kpi-value">{100 - cGridPct} %</span></div>
        <div className="pdf-kpi-card"><span className="pdf-kpi-label">Autoconsommation</span><span className="pdf-kpi-value">{pAuto} %</span></div>
        <div className="pdf-kpi-card"><span className="pdf-kpi-label">Part réseau</span><span className="pdf-kpi-value">{cGridPct} %</span></div>
        <div className="pdf-kpi-card"><span className="pdf-kpi-label">Surplus</span><span className="pdf-kpi-value">{pSurplus.toLocaleString("fr-FR")} kWh</span></div>
      </div>
    </div>
  );
}
