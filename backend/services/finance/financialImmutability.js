/**
 * Garde-fous d'édition sur documents financiers figés (statuts CP-FINANCIAL-POLE).
 */

const QUOTE_EDITABLE = new Set(["DRAFT", "READY_TO_SEND"]);
const INVOICE_EDITABLE = new Set(["DRAFT"]);
const CREDIT_NOTE_EDITABLE = new Set(["DRAFT"]);

/**
 * @param {unknown} status
 */
export function isQuoteEditable(status) {
  const s = String(status ?? "").toUpperCase();
  return QUOTE_EDITABLE.has(s);
}

/**
 * Lignes / montants modifiables uniquement en brouillon devis.
 * @param {unknown} status
 */
export function isQuoteLineEditable(status) {
  return isQuoteEditable(status);
}

/**
 * @param {unknown} status
 */
export function isInvoiceEditable(status) {
  const s = String(status ?? "").toUpperCase();
  return INVOICE_EDITABLE.has(s);
}

/**
 * @param {unknown} status
 */
export function isCreditNoteEditable(status) {
  const s = String(status ?? "").toUpperCase();
  return CREDIT_NOTE_EDITABLE.has(s);
}

/**
 * Indique si le document est définitivement figé côté client (hors annulation).
 * @param {unknown} status
 */
export function isQuoteFrozenForSending(status) {
  const s = String(status ?? "").toUpperCase();
  return ["SENT", "ACCEPTED", "REJECTED", "EXPIRED"].includes(s);
}

/**
 * @param {unknown} status
 */
export function isInvoiceIssuedOrBeyond(status) {
  const s = String(status ?? "").toUpperCase();
  return ["ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED"].includes(s);
}

/**
 * Workflow devis : statuts terminaux (plus de cycle métier standard).
 * @param {unknown} status
 */
export function isQuoteTerminalStatus(status) {
  const s = String(status ?? "").toUpperCase();
  return ["ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"].includes(s);
}
