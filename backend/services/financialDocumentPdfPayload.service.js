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
  const rawSnapBank = issuerSrc.bank;
  const snapBank =
    rawSnapBank != null && typeof rawSnapBank === "object" && !Array.isArray(rawSnapBank)
      ? rawSnapBank
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

function trimOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Adresse fiche client → format attendu par le renderer PDF (objet line1 / line2 / …).
 * @param {object|null|undefined} row — ligne `clients`
 * @returns {object|null}
 */
export function clientRowToInvoicePdfAddressShape(row) {
  if (!row || typeof row !== "object") return null;
  const line1 = trimOrNull(row.address_line_1);
  const line2 = trimOrNull(row.address_line_2);
  const postal_code = trimOrNull(row.postal_code);
  const city = trimOrNull(row.city);
  const country = trimOrNull(row.country);
  if (!line1 && !line2 && !postal_code && !city && !country) return null;
  return { line1, line2, postal_code, city, country };
}

/**
 * Ligne `addresses` → même forme que {@link clientRowToInvoicePdfAddressShape}.
 * @param {object|null|undefined} row
 * @returns {object|null}
 */
export function addressesTableRowToInvoicePdfAddressShape(row) {
  if (!row || typeof row !== "object") return null;
  const line1 = trimOrNull(row.address_line1);
  const line2 = trimOrNull(row.address_line2);
  const postal_code = trimOrNull(row.postal_code);
  const city = trimOrNull(row.city);
  const country = trimOrNull(row.country_code);
  if (!line1 && !line2 && !postal_code && !city && !country) return null;
  return { line1, line2, postal_code, city, country };
}

/**
 * Rendu PDF facture uniquement : injecte l’adresse lue sur les fiches client / lead (sans persister le snapshot).
 * Priorité : client si données présentes ; sinon adresse facturation lead → site → champ texte legacy `leads.address`.
 * @param {object} payload
 * @param {{ clientRow?: object|null, leadRow?: object|null }} enrich
 * @returns {object}
 */
export function mergeLiveBillingAddressIntoInvoicePdfPayload(payload, enrich) {
  if (!payload || typeof payload !== "object") return payload;
  const clientShape = clientRowToInvoicePdfAddressShape(enrich?.clientRow);
  let address = null;
  if (clientShape) {
    address = clientShape;
  } else if (enrich?.leadRow && typeof enrich.leadRow === "object") {
    const lr = enrich.leadRow;
    const billing = addressesTableRowToInvoicePdfAddressShape({
      address_line1: lr.b_line1,
      address_line2: lr.b_line2,
      postal_code: lr.b_postal,
      city: lr.b_city,
      country_code: lr.b_country,
    });
    const site = addressesTableRowToInvoicePdfAddressShape({
      address_line1: lr.s_line1,
      address_line2: lr.s_line2,
      postal_code: lr.s_postal,
      city: lr.s_city,
      country_code: lr.s_country,
    });
    const legacy = trimOrNull(lr.legacy_address);
    if (billing) address = billing;
    else if (site) address = site;
    else if (legacy) address = legacy;
  }
  if (address == null) return payload;
  const recipientSrc =
    payload.recipient !== null && payload.recipient !== undefined && typeof payload.recipient === "object"
      ? payload.recipient
      : {};
  const recipient = { ...recipientSrc, address };
  return { ...payload, recipient };
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
