/**
 * Couche unique : statuts techniques API → libellés et regroupements visibles commercial.
 * Le backend conserve DRAFT, READY_TO_SEND, SENT, ACCEPTED, etc.
 */

export type QuoteUiBucket = "en_cours" | "signe" | "refuse" | "annule";

/** Libellé affiché (4 états produit : EXPIRED regroupé sous Annulé). */
export function quoteStatusToUiLabel(status: string | undefined | null): string {
  const u = String(status || "").toUpperCase();
  if (u === "ACCEPTED") return "Signé";
  if (u === "REJECTED") return "Refusé";
  if (u === "CANCELLED" || u === "EXPIRED") return "Annulé";
  return "En cours";
}

export function quoteUiBucket(status: string | undefined | null): QuoteUiBucket {
  const u = String(status || "").toUpperCase();
  if (u === "ACCEPTED") return "signe";
  if (u === "REJECTED") return "refuse";
  if (u === "CANCELLED" || u === "EXPIRED") return "annule";
  return "en_cours";
}

/** Classe pastille toolbar / listes (préfixe qb-status--). */
export function quoteUiStatusBadgeClass(status: string | undefined | null): string {
  const b = quoteUiBucket(status);
  if (b === "en_cours") return "qb-status--ux-en-cours";
  if (b === "signe") return "qb-status--ux-signe";
  if (b === "refuse") return "qb-status--ux-refuse";
  return "qb-status--ux-annule";
}

/**
 * Numéro officiel (ex. SG-2026-0001) affiché seulement une fois le devis « Signé » (ACCEPTED),
 * ou sur le rendu PDF Playwright explicitement « signé » (signatures intégrées).
 */
export function quoteShowsOfficialNumber(
  quoteStatus: string | undefined | null,
  opts?: { quoteSignedPdfRender?: boolean }
): boolean {
  if (opts?.quoteSignedPdfRender) return true;
  return String(quoteStatus || "").toUpperCase() === "ACCEPTED";
}

/** Ligne « N° » PDF / document quand pas encore officiel. */
export const QUOTE_PDF_WORK_NUMBER_LABEL = "Devis en cours";

/** Édition lignes / meta (aligné backend isQuoteEditable). */
export function quoteIsContentEditableStatus(status: string | undefined | null): boolean {
  const u = String(status || "").toUpperCase();
  return u === "DRAFT" || u === "READY_TO_SEND";
}

/**
 * Texte court sous « Statut : … » dans le panneau état.
 */
export function quoteWorkflowExplainLine(status: string | undefined | null, canEditContent: boolean): string {
  const u = String(status || "").toUpperCase();
  if (u === "ACCEPTED") return "Ce devis est figé et ne peut plus être modifié.";
  if (u === "REJECTED" || u === "CANCELLED" || u === "EXPIRED") return "";
  if (u === "SENT") return "Vous ne pouvez plus modifier le contenu ici.";
  if (canEditContent) return "Ce devis peut encore être modifié.";
  return "";
}

/**
 * Titre / colonne « numéro » builder & listes : jamais DRAFT-xxx ni numéro officiel tant que non Signé (ACCEPTED).
 */
export function quoteBuilderTitleDisplay(quoteNumber: string | undefined | null, status: string | undefined | null): string {
  if (quoteShowsOfficialNumber(status)) {
    const s = String(quoteNumber || "").trim();
    return s || "—";
  }
  return QUOTE_PDF_WORK_NUMBER_LABEL;
}

/** Pas d’infobulle avec identifiant technique brouillon (évite DRAFT-xxx visible). */
export function quoteBuilderTitleTechHint(
  _quoteNumber: string | undefined | null,
  _status: string | undefined | null
): string | undefined {
  return undefined;
}
