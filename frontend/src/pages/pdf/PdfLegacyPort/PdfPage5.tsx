/**
 * CP-PDF — Page 5 Journée type simplifiée (projection client)
 * Graphique dessiné par engine-p5.js. Structure et textes alignés P4.
 */
import React, { useEffect, useMemo, useState } from "react";
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

export default function PdfPage5({
  organization = {},
  viewModel,
}: {
  organization?: { id?: string; logo_image_key?: string | null; logo_url?: string | null };
  viewModel?: { fullReport?: Record<string, unknown>; meta?: { studyId?: string; versionId?: string }; [key: string]: unknown };
}) {
  const [hasBattery, setHasBattery] = useState(false);

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

  // Détection batterie via légende (engine-p5 affiche #p5_leg_batt si batterie > 0)
  useEffect(() => {
    const check = () => {
      const el = document.getElementById("p5_leg_batt");
      if (el) {
        const display = el.style.display ?? window.getComputedStyle(el).display;
        if (display !== "none") setHasBattery(true);
      }
    };
    const t1 = setTimeout(check, 200);
    const t2 = setTimeout(check, 600);
    const observer = new MutationObserver(check);
    const zone = document.getElementById("p5_chart_zone");
    if (zone) observer.observe(zone, { attributes: true, subtree: true, attributeFilter: ["style"] });
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      observer.disconnect();
    };
  }, []);

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
                  <b>Client</b> : <span id="p5_client">—</span>
                </div>
                <div>
                  <b>Réf.</b> : <span id="p5_ref">—</span>
                </div>
                <div>
                  <b>Date</b> : <span id="p5_date">—</span>
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

      {/* 3. Zone graphique (engine-p5.js dessine dans #p5-chart) */}
      <div
        id="p5_chart_zone"
        className="card soft chart-card premium"
        style={{
          padding: "5mm 3mm 5mm 3mm",
          border: "0.5mm solid rgba(195,152,71,.25)",
          borderRadius: "6mm",
          display: "none",
        }}
      >
        <div style={{ marginBottom: "2mm", flexShrink: 0 }}>
          <h3 style={{ margin: 0, color: "#C39847", fontSize: "4.5mm" }}>
            Production et consommation sur une journée type
          </h3>
          <p
            style={{
              margin: "1mm 0 0 0",
              fontSize: "3.1mm",
              lineHeight: 1.35,
              color: "#6b6b6b",
              fontWeight: 400,
            }}
          >
            Focus sur la période active de production et d&apos;usage solaire (5h–22h).
          </p>
          {/* Span caché pour engine-p5 (évite crash si #p5_month absent) */}
          <span id="p5_month" style={{ position: "absolute", left: "-9999px", visibility: "hidden" }} aria-hidden="true" />
        </div>

        <div style={{ height: "75mm", position: "relative" }}>
          <svg id="p5-chart" viewBox="0 0 2000 560" style={{ width: "100%", height: "100%", display: "block" }} />
        </div>

        <div className="legend legend-row" style={{ marginTop: "3mm" }}>
          <span className="pill pill-gold" />
          <div className="legend-text"><b>Production solaire</b><br /><span className="sub">Puissance PV (kW)</span></div>
          <span className="pill pill-gray" />
          <div className="legend-text"><b>Consommation</b><br /><span className="sub">Besoins instantanés</span></div>
          <span className="pill pill-cyan" />
          <div className="legend-text"><b>Autoconsommation</b><br /><span className="sub">Utilisation directe</span></div>
          <span className="pill pill-green" id="p5_leg_batt" style={{ display: "none" }} />
          <div className="legend-text" id="p5_leg_batt_text" style={{ display: "none" }}>
            <b>Batterie</b><br /><span className="sub">charge / décharge</span>
          </div>
        </div>
      </div>

      {/* 4. Blocs messages (cœur P5) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: hasBattery ? "repeat(4, 1fr)" : "repeat(3, 1fr)",
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
            border: "0.5mm solid rgba(195,152,71,.25)",
            borderRadius: "4mm",
          }}
        >
          <div style={{ fontSize: "3.2mm", fontWeight: 600, color: "#C39847", marginBottom: "1.5mm" }}>
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
            border: "0.5mm solid rgba(195,152,71,.25)",
            borderRadius: "4mm",
          }}
        >
          <div style={{ fontSize: "3.2mm", fontWeight: 600, color: "#C39847", marginBottom: "1.5mm" }}>
            Énergie utilisée directement
          </div>
          <div style={{ fontSize: "3mm", lineHeight: 1.35, color: "#444" }}>
            Une grande part de cette énergie est consommée immédiatement sur site.
          </div>
        </div>

        {/* Bloc 3 — Batterie (conditionnel) */}
        {hasBattery && (
          <div
            className="card soft"
            style={{
              padding: "3.5mm",
              border: "0.5mm solid rgba(195,152,71,.25)",
              borderRadius: "4mm",
            }}
          >
            <div style={{ fontSize: "3.2mm", fontWeight: 600, color: "#C39847", marginBottom: "1.5mm" }}>
              Stockage de l&apos;énergie
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
            border: "0.5mm solid rgba(195,152,71,.25)",
            borderRadius: "4mm",
          }}
        >
          <div style={{ fontSize: "3.2mm", fontWeight: 600, color: "#C39847", marginBottom: "1.5mm" }}>
            {hasBattery ? "Autonomie renforcée" : "Moins d&apos;électricité achetée"}
          </div>
          <div style={{ fontSize: "3mm", lineHeight: 1.35, color: "#444" }}>
            {hasBattery
              ? "Les prélèvements réseau diminuent encore, y compris hors fenêtre de production."
              : "Les achats sur le réseau sont fortement réduits grâce à la production locale."}
          </div>
        </div>
      </div>
    </PdfPageLayout>
  );
}
