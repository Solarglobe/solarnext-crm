/**
 * Règles d’orchestration devis (alignées backend) — document figé : envoi (SENT) ou validation signée (FINALIZE_QUOTE_SIGNED).
 */

export function quoteHasOfficialDocumentSnapshot(quote: { document_snapshot_json?: unknown } | null | undefined): boolean {
  if (!quote) return false;
  const raw = quote.document_snapshot_json;
  if (raw == null) return false;
  if (typeof raw === "object" && raw !== null && Object.keys(raw as object).length === 0) return false;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t || t === "{}") return false;
    try {
      const o = JSON.parse(t) as object;
      return typeof o === "object" && o !== null && Object.keys(o).length > 0;
    } catch {
      return t.length > 2;
    }
  }
  return true;
}

/** Lignes liste / hero : pas de `document_snapshot_json` — heuristique statut + PDF déjà généré. */
export function canOfferOfficialQuotePdfFromListRow(row: { status?: string; has_pdf?: boolean }): boolean {
  const s = String(row.status ?? "")
    .trim()
    .toUpperCase();
  if (["SENT", "ACCEPTED", "REJECTED", "EXPIRED"].includes(s)) return true;
  if (s === "CANCELLED" && row.has_pdf) return true;
  return false;
}

export const QUOTE_DOC_PDF = "quote_pdf";
export const QUOTE_DOC_PDF_SIGNED = "quote_pdf_signed";
export const QUOTE_DOC_SIGNATURE_CLIENT = "quote_signature_client";
export const QUOTE_DOC_SIGNATURE_COMPANY = "quote_signature_company";

export interface QuoteDocumentListRow {
  id: string;
  file_name: string;
  created_at: string;
  document_type?: string | null;
}

export function pickLatestQuotePdf(docs: QuoteDocumentListRow[]): QuoteDocumentListRow | null {
  const list = docs.filter((d) => d.document_type === QUOTE_DOC_PDF);
  if (!list.length) return null;
  list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return list[0] ?? null;
}

export function pickLatestSignedQuotePdf(docs: QuoteDocumentListRow[]): QuoteDocumentListRow | null {
  const list = docs.filter((d) => d.document_type === QUOTE_DOC_PDF_SIGNED);
  if (!list.length) return null;
  list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return list[0] ?? null;
}

export function pickLatestDocByType(docs: QuoteDocumentListRow[], documentType: string): QuoteDocumentListRow | null {
  const list = docs.filter((d) => d.document_type === documentType);
  if (!list.length) return null;
  list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return list[0] ?? null;
}
