/**
 * CP-PDF — Page 11 Financement (optionnel)
 * Hydratation engine-p11.js : conserver les id #p11_* et synthèse #p11_syn_*.
 */
import { useEffect, useMemo } from "react";
import PdfPageLayout from "../PdfEngine/PdfPageLayout";
import PdfHeader from "../../../components/pdf/PdfHeader";
import { getCrmApiBaseWithWindowFallback } from "@/config/crmApiBase";
import "./pdf-page11-premium.css";

const API_BASE = getCrmApiBaseWithWindowFallback();
const PLACEHOLDER_LOGO = "/client-portal/logo-solarglobe.png";

function getStorageUrl(
  orgId: string,
  type: "logo" | "pdf-cover",
  renderToken: string,
  studyId: string,
  versionId: string
): string {
  return `${API_BASE}/api/internal/pdf-asset/${orgId}/${type}?renderToken=${encodeURIComponent(renderToken)}&studyId=${encodeURIComponent(studyId)}&versionId=${encodeURIComponent(versionId)}`;
}

export default function PdfPage11({
  organization = {},
  viewModel,
}: {
  organization?: { id?: string; logo_image_key?: string | null; logo_url?: string | null };
  viewModel?: {
    meta?: { studyId?: string; versionId?: string };
    fullReport?: { p11?: { meta?: Record<string, unknown>; data?: Record<string, unknown> } };
  };
}) {
  useEffect(() => {
    if (typeof window === "undefined" || !viewModel) return;
    const emit = () => {
      window.API?.bindEngineP11?.(window.Engine);
      window.emitPdfViewData?.(viewModel as { fullReport?: Record<string, unknown> });
    };
    const raf = window.requestAnimationFrame(emit);
    const timeout = window.setTimeout(emit, 120);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timeout);
    };
  }, [viewModel]);

  const p11 = viewModel?.fullReport?.p11 ?? {};
  const p11Meta = p11.meta ?? {};
  const p11Data = p11.data ?? {};
  const financing = (p11Data.financing ?? {}) as Record<string, unknown>;
  const kpi = (p11Data.kpi ?? {}) as Record<string, unknown>;
  const postLoan = (p11Data.post_loan ?? {}) as Record<string, unknown>;
  const series = (p11Data.series ?? {}) as Record<string, unknown>;
  const ecoSeries = Array.isArray(series.economies_annuelles) ? series.economies_annuelles.map(Number) : [];
  const paySeries = Array.isArray(series.paiement_annuel) ? series.paiement_annuel.map(Number) : [];
  const resteSeries = Array.isArray(series.reste_a_charge_annuel) ? series.reste_a_charge_annuel.map(Number) : [];
  const fmtEur = (value: unknown) =>
    value != null && Number.isFinite(Number(value)) ? `${Math.round(Number(value)).toLocaleString("fr-FR")} €` : "—";
  const p11Text = (value: unknown, fallback = "—") =>
    value !== null && value !== undefined && value !== "" ? String(value) : fallback;
  const monthly = kpi.mensualite_eur ?? financing.monthly_payment_eur;
  const totalPaid = kpi.total_paid_eur ?? financing.total_paid_eur;
  const creditCost = kpi.credit_cost_eur ?? financing.credit_cost_eur;
  const totalPaidLabel =
    totalPaid != null
      ? `${fmtEur(totalPaid)}${creditCost != null ? ` (coût ${fmtEur(creditCost)})` : ""}`
      : "—";
  const summarySolde = (year: number) => {
    const raw = resteSeries[year - 1];
    if (!Number.isFinite(raw)) return "—";
    return raw < 0 ? `+${fmtEur(Math.abs(raw)).replace(/^—$/, "")} net` : fmtEur(raw);
  };
  const maxChart = Math.max(1, ...ecoSeries, ...paySeries);
  const chartBars = Array.from({ length: 25 }, (_, i) => {
    const x = 170 + i * ((2400 - 190) / 25);
    const groupW = (2400 - 190) / 25;
    const eco = Number.isFinite(ecoSeries[i]) ? ecoSeries[i] : 0;
    const pay = Number.isFinite(paySeries[i]) ? paySeries[i] : 0;
    const plotH = 610;
    const ecoH = (eco / maxChart) * plotH;
    const payH = (pay / maxChart) * plotH;
    return { x, groupW, ecoH, payH };
  });

  const logoUrl = useMemo(() => {
    if (organization?.logo_url) return organization.logo_url;
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const renderToken = params?.get("renderToken") ?? "";
    const studyId = params?.get("studyId") ?? (viewModel?.meta as { studyId?: string } | undefined)?.studyId ?? "";
    const versionId = params?.get("versionId") ?? (viewModel?.meta as { versionId?: string } | undefined)?.versionId ?? "";
    const orgId = organization?.id;
    if (!orgId || !renderToken || !studyId || !versionId) return PLACEHOLDER_LOGO;
    return organization?.logo_image_key ? getStorageUrl(orgId, "logo", renderToken, studyId, versionId) : PLACEHOLDER_LOGO;
  }, [organization?.id, organization?.logo_image_key, organization?.logo_url, viewModel?.meta]);

  return (
    <PdfPageLayout
      legacyPort={{
        id: "p11",
        dataEngine: "finance",
        sectionGap: "0",
        header: (
          <PdfHeader
            headerStyle={{
              ["--logoW" as string]: logoUrl ? "22mm" : "0",
              ["--metaW" as string]: "120mm",
              flexShrink: 0,
            }}
            logo={
              logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Solarglobe"
                  style={{ position: "absolute", left: 0, top: 0, height: "18mm", objectFit: "contain" }}
                  onError={(e) => {
                    if (!e.currentTarget.dataset.fallbackApplied) {
                      e.currentTarget.dataset.fallbackApplied = "true";
                      e.currentTarget.src = PLACEHOLDER_LOGO;
                    }
                  }}
                />
              ) : null
            }
            badge="Financement"
            metaColumn={
              <div
                className="meta-compact"
                id="p11_meta_line"
                style={{
                  position: "absolute",
                  right: 0,
                  bottom: 0,
                  width: "var(--metaW)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: "1mm",
                  textAlign: "right",
                  lineHeight: 1.3,
                }}
              >
                <div>
                  <b>Client</b> : <span id="p11_client">{p11Text(p11Meta.client)}</span>
                </div>
                <div>
                  <b>Réf.</b> : <span id="p11_ref">{p11Text(p11Meta.ref)}</span>
                </div>
                <div>
                  <b>Date</b> : <span id="p11_date">{p11Text(p11Meta.date)}</span>
                </div>
              </div>
            }
          />
        ),
      }}
    >
      <div className="p11-premium">
        {/* A — Hero financement */}
        <header className="p11-hero">
          <p className="p11-hero__line1" style={{ display: "none" }} aria-hidden="true" />
          <div className="p11-hero__line2">
            <div className="p11-hero__top">
              <span id="p11_mensu" className="p11-hero__figure">
                {fmtEur(monthly)}
              </span>
              <span className="p11-hero__dur">
                Sur <strong id="p11_duree">{p11Text(financing.duree_display ?? p11Data.durations_summary)}</strong>
              </span>
            </div>
              <span className="p11-hero__hint">Mensualité indicative — sous réserve des conditions de financement réellement proposées.</span>
          </div>
        </header>

        {/* B — Grand bloc central : graphique | colonne lecture */}
        <div className="p11-central">
          <div id="p11_chart_wrap" className="p11-chart">
            <div className="p11-chart__head">
              <p className="p11-chart__title">Projection 25 ans — économies et financement</p>
            </div>
            <div className="p11-chart__inner">
              <div className="p11-chart__legend">
                <span>
                  <span className="p11-leg-eco" aria-hidden /> Économies annuelles (estimation)
                </span>
                <span>
                  <span className="p11-leg-pay" aria-hidden /> Versements annuels au prêt
                </span>
              </div>
              <div className="p11-chart__svg-wrap">
                <svg id="p11_chart" viewBox="0 0 2400 700" aria-label="Projection 25 ans : économies et remboursement">
                  <rect x="0" y="0" width="2400" height="700" fill="#fdfcf9" rx="8" />
                  <line x1="150" y1="640" x2="2360" y2="640" stroke="#cfc7b8" strokeWidth="3" />
                  {chartBars.map((bar, index) => (
                    <g key={index}>
                      <rect
                        x={bar.x + bar.groupW * 0.12}
                        y={640 - bar.ecoH}
                        width={bar.groupW * 0.34}
                        height={bar.ecoH}
                        rx="5"
                        fill="#c99b34"
                      />
                      <rect
                        x={bar.x + bar.groupW * 0.54}
                        y={640 - bar.payH}
                        width={bar.groupW * 0.34}
                        height={bar.payH}
                        rx="5"
                        fill="#28282d"
                      />
                    </g>
                  ))}
                </svg>
              </div>
            </div>
          </div>

          <div className="p11-central__gap" aria-hidden="true" />

          <aside className="p11-read" aria-label="Lecture financière">
            <section className="p11-read__card p11-read__card--loan">
              <h3 className="p11-read__card-title">Pendant le prêt</h3>
              <div className="p11-read__row">
                <span id="p11_kpi1_label" className="p11-read__label">
                  Mensualité
                </span>
                <span id="p11_kpi1_val" className="p11-read__val">
                  {fmtEur(monthly)}
                </span>
              </div>
              <div className="p11-read__row">
                <span id="p11_kpi2_label" className="p11-read__label">
                  Total échéances
                </span>
                <span id="p11_kpi2_val" className="p11-read__val">
                  {totalPaidLabel}
                </span>
              </div>
            </section>

            <section id="p11_postloan_block" className="p11-read__card p11-read__card--after">
              <h3 className="p11-read__card-title">Après le prêt</h3>
              <div className="p11-read__stack">
                <div className="p11-read__kv">
                  <span className="p11-read__label">Net à 25 ans (est.)</span>
                  <span id="p11_net_25" className="p11-read__val">
                    {fmtEur(postLoan.economies_net_25_eur)}
                  </span>
                </div>
                <div className="p11-read__kv">
                  <span className="p11-read__label">Mensualité libérée</span>
                  <span id="p11_mensu_free" className="p11-read__val">
                    {fmtEur(postLoan.mensualite_liberee_eur)}
                  </span>
                </div>
                <div className="p11-read__kv">
                  <span className="p11-read__label">Facture résiduelle (moy. mens.)</span>
                  <span id="p11_reste_card" className="p11-read__val p11-read__val--reste">
                    {fmtEur(postLoan.reste_charge_moyen_mois_eur)}
                  </span>
                </div>
              </div>
            </section>

            <section className="p11-read__card p11-read__card--now">
              <h3 className="p11-read__card-title">Lecture immédiate</h3>
              <div className="p11-read__row">
                <span id="p11_kpi3_label" className="p11-read__label">
                  Retour estimé
                </span>
                <span id="p11_kpi3_val" className="p11-read__val p11-read__val--gold">
                  {kpi.roi_years != null ? `${kpi.roi_years} ans` : "—"}
                </span>
              </div>
              <div className="p11-read__row">
                <span id="p11_kpi4_label" className="p11-read__label">
                  Effort moyen mensuel
                </span>
                <span id="p11_kpi4_val" className="p11-read__val p11-read__val--reste">
                  {fmtEur(kpi.reste_moyen_mois_eur)}
                </span>
              </div>
            </section>
          </aside>
        </div>

        {/* C — Synthèse années clés */}
        <div id="p11_quick_table" className="p11-synth">
          <p className="p11-synth__title">Synthèse — années clés</p>
          <div className="p11-synth__grid" id="p11_summary_grid">
            <div className="p11-synth__card">
              <div className="p11-synth__year">Année 1</div>
              <div className="p11-synth__mini" role="group" aria-label="Économie et solde annuel année 1">
                <span className="p11-synth__h">Économie</span>
                <span className="p11-synth__h">Solde annuel</span>
                <span className="p11-synth__v" id="p11_syn_gain_1">
                  {fmtEur(ecoSeries[0])}
                </span>
                <span className="p11-synth__v" id="p11_syn_reste_1">
                  {summarySolde(1)}
                </span>
              </div>
            </div>
            <div className="p11-synth__card">
              <div className="p11-synth__year">Année 5</div>
              <div className="p11-synth__mini" role="group" aria-label="Économie et solde annuel année 5">
                <span className="p11-synth__h">Économie</span>
                <span className="p11-synth__h">Solde annuel</span>
                <span className="p11-synth__v" id="p11_syn_gain_5">
                  {fmtEur(ecoSeries[4])}
                </span>
                <span className="p11-synth__v" id="p11_syn_reste_5">
                  {summarySolde(5)}
                </span>
              </div>
            </div>
            <div className="p11-synth__card">
              <div className="p11-synth__year">Année 10</div>
              <div className="p11-synth__mini" role="group" aria-label="Économie et solde annuel année 10">
                <span className="p11-synth__h">Économie</span>
                <span className="p11-synth__h">Solde annuel</span>
                <span className="p11-synth__v" id="p11_syn_gain_10">
                  {fmtEur(ecoSeries[9])}
                </span>
                <span className="p11-synth__v" id="p11_syn_reste_10">
                  {summarySolde(10)}
                </span>
              </div>
            </div>
            <div className="p11-synth__card">
              <div className="p11-synth__year">Année 15</div>
              <div className="p11-synth__mini" role="group" aria-label="Économie et solde annuel année 15">
                <span className="p11-synth__h">Économie</span>
                <span className="p11-synth__h">Solde annuel</span>
                <span className="p11-synth__v" id="p11_syn_gain_15">
                  {fmtEur(ecoSeries[14])}
                </span>
                <span className="p11-synth__v" id="p11_syn_reste_15">
                  {summarySolde(15)}
                </span>
              </div>
            </div>
            <div className="p11-synth__card">
              <div className="p11-synth__year">Année 20</div>
              <div className="p11-synth__mini" role="group" aria-label="Économie et solde annuel année 20">
                <span className="p11-synth__h">Économie</span>
                <span className="p11-synth__h">Solde annuel</span>
                <span className="p11-synth__v" id="p11_syn_gain_20">
                  {fmtEur(ecoSeries[19])}
                </span>
                <span className="p11-synth__v" id="p11_syn_reste_20">
                  {summarySolde(20)}
                </span>
              </div>
            </div>
            <div className="p11-synth__card">
              <div className="p11-synth__year">Année 25</div>
              <div className="p11-synth__mini" role="group" aria-label="Économie et solde annuel année 25">
                <span className="p11-synth__h">Économie</span>
                <span className="p11-synth__h">Solde annuel</span>
                <span className="p11-synth__v" id="p11_syn_gain_25">
                  {fmtEur(ecoSeries[24])}
                </span>
                <span className="p11-synth__v" id="p11_syn_reste_25">
                  {summarySolde(25)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* D — Ligne finale */}
        <footer className="p11-foot">
          <span className="p11-foot__left">
            <span className="p11-foot__repay">Remboursement</span>
          <span id="p11_durations_block" className="p11-foot__dur">{p11Text(p11Data.durations_summary, "")}</span>
          </span>
          <span className="p11-foot__right">Chiffrage indicatif aligné sur le scénario du dossier — à confirmer avec l'offre de financement.</span>
        </footer>

        {/* Pont moteur : paramètres (hors plan visible) */}
        <div id="p11_params_card" className="p11-engine-bridge" aria-hidden="true">
          <p className="p11-engine-bridge__title">Paramètres</p>
          <div className="p11-engine-bridge__grid">
            <span className="p11-engine-bridge__label">Montant</span>
            <span className="p11-engine-bridge__value" id="p11_amount">
              {p11Text(financing.montant_finance_display, fmtEur(p11Data.capex_ttc))}
            </span>
            <span className="p11-engine-bridge__label">Économies annuelles</span>
            <span className="p11-engine-bridge__value" id="p11_eco">
              {ecoSeries.length ? `${fmtEur(ecoSeries[0])} / an` : "—"}
            </span>
            <span className="p11-engine-bridge__label">Taux nominal</span>
            <span className="p11-engine-bridge__value" id="p11_taeg">
              {p11Text(financing.taeg_display)}
            </span>
            <span className="p11-engine-bridge__label">Assurance</span>
            <span className="p11-engine-bridge__value" id="p11_assurance">
              {p11Text(financing.assurance_display)}
            </span>
          </div>
          <span id="p11_mode">{p11Text(financing.mode_label)}</span>
          <span id="p11_base">{p11Text(financing.duree_display)}</span>
          <span id="p11_apport">{p11Text(financing.apport_display)}</span>
        </div>
      </div>
    </PdfPageLayout>
  );
}
