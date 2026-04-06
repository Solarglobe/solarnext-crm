/**
 * CP-PDF — Page 6 Autonomie et dépendance au réseau
 * Page commerciale orientée : combien le client dépend encore du réseau.
 * Graphique dessiné par engine-p6.js. Structure alignée P4/P5.
 */
import React, { useMemo } from "react";
import PdfPageLayout from "../PdfEngine/PdfPageLayout";
import PdfHeader from "../../../components/pdf/PdfHeader";

const API_BASE = import.meta.env?.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
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

export default function PdfPage6({
  organization = {},
  viewModel,
}: {
  organization?: { id?: string; logo_image_key?: string | null; logo_url?: string | null };
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

  return (
    <PdfPageLayout
      legacyPort={{
        id: "p6",
        dataEngine: "autonomie",
        sectionGap: "2.5mm",
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
            badge="Autonomie et dépendance au réseau"
            metaColumn={
              <div
                className="meta-compact"
                id="p6_meta_line"
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
                  <b>Client</b> : <span id="p6_client">—</span>
                </div>
                <div>
                  <b>Réf.</b> : <span id="p6_ref">—</span>
                </div>
                <div>
                  <b>Date</b> : <span id="p6_date">—</span>
                </div>
              </div>
            }
          />
        ),
      }}
    >
      {/* 1. Intro */}
      <p
        style={{
          margin: "0 0 1mm 0",
          fontSize: "3.5mm",
          lineHeight: 1.35,
          color: "#444",
          flexShrink: 0,
        }}
      >
        Sur une année type, le générateur réduit nettement la part d&apos;énergie prélevée sur le réseau.
      </p>

      {/* 2. Texte explicatif court */}
      <p
        style={{
          margin: "0 0 2mm 0",
          fontSize: "3.3mm",
          lineHeight: 1.35,
          color: "#555",
          flexShrink: 0,
        }}
      >
        Une part de la consommation du site est produite localement. Le complément reste assuré par le réseau, notamment lors des périodes moins favorables.
      </p>

      {/* CTA masqué — conservé pour compatibilité engine (engine fait display:none dessus) */}
      <div id="p6_cta" style={{ display: "none" }} aria-hidden="true" />

      {/* 3. Zone graphique (engine-p6.js dessine dans #p6-chart) */}
      <div
        id="p6_chart_zone"
        className="card soft chart-card premium"
        style={{
          display: "none",
          padding: "4mm 3mm 4mm 3mm",
          border: "0.5mm solid rgba(195,152,71,.25)",
          boxShadow: "0 8px 24px rgba(0,0,0,.06)",
          borderRadius: "6mm",
        }}
      >
        <div style={{ marginBottom: "2mm", flexShrink: 0 }}>
          <h3 style={{ margin: 0, color: "#C39847", fontWeight: 800, fontSize: "4.5mm" }}>
            Autonomie énergétique et prélèvements réseau sur l&apos;année
          </h3>
        </div>

        <div className="p6-legend" style={{ display: "flex", gap: "8mm", alignItems: "center", fontSize: "3mm", marginBottom: "1mm" }}>
          <span className="leg" style={{ display: "flex", gap: "2mm", alignItems: "center" }}>
            <i style={{ display: "inline-block", width: "7mm", height: "3mm", borderRadius: "999mm", background: "#86D8F1" }} />
            PV utilisée
          </span>
          <span className="leg" style={{ display: "flex", gap: "2mm", alignItems: "center" }}>
            <i style={{ display: "inline-block", width: "7mm", height: "3mm", borderRadius: "999mm", background: "#B3F4C4" }} />
            Décharge batterie
          </span>
          <span className="leg" style={{ display: "flex", gap: "2mm", alignItems: "center" }}>
            <i style={{ display: "inline-block", width: "7mm", height: "3mm", borderRadius: "999mm", background: "#CFCBFF" }} />
            Import réseau
          </span>
          <span className="leg" style={{ display: "flex", gap: "2mm", alignItems: "center" }}>
            <b style={{ display: "inline-block", width: "12mm", height: "1.6mm", background: "#e6ebf2", borderRadius: "2mm" }} />
            Moyenne conso
          </span>
        </div>

        <div className="p6-chart-wrap" style={{ height: "66mm", position: "relative" }}>
          <svg id="p6-chart" viewBox="0 0 1750 520" style={{ width: "100%", height: "100%", display: "block" }} />
        </div>
      </div>

      {/* 4. KPI (remplis par engine-p6.js) */}
      <div id="p6_kpis" style={{ display: "none", gridTemplateColumns: "repeat(3,1fr)", gap: "3mm" }}>
        <div className="card soft" style={{ borderColor: "#E3CFA9", padding: "4mm", border: "0.4mm solid #E3CFA9", borderRadius: "4mm" }}>
          <div style={{ display: "flex", gap: "3mm", alignItems: "center" }}>
            <div style={{ width: "9mm", height: "9mm", borderRadius: "999mm", background: "#86D8F1" }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: "3.4mm" }}>Autonomie annuelle</div>
              <div style={{ fontSize: "3mm", color: "#6b7280" }}>Part couverte sans réseau</div>
            </div>
          </div>
          <div style={{ fontSize: "6mm", fontWeight: 800, marginTop: "2mm" }} id="p6_autonomie">—</div>
          <div style={{ fontSize: "3mm", color: "#6b7280" }} id="p6_autonomie_txt">—</div>
        </div>

        <div className="card soft" style={{ borderColor: "#E3CFA9", padding: "4mm", border: "0.4mm solid #E3CFA9", borderRadius: "4mm" }}>
          <div style={{ display: "flex", gap: "3mm", alignItems: "center" }}>
            <div style={{ width: "9mm", height: "9mm", borderRadius: "999mm", background: "#CFCBFF" }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: "3.4mm" }}>Import réseau</div>
              <div style={{ fontSize: "3mm", color: "#6b7280" }}>kWh & coût estimé</div>
            </div>
          </div>
          <div style={{ fontSize: "5.6mm", fontWeight: 800, marginTop: "2mm" }} id="p6_grid_kwh">—</div>
          <div style={{ fontSize: "3mm", color: "#6b7280" }} id="p6_grid_eur">—</div>
        </div>

        <div className="card soft" style={{ borderColor: "#E3CFA9", padding: "4mm", border: "0.4mm solid #E3CFA9", borderRadius: "4mm" }}>
          <div style={{ display: "flex", gap: "3mm", alignItems: "center" }}>
            <div style={{ width: "9mm", height: "9mm", borderRadius: "999mm", background: "#B3F4C4" }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: "3.4mm" }}>Autoconsommation</div>
              <div style={{ fontSize: "3mm", color: "#6b7280" }}>PV consommée sur place</div>
            </div>
          </div>
          <div style={{ fontSize: "5.6mm", fontWeight: 800, marginTop: "2mm" }} id="p6_auto_pct">—</div>
          <div style={{ fontSize: "3mm", color: "#6b7280" }} id="p6_auto_txt">—</div>
        </div>
      </div>

      {/* 5. Blocs messages */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "2.5mm",
          marginTop: "0",
          flexShrink: 0,
        }}
      >
        {/* Bloc 1 — Production locale */}
        <div
          className="card soft"
          style={{
            padding: "3mm",
            border: "0.5mm solid rgba(195,152,71,.25)",
            borderRadius: "4mm",
          }}
        >
          <div style={{ fontSize: "3.1mm", fontWeight: 600, color: "#C39847", marginBottom: "1.2mm" }}>
            Une production locale significative
          </div>
          <div style={{ fontSize: "2.9mm", lineHeight: 1.35, color: "#444" }}>
            L&apos;installation couvre déjà une part importante des besoins du site.
          </div>
        </div>

        {/* Bloc 2 — Réseau maîtrisé */}
        <div
          className="card soft"
          style={{
            padding: "3mm",
            border: "0.5mm solid rgba(195,152,71,.25)",
            borderRadius: "4mm",
          }}
        >
          <div style={{ fontSize: "3.1mm", fontWeight: 600, color: "#C39847", marginBottom: "1.2mm" }}>
            Une dépendance au réseau maîtrisée
          </div>
          <div style={{ fontSize: "2.9mm", lineHeight: 1.35, color: "#444" }}>
            Le réseau reste nécessaire, principalement en hiver et en dehors des périodes de production.
          </div>
        </div>

        {/* Bloc 3 — Marges d'optimisation */}
        <div
          className="card soft"
          style={{
            padding: "3mm",
            border: "0.5mm solid rgba(195,152,71,.25)",
            borderRadius: "4mm",
          }}
        >
          <div style={{ fontSize: "3.1mm", fontWeight: 600, color: "#C39847", marginBottom: "1.2mm" }}>
            Des marges d&apos;optimisation possibles
          </div>
          <div style={{ fontSize: "2.9mm", lineHeight: 1.35, color: "#444" }}>
            Des solutions complémentaires (stockage, pilotage) permettent d&apos;accroître encore l&apos;autonomie du site.
          </div>
        </div>
      </div>
    </PdfPageLayout>
  );
}
