/**
 * pdfLayout.ts — Source of Truth pour toutes les dimensions PDF SolarGlobe
 *
 * FORMAT : A4 Paysage  →  297 × 210 mm
 * Playwright génère le PDF à 96 dpi → 1 mm = 3.7795px (ratio standard CSS)
 *
 * Règle absolue :
 *   PAGE_H_PX = HEADER_H_PX + FOOTER_H_PX + (N × BLOCK_H_PX(N)) + (N-1) × GAP_PX + MARGIN_V_PX × 2
 *
 * Toutes les valeurs PX sont des nombres entiers (pas de demi-pixel).
 */

// ─────────────────────────────────────────────────────────────────
// 1. FACTEUR DE CONVERSION
// ─────────────────────────────────────────────────────────────────
export const MM_TO_PX = 3.7795; // 96 dpi → CSS px

export function mmToPx(mm: number): number {
  return Math.round(mm * MM_TO_PX);
}

// ─────────────────────────────────────────────────────────────────
// 2. DIMENSIONS PAGE A4 PAYSAGE
// ─────────────────────────────────────────────────────────────────
export const PAGE_W_MM = 297;
export const PAGE_H_MM = 210;

export const PAGE_W_PX = mmToPx(PAGE_W_MM); // 1122 px
export const PAGE_H_PX = mmToPx(PAGE_H_MM); // 794 px

// ─────────────────────────────────────────────────────────────────
// 3. MARGES (identiques sur toutes les pages)
// ─────────────────────────────────────────────────────────────────
export const MARGIN_H_MM = 10; // gauche / droite
export const MARGIN_V_MM = 8;  // haut / bas

export const MARGIN_H_PX = mmToPx(MARGIN_H_MM); // 38 px
export const MARGIN_V_PX = mmToPx(MARGIN_V_MM); // 30 px

// Zone de contenu disponible après marges
export const CONTENT_W_PX = PAGE_W_PX - MARGIN_H_PX * 2; // 1046 px
export const CONTENT_H_PX = PAGE_H_PX - MARGIN_V_PX * 2; // 734 px

// ─────────────────────────────────────────────────────────────────
// 4. HEADER UNIVERSEL (identique sur TOUTES les pages)
// ─────────────────────────────────────────────────────────────────
export const HEADER_H_MM = 14;
export const HEADER_H_PX = mmToPx(HEADER_H_MM); // 53 px

// Séparateur entre header et zone de contenu
export const HEADER_GAP_PX = 10;

// ─────────────────────────────────────────────────────────────────
// 5. FOOTER
// ─────────────────────────────────────────────────────────────────
export const FOOTER_H_MM = 6;
export const FOOTER_H_PX = mmToPx(FOOTER_H_MM); // 23 px
export const FOOTER_GAP_PX = 8;

// ─────────────────────────────────────────────────────────────────
// 6. ZONE DE BLOCS
//    = CONTENT_H_PX − HEADER_H_PX − HEADER_GAP − FOOTER_H_PX − FOOTER_GAP
// ─────────────────────────────────────────────────────────────────
export const BLOCKS_AREA_H_PX =
  CONTENT_H_PX - HEADER_H_PX - HEADER_GAP_PX - FOOTER_H_PX - FOOTER_GAP_PX;
// 734 - 53 - 10 - 23 - 8 = 640 px disponibles pour les blocs

// Gap entre blocs
export const BLOCK_GAP_PX = 8;

// ─────────────────────────────────────────────────────────────────
// 7. CALCUL DE HAUTEUR DE BLOCS
//    Retourne la hauteur exacte en px pour N blocs sur la page
//    afin de remplir EXACTEMENT la zone sans overflow ni vide.
// ─────────────────────────────────────────────────────────────────
export function blockHeight(blockCount: number): number {
  if (blockCount <= 0) return BLOCKS_AREA_H_PX;
  const totalGaps = (blockCount - 1) * BLOCK_GAP_PX;
  return Math.floor((BLOCKS_AREA_H_PX - totalGaps) / blockCount);
}

/**
 * Retourne un tableau de hauteurs pour N blocs.
 * Le dernier bloc récupère les pixels restants (évite les arrondis).
 */
export function blockHeights(blockCount: number): number[] {
  if (blockCount <= 0) return [];
  const h = blockHeight(blockCount);
  const totalGaps = (blockCount - 1) * BLOCK_GAP_PX;
  const allocated = h * blockCount + totalGaps;
  const remainder = BLOCKS_AREA_H_PX - allocated;
  return Array.from({ length: blockCount }, (_, i) =>
    i === blockCount - 1 ? h + remainder : h
  );
}

// ─────────────────────────────────────────────────────────────────
// 8. DESIGN TOKENS (couleurs, typographie)
//    → Source unique, importée par le CSS et les composants inline
// ─────────────────────────────────────────────────────────────────
export const COLORS = {
  bgPage:      "#0B0F1E",
  bgSurface:   "#161C34",
  bgElevated:  "#12172B",
  bgBlock:     "rgba(255,255,255,0.04)",
  bgBlockAlt:  "rgba(195,152,71,0.08)",
  borderSoft:  "rgba(255,255,255,0.08)",
  borderGold:  "rgba(195,152,71,0.45)",
  textPrimary: "#E8ECF8",
  textSecond:  "#9FA8C7",
  accentGold:  "#C39847",
  accentGreen: "#4ade80",
  accentBlue:  "#4A90E2",
} as const;

export const FONT = {
  family: "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
  sizeBase:   "11pt",
  sizeSmall:  "9pt",
  sizeLarge:  "13pt",
  sizeXL:     "16pt",
  weightNormal: 400,
  weightMedium: 500,
  weightBold:   700,
  weightXBold:  800,
  lineHeight:  1.4,
} as const;

// ─────────────────────────────────────────────────────────────────
// 9. TYPE DU META UNIVERSEL (client / réf / date)
// ─────────────────────────────────────────────────────────────────
export interface PdfMeta {
  client?: string;
  ref?: string;
  date?: string;
}

export const EMPTY_VALUE = "—";

export function fmt(v: unknown): string {
  if (v == null || v === "") return EMPTY_VALUE;
  return String(v);
}
