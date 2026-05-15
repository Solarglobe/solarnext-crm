/**
 * CP-PDF — Page 1 couverture (paysage A4)
 * Hydratation : engine-p1.js (IDs #p1_* inchangés).
 * Logo / couverture : organization (logo_image_key, pdf_cover_image_key).
 * Données chiffrées : selected_scenario_snapshot → fullReport.p1.p1_auto.
 */
import { useMemo, useEffect } from "react";
import PdfPageLayout from "../PdfEngine/PdfPageLayout";
import PdfHeader from "../../../components/pdf/PdfHeader";
import "./pdf-page1-premium.css";
import { getCrmApiBaseWithWindowFallback } from "@/config/crmApiBase";

const API_BASE = getCrmApiBaseWithWindowFallback();
const PLACEHOLDER_COVER = "/client-portal/logo-solarglobe.png";
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

export default function PdfPage1({
  organization = {},
  viewModel,
}: {
  organization?: { id?: string; logo_image_key?: string | null; pdf_cover_image_key?: string | null };
  viewModel?: { fullReport?: Record<string, unknown>; selected_scenario_snapshot?: unknown; meta?: { studyId?: string; versionId?: string } };
}) {
  const { logoUrl, coverUrl } = useMemo(() => {
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const renderToken = params?.get("renderToken") ?? "";
    const studyId = params?.get("studyId") ?? (viewModel?.meta as { studyId?: string } | undefined)?.studyId ?? "";
    const versionId = params?.get("versionId") ?? (viewModel?.meta as { versionId?: string } | undefined)?.versionId ?? "";
    const orgId = organization?.id;

    if (!orgId || !renderToken || !studyId || !versionId) {
      if (import.meta.env?.DEV && organization?.logo_image_key) {
        console.warn("P1_LOGO_RENDER_INPUT: paramètres manquants", { orgId: !!orgId, renderToken: !!renderToken, studyId, versionId });
      }
      return { logoUrl: PLACEHOLDER_LOGO, coverUrl: PLACEHOLDER_COVER };
    }

    const hasLogo = !!organization?.logo_image_key;
    const hasCover = !!organization?.pdf_cover_image_key;

    const logo = hasLogo ? getStorageUrl(orgId, "logo", renderToken, studyId, versionId) : PLACEHOLDER_LOGO;
    const cover = hasCover ? getStorageUrl(orgId, "pdf-cover", renderToken, studyId, versionId) : PLACEHOLDER_COVER;

    if (import.meta.env?.DEV && hasLogo) {
      console.log("P1_LOGO_URL", logo);
    }

    return { logoUrl: logo, coverUrl: cover };
  }, [organization?.id, organization?.logo_image_key, organization?.pdf_cover_image_key, viewModel?.meta]);

  useEffect(() => {
    if (import.meta.env?.DEV && viewModel) {
      const snap = viewModel.selected_scenario_snapshot;
      const p1 = (viewModel.fullReport as Record<string, unknown>)?.p1 as Record<string, unknown> | undefined;
      const a = p1?.p1_auto as Record<string, unknown> | undefined;
      console.info("P1_SNAPSHOT_SOURCE", { hasSelectedScenarioSnapshot: !!snap });
      console.info("P1_RENDER_VALUES", {
        client: a?.p1_client,
        kwc: a?.p1_k_puissance,
        autonomy: a?.p1_k_autonomie,
        irr: a?.p1_k_tri,
        gains25: a?.p1_k_gains,
        kva: a?.p1_param_kva,
        reseau: a?.p1_param_reseau,
        consoAnnual: a?.p1_param_conso,
        hasLogo: !!organization?.logo_image_key,
        hasCover: !!organization?.pdf_cover_image_key,
      });
    }
  }, [viewModel, organization?.logo_image_key, organization?.pdf_cover_image_key]);

  return (
    <PdfPageLayout
      className="p1-premium-page"
      legacyPort={{
        id: "p1",
        dataEngine: "meta",
        sectionGap: "3mm",
        header: (
          <PdfHeader
            headerStyle={{
              ["--logoW" as string]: "22mm",
              ["--metaW" as string]: "110mm",
              flexShrink: 0,
            }}
            logo={
              <img
                src={logoUrl}
                alt="Logo"
                style={{ position: "absolute", left: 0, top: 0, height: "18mm", objectFit: "contain" }}
              />
            }
            badge="Étude Solarglobe"
            metaColumn={
              <div
                className="meta-compact"
                id="p1_meta_line"
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
                  <b>Client</b> : <span id="p1_client">—</span>
                </div>
                <div>
                  <b>Réf.</b> : <span id="p1_ref">—</span>
                </div>
                <div>
                  <b>Date</b> : <span id="p1_date">—</span>
                </div>
              </div>
            }
          />
        ),
      }}
    >
      <div className="p1-premium">
        <div className="p1-premium__hero">
          <div className="p1-premium__hero-editorial">
            <p className="p1-premium__kicker">Étude photovoltaïque sur mesure</p>
            <h1 className="p1-premium__title">
              <span className="p1-premium__title-line">Projet photovoltaïque,</span>
              <span className="p1-premium__title-line p1-premium__title-line--accent">dimensionné pour durer</span>
            </h1>
            <p className="p1-premium__lede">
              Une installation calée sur la consommation du site, le bâtiment support et la performance économique sur le long terme.
            </p>
            <div className="p1-premium__signature" aria-label="Indicateurs clés du scénario">
              <div className="p1-premium__sig-row">
                <span className="p1-premium__sig-label">Puissance retenue</span>
                <strong id="p1_m_kwc">—</strong>
              </div>
              <div className="p1-premium__sig-row">
                <span className="p1-premium__sig-label">Couverture estimée</span>
                <strong id="p1_m_auto">—</strong>
              </div>
              <div className="p1-premium__sig-row">
                <span className="p1-premium__sig-label">Gain projeté</span>
                <strong id="p1_m_gain">—</strong>
              </div>
            </div>
          </div>

          <div className="p1-premium__hero-visual">
            <p className="p1-premium__caption">Vue illustrative d&apos;une installation SolarGlobe</p>
            <div className="p1-premium__photo-frame" id="p1_photo">
              <img
                id="p1_photo_img"
                src={coverUrl}
                alt="Illustration d'une centrale photovoltaïque sur bâtiment"
              />
            </div>
          </div>
        </div>

        <div className="p1-premium__kpi-band">
          <div className="p1-premium__kpi-cell">
            <div className="p1-premium__kpi-label">Puissance installée</div>
            <div className="p1-premium__kpi-value" id="p1_k_puissance">
              6,7 kWc
            </div>
            <div className="p1-premium__kpi-micro">Installation retenue</div>
          </div>
          <div className="p1-premium__kpi-cell">
            <div className="p1-premium__kpi-label">Couverture estimée</div>
            <div className="p1-premium__kpi-value" id="p1_k_autonomie">
              72 %
            </div>
            <div className="p1-premium__kpi-micro">Part de consommation couverte</div>
          </div>
          <div className="p1-premium__kpi-cell">
            <div className="p1-premium__kpi-label">TRI</div>
            <div className="p1-premium__kpi-value" id="p1_k_tri">
              10 ans
            </div>
            <div className="p1-premium__kpi-micro">Rentabilité projetée</div>
          </div>
          <div className="p1-premium__kpi-cell">
            <div className="p1-premium__kpi-label">Gain net 25 ans</div>
            <div className="p1-premium__kpi-value" id="p1_k_gains">
              27 000 €
            </div>
            <div className="p1-premium__kpi-micro">Projection indicative</div>
          </div>
        </div>

        <div className="p1-premium__dual">
          <div className="p1-premium__panel">
            <h2 className="p1-premium__panel-heading">
              Pourquoi ce scénario est cohérent
              <br />
              <span className="p1-premium__panel-heading-sub">pour le site étudié</span>
            </h2>
            <ul className="p1-premium__why-list">
              <li>Priorité à la consommation locale de la production PV</li>
              <li>Atténuation de l&apos;exposition aux hausses tarifaires</li>
              <li>Investissement structuré, rentable et pérenne</li>
            </ul>
          </div>
          <div className="p1-premium__panel">
            <h2 className="p1-premium__panel-heading">Paramètres techniques du dossier</h2>
            <div className="p1-premium__tech-grid">
              <div className="p1-premium__tech-item">
                <span className="p1-premium__tech-k">Raccordement</span>
                <strong id="p1_param_kva">6 kVA</strong>
              </div>
              <div className="p1-premium__tech-item">
                <span className="p1-premium__tech-k">Réseau</span>
                <strong id="p1_param_reseau">Triphasé</strong>
              </div>
              <div className="p1-premium__tech-item p1-premium__tech-item--full">
                <span className="p1-premium__tech-k">Consommation annuelle</span>
                <strong id="p1_param_conso">7 000 kWh/an</strong>
              </div>
            </div>
          </div>
        </div>

        <p className="p1-premium__footnote">
          Ce dossier s&apos;appuie sur le profil de consommation du site, la toiture (ou support) étudiée et des hypothèses techniques réalistes.
        </p>
      </div>
    </PdfPageLayout>
  );
}
