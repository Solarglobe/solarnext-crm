/**
 * Libellés français uniques pour le module financier (statuts API en UPPERCASE).
 * Source de vérité pour listes, hub, badges lead, toolbar devis.
 */

const QUOTE_STATUS_FR: Record<string, string> = {
  DRAFT: "Brouillon",
  READY_TO_SEND: "Prêt à envoyer",
  SENT: "Envoyé",
  ACCEPTED: "Accepté",
  REJECTED: "Refusé",
  EXPIRED: "Expiré",
  CANCELLED: "Annulé",
};

const INVOICE_STATUS_FR: Record<string, string> = {
  DRAFT: "Brouillon",
  ISSUED: "Émise",
  PARTIALLY_PAID: "Partiellement payée",
  PAID: "Payée",
  CANCELLED: "Annulée",
};

const CREDIT_NOTE_STATUS_FR: Record<string, string> = {
  DRAFT: "Brouillon",
  ISSUED: "Émise",
  CANCELLED: "Annulée",
};

export function formatQuoteStatusFr(status: string | undefined | null): string {
  const u = String(status ?? "")
    .trim()
    .toUpperCase();
  return QUOTE_STATUS_FR[u] ?? (status ? String(status) : "—");
}

export function formatInvoiceStatusFr(status: string | undefined | null): string {
  const u = String(status ?? "")
    .trim()
    .toUpperCase();
  return INVOICE_STATUS_FR[u] ?? (status ? String(status) : "—");
}

export function formatCreditNoteStatusFr(status: string | undefined | null): string {
  const u = String(status ?? "")
    .trim()
    .toUpperCase();
  return CREDIT_NOTE_STATUS_FR[u] ?? (status ? String(status) : "—");
}
