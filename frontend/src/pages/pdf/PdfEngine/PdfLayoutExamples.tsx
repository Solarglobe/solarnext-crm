/**
 * PdfLayoutExamples.tsx — Démo des 3 configurations de layout
 *
 * Ce fichier sert de RÉFÉRENCE et de TEST VISUEL.
 * Il montre exactement comment utiliser PdfPageLayout avec 2, 3 et 4 blocs,
 * avec des ratios égaux et des ratios personnalisés.
 *
 * Usage en développement :
 *   Ajouter temporairement <PdfLayoutExamples /> dans le pdf-render pour
 *   vérifier visuellement l'alignement avant de brancher les vraies données.
 */

import React from "react";
import PdfPageLayout, { PdfBlock } from "./PdfPageLayout";
import PdfKpiGrid from "./PdfKpiGrid";
import { COLORS, FONT } from "./pdfLayout";

// ─────────────────────────────────────────────────────────────────
// Composant de placeholder pour visualiser un bloc
// ─────────────────────────────────────────────────────────────────
function PlaceholderContent({
  label,
  color = COLORS.borderSoft,
}: {
  label: string;
  color?: string;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: `2px dashed ${color}`,
        borderRadius: 6,
        fontFamily: FONT.family,
        fontSize: FONT.sizeSmall,
        color: COLORS.textSecond,
        opacity: 0.7,
      }}
    >
      {label}
    </div>
  );
}

const DEMO_META = { client: "Dupont Jean", ref: "REF-2026-001", date: "24/03/2026" };

// ─────────────────────────────────────────────────────────────────
// EXEMPLE 1 : 2 blocs — ratio égal [1, 1]
// ─────────────────────────────────────────────────────────────────
export function Example2Blocs() {
  return (
    <PdfPageLayout
      title="Exemple — 2 blocs égaux"
      meta={DEMO_META}
      pageNumber={1}
      totalPages={3}
      className="pdf-engine-page"
    >
      <PdfBlock title="Bloc 1 — Graphique principal">
        <PlaceholderContent label="Graphique (50% de la zone)" color={COLORS.accentGold} />
      </PdfBlock>

      <PdfBlock title="Bloc 2 — Tableau récapitulatif">
        <PlaceholderContent label="Tableau (50% de la zone)" />
      </PdfBlock>
    </PdfPageLayout>
  );
}

// ─────────────────────────────────────────────────────────────────
// EXEMPLE 2 : 3 blocs — ratio [1, 3, 2]
// ─────────────────────────────────────────────────────────────────
export function Example3Blocs() {
  return (
    <PdfPageLayout
      title="Exemple — 3 blocs (ratio 1:3:2)"
      meta={DEMO_META}
      pageNumber={2}
      totalPages={3}
      blockRatios={[1, 3, 2]}
      className="pdf-engine-page"
    >
      <PdfBlock title="Bloc 1 — Intro (ratio 1)">
        <PlaceholderContent label="Texte introductif (~107px)" />
      </PdfBlock>

      <PdfBlock title="Bloc 2 — Graphique (ratio 3)" accent>
        <PlaceholderContent label="Graphique principal (~320px)" color={COLORS.accentGold} />
      </PdfBlock>

      <PdfBlock title="Bloc 3 — KPI (ratio 2)">
        <PdfKpiGrid
          items={[
            { label: "TRI",     value: "8.4 %",     accent: true },
            { label: "ROI",     value: "12 ans" },
            { label: "LCOE",    value: "0.09 €/kWh" },
            { label: "Gains",   value: "42 000 €",  accent: true },
          ]}
        />
      </PdfBlock>
    </PdfPageLayout>
  );
}

// ─────────────────────────────────────────────────────────────────
// EXEMPLE 3 : 4 blocs — ratio [2, 2, 1, 1]
// ─────────────────────────────────────────────────────────────────
export function Example4Blocs() {
  return (
    <PdfPageLayout
      title="Exemple — 4 blocs (ratio 2:2:1:1)"
      meta={DEMO_META}
      pageNumber={3}
      totalPages={3}
      blockRatios={[2, 2, 1, 1]}
      className="pdf-engine-page"
    >
      <PdfBlock title="Bloc 1 — Chart gauche (ratio 2)">
        <PlaceholderContent label="Graphique A" color={COLORS.accentGold} />
      </PdfBlock>

      <PdfBlock title="Bloc 2 — Chart droite (ratio 2)" accent>
        <PlaceholderContent label="Graphique B" color={COLORS.accentGold} />
      </PdfBlock>

      <PdfBlock title="Bloc 3 — Tableau (ratio 1)">
        <PlaceholderContent label="Tableau synthèse" />
      </PdfBlock>

      <PdfBlock title="Bloc 4 — Note (ratio 1)">
        <PlaceholderContent label="Note de bas de page" />
      </PdfBlock>
    </PdfPageLayout>
  );
}

// ─────────────────────────────────────────────────────────────────
// Rendu de tous les exemples (pour le dev)
// ─────────────────────────────────────────────────────────────────
export default function PdfLayoutExamples() {
  return (
    <div style={{ background: "#0B0F1E", padding: 24 }}>
      <Example2Blocs />
      <Example3Blocs />
      <Example4Blocs />
    </div>
  );
}
