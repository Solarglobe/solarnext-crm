/**
 * Snapshots émetteur / destinataire pour documents financiers (source organizations + clients / leads).
 */

import { pool } from "../config/db.js";

/**
 * @param {string} organizationId
 * @returns {Promise<object|null>}
 */
export async function loadOrganizationIssuerPayload(organizationId) {
  const r = await pool.query(
    `SELECT id, name, legal_name, trade_name, siret, vat_number, rcs, capital_amount,
            address_line1, address_line2, postal_code, city, country, phone, email, website,
            iban, bic, bank_name, default_payment_terms, default_invoice_notes,
            logo_url, pdf_primary_color, pdf_secondary_color
     FROM organizations WHERE id = $1`,
    [organizationId]
  );
  return r.rows[0] ?? null;
}

/**
 * Snapshot JSON émetteur (entreprise) pour PDF / archivage.
 * @param {object} orgRow
 */
export function buildIssuerSnapshotFromOrganizationRow(orgRow) {
  if (!orgRow) return {};
  return {
    source: "organization",
    organization_id: orgRow.id,
    display_name: orgRow.legal_name || orgRow.trade_name || orgRow.name,
    legal_name: orgRow.legal_name ?? null,
    trade_name: orgRow.trade_name ?? null,
    siret: orgRow.siret ?? null,
    vat_number: orgRow.vat_number ?? null,
    rcs: orgRow.rcs ?? null,
    capital_amount: orgRow.capital_amount ?? null,
    address: {
      line1: orgRow.address_line1 ?? null,
      line2: orgRow.address_line2 ?? null,
      postal_code: orgRow.postal_code ?? null,
      city: orgRow.city ?? null,
      country: orgRow.country ?? null,
    },
    phone: orgRow.phone ?? null,
    email: orgRow.email ?? null,
    website: orgRow.website ?? null,
    bank: {
      iban: orgRow.iban ?? null,
      bic: orgRow.bic ?? null,
      bank_name: orgRow.bank_name ?? null,
    },
    branding: {
      logo_url: orgRow.logo_url ?? null,
      pdf_primary_color:
        orgRow.pdf_primary_color != null && String(orgRow.pdf_primary_color).trim() !== ""
          ? String(orgRow.pdf_primary_color).trim()
          : null,
      pdf_secondary_color: orgRow.pdf_secondary_color ?? null,
    },
  };
}

/**
 * @param {string} clientId
 * @param {string} organizationId
 */
export async function loadClientRecipientPayload(clientId, organizationId) {
  const r = await pool.query(
    `SELECT id, company_name, first_name, last_name, email, phone
     FROM clients WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [clientId, organizationId]
  );
  return r.rows[0] ?? null;
}

export function buildRecipientSnapshotFromClientRow(clientRow) {
  if (!clientRow) return {};
  return {
    source: "client",
    client_id: clientRow.id,
    company_name: clientRow.company_name ?? null,
    first_name: clientRow.first_name ?? null,
    last_name: clientRow.last_name ?? null,
    email: clientRow.email ?? null,
    phone: clientRow.phone ?? null,
  };
}

/**
 * @param {string} leadId
 * @param {string} organizationId
 */
export async function loadLeadRecipientPayload(leadId, organizationId) {
  const r = await pool.query(
    `SELECT id, first_name, last_name, email, phone, address
     FROM leads WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [leadId, organizationId]
  );
  return r.rows[0] ?? null;
}

export function buildRecipientSnapshotFromLeadRow(leadRow) {
  if (!leadRow) return {};
  return {
    source: "lead",
    lead_id: leadRow.id,
    first_name: leadRow.first_name ?? null,
    last_name: leadRow.last_name ?? null,
    email: leadRow.email ?? null,
    phone: leadRow.phone ?? null,
    address: leadRow.address ?? null,
  };
}

/**
 * Construit issuer + recipient pour un devis (client ou lead-only via métadonnées).
 * @param {object} quoteRow — ligne quotes
 * @param {string} organizationId
 */
export async function buildQuoteIssuerRecipientSnapshots(quoteRow, organizationId) {
  const org = await loadOrganizationIssuerPayload(organizationId);
  const issuer = buildIssuerSnapshotFromOrganizationRow(org);

  let recipient = {};
  if (quoteRow.client_id) {
    const cli = await loadClientRecipientPayload(quoteRow.client_id, organizationId);
    recipient = buildRecipientSnapshotFromClientRow(cli);
  } else if (quoteRow.metadata_json?.customer_snapshot) {
    recipient = {
      source: "lead_snapshot",
      ...quoteRow.metadata_json.customer_snapshot,
    };
  }

  return { issuer_snapshot: issuer, recipient_snapshot: recipient };
}

/**
 * Snapshot facture : destinataire = client si présent, sinon lead (prospect).
 */
export async function buildInvoiceIssuerRecipientSnapshots(invoiceRow, organizationId) {
  const org = await loadOrganizationIssuerPayload(organizationId);
  const issuer = buildIssuerSnapshotFromOrganizationRow(org);
  if (invoiceRow.client_id) {
    const cli = await loadClientRecipientPayload(invoiceRow.client_id, organizationId);
    const recipient = buildRecipientSnapshotFromClientRow(cli);
    return { issuer_snapshot: issuer, recipient_snapshot: recipient };
  }
  if (invoiceRow.lead_id) {
    const ld = await loadLeadRecipientPayload(invoiceRow.lead_id, organizationId);
    const recipient = buildRecipientSnapshotFromLeadRow(ld);
    return { issuer_snapshot: issuer, recipient_snapshot: recipient };
  }
  return { issuer_snapshot: issuer, recipient_snapshot: {} };
}

/**
 * Figement du devis source sur la facture (références + totaux au moment de l'émission).
 * @param {object} quoteRow
 */
export function buildSourceQuoteSnapshot(quoteRow) {
  if (!quoteRow) return {};
  return {
    quote_id: quoteRow.id,
    quote_number: quoteRow.quote_number ?? null,
    status: quoteRow.status ?? null,
    total_ht: quoteRow.total_ht != null ? Number(quoteRow.total_ht) : null,
    total_vat: quoteRow.total_vat != null ? Number(quoteRow.total_vat) : null,
    total_ttc: quoteRow.total_ttc != null ? Number(quoteRow.total_ttc) : null,
    valid_until: quoteRow.valid_until ?? null,
    currency: quoteRow.currency ?? "EUR",
  };
}

/**
 * Figement de la facture source sur l'avoir (références + totaux).
 * @param {object} invoiceRow
 */
export function buildSourceInvoiceSnapshot(invoiceRow) {
  if (!invoiceRow) return {};
  return {
    invoice_id: invoiceRow.id,
    invoice_number: invoiceRow.invoice_number ?? null,
    status: invoiceRow.status ?? null,
    total_ht: invoiceRow.total_ht != null ? Number(invoiceRow.total_ht) : null,
    total_vat: invoiceRow.total_vat != null ? Number(invoiceRow.total_vat) : null,
    total_ttc: invoiceRow.total_ttc != null ? Number(invoiceRow.total_ttc) : null,
    total_paid: invoiceRow.total_paid != null ? Number(invoiceRow.total_paid) : null,
    total_credited: invoiceRow.total_credited != null ? Number(invoiceRow.total_credited) : null,
    amount_due: invoiceRow.amount_due != null ? Number(invoiceRow.amount_due) : null,
    issue_date: invoiceRow.issue_date ?? null,
    currency: invoiceRow.currency ?? "EUR",
  };
}
