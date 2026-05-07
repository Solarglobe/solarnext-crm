/**
 * Page hybride physique + virtuelle — même système que PdfPage7VirtualBattery
 * (PdfPageLayout + PdfHeader legacy).
 * Contenu : KPI × 3 · cascade en 3 étapes · tableau contribution par couche ·
 *           section "Pourquoi les deux ?"
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

interface P7HybridBatteryData {
  meta?: { client?: string; ref?: string; date?: string; date_display?: string };
  title?: string;
  subtitle?: string;
  kpis?: {
    energy_solar_valorised_kwh?: number | null;
    energy_grid_import_kwh?: number | null;
    estimated_annual_bill_eur?: number | null;
    solar_coverage_pct?: number | null;
  };
  layers?: {
    direct_auto_kwh?: number | null;
    physical_battery_kwh?: number | null;
    virtual_battery_kwh?: number | null;
    total_valorised_kwh?: number | null;
  };
  comparison?: {
    base_import_kwh?: number | null;
    hybrid_import_kwh?: number | null;
    grid_bought_less_kwh?: number | null;
    autonomy_gain_ratio?: number | null;
    max_theoretical_ratio?: number | null;
  };
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

function fmtEur(v: unknown): string {
  const n = num(v);
  if (n == null) return EMPTY;
  return `${Math.round(n).toLocaleString("fr-FR")} €`;
}

function fmtPtsFromRatio(v: unknown): string {
  const n = num(v);
  if (n == null) return EMPTY;
  return `+${(n * 100).toFixed(1).replace(".", ",")} pts`;
}

// ── Styles partagés ─────────────────────────────────────────────────────────────
const CARD_SOFT_BASE: React.CSSProperties = {
  padding: "3.6mm 3.3mm",
  border: "0.4mm solid rgba(195,152,71,.28)",
  borderRadius: "4.2mm",
  background: "linear-gradient(180deg, rgba(195,152,71,.06), #fdfcf9)",
  boxShadow: "0 0.75mm 2.2mm rgba(0,0,0,.04)",
};

const CARD_HIGHLIGHT: React.CSSProperties = {
  ...CARD_SOFT_BASE,
  borderColor: "rgba(195,152,71,.42)",
  background: "linear-gradient(180deg, rgba(195,152,71,.11), #fdfcf9)",
};

// ── Sous-composants ──────────────────────────────────────────────────────────────

function LayerRow({
  icon,
  label,
  sub,
  value,
  highlight,
  isTotal,
  brandHex,
}: {
  icon: string;
  label: string;
  sub?: string;
  value: string;
  highlight?: boolean;
  isTotal?: boolean;
  brandHex: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "6mm 1fr auto",
        alignItems: "center",
        gap: "2mm",
        padding: isTotal ? "1.8mm 0" : "1.4mm 0",
        borderBottom: isTotal ? "none" : "0.25mm solid rgba(195,152,71,.14)",
        borderTop: isTotal ? "0.5mm solid rgba(195,152,71,.35)" : "none",
        marginTop: isTotal ? "0.8mm" : "0",
        fontWeight: isTotal ? 800 : 500,
        fontSize: isTotal ? "3.5mm" : "3.1mm",
        color: highlight || isTotal ? "#1a1a1a" : "#444",
      }}
    >
      <span style={{ fontSize: "4mm", lineHeight: 1 }}>{icon}</span>
      <div>
        <div style={{ fontWeight: isTotal ? 800 : 600, color: isTotal ? brandHex : "#2a2a2a" }}>
          {label}
        </div>
        {sub && (
          <div style={{ fontSize: "2.6mm", color: "#777", marginTop: "0.4mm" }}>{sub}</div>
        )}
      </div>
      <strong style={{ color: isTotal ? brandHex : "#1a1a1a", fontSize: isTotal ? "3.8mm" : "3.1mm" }}>
        {value}
      </strong>
    </div>
  );
}

function CascadeStep({
  step,
  icon,
  title,
  desc,
  last,
  brandHex,
}: {
  step: string;
  icon: string;
  title: string;
  desc: string;
  last?: boolean;
  brandHex: string;
}) {
  return (
    <div style={{ display: "flex", gap: "2.5mm", alignItems: "flex-start" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
        <div
          style={{
            width: "6mm",
            height: "6mm",
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${brandHex}, color-mix(in srgb, ${brandHex} 70%, #fff))`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "2.8mm",
            fontWeight: 800,
            color: "#fff",
            flexShrink: 0,
          }}
        >
          {step}
        </div>
        {!last && (
          <div
            style={{
              width: "0.35mm",
              flex: 1,
              minHeight: "3mm",
              background: `linear-gradient(180deg, ${brandHex}88, ${brandHex}22)`,
              margin: "1mm 0",
            }}
          />
        )}
      </div>
      <div style={{ paddingBottom: last ? 0 : "2mm" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1.5mm", marginBottom: "0.7mm" }}>
          <span style={{ fontSize: "3.5mm" }}>{icon}</span>
          <span style={{ fontWeight: 700, fontSize: "3.1mm", color: "#1a1a1a" }}>{title}</span>
        </div>
        <p style={{ margin: 0, fontSize: "2.75mm", color: "#555", lineHeight: 1.4 }}>{desc}</p>
      </div>
    </div>
  );
}

// ── Composant principal ──────────────────────────────────────────────────────────

export default function PdfPage7HybridBattery({
  data,
  organization = {},
  viewModel,
}: {
  data?: P7HybridBatteryData | null;
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
    const studyId =
      params?.get("studyId") ??
      (viewModel?.meta as { studyId?: string } | undefined)?.studyId ??
      "";
    const versionId =
      params?.get("versionId") ??
      (viewModel?.meta as { versionId?: string } | undefined)?.versionId ??
      "";
    const orgId = organization?.id;

    if (!orgId || !renderToken || !studyId || !versionId) {
      return PLACEHOLDER_LOGO;
    }
    const hasLogo = !!organization?.logo_image_key;
    return hasLogo
      ? getStorageUrl(orgId, "logo", renderToken, studyId, versionId)
      : PLACEHOLDER_LOGO;
  }, [organization?.id, organization?.logo_image_key, organization?.logo_url, viewModel?.meta]);

  const meta = data.meta ?? {};
  const kpis = data.kpis ?? {};
  const layers = data.layers ?? {};
  const comparison = data.comparison ?? {};
  const limits = Array.isArray(data.limits) ? data.limits.slice(0, 3) : [];

  const badgeText =
    data.title != null && String(data.title).trim() !== ""
      ? String(data.title)
      : "Configuration hybride : physique + virtuelle en cascade";

  // Calcul de la barre de répartition (largeurs relatives en %)
  const total = num(layers.total_valorised_kwh) ?? 1;
  const directPct = Math.round(((num(layers.direct_auto_kwh) ?? 0) / total) * 100);
  const physPct = Math.round(((num(layers.physical_battery_kwh) ?? 0) / total) * 100);
  const virtPct = Math.round(((num(layers.virtual_battery_kwh) ?? 0) / total) * 100);

  return (
    <PdfPageLayout
      legacyPort={{
        id: "p7hb",
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
      {/* Sous-titre */}
      <p style={{ margin: "0 0 1.5mm 0", fontSize: "3.2mm", lineHeight: 1.38, color: "#555", flexShrink: 0 }}>
        {val(data.subtitle)}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "3.5mm", flex: 1, minHeight: 0 }}>

        {/* ── Section 1 : KPI × 3 ─────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "3.1mm", flexShrink: 0 }}>
          <div style={CARD_SOFT_BASE}>
            <div style={{ fontWeight: 700, marginBottom: "1.15mm", fontSize: "3.2mm", color: brandHex }}>
              Énergie solaire valorisée
            </div>
            <div style={{ fontSize: "6.5mm", fontWeight: 800, lineHeight: 1 }}>
              {fmtKwh(kpis.energy_solar_valorised_kwh)}
            </div>
            <div style={{ margin: "1mm 0 0 0", fontSize: "2.8mm", color: "#666" }}>
              Autoconsommation directe + batterie physique + crédit virtuel
            </div>
          </div>
          <div style={CARD_SOFT_BASE}>
            <div style={{ fontWeight: 700, marginBottom: "1.15mm", fontSize: "3.2mm", color: brandHex }}>
              Énergie restante à acheter
            </div>
            <div style={{ fontSize: "6.5mm", fontWeight: 800, lineHeight: 1 }}>
              {fmtKwh(kpis.energy_grid_import_kwh)}
            </div>
            <div style={{ margin: "1mm 0 0 0", fontSize: "2.8mm", color: "#666" }}>
              Résidu réseau après les deux systèmes
            </div>
          </div>
          <div style={CARD_SOFT_BASE}>
            <div style={{ fontWeight: 700, marginBottom: "1.15mm", fontSize: "3.2mm", color: brandHex }}>
              Facture annuelle estimée
            </div>
            <div style={{ fontSize: "6.5mm", fontWeight: 800, lineHeight: 1 }}>
              {fmtEur(kpis.estimated_annual_bill_eur)}
            </div>
            <div style={{ margin: "1mm 0 0 0", fontSize: "2.8mm", color: "#666" }}>
              Après application des deux couches de stockage
            </div>
          </div>
        </div>

        {/* ── Section 2 : cascade + contribution (2 colonnes) ─────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3.1mm", flex: 1, minHeight: 0 }}>

          {/* Colonne gauche : cascade en 3 étapes */}
          <div style={{ ...CARD_SOFT_BASE, display: "flex", flexDirection: "column", gap: "0" }}>
            <div style={{ fontWeight: 700, marginBottom: "2mm", fontSize: "3.2mm", color: brandHex }}>
              La cascade en 3 étapes
            </div>
            <CascadeStep
              step="1"
              icon="☀️"
              title="Autoconsommation directe"
              desc="La production solaire couvre immédiatement la consommation du moment."
              brandHex={brandHex}
            />
            <CascadeStep
              step="2"
              icon="🔋"
              title="Batterie physique"
              desc="Le surplus de la journée est stocké et restitué le soir lors des pics de consommation."
              brandHex={brandHex}
            />
            <CascadeStep
              step="3"
              icon="🌐"
              title="Batterie virtuelle"
              desc="Le surplus résiduel est converti en crédits kWh pour réduire les factures d'import en hiver."
              last
              brandHex={brandHex}
            />

            {/* Résultat combiné avant / après — remplit l'espace sous les étapes */}
            {(comparison.base_import_kwh != null || comparison.grid_bought_less_kwh != null) && (
              <div
                style={{
                  marginTop: "2.5mm",
                  padding: "2mm 2.5mm",
                  borderRadius: "2.5mm",
                  background: `linear-gradient(135deg, rgba(195,152,71,.08), rgba(195,152,71,.03))`,
                  border: "0.35mm solid rgba(195,152,71,.25)",
                }}
              >
                <div style={{ fontSize: "2.7mm", fontWeight: 700, color: brandHex, marginBottom: "1.5mm" }}>
                  Résultat combiné
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1.5mm" }}>
                  {comparison.base_import_kwh != null && (
                    <div style={{ textAlign: "center", flex: 1 }}>
                      <div style={{ fontSize: "2.4mm", color: "#888", marginBottom: "0.5mm" }}>Avant</div>
                      <div style={{ fontSize: "4mm", fontWeight: 800, color: "#666" }}>{fmtKwh(comparison.base_import_kwh)}</div>
                      <div style={{ fontSize: "2.2mm", color: "#aaa" }}>d'import réseau</div>
                    </div>
                  )}
                  <div style={{ fontSize: "5mm", color: brandHex, flexShrink: 0 }}>→</div>
                  {comparison.hybrid_import_kwh != null && (
                    <div style={{ textAlign: "center", flex: 1 }}>
                      <div style={{ fontSize: "2.4mm", color: "#888", marginBottom: "0.5mm" }}>Après hybride</div>
                      <div style={{ fontSize: "4mm", fontWeight: 800, color: "#27ae60" }}>{fmtKwh(comparison.hybrid_import_kwh)}</div>
                      <div style={{ fontSize: "2.2mm", color: "#aaa" }}>d'import réseau</div>
                    </div>
                  )}
                  {comparison.grid_bought_less_kwh != null && (
                    <div
                      style={{
                        textAlign: "center",
                        flex: 1,
                        padding: "1mm 1.5mm",
                        borderRadius: "2mm",
                        background: "rgba(195,152,71,.12)",
                        border: "0.25mm solid rgba(195,152,71,.3)",
                      }}
                    >
                      <div style={{ fontSize: "2.4mm", color: "#888", marginBottom: "0.5mm" }}>Économie</div>
                      <div style={{ fontSize: "4mm", fontWeight: 800, color: brandHex }}>
                        -{fmtKwh(comparison.grid_bought_less_kwh)}
                      </div>
                      <div style={{ fontSize: "2.2mm", color: "#aaa" }}>achetés en moins</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Spacer résiduel : ancre la barre en bas si le bloc comparaison est court */}
            <div style={{ flex: 1 }} />

            {/* Barre de répartition */}
            {total > 0 && (
              <div style={{ marginTop: "2.5mm" }}>
                <div style={{ fontSize: "2.6mm", color: "#777", marginBottom: "1mm" }}>
                  Répartition de l'énergie valorisée
                </div>
                <div
                  style={{
                    display: "flex",
                    height: "3mm",
                    borderRadius: "1.5mm",
                    overflow: "hidden",
                    gap: "0.3mm",
                  }}
                >
                  <div
                    style={{
                      width: `${directPct}%`,
                      background: "linear-gradient(90deg, #f39c12, #f1c40f)",
                      borderRadius: "1.5mm 0 0 1.5mm",
                    }}
                  />
                  <div
                    style={{
                      width: `${physPct}%`,
                      background: "linear-gradient(90deg, #27ae60, #2ecc71)",
                    }}
                  />
                  <div
                    style={{
                      width: `${virtPct}%`,
                      background: "linear-gradient(90deg, #2980b9, #3498db)",
                      borderRadius: "0 1.5mm 1.5mm 0",
                    }}
                  />
                </div>
                <div style={{ display: "flex", gap: "3mm", marginTop: "1mm", fontSize: "2.5mm", color: "#666" }}>
                  <span><span style={{ display: "inline-block", width: "2mm", height: "2mm", borderRadius: "50%", background: "#f39c12", verticalAlign: "middle", marginRight: "0.8mm" }} />Directe {directPct}%</span>
                  <span><span style={{ display: "inline-block", width: "2mm", height: "2mm", borderRadius: "50%", background: "#27ae60", verticalAlign: "middle", marginRight: "0.8mm" }} />Physique {physPct}%</span>
                  <span><span style={{ display: "inline-block", width: "2mm", height: "2mm", borderRadius: "50%", background: "#2980b9", verticalAlign: "middle", marginRight: "0.8mm" }} />Virtuelle {virtPct}%</span>
                </div>
              </div>
            )}
          </div>

          {/* Colonne droite : tableau contribution + pourquoi les deux */}
          <div style={{ display: "flex", flexDirection: "column", gap: "3.1mm" }}>

            {/* Tableau contribution par couche */}
            <div style={{ ...CARD_HIGHLIGHT, flex: "0 0 auto" }}>
              <div style={{ fontWeight: 700, marginBottom: "1.5mm", fontSize: "3.2mm", color: brandHex }}>
                Contribution de chaque couche
              </div>
              <LayerRow
                icon="☀️"
                label="Autoconsommation directe"
                sub="Production → consommation immédiate"
                value={fmtKwh(layers.direct_auto_kwh)}
                brandHex={brandHex}
              />
              <LayerRow
                icon="🔋"
                label="Batterie physique"
                sub="Charge jour · décharge soir"
                value={fmtKwh(layers.physical_battery_kwh)}
                brandHex={brandHex}
              />
              <LayerRow
                icon="🌐"
                label="Crédit batterie virtuelle"
                sub="Surplus → crédit kWh contractuel"
                value={fmtKwh(layers.virtual_battery_kwh)}
                brandHex={brandHex}
              />
              <LayerRow
                icon="✅"
                label="Total valorisé"
                value={fmtKwh(layers.total_valorised_kwh)}
                isTotal
                brandHex={brandHex}
              />

              {/* Gain autonomie vs BASE */}
              {comparison.autonomy_gain_ratio != null && (
                <div
                  style={{
                    marginTop: "2mm",
                    padding: "1.2mm 2mm",
                    borderRadius: "2mm",
                    background: `linear-gradient(90deg, rgba(195,152,71,.12), rgba(195,152,71,.04))`,
                    fontSize: "2.9mm",
                    fontWeight: 700,
                    color: brandHex,
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
         