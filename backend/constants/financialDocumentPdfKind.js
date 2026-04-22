/**
 * Nature du PDF financier / commercial pour la fusion des annexes légales.
 * - PROPOSAL : PDF étude / version (proposition commerciale) — léger, sans CGV ni RGE/décennale.
 * - QUOTE : PDF devis contractuel — CGV + annexes selon snapshot (comportement légal inchangé).
 */
export const FINANCIAL_DOCUMENT_PDF_KIND = Object.freeze({
  PROPOSAL: "PROPOSAL",
  QUOTE: "QUOTE",
});
