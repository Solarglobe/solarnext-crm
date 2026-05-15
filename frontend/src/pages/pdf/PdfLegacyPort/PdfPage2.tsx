/**
 * CP-PDF — Page 2 Étude financière 25 ans (engine summary, ids p2_* inchangés).
 */
import { useMemo } from "react";
import PdfPageLayout from "../PdfEngine/PdfPageLayout";
import PdfHeader from "../../../components/pdf/PdfHeader";
import { BLOCK_GAP_PX } from "../PdfEngine/pdfLayout";
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

export default function PdfPage2({
  organization = {},
  viewModel,
}: {
  organization?: { id?: string; logo_image_key?: string | null; logo_url?: string | null };
  viewModel?: { meta?: { studyId?: string; versionId?: string } };
}) {
  const logoUrl = useMemo(() => {
    const logoDirect = organization?.logo_url;
    if (logoDirect) return logoDirect;

    const params =
      typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
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
    const hasLogoKey = !!organization?.logo_image_key;

    if (!orgId || !renderToken || !studyId || !versionId || !hasLogoKey) return null;
    return getStorageUrl(orgId, "logo", renderToken, studyId, versionId);
  }, [
    organization?.id,
    organization?.logo_image_key,
    organization?.logo_url,
    viewModel?.meta,
  ]);

  const { brandHex } = usePdfOrgBranding();

  return (
    <PdfPageLayout
      legacyPort={{
        id: "p2",
        dataEngine: "summary",
        sectionGap: "0",
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
                />
              ) : null
            }
            badge="Étude financière 25 ans"
            metaColumn={
              <div
                className="meta-compact"
                id="p2_meta_line"
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
                  <b>Client :</b> <span id="p2_client">—</span>
                </div>
                <div>
                  <b>Réf. :</b> <span id="p2_ref">—</span>
                </div>
                <div>
                  <b>Date :</b> <span id="p2_date">—</span>
                </div>
              </div>
            }
          />
        ),
      }}
    >
      {/* ══════════════════════════════════════════════════════════
          ZONE BLOCS — flex:1 (prend tout l'espace restant)
          3 blocs séparés par BLOCK_GAP_PX = 8 px
         ══════════════════════════════════════════════════════════ */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: BLOCK_GAP_PX,
          overflow: "hidden",
        }}
      >
        {/* ────────────────────────────────────────────────────────
            BLOC 1 — Titre + Hero compact
            (la barre dorée est maintenant un direct child de la section,
             identique à P1 — plus de doublon)
           ──────────────────────────────────────────────────────── */}
        <div style={{ flex: "0 0 auto", overflow: "hidden" }}>
          {/* Titre */}
          <h2
            style={{
              margin: "0 0 2.35mm",
              color: brandHex,
              fontWeight: 700,
              fontSize: "5mm",
              textAlign: "center",
              letterSpacing: "0.02em",
            }}
          >
            Comparatif financier et indicateurs (25 ans)
          </h2>

          {/* Hero compact — id p2_eco_25_hero rempli par engine-p2.js */}
          <div
            className="p2-hero compact"
            style={{
              padding: "2.85mm 3.8mm 3.05mm",
              background: "rgba(195, 152, 71, 0.08)",
              border: "0.3mm solid rgba(195, 152, 71, 0.25)",
              borderRadius: "2.2mm",
              lineHeight: 1.3,
            }}
          >
            <h2
              style={{ margin: 0, fontSize: "3.9mm", fontWeight: 700, color: "#333" }}
            >
              Sur 25 ans, le projet permet d&apos;éviter plus de{" "}
              <strong style={{ color: brandHex }}>
                <span id="p2_eco_25_hero">—</span>
              </strong>{" "}
              de dépenses d&apos;électricité.
            </h2>
            <p style={{ margin: "1.15mm 0 0 0", fontSize: "3.2mm", color: "#555" }}>
              Dont{" "}
              <strong style={{ color: "#2d7a3e" }}>
                <span id="p2_eco_nette_hero">—</span>
              </strong>{" "}
              de gain net après investissement.
            </p>
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────
            BLOC 2 — Section principale : Tableau 70 % | KPI + chart 30 %
            Hauteur : flex 1 (remplit l'espace restant entre blocs 1 et 3)
           ──────────────────────────────────────────────────────── */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            display: "flex",
            gap: "3.5mm",
            alignItems: "stretch",
          }}
        >
          {/* ── COLONNE GAUCHE : occupe l’espace restant après panneau droit (~31 %) ── */}
          <div
            style={{
              flex: "1 1 0",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: "2.35mm",
              minHeight: 0,
              alignSelf: "stretch",
            }}
          >
            {/* Tableau — ids p2_sans_*, p2_avec_*, p2_eco_* */}
            <div
              className="card soft p2-table-wrap"
              style={{
                padding: "2.85mm 3.85mm 3mm",
                background: "rgba(251, 246, 236, 0.6)",
                border: "0.4mm solid rgba(195, 152, 71, 0.25)",
                borderRadius: "2.2mm",
                flex: "0 0 auto",
              }}
            >
              <table
                className="p2-table-compact"
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "3.55mm",
                  lineHeight: 1.32,
                }}
              >
                <thead>
                  <tr className="p2-table-head-row" style={{ color: "#333" }}>
                    <th align="left" style={{ padding: "1.45mm 2mm 1.55mm 0", fontWeight: 700 }}>
                      Année
                    </th>
                    <th align="right" style={{ padding: "1.45mm 2mm 1.55mm", fontWeight: 700 }}>
                      Sans solaire
                    </th>
                    <th
                      align="right"
                      style={{ padding: "1.45mm 2mm 1.55mm", fontWeight: 700, color: brandHex }}
                    >
                      Avec solaire
                    </th>
                    <th
                      align="right"
                      style={{
                        padding: "1.45mm 0 1.55mm 2mm",
                        fontWeight: 700,
                        color: "#2d7a3e",
                      }}
                    >
                      Économie cumulée
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="p2-table-body-row" style={{ borderBottom: "0.12mm solid rgba(0,0,0,0.06)" }}>
                    <td style={{ padding: "1.32mm 2mm 1.32mm 0" }}>5 ans</td>
                    <td
                      id="p2_sans_5"
                      align="right"
                      style={{ padding: "1.32mm 2mm", fontWeight: 600 }}
                    >
                      —
                    </td>
                    <td
                      id="p2_avec_5"
                      align="right"
                      style={{ padding: "1.32mm 2mm", fontWeight: 600, color: brandHex }}
                    >
                      —
                    </td>
                    <td
                      id="p2_eco_5"
                      align="right"
                      style={{ padding: "1.32mm 0 1.32mm 2mm", fontWeight: 600, color: "#2d7a3e" }}
                    >
                      —
                    </td>
                  </tr>
                  <tr className="p2-table-body-row" style={{ borderBottom: "0.12mm solid rgba(0,0,0,0.06)" }}>
                    <td style={{ padding: "1.32mm 2mm 1.32mm 0" }}>10 ans</td>
                    <td
                      id="p2_sans_10"
                      align="right"
                      style={{ padding: "1.32mm 2mm", fontWeight: 600 }}
                    >
                      —
                    </td>
                    <td
                      id="p2_avec_10"
                      align="right"
                      style={{ padding: "1.32mm 2mm", fontWeight: 600, color: brandHex }}
                    >
                      —
                    </td>
                    <td
                      id="p2_eco_10"
                      align="right"
                      style={{ padding: "1.32mm 0 1.32mm 2mm", fontWeight: 600, color: "#2d7a3e" }}
                    >
                      —
                    </td>
                  </tr>
                  <tr className="p2-table-body-row" style={{ borderBottom: "0.12mm solid rgba(0,0,0,0.06)" }}>
                    <td style={{ padding: "1.32mm 2mm 1.32mm 0" }}>15 ans</td>
                    <td
                      id="p2_sans_15"
                      align="right"
                      style={{ padding: "1.32mm 2mm", fontWeight: 600 }}
                    >
                      —
                    </td>
                    <td
                      id="p2_avec_15"
                      align="right"
                      style={{ padding: "1.32mm 2mm", fontWeight: 600, color: brandHex }}
                    >
                      —
                    </td>
                    <td
                      id="p2_eco_15"
                      align="right"
                      style={{ padding: "1.32mm 0 1.32mm 2mm", fontWeight: 600, color: "#2d7a3e" }}
                    >
                      —
                    </td>
                  </tr>
                  <tr className="p2-table-body-row" style={{ borderBottom: "0.12mm solid rgba(0,0,0,0.06)" }}>
                    <td style={{ padding: "1.32mm 2mm 1.32mm 0" }}>20 ans</td>
                    <td
                      id="p2_sans_20"
                      align="right"
                      style={{ padding: "1.32mm 2mm", fontWeight: 600 }}
                    >
                      —
                    </td>
                    <td
                      id="p2_avec_20"
                      align="right"
                      style={{ padding: "1.32mm 2mm", fontWeight: 600, color: brandHex }}
                    >
                      —
                    </td>
                    <td
                      id="p2_eco_20"
                      align="right"
                      style={{ padding: "1.32mm 0 1.32mm 2mm", fontWeight: 600, color: "#2d7a3e" }}
                    >
                      —
                    </td>
                  </tr>
                  <tr
                    className="p2-highlight-row"
                    style={{
                      borderTop: "0.28mm solid rgba(195,152,71,0.45)",
                      background: "rgba(195, 152, 71, 0.07)",
                    }}
                  >
                    <td
                      style={{ padding: "1.42mm 2mm 1.42mm 0", fontWeight: 600 }}
                    >
                      25 ans
                    </td>
                    <td
                      id="p2_sans_25"
                      align="right"
                      style={{ padding: "1.42mm 2mm", fontWeight: 600 }}
                    >
                      —
                    </td>
                    <td
                      id="p2_avec_25"
                      align="right"
                      style={{ padding: "1.42mm 2mm", fontWeight: 600, color: brandHex }}
                    >
                      —
                    </td>
                    <td
                      id="p2_eco_25"
                      align="right"
                      className="p2-highlight-value"
                      style={{ padding: "1.42mm 0 1.42mm 2mm", fontWeight: 600, color: "#2d7a3e" }}
                    >
                      —
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Bloc résumé client — ids p2_summary_roi, p2_summary_eco */}
            <div
              className="p2-summary"
              style={{
                padding: "2.55mm 3.85mm",
                background: "rgba(251, 246, 236, 0.5)",
                border: "0.4mm solid rgba(195, 152, 71, 0.2)",
                borderRadius: "2.2mm",
                flexShrink: 0,
              }}
            >
              <h3
                style={{
                  margin: "0 0 1.25mm",
                  color: brandHex,
                  fontWeight: 600,
                  fontSize: "3.52mm",
                }}
              >
                En résumé, le scénario photovoltaïque :
              </h3>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: "4mm",
                  fontSize: "3.15mm",
                  lineHeight: 1.42,
                  color: "#333",
                }}
              >
                <li style={{ marginBottom: "0.65mm" }}>
                  Réduction durable de la dépendance au réseau électrique
                </li>
                <li style={{ marginBottom: "0.65mm" }}>
                  Amortissement de l&apos;investissement en{" "}
                  <strong id="p2_summary_roi">—</strong>
                </li>
                <li style={{ marginBottom: "0.65mm" }}>
                  Économies cumulées supérieures à{" "}
                  <strong id="p2_summary_eco">—</strong>
                </li>
                <li>Atténuation de l&apos;exposition aux hausses du prix de l&apos;électricité</li>
              </ul>
            </div>

            {/* Bloc pourquoi — compact */}
            <div
              className="card soft p2-why p2-reliability-callout"
              style={{
                padding: "2.45mm 3.85mm 2.65mm",
                marginTop: 0,
                background: "rgba(251, 246, 236, 0.65)",
                border: "0.35mm solid rgba(195, 152, 71, 0.22)",
                borderLeft: `0.7mm solid ${brandHex}`,
                borderRadius: "2.6mm",
                flexShrink: 0,
                boxShadow: "0 0.55mm 1.65mm rgba(15, 23, 42, 0.038)",
              }}
            >
              <h3
                style={{
                  margin: "0 0 1mm",
                  color: brandHex,
                  fontWeight: 700,
                  fontSize: "3.48mm",
                }}
              >
                Pourquoi ces résultats sont fiables
              </h3>
              <ul
                className="p2-reliability-bullets"
                style={{
                  margin: 0,
                  paddingLeft: "3.2mm",
                  fontSize: "3.05mm",
                  lineHeight: 1.3,
                  color: "#444",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  columnGap: "2.8mm",
                  rowGap: "0.3mm",
                  listStylePosition: "outside",
                }}
              >
                <li style={{ margin: 0 }}>
                  Les montants s&apos;appuient sur le profil de consommation du site
                </li>
                <li style={{ margin: 0 }}>
                  L&apos;évolution du prix de l&apos;électricité est intégrée dans les calculs
                </li>
                <li style={{ margin: 0, gridColumn: "1 / -1" }}>
                  Les performances sont estimées sur l&apos;horizon de 25 ans
                </li>
              </ul>
            </div>
          </div>

          {/* ── COLONNE DROITE ~31 % : compromis lisibilité / tenue page ── */}
          <div
            className="p2-right-column"
            style={{
              flex: "0 0 31%",
              width: "31%",
              maxWidth: "31%",
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              alignSelf: "stretch",
              minHeight: 0,
              boxSizing: "border-box",
            }}
          >
            <div
              className="p2-right-impact-panel card soft"
              style={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                gap: "2.05mm",
                width: "100%",
                maxWidth: "100%",
                boxSizing: "border-box",
                padding: "2.85mm 2.65mm 3mm",
                background: "linear-gradient(180deg, rgba(251, 246, 236, 0.72) 0%, rgba(255, 255, 255, 0.96) 45%, #fff 100%)",
                border: "0.4mm solid rgba(195, 152, 71, 0.28)",
                borderRadius: "4.5mm",
                boxShadow: "0 1mm 3.5mm rgba(15, 23, 42, 0.06)",
              }}
            >
              {/* KPI — ids p2_roi, p2_tri, p2_lcoe */}
              <div
                style={{
                  flexShrink: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "1.25mm",
                  width: "100%",
                }}
              >
                <h3
                  style={{
                    margin: 0,
                    color: brandHex,
                    fontWeight: 800,
                    fontSize: "3.4mm",
                    letterSpacing: "0.02em",
                  }}
                >
                  Indicateurs de rentabilité
                </h3>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr",
                    gap: "1.22mm",
                  }}
                >
                  {(
                    [
                      {
                        id: "p2_roi" as const,
                        title: (
                          <>
                            Retour sur investissement{" "}
                            <span style={{ color: "#999", fontWeight: 500 }}>(amortissement)</span>
                          </>
                        ),
                      },
                      {
                        id: "p2_tri" as const,
                        title: (
                          <>
                            TRI <span style={{ color: "#999", fontWeight: 500 }}>(rentabilité annuelle)</span>
                          </>
                        ),
                      },
                      {
                        id: "p2_lcoe" as const,
                        title: (
                          <>
                            LCOE <span style={{ color: "#999", fontWeight: 500 }}>(coût par kWh)</span>
                          </>
                        ),
                      },
                    ] as const
                  ).map((row) => (
                    <div
                      key={row.id}
                      style={{
                        padding: "1.45mm 2.35mm 1.5mm",
                        background: "rgba(251, 246, 236, 0.95)",
                        borderRadius: "2.1mm",
                        borderLeft: `0.48mm solid ${brandHex}`,
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.65)",
                      }}
                    >
                      <div style={{ fontSize: "2.58mm", color: "#5c5c5c", marginBottom: "0.3mm", lineHeight: 1.26 }}>
                        {row.title}
                      </div>
                      <div id={row.id} style={{ fontSize: "3.92mm", fontWeight: 700, color: "#1a1a1a", letterSpacing: "-0.02em" }}>
                        —
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Comparatif barres — ids p2_bar_sans, p2_bar_reduced, p2_bar_avec, p2_bar_eco, p2_bar_pct */}
              <div
                className="p2-bar-chart"
                style={{
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-start",
                  width: "100%",
                  boxSizing: "border-box",
                  marginTop: "0.65mm",
                  paddingTop: "2.15mm",
                  borderTop: "0.35mm solid rgba(195, 152, 71, 0.22)",
                }}
              >
                <div
                  style={{
                    fontSize: "2.9mm",
                    fontWeight: 800,
                    color: "#B08B2E",
                    textAlign: "center",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase" as const,
                    marginBottom: "1.95mm",
                  }}
                >
                  Comparatif facture — 25 ans
                </div>
                <div
                  className="p2-bar-container"
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "center",
                    gap: "4.5mm",
                    width: "100%",
                    flex: "1 1 auto",
                    minHeight: "55mm",
                    height: "56mm",
                    paddingLeft: "0",
                    paddingRight: "0",
                  }}
                >
                  <div
                    className="p2-bar p2-bar-full"
                    style={{
                      flex: "1 1 50%",
                      minWidth: "0",
                      maxWidth: "none",
                      height: "100%",
                      borderRadius: "2.5mm",
                      background: "linear-gradient(180deg, #3d3d3d 0%, #2a2a2a 100%)",
                      boxShadow: "0 0.6mm 2mm rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.08)",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                      alignItems: "center",
                      padding: "2.2mm 1.75mm",
                    }}
                  >
                    <span
                      id="p2_bar_sans"
                      style={{
                        fontSize: "3.65mm",
                        fontWeight: 800,
                        color: "#fff",
                        lineHeight: 1.12,
                        textAlign: "center" as const,
                        textShadow: "0 0.15mm 0.4mm rgba(0,0,0,0.35)",
                      }}
                    >
                      —
                    </span>
                    <label
                      style={{
                        fontSize: "3mm",
                        color: "rgba(255,255,255,0.95)",
                        marginTop: "0.75mm",
                        fontWeight: 800,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase" as const,
                        textAlign: "center" as const,
                      }}
                    >
                      Sans solaire
                    </label>
                  </div>
                  <div
                    id="p2_bar_reduced"
                    className="p2-bar p2-bar-reduced"
                    style={{
                      flex: "1 1 50%",
                      minWidth: "0",
                      maxWidth: "none",
                      height: "50%",
                      borderRadius: "2.5mm",
                      background: `linear-gradient(180deg, color-mix(in srgb, ${brandHex} 78%, #ffffff) 0%, ${brandHex} 45%, color-mix(in srgb, ${brandHex} 55%, #000000) 100%)`,
                      boxShadow: "0 0.6mm 2.2mm rgba(195, 152, 71, 0.35), inset 0 1px 0 rgba(255,255,255,0.35)",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                      alignItems: "center",
                      padding: "2.2mm 1.75mm",
                    }}
                  >
                    <span
                      id="p2_bar_avec"
                      style={{
                        fontSize: "3.65mm",
                        fontWeight: 800,
                        color: "#fff",
                        lineHeight: 1.12,
                        textAlign: "center" as const,
                        textShadow: "0 0.15mm 0.45mm rgba(0,0,0,0.2)",
                      }}
                    >
                      —
                    </span>
                    <label
                      style={{
                        fontSize: "3mm",
                        color: "rgba(255,255,255,0.98)",
                        marginTop: "0.75mm",
                        fontWeight: 800,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase" as const,
                        textAlign: "center" as const,
                      }}
                    >
                      Avec solaire
                    </label>
                  </div>
                </div>
                <div
                  className="p2-bar-footer"
                  style={{
                    textAlign: "center",
                    marginTop: "2.4mm",
                    paddingTop: "1.8mm",
                    borderTop: "0.25mm solid rgba(45, 122, 62, 0.2)",
                    fontSize: "3.45mm",
                    color: "#1f5c32",
                    fontWeight: 800,
                  }}
                >
                  Économie :{" "}
                  <strong id="p2_bar_eco" style={{ fontWeight: 900, color: "#166534" }}>
                    —
                  </strong>
                  <span
                    style={{
                      display: "block",
                      fontSize: "3.05mm",
                      color: "#444",
                      fontWeight: 700,
                      marginTop: "0.65mm",
                    }}
                  >
                    ≈ <span id="p2_bar_pct">—</span> % d&apos;économie
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────
            BLOC 3 — Bandeau récapitulatif + note de bas de page
            Hauteur : auto (contenu détermine la taille)
           ──────────────────────────────────────────────────────── */}
        <div style={{ flex: "0 0 auto", overflow: "hidden" }}>
          {/* Bandeau — ids p2_prime, p2_reste_charge, p2_production */}
          <div
            className="p2-bandeau"
            style={{
              display: "flex",
              gap: "3.5mm",
              padding: "2.6mm 3.4mm",
              background: "#f8f8f8",
              borderRadius: "2mm",
              border: "0.2mm solid #eee",
              fontSize: "3.15mm",
              color: "#444",
              alignItems: "center",
            }}
          >
            <div
              style={{ flex: 1, whiteSpace: "nowrap" as const, overflow: "hidden" }}
            >
              <span
                className="p2-label"
                style={{
                  fontSize: "2.75mm",
                  color: "#777",
                  marginRight: "0.85mm",
                  fontWeight: 600,
                }}
              >
                Aide État
              </span>
              <span style={{ color: "#666", fontWeight: 500 }}>Prime</span>
              <span
                id="p2_prime"
                style={{
                  marginLeft: "0.85mm",
                  fontWeight: 800,
                  fontSize: "3.45mm",
                  color: "#1a1a1a",
                  letterSpacing: "-0.02em",
                }}
              >
                —
              </span>
            </div>
            <div
              style={{ flex: 1, whiteSpace: "nowrap" as const, overflow: "hidden" }}
            >
              <span
                className="p2-label"
                style={{
                  fontSize: "2.75mm",
                  color: "#777",
                  marginRight: "0.85mm",
                  fontWeight: 600,
                }}
              >
                Investissement
              </span>
              <span style={{ color: "#666", fontWeight: 500 }}>Reste à charge</span>
              <span
                id="p2_reste_charge"
                style={{
                  marginLeft: "0.85mm",
                  fontWeight: 800,
                  fontSize: "3.45mm",
                  color: "#1a1a1a",
                  letterSpacing: "-0.02em",
                }}
              >
                —
              </span>
            </div>
            <div
              style={{ flex: 1, whiteSpace: "nowrap" as const, overflow: "hidden" }}
            >
              <span
                className="p2-label"
                style={{
                  fontSize: "2.75mm",
                  color: "#777",
                  marginRight: "0.85mm",
                  fontWeight: 600,
                }}
              >
                Énergie
              </span>
              <span style={{ color: "#666", fontWeight: 500 }}>Production</span>
              <span
                id="p2_production"
                style={{
                  marginLeft: "0.85mm",
                  fontWeight: 800,
                  fontSize: "3.45mm",
                  color: "#1a1a1a",
                  letterSpacing: "-0.02em",
                }}
              >
                —
              </span>
            </div>
          </div>

          {/* Note de bas de page */}
          <p
            style={{
              margin: "1.5mm 0 0 0",
              fontSize: "2.35mm",
              color: "#999",
              lineHeight: 1.3,
              textAlign: "center",
            }}
          >
            Ces montants s&apos;appuient sur la production solaire estimée pour le projet.
            Le détail technique est développé dans la suite du dossier.
          </p>
        </div>
      </div>
    </PdfPageLayout>
  );
}
