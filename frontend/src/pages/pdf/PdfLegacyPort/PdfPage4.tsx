/**
 * CP-PDF — Page 4 Production annuelle simplifiée
 * Architecture alignée P1/P2/P3 : données via viewModel.fullReport.p4, rendu React pur.
 * Logo : même logique que P1 (organization + getStorageUrl + fallback).
 */

import { useEffect, useMemo } from "react";
import ChartP4Production from "./ChartP4Production";
import PdfPageLayout from "../PdfEngine/PdfPageLayout";
import PdfHeader from "../../../components/pdf/PdfHeader";
import { usePdfOrgBranding } from "./pdfOrgBrandingContext";
import { getCrmApiBaseWithWindowFallback } from "@/config/crmApiBase";

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

const EMPTY = "—";

function fmt(v: unknown): string {
  if (v == null || v === "") return EMPTY;
  return String(v);
}

function fmtKwh(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return EMPTY;
  return `${Math.round(v).toLocaleString("fr-FR")} kWh`;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return EMPTY;
  return `${Math.round(v)} %`;
}

function fmtEur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return EMPTY;
  return `${Math.round(v).toLocaleString("fr-FR")} €`;
}

export interface P4Data {
  meta?: { client?: string; ref?: string; date?: string; date_display?: string };
  production_kwh?: number[];
  consommation_kwh?: number[];
  autoconso_kwh?: number[];
  surplus_kwh?: number[];
  batterie_kwh?: number[];
  production_annuelle?: number;
  consommation_annuelle?: number;
  energie_consommee_directement?: number;
  energie_injectee?: number;
  taux_autoconsommation_pct?: number | null;
  couverture_besoins_pct?: number | null;
  autonomie_pct?: number | null;
  economie_annee_1?: number;
  scenario_type?: string;
  surplus_brut_kwh?: number | null;
  revenu_revente_eur?: number | null;
  restitution_batterie_kwh?: number | null;
  charge_batterie_kwh?: number | null;
  pertes_batterie_kwh?: number | null;
  credit_virtuel_utilise_kwh?: number | null;
  cout_batterie_virtuelle_eur?: number | null;
}

export default function PdfPage4({
  organization = {},
  viewModel,
}: {
  organization?: { id?: string; logo_image_key?: string | null; logo_url?: string | null; pdf_cover_image_key?: string | null };
  viewModel?: { fullReport?: Record<string, unknown>; meta?: { studyId?: string; versionId?: string }; [key: string]: unknown };
}) {
  const logoUrl = useMemo(() => {
    const logoDirect = organization?.logo_url;
    if (logoDirect) return logoDirect;

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

  const fr = (viewModel?.fullReport ?? {}) as Record<string, unknown>;
  const p4 = (fr.p4 ?? {}) as P4Data;

  const meta = p4.meta ?? {};
  const prod = p4.production_kwh ?? [];
  const conso = p4.consommation_kwh ?? [];
  const auto = p4.autoconso_kwh ?? [];
  const surplus = p4.surplus_kwh ?? [];
  const batt = p4.batterie_kwh ?? [];

  useEffect(() => {
    console.log("P4_PAGE_SERIES_RECEIVED", {
      scenarioType:
        (viewModel?.selectedScenario as { scenarioType?: string } | undefined)?.scenarioType ??
        (viewModel?.meta as { scenarioType?: string } | undefined)?.scenarioType ??
        p4.scenario_type ??
        "BASE",
      production_kwh: prod,
      consommation_kwh: conso,
      autoconso_kwh: auto,
      batterie_kwh: batt,
      july_conso: conso[6] ?? null,
      august_conso: conso[7] ?? null,
    });
  }, [auto, batt, conso, p4.scenario_type, prod, viewModel?.meta, viewModel?.selectedScenario]);

  const prodAnnuelle = p4.production_annuelle ?? prod.reduce((a, b) => a + (b ?? 0), 0);
  const consoAnnuelle = p4.consommation_annuelle ?? conso.reduce((a, b) => a + (b ?? 0), 0);
  const autoAnnuelle = p4.energie_consommee_directement ?? auto.reduce((a, b) => a + (b ?? 0), 0);
  const surplusAnnuelle = p4.energie_injectee ?? surplus.reduce((a, b) => a + (b ?? 0), 0);
  const couverture = p4.couverture_besoins_pct;
  const economieAn1 = p4.economie_annee_1 ?? 0;
  // Type de scénario : champ p4 (mapper récent) sinon champ global du view-model (toujours présent)
  const scenarioType =
    (viewModel?.selectedScenario as { scenarioType?: string } | undefined)?.scenarioType ??
    (viewModel?.meta as { scenarioType?: string } | undefined)?.scenarioType ??
    p4.scenario_type ??
    "BASE";
  const isPhys = scenarioType === "BATTERY_PHYSICAL";
  const isVirt = scenarioType === "BATTERY_VIRTUAL";
  const isHyb = scenarioType === "BATTERY_HYBRID";
  // Valeurs : champ mapper si présent, sinon recalcul à partir des données déjà dans p4 (jamais "—")
  const econVm = (viewModel?.economics ?? {}) as { annualRevenue?: number | null };
  const battTotalKwh = batt.reduce((a, b) => a + (b ?? 0), 0);
  const restitutionKwh = p4.restitution_batterie_kwh ?? (battTotalKwh > 0 ? battTotalKwh : null);
  const directKwh = Math.max(0, autoAnnuelle - (restitutionKwh ?? 0));
  const surplusBrutKwh = p4.surplus_brut_kwh ?? Math.max(0, prodAnnuelle - directKwh);
  const revenuReventeEur = p4.revenu_revente_eur ?? econVm.annualRevenue ?? null;
  const coutVbEur = p4.cout_batterie_virtuelle_eur ?? null;
  const pertesKwh = p4.pertes_batterie_kwh ?? null;
  // 2 emplacements de synthèse dépendants du scénario (même nombre d'items → mise en page inchangée)
  const extraItems: { label: string; value: string }[] = isPhys
    ? [
        { label: "Restitution batterie", value: fmtKwh(restitutionKwh) },
        pertesKwh != null
          ? { label: "Pertes batterie", value: fmtKwh(pertesKwh) }
          : { label: "Surplus injecté", value: fmtKwh(surplusAnnuelle) },
      ]
    : isVirt
      ? [
          { label: "Crédit virtuel utilisé", value: fmtKwh(restitutionKwh) },
          coutVbEur != null
            ? { label: "Coût batterie virtuelle/an", value: fmtEur(coutVbEur) }
            : { label: "Surplus injecté", value: fmtKwh(surplusAnnuelle) },
        ]
      : isHyb
        ? [
            { label: "Restitution batterie", value: fmtKwh(restitutionKwh) },
            coutVbEur != null
              ? { label: "Coût batterie virtuelle/an", value: fmtEur(coutVbEur) }
              : { label: "Surplus injecté", value: fmtKwh(surplusAnnuelle) },
          ]
        : [
            { label: "Surplus brut", value: fmtKwh(surplusBrutKwh) },
            { label: "Revenu revente", value: fmtEur(revenuReventeEur) },
          ];
  const baseNote = "Le surplus brut est la production solaire non utilisée en direct.";
  const scenarioNote =
    isPhys || isHyb
      ? `${baseNote} La batterie la restitue le soir et la nuit ; une faible part (~10 %) est perdue au stockage.`
      : isVirt
        ? `${baseNote} Ce surplus est crédité chez le fournisseur puis repris plus tard ; un coût annuel s'applique au service.`
        : `${baseNote} Sans stockage, il est injecté et revendu au réseau (faible valorisation).`

  const hasData = prodAnnuelle > 0 || consoAnnuelle > 0;

  const { brandHex } = usePdfOrgBranding();

  return (
    <PdfPageLayout
      legacyPort={{
        id: "p4",
        dataEngine: "prodconso",
        sectionGap: "3mm",
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
                  alt="Logo"
                  style={{ position: "absolute", left: 0, top: 0, height: "18mm", objectFit: "contain" }}
                />
              ) : null
            }
            badge="Production solaire sur une année"
            metaColumn={
              <div
                className="meta-compact"
                id="p4_meta_line"
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
                  <b>Client</b> : {fmt(meta.client)}
                </div>
                <div>
                  <b>Réf.</b> : {fmt(meta.ref)}
                </div>
                <div>
                  <b>Date</b> : {fmt(meta.date_display ?? meta.date)}
                </div>
              </div>
            }
          />
        ),
      }}
    >
      {/* 1. Phrase d'introduction */}
      <p
        style={{
          margin: "0 0 2.6mm 0",
          fontSize: "3.55mm",
          lineHeight: 1.42,
          color: "#475569",
          flexShrink: 0,
        }}
      >
        Sur une année complète, le générateur PV couvre une part significative des besoins du site et réduit les achats sur le réseau.
      </p>

      {/* 2. Graph — élément principal (cadre agrandi : padding + border-radius) */}
      <div
        className="card soft chart-card premium"
        style={{
          padding: "5.2mm 3.2mm 5.4mm",
          border: "0.45mm solid rgba(195,152,71,.24)",
          borderRadius: "5.5mm",
          display: hasData ? "flex" : "none",
          flexDirection: "column",
          flex: "1 1 auto",
          minHeight: 0,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "2.4mm", flexShrink: 0 }}>
          <h3 style={{ margin: 0, color: brandHex, fontSize: "4.4mm", fontWeight: 800, letterSpacing: "0.02em" }}>Répartition mensuelle</h3>
        </div>

        {/* Mention profil conso — même vérité que l'écran (notice produite par le mapper PDF) */}
        {(() => {
          const trace = (viewModel as { consumption_trace?: { scenario_uses_piloted_profile?: boolean } } | undefined)?.consumption_trace;
          const piloted = trace?.scenario_uses_piloted_profile === true;
          const notice =
            (viewModel as { consumption_profile_notice?: string } | undefined)?.consumption_profile_notice ??
            (piloted
              ? "Profil de consommation : optimisation solaire des usages activée."
              : "Profil de consommation : consommation actuelle non optimisée.");
          const sourceLabel =
            (viewModel as { consumption_source_label?: string } | undefined)?.consumption_source_label ?? null;
          return (
            <p
              className="p4-consumption-notice"
              data-testid="p4-consumption-notice"
              style={{ margin: "0 0 2.4mm", fontSize: "3.1mm", color: "rgba(0,0,0,.62)", lineHeight: 1.3, flexShrink: 0 }}
            >
              {notice}
              {sourceLabel ? ` — ${sourceLabel}` : ""}
            </p>
          );
        })()}

        <div style={{ height: "74mm", position: "relative", flexShrink: 0 }}>
          {hasData && (
            <ChartP4Production
              production={prod}
              consommation={conso}
              autoconso={auto}
              batterie={batt}
            />
          )}
        </div>

        {/* Légende — wording client */}
        <div className="legend legend-row" style={{ marginTop: "2.8mm", flexShrink: 0 }}>
          <span className="pill pill-violet" />
          <div className="legend-text"><b>Consommation du site</b><br /><span className="sub">besoins totaux</span></div>
          <span className="pill pill-gold" />
          <div className="legend-text"><b>Production PV</b><br /><span className="sub">générateur posé</span></div>
          <span className="pill pill-cyan" />
          <div className="legend-text"><b>Énergie utilisée directement</b><br /><span className="sub">sans passer par le réseau</span></div>
          {batt.some((b) => (b ?? 0) > 0) && (
            <>
              <span className="pill pill-green" />
              <div className="legend-text"><b>Énergie stockée</b><br /><span className="sub">batterie</span></div>
            </>
          )}
        </div>
      </div>

      {/* 3. Synthèse annuelle — ultra compacte */}
      {hasData && (
        <div className="p4-synthese" style={{ flexShrink: 0 }}>
          <div className="p4-kpi-line">
            <div className="kpi-item highlight"><span>Production</span><strong>{fmtKwh(prodAnnuelle)}</strong></div>
            <div className="kpi-item"><span>Consommation</span><strong>{fmtKwh(consoAnnuelle)}</strong></div>
            <div className="kpi-item highlight"><span>Énergie autoconsommée</span><strong>{fmtKwh(autoAnnuelle)}</strong></div>
            <div className="kpi-item"><span>Part couverte</span><strong>{fmtPct(couverture)}</strong></div>
            {extraItems.map((it, i) => (
              <div className="kpi-item highlight" key={i}><span>{it.label}</span><strong>{it.value}</strong></div>
            ))}
            <div className="kpi-item highlight"><span>Économies an 1</span><strong>{fmtEur(economieAn1)}</strong></div>
          </div>
        </div>
      )}

      {/* 4. Texte pédagogique — respiration bas de page */}
      <p
        style={{
          margin: "2.4mm 0 0 0",
          fontSize: "3.15mm",
          lineHeight: 1.45,
          color: "#64748b",
          flexShrink: 0,
        }}
      >
        {scenarioNote}
      </p>

      {/* État vide (pas de données) */}
      {!hasData && (
        <div
          className="card soft"
          style={{
            padding: "6mm",
            border: "0.5mm solid rgba(195,152,71,.25)",
            textAlign: "center",
            color: "#666",
            fontSize: "3.6mm",
          }}
        >
          Aucune donnée de production disponible pour cette étude.
        </div>
      )}
    </PdfPageLayout>
  );
}
