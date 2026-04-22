/**
 * CP-PDF — Page 8 Impact : gains cumulés sur 25 ans (premium)
 * Données : fullReport.p9 (engine-p9.js) — section DOM #p8 pour le flux legacy.
 * En-tête SolarGlobe + badge central alignés sur les autres pages premium.
 */
import React, { useMemo } from "react";
import PdfPageLayout from "../PdfEngine/PdfPageLayout";
import PdfHeader from "../../../components/pdf/PdfHeader";
import "./pdf-page8-premium.css";
import { getCrmApiBaseWithWindowFallback } from "@/config/crmApiBase";

const API_BASE = getCrmApiBaseWithWindowFallback();
const PLACEHOLDER_LOGO = "/pdf-assets/images/logo-solarglobe-rect.png";

function getStorageUrl(
  orgId: string,
  type: "logo" | "pdf-cover",
  renderToken: string,
  studyId: string,
  versionId: string
): string {
  return `${API_BASE}/api/internal/pdf-asset/${orgId}/${type}?renderToken=${encodeURIComponent(renderToken)}&studyId=${encodeURIComponent(studyId)}&versionId=${encodeURIComponent(versionId)}`;
}

const P8_BADGE = "Gains nets sur 25 ans";

const P8_IMPACT_LINE =
  "Après amortissement de l'investissement, le générateur continue de générer des économies chaque année.";

const P8_SIGNATURE =
  "Au-delà de l'économie immédiate, l'actif photovoltaïque soutient la valeur du site et la maîtrise énergétique sur le long terme.";

export default function PdfPage8({
  organization = {},
  viewModel,
}: {
  organization?: { id?: string; logo_image_key?: string | null; logo_url?: string | null };
  viewModel?: { meta?: { studyId?: string; versionId?: string }; [key: string]: unknown };
}) {
  const logoUrl = useMemo(() => {
    if (organization?.logo_url) return organization.logo_url;

    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const renderToken = params?.get("renderToken") ?? "";
    const studyId = params?.get("studyId") ?? (viewModel?.meta as { studyId?: string } | undefined)?.studyId ?? "";
    const versionId = params?.get("versionId") ?? (viewModel?.meta as { versionId?: string } | undefined)?.versionId ?? "";
    const orgId = organization?.id;

    if (!orgId || !renderToken || !studyId || !versionId) {
      return PLACEHOLDER_LOGO;
    }
    const hasLogo = !!organization?.logo_image_key;
    return hasLogo ? getStorageUrl(orgId, "logo", renderToken, studyId, versionId) : PLACEHOLDER_LOGO;
  }, [organization?.id, organization?.logo_image_key, organization?.logo_url, viewModel?.meta]);

  return (
    <PdfPageLayout
      legacyPort={{
        id: "p8",
        sectionGap: "1.5mm",
        header: (
          <PdfHeader
            headerStyle={{
              ["--logoW" as string]: logoUrl ? "22mm" : "0",
              ["--metaW" as string]: "110mm",
              flexShrink: 0,
            }}
            logo={
              logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Solarglobe"
                  style={{ position: "absolute", left: 0, top: 0, height: "18mm", objectFit: "contain" }}
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : null
            }
            badge={P8_BADGE}
            metaColumn={
              <div
                className="meta-compact"
                id="p8_meta_line"
                style={{
                  position: "absolute",
                  right: 0,
                  bottom: 0,
                  width: "var(--metaW)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: "0.65mm",
                  textAlign: "right",
                  lineHeight: 1.22,
                }}
              >
                <div>
                  <b>Client</b> : <span id="p8_client">—</span>
                </div>
                <div>
                  <b>Réf.</b> : <span id="p8_ref">—</span>
                </div>
                <div>
                  <b>Date</b> : <span id="p8_date">—</span>
                </div>
              </div>
            }
          />
        ),
      }}
    >
      <div id="p8_results" className="p8-body" style={{ display: "none", flexDirection: "column", flex: "0 0 auto" }}>
        <div id="p8_empty_state" className="p8-empty-state" style={{ display: "none" }}>
          Données indisponibles
        </div>

        <div id="p8_main_stack" className="p8-premium">
          {/* A — Hero impact */}
          <div className="p8-zone p8-zone--hero">
            <div className="p8-hero-inner">
              <div className="p8-hero__line1">GAIN NET ESTIMÉ SUR 25 ANS</div>
              <div id="p8_hero_value" className="p8-hero__value">
                —
              </div>
              <div id="p8_scenario_label" className="p8-hero__scenario">
                —
              </div>
              <p className="p8-hero__impact">{P8_IMPACT_LINE}</p>
            </div>
          </div>

          {/* B — Zone centrale : graphique + lecture impact */}
          <div className="p8-zone p8-zone--central">
            <div className="p8-central__chart">
              <div className="p8-chart-wrap p8-chart-surface">
                <svg
                  id="p8_chart"
                  viewBox="0 0 1750 700"
                  preserveAspectRatio="xMidYMid meet"
                  style={{ width: "100%", height: "100%", display: "block" }}
                />
              </div>
            </div>
            <div className="p8-central__impact">
              <div className="p8-impact-card">
                <div className="p8-impact-card__label">Projet amorti</div>
                <div id="p8_card_roi_detail" className="p8-impact-card__value">
                  —
                </div>
              </div>
              <div className="p8-impact-card">
                <div className="p8-impact-card__label">Gain net à 15 ans</div>
                <div id="p8_card_15y_value" className="p8-impact-card__value">
                  —
                </div>
                <div id="p8_card_15y_sub" className="p8-impact-card__sub" />
              </div>
              <div className="p8-impact-card p8-impact-card--accent">
                <div className="p8-impact-card__label">Horizon 25 ans</div>
                <div id="p8_card_25y_value" className="p8-impact-card__value p8-impact-card__value--xl">
                  —
                </div>
              </div>
            </div>
          </div>

          {/* C — KPI bas */}
          <div className="p8-zone p8-zone--kpi">
            <div className="p8-kpi-row">
              <div className="p8-kpi-cell">
                <div className="p8-kpi-title">Investissement projet (TTC)</div>
                <div id="p8_kpi_capex" className="p8-kpi-value">
                  —
                </div>
              </div>
              <div className="p8-kpi-cell">
                <div className="p8-kpi-title">Économies annuelles moyennes</div>
                <div id="p8_kpi_avg" className="p8-kpi-value">
                  —
                </div>
              </div>
              <div className="p8-kpi-cell">
                <div className="p8-kpi-title">Rentabilité estimée</div>
                <div id="p8_kpi_roi" className="p8-kpi-value">
                  —
                </div>
              </div>
            </div>
          </div>

          {/* D — Signature */}
          <p className="p8-signature">{P8_SIGNATURE}</p>
        </div>
      </div>
    </PdfPageLayout>
  );
}
