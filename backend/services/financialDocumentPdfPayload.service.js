/**
 * Payload PDF figé — construit uniquement depuis document_snapshot_json (aucune lecture live métier).
 */

function assertDocType(snap, expected) {
  if (!snap || String(snap.document_type).toUpperCase() !== expected) {
    const err = new Error(`Snapshot PDF invalide : document_type attendu ${expected}`);
    err.statusCode = 400;
    throw err;
  }
}

/**
 * Vue stable pour le futur moteur de rendu PDF (Playwright / template).
 * @param {object} snapshot — document_snapshot_json officiel
 */
export function buildQuotePdfPayloadFromSnapshot(snapshot) {
  assertDocType(snapshot, "QUOTE");
  return {
    schema_version: snapshot.schema_version,
    snapshot_checksum: snapshot.snapshot_checksum,
    document_type: "QUOTE",
    number: snapshot.number,
    status: snapshot.status,
    currency: snapshot.currency,
    sent_at: snapshot.sent_at,
    valid_until: snapshot.valid_until,
    issuer: snapshot.issuer_snapshot,
    recipient: snapshot.recipient_snapshot,
    lines: snapshot.lines,
    totals: snapshot.totals,
    refs: snapshot.refs,
    notes: snapshot.notes ?? null,
    commercial_notes: snapshot.commercial_notes ?? null,
    technical_notes: snapshot.technical_notes ?? null,
    payment_terms: snapshot.payment_terms ?? null,
    deposit: snapshot.deposit ?? null,
    deposit_display: snapshot.deposit_display ?? null,
    pdf_display: snapshot.pdf_display ?? { show_line_pricing: true },
    legal_documents: snapshot.legal_documents ?? { include_rge: false, include_decennale: false },
    frozen_at: snapshot.frozen_at,
  };
}

/**
 * @param {object} snapshot
 */
export function buildInvoicePdfPayloadFromSnapshot(snapshot) {
  assertDocType(snapshot, "INVOICE");
  return {
    schema_version: snapshot.schema_version,
    snapshot_checksum: snapshot.snapshot_checksum,
    document_type: "INVOICE",
    number: snapshot.number,
    status: snapshot.status,
    currency: snapshot.currency,
    issue_date: snapshot.issue_date,
    due_date: snapshot.due_date,
    issuer: snapshot.issuer_snapshot,
    recipient: snapshot.recipient_snapshot,
    lines: snapshot.lines,
    totals: snapshot.totals,
    source_quote_snapshot: snapshot.source_quote_snapshot,
    source_quote: snapshot.source_quote,
    refs: snapshot.refs,
    notes: snapshot.notes ?? null,
    payment_terms: snapshot.payment_terms ?? null,
    frozen_at: snapshot.frozen_at,
  };
}

/**
 * Rendu PDF facture uniquement (ne persiste rien) : surcharge issuer.bank avec les colonnes
 * live `organizations` — la valeur live prime si elle est truthy, sinon repli sur le snapshot figé.
 * @param {object} payload — sortie de {@link buildInvoicePdfPayloadFromSnapshot}
 * @param {{ iban?: string|null, bic?: string|null, bank_name?: string|null }} orgRow — ligne organizations
 * @returns {object}
 */
export function mergeLiveOrganizationBankIntoInvoicePdfPayload(payload, orgRow) {
  if (!payload || typeof payload !== "object") return payload;
  const org = orgRow && typeof orgRow === "object" ? orgRow : {};
  const issuerSrc =
    payload.issuer !== null && payload.issuer !== undefined && typeof payload.issuer === "object"
      ? payload.issuer
      : {};
  const snapBank =
    issuerSrc.bank !== null && issuerSrc.bank !== undefined && typeof issuerSrc.bank === "object"
      ? issuerSrc.bank
      : {};
  const issuer = {
    ...issuerSrc,
    bank: {
      ...snapBank,
      iban: org.iban || snapBank.iban || null,
      bic: org.bic || snapBank.bic || null,
      bank_name: org.bank_name || snapBank.bank_name || null,
    },
  };
  return { ...payload, issuer };
}

/**
 * @param {object} snapshot
 */
export function buildCreditNotePdfPayloadFromSnapshot(snapshot) {
  assertDocType(snapshot, "CREDIT_NOTE");
  return {
    schema_version: snapshot.schema_version,
    snapshot_checksum: snapshot.snapshot_checksum,
    document_type: "CREDIT_NOTE",
    number: snapshot.number,
    status: snapshot.status,
    currency: snapshot.currency,
    issue_date: snapshot.issue_date,
    reason_code: snapshot.reason_code,
    reason_text: snapshot.reason_text,
    issuer: snapshot.issuer_snapshot,
    recipient: snapshot.recipient_snapshot,
    lines: snapshot.lines,
    totals: snapshot.totals,
    source_invoice_snapshot: snapshot.source_invoice_snapshot,
    refs: snapshot.refs,
    frozen_at: snapshot.frozen_at,
  };
}
