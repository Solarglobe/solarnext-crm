/**
 * Page 4 — Production & Consommation
 *
 * ARCHITECTURE : PdfPageLayout (3 blocs)
 *  ┌──────────────────────────────────────────────────────┐
 *  │  HEADER — "Production & Consommation"                │
 *  ├──────────────────────────────────────────────────────┤
 *  │  BLOC 1 (ratio 5) — Graphique barres 12 mois         │
 *  ├──────────────────────────────────────────────────────┤
 *  │  BLOC 2 (ratio 2) — Tableau des totaux annuels       │
 *  └──────────────────────────────────────────────────────┘
 *
 * Migration depuis l'ancien PdfPage4 :
 *  - Plus de .pdf-page / .pdf-title / .pdf-meta manuels
 *  - Header unifié via PdfPageLayout
 *  - Hauteurs automatiques via blockRatios=[5,2]
 */

import PdfPageLayout, { PdfBlock } from "../PdfEngine/PdfPageLayout";
import PdfTable, { TableRow } from "../PdfEngine/PdfTable";
import { PdfMeta } from "../PdfEngine/pdfLayout";
import ChartP4 from "./components/ChartP4";

interface P4Data {
  meta?: Record<string, unknown>;
  production_kwh?: number[];
  consommation_kwh?: number[];
  autoconso_kwh?: number[];
  batterie_kwh?: number[];
}

export default function PdfPage4({
  data,
  pageNumber,
  totalPages,
}: {
  data?: P4Data;
  pageNumber?: number;
  totalPages?: number;
}) {
  const meta: PdfMeta = {
    client: data?.meta?.client as string | undefined,
    ref:    data?.meta?.ref    as string | undefined,
    date:   data?.meta?.date   as string | undefined,
  };

  const prod  = data?.production_kwh    ?? [];
  const conso = data?.consommation_kwh  ?? [];
  const auto  = data?.autoconso_kwh     ?? [];
  const batt  = data?.batterie_kwh      ?? [];

  const totProd  = prod.reduce((a, b) => a + b, 0);
  const totConso = conso.reduce((a, b) => a + b, 0);
  const totAuto  = auto.reduce((a, b) => a + b, 0);
  const totBatt  = batt.reduce((a, b) => a + b, 0);

  const tableRows: TableRow[] = [
    { label: "Production annuelle",  value: `${totProd.toLocaleString("fr-FR")} kWh`,  bold: true, accent: true },
    { label: "Consommation",         value: `${totConso.toLocaleString("fr-FR")} kWh` },
    { label: "Autoconsommation",     value: `${totAuto.toLocaleString("fr-FR")} kWh`,  bold: true },
    { label: "Énergie batterie",     value: `${totBatt.toLocaleString("fr-FR")} kWh` },
  ];

  return (
    <PdfPageLayout
      title="Production & Consommation"
      meta={meta}
      pageNumber={pageNumber}
      totalPages={totalPages}
      blockRatios={[5, 2]}
      className="pdf-engine-page"
    >
      {/* ── BLOC 1 : Graphique 12 mois ── */}
      <PdfBlock title="Données mensuelles (kWh)">
        <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
          <ChartP4
            production={prod}
            consommation={conso}
            autoconso={auto}
            batterie={batt}
          />
        </div>
      </PdfBlock>

      {/* ── BLOC 2 : Totaux annuels ── */}
      <PdfBlock title="Bilan annuel">
        <PdfTable rows={tableRows} leftWidth="65%" />
      </PdfBlock>
    </PdfPageLayout>
  );
}
