/**
 * CP-PDF — Page 12 — Clôture impact & accompagnement (alignée P7/P11)
 * Fond standard PDF, cartes premium beige/doré. Meta #p12_* pour engine-p12.js.
 */
import React, { useMemo } from "react";
import PdfPageLayout from "../PdfEngine/PdfPageLayout";
import PdfHeader from "../../../components/pdf/PdfHeader";
import { getCrmApiBaseWithWindowFallback } from "@/config/crmApiBase";
import "./pdf-page12-closing.css";

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

export default function PdfPage12({
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
      className="p12-closing-page"
      legacyPort={{
        id: "p12",
        sectionGap: "0",
        pageStyle: {
          pageBreakAfter: "auto",
          breakAfter: "auto",
          marginBottom: 0,
        },
        header: (
          <PdfHeader
            headerStyle={{
              ["--logoW" as string]: "26mm",
              ["--metaW" as string]: "120mm",
              flexShrink: 0,
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
            badge="Les étapes du projet"
            metaColumn={
              <div
                className="meta-compact"
                id="p12_meta_line"
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
                  <b>Client</b> : <span id="p12_client">—</span>
                </div>
                <div>
                  <b>Réf.</b> : <span id="p12_ref">—</span>
                </div>
                <div>
                  <b>Date</b> : <span id="p12_date">—</span>
                </div>
              </div>
            }
          />
        ),
      }}
    >
      <div className="p12-premium">
        <header className="p12-hero">
          <h1 className="p12-hero__title">Le dossier est structuré et prêt à accompagner votre décision.</h1>
          <p className="p12-hero__sub">Des bases techniques et économiques lisibles pour décider en confiance.</p>
        </header>

        <div className="p12-band" aria-label="Engagements">
          <div className="p12-band__block">
            <div className="p12-band__block-title">Projet structuré</div>
            <p className="p12-band__block-text">
              Une étude construite sur des bases techniques et économiques cohérentes
            </p>
          </div>
          <div className="p12-band__block">
            <div className="p12-band__block-title">Accompagnement complet</div>
            <p className="p12-band__block-text">Un projet cadré de l&apos;étude jusqu&apos;à la mise en service</p>
          </div>
          <div className="p12-band__block">
            <div className="p12-band__block-title">Mise en œuvre maîtrisée</div>
            <p className="p12-band__block-text">Une installation pensée pour durer et rester cohérente</p>
          </div>
        </div>

        <div className="p12-central">
          <article className="p12-card p12-card--left">
            <h2 className="p12-card__title">Les prochaines étapes</h2>
            <div className="p12-benefits">
              <div className="p12-benefit">
                <strong>Validation du projet</strong>
                <span>
                  Validation de l&apos;offre, du financement éventuel et du cadre final du projet avant lancement.
                </span>
              </div>
              <div className="p12-benefit">
                <strong>Préparation technique</strong>
                <span>
                  Relevé final, implantation, vérifications techniques et ajustements nécessaires avant pose.
                </span>
              </div>
              <div className="p12-benefit">
                <strong>Mise en œuvre</strong>
                <span>
                  Démarches, coordination, installation, mise en service et accompagnement jusqu&apos;à l&apos;activation.
                </span>
              </div>
            </div>
            <p className="p12-card-summary">
              Un cadrage méthodologique pour avancer sans absorber seul la complexité du déploiement.
            </p>
            <div className="p12-card-extra p12-card-extra--left">
              <h3 className="p12-card__subtitle">Apports pour la décision</h3>
              <div className="p12-pills">
                <span className="p12-pill">Vision claire</span>
                <span className="p12-pill">Décision simplifiée</span>
                <span className="p12-pill">Projet prêt à avancer</span>
              </div>
            </div>
          </article>

          <article className="p12-card p12-card--right">
            <h2 className="p12-card__title">Un accompagnement cadré</h2>
            <div className="p12-right-stack">
              <ul className="p12-right-list" role="list">
                <li className="p12-right-list__row">
                  <span className="p12-right-list__dot" aria-hidden />
                  <span className="p12-right-list__text">Étude &amp; dimensionnement</span>
                </li>
                <li className="p12-right-list__row">
                  <span className="p12-right-list__dot" aria-hidden />
                  <span className="p12-right-list__text">Implantation validée</span>
                </li>
                <li className="p12-right-list__row">
                  <span className="p12-right-list__dot" aria-hidden />
                  <span className="p12-right-list__text">Vérifications techniques</span>
                </li>
                <li className="p12-right-list__row">
                  <span className="p12-right-list__dot" aria-hidden />
                  <span className="p12-right-list__text">Démarches administratives</span>
                </li>
                <li className="p12-right-list__row">
                  <span className="p12-right-list__dot" aria-hidden />
                  <span className="p12-right-list__text">Coordination de l&apos;installation</span>
                </li>
                <li className="p12-right-list__row">
                  <span className="p12-right-list__dot" aria-hidden />
                  <span className="p12-right-list__text">Mise en service &amp; suivi</span>
                </li>
              </ul>
              <p className="p12-tagline p12-tagline--right">
                Le décideur conserve la main sur les arbitrages ; la chaîne technique et administrative est pilotée de bout en bout.
              </p>
              <h3 className="p12-card__subtitle p12-card__subtitle--afterTagline">Un cadre rassurant à chaque étape</h3>
              <div className="p12-pills p12-pills--rightEnd">
                <span className="p12-pill">Administratif encadré</span>
                <span className="p12-pill">Suivi lisible</span>
                <span className="p12-pill">Décisions facilitées</span>
              </div>
            </div>
          </article>
        </div>

        <footer className="p12-foot">
          <div className="p12-foot__closure" aria-hidden="true">
            <div className="p12-foot__closure-line" />
            <div className="p12-foot__closure-markers">
              <span>Projet structuré</span>
              <span className="p12-foot__closure-dot" />
              <span>Accompagnement clair</span>
              <span className="p12-foot__closure-dot" />
              <span>Décision sereine</span>
            </div>
          </div>
          <p className="p12-foot__quote">Une vision claire aujourd&apos;hui, pour une décision plus sereine demain.</p>
          <p className="p12-foot__legal">
            Étude et estimations fournies à titre indicatif, sous réserve de validation technique finale et des
            conditions réelles du site.
          </p>
        </footer>
      </div>
    </PdfPageLayout>
  );
}
