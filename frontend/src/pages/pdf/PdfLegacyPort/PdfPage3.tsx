/**
 * CP-PDF — Page 3 Calepinage toiture (ex-page 3B)
 * Hydratation par engine-p3b.js.
 * Image : fullReport.p3b.p3b_auto.layout_snapshot.
 * Puissance + production : selected_scenario_snapshot.
 * Logo organisation : logo_url si existe, sinon rien.
 */
import { useMemo, useEffect } from "react";
import PdfPageLayout from "../PdfEngine/PdfPageLayout";
import PdfHeader from "../../../components/pdf/PdfHeader";
import { usePdfOrgBranding } from "./pdfOrgBrandingContext";

import { getCrmApiBaseWithWindowFallback } from "@/config/crmApiBase";

const API_BASE = getCrmApiBaseWithWindowFallback();

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
  const energySummary = (fullReport?.p3 as {
    energy_summary?: {
      production_kwh?: number | null;
      consumption_kwh?: number | null;
      solar_used_kwh?: number | null;
      exported_kwh?: number | null;
      grid_import_kwh?: number | null;
      coverage_pct?: number | null;
      pv_self_consumption_pct?: number | null;
    };
  } | undefined)?.energy_summary;

  const energy = (viewModel as { selected_scenario_snapshot?: { energy?: Record<string, unknown> } })
    ?.selected_scenario_snapshot?.energy;
  const productionKwh =
    energySummary?.production_kwh != null && Number.isFinite(Number(energySummary.production_kwh))
      ? Number(energySummary.production_kwh)
      : (energy?.production_annual_kwh ?? energy?.production_kwh) != null &&
    Number.isFinite(Number(energy?.production_annual_kwh ?? energy?.production_kwh))
      ? Number(energy?.production_annual_kwh ?? energy?.production_kwh)
      : null;
  const selfConsumedKwh =
    energySummary?.solar_used_kwh != null && Number.isFinite(Number(energySummary.solar_used_kwh))
      ? Number(energySummary.solar_used_kwh)
      : (energy?.self_consumed_kwh ?? energy?.autoconsumption_kwh) != null &&
    Number.isFinite(Number(energy?.self_consumed_kwh ?? energy?.autoconsumption_kwh))
      ? Number(energy?.self_consumed_kwh ?? energy?.autoconsumption_kwh)
      : null;
  const autoconsommationPct =
    energySummary?.pv_self_consumption_pct != null && Number.isFinite(Number(energySummary.pv_self_consumption_pct))
      ? Number(energySummary.pv_self_consumption_pct)
      : productionKwh != null && productionKwh > 0 && selfConsumedKwh != null
      ? (selfConsumedKwh / productionKwh) * 100
      : null;
  const exportKwh =
    energySummary?.exported_kwh != null && Number.isFinite(Number(energySummary.exported_kwh))
      ? Number(energySummary.exported_kwh)
      : (energy?.export_kwh ?? energy?.exported_kwh ?? energy?.surplus_kwh) != null &&
    Number.isFinite(Number(energy?.export_kwh ?? energy?.exported_kwh ?? energy?.surplus_kwh))
      ? Number(energy?.export_kwh ?? energy?.exported_kwh ?? energy?.surplus_kwh)
      : null;

  /* FIX « Énergie injectée : 0 kWh » (audit Bedouelle 2026-07-03) — en scénario batterie
     (physique / virtuelle / hybride), le moteur met exported_kwh à 0 car le surplus est
     stocké ou converti en crédit : afficher 0 contredit le texte « le surplus est injecté
     et valorisé ». Pour ces scénarios, on affiche le surplus VALORISÉ (restitution physique
     + crédit virtuel utilisé + export résiduel) — même grandeur que la « Restitution
     batterie » de la page production, cohérence inter-pages garantie. */
  const scenarioType = String(
    (viewModel as { selected_scenario_snapshot?: { scenario_type?: string } })
      ?.selected_scenario_snapshot?.scenario_type ?? ""
  );
  const isStorageScenario = scenarioType.startsWith("BATTERY");
  const nOrZero = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : 0);
  const valorizedSurplusKwh = isStorageScenario
    ? nOrZero(energy?.battery_discharge_kwh) +
      nOrZero(energy?.virtual_battery_discharge_kwh) +
      nOrZero(exportKwh)
    : null;

  /* LOT D bis — système de pose toit plat + architecture électrique (payload p3b_auto). */
  const p3bAuto = (fullReport?.p3b as {
    p3b_auto?: {
      systemes_pose?: string[];
      systeme_pose_note?: string;
      elec_architecture?: {
        onduleur_label?: string;
        nb_micro?: number | null;
        panels_per_micro?: number | null;
        reseau?: string | null;
        par_phase?: number | null;
      } | null;
    };
  } | undefined)?.p3b_auto;
  const posesLines = Array.isArray(p3bAuto?.systemes_pose) ? p3bAuto!.systemes_pose! : [];
  const poseNote = p3bAuto?.systeme_pose_note ?? "";
  const elecArch = p3bAuto?.elec_architecture ?? null;

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
          ? `${(() => {
              const n = Number(kwc);
              /* fr-FR : virgule, pas de décimales inutiles (8 → "8", 3.88 → "3,88") */
              return n % 1 === 0 ? String(Math.round(n)) : n.toFixed(2).replace(/0$/, "").replace(".", ",");
            })()} kWc`
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
                <span style={{ whiteSpace: "nowrap" }}><span id="p3b_surface" style={{ fontSize: "3.6mm", fontWeight: 600, color: "#333" }}>—</span>&nbsp;m²</span>
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
            {(posesLines.length > 0 || elecArch) && (
              <div
                style={{
                  marginTop: "2mm",
                  paddingTop: "2.2mm",
                  borderTop: "0.15mm solid rgba(195,152,71,0.25)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "1.4mm",
                  fontSize: "3mm",
                  lineHeight: 1.4,
                  color: "#374151",
                }}
              >
                {posesLines.length > 0 && (
                  <div>
                    <span style={{ fontWeight: 700, color: "#333" }}>Système de pose : </span>
                    {posesLines.join(" · ")}
                    {poseNote ? (
                      <span style={{ color: "#64748b" }}> — {poseNote}</span>
                    ) : null}
                  </div>
                )}
                {elecArch && (
                  <div>
                    <span style={{ fontWeight: 700, color: "#333" }}>Architecture électrique : </span>
                    {elecArch.nb_micro != null
                      ? `${elecArch.nb_micro} micro-onduleurs ${elecArch.onduleur_label ?? ""}`.trim()
                      : `micro-onduleurs ${elecArch.onduleur_label ?? ""}`.trim()}
                    {elecArch.panels_per_micro != null
                      ? ` (1 pour ${elecArch.panels_per_micro} panneaux)`
                      : ""}
                    {elecArch.reseau ? ` — raccordement ${elecArch.reseau.toLowerCase()}` : ""}
                    {elecArch.par_phase != null ? `, ${elecArch.par_phase} par phase` : ""}
                    <span style={{ color: "#64748b" }}>
                      {" — répartition des branches AC, protections et sections de câble validées en préparation technique, conformément aux limites fabricant."}
                    </span>
                  </div>
                )}
              </div>
            )}
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
              Le schéma pré-valide l&apos;implantation proposée, sous réserve de validation technique finale
              sur site.
            </p>
            <h4 style={{ margin: "3mm 0 1mm 0", fontSize: "3.6mm", color: brandHex }}>Points techniques vérifiés :</h4>
            <ul style={{ margin: "0 0 3mm 3mm", padding: 0, fontSize: "3.3mm", color: "#4b5563", lineHeight: 1.4 }}>
              <li>Inclinaison réelle : impact direct sur la production.</li>
              <li>Orientation : optimise la captation solaire.</li>
              <li>Surface utile : zone réellement exploitable.</li>
              <li>Nombre de panneaux : correspond à la puissance choisie.</li>
            </ul>
            <p style={{ marginTop: "3mm", fontSize: "3.2mm", color: "#64748b", lineHeight: 1.45 }}>
              Cette pré-validation confirme que le scénario du dossier est ancré sur le site :
              <strong>il correspond à une implantation réalisable à ce stade, sous réserve des contrôles terrain et administratifs.</strong>
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
                <span style={{ fontSize: "2.8mm", color: "#7a7a7a" }}>Autoconsommation PV</span>
                <span style={{ fontSize: "4mm", fontWeight: 700, color: "#333" }}>
                  {autoconsommationPct != null ? `${Math.round(autoconsommationPct)} %` : "—"}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5mm" }}>
                <span style={{ fontSize: "2.8mm", color: "#7a7a7a" }}>
                  {isStorageScenario ? "Surplus valorisé (batterie / crédit)" : "Énergie injectée"}
                </span>
                <span style={{ fontSize: "4mm", fontWeight: 700, color: "#333" }}>
                  {isStorageScenario
                    ? valorizedSurplusKwh != null && valorizedSurplusKwh > 0
                      ? `${Math.round(valorizedSurplusKwh).toLocaleString("fr-FR")} kWh`
                      : "—"
                    : exportKwh != null
                      ? `${Math.round(exportKwh).toLocaleString("fr-FR")} kWh`
                      : "—"}
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
