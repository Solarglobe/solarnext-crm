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

interface VehicleV2hPdfData {
  meta?: { client?: string; ref?: string; date?: string; date_display?: string; scenario_label?: string };
  title?: string;
  subtitle?: string;
  kpis?: {
    vehicle_discharge_kwh?: number | null;
    grid_bought_less_kwh?: number | null;
    final_grid_import_kwh?: number | null;
    estimated_annual_bill_eur?: number | null;
    solar_coverage_pct?: number | null;
  };
  vehicle?: {
    capacity_kwh?: number | null;
    reserve_pct?: number | null;
    reserve_kwh?: number | null;
    usable_for_home_kwh?: number | null;
    max_charge_kw?: number | null;
    max_discharge_kw?: number | null;
    efficiency_pct?: number | null;
    plugged_hours_year?: number | null;
    plugged_hours_week?: number | null;
  };
  energy?: {
    direct_auto_kwh?: number | null;
    physical_battery_kwh?: number | null;
    vehicle_v2h_kwh?: number | null;
    virtual_battery_kwh?: number | null;
    solar_charge_kwh?: number | null;
    grid_charge_mobility_kwh?: number | null;
    trip_consumption_kwh?: number | null;
    losses_kwh?: number | null;
    base_import_kwh?: number | null;
    final_import_kwh?: number | null;
  };
  cascade?: { has_physical?: boolean; has_virtual?: boolean };
  notes?: string[];
}

const EMPTY = "-";

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function val(v: unknown): string {
  if (v == null || v === "") return EMPTY;
  return String(v);
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

function fmtPct(v: unknown): string {
  const n = num(v);
  if (n == null) return EMPTY;
  return `${n.toFixed(0).replace(".", ",")} %`;
}

function fmtKw(v: unknown): string {
  const n = num(v);
  if (n == null) return EMPTY;
  return `${n.toFixed(1).replace(".", ",")} kW`;
}

function IconCar({ size = "5mm" }: { size?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <path d="M5 14l1.6-4.2A3 3 0 0 1 9.4 8h5.2a3 3 0 0 1 2.8 1.8L19 14" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M4 14h16v4H4v-4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="7.5" cy="18" r="1.5" fill="currentColor" />
      <circle cx="16.5" cy="18" r="1.5" fill="currentColor" />
      <path d="M11 11h2l-1.2 2.2H14L10.7 17l.9-2.6H9.8L11 11Z" fill="currentColor" />
    </svg>
  );
}

function IconBattery({ size = "5mm" }: { size?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <rect x="3" y="7" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="20" y="10" width="2" height="4" rx="0.6" fill="currentColor" />
      <rect x="6" y="10" width="8" height="4" rx="0.8" fill="currentColor" opacity="0.72" />
    </svg>
  );
}

function MetricCard({ label, value, sub, brandHex }: { label: string; value: string; sub?: string; brandHex: string }) {
  return (
    <div
      style={{
        padding: "3.1mm 3mm",
        border: "0.35mm solid rgba(195,152,71,.28)",
        borderRadius: "3.6mm",
        background: "linear-gradient(180deg, rgba(195,152,71,.07), #fdfcf9)",
        minHeight: "22mm",
      }}
    >
      <div style={{ fontSize: "2.75mm", fontWeight: 800, color: brandHex, lineHeight: 1.15, marginBottom: "1.2mm" }}>{label}</div>
      <div style={{ fontSize: "5.7mm", fontWeight: 850, color: "#161616", lineHeight: 1 }}>{value}</div>
      {sub ? <div style={{ marginTop: "1mm", fontSize: "2.55mm", color: "#666", lineHeight: 1.28 }}>{sub}</div> : null}
    </div>
  );
}

function FlowRow({
  icon,
  label,
  value,
  detail,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  color: string;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "7mm 1fr auto", gap: "2mm", alignItems: "center", padding: "1.35mm 0", borderBottom: "0.25mm solid rgba(195,152,71,.13)" }}>
      <div style={{ color }}>{icon}</div>
      <div>
        <div style={{ fontSize: "3mm", fontWeight: 750, color: "#252525" }}>{label}</div>
        <div style={{ fontSize: "2.45mm", color: "#6b7280", marginTop: "0.35mm" }}>{detail}</div>
      </div>
      <strong style={{ fontSize: "3.2mm", color: "#181818" }}>{value}</strong>
    </div>
  );
}

export default function PdfPage7VehicleV2h({
  data,
  organization = {},
  viewModel,
}: {
  data?: VehicleV2hPdfData | null;
  organization?: { id?: string; logo_image_key?: string | null; logo_url?: string | null };
  viewModel?: { fullReport?: Record<string, unknown>; meta?: { studyId?: string; versionId?: string }; [key: string]: unknown };
}) {
  if (!data) return null;

  const { brandHex } = usePdfOrgBranding();
  const logoUrl = useMemo(() => {
    if (organization?.logo_url) return organization.logo_url;
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const renderToken = params?.get("renderToken") ?? "";
    const studyId = params?.get("studyId") ?? (viewModel?.meta as { studyId?: string } | undefined)?.studyId ?? "";
    const versionId = params?.get("versionId") ?? (viewModel?.meta as { versionId?: string } | undefined)?.versionId ?? "";
    const orgId = organization?.id;
    if (!orgId || !renderToken || !studyId || !versionId) return PLACEHOLDER_LOGO;
    return organization.logo_image_key ? getStorageUrl(orgId, "logo", renderToken, studyId, versionId) : PLACEHOLDER_LOGO;
  }, [organization?.id, organization?.logo_image_key, organization?.logo_url, viewModel?.meta]);

  const meta = data.meta ?? {};
  const kpis = data.kpis ?? {};
  const vehicle = data.vehicle ?? {};
  const energy = data.energy ?? {};
  const hasPhysical = data.cascade?.has_physical === true;
  const hasVirtual = data.cascade?.has_virtual === true;
  const notes = Array.isArray(data.notes) ? data.notes.slice(0, 3) : [];
  const totalLayer =
    (num(energy.direct_auto_kwh) ?? 0) +
    (num(energy.physical_battery_kwh) ?? 0) +
    (num(energy.vehicle_v2h_kwh) ?? 0) +
    (num(energy.virtual_battery_kwh) ?? 0);
  const layerPct = (v: unknown) => {
    const n = num(v) ?? 0;
    return totalLayer > 0 ? Math.max(0, Math.round((n / totalLayer) * 100)) : 0;
  };

  return (
    <PdfPageLayout
      legacyPort={{
        id: "p7v2h",
        sectionGap: "1.55mm",
        header: (
          <PdfHeader
            headerStyle={{ ["--logoW" as string]: logoUrl ? "22mm" : "0", ["--metaW" as string]: "110mm", flexShrink: 0 }}
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
            badge={val(data.title)}
            metaColumn={
              <div className="meta-compact" style={{ position: "absolute", right: 0, bottom: 0, width: "var(--metaW)", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.75mm", textAlign: "right", lineHeight: 1.25 }}>
                <div><b>Client</b> : {val(meta.client)}</div>
                <div><b>Ref.</b> : {val(meta.ref)}</div>
                <div><b>Date</b> : {val(meta.date_display ?? meta.date)}</div>
              </div>
            }
          />
        ),
      }}
    >
      <p style={{ margin: "0 0 1.2mm", fontSize: "3.05mm", lineHeight: 1.35, color: "#555", flexShrink: 0 }}>
        {val(data.subtitle)}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "2.4mm", flexShrink: 0 }}>
        <MetricCard brandHex={brandHex} label="Restitution V2H" value={fmtKwh(kpis.vehicle_discharge_kwh)} sub="energie fournie a la maison" />
        <MetricCard brandHex={brandHex} label="Achat reseau evite" value={fmtKwh(kpis.grid_bought_less_kwh)} sub="vs scenario sans stockage" />
        <MetricCard brandHex={brandHex} label="Reste a acheter" value={fmtKwh(kpis.final_grid_import_kwh)} sub="import maison apres V2H" />
        <MetricCard brandHex={brandHex} label="Facture estimee" value={fmtEur(kpis.estimated_annual_bill_eur)} sub={`couverture solaire ${fmtPct(kpis.solar_coverage_pct)}`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2.8mm", flex: 1, minHeight: 0, marginTop: "1.4mm" }}>
        <div style={{ padding: "3.3mm", border: "0.35mm solid rgba(195,152,71,.26)", borderRadius: "3.8mm", background: "#fffdf8", minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1.8mm", color: brandHex, fontSize: "3.25mm", fontWeight: 850, marginBottom: "2mm" }}>
            <IconCar size="5mm" />
            Batterie vehicule disponible
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.7mm" }}>
            {[
              ["Capacite", fmtKwh(vehicle.capacity_kwh)],
              ["Reserve mobilite", `${fmtPct(vehicle.reserve_pct)} (${fmtKwh(vehicle.reserve_kwh)})`],
              ["Disponible maison", fmtKwh(vehicle.usable_for_home_kwh)],
              ["Heures branchees", `${Math.round(num(vehicle.plugged_hours_week) ?? 0)} h/sem.`],
              ["Puissance charge", fmtKw(vehicle.max_charge_kw)],
              ["Puissance decharge", fmtKw(vehicle.max_discharge_kw)],
            ].map(([label, value]) => (
              <div key={label} style={{ padding: "1.8mm 2mm", borderRadius: "2.5mm", background: "rgba(195,152,71,.07)", minHeight: "11mm" }}>
                <div style={{ fontSize: "2.35mm", color: "#777", fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
                <div style={{ marginTop: "0.7mm", fontSize: "3.15mm", color: "#181818", fontWeight: 800, lineHeight: 1.15 }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: "2.2mm", padding: "2mm 2.2mm", borderRadius: "2.6mm", background: "linear-gradient(135deg, rgba(91,196,224,.13), rgba(195,152,71,.08))", fontSize: "2.75mm", color: "#444", lineHeight: 1.35 }}>
            La mobilite reste prioritaire : les trajets et la reserve sont separes du bilan economique maison.
          </div>
        </div>

        <div style={{ padding: "3.3mm", border: "0.35mm solid rgba(195,152,71,.26)", borderRadius: "3.8mm", background: "#fffdf8", minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1.8mm", color: brandHex, fontSize: "3.25mm", fontWeight: 850, marginBottom: "1.6mm" }}>
            <IconBattery size="5mm" />
            Cascade de valorisation
          </div>
          <FlowRow icon={<IconBattery />} label="PV direct" value={fmtKwh(energy.direct_auto_kwh)} detail="consomme au moment de la production" color="#d4a82e" />
          {hasPhysical ? <FlowRow icon={<IconBattery />} label="Batterie physique" value={fmtKwh(energy.physical_battery_kwh)} detail="cycles journaliers maison" color="#2f9f5a" /> : null}
          <FlowRow icon={<IconCar />} label="Voiture V2H" value={fmtKwh(energy.vehicle_v2h_kwh)} detail="restitution quand le vehicule est branche" color="#5b4cc4" />
          {hasVirtual ? <FlowRow icon={<IconBattery />} label="Credit virtuel" value={fmtKwh(energy.virtual_battery_kwh)} detail="surplus residuel utilise plus tard" color="#2f83c8" /> : null}

          {totalLayer > 0 ? (
            <div style={{ marginTop: "2.3mm" }}>
              <div style={{ fontSize: "2.45mm", color: "#777", marginBottom: "0.8mm" }}>Repartition de l'energie valorisee</div>
              <div style={{ display: "flex", height: "3.4mm", borderRadius: "2mm", overflow: "hidden", background: "#eee" }}>
                <span style={{ width: `${layerPct(energy.direct_auto_kwh)}%`, background: "#d4a82e" }} />
                {hasPhysical ? <span style={{ width: `${layerPct(energy.physical_battery_kwh)}%`, background: "#2f9f5a" }} /> : null}
                <span style={{ width: `${layerPct(energy.vehicle_v2h_kwh)}%`, background: "#5b4cc4" }} />
                {hasVirtual ? <span style={{ width: `${layerPct(energy.virtual_battery_kwh)}%`, background: "#2f83c8" }} /> : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2.8mm", flexShrink: 0, marginTop: "1.3mm" }}>
        <div style={{ padding: "2.5mm 3mm", borderRadius: "3.2mm", background: "rgba(91,76,196,.07)", border: "0.3mm solid rgba(91,76,196,.18)" }}>
          <div style={{ fontSize: "2.8mm", fontWeight: 800, color: "#372c8e", marginBottom: "0.9mm" }}>Mobilite tracee a part</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1.5mm", fontSize: "2.7mm", color: "#444" }}>
            <div><strong>{fmtKwh(energy.trip_consumption_kwh)}</strong><br />trajets</div>
            <div><strong>{fmtKwh(energy.grid_charge_mobility_kwh)}</strong><br />recharge reseau</div>
            <div><strong>{fmtKwh(energy.losses_kwh)}</strong><br />pertes</div>
          </div>
        </div>
        <div style={{ padding: "2.5mm 3mm", borderRadius: "3.2mm", background: "rgba(195,152,71,.08)", border: "0.3mm solid rgba(195,152,71,.2)" }}>
          <div style={{ fontSize: "2.8mm", fontWeight: 800, color: brandHex, marginBottom: "0.8mm" }}>Points de lecture</div>
          <ul style={{ margin: 0, paddingLeft: "3.5mm", fontSize: "2.55mm", lineHeight: 1.32, color: "#555" }}>
            {notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </div>
      </div>
    </PdfPageLayout>
  );
}
