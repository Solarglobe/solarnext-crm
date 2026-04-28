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

/** Au moins une ligne utile hors seul pays (évite « France » seul sans rue). */
function invoicePdfAddressShapeHasStreetOrCity(shape) {
  if (!shape || typeof shape !== "object") return false;
  return !!(shape.line1 || shape.line2 || shape.postal_code || shape.city);
}

function clientBillingToInvoicePdfShape(row) {
  const line1 = trimOrNull(row.address_line_1);
  const line2 = trimOrNull(row.address_line_2);
  const postal_code = trimOrNull(row.postal_code);
  const city = trimOrNull(row.city);
  const country = trimOrNull(row.country);
  if (!line1 && !line2 && !postal_code && !city && !country) return null;
  return { line1, line2, postal_code, city, country };
}

/** Adresse chantier / installation sur la fiche client (souvent remplie quand le siège est vide). */
function clientInstallationToInvoicePdfShape(row) {
  const line1 = trimOrNull(row.installation_address_line_1);
  const postal_code = trimOrNull(row.installation_postal_code);
  const city = trimOrNull(row.installation_city);
  const country = trimOrNull(row.country);
  if (!line1 && !postal_code && !city && !country) return null;
  return { line1, line2: null, postal_code, city, country };
}

/**
 * Adresse fiche client → format attendu par le renderer PDF (objet line1 / line2 / …).
 * Priorité : adresse postale « siège » ; sinon adresse d’installation (alignée conversion lead → client).
 * @param {object|null|undefined} row — ligne `clients` (colonnes billing + installation_*)
 * @returns {object|null}
 */
export function clientRowToInvoicePdfAddressShape(row) {
  if (!row || typeof row !== "object") return null;
  const billing = clientBillingToInvoicePdfShape(row);
  if (billing && invoicePdfAddressShapeHasStreetOrCity(billing)) return billing;
  const inst = clientInstallationToInvoicePdfShape(row);
  if (inst && invoicePdfAddressShapeHasStreetOrCity(inst)) return inst;
  return null;
}

/**
 * Ligne `addresses` (+ formatted éventuel) → même forme que {@link clientRowToInvoicePdfAddressShape}.
 * Utilise `formatted_address` pour retrouver n° de rue lorsque `address_line1` est sans numéro.
 * @param {object|null|undefined} row — attend address_line1, address_line2, postal_code, city, country_code, formatted_address?
 * @returns {object|null}
 */
export function addressesTableRowToInvoicePdfAddressShape(row) {
  if (!row || typeof row !== "object") return null;
  return addressPartsToInvoicePdfShape({
    address_line1: row.address_line1,
    address_line2: row.address_line2,
    postal_code: row.postal_code,
    city: row.city,
    country_code: row.country_code,
    formatted_address: row.formatted_address,
  });
}

/**
 * @param {object} parts
 * @returns {object|null}
 */
function addressPartsToInvoicePdfShape(parts) {
  const line1Plain = trimOrNull(parts.address_line1);
  const line2 = trimOrNull(parts.address_line2);
  const postal_code = trimOrNull(parts.postal_code);
  const city = trimOrNull(parts.city);
  const country = trimOrNull(parts.country_code);
  const formatted = trimOrNull(parts.formatted_address);

  if (formatted && postal_code && formatted.includes(postal_code)) {
    const idx = formatted.indexOf(postal_code);
    const streetPart = formatted.slice(0, idx).trim();
    const afterPostal = formatted.slice(idx + String(postal_code).length).trim();
    const line1 = streetPart || line1Plain || formatted;
    if (!invoicePdfAddressShapeHasStreetOrCity({ line1, line2, postal_code, city, country })) return null;
    return {
      line1,
      line2,
      postal_code,
      city: city || afterPostal || null,
      country,
    };
  }

  if (formatted && (!line1Plain || (formatted.length > line1Plain.length && /\d/.test(formatted) && !/\d/.test(line1Plain)))) {
    const shape = {
      line1: formatted,
      line2,
      postal_code,
      city,
      country,
    };
    if (!invoicePdfAddressShapeHasStreetOrCity(shape)) return null;
    return shape;
  }

  const line1 = line1Plain;
  if (!line1 && !line2 && !postal_code && !city && !country) return null;
  const shape = { line1, line2, postal_code, city, country };
  if (!invoicePdfAddressShapeHasStreetOrCity(shape)) return null;
  return shape;
}

/**
 * Rendu PDF facture uniquement : injecte l’adresse lue sur les fiches (sans persister le snapshot).
 * Priorité : **lead** (facturation → site → texte) pour coller à la fiche dossier ; sinon client (siège → installation).
 * @param {object} payload
 * @param {{ clientRow?: object|null, leadRow?: object|null }} enrich
 * @returns {object}
 */
export function mergeLiveBillingAddressIntoInvoicePdfPayload(payload, enrich) {
  if (!payload || typeof payload !== "object") return payload;
  let address = null;

  if (enrich?.leadRow && typeof enrich.leadRow === "object") {
    const lr = enrich.leadRow;
    const billing = addressPartsToInvoicePdfShape({
      address_line1: lr.b_line1,
      address_line2: lr.b_line2,
      postal_code: lr.b_postal,
      city: lr.b_city,
      country_code: lr.b_country,
      formatted_address: lr.b_formatted,
    });
    const site = addressPartsToInvoicePdfShape({
      address_line1: lr.s_line1,
      address_line2: lr.s_line2,
      postal_code: lr.s_postal,
      city: lr.s_city,
      country_code: lr.s_country,
      formatted_address: lr.s_formatted,
    });
    const legacy = trimOrNull(lr.legacy_address);
    if (billing) address = billing;
    else if (site) address = site;
    else if (legacy) address = legacy;
  }

  if (!address) {
    address = clientRowToInvoicePdfAddressShape(enrich?.clientRow);
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
