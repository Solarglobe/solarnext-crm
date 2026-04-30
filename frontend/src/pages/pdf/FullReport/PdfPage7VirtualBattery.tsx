/**
 * Page batterie virtuelle — même système que PdfLegacyPort P7 (PdfPageLayout + PdfHeader legacy).
 */
import React, { useMemo } from "react";
import PdfPageLayout from "../PdfEngine/PdfPageLayout";
import PdfHeader from "@/components/pdf/PdfHeader";
import { usePdfOrgBranding } from "../PdfLegacyPort/pdfOrgBrandingContext";
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

interface P7VirtualBatteryData {
  meta?: { client?: string; ref?: string; date?: string; date_display?: string };
  title?: string;
  subtitle?: string;
  without_battery?: Record<string, unknown>;
  with_virtual_battery?: Record<string, unknown>;
  max_theoretical?: Record<string, unknown>;
  contribution?: Record<string, unknown>;
  limits?: string[];
}

const EMPTY = "—";

function val(v: unknown): string {
  if (v == null || v === "") return EMPTY;
  return String(v);
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function fmtKwh(v: unknown): string {
  const n = num(v);
  if (n == null) return EMPTY;
  return `${Math.round(n).toLocaleString("fr-FR")} kWh`;
}

function fmtPctFromRatio(v: unknown): string {
  const n = num(v);
  if (n == null) return EMPTY;
  return `${(n * 100).toFixed(1).replace(".", ",")} %`;
}

function fmtPtsFromRatio(v: unknown): string {
  const n = num(v);
  if (n == null) return EMPTY;
  return `${(n * 100).toFixed(1).replace(".", ",")} pts`;
}

const CARD_SOFT_BASE: React.CSSProperties = {
  padding: "3.6mm 3.3mm",
  border: "0.4mm solid rgba(195,152,71,.28)",
  borderRadius: "4.2mm",
  background: "linear-gradient(180deg, rgba(195,152,71,.06), #fdfcf9)",
  boxShadow: "0 0.75mm 2.2mm rgba(0,0,0,.04)",
};

function MetricRow({ label, value, isLast }: { label: string; value: string; isLast?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: "8px",
        padding: "1.15mm 0",
        borderBottom: isLast ? "none" : "0.25mm solid rgba(195, 152, 71, 0.15)",
        fontSize: "3.05mm",
        color: "#444",
      }}
    >
      <span>{label}</span>
      <strong style={{ color: "#1a1a1a", fontWeight: 700 }}>{value}</strong>
    </div>
  );
}

export default function PdfPage7VirtualBattery({
  data,
  organization = {},
  viewModel,
}: {
  data?: P7VirtualBatteryData | null;
  organization?: { id?: string; logo_image_key?: string | null; logo_url?: string | null };
  viewModel?: { fullReport?: Record<string, unknown>; meta?: { studyId?: string; versionId?: string }; [key: string]: unknown };
}) {
  if (!data) return null;

  const { brandHex } = usePdfOrgBranding();

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

  const meta = data.meta ?? {};
  const withoutBattery = data.without_battery ?? {};
  const withBattery = data.with_virtual_battery ?? {};
  const maxTheoretical = data.max_theoretical ?? {};
  const contribution = data.contribution ?? {};
  const kpis = (data as { kpis?: Record<string, unknown> }).kpis ?? {};
  const limits = Array.isArray(data.limits) ? data.limits.slice(0, 3) : [];

  const badgeText =
    data.title != null && String(data.title).trim() !== ""
      ? String(data.title)
      : "Impact réel de votre batterie virtuelle";

  return (
    <PdfPageLayout
      legacyPort={{
        id: "p7vb",
        sectionGap: "1.65mm",
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
            badge={badgeText}
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
                  <b>Client</b> : {val(meta.client)}
                </div>
                <div>
                  <b>Réf.</b> : {val(meta.ref)}
                </div>
                <div>
                  <b>Date</b> : {val(meta.date_display ?? meta.date)}
                </div>
              </div>
            }
          />
        ),
      }}
    >
      <p style={{ margin: "0 0 1.5mm 0", fontSize: "3.2mm", lineHeight: 1.38, color: "#555", flexShrink: 0 }}>
        {val(data.subtitle)}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "16px", flex: 1, minHeight: 0 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "3.1mm", flexShrink: 0 }}>
          <div className="card soft" style={CARD_SOFT_BASE}>
            <div style={{ fontWeight: 700, marginBottom: "1.15mm", fontSize: "3.2mm", color: brandHex }}>Énergie solaire utilisée</div>
            <div style={{ fontSize: "6.5mm", fontWeight: 800, lineHeight: 1 }}>{fmtKwh(kpis.energy_solar_used_kwh ?? withBattery.pv_total_used_kwh)}</div>
            <div style={{ margin: "1mm 0 0 0", fontSize: "2.8mm", color: "#666" }}>
              {`Vous utiliserez environ ${fmtKwh(kpis.energy_solar_used_kwh ?? withBattery.pv_total_used_kwh)} de votre production solaire`}
            </div>
          </div>
          <div className="card soft" style={CARD_SOFT_BASE}>
            <div style={{ fontWeight: 700, marginBottom: "1.15mm", fontSize: "3.2mm", color: brandHex }}>Énergie restante à acheter</div>
            <div style={{ fontSize: "6.5mm", fontWeight: 800, lineHeight: 1 }}>{fmtKwh(kpis.energy_grid_import_kwh ?? withBattery.grid_import_kwh)}</div>
            <div style={{ margin: "1mm 0 0 0", fontSize: "2.8mm", color: "#666" }}>
              {`Il vous restera environ ${fmtKwh(kpis.energy_grid_import_kwh ?? withBattery.grid_import_kwh)} à acheter au réseau`}
            </div>
          </div>
          <div className="card soft" style={CARD_SOFT_BASE}>
            <div style={{ fontWeight: 700, marginBottom: "1.15mm", fontSize: "3.2mm", color: brandHex }}>Facture annuelle estimée</div>
            <div style={{ fontSize: "6.5mm", fontWeight: 800, lineHeight: 1 }}>
              {num(kpis.estimated_annual_bill_eur) != null
                ? `${Math.round(num(kpis.estimated_annual_bill_eur) as number).toLocaleString("fr-FR")} €`
                : EMPTY}
            </div>
            <div style={{ margin: "1mm 0 0 0", fontSize: "2.8mm", color: "#666" }}>
              {num(kpis.estimated_annual_bill_eur) != null
                ? `Votre facture d’électricité sera d’environ ${Math.round(num(kpis.estimated_annual_bill_eur) as number).toLocaleString("fr-FR")} € par an`
                : EMPTY}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3.1mm", flexShrink: 0 }}>
          <div className="card soft" style={CARD_SOFT_BASE}>
            <div style={{ fontWeight: 700, marginBottom: "1.15mm", fontSize: "3.2mm", color: brandHex }}>Max théorique</div>
            <MetricRow label="Production" value={fmtKwh(maxTheoretical.production_kwh)} />
            <MetricRow label="Consommation" value={fmtKwh(maxTheoretical.consumption_kwh)} />
            <MetricRow label="Autonomie max" value={fmtPctFromRatio(maxTheoretical.autonomy_ratio)} isLast />
            <p style={{ margin: "2mm 0 0", fontSize: "2.85mm", color: "#666", fontStyle: "italic", lineHeight: 1.35 }}>
              Meme avec une batterie parfaite, ce seuil ne peut pas etre depasse.
            </p>
          </div>

          <div className="card soft" style={CARD_SOFT_BASE}>
            <div style={{ fontWeight: 700, marginBottom: "1.15mm", fontSize: "3.2mm", color: brandHex }}>Pourquoi pas 100 %</div>
            <ul style={{ margin: "0", paddingLeft: "4mm", fontSize: "3.05mm", color: "#444", lineHeight: 1.42 }}>
              {limits.map((item) => (
                <li key={item} style={{ marginBottom: "1mm" }}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="card soft" style={{ ...CARD_SOFT_BASE, borderColor: "rgba(195, 152, 71, 0.42)", background: "linear-gradient(180deg, rgba(195,152,71,.1), #fdfcf9)", flexShrink: 0 }}>
          <div style={{ fontWeight: 700, marginBottom: "1.15mm", fontSize: "3.2mm", color: brandHex }}>
            Couverture solaire
          </div>
          <div style={{ fontSize: "5.2mm", fontWeight: 800 }}>
            {num(kpis.solar_coverage_pct) != null
              ? Number(kpis.solar_coverage_pct) >= 50
                ? "Plus de la moitié de votre consommation est couverte par votre installation solaire"
                : `Vous couvrez environ ${Number(kpis.solar_coverage_pct).toFixed(1).replace(".", ",")} % de vos besoins avec votre installation solaire`
              : EMPTY}
          </div>
          <p style={{ margin: "1.2mm 0 0 0", fontSize: "2.8mm", color: "#666" }}>
            Une partie de votre production solaire peut ne pas être utilisée à certains moments de l’année si la capacité de stockage est atteinte. Sans système de stockage, une partie importante de votre production solaire ne pourrait pas être utilisée.
          </p>
        </div>
      </div>
    </PdfPageLayout>
  );
}
