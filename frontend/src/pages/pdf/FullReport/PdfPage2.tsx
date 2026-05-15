/**
 * Page 2 — Étude financière 25 ans
 *
 * ARCHITECTURE : PdfPageLayout (3 blocs)
 *  ┌─────────────────────────────────────────────────────┐
 *  │  HEADER  — "Étude financière 25 ans"                │
 *  ├──────────────────────────────────────────────────────┤
 *  │  BLOC 1 (ratio 1) — Texte introductif               │
 *  ├──────────────────────────────────────────────────────┤
 *  │  BLOC 2 (ratio 4) — Graphique Line chart 25 ans     │
 *  ├──────────────────────────────────────────────────────┤
 *  │  BLOC 3 (ratio 2) — Grille KPI (TRI, ROI, LCOE…)   │
 *  └──────────────────────────────────────────────────────┘
 *
 * Migration depuis l'ancien PdfPage2 :
 *  - Suppression de .pdf-page / .pdf-title / .pdf-meta manuels
 *  - Header unifié via PdfPageLayout
 *  - Hauteurs automatiques via blockRatios=[1,4,2]
 */

import PdfPageLayout, { PdfBlock } from "../PdfEngine/PdfPageLayout";
import PdfKpiGrid, { KpiItem } from "../PdfEngine/PdfKpiGrid";
import { COLORS, FONT, PdfMeta, fmt } from "../PdfEngine/pdfLayout";
import ChartP2 from "./components/ChartP2";

interface P2Data {
  p2_auto?: Record<string, unknown>;
}

export default function PdfPage2({
  data,
  pageNumber,
  totalPages,
}: {
  data?: P2Data;
  pageNumber?: number;
  totalPages?: number;
}) {
  const a = data?.p2_auto ?? {};
  const hy =
    typeof a.horizonYears === "number" && Number.isFinite(a.horizonYears) && a.horizonYears > 0
      ? Math.floor(a.horizonYears)
      : 25;
  const titleFinance = `Étude financière (${hy} ans)`;
  const chartTitle = `Évolution financière sur ${hy} ans`;

  const meta: PdfMeta = {
    client: fmt(a.p2_client),
    ref: fmt(a.p2_ref),
    date: fmt(a.p2_date),
  };

  // KPI grid
  const kpis: KpiItem[] = [
    { label: "TRI",            value: fmt(a.p2_k_tri),      unit: "%",   accent: true },
    { label: "ROI",            value: fmt(a.p2_k_roi) },
    { label: "LCOE",           value: fmt(a.p2_k_lcoe),     unit: "€/kWh" },
    { label: `Économie (${hy} ans)`, value: fmt(a.p2_k_economie25), unit: "€" },
    { label: "Gains",          value: fmt(a.p2_k_gains),    unit: "€",   accent: true },
    { label: "Reste à charge", value: fmt(a.p2_k_reste),    unit: "€" },
  ];

  return (
    <PdfPageLayout
      title={titleFinance}
      meta={meta}
      pageNumber={pageNumber}
      totalPages={totalPages}
      blockRatios={[1, 4, 2]}
      className="pdf-engine-page"
    >
      {/* ── BLOC 1 : Texte introductif ── */}
      <PdfBlock>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {a.p2_s1 != null && String(a.p2_s1).trim() !== "" ? (
            <p style={{ margin: 0, fontFamily: FONT.family, fontSize: FONT.sizeSmall, color: COLORS.textSecond, lineHeight: 1.4 }}>
              {fmt(a.p2_s1)}
            </p>
          ) : null}
          {a.p2_s2 != null && String(a.p2_s2).trim() !== "" ? (
            <p style={{ margin: 0, fontFamily: FONT.family, fontSize: FONT.sizeSmall, color: COLORS.textSecond, lineHeight: 1.4 }}>
              {fmt(a.p2_s2)}
            </p>
          ) : null}
          {a.p2_s3 != null && String(a.p2_s3).trim() !== "" ? (
            <p style={{ margin: 0, fontFamily: FONT.family, fontSize: "8pt", color: COLORS.textSecond, fontStyle: "italic", lineHeight: 1.3 }}>
              {fmt(a.p2_s3)}
            </p>
          ) : null}
        </div>
      </PdfBlock>

      {/* ── BLOC 2 : Graphique ── */}
      <PdfBlock title={chartTitle}>
        <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
          <ChartP2
            labels={(a.p2_chart_labels as string[]) ?? []}
            sans={(a.p2_chart_sans as number[]) ?? []}
            avec={(a.p2_chart_avec as number[]) ?? []}
          />
        </div>
      </PdfBlock>

      {/* ── BLOC 3 : KPI ── */}
      <PdfBlock>
        <PdfKpiGrid items={kpis} columns={6} />
      </PdfBlock>
    </PdfPageLayout>
  );
}
