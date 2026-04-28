/**
 * CP-PDF — Page 5 Journée type (projection client)
 * Graphique : même famille visuelle que P4 (`ChartP4Production`) — `ChartP5DayProfile`, données `fullReport.p5`.
 */
import React, { useMemo } from "react";
import PdfPageLayout from "../PdfEngine/PdfPageLayout";
import PdfHeader from "../../../components/pdf/PdfHeader";
import { hexToRgba } from "../pdfBrand";
import { usePdfOrgBranding } from "./pdfOrgBrandingContext";
import ChartP5DayProfile from "./ChartP5DayProfile";
import { getCrmApiBaseWithWindowFallback } from "@/config/crmApiBase";

function as24(arr: unknown): number[] {
  if (!Array.isArray(arr)) return Array(24).fill(0);
  const out = arr.slice(0, 24).map((x) => (Number.isFinite(Number(x)) ? Number(x) : 0));
  while (out.length < 24) out.push(0);
  return out;
}

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

export default function PdfPage5({
  organization = {},
  viewModel,
}: {
  organization?: { id?: string; logo_image_key?: string | null; logo_url?: string | null };
  viewModel?: { fullReport?: Record<string, unknown>; meta?: { studyId?: string; versionId?: string }; [key: string]: unknown };
}) {
  const fr = viewModel?.fullReport as Record<string, unknown> | undefined;
  const p5 = fr?.p5 as
    | {
        meta?: { client?: string; ref?: string; date?: string };
        production_kw?: number[];
        consommation_kw?: number[];
        batterie_kw?: number[];
        profile_notes?: { production?: string; consumption?: string };
      }
    | undefined;

  const prod24 = useMemo(() => as24(p5?.production_kw), [p5?.production_kw]);
  const conso24 = useMemo(() => as24(p5?.consommation_kw), [p5?.consommation_kw]);
  const batt24 = useMemo(() => as24(p5?.batterie_kw), [p5?.batterie_kw]);
  const metaP5 = p5?.meta ?? {};
  const hasBatteryChart = useMemo(() => batt24.some((x) => Math.abs(x) > 1e-9), [batt24]);
  const hasChartData = useMemo(
    () => prod24.some((x) => x > 0) || conso24.some((x) => x > 0),
    [prod24, conso24]
  );

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

  const { brandHex } = usePdfOrgBranding();

  return (
    <PdfPageLayout
      legacyPort={{
        id: "p5",
        dataEngine: "journee-type",
        sectionGap: "3.5mm",
        pageStyle: {
          pageBreakBefore: "always",
          breakBefore: "page" as const,
          pageBreakAfter: "always",
          breakAfter: "page" as const,
        },
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
            badge="Impact photovoltaïque — journée type"
            metaColumn={
              <div
                className="meta-compact"
                id="p5_meta_line"
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
                  <b>Client</b> : <span id="p5_client">{metaP5.client != null && metaP5.client !== "" ? String(metaP5.client) : "—"}</span>
                </div>
                <div>
                  <b>Réf.</b> : <span id="p5_ref">{metaP5.ref != null && metaP5.ref !== "" ? String(metaP5.ref) : "—"}</span>
                </div>
                <div>
                  <b>Date</b> : <span id="p5_date">{metaP5.date != null && metaP5.date !== "" ? String(metaP5.date) : "—"}</span>
                </div>
              </div>
            }
          />
        ),
      }}
    >
      {/* 1. Intro (aligné P4) */}
      <p
        style={{
          margin: "0 0 2mm 0",
          fontSize: "3.6mm",
          lineHeight: 1.4,
          color: "#444",
          flexShrink: 0,
        }}
      >
        Schéma d&apos;une journée type : production PV et courbe de consommation du site.
      </p>

      {/* 2. Texte explicatif court */}
      <p
        style={{
          margin: "0 0 3mm 0",
          fontSize: "3.4mm",
          lineHeight: 1.4,
          color: "#555",
          flexShrink: 0,
        }}
      >
        En journée, les modules couvrent en direct une large part de la demande instantanée du site, ce qui limite fortement les prélèvements sur le réseau.
      </p>

      {/* 3. Graphique — même cadrage / légende que P4 (répartition mensuelle → journée 24 h) */}
      <div
        id="p5_chart_zone"
        className="card soft chart-card premium"
        style={{
          padding: "5.2mm 3.2mm 5.4mm",
          border: "0.45mm solid rgba(195,152,71,.24)",
          borderRadius: "5.5mm",
          display: p5 && hasChartData ? "flex" : "none",
          flexDirection: "column",
          flex: "1 1 auto",
          minHeight: 0,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "2.4mm", flexShrink: 0 }}>
          <h3 style={{ margin: 0, color: brandHex, fontSize: "4.4mm", fontWeight: 800, letterSpacing: "0.02em" }}>
            Puissance sur une journée type (kW)
          </h3>
        </div>

        <div style={{ height: "74mm", position: "relative", flexShrink: 0 }}>
          {hasChartData && (
            <ChartP5DayProfile production_kw={prod24} consommation_kw={conso24} batterie_kw={batt24} />
          )}
        </div>

        <div className="legend legend-row" style={{ marginTop: "2.8mm", flexShrink: 0 }}>
          <span className="pill pill-violet" />
          <div className="legend-text">
            <b>Consommation du site</b>
            <br />
            <span className="sub">besoins instantanés</span>
          </div>
          <span className="pill pill-gold" />
          <div className="legend-text">
            <b>Production PV</b>
            <br />
            <span className="sub">générateur posé</span>
          </div>
          <span className="pill pill-cyan" />
          <div className="legend-text">
            <b>Énergie utilisée directement</b>
            <br />
            <span className="sub">sans passer par le réseau</span>
          </div>
          {hasBatteryChart && (
            <>
              <span className="pill pill-green" />
              <div className="legend-text">
                <b>Énergie stockée</b>
                <br />
                <span className="sub">batterie (charge)</span>
              </div>
            </>
          )}
        </div>

        {(p5?.profile_notes?.production || p5?.profile_notes?.consumption) && (
          <div
            style={{
              marginTop: "2.2mm",
              fontSize: "2.85mm",
              lineHeight: 1.45,
              color: "#64748b",
              flexShrink: 0,
            }}
          >
            {p5.profile_notes?.production ? (
              <div>
                <b>Production</b> : {p5.profile_notes.production}
              </div>
            ) : null}
            {p5.profile_notes?.consumption ? (
              <div style={{ marginTop: "0.8mm" }}>
                <b>Consommation</b> : {p5.profile_notes.consumption}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {p5 && !hasChartData && (
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
          Aucune donnée de puissance disponible pour la journée type.
        </div>
      )}

      {/* 4. Blocs messages (cœur P5) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: hasBatteryChart ? "repeat(4, 1fr)" : "repeat(3, 1fr)",
          gap: "3mm",
          marginTop: "2mm",
          flexShrink: 0,
        }}
      >
        {/* Bloc 1 — Production */}
        <div
          className="card soft"
          style={{
            padding: "3.5mm",
            border: `0.5mm solid ${hexToRgba(brandHex, 0.25)}`,
            borderRadius: "4mm",
          }}
        >
          <div style={{ fontSize: "3.2mm", fontWeight: 600, color: brandHex, marginBottom: "1.5mm" }}>
            Production en journée
          </div>
          <div style={{ fontSize: "3mm", lineHeight: 1.35, color: "#444" }}>
            La production est maximale en journée, avec un pic autour de midi.
          </div>
        </div>

        {/* Bloc 2 — Autoconsommation */}
        <div
          className="card soft"
          style={{
            padding: "3.5mm",
            border: `0.5mm solid ${hexToRgba(brandHex, 0.25)}`,
            borderRadius: "4mm",
          }}
        >
          <div style={{ fontSize: "3.2mm", fontWeight: 600, color: brandHex, marginBottom: "1.5mm" }}>
            Énergie utilisée directement
          </div>
          <div style={{ fontSize: "3mm", lineHeight: 1.35, color: "#444" }}>
            Une grande part de cette énergie est consommée immédiatement sur site.
          </div>
        </div>

        {/* Bloc 3 — Batterie (conditionnel) */}
        {hasBatteryChart && (
          <div
            className="card soft"
            style={{
              padding: "3.5mm",
              border: `0.5mm solid ${hexToRgba(brandHex, 0.25)}`,
              borderRadius: "4mm",
            }}
          >
            <div style={{ fontSize: "3.2mm", fontWeight: 600, color: brandHex, marginBottom: "1.5mm" }}>
              {"Stockage de l'énergie"}
            </div>
            <div style={{ fontSize: "3mm", lineHeight: 1.35, color: "#444" }}>
              Le surplus est stocké en batterie pour être restitué ultérieurement (soirée, creux solaire).
            </div>
          </div>
        )}

        {/* Bloc final — Réseau ou Autonomie */}
        <div
          className="card soft"
          style={{
            padding: "3.5mm",
            border: `0.5mm solid ${hexToRgba(brandHex, 0.25)}`,
            borderRadius: "4mm",
          }}
        >
          <div style={{ fontSize: "3.2mm", fontWeight: 600, color: brandHex, marginBottom: "1.5mm" }}>
            {hasBatteryChart ? "Autonomie renforcée" : "Moins d'électricité achetée"}
          </div>
          <div style={{ fontSize: "3mm", lineHeight: 1.35, color: "#444" }}>
            {hasBatteryChart
              ? "Les prélèvements réseau diminuent encore, y compris hors fenêtre de production."
              : "Les achats sur le réseau sont fortement réduits grâce à la production locale."}
          </div>
        </div>
      </div>
    </PdfPageLayout>
  );
}
