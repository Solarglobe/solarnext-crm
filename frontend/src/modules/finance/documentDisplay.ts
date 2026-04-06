/**
 * Affichage numéros documents : masque les identifiants techniques brouillon (DRAFT-…) au profit de libellés stables.
 */

import { quoteBuilderTitleDisplay } from "../quotes/quoteUiStatus";

export const QUOTE_DRAFT_LABEL = "Devis brouillon";
export const INVOICE_DRAFT_LABEL = "Facture brouillon";
export const CREDIT_NOTE_DRAFT_LABEL = "Avoir brouillon";

/** Brouillon / prêt uniquement (ne pas confondre avec « numéro officiel » = devis Signé). */
export function isQuotePreOfficialStatus(status: string | undefined | null): boolean {
  const u = String(status || "").toUpperCase();
  return u === "DRAFT" || u === "READY_TO_SEND";
}

/** Numéro lisible : officiel seulement si devis Signé (ACCEPTED), sinon libellé « Devis en cours ». */
export function formatQuoteNumberDisplay(quote_number: string | undefined | null, status: string | undefined | null): string {
  return quoteBuilderTitleDisplay(quote_number, status);
}

export function formatInvoiceNumberDisplay(invoice_number: string | undefined | null, status: string | undefined | null): string {
  if (String(status || "").toUpperCase() === "DRAFT") return INVOICE_DRAFT_LABEL;
  const s = String(invoice_number || "").trim();
  return s || "—";
}

export function formatCreditNoteNumberDisplay(
  credit_note_number: string | undefined | null,
  status: string | undefined | null
): string {
  if (String(status || "").toUpperCase() === "DRAFT") return CREDIT_NOTE_DRAFT_LABEL;
  const s = String(credit_note_number || "").trim();
  return s || "—";
}
