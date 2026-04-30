/**
 * CP-PDF — Page 10 Synthèse finale (closing commercial)
 * Rendu 100 % React — données : fullReport.p10 (mapper backend).
 * Aligné header P9 / P2 ; zone stricte 277×190 mm (classe .p10-fixed).
 */
import React, { useLayoutEffect, useMemo } from "react";
import PdfPageLayout from "../PdfEngine/PdfPageLayout";
import PdfHeader from "../../../components/pdf/PdfHeader";
import { hexToRgba, pdfBrandGoldLight } from "../pdfBrand";
import { usePdfOrgBranding } from "./pdfOrgBrandingContext";
import { getCrmApiBaseWithWindowFallback } from "@/config/crmApiBase";

const API_BASE = getCrmApiBaseWithWindowFallback();
const PLACEHOLDER_LOGO = "/client-portal/logo-solarglobe.png";

/** Plafonds barres rentabilité (alignés engine-p10 legacy) */
const MAX = { ROI: 20, TRI: 20, LCOE: 0.25 };

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function getStorageUrl(
  orgId: string,
  type: "logo" | "pdf-cover",
  renderToken: string,
  studyId: string,
  versionId: string
): string {
  return `${API_BASE}/api/internal/pdf-asset/${orgId}/${type}?renderToken=${encodeURIComponent(renderToken)}&studyId=${encodeURIComponent(studyId)}&versionId=${encodeURIComponent(versionId)}`;
}

function fmtEUR(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${Math.round(Number(n)).toLocaleString("fr-FR")} €`;
}

function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${Math.round(Number(n)).toLocaleString("fr-FR")}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${Math.round(Number(n))} %`;
}

function fmtKwc(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  return v % 1 === 0 ? `${v}` : v.toFixed(2).replace(".", ",");
}

function fmtLcoe(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${Number(n).toFixed(3).replace(".", ",")} €/kWh`;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function PdfPage10({
  organization = {},
  viewModel,
  onReady,
}: {
  organization?: { id?: string; logo_image_key?: string | null; logo_url?: string | null };
  viewModel?: { meta?: { studyId?: string; versionId?: string }; fullReport?: Record<string, unknown> };
  onReady?: () => void;
}) {
  const fr = (viewModel?.fullReport?.p10 ?? {}) as {
    meta?: { client?: string; ref?: string; date?: string };
    best?: Record<string, unknown>;
    residual_bill_virtual?: Record<string, unknown> | null;
  };
  const rv = fr.residual_bill_virtual;
  const meta = fr.meta ?? {};
  const best = fr.best ?? {};

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

  const kwc = best.kwc as number | undefined;
  const savingsY1 = best.savings_year1_eur as number | undefined;
  const roi = best.roi_years as number | undefined;
  const indep = best.autonomy_pct as number | undefined;
  const tri = best.tri_pct as number | undefined;
  const lcoe = best.lcoe_eur_kwh as number | undefined;
  const gains25 = best.gains_25_eur as number | undefined;
  const nbPanels = best.nb_panels as number | undefined;
  const prodKwh = best.annual_production_kwh as number | undefined;
  const safeAutoPct = (best.autoprod_pct as number | undefined) ?? 0;
  const safeAutoAu = (best.autonomy_pct as number | undefined) ?? 0;

  const roiBarPct = clamp01((MAX.ROI - (roi ?? MAX.ROI)) / MAX.ROI) * 100;
  const triBarPct = clamp01((tri ?? 0) / MAX.TRI) * 100;
  const lcoeBarPct = clamp01((lcoe ?? 0) / MAX.LCOE) * 100;

  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => onReady?.());
    });
    return () => cancelAnimationFrame(id);
  }, [onReady, viewModel]);

  const { brandHex: gold } = usePdfOrgBranding();
  const ink = "#0a0a0a";
  const titleInk = "#111827";
  const subInk = "#374151";
  const softSub = "#4b5563";

  const kpiValueSize = "11mm";

  const kpiCards = [
    {
      label: "Puissance installée",
      line: `${fmtKwc(kwc)} kWc`,
      sub: "Installation photovoltaïque",
      accent: gold,
      bg: `linear-gradient(155deg, ${hexToRgba(gold, 0.22)} 0%, rgba(255,255,255,0.98) 55%, #fff 100%)`,
      border: `0.4mm solid ${hexToRgba(gold, 0.55)}`,
    },
    {
      label: "Économie annuelle",
      line: fmtEUR(savingsY1),
      sub: "Année 1 (hors indexation)",
      accent: "#15803d",
      bg: "linear-gradient(155deg, rgba(21,128,61,0.18) 0%, rgba(255,255,255,0.98) 55%, #fff 100%)",
      border: "0.4mm solid rgba(21,128,61,0.4)",
    },
    {
      label: "Retour sur investissement",
      line: roi != null && Number.isFinite(roi) ? `${Math.round(roi)} ans` : "—",
      sub: "Amortissement estimé",
      accent: "#0a0a0a",
      bg: "linear-gradient(155deg, rgba(15,23,42,0.08) 0%, #f8fafc 50%, #fff 100%)",
      border: "0.4mm solid rgba(17,24,39,0.35)",
    },
    {
      label: "Couverture solaire",
      line: fmtPct(indep),
      sub: "Couverture solaire annuelle",
      accent: "#0047AB",
      bg: "linear-gradient(155deg, rgba(0,71,171,0.14) 0%, rgba(255,255,255,0.98) 55%, #fff 100%)",
      border: "0.4mm solid rgba(0,71,171,0.38)",
    },
  ];

  return (
    <PdfPageLayout
      legacyPort={{
        id: "p10",
        sectionGap: "1.25mm",
        dataReactPdf: true,
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
                    e.currentTarget.src = PLACEHOLDER_LOGO;
                  }}
                />
              ) : null
            }
            badge={"Synthèse du scénario retenu"}
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
                  <b>Client</b> : {meta.client || "—"}
                </div>
                <div>
                  <b>Réf.</b> : {meta.ref || "—"}
                </div>
                <div>
                  <b>Date</b> : {meta.date || "—"}
                </div>
              </div>
            }
          />
        ),
      }}
    >
      <div
        className="p10-main"
        style={{
          flex: "0 0 auto",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: "1.5mm",
          width: "100%",
          alignSelf: "stretch",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            alignSelf: "stretch",
            textAlign: "left",
            padding: "2.05mm 3.1mm 1.75mm",
            flexShrink: 0,
            background: `linear-gradient(180deg, ${hexToRgba(gold, 0.18)} 0%, rgba(255,255,255,0.96) 48%, #fff 100%)`,
            borderRadius: "3.5mm",
            border: `0.38mm solid ${hexToRgba(gold, 0.38)}`,
            boxShadow: "0 1.4mm 5mm rgba(15,23,42,0.09)",
          }}
        >
          <div
            style={{
              fontSize: "5.65mm",
              fontWeight: 900,
              color: titleInk,
              lineHeight: 1.12,
              letterSpacing: "-0.03em",
              paddingRight: "38mm",
            }}
          >
            Production d&apos;électricité locale dès la mise en service
          </div>
          <div style={{ fontSize: "3.1mm", color: subInk, marginTop: "0.95mm", fontWeight: 600, paddingRight: "38mm" }}>
            Dimensionnement durable, cohérent économiquement, prêt à déployer
          </div>
          <div
            style={{
              position: "absolute",
              top: "12px",
              right: "16px",
              background: `linear-gradient(90deg, ${ink}, #1f2937)`,
              color: "#fff",
              fontSize: "2.65mm",
              fontWeight: 800,
              padding: "0.65mm 2.8mm",
              borderRadius: "999px",
              boxShadow: "0 0.6mm 2mm rgba(0,0,0,0.2)",
              whiteSpace: "nowrap",
            }}
          >
            Solution recommandée
          </div>
        </div>

        <div
          style={{
            width: "100%",
            alignSelf: "stretch",
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "1.65mm",
            flexShrink: 0,
          }}
        >
          {kpiCards.map((k) => (
            <div
              key={k.label}
              style={{
                borderRadius: "4mm",
                padding: "2.05mm 2.8mm",
                minHeight: "19.5mm",
                background: k.bg,
                border: k.border,
                boxShadow: "0 1.5mm 5mm rgba(15,23,42,0.1), inset 0 1px 0 rgba(255,255,255,0.85)",
                display: "flex",
                flexDirection: "column",
                gap: "0.6mm",
              }}
            >
              <div
                style={{
                  fontSize: "2.7mm",
                  fontWeight: 800,
                  color: titleInk,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {k.label}
              </div>
              <div style={{ fontSize: kpiValueSize, fontWeight: 900, color: k.accent, lineHeight: 1.02, letterSpacing: "-0.03em" }}>{k.line}</div>
              <div style={{ fontSize: "2.55mm", color: softSub, fontWeight: 500 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {rv && typeof rv === "object" && Object.keys(rv).length > 0 ? (
          <div
            style={{
              width: "100%",
              alignSelf: "stretch",
              borderRadius: "3mm",
              padding: "2mm 2.6mm",
              border: "0.35mm solid rgba(195,152,71,0.35)",
              background: "rgba(255,251,235,0.9)",
              fontSize: "2.65mm",
              color: subInk,
              lineHeight: 1.45,
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: "1mm", color: titleInk }}>Poste annuel batterie virtuelle (TTC)</div>
            {num(rv.energy_purchase_from_grid_eur) != null ? (
              <div>Achat réseau (énergie, {fmtInt(rv.grid_import_kwh as number)} kWh) : {fmtEUR(rv.energy_purchase_from_grid_eur as number)}</div>
            ) : null}
            {num(rv.virtual_battery_subscription_ttc) != null && Number(rv.virtual_battery_subscription_ttc) > 0 ? (
              <div>Abonnement stockage virtuel : {fmtEUR(rv.virtual_battery_subscription_ttc as number)}</div>
            ) : null}
            {num(rv.virtual_battery_autoproducer_contribution_ttc) != null &&
            Number(rv.virtual_battery_autoproducer_contribution_ttc) > 0 ? (
              <div>Contribution autoproducteur : {fmtEUR(rv.virtual_battery_autoproducer_contribution_ttc as number)}</div>
            ) : null}
            {num(rv.virtual_battery_discharge_fees_ttc) != null && Number(rv.virtual_battery_discharge_fees_ttc) > 0 ? (
              <div>Restitution / déstockage (€/kWh restitués) : {fmtEUR(rv.virtual_battery_discharge_fees_ttc as number)}</div>
            ) : null}
            {num(rv.virtual_battery_activation_ttc) != null && Number(rv.virtual_battery_activation_ttc) > 0 ? (
              <div>Frais d&apos;activation (année 1) : {fmtEUR(rv.virtual_battery_activation_ttc as number)}</div>
            ) : null}
            {typeof rv.supplier_subscription_note === "string" && rv.supplier_subscription_note ? (
              <div style={{ marginTop: "0.6mm", fontSize: "2.35mm", color: softSub }}>{String(rv.supplier_subscription_note)}</div>
            ) : null}
          </div>
        ) : null}

        <div
          style={{
            width: "100%",
            alignSelf: "stretch",
            borderRadius: "3mm",
            flexShrink: 0,
            background: "linear-gradient(180deg, #171717 0%, #0a0a0a 100%)",
            boxShadow: "0 2mm 6mm rgba(0,0,0,0.35)",
            padding: "1.85mm 2.4mm 1.7mm",
          }}
        >
          <div
            style={{
              fontSize: "2.85mm",
              fontWeight: 800,
              color: "rgba(255,255,255,0.95)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: "0.85mm",
              textAlign: "left",
            }}
          >
            Indicateurs de rentabilité
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1.65mm" }}>
            {[
              {
                lab: "ROI",
                unit: "ans",
                val: roi != null && Number.isFinite(roi) ? `${Math.round(roi)}` : "—",
                w: roiBarPct,
                grad: `linear-gradient(90deg, ${pdfBrandGoldLight(gold)}, ${gold})`,
              },
              {
                lab: "TRI",
                unit: "%",
                val: tri != null && Number.isFinite(tri) ? Number(tri).toFixed(1).replace(".", ",") : "—",
                w: triBarPct,
                grad: "linear-gradient(90deg,#8FB3FF,#0047AB)",
              },
              {
                lab: "LCOE",
                unit: "€/kWh",
                val: lcoe != null && Number.isFinite(lcoe) ? Number(lcoe).toFixed(3).replace(".", ",") : "—",
                w: lcoeBarPct,
                grad: "linear-gradient(90deg,#A3E8C9,#0B6E4F)",
              },
            ].map((row) => (
              <div key={row.lab} style={{ display: "flex", flexDirection: "column", gap: "0.55mm", minHeight: "9.5mm" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: "2.65mm", fontWeight: 700, color: "rgba(255,255,255,0.65)" }}>{row.lab}</span>
                  <span style={{ fontSize: "3.95mm", fontWeight: 900, color: "#fff" }}>
                    {row.val}
                    {row.val !== "—" ? (
                      <span style={{ fontSize: "2.55mm", fontWeight: 700, color: "rgba(255,255,255,0.75)", marginLeft: "0.45mm" }}>{row.unit}</span>
                    ) : null}
                  </span>
                </div>
                <div
                  style={{
                    height: "2.55mm",
                    borderRadius: "999px",
                    background: "rgba(255,255,255,0.12)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "2.55mm",
                      width: `${row.w}%`,
                      background: row.grad,
                      borderRadius: "999px",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            width: "100%",
            alignSelf: "stretch",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "2.1mm",
            alignItems: "stretch",
            alignContent: "start",
            flex: "0 0 auto",
            minHeight: 0,
          }}
        >
          <div
            style={{
              padding: "3.2mm 3.5mm",
              borderRadius: "4mm",
              background: "linear-gradient(165deg, #fff 0%, #f9fafb 100%)",
              border: "0.35mm solid #e5e7eb",
              boxShadow: "0 1.2mm 4mm rgba(15,23,42,0.07)",
              minHeight: 0,
              alignSelf: "stretch",
              display: "flex",
              flexDirection: "column",
              alignItems: "start",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "1.45mm", flexShrink: 0, minHeight: 0 }}>
              <div style={{ fontSize: "3.85mm", fontWeight: 900, color: titleInk, flexShrink: 0 }}>Caractéristiques du projet</div>
              <ul style={{ margin: 0, padding: "0 0 0 4mm", fontSize: "3.25mm", color: subInk, lineHeight: 1.48, fontWeight: 500, flexShrink: 0 }}>
                <li style={{ marginBottom: "0.55mm" }}>
                  {nbPanels != null && Number(nbPanels) > 0 ? (
                    <>Installation de <strong style={{ color: ink }}>{fmtInt(nbPanels)}</strong> panneaux</>
                  ) : (
                    <>Puissance <strong style={{ color: ink }}>{fmtKwc(kwc)} kWc</strong></>
                  )}
                </li>
                <li style={{ marginBottom: "0.55mm" }}>
                  Production annuelle estimée : <strong style={{ color: ink }}>{prodKwh != null ? `${fmtInt(prodKwh)} kWh` : "—"}</strong>
                </li>
                <li style={{ marginBottom: "0.55mm" }}>
                  {safeAutoPct >= 50 ? (
                    <>
                      Plus de la moitié de votre consommation est couverte par votre installation solaire
                    </>
                  ) : (
                    <>
                      Vous couvrez environ <strong style={{ color: gold }}>{fmtPct(safeAutoPct)}</strong> de vos besoins avec votre installation solaire
                    </>
                  )}
                </li>
                <li>
                  {safeAutoAu >= 50 ? (
                    <>Plus de la moitié de votre consommation est couverte par votre installation solaire</>
                  ) : (
                    <>
                      Vous couvrez environ <strong style={{ color: "#0047AB" }}>{fmtPct(safeAutoAu)}</strong> de vos besoins avec votre installation solaire
                    </>
                  )}
                </li>
              </ul>
            </div>
          </div>

          <div
            style={{
              padding: "3mm 3.2mm",
              borderRadius: "4mm",
              background: `linear-gradient(165deg, ${hexToRgba(gold, 0.12)} 0%, #fff 52%)`,
              border: `0.42mm solid ${hexToRgba(gold, 0.38)}`,
              boxShadow: `0 1.2mm 4mm ${hexToRgba(gold, 0.14)}`,
              minHeight: 0,
              alignSelf: "stretch",
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-start",
              gap: "1.75mm",
            }}
          >
            <div style={{ fontSize: "3.85mm", fontWeight: 900, color: titleInk, flexShrink: 0 }}>Enjeux du photovoltaïque aujourd&apos;hui</div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1mm",
                flex: "0 0 auto",
                minHeight: 0,
                justifyContent: "flex-start",
              }}
            >
              {[
                { t: "Hausse durable du prix de l’électricité", d: "Limiter l’exposition du site aux hausses tarifaires.", icon: "◆" },
                { t: "Rentabilité suivie sur le long terme", d: "Économies mesurables dès la mise en service.", icon: "◆" },
                { t: "Valorisation patrimoniale", d: "Un actif productif sur la durée de vie du projet.", icon: "◆" },
              ].map((x, idx) => (
                <div
                  key={x.t}
                  style={{
                    display: "flex",
                    gap: "1.4mm",
                    alignItems: "flex-start",
                    paddingBottom: idx < 2 ? "1.15mm" : "0.4mm",
                    marginBottom: idx < 2 ? "1.15mm" : 0,
                    borderBottom: idx < 2 ? `0.25mm solid ${hexToRgba(gold, 0.28)}` : "none",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      width: "4.8mm",
                      height: "4.8mm",
                      marginTop: "0.15mm",
                      borderRadius: "1.15mm",
                      background: `linear-gradient(145deg, ${gold}, #e8d2a5)`,
                      color: "#111",
                      fontSize: "2.2mm",
                      fontWeight: 900,
                      display: "flex",
                      alignItems: "center",
                      boxShadow: `0 0.5mm 1.4mm ${hexToRgba(gold, 0.45)}`,
                    }}
                  >
                    {x.icon}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "2.95mm", fontWeight: 800, color: titleInk, lineHeight: 1.12 }}>{x.t}</div>
                    <div style={{ fontSize: "2.65mm", color: softSub, lineHeight: 1.22, marginTop: "0.28mm" }}>{x.d}</div>
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                flexShrink: 0,
                padding: "1.45mm 0 0",
                borderTop: `0.4mm solid ${hexToRgba(gold, 0.42)}`,
                textAlign: "left",
              }}
            >
              <div style={{ fontSize: "3.55mm", fontWeight: 900, color: titleInk, marginBottom: "0.55mm" }}>Le dispositif retenu est :</div>
              <div style={{ fontSize: "3.35mm", color: ink, fontWeight: 700, lineHeight: 1.32 }}>
                <span style={{ color: gold, fontWeight: 900 }}>✔</span> rentable &nbsp;&nbsp;
                <span style={{ color: gold, fontWeight: 900 }}>✔</span> durable &nbsp;&nbsp;
                <span style={{ color: gold, fontWeight: 900 }}>✔</span> immédiatement activable
              </div>
              <div
                style={{
                  fontSize: "3.45mm",
                  fontWeight: 900,
                  color: ink,
                  marginTop: "0.62mm",
                  letterSpacing: "-0.02em",
                }}
              >
                Le projet peut être engagé dès validation du dossier
              </div>
              <div style={{ fontSize: "3.05mm", color: subInk, marginTop: "0.5mm", fontWeight: 500, lineHeight: 1.3 }}>
                Gain net cumulé sur 25 ans (estimation) : <strong style={{ color: ink, fontWeight: 800 }}>{fmtEUR(gains25)}</strong> — même base que l&apos;étude financière (page 2).
              </div>
              <div style={{ fontSize: "2.7mm", color: "#6b7280", marginTop: "0.8mm", lineHeight: 1.35 }}>
                Une partie de votre production solaire peut ne pas être utilisée à certains moments de l’année si la capacité de stockage est atteinte.
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            width: "100%",
            alignSelf: "stretch",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-start",
            gap: "2.4mm",
            padding: "2.05mm 3.4mm",
            borderRadius: "3.5mm",
            flexShrink: 0,
            marginTop: "0",
            background: "linear-gradient(90deg, #111, #1f2937)",
            border: "0.3mm solid #374151",
            boxShadow: "0 1mm 3mm rgba(0,0,0,0.2)",
          }}
        >
          <span
            style={{
              width: "3.2mm",
              height: "3.2mm",
              borderRadius: "50%",
              background: `linear-gradient(135deg, ${gold}, #e8d2a5)`,
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: "3.45mm", fontWeight: 800, color: "#fff", letterSpacing: "0.02em" }}>
            Découvrez les solutions de financement adaptées
          </span>
        </div>
      </div>
    </PdfPageLayout>
  );
}
