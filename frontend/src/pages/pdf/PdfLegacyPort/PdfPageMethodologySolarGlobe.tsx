/**
 * CP-PDF — Page « Méthodologie de calcul SolarGlobe »
 * Insérée en avant-dernière position (après P11 financement, avant P12 clôture).
 * Contenu éditorial statique ; méta client/ref/date alignées sur fullReport.p10.
 */
import React, { useMemo } from "react";
import PdfPageLayout from "../PdfEngine/PdfPageLayout";
import PdfHeader from "../../../components/pdf/PdfHeader";
import { usePdfOrgBranding } from "./pdfOrgBrandingContext";
import "./pdf-page-methodology-solarglobe.css";
import { getCrmApiBaseWithWindowFallback } from "@/config/crmApiBase";

function val(v: unknown): string {
  if (v == null || v === "") return "—";
  return String(v);
}

const SCOPE_ITEMS = [
  "Géométrie réelle du projet",
  "Orientation et inclinaison",
  "Environnement proche et lointain",
  "Potentiel de production",
  "Logique d’autoconsommation",
  "Hypothèses économiques du dossier",
];

const WORKFLOW = [
  {
    title: "Données d’entrée",
    items: ["Site & implantation PV", "Environnement & masques solaires", "Consommation & usages", "Hypothèses tarifaires"],
  },
  {
    title: "Modélisation",
    items: ["Production estimée", "Ombrages & rendement", "Valorisation énergétique", "Scénarios comparés"],
  },
  {
    title: "Résultats",
    items: ["Bilan de production annuel", "Autoconsommation", "Bilan global", "Indicateurs économiques"],
  },
] as const;

type MethodologyBlock = {
  title: string;
  tagline: string;
  bullets: string[];
  body: string;
};

const BLOCKS: MethodologyBlock[] = [
  {
    title: "Implantation réelle du projet",
    tagline: "Plan de pose (calepinage) et géométrie comme socle du calcul",
    bullets: [
      "Pans et géométrie du bâtiment support modélisés",
      "Position réelle des modules sur le plan de pose",
      "Orientation et inclinaison par zone ou par pan",
      "Répartition du champ PV (puissance, densité)",
    ],
    body:
      "Les paramètres géométriques ne sont pas des moyennes nationales : ils reflètent l’implantation telle que définie dans l’étude. Toute évolution de pose (déplacement, nombre de modules) modifie la chaîne de calcul en amont.",
  },
  {
    title: "Estimation de la production solaire",
    tagline: "Projection annuelle cohérente avec le champ modélisé",
    bullets: [
      "Exposition : azimut et pente des générateurs",
      "Ressource solaire et ensoleillement du site",
      "Technologie et puissance du générateur",
      "Cohérence d’ensemble du parc de modules",
    ],
    body:
      "La production annuelle estimée agrège des pas de temps représentatifs : elle vise une moyenne pertinente pour dimensionner et comparer des scénarios, pas une courbe journalière contractuelle.",
  },
  {
    title: "Environnement et ombrage",
    tagline: "Obstacles proches et horizon dans le même bilan",
    bullets: [
      "Obstacles de proximité (volumes, masques locaux)",
      "Horizon lointain / relief lorsque les données le permettent",
      "Prise en compte des masques solaires dans le modèle",
      "Contribution à une baisse annuelle moyenne estimée",
    ],
    body:
      "L’ombrage est intégré comme composante du rendement global : il complète implantation et ressource solaire. Il ne constitue pas à lui seul l’intégralité du dimensionnement économique.",
  },
  {
    title: "Autoconsommation et valorisation",
    tagline: "De la production brute à l’énergie utile",
    bullets: [
      "Profil de consommation et courbe de charge retenus",
      "Part autoconsommée vs surplus selon les hypothèses",
      "Logique de valorisation (économies, injection, etc.)",
      "Cohérence entre usages déclarés et scénario chiffré",
    ],
    body:
      "La valorisation énergétique relie production estimée et comportement du site. Elle reste conditionnée par les hypothèses de consommation et tarifaires saisies dans le dossier.",
  },
  {
    title: "Simulation économique",
    tagline: "Indicateurs structurés, pas une prévision de marché",
    bullets: [
      "Production et valorisation comme entrées du bilan",
      "Investissement, aides et hypothèses du dossier",
      "Comparaison de scénarios sur une base commune",
      "Projection sur l’horizon d’analyse retenu",
    ],
    body:
      "Les indicateurs économiques traduisent, sous forme synthétique, une chaîne de calcul documentée. Ils servent à arbitrer et à prioriser, sans figer les conditions futures de rémunération ou de contrat.",
  },
  {
    title: "Hypothèses et limites du modèle",
    tagline: "Estimation technique encadrée, décision éclairée",
    bullets: [
      "Résultats = estimations, pas mesures instrumentées",
      "Aide au dimensionnement et à la comparaison",
      "Non substitut à un relevé terrain ou à un audit chantier",
      "Cadre d’usage : sérieux, transparent, non absolu",
    ],
    body:
      "Le modèle vise la cohérence interne du dossier et la comparabilité entre variantes. Il ne prétend pas anticiper chaque aléa d’exploitation ni remplacer le jugement professionnel sur place.",
  },
];

const PERMET = [
  "Comparer plusieurs implantations ou scénarios sur des bases identiques",
  "Dimensionner le générateur et la valorisation de manière structurée",
  "Projeter des trajectoires économiques cohérentes avec les hypothèses",
  "Arbitrer le projet avec des ordres de grandeur homogènes",
];

const NE_PRETEND_PAS = [
  "Prédire chaque kWh réel à l’exactitude près sur toute la durée de vie",
  "Remplacer un relevé instrumenté ou une visite technique dédiée",
  "Figer les usages futurs du site ou la réglementation applicable",
  "Constituer une promesse absolue de performance ou de gain net",
];

const API_BASE = getCrmApiBaseWithWindowFallback();
const PLACEHOLDER_LOGO = "/pdf-assets/images/logo-solarglobe-rect.png";

function getLogoUrl(
  organization: { id?: string; logo_image_key?: string | null } | undefined,
  viewModel: { meta?: { studyId?: string; versionId?: string } } | undefined
): string {
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const renderToken = params?.get("renderToken") ?? "";
  const studyId = params?.get("studyId") ?? viewModel?.meta?.studyId ?? "";
  const versionId = params?.get("versionId") ?? viewModel?.meta?.versionId ?? "";
  const orgId = organization?.id;
  if (!orgId || !renderToken || !studyId || !versionId || !organization?.logo_image_key) return PLACEHOLDER_LOGO;
  return `${API_BASE}/api/internal/pdf-asset/${orgId}/logo?renderToken=${encodeURIComponent(renderToken)}&studyId=${encodeURIComponent(studyId)}&versionId=${encodeURIComponent(versionId)}`;
}

export default function PdfPageMethodologySolarGlobe({
  viewModel,
  organization,
}: {
  viewModel?: { fullReport?: Record<string, unknown>; meta?: { studyId?: string; versionId?: string } };
  organization?: { id?: string; logo_image_key?: string | null };
}) {
  const p10 = viewModel?.fullReport?.p10 as { meta?: { client?: string; ref?: string; date?: string } } | undefined;
  const meta = p10?.meta ?? {};
  const { orgDisplayName } = usePdfOrgBranding();
  const methodologyLogoUrl = useMemo(() => getLogoUrl(organization, viewModel), [organization, viewModel]);

  return (
    <PdfPageLayout
      className="p-methodology-page"
      legacyPort={{
        id: "p-methodology-solarglobe",
        sectionGap: "0",
        header: (
          <PdfHeader
            headerStyle={{
              ["--logoW" as string]: "26mm",
              ["--metaW" as string]: "120mm",
            }}
            logo={
              <img
                src={methodologyLogoUrl}
                alt=""
                style={{ position: "absolute", left: 0, top: 0, height: "16mm", objectFit: "contain" }}
              />
            }
            badge="Méthodologie"
            metaColumn={
              <div
                className="meta-compact"
                id="p_methodology_meta_line"
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
                <span>
                  Client : <span id="p_methodology_client">{val(meta.client)}</span>
                </span>
                <span>
                  Ref : <span id="p_methodology_ref">{val(meta.ref)}</span>
                </span>
                <span>
                  Date : <span id="p_methodology_date">{val(meta.date)}</span>
                </span>
              </div>
            }
          />
        ),
      }}
    >
      <div className="p-msg-premium">
        <header className="p-msg-hero">
          <h1 className="p-msg-hero__title">
            Méthodologie de calcul
            {orgDisplayName ? ` — ${orgDisplayName}` : ""}
          </h1>
          <p className="p-msg-hero__lead">
            Une chaîne de calcul documentée, du relevé d’implantation aux indicateurs de synthèse — pour estimer le
            projet avec rigueur et lisibilité.
          </p>
          <p className="p-msg-hero__intro">
            Les résultats de ce dossier ne découlent pas d’un ratio isolé : ils s’appuient sur des hypothèses techniques
            et économiques cohérentes entre elles, calées sur l’implantation retenue. L’objectif est une estimation réaliste,
            exploitable et comparable d’une étude à l’autre.
          </p>
          <p className="p-msg-hero__frame">
            Cette méthodologie vise une estimation techniquement cohérente, reproductible entre dossiers, et non un simple
            coefficient théorique déconnecté du projet.
          </p>
        </header>

        <section className="p-msg-scope" aria-label="Périmètre pris en compte">
          <div className="p-msg-scope__head">
            <span className="p-msg-scope__label">Ce que notre étude prend en compte</span>
          </div>
          <ul className="p-msg-scope__list">
            {SCOPE_ITEMS.map((label) => (
              <li key={label} className="p-msg-scope__chip">
                {label}
              </li>
            ))}
          </ul>
        </section>

        <section className="p-msg-workflow" aria-label="Logique générale de calcul">
          <h2 className="p-msg-workflow__title">Logique générale de calcul</h2>
          <div className="p-msg-workflow__cols">
            {WORKFLOW.map((col, idx) => (
              <React.Fragment key={col.title}>
                {idx > 0 && (
                  <div className="p-msg-workflow__arrow" aria-hidden="true">
                    <span className="p-msg-workflow__arrow-line" />
                    <span className="p-msg-workflow__arrow-head">▶</span>
                  </div>
                )}
                <div className="p-msg-workflow__col">
                  <h3 className="p-msg-workflow__col-title">{col.title}</h3>
                  <ul className="p-msg-workflow__ul">
                    {col.items.map((it) => (
                      <li key={it}>{it}</li>
                    ))}
                  </ul>
                </div>
              </React.Fragment>
            ))}
          </div>
        </section>

        <div className="p-msg-grid" aria-label="Détail méthodologique">
          {BLOCKS.map((b) => (
            <article key={b.title} className="p-msg-card">
              <h2 className="p-msg-card__title">{b.title}</h2>
              <p className="p-msg-card__tagline">{b.tagline}</p>
              <ul className="p-msg-card__bullets">
                {b.bullets.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="p-msg-card__text">{b.body}</p>
            </article>
          ))}
        </div>

        <section className="p-msg-dual" aria-label="Portée de l’étude">
          <div className="p-msg-dual__col p-msg-dual__col--yes">
            <h3 className="p-msg-dual__title">Cette étude permet</h3>
            <ul className="p-msg-dual__ul">
              {PERMET.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <div className="p-msg-dual__col p-msg-dual__col--no">
            <h3 className="p-msg-dual__title">Cette étude ne prétend pas</h3>
            <ul className="p-msg-dual__ul">
              {NE_PRETEND_PAS.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </PdfPageLayout>
  );
}
