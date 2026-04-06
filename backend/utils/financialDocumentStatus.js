/**
 * Normalisation des statuts documents financiers (alignement schéma CP-FINANCIAL-POLE, valeurs UPPERCASE).
 */

export const QUOTE_STATUSES = new Set([
  "DRAFT",
  "READY_TO_SEND",
  "SENT",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
]);

export const INVOICE_STATUSES = new Set([
  "DRAFT",
  "ISSUED",
  "PARTIALLY_PAID",
  "PAID",
  "CANCELLED",
]);

const LEGACY_QUOTE = {
  draft: "DRAFT",
  sent: "SENT",
  signed: "ACCEPTED",
  cancelled: "CANCELLED",
};

const LEGACY_INVOICE = {
  draft: "DRAFT",
  cancelled: "CANCELLED",
  issued: "ISSUED",
  partially_paid: "PARTIALLY_PAID",
  paid: "PAID",
};

/**
 * @param {unknown} input
 * @returns {string | null} statut DB ou null si invalide
 */
export function normalizeQuoteStatusInput(input) {
  if (input == null || String(input).trim() === "") return null;
  const s = String(input).trim();
  const lower = s.toLowerCase();
  if (LEGACY_QUOTE[lower]) return LEGACY_QUOTE[lower];
  const upper = s.toUpperCase();
  if (QUOTE_STATUSES.has(upper)) return upper;
  return null;
}

/**
 * @param {unknown} input
 * @param {string} [fallback='DRAFT']
 */
export function normalizeQuoteStatusForDb(input, fallback = "DRAFT") {
  const n = normalizeQuoteStatusInput(input);
  return n ?? fallback;
}

/**
 * @param {unknown} input
 * @returns {string | null}
 */
export function normalizeInvoiceStatusInput(input) {
  if (input == null || String(input).trim() === "") return null;
  const s = String(input).trim();
  const lower = s.toLowerCase();
  if (LEGACY_INVOICE[lower]) return LEGACY_INVOICE[lower];
  const upper = s.toUpperCase();
  if (INVOICE_STATUSES.has(upper)) return upper;
  return null;
}

/**
 * @param {unknown} input
 * @param {string} [fallback='DRAFT']
 */
export function normalizeInvoiceStatusForDb(input, fallback = "DRAFT") {
  const n = normalizeInvoiceStatusInput(input);
  return n ?? fallback;
}
