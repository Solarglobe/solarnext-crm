import React from "react";

interface P7VirtualBatteryData {
  meta?: Record<string, unknown>;
  title?: string;
  subtitle?: string;
  without_battery?: Record<string, unknown>;
  with_virtual_battery?: Record<string, unknown>;
  max_theoretical?: Record<string, unknown>;
  contribution?: Record<string, unknown>;
  limits?: string[];
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

function fmtKwh(v: unknown): string {
  const n = num(v);
  if (n == null) return EMPTY;
  return `${Math.round(n).toLocaleString("fr-FR")} kWh`;
}

function fmtPctFromRatio(v: unknown): string {
  const n = num(v);
  if (n == null) return EMPTY;
  return `${(n * 100).toFixed(1).replace(".", ",")} %`;
}

function fmtPtsFromRatio(v: unknown): string {
  const n = num(v);
  if (n == null) return EMPTY;
  return `${(n * 100).toFixed(1).replace(".", ",")} pts`;
}

export default function PdfPage7VirtualBattery({ data }: { data?: P7VirtualBatteryData | null }) {
  if (!data) return null;

  const meta = data.meta ?? {};
  const withoutBattery = data.without_battery ?? {};
  const withBattery = data.with_virtual_battery ?? {};
  const maxTheoretical = data.max_theoretical ?? {};
  const contribution = data.contribution ?? {};
  const limits = Array.isArray(data.limits) ? data.limits.slice(0, 3) : [];

  return (
    <div className="pdf-page pdf-page-p7vb">
      <h2 className="pdf-title">{val(data.title)}</h2>
      <div className="pdf-meta">
        <span>{val(meta.client)}</span>
        <span>{val(meta.ref)}</span>
        <span>{val(meta.date)}</span>
      </div>
      <p className="pdf-text pdf-p7vb-subtitle">{val(data.subtitle)}</p>

      <div className="pdf-p7vb-grid2">
        <div className="pdf-kpi-card pdf-p7vb-block">
          <div className="pdf-section-title">Sans batterie</div>
          <div className="pdf-p7vb-line"><span>Autonomie</span><strong>{fmtPctFromRatio(withoutBattery.autonomie_ratio)}</strong></div>
          <div className="pdf-p7vb-line"><span>PV utilisée</span><strong>{fmtKwh(withoutBattery.pv_used_kwh)}</strong></div>
          <div className="pdf-p7vb-line"><span>Import réseau</span><strong>{fmtKwh(withoutBattery.grid_import_kwh)}</strong></div>
        </div>

        <div className="pdf-kpi-card pdf-p7vb-block">
          <div className="pdf-section-title">Avec batterie virtuelle</div>
          <div className="pdf-p7vb-line"><span>Autonomie</span><strong>{fmtPctFromRatio(withBattery.autonomie_ratio)}</strong></div>
          <div className="pdf-p7vb-line"><span>PV utilisée totale</span><strong>{fmtKwh(withBattery.pv_total_used_kwh)}</strong></div>
          <div className="pdf-p7vb-line"><span>Dont restituée batterie</span><strong>{fmtKwh(withBattery.battery_discharged_kwh)}</strong></div>
          <div className="pdf-p7vb-line"><span>Import réseau</span><strong>{fmtKwh(withBattery.grid_import_kwh)}</strong></div>
        </div>
      </div>

      <div className="pdf-p7vb-grid2">
        <div className="pdf-kpi-card pdf-p7vb-block">
          <div className="pdf-section-title">Max théorique</div>
          <div className="pdf-p7vb-line"><span>Production</span><strong>{fmtKwh(maxTheoretical.production_kwh)}</strong></div>
          <div className="pdf-p7vb-line"><span>Consommation</span><strong>{fmtKwh(maxTheoretical.consumption_kwh)}</strong></div>
          <div className="pdf-p7vb-line"><span>Autonomie max</span><strong>{fmtPctFromRatio(maxTheoretical.autonomy_ratio)}</strong></div>
          <p className="pdf-hint pdf-p7vb-note">
            Meme avec une batterie parfaite, ce seuil ne peut pas etre depasse.
          </p>
        </div>

        <div className="pdf-kpi-card pdf-p7vb-block">
          <div className="pdf-section-title">Pourquoi pas 100 %</div>
          <ul className="pdf-p7vb-list">
            {limits.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="pdf-kpi-card pdf-p7vb-block pdf-p7vb-block--accent">
        <div className="pdf-section-title">Apport concret de la batterie</div>
        <div className="pdf-p7vb-grid3">
          <div className="pdf-p7vb-big">
            <span>+ {fmtKwh(contribution.recovered_kwh)}</span>
            <small>recuperes</small>
          </div>
          <div className="pdf-p7vb-big">
            <span>- {fmtKwh(contribution.grid_bought_less_kwh)}</span>
            <small>achetes au reseau</small>
          </div>
          <div className="pdf-p7vb-big">
            <span>+ {fmtPtsFromRatio(contribution.autonomy_gain_ratio)}</span>
            <small>d'autonomie</small>
          </div>
        </div>
      </div>
    </div>
  );
}
