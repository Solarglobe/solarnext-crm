/**
 * CP-PDF — Page 3 Calepinage toiture (ex-page 3B)
 * Hydratation par engine-p3b.js.
 * Image : fullReport.p3b.p3b_auto.layout_snapshot.
 * Puissance + production : selected_scenario_snapshot.
 * Logo organisation : logo_url si existe, sinon rien.
 */
import React, { useMemo, useEffect } from "react";
import PdfPageLayout from "../PdfEngine/PdfPageLayout";
import PdfHeader from "../../../components/pdf/PdfHeader";
import { usePdfOrgBranding } from "./pdfOrgBrandingContext";

const API_BASE = import.meta.env?.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

function getStorageUrl(
  orgId: string,
  type: "logo" | "pdf-cover",
  renderToken: string,
  studyId: string,
  versionId: string
): string {
  return `${API_BASE}/api/internal/pdf-asset/${orgId}/${type}?renderToken=${encodeURIComponent(renderToken)}&studyId=${encodeURIComponent(studyId)}&versionId=${encodeURIComponent(versionId)}`;
}

export default function PdfPage3({
  organization = {},
  viewModel,
}: {
  organization?: { id?: string; logo_image_key?: string | null; logo_url?: string | null };
  viewModel?: { meta?: { studyId?: string; versionId?: string } };
}) {
  const logoUrl = useMemo(() => {
    const logoDirect = organization?.logo_url;
    if (logoDirect) return logoDirect;

    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const renderToken = params?.get("renderToken") ?? "";
    const studyId = params?.get("studyId") ?? (viewModel?.meta as { studyId?: string } | undefined)?.studyId ?? "";
    const versionId = params?.get("versionId") ?? (viewModel?.meta as { versionId?: string } | undefined)?.versionId ?? "";
    const orgId = organization?.id;
    const hasLogoKey = !!organization?.logo_image_key;

    if (!orgId || !renderToken || !studyId || !versionId || !hasLogoKey) return null;
    return getStorageUrl(orgId, "logo", renderToken, studyId, versionId);
  }, [organization?.id, organization?.logo_image_key, organization?.logo_url, viewModel?.meta]);

  const fullReport = (viewModel as { fullReport?: Record<string, unknown> })?.fullReport;
  const calpinageImage = (fullReport?.p3b as { p3b_auto?: { layout_snapshot?: string } } | undefined)?.p3b_auto?.layout_snapshot ?? null;

  const energy = (viewModel as { selected_scenario_snapshot?: { energy?: Record<string, unknown> } })
    ?.selected_scenario_snapshot?.energy;
  const productionKwh =
    (energy?.production_annual_kwh ?? energy?.production_kwh) != null &&
    Number.isFinite(Number(energy?.production_annual_kwh ?? energy?.production_kwh))
      ? Number(energy?.production_annual_kwh ?? energy?.production_kwh)
      : null;
  const selfConsumedKwh =
    (energy?.self_consumed_kwh ?? energy?.autoconsumption_kwh) != null &&
    Number.isFinite(Number(energy?.self_consumed_kwh ?? energy?.autoconsumption_kwh))
      ? Number(energy?.self_consumed_kwh ?? energy?.autoconsumption_kwh)
      : null;
  const autoconsommationPct =
    productionKwh != null && productionKwh > 0 && selfConsumedKwh != null
      ? (selfConsumedKwh / productionKwh) * 100
      : null;
  const exportKwh =
    (energy?.export_kwh ?? energy?.surplus_kwh) != null &&
    Number.isFinite(Number(energy?.export_kwh ?? energy?.surplus_kwh))
      ? Number(energy?.export_kwh ?? energy?.surplus_kwh)
      : null;

  // Puissance : hydratation DOM (engine ne fournit pas power_kwc)
  useEffect(() => {
    if (typeof document === "undefined" || !viewModel) return;
    const snap = (viewModel as { selected_scenario_snapshot?: Record<string, unknown> })
      ?.selected_scenario_snapshot;
    const kwc =
      (snap?.system as { power_kwc?: number })?.power_kwc ??
      (snap?.hardware as { kwc?: number })?.kwc ??
      (snap?.installation as { puissance_kwc?: number })?.puissance_kwc ??
      (snap?.technical as { power_kwc?: number })?.power_kwc;
    const powerEl = document.getElementById("p3b_puissance");
    if (powerEl) {
      powerEl.textContent =
        kwc != null && Number.isFinite(Number(kwc))
          ? `${Number(kwc).toFixed(2)} kWc`
          : "—";
    }
  }, [viewModel]);

  const { brandHex } = usePdfOrgBranding();

  return (
    <PdfPageLayout
      legacyPort={{
        id: "p3",
        dataEngine: "calepinage",
        sectionGap: "3.5mm",
        header: (
          <PdfHeader
            headerStyle={{
              ["--logoW" as string]: logoUrl ? "22mm" : "0",
              ["--metaW" as string]: "110mm",
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
            badge="Calepinage photovoltaïque"
            metaColumn={
              <div
                className="meta-compact"
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
                  <b>Client</b> : <span id="p3b_client">—</span>
                </div>
                <div>
                  <b>Réf.</b> : <span id="p3b_ref">—</span>
                </div>
                <div>
                  <b>Date</b> : <span id="p3b_date">—</span>
                </div>
              </div>
            }
          />
        ),
      }}
    >
      <div className="grid" style={{ gap: "3.5mm", alignItems: "stretch", flex: 1, minHeight: 0 }}>
        <div className="col-6" style={{ display: "flex", flexDirection: "column", gap: "3.5mm", minHeight: 0 }}>
          <div
            className="card soft"
            style={{ padding: "4mm 5mm", display: "flex", flexDirection: "column", gap: "3mm" }}
          >
            <h3 style={{ margin: "0 0 2mm 0", color: brandHex, fontWeight: 700 }}>Plan de pose (vue calepinage)</h3>
            <div
              id="p3b_photo"
              style={{
                height: "320px",
                borderRadius: "8px",
                border: "0.45mm dashed #d1d5db",
                background: calpinageImage ? "#fff" : "#f3f4f6",
                display: "flex",
                alignItems: "center",
                overflow: "hidden",
                position: "relative",
              }}
            >
              {calpinageImage ? (
                <img
                  src={calpinageImage}
                  alt="Plan de pose photovoltaïque — calepinage"
                  style={{
                    width: "100%",
                    height: "320px",
                    objectFit: "cover",
                    borderRadius: "8px",
                  }}
                />
              ) : (
                <div className="pdf-placeholder">
                  Capture du plan en attente de validation du calepinage
                </div>
              )}
            </div>
            <h4 style={{ margin: "3mm 0 2mm 0", fontSize: "3.6mm", color: brandHex, fontWeight: 700 }}>
              Caractéristiques de l&apos;installation
            </h4>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, 1fr)",
                gap: "3mm 4mm",
                padding: 0,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5mm" }}>
                <span style={{ fontSize: "2.6mm", color: "#7a7a7a" }}>Inclinaison (support)</span>
                <span id="p3b_inclinaison" style={{ fontSize: "3.6mm", fontWeight: 600, color: "#333" }}>—</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5mm" }}>
                <span style={{ fontSize: "2.6mm", color: "#7a7a7a" }}>Orientation (support)</span>
                <span id="p3b_orientation" style={{ fontSize: "3.6mm", fontWeight: 600, color: "#333" }}>—</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5mm" }}>
                <span style={{ fontSize: "2.6mm", color: "#7a7a7a" }}>Surface utilisée</span>
                <span id="p3b_surface" style={{ fontSize: "3.6mm", fontWeight: 600, color: "#333" }}>—</span> m²
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5mm" }}>
                <span style={{ fontSize: "2.6mm", color: "#7a7a7a" }}>Nombre de panneaux</span>
                <span id="p3b_panneaux" style={{ fontSize: "3.6mm", fontWeight: 600, color: "#333" }}>—</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5mm" }}>
                <span style={{ fontSize: "2.6mm", color: "#7a7a7a" }}>Puissance installation</span>
                <span id="p3b_puissance" style={{ fontSize: "3.6mm", fontWeight: 600, color: "#333" }}>—</span>
              </div>
            </div>
            <p style={{ margin: "2.5mm 0 0 0", fontSize: "3mm", color: "#64748b", lineHeight: 1.4 }}>
              Ces éléments définissent le dimensionnement et la performance du générateur retenu.
            </p>
          </div>
        </div>
        <div className="col-6" style={{ display: "flex", flexDirection: "column", gap: "3.5mm", minHeight: 0 }}>
          <div className="card soft" style={{ padding: "4mm 5mm" }}>
            <h3 style={{ margin: "0 0 2mm 0", color: brandHex, fontWeight: 700 }}>Validation technique de l&apos;implantation</h3>
            <p style={{ margin: 0, fontSize: "3.4mm", lineHeight: 1.45, color: "#374151" }}>
              Le calepinage valide la faisabilité technique de l&apos;implantation sur le bâtiment support.
              Chaque module est positionné selon la pente, l&apos;orientation, les règles de sécurité et
              la surface réellement exploitable.
              Le schéma garantit une pose conforme, optimisée et alignée sur la géométrie réelle du site.
            </p>
            <h4 style={{ margin: "3mm 0 1mm 0", fontSize: "3.6mm", color: brandHex }}>Points techniques vérifiés :</h4>
            <ul style={{ margin: "0 0 3mm 3mm", padding: 0, fontSize: "3.3mm", color: "#4b5563", lineHeight: 1.4 }}>
              <li>Inclinaison réelle : impact direct sur la production.</li>
              <li>Orientation : optimise la captation solaire.</li>
              <li>Surface utile : zone réellement exploitable.</li>
              <li>Nombre de panneaux : correspond à la puissance choisie.</li>
            </ul>
            <p style={{ marginTop: "3mm", fontSize: "3.2mm", color: "#64748b", lineHeight: 1.45 }}>
              Cette validation confirme que le scénario du dossier est ancré sur le site :
              <strong>il correspond à ce qui est réalisable sur le support étudié.</strong>
            </p>
          </div>
          <div className="card soft" style={{ padding: "4mm 5mm" }}>
            <h3 style={{ margin: "0 0 2mm 0", color: brandHex, fontWeight: 700 }}>Impact du générateur sur la consommation du site</h3>
            <p style={{ margin: "0 0 3mm 0", fontSize: "3.4mm", lineHeight: 1.45, color: "#374151" }}>
              Le dimensionnement vise une part significative de la consommation annuelle du site.
              L&apos;orientation et l&apos;implantation optimisent la production sur le bâtiment support.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "2.5mm", marginBottom: "3mm" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5mm" }}>
                <span style={{ fontSize: "2.8mm", color: "#7a7a7a" }}>Production annuelle</span>
                <span style={{ fontSize: "4mm", fontWeight: 700, color: "#333" }}>
                  {productionKwh != null ? `${Math.round(productionKwh).toLocaleString("fr-FR")} kWh` : "—"}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5mm" }}>
                <span style={{ fontSize: "2.8mm", color: "#7a7a7a" }}>Autoconsommation</span>
                <span style={{ fontSize: "4mm", fontWeight: 700, color: "#333" }}>
                  {autoconsommationPct != null ? `${Math.round(autoconsommationPct)} %` : "—"}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5mm" }}>
                <span style={{ fontSize: "2.8mm", color: "#7a7a7a" }}>Énergie injectée</span>
                <span style={{ fontSize: "4mm", fontWeight: 700, color: "#333" }}>
                  {exportKwh != null ? `${Math.round(exportKwh).toLocaleString("fr-FR")} kWh` : "—"}
                </span>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: "3.2mm", lineHeight: 1.45, color: "#4b5563", fontWeight: 500, borderTop: "0.15mm solid rgba(195,152,71,0.2)", paddingTop: "2.5mm" }}>
              Cette production alimente directement les indicateurs économiques de l&apos;étude financière.
            </p>
          </div>
        </div>
      </div>
    </PdfPageLayout>
  );
}
