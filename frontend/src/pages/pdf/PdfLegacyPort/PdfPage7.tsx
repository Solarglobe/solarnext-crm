/**
 * CP-PDF — Page 7 Autonomie et flux énergie
 * Page commerciale de synthèse : compréhension immédiate des flux.
 * Rendu React pur (données via fullReport.p7), aligné P4/P5/P6.
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

interface P7Data {
  meta?: { client?: string; ref?: string; date?: string; date_display?: string; scenario_label?: string };
  pct?: {
    c_pv_pct?: number;
    c_bat_pct?: number;
    c_grid_pct?: number;
    p_auto_pct?: number;
    p_bat_pct?: number;
    p_surplus_pct?: number;
  };
  c_grid?: number;
  p_surplus?: number;
  consumption_kwh?: number;
  autoconsumption_kwh?: number;
  production_kwh?: number;
}

const EMPTY = "—";

function fmt(v: unknown): string {
  if (v == null || v === "") return EMPTY;
  return String(v);
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return EMPTY;
  return `${Math.round(v)} %`;
}

function fmtKwh(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return EMPTY;
  return `${Math.round(v).toLocaleString("fr-FR")} kWh`;
}

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Arrondis pill premium : effet capsule très visible */
const PILL_RADIUS = "10mm";
const PILL_RADIUS_SOFT = "2.5mm";

function getSegmentRadius(isFirst: boolean, isLast: boolean, isOnly: boolean): string {
  if (isOnly) return PILL_RADIUS;
  if (isFirst) return `${PILL_RADIUS} ${PILL_RADIUS_SOFT} ${PILL_RADIUS_SOFT} ${PILL_RADIUS}`;
  if (isLast) return `${PILL_RADIUS_SOFT} ${PILL_RADIUS} ${PILL_RADIUS} ${PILL_RADIUS_SOFT}`;
  return PILL_RADIUS_SOFT;
}

export default function PdfPage7({
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

  const fr = (viewModel?.fullReport ?? {}) as Record<string, unknown>;
  const p7 = (fr.p7 ?? {}) as P7Data;

  const meta = p7.meta ?? {};
  const pct = p7.pct ?? {};
  const cPv = safeNum(pct.c_pv_pct);
  const cBat = safeNum(pct.c_bat_pct);
  const cGrid = safeNum(pct.c_grid_pct);
  const pAuto = safeNum(pct.p_auto_pct);
  const pBat = safeNum(pct.p_bat_pct);
  const pSurplusPct = safeNum(pct.p_surplus_pct);
  const pSurplusKwh = p7.p_surplus ?? 0;
  const consoKwh = p7.consumption_kwh ?? 0;
  const autoKwh = p7.autoconsumption_kwh ?? 0;
  const prodKwh = p7.production_kwh ?? 0;

  const autonomie = cPv + cBat;
  const autoconsommation = pAuto + pBat;
  const gridKwh = p7.c_grid ?? 0;

  const hasData = autonomie > 0 || cGrid > 0 || pSurplusPct > 0 || autoconsommation > 0;

  return (
    <PdfPageLayout
      legacyPort={{
        id: "p7",
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
            badge="Autonomie et flux énergie"
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
                  <b>Client</b> : {fmt(meta.client)}
                </div>
                <div>
                  <b>Réf.</b> : {fmt(meta.ref)}
                </div>
                <div>
                  <b>Date</b> : {fmt(meta.date_display ?? meta.date)}
                </div>
              </div>
            }
          />
        ),
      }}
    >
      {/* Accroche — volontairement discrète (le schéma porte la page, pas P6) */}
      <p
        style={{
          margin: "0 0 1.5mm 0",
          fontSize: "3.2mm",
          lineHeight: 1.38,
          color: "#555",
          flexShrink: 0,
        }}
      >
        Flux d&apos;énergie : d&apos;où provient l&apos;électricité consommée, et comment la production PV est répartie.
      </p>

      {hasData ? (
        <>
          {/* Visuel principal — bandes empilées (différencié de la courbe P6) */}
          <div className="card soft p7-flux-hero">
            <div
              style={{
                marginBottom: "2.4mm",
                paddingBottom: "1.45mm",
                borderBottom: "0.25mm solid rgba(195, 152, 71, 0.18)",
              }}
            >
              <span
                style={{
                  fontSize: "2.5mm",
                  fontWeight: 800,
                  color: "#B08B2E",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase" as const,
                }}
              >
                Année type
              </span>
              <span style={{ color: "rgba(195,152,71,0.5)", margin: "0 1.5mm", fontWeight: 600 }}>·</span>
              <span style={{ fontSize: "3.5mm", fontWeight: 800, color: "#2d2d2d", letterSpacing: "-0.02em" }}>
                Répartition des flux d&apos;énergie
              </span>
            </div>
            {/* Barre 1 — Consommation du site */}
            <div style={{ marginBottom: "3.5mm" }}>
              <div style={{ fontWeight: 700, color: "#2d2d2d", marginBottom: "1.35mm", fontSize: "3.4mm" }}>
                Consommation du site
              </div>
              <div style={{ display: "flex", height: "10mm", borderRadius: PILL_RADIUS, overflow: "hidden", boxShadow: "0 0.5mm 2mm rgba(0,0,0,.08) inset, 0 0.3mm 1mm rgba(0,0,0,.04)" }}>
                {(() => {
                  const segs = [
                    cPv >= 2 && { flex: cPv, label: cPv >= 5 ? `${cPv} % Utilisé` : `${cPv} %`, bg: "linear-gradient(135deg, #F0D060 0%, #E5B83D 50%, #D4A82E 100%)", color: "#1a1508", shadow: "0 0.2mm 0.4mm rgba(255,255,255,.4)" },
                    cBat >= 2 && { flex: cBat, label: cBat >= 5 ? `${cBat} % Batterie` : `${cBat} %`, bg: "linear-gradient(135deg, #7ED99E 0%, #5BC47A 50%, #3DA85C 100%)", color: "#0d2514", shadow: "0 0.2mm 0.4mm rgba(255,255,255,.3)" },
                    cGrid >= 2 && { flex: cGrid, label: cGrid >= 5 ? `${cGrid} % Réseau` : `${cGrid} %`, bg: "linear-gradient(135deg, #A89BE8 0%, #8B7BD4 50%, #6B5BB8 100%)", color: "#fff", shadow: "0 0.2mm 0.6mm rgba(0,0,0,.25)" },
                  ].filter(Boolean) as { flex: number; label: string; bg: string; color: string; shadow: string }[];
                  const n = segs.length;
                  return segs.map((s, i) => (
                    <div
                      key={i}
                      style={{
                        flex: `${s.flex}% 0 0`,
                        background: s.bg,
                        display: "flex",
                        alignItems: "center",
                        fontWeight: 700,
                        fontSize: "3.2mm",
                        color: s.color,
                        textShadow: s.shadow,
                        boxShadow: "0.2mm 0 0.5mm rgba(0,0,0,.06) inset",
                        borderRadius: getSegmentRadius(i === 0, i === n - 1, n === 1),
                        paddingLeft: i === 0 ? "2.2mm" : "0.8mm",
                        paddingRight: i === n - 1 ? "2.2mm" : "0.8mm",
                        boxSizing: "border-box",
                        minWidth: 0,
                      }}
                    >
                      {s.label}
                    </div>
                  ));
                })()}
              </div>
            </div>

            {/* Barre 2 — Production PV */}
            <div>
              <div style={{ fontWeight: 700, color: "#2d2d2d", marginBottom: "1.35mm", fontSize: "3.4mm" }}>
                Production PV
              </div>
              <div style={{ display: "flex", height: "10mm", borderRadius: PILL_RADIUS, overflow: "hidden", boxShadow: "0 0.5mm 2mm rgba(0,0,0,.08) inset, 0 0.3mm 1mm rgba(0,0,0,.04)" }}>
                {(() => {
                  const segs = [
                    pAuto >= 2 && { flex: pAuto, label: pAuto >= 5 ? `${pAuto} % Autoconsommation` : `${pAuto} %`, bg: "linear-gradient(135deg, #7DD4ED 0%, #5BC4E0 50%, #3BA8C8 100%)", color: "#0a2a32", shadow: "0 0.2mm 0.4mm rgba(255,255,255,.4)" },
                    pBat >= 2 && { flex: pBat, label: pBat >= 5 ? `${pBat} % Batterie` : `${pBat} %`, bg: "linear-gradient(135deg, #7ED99E 0%, #5BC47A 50%, #3DA85C 100%)", color: "#0d2514", shadow: "0 0.2mm 0.4mm rgba(255,255,255,.3)" },
                    pSurplusPct >= 2 && { flex: pSurplusPct, label: pSurplusPct >= 5 ? `${pSurplusPct} % Surplus` : `${pSurplusPct} %`, bg: "linear-gradient(135deg, #5BA8E0 0%, #3D8FCC 50%, #2570B0 100%)", color: "#fff", shadow: "0 0.2mm 0.6mm rgba(0,0,0,.3)" },
                  ].filter(Boolean) as { flex: number; label: string; bg: string; color: string; shadow: string }[];
                  const n = segs.length;
                  return segs.map((s, i) => (
                    <div
                      key={i}
                      style={{
                        flex: `${s.flex}% 0 0`,
                        background: s.bg,
                        display: "flex",
                        alignItems: "center",
                        fontWeight: 700,
                        fontSize: "3.2mm",
                        color: s.color,
                        textShadow: s.shadow,
                        boxShadow: "0.2mm 0 0.5mm rgba(0,0,0,.06) inset",
                        borderRadius: getSegmentRadius(i === 0, i === n - 1, n === 1),
                        paddingLeft: i === 0 ? "2.2mm" : "0.8mm",
                        paddingRight: i === n - 1 ? "2.2mm" : "0.8mm",
                        boxSizing: "border-box",
                        minWidth: 0,
                      }}
                    >
                      {s.label}
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>

          {/* 3 KPI — chiffres dominants, sous-textes discrets */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "3.1mm",
              marginTop: "0.35mm",
              flexShrink: 0,
            }}
          >
            <div
              className="card soft"
              style={{
                padding: "3.6mm 3.3mm",
                border: "0.4mm solid rgba(195,152,71,.28)",
                borderRadius: "4.2mm",
                background: "linear-gradient(180deg, rgba(195,152,71,.06), #fdfcf9)",
                boxShadow: "0 0.75mm 2.2mm rgba(0,0,0,.04)",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: "1.15mm", fontSize: "3.2mm", color: "#C39847" }}>
                Autoconsommation
              </div>
              <div style={{ fontSize: "7mm", lineHeight: 1, fontWeight: 800, color: "#1a1a1a", letterSpacing: "-0.02em" }}>
                {fmtPct(autoconsommation)}
              </div>
              <div style={{ fontSize: "2.7mm", color: "#666", marginTop: "0.6mm", lineHeight: 1.25 }}>
                Production utilisée sur place
              </div>
            </div>

            <div
              className="card soft"
              style={{
                padding: "3.6mm 3.3mm",
                border: "0.4mm solid rgba(195,152,71,.28)",
                borderRadius: "4.2mm",
                background: "linear-gradient(180deg, rgba(195,152,71,.06), #fdfcf9)",
                boxShadow: "0 0.75mm 2.2mm rgba(0,0,0,.04)",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: "1.15mm", fontSize: "3.2mm", color: "#C39847" }}>
                Autonomie
              </div>
              <div style={{ fontSize: "7mm", lineHeight: 1, fontWeight: 800, color: "#1a1a1a", letterSpacing: "-0.02em" }}>
                {fmtPct(autonomie)}
              </div>
              <div style={{ fontSize: "2.7mm", color: "#666", marginTop: "0.6mm", lineHeight: 1.25 }}>
                Besoins couverts sans réseau
              </div>
            </div>

            <div
              className="card soft"
              style={{
                padding: "3.6mm 3.3mm",
                border: "0.4mm solid rgba(195,152,71,.28)",
                borderRadius: "4.2mm",
                background: "linear-gradient(180deg, rgba(195,152,71,.06), #fdfcf9)",
                boxShadow: "0 0.75mm 2.2mm rgba(0,0,0,.04)",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: "1.15mm", fontSize: "3.2mm", color: "#C39847" }}>
                Surplus injecté
              </div>
              <div style={{ fontSize: "7mm", lineHeight: 1, fontWeight: 800, color: "#1a1a1a", letterSpacing: "-0.02em" }}>
                {fmtPct(pSurplusPct)}
              </div>
              <div style={{ fontSize: "2.7mm", color: "#666", marginTop: "0.6mm", lineHeight: 1.25 }}>
                {pSurplusKwh > 0 ? fmtKwh(pSurplusKwh) : "Énergie réinjectée"}
              </div>
            </div>
          </div>

          {/* Chiffres annuels — même contenu, mise en page plus aérée */}
          <div
            className="card soft p7-annual-synth"
            style={{
              padding: "3.1mm 4.3mm",
              border: "0.4mm solid rgba(195,152,71,.28)",
              borderRadius: "4.2mm",
              marginTop: "1.35mm",
              flexShrink: 0,
              background: "rgba(255, 253, 248, 0.58)",
            }}
          >
            {consoKwh > 0 || prodKwh > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4.5mm", alignItems: "stretch" }}>
                {/* Colonne gauche — Consommation annuelle */}
                <div style={{ display: "flex", flexDirection: "column", gap: "1mm" }}>
                  <div style={{ fontWeight: 700, marginBottom: "0.25mm", fontSize: "3.2mm", color: "#C39847" }}>
                    Consommation annuelle
                  </div>
                  <div style={{ fontSize: "3.12mm", color: "#444", lineHeight: 1.42 }}>
                    <div style={{ fontWeight: 600, marginBottom: "1.1mm" }}>{fmtKwh(consoKwh)} consommés par an</div>
                    <div>• {fmtKwh(autoKwh)} couverts sans achat au réseau</div>
                    <div>• {fmtKwh(gridKwh)} fournis par le réseau</div>
                  </div>
                </div>
                {/* Colonne droite — Production annuelle */}
                <div style={{ display: "flex", flexDirection: "column", gap: "1mm", borderLeft: "0.3mm solid rgba(195,152,71,.2)", paddingLeft: "4mm" }}>
                  <div style={{ fontWeight: 700, marginBottom: "0.25mm", fontSize: "3.2mm", color: "#C39847" }}>
                    Production annuelle
                  </div>
                  <div style={{ fontSize: "3.12mm", color: "#444", lineHeight: 1.42 }}>
                    <div style={{ fontWeight: 600, marginBottom: "1.1mm" }}>{fmtKwh(prodKwh)} produits par an</div>
                    <div>• {fmtKwh(autoKwh)} consommés sur place</div>
                    <div>• {fmtKwh(pSurplusKwh)} injectés sur le réseau</div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: "3.2mm", color: "#666", textAlign: "center", padding: "2mm 0" }}>
                Données kWh non disponibles pour cette étude.
              </div>
            )}
          </div>

          {/* Lecture guidée — liste numérotée + schéma d&apos;appui (pas un second paragraphe P6) */}
          <div
            className="card soft p7-lecture-card"
            style={{
              padding: "3mm 4.2mm 3.15mm",
              borderRadius: "4.2mm",
              marginTop: "1.35mm",
              flexShrink: 0,
              boxShadow: "0 0.6mm 1.8mm rgba(15, 23, 42, 0.038)",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.18fr 0.72fr",
                gap: "3.5mm",
                alignItems: "start",
                minHeight: "0",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-start" }}>
                <div style={{ fontWeight: 700, marginBottom: "1mm", fontSize: "3.28mm", color: "#C39847" }}>
                  Lecture du bilan énergétique
                </div>
                <p style={{ margin: "0 0 1mm 0", fontSize: "3.05mm", color: "#444", lineHeight: 1.44 }}>
                  Le générateur couvre une part significative de l&apos;électricité consommée sur le site.
                </p>
                <ol className="p7-lecture-steps p7-lecture-steps--compact">
                  <li>une part de la production est consommée directement sur site</li>
                  <li>le complément est assuré par le réseau selon les périodes</li>
                  <li>le surplus est injecté et valorisé selon les conditions du dossier</li>
                </ol>
                <p style={{ margin: "1mm 0 0 0", fontSize: "3mm", color: "#B08B2E", lineHeight: 1.42, fontWeight: 600 }}>
                  → niveau de production cohérent, avec marge d&apos;optimisation de l&apos;autoconsommation.
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  gap: "0.85mm",
                }}
              >
                <div
                  style={{
                    width: "100%",
                    maxWidth: "27mm",
                    padding: "2.35mm 2.65mm",
                    background: "linear-gradient(135deg, #F0D060 0%, #E5B83D 50%, #D4A82E 100%)",
                    borderRadius: "3.3mm",
                    textAlign: "center",
                    fontSize: "2.75mm",
                    fontWeight: 700,
                    color: "#1a1508",
                    boxShadow: "0 0.4mm 1.1mm rgba(0,0,0,.09)",
                  }}
                >
                  Production solaire
                </div>
                <div style={{ fontSize: "3mm", color: "#888", lineHeight: 1 }}>↓</div>
                <div
                  style={{
                    width: "100%",
                    maxWidth: "27mm",
                    padding: "2.35mm 2.65mm",
                    background: "linear-gradient(135deg, #5BC4E0 0%, #3BA8C8 50%, #2A8BA8 100%)",
                    borderRadius: "3.3mm",
                    textAlign: "center",
                    fontSize: "2.75mm",
                    fontWeight: 700,
                    color: "#fff",
                    textShadow: "0 0.2mm 0.4mm rgba(0,0,0,.2)",
                    boxShadow: "0 0.4mm 1.1mm rgba(0,0,0,.09)",
                  }}
                >
                  Site
                </div>
                <div style={{ fontSize: "3mm", color: "#888", lineHeight: 1 }}>↓</div>
                <div
                  style={{
                    width: "100%",
                    maxWidth: "27mm",
                    padding: "2.35mm 2.65mm",
                    background: "linear-gradient(135deg, #A89BE8 0%, #8B7BD4 50%, #6B5BB8 100%)",
                    borderRadius: "3.3mm",
                    textAlign: "center",
                    fontSize: "2.75mm",
                    fontWeight: 700,
                    color: "#fff",
                    textShadow: "0 0.2mm 0.4mm rgba(0,0,0,.25)",
                    boxShadow: "0 0.4mm 1.1mm rgba(0,0,0,.09)",
                  }}
                >
                  Réseau
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        /* État vide — fallback propre */
        <div
          className="card soft"
          style={{
            padding: "8mm",
            border: "0.5mm solid rgba(195,152,71,.25)",
            borderRadius: "5mm",
            textAlign: "center",
            color: "#666",
            fontSize: "3.6mm",
          }}
        >
          Les données de flux ne sont pas disponibles pour cette étude.
        </div>
      )}
    </PdfPageLayout>
  );
}
