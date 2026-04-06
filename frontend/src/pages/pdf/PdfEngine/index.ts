/**
 * PdfEngine — Point d'entrée unique
 *
 * Import recommandé dans les pages PDF :
 *   import PdfPageLayout, { PdfBlock } from "../PdfEngine";
 *   import { blockHeight, COLORS, fmt, type PdfMeta } from "../PdfEngine";
 */

// Composants principaux
export { default as PdfPageLayout } from "./PdfPageLayout";
export { PdfBlock } from "./PdfPageLayout";
export { default as PdfHeader } from "./PdfHeader";
export { default as PdfFooter } from "./PdfFooter";
export { default as PdfKpiGrid } from "./PdfKpiGrid";
export type { KpiItem } from "./PdfKpiGrid";
export { default as PdfTable } from "./PdfTable";
export type { TableRow } from "./PdfTable";

// Système de layout
export {
  // Constantes
  MM_TO_PX,
  PAGE_W_MM, PAGE_H_MM,
  PAGE_W_PX, PAGE_H_PX,
  MARGIN_H_MM, MARGIN_V_MM,
  MARGIN_H_PX, MARGIN_V_PX,
  CONTENT_W_PX, CONTENT_H_PX,
  HEADER_H_PX, HEADER_GAP_PX,
  FOOTER_H_PX, FOOTER_GAP_PX,
  BLOCKS_AREA_H_PX, BLOCK_GAP_PX,
  // Utilitaires
  mmToPx,
  blockHeight,
  blockHeights,
  // Design tokens
  COLORS,
  FONT,
  EMPTY_VALUE,
  fmt,
} from "./pdfLayout";

export type { PdfMeta } from "./pdfLayout";
