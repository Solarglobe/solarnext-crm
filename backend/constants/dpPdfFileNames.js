/**
 * Noms de fichiers PDF dossier DP — courts, triables, cohérents.
 * Stockage recommandé : `${baseName}-${leadId}.pdf` (évite collisions).
 */

export const DP_PDF_BASE_NAME_BY_PIECE = Object.freeze({
  dp1: "dp1-plan-de-situation",
  dp2: "dp2-plan-de-masse",
  dp3: "dp3-plan-de-coupe",
  dp4: "dp4-plan-facades-toitures",
  dp5: "dp5-representation-graphique",
  dp6: "dp6-insertion-paysagere",
  dp7: "dp7-photo-proche",
  dp8: "dp8-photo-lointaine",
  mandat: "mandat-representation",
  cerfa: "cerfa",
  dp_complet: "dossier-declaration-prealable",
});

/**
 * @param {string|null|undefined} piece — ex. "DP1", "dp1", "mandat"
 * @returns {string} clé canonique (dp1…dp8, mandat, cerfa, dp_complet, ou "document")
 */
export function normalizeDpPieceKey(piece) {
  const t = piece != null ? String(piece).trim() : "";
  if (!t) return "document";
  const lower = t.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(DP_PDF_BASE_NAME_BY_PIECE, lower)) {
    return lower;
  }
  const m = /^dp\s*(\d+)$/i.exec(t);
  if (m) return `dp${m[1]}`;
  if (/^dp\d+$/i.test(t)) return t.toLowerCase();
  const safe = lower.replace(/[^a-z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return safe || "document";
}

/**
 * @param {string|null|undefined} piece
 * @param {string|null|undefined} leadId — si défini, suffixe UUID (évite collisions)
 * @returns {string} nom de fichier .pdf
 */
export function getDpPdfFileName(piece, leadId) {
  const key = normalizeDpPieceKey(piece);
  const base = DP_PDF_BASE_NAME_BY_PIECE[key] || "document";
  const lid = leadId != null && String(leadId).trim() !== "" ? String(leadId).trim() : "";
  if (lid) return `${base}-${lid}.pdf`;
  return `${base}.pdf`;
}
