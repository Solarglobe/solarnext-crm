/**
 * PdfPageLayout — deux modes exclusifs :
 *
 * 1) PdfEngine (props `title`, enfants = blocs dimensionnés)
 *    — utilise PdfEngine/PdfHeader (titre + meta + footer).
 *
 * 2) Legacy (`legacyPort`) — P1–P14 (PdfLegacyPort)
 *    — section `<section>` unique : dimensions PAGE_* / marges MARGIN_* (pdfLayout.ts),
 *      `gap` = `sectionGap`, saut de page après la section, styles fusionnés avec `pageStyle`.
 *      En-tête legacy optionnel : `components/pdf/PdfHeader` (souvent dans `legacyPort.header`).
 *
 * `sectionGap` par page (inchangé volontairement — ne pas uniformiser sans brief visuel) :
 *   P1 3.5mm | P2 0 | P3–P4 3.5mm | P5 3.5mm + pageStyle saut avant | P6 2.5mm |
 *   P7–P9 1.5mm | P10 1.25mm | P11–P14 0
 */

import React, { Children } from "react";
import PdfHeader from "./PdfHeader";
import PdfFooter from "./PdfFooter";
import {
  PAGE_W_PX,
  PAGE_H_PX,
  MARGIN_H_PX,
  MARGIN_V_PX,
  CONTENT_W_PX,
  HEADER_H_PX,
  HEADER_GAP_PX,
  FOOTER_H_PX,
  FOOTER_GAP_PX,
  BLOCKS_AREA_H_PX,
  BLOCK_GAP_PX,
  blockHeights,
  COLORS,
  PdfMeta,
} from "./pdfLayout";

/** Port legacy — une section = une page A4 paysage (PdfLegacyPort P1–P14). */
export interface PdfPageLayoutLegacyPort {
  /** Attribut `id` du `<section>` (p1 … p14). */
  id: string;
  /** Attribut `data-engine` sur la section ; omis si absent (ex. P14). */
  dataEngine?: string;
  /**
   * `components/pdf/PdfHeader` ou fragment équivalent.
   * Omis si le header est dans `children` (P8 : dans `.p8-container` pour le CSS).
   */
  header?: React.ReactNode;
  /** `gap` flex de la section (chaîne CSS). */
  sectionGap: string;
  /** Fusion après les styles de base (ex. sauts de page additionnels). */
  pageStyle?: React.CSSProperties;
  /** Attribut booléen `data-react-pdf` (P10). */
  dataReactPdf?: boolean;
}

export type PdfPageLayoutProps =
  | {
      legacyPort: PdfPageLayoutLegacyPort;
      children: React.ReactNode;
      className?: string;
    }
  | {
      legacyPort?: undefined;
      title: string;
      meta?: PdfMeta;
      pageNumber?: number;
      totalPages?: number;
      children: React.ReactNode;
      /** Ratios relatifs pour chaque bloc (doit avoir la même longueur que children) */
      blockRatios?: number[];
      /** Masquer le footer */
      noFooter?: boolean;
      className?: string;
    };

function computeHeightsFromRatios(ratios: number[], areaH: number, count: number): number[] {
  const total = ratios.reduce((a, b) => a + b, 0);
  const totalGaps = (count - 1) * BLOCK_GAP_PX;
  const available = areaH - totalGaps;
  const heights = ratios.map((r) => Math.floor((r / total) * available));
  // Redistribuer les pixels manquants sur le dernier bloc
  const allocated = heights.reduce((a, b) => a + b, 0);
  heights[heights.length - 1] += available - allocated;
  return heights;
}

const LEGACY_FONT = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

export default function PdfPageLayout(props: PdfPageLayoutProps) {
  if ("legacyPort" in props && props.legacyPort) {
    const { legacyPort, children, className } = props;
    const sectionStyle: React.CSSProperties = {
      width: PAGE_W_PX,
      height: PAGE_H_PX,
      maxWidth: PAGE_W_PX,
      maxHeight: PAGE_H_PX,
      boxSizing: "border-box",
      overflow: "hidden",
      padding: `${MARGIN_V_PX}px ${MARGIN_H_PX}px`,
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-start",
      gap: legacyPort.sectionGap,
      background: "#fff",
      color: "#0F172A",
      fontFamily: LEGACY_FONT,
      fontSize: "13.5px",
      lineHeight: 1.45,
      marginBottom: "10mm",
      pageBreakAfter: "always",
      breakAfter: "page",
      ...legacyPort.pageStyle,
    };

    return (
      <section
        id={legacyPort.id}
        {...(legacyPort.dataEngine != null ? { "data-engine": legacyPort.dataEngine } : {})}
        {...(legacyPort.dataReactPdf ? { "data-react-pdf": "true" } : {})}
        className={className}
        style={sectionStyle}
      >
        {legacyPort.header}
        {children}
      </section>
    );
  }

  const {
    title,
    meta,
    pageNumber,
    totalPages,
    children,
    blockRatios,
    noFooter = false,
    className,
  } = props;

  const childArray = Children.toArray(children);
  const blockCount = childArray.length;

  // Calcul des hauteurs de blocs
  let heights: number[];
  if (blockRatios && blockRatios.length === blockCount) {
    heights = computeHeightsFromRatios(blockRatios, BLOCKS_AREA_H_PX, blockCount);
  } else {
    heights = blockHeights(blockCount);
  }

  return (
    <div
      className={className}
      style={{
        /* Dimensions exactes de la page A4 paysage */
        width:  PAGE_W_PX,
        height: PAGE_H_PX,
        minWidth:  PAGE_W_PX,
        minHeight: PAGE_H_PX,
        maxWidth:  PAGE_W_PX,
        maxHeight: PAGE_H_PX,

        /* Isolation absolue — aucun débordement */
        overflow: "hidden",
        boxSizing: "border-box",

        /* Marges uniformes */
        padding: `${MARGIN_V_PX}px ${MARGIN_H_PX}px`,

        /* Mise en page verticale */
        display: "flex",
        flexDirection: "column",
        gap: 0,

        /* Style visuel */
        background: COLORS.bgSurface,
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
        color: COLORS.textPrimary,

        /* Saut de page Playwright */
        pageBreakAfter: "always",
        breakAfter: "page",
      }}
    >
      {/* ── HEADER ── */}
      <PdfHeader
        title={title}
        meta={meta}
        pageNumber={pageNumber}
        totalPages={totalPages}
      />

      {/* ── GAP header → blocs ── */}
      <div style={{ height: HEADER_GAP_PX, flexShrink: 0 }} />

      {/* ── BLOCS DE CONTENU ── */}
      <div
        style={{
          flex: "none",
          width: CONTENT_W_PX,
          height: BLOCKS_AREA_H_PX,
          display: "flex",
          flexDirection: "column",
          gap: BLOCK_GAP_PX,
          overflow: "hidden",
          boxSizing: "border-box",
        }}
      >
        {childArray.map((child, i) => (
          <div
            key={i}
            style={{
              width: "100%",
              height: heights[i],
              minHeight: heights[i],
              maxHeight: heights[i],
              overflow: "hidden",
              boxSizing: "border-box",
              flexShrink: 0,

              /* Style de bloc standard */
              background: COLORS.bgBlock,
              border: `1px solid ${COLORS.borderSoft}`,
              borderRadius: 10,
              padding: "10px 14px",
            }}
          >
            {child}
          </div>
        ))}
      </div>

      {/* ── GAP blocs → footer ── */}
      {!noFooter && <div style={{ height: FOOTER_GAP_PX, flexShrink: 0 }} />}

      {/* ── FOOTER ── */}
      {!noFooter && (
        <PdfFooter pageNumber={pageNumber} totalPages={totalPages} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sous-composant utilitaire : PdfBlock
// Encapsule un bloc de contenu avec un titre de section optionnel
// ─────────────────────────────────────────────────────────────────
interface PdfBlockProps {
  title?: string;
  children: React.ReactNode;
  /** Variante dorée (accent) */
  accent?: boolean;
  style?: React.CSSProperties;
}

export function PdfBlock({ title, children, accent, style }: PdfBlockProps) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxSizing: "border-box",
        ...(accent
          ? {
              background: COLORS.bgBlockAlt,
              border: `1px solid ${COLORS.borderGold}`,
            }
          : {}),
        ...style,
      }}
    >
      {title && (
        <div
          style={{
            fontWeight: 700,
            fontSize: "9.5pt",
            color: accent ? COLORS.accentGold : COLORS.textSecond,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            marginBottom: 8,
            flexShrink: 0,
          }}
        >
          {title}
        </div>
      )}
      <div style={{ flex: 1, overflow: "hidden" }}>{children}</div>
    </div>
  );
}
