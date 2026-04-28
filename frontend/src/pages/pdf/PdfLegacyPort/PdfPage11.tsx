/**
 * CP-PDF — Page 11 Financement (optionnel)
 * Hydratation engine-p11.js : conserver les id #p11_* et synthèse #p11_syn_*.
 */
import React, { useMemo } from "react";
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
  viewModel?: { meta?: { studyId?: string; versionId?: string } };
}) {
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
              ["--logoW" as string]: "26mm",
              ["--metaW" as string]: "120mm",
            }}
            logo={
              <img
                src={logoUrl}
                alt="Solarglobe"
                style={{ position: "absolute", left: 0, top: 0, height: "16mm", objectFit: "contain" }}
                onError={(e) => {
                  e.currentTarget.src = PLACEHOLDER_LOGO;
                }}
              />
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
                  <b>Client</b> : <span id="p11_client">—</span>
                </div>
                <div>
                  <b>Réf.</b> : <span id="p11_ref">—</span>
                </div>
                <div>
                  <b>Date</b> : <span id="p11_date">—</span>
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
          <p className="p11-hero__line1">Pendant le remboursement, la production PV réduit déjà la facture d&apos;achat.</p>
          <div className="p11-hero__line2">
            <div className="p11-hero__top">
              <span id="p11_mensu" className="p11-hero__figure">
                —
              </span>
              <span className="p11-hero__dur">
                Sur <strong id="p11_duree">—</strong>
              </span>
            </div>
            <span className="p11-hero__hint">Mensualité estimée — la production locale atténue déjà la facture.</span>
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
                <svg id="p11_chart" viewBox="0 0 2400 700" aria-label="Projection 25 ans : économies et remboursement" />
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
                  —
                </span>
              </div>
              <div className="p11-read__row">
                <span id="p11_kpi2_label" className="p11-read__label">
                  Total échéances
                </span>
                <span id="p11_kpi2_val" className="p11-read__val">
                  —
                </span>
              </div>
            </section>

            <section id="p11_postloan_block" className="p11-read__card p11-read__card--after">
              <h3 className="p11-read__card-title">Après le prêt</h3>
              <div className="p11-read__stack">
                <div className="p11-read__kv">
                  <span className="p11-read__label">Net à 25 ans (est.)</span>
                  <span id="p11_net_25" className="p11-read__val">
                    —
                  </span>
                </div>
                <div className="p11-read__kv">
                  <span className="p11-read__label">Mensualité libérée</span>
                  <span id="p11_mensu_free" className="p11-read__val">
                    —
                  </span>
                </div>
                <div className="p11-read__kv">
                  <span className="p11-read__label">Facture résiduelle (moy. mens.)</span>
                  <span id="p11_reste_card" className="p11-read__val p11-read__val--reste">
                    —
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
                  —
                </span>
              </div>
              <div className="p11-read__row">
                <span id="p11_kpi4_label" className="p11-read__label">
                  Reste à charge
                </span>
                <span id="p11_kpi4_val" className="p11-read__val p11-read__val--reste">
                  —
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
              <div className="p11-synth__mini" role="group" aria-label="Économie et reste année 1">
                <span className="p11-synth__h">Économie</span>
                <span className="p11-synth__h">Reste</span>
                <span className="p11-synth__v" id="p11_syn_gain_1">
                  —
                </span>
                <span className="p11-synth__v" id="p11_syn_reste_1">
                  —
                </span>
              </div>
            </div>
            <div className="p11-synth__card">
              <div className="p11-synth__year">Année 5</div>
              <div className="p11-synth__mini" role="group" aria-label="Économie et reste année 5">
                <span className="p11-synth__h">Économie</span>
                <span className="p11-synth__h">Reste</span>
                <span className="p11-synth__v" id="p11_syn_gain_5">
                  —
                </span>
                <span className="p11-synth__v" id="p11_syn_reste_5">
                  —
                </span>
              </div>
            </div>
            <div className="p11-synth__card">
              <div className="p11-synth__year">Année 10</div>
              <div className="p11-synth__mini" role="group" aria-label="Économie et reste année 10">
                <span className="p11-synth__h">Économie</span>
                <span className="p11-synth__h">Reste</span>
                <span className="p11-synth__v" id="p11_syn_gain_10">
                  —
                </span>
                <span className="p11-synth__v" id="p11_syn_reste_10">
                  —
                </span>
              </div>
            </div>
            <div className="p11-synth__card">
              <div className="p11-synth__year">Année 15</div>
              <div className="p11-synth__mini" role="group" aria-label="Économie et reste année 15">
                <span className="p11-synth__h">Économie</span>
                <span className="p11-synth__h">Reste</span>
                <span className="p11-synth__v" id="p11_syn_gain_15">
                  —
                </span>
                <span className="p11-synth__v" id="p11_syn_reste_15">
                  —
                </span>
              </div>
            </div>
            <div className="p11-synth__card">
              <div className="p11-synth__year">Année 20</div>
              <div className="p11-synth__mini" role="group" aria-label="Économie et reste année 20">
                <span className="p11-synth__h">Économie</span>
                <span className="p11-synth__h">Reste</span>
                <span className="p11-synth__v" id="p11_syn_gain_20">
                  —
                </span>
                <span className="p11-synth__v" id="p11_syn_reste_20">
                  —
                </span>
              </div>
            </div>
            <div className="p11-synth__card">
              <div className="p11-synth__year">Année 25</div>
              <div className="p11-synth__mini" role="group" aria-label="Économie et reste année 25">
                <span className="p11-synth__h">Économie</span>
                <span className="p11-synth__h">Reste</span>
                <span className="p11-synth__v" id="p11_syn_gain_25">
                  —
                </span>
                <span className="p11-synth__v" id="p11_syn_reste_25">
                  —
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* D — Ligne finale */}
        <footer className="p11-foot">
          <span className="p11-foot__left">
            <span className="p11-foot__repay">Remboursement</span>
            <span id="p11_durations_block" className="p11-foot__dur" />
          </span>
          <span className="p11-foot__right">Chiffrage aligné sur le scénario du dossier — décision en clarté.</span>
        </footer>

        {/* Pont moteur : paramètres (hors plan visible) */}
        <div id="p11_params_card" className="p11-engine-bridge" aria-hidden="true">
          <p className="p11-engine-bridge__title">Paramètres</p>
          <div className="p11-engine-bridge__grid">
            <span className="p11-engine-bridge__label">Montant</span>
            <span className="p11-engine-bridge__value" id="p11_amount">
              —
            </span>
            <span className="p11-engine-bridge__label">Économies annuelles</span>
            <span className="p11-engine-bridge__value" id="p11_eco">
              —
            </span>
            <span className="p11-engine-bridge__label">Taux nominal</span>
            <span className="p11-engine-bridge__value" id="p11_taeg">
              —
            </span>
            <span className="p11-engine-bridge__label">Assurance</span>
            <span className="p11-engine-bridge__value" id="p11_assurance">
              —
            </span>
          </div>
          <span id="p11_mode">—</span>
          <span id="p11_base">—</span>
          <span id="p11_apport">—</span>
        </div>
      </div>
    </PdfPageLayout>
  );
}
