/**
 * En-tête « feuille » du port PDF legacy (PdfLegacyPort, P1–P14).
 * Structure fixe : logo (absolu) · badge centré · méta (absolu droite) · barre.
 *
 * Variables CSS (défauts ci-dessous ; `headerStyle` fusionné en dernier pour cas particuliers) :
 *  - `--brand`  marque dorée
 *  - `--metaW`  réservation colonne méta (`metaWidth` ou surcharge explicite)
 *  - `--logoW`  réservation logo (souvent via `headerStyle` sur chaque page)
 */

import React from "react";

/** Colonne méta étroite — familles P1–P10 (défaut). */
export const PDF_HEADER_META_WIDTH_NARROW = "110mm";
/** Colonne méta large — familles P11–P14. */
export const PDF_HEADER_META_WIDTH_WIDE = "120mm";

/** @deprecated alias historique ; préférer `PDF_HEADER_META_WIDTH_NARROW`. */
export const PDF_LEGACY_HEADER_META_W_DEFAULT = PDF_HEADER_META_WIDTH_NARROW;

const BRAND_FALLBACK = "#6366F1";

/** Variante de largeur méta sans passer par `headerStyle['--metaW']`. */
export type PdfHeaderMetaWidth = "narrow" | "wide";

function resolveMetaWVariable(metaWidth: PdfHeaderMetaWidth | undefined): string {
  if (metaWidth === "wide") return PDF_HEADER_META_WIDTH_WIDE;
  return PDF_HEADER_META_WIDTH_NARROW;
}

/**
 * Badge : mêmes contraintes de hauteur qu’avant (font 6mm, padding vertical 1mm inchangé).
 * Améliorations : graisse, letter-spacing, bordure plus fine, padding horizontal légèrement équilibré.
 */
const BADGE_STYLE: React.CSSProperties = {
  boxSizing: "border-box",
  fontSize: "6mm",
  fontWeight: 600,
  letterSpacing: "0.04em",
  padding: "1mm 3.45mm",
  borderStyle: "solid",
  borderWidth: "0.32mm",
  borderColor: `rgb(from var(--brand, ${BRAND_FALLBACK}) r g b / 0.42)`,
  borderRadius: "999mm",
  color: `var(--brand, ${BRAND_FALLBACK})`,
  background: "rgba(255, 255, 255, 0.92)",
};

/**
 * Barre : marge sup. 7.5mm (respiration sous le badge), hauteur 0.45mm, gradient plus présent.
 */
const BAR_STYLE: React.CSSProperties = {
  alignSelf: "stretch",
  height: "0.45mm",
  background: `linear-gradient(90deg, transparent 0%, rgb(from var(--brand, ${BRAND_FALLBACK}) r g b / 0.6) 15%, var(--brand, ${BRAND_FALLBACK}) 35%, color-mix(in srgb, var(--brand, ${BRAND_FALLBACK}) 72%, #ffffff) 65%, rgb(from var(--brand, ${BRAND_FALLBACK}) r g b / 0.6) 85%, transparent 100%)`,
  borderRadius: "999mm",
  marginTop: "7.5mm",
  marginBottom: 0,
  flexShrink: 0,
  opacity: 0.95,
};

/**
 * `.meta-compact` est stylé en inline sur chaque page — !important pour centraliser l’ajustement fin
 * (alignement bas ↔ logo, densité, typo) sans toucher aux fichiers de page.
 */
const META_DESCENDANT_CSS = `
.pdf-header-root .meta-compact {
  -webkit-font-smoothing: antialiased;
  font-variant-numeric: tabular-nums;
  bottom: 5.2mm !important;
  gap: 0.6mm !important;
  line-height: 1.15 !important;
  font-size: 13px !important;
}
.pdf-header-root .meta-compact b {
  font-weight: 600;
  color: rgba(15, 23, 42, 0.52);
}
.pdf-header-root .meta-compact span[id] {
  font-weight: 600;
  color: #0f172a;
  letter-spacing: -0.01em;
}
`;

export interface PdfHeaderProps {
  logo: React.ReactNode;
  badge: string;
  metaColumn: React.ReactNode;
  /**
   * Réservation horizontale de la colonne méta.
   * Les pages peuvent encore passer `--metaW` dans `headerStyle` (prioritaire).
   */
  metaWidth?: PdfHeaderMetaWidth;
  headerStyle?: React.CSSProperties;
}

export default function PdfHeader({ logo, badge, metaColumn, metaWidth, headerStyle }: PdfHeaderProps) {
  const cssVars: React.CSSProperties = {
    ["--metaW" as string]: resolveMetaWVariable(metaWidth),
  };

  return (
    <div
      className="header pdf-header-root"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingBottom: "3mm",
        ...cssVars,
        ...headerStyle,
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: META_DESCENDANT_CSS }} />
      {logo}
      <span className="badge" style={BADGE_STYLE}>
        {badge}
      </span>
      {metaColumn}
      <div className="bar" style={BAR_STYLE} />
    </div>
  );
}
