/**
 * CP-PDF — Page "Analyse d'ombrage"
 * Sprint 1 : KPI + tableau mensuel kWh.
 * Sprint 2 : graphique barres mensuelles far/near (ChartShadingMonthly).
 * Sprint 3 : profil horizon réel (ChartHorizonProfile).
 */

import { useMemo } from "react";
import PdfPageLayout from "../PdfEngine/PdfPageLayout";
import PdfHeader from "../../../components/pdf/PdfHeader";
import { getCrmApiBaseWithWindowFallback } from "@/config/crmApiBase";
import ShadingKpiCard from "./components/ShadingKpiCard";
import TableMonthlyKwh, { type MonthlyKwhRow } from "./components/TableMonthlyKwh";
import ChartShadingMonthly, { type ShadingMonthlyFactor } from "./components/ChartShadingMonthly";
import ChartHorizonProfile from "./components/ChartHorizonProfile";

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

interface PShadingData {
  meta?: { client?: string; ref?: string; date?: string };
  prodNoShadingKwh?: number | null;
  prodWithShadingKwh?: number | null;
  annualLossKwh?: number | null;
  annualLossEur?: number | null;
  combinedLossPct?: number | null;
  farLossPct?: number | null;
  nearLossPct?: number | null;
  farHorizonKind?: string;
  farConfidenceLevel?: string | null;
  farSource?: string | null;
  monthlyKwhStats?: MonthlyKwhRow[] | null;
  monthlyFactors?: ShadingMonthlyFactor[] | null;
  horizonMaskArray?: number[] | null;
  lat?: number | null;
  lon?: number | null;
  pvgisSource?: string | null;
  pvgisTiltDeg?: number | null;
  pvgisAzimuthDeg?: number | null;
  peakPowerKwc?: number | null;
}

function fmtKwh(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v).toLocaleString("fr-FR")} kWh`;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)} %`;
}

function fmtEur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  return `≈ ${Math.round(v).toLocaleString("fr-FR")} €/an`;
}

function shadingLossColor(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "#E8ECF8";
  if (pct < 5)  return "#9FA8C7";
  if (pct < 15) return "#C39847";
  return "#E57373";
}

const BADGE_MAP: Record<string, { color: string; text: string }> = {
  REAL_TERRAIN: { color: "#4ade80", text: "ÉLEVÉE"  },
  SYNTHETIC:    { color: "#F59E0B", text: "ESTIMÉE" },
  UNAVAILABLE:  { color: "#E57373", text: "LIMITÉE" },
};

export default function PdfPageShading({
  organization = {},
  viewModel,
}: {
  organization?: { id?: string; logo_image_key?: string | null; logo_url?: string | null };
  viewModel?: { fullReport?: Record<string, unknown>; meta?: { studyId?: string; versionId?: string }; [key: string]: unknown };
}) {
  const logoUrl = useMemo(() => {
    if (organization?.logo_url) return organization.logo_url;
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const renderToken = params?.get("renderToken") ?? "";
    const studyId = params?.get("studyId") ?? (viewModel?.meta as { studyId?: string } | undefined)?.studyId ?? "";
    const versionId = params?.get("versionId") ?? (viewModel?.meta as { versionId?: string } | undefined)?.versionId ?? "";
    const orgId = organization?.id;
    if (!orgId || !renderToken || !studyId || !versionId) return PLACEHOLDER_LOGO;
    return organization?.logo_image_key
      ? getStorageUrl(orgId, "logo", renderToken, studyId, versionId)
      : PLACEHOLDER_LOGO;
  }, [organization?.id, organization?.logo_image_key, organization?.logo_url, viewModel?.meta]);

  const fr = (viewModel?.fullReport ?? {}) as Record<string, unknown>;
  const ps = (fr.p_shading ?? {}) as PShadingData;

  const meta               = ps.meta ?? {};
  const prodNoShading      = ps.prodNoShadingKwh   ?? null;
  const prodWithShading    = ps.prodWithShadingKwh ?? null;
  const annualLossKwh      = ps.annualLossKwh      ?? null;
  const annualLossEur      = ps.annualLossEur      ?? null;
  const combinedLossPct    = ps.combinedLossPct    ?? null;
  const farLossPct         = ps.farLossPct         ?? null;
  const nearLossPct        = ps.nearLossPct        ?? null;
  const farHorizonKind     = ps.farHorizonKind     ?? "UNAVAILABLE";
  const farConfidenceLevel = ps.farConfidenceLevel ?? null;
  const farSource          = ps.farSource          ?? null;
  const monthlyKwhStats    = ps.monthlyKwhStats    ?? null;
  const monthlyFactors     = ps.monthlyFactors     ?? null;
  const horizonMaskArray   = ps.horizonMaskArray   ?? null;
  const pvgisSource        = ps.pvgisSource        ?? null;
  const pvgisTiltDeg       = ps.pvgisTiltDeg       ?? null;
  const pvgisAzimuthDeg    = ps.pvgisAzimuthDeg    ?? null;

  const lossColor = shadingLossColor(combinedLossPct);
  const badge = BADGE_MAP[farHorizonKind] ?? BADGE_MAP.UNAVAILABLE;

  const techLinesKPI4: string[] = [
    farLossPct != null ? `Horizon : ${fmtPct(farLossPct)}` : "Horizon : N/D",
    `Masques : ${fmtPct(nearLossPct)}`,
  ];
  const techLinesQuality: string[] = farConfidenceLevel
    ? [`Confiance : ${farConfidenceLevel}`]
    : [];
  const sublabelQuality = farSource && farSource !== "FAR_UNAVAILABLE_ERROR"
    ? farSource
    : farHorizonKind === "REAL_TERRAIN"
      ? "GeoTIFF terrain réel"
      : farHorizonKind === "SYNTHETIC"
        ? "Modèle synthétique"
        : "Données insuffisantes";

  const hasMonthlyTable =
    Array.isArray(monthlyKwhStats) && monthlyKwhStats.length === 12;

  return (
    <PdfPageLayout
      legacyPort={{
        id: "p-shading",
        sectionGap: "4mm",
        pageStyle: { pageBreakAfter: "always", breakAfter: "always" },
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
                  onError={(e) => {
                    if (!e.currentTarget.dataset.fallbackApplied) {
                      e.currentTarget.dataset.fallbackApplied = "true";
                      e.currentTarget.src = PLACEHOLDER_LOGO;
                    }
                  }}
                />
              ) : null
            }
            badge="Analyse d'ombrage"
            metaColumn={
              <div
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
                  fontSize: "8.5pt",
                  color: "#9FA8C7",
                }}
              >
                <div><b style={{ color: "#E8ECF8" }}>Client</b> : {meta.client ?? "—"}</div>
                <div><b style={{ color: "#E8ECF8" }}>Réf.</b> : {meta.ref ?? "—"}</div>
                <div><b style={{ color: "#E8ECF8" }}>Date</b> : {meta.date ?? "—"}</div>
              </div>
            }
          />
        ),
      }}
    >
      {/* ── BLOC A : KPI strip ──────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: 8,
          width: "100%",
        }}
      >
        {/* KPI 1 — Production théorique */}
        <ShadingKpiCard
          label="Production théorique"
          value={fmtKwh(prodNoShading)}
          sublabel="Sans ombrage · PVGIS réf."
          valueColor="#E8ECF8"
        />

        {/* KPI 2 — Production réelle [hero] */}
        <ShadingKpiCard
          label="Production réelle"
          value={fmtKwh(prodWithShading)}
          sublabel="Après pertes d'ombrage"
          valueColor="#C39847"
          isHero
        />

        {/* KPI 3 — Énergie perdue */}
        <ShadingKpiCard
          label="Énergie perdue / an"
          value={fmtKwh(annualLossKwh)}
          sublabel={fmtEur(annualLossEur) || undefined}
          valueColor={lossColor}
        />

        {/* KPI 4 — Perte (%) avec décomposition far/near */}
        <ShadingKpiCard
          label="Perte d'ombrage"
          value={fmtPct(combinedLossPct)}
          valueColor={lossColor}
          techLines={techLinesKPI4}
        />

        {/* KPI 5 — Qualité données */}
        <ShadingKpiCard
          label="Qualité données"
          value={badge.text}
          badge={badge}
          sublabel={sublabelQuality}
          techLines={techLinesQuality}
        />
      </div>

      {/* ── BLOC B : Placeholders graphiques (Sprint 2 & 3) ─────────────────── */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: 8,
          width: "100%",
          height: 240,
        }}
      >
        {/* Gauche 58% : barres mensuelles far/near */}
        <div
          style={{
            flex: "0 0 58%",
            display: "flex",
            flexDirection: "column",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 6,
            padding: "8px 10px 4px",
            overflow: "hidden",
          }}
        >
          <div style={{ fontSize: "8pt", color: "#9FA8C7", fontWeight: 500, marginBottom: 4, letterSpacing: "0.03em", textTransform: "uppercase" }}>
            Pertes mensuelles (%)
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ChartShadingMonthly data={monthlyFactors} />
          </div>
        </div>

        {/* Droite 42% : profil horizon */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 6,
            padding: "8px 10px 4px",
            overflow: "hidden",
          }}
        >
          <div style={{ fontSize: "8pt", color: "#9FA8C7", fontWeight: 500, marginBottom: 4, letterSpacing: "0.03em", textTransform: "uppercase" }}>
            Profil horizon
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ChartHorizonProfile horizonMaskArray={horizonMaskArray} />
          </div>
        </div>
      </div>

      {/* ── BLOC C : Tableau kWh mensuel ────────────────────────────────────── */}
      <div style={{ width: "100%" }}>
        {hasMonthlyTable ? (
          <TableMonthlyKwh
            rows={monthlyKwhStats!}
            pvgisSource={pvgisSource}
            pvgisTiltDeg={pvgisTiltDeg}
            pvgisAzimuthDeg={pvgisAzimuthDeg}
          />
        ) : (
          <div
            style={{
              textAlign: "center",
              padding: "18px 0",
              fontSize: "8.5pt",
              color: "#9FA8C7",
              opacity: 0.6,
              lineHeight: 1.6,
            }}
          >
            Données énergétiques mensuelles indisponibles
            <br />
            (puissance crête non renseignée ou données PVGIS inaccessibles)
          </div>
        )}
      </div>
    </PdfPageLayout>
  );
}
