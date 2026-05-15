/**
 * PdfFooter.tsx — Footer discret, identique sur toutes les pages
 *
 * Hauteur fixe : FOOTER_H_PX (23px)
 * Contenu : branding gauche + numéro de page droite
 */

import { FOOTER_H_PX, CONTENT_W_PX, COLORS, FONT } from "./pdfLayout";
import { resolvePdfPrimaryColor } from "../pdfBrand";

interface PdfFooterProps {
  pageNumber?: number;
  totalPages?: number;
  /** Ligne gauche (ex. nom entreprise + mention confidentielle). */
  footerLeftText?: string;
  /** Couleur d’accent pour le texte du pied (optionnel). */
  accentColor?: string;
}

export default function PdfFooter({ pageNumber, totalPages, footerLeftText, accentColor }: PdfFooterProps) {
  const pageLabel =
    pageNumber != null
      ? totalPages != null
        ? `${pageNumber} / ${totalPages}`
        : String(pageNumber)
      : null;

  return (
    <footer
      style={{
        width: CONTENT_W_PX,
        height: FOOTER_H_PX,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
        boxSizing: "border-box",
        borderTop: `1px solid ${COLORS.borderSoft}`,
        paddingTop: 4,
      }}
    >
      {/* Branding gauche */}
      <span
        style={{
          fontFamily: FONT.family,
          fontSize: "7.5pt",
          color: accentColor ? resolvePdfPrimaryColor(accentColor) : COLORS.textSecond,
          opacity: 0.55,
          letterSpacing: "0.04em",
        }}
      >
        {footerLeftText ?? "Étude photovoltaïque confidentielle"}
      </span>

      {/* Numéro de page droite */}
      {pageLabel && (
        <span
          style={{
            fontFamily: FONT.family,
            fontSize: "7.5pt",
            color: COLORS.textSecond,
            opacity: 0.5,
          }}
        >
          {pageLabel}
        </span>
      )}
    </footer>
  );
}
