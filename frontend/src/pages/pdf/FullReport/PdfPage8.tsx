/**
 * Page 8 — Impact batterie (aperçu React, aligné legacy)
 *
 * A.grid_import_kwh / B.grid_import_kwh : achat réseau annuel (kWh) fourni par le mapper PDF
 * (somme des imports mensuels scenarios_v2 si dispo ; BATTERY_VIRTUAL → billable_import_kwh prioritaire).
 * Ne pas mélanger avec d’autres champs côté rendu.
 */

import React from "react";

interface P8DetailsBatterie {
  credited_kwh?: number;
  restored_kwh?: number;
  overflow_export_kwh?: number;
  billable_import_kwh?: number;
  gain_autonomie_pts?: number;
  gain_autoconsommation_kwh?: number;
  reduction_achat_kwh?: number;
}

/** Colonnes comparatif P8 : grid_import_kwh = débit annuel kWh tel que sérialisé par le backend PDF. */
interface P8ScenarioCol {
  production_kwh?: number;
  autocons_kwh?: number;
  surplus_kwh?: number;
  grid_import_kwh?: number;
  autonomie_pct?: number;
  battery_throughput_kwh?: number;
}

interface P8Hypotheses {
  cycles_an?: number | null;
  cycles_jour?: number | null;
  capacite_utile_kwh?: number | null;
}

interface P8Data {
  meta?: Record<string, unknown>;
  year?: string;
  batteryType?: string;
  snapshotBatteryCapacityKwh?: number | null;
  A?: P8ScenarioCol & Record<string, unknown>;
  B?: P8ScenarioCol & Record<string, unknown>;
  detailsBatterie?: P8DetailsBatterie;
  hypotheses?: P8Hypotheses;
  profile?: { pv?: number[]; load?: number[]; charge?: number[]; discharge?: number[] };
}

const EMPTY = "—";

function rLoc(v: unknown): string {
  if (v == null || !Number.isFinite(Number(v))) return "0";
  return Math.round(Number(v)).toLocaleString("fr-FR");
}

function val(v: unknown): string {
  if (v == null || v === "") return EMPTY;
  return String(v);
}

function autoconsPct(sc: P8ScenarioCol): number {
  const prod = Number(sc.production_kwh) || 0;
  const auto = Number(sc.autocons_kwh) || 0;
  if (prod <= 0) return 0;
  return Math.round((auto / prod) * 100);
}

function fmtKwh(v: unknown): string {
  if (v == null || !Number.isFinite(Number(v))) return EMPTY;
  return `${rLoc(v)} kWh`;
}

function PdfP8SvgCheck() {
  return (
    <svg className="pdf-p8-hl-check" width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M3 8l3 3 7-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function P8SchemaFlow() {
  const iconSize = 40;
  const sun = (
    <svg className="pdf-p8-schema-icon pdf-p8-schema-sun" width={iconSize} height={iconSize} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
        <line
          key={deg}
          x1="12"
          y1="1.5"
          x2="12"
          y2="4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          transform={`rotate(${deg} 12 12)`}
        />
      ))}
    </svg>
  );
  const battery = (
    <svg className="pdf-p8-schema-icon pdf-p8-schema-bat" width={iconSize} height={iconSize} viewBox="0 0 24 24" aria-hidden>
      <rect x="5" y="7" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 5.5h6v2H9z" fill="currentColor" />
      <rect x="7.5" y="9" width="7" height="6" rx="0.5" fill="currentColor" opacity="0.35" />
    </svg>
  );
  const home = (
    <svg className="pdf-p8-schema-icon pdf-p8-schema-home" width={iconSize} height={iconSize} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
  const arrow = (
    <svg className="pdf-p8-schema-arrow" width="25" height="14" viewBox="0 0 28 16" aria-hidden>
      <path
        d="M2 8h18m-5-5 5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  return (
    <div className="pdf-p8-lead-schema" aria-hidden>
      <div className="pdf-p8-schema-flow">
        <div className="pdf-p8-schema-step">
          {sun}
          <span className="pdf-p8-schema-label">Production</span>
        </div>
        {arrow}
        <div className="pdf-p8-schema-step">
          {battery}
          <span className="pdf-p8-schema-label">Stockage</span>
        </div>
        {arrow}
        <div className="pdf-p8-schema-step">
          {home}
          <span className="pdf-p8-schema-label">Utilisation le soir</span>
        </div>
      </div>
    </div>
  );
}

export default function PdfPage8({ data }: { data?: P8Data }) {
  const meta = data?.meta ?? {};
  const scA = data?.A ?? {};
  const scB = data?.B ?? {};
  const det = data?.detailsBatterie ?? {};
  const hyp = data?.hypotheses ?? {};
  const isVirtual = data?.batteryType === "VIRTUAL";
  const gainPts = det.gain_autonomie_pts != null ? Math.round(Number(det.gain_autonomie_pts)) : 0;
  const reducGrid = det.reduction_achat_kwh != null ? Math.round(Number(det.reduction_achat_kwh)) : 0;

  const capPhys =
    data?.snapshotBatteryCapacityKwh ?? hyp.capacite_utile_kwh ?? null;
  const cycY = hyp.cycles_an;
  const cycD = hyp.cycles_jour;
  const displayCycY =
    cycY != null && Number.isFinite(Number(cycY))
      ? Number(cycY).toFixed(1).replace(".", ",")
      : EMPTY;
  const displayCycD =
    cycD != null && Number.isFinite(Number(cycD))
      ? Number(cycD).toFixed(2).replace(".", ",")
      : EMPTY;
  const throughput = scB.battery_throughput_kwh;

  return (
    <div className="pdf-page pdf-page-p8 p8-page">
      <h2 className="pdf-title pdf-p8-page-title">Impact batterie</h2>
      <div className="pdf-meta">
        <span>{val(meta.client)}</span>
        <span>{val(meta.ref)}</span>
        <span>{val(meta.date)}</span>
        {data?.year && <span>Année {val(data.year)}</span>}
      </div>

      <div className="pdf-p8-stack">
      <div className="pdf-p8-lead">
        <div className="pdf-p8-lead-copy">
          <div className="pdf-p8-lead-line1">
            +{gainPts} % d&apos;autonomie énergétique
          </div>
          <div className="pdf-p8-lead-line2">
            soit ~{rLoc(reducGrid)} kWh achetés en moins
          </div>
        </div>
        <P8SchemaFlow />
      </div>

      <div className="pdf-p8-compare">
        <div className="pdf-p8-compare-col pdf-p8-compare-col--base">
          <div className="pdf-p8-compare-head">Sans batterie</div>
          <div className="pdf-p8-compare-row">
            <span>Autoconsommation</span>
            <strong>{autoconsPct(scA)} %</strong>
          </div>
          <div className="pdf-p8-compare-row">
            <span>Énergie perdue</span>
            <strong>{fmtKwh(scA.surplus_kwh)}</strong>
          </div>
          <div className="pdf-p8-compare-row">
            <span>Achat réseau annuel</span>
            <strong>{fmtKwh(scA.grid_import_kwh)}</strong>
          </div>
        </div>
        <div className="pdf-p8-compare-col pdf-p8-compare-col--bat">
          <div className="pdf-p8-compare-head">Avec batterie</div>
          <div className="pdf-p8-compare-row">
            <span>Autoconsommation</span>
            <strong>{autoconsPct(scB)} %</strong>
          </div>
          <div className="pdf-p8-compare-row">
            <span>Énergie valorisée grâce à la batterie</span>
            <strong className="pdf-p8-val-accent">{fmtKwh(det.gain_autoconsommation_kwh)}</strong>
          </div>
          <div className="pdf-p8-compare-row">
            <span>Achat réseau annuel</span>
            <strong>{fmtKwh(scB.grid_import_kwh)}</strong>
          </div>
        </div>
      </div>

      {isVirtual ? (
        <div className="pdf-p8-battery pdf-p8-battery--virt">
          <div className="pdf-p8-battery-title">Votre surplus devient de l&apos;énergie utilisable</div>
          <div className="pdf-p8-battery-grid">
            <div className="pdf-p8-battery-kpis">
              <div className="pdf-p8-compare-row">
                <span>Énergie créditée</span>
                <strong>{fmtKwh(det.credited_kwh)}</strong>
              </div>
              <div className="pdf-p8-compare-row">
                <span>Énergie utilisée</span>
                <strong>{fmtKwh(det.restored_kwh)}</strong>
              </div>
              <div className="pdf-p8-compare-row">
                <span>Énergie perdue</span>
                <strong>{fmtKwh(det.overflow_export_kwh)}</strong>
              </div>
              <div className="pdf-p8-compare-row">
                <span>Capacité simulée</span>
                <strong>
                  {hyp.capacite_utile_kwh != null && Number.isFinite(Number(hyp.capacite_utile_kwh))
                    ? `${rLoc(hyp.capacite_utile_kwh)} kWh`
                    : EMPTY}
                </strong>
              </div>
              <div className="pdf-p8-compare-row">
                <span>Cycles équivalents</span>
                <strong>{displayCycY}</strong>
              </div>
            </div>
            <aside className="pdf-p8-battery-aside">
              <h3 className="pdf-p8-aside-title">Comment fonctionne votre batterie virtuelle</h3>
              <div className="pdf-p8-battery-copy">
                <p className="pdf-p8-battery-lead">Votre surplus solaire n&apos;est plus perdu.</p>
                <p>
                  L&apos;énergie produite en journée est créditée, puis réutilisée plus tard lorsque votre maison en a
                  besoin, notamment le soir.
                </p>
                <p>
                  Vous réduisez ainsi vos achats au réseau, tout en valorisant une plus grande part de votre production
                  solaire.
                </p>
              </div>
              <ul className="pdf-p8-highlights">
                <li>
                  <PdfP8SvgCheck />
                  <span>Surplus valorisé</span>
                </li>
                <li>
                  <PdfP8SvgCheck />
                  <span>Moins d&apos;énergie achetée</span>
                </li>
                <li>
                  <PdfP8SvgCheck />
                  <span>Plus d&apos;autonomie</span>
                </li>
              </ul>
            </aside>
          </div>
        </div>
      ) : (
        <div className="pdf-p8-battery">
          <div className="pdf-p8-battery-title">Votre batterie, au service de votre maison</div>
          <div className="pdf-p8-battery-grid">
            <div className="pdf-p8-battery-kpis">
              <div className="pdf-p8-compare-row">
                <span>Capacité batterie</span>
                <strong>
                  {capPhys != null && Number.isFinite(Number(capPhys)) ? `${rLoc(capPhys)} kWh` : EMPTY}
                </strong>
              </div>
              <div className="pdf-p8-compare-row">
                <span>Cycles / an</span>
                <strong>{displayCycY}</strong>
              </div>
              <div className="pdf-p8-compare-row">
                <span>Cycles / jour</span>
                <strong>{displayCycD}</strong>
              </div>
              <div className="pdf-p8-compare-row">
                <span>Énergie stockée / an</span>
                <strong>
                  {throughput != null && Number.isFinite(Number(throughput))
                    ? `${rLoc(throughput)} kWh`
                    : EMPTY}
                </strong>
              </div>
            </div>
            <aside className="pdf-p8-battery-aside">
              <h3 className="pdf-p8-aside-title">Une énergie calée sur votre rythme</h3>
              <div className="pdf-p8-battery-copy">
                <p>
                  Votre batterie stocke l&apos;énergie produite en journée pour la restituer lorsque votre
                  consommation augmente, notamment le soir.
                </p>
                <p>
                  Vous consommez davantage votre propre électricité et limitez les volumes prélevés sur le réseau.
                </p>
              </div>
              <ul className="pdf-p8-highlights">
                <li>
                  <PdfP8SvgCheck />
                  <span>Stockage intelligent entre production et besoins</span>
                </li>
                <li>
                  <PdfP8SvgCheck />
                  <span>Moins d&apos;achats d&apos;énergie au réseau</span>
                </li>
                <li>
                  <PdfP8SvgCheck />
                  <span>Autonomie renforcée sur votre facture</span>
                </li>
              </ul>
            </aside>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
