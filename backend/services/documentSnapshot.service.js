/**
 * Snapshots émetteur / destinataire pour documents financiers (source organizations + clients / leads).
 */

import { pool } from "../config/db.js";
import {
  addressesTableRowToInvoicePdfAddressShape,
  clientRowToInvoicePdfAddressShape,
} from "./financialDocumentPdfPayload.service.js";

/**
 * @param {string} organizationId
 * @returns {Promise<object|null>}
 */
export async function loadOrganizationIssuerPayload(organizationId) {
  const r = await pool.query(
    `SELECT id, name, legal_name, trade_name, siret, rge_number, vat_number, rcs, capital_amount,
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
    rge_number: orgRow.rge_number ?? null,
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
    `SELECT id, company_name, first_name, last_name, email, phone, siret,
            address_line_1, address_line_2, postal_code, city, country,
            installation_address_line_1, installation_postal_code, installation_city
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
    siret: clientRow.siret ?? null,
    address: clientRowToInvoicePdfAddressShape(clientRow),
  };
}

/**
 * @param {string} leadId
 * @param {string} organizationId
 */
export async function loadLeadRecipientPayload(leadId, organizationId) {
  const r = await pool.query(
    `SELECT l.id, l.first_name, l.last_name, l.email, l.phone, l.address,
            l.customer_type, l.company_name, l.contact_first_name, l.contact_last_name, l.siret,
            b.address_line1 AS b_line1,
            b.address_line2 AS b_line2,
            b.postal_code AS b_postal,
            b.city AS b_city,
            b.country_code AS b_country,
            b.formatted_address AS b_formatted,
            s.address_line1 AS s_line1,
            s.address_line2 AS s_line2,
            s.postal_code AS s_postal,
            s.city AS s_city,
            s.country_code AS s_country,
            s.formatted_address AS s_formatted
     FROM leads l
     LEFT JOIN addresses b ON b.id = l.billing_address_id AND b.organization_id = l.organization_id
     LEFT JOIN addresses s ON s.id = l.site_address_id AND s.organization_id = l.organization_id
     WHERE l.id = $1 AND l.organization_id = $2 AND (l.archived_at IS NULL)`,
    [leadId, organizationId]
  );
  return r.rows[0] ?? null;
}

export function buildRecipientSnapshotFromLeadRow(leadRow) {
  if (!leadRow) return {};
  const isPro = String(leadRow.customer_type || "").toUpperCase() === "PRO";
  const billingAddress = addressesTableRowToInvoicePdfAddressShape({
    address_line1: leadRow.b_line1,
    address_line2: leadRow.b_line2,
    postal_code: leadRow.b_postal,
    city: leadRow.b_city,
    country_code: leadRow.b_country,
    formatted_address: leadRow.b_formatted,
  });
  const siteAddress = addressesTableRowToInvoicePdfAddressShape({
    address_line1: leadRow.s_line1,
    address_line2: leadRow.s_line2,
    postal_code: leadRow.s_postal,
    city: leadRow.s_city,
    country_code: leadRow.s_country,
    formatted_address: leadRow.s_formatted,
  });
  return {
    source: "lead",
    lead_id: leadRow.id,
    company_name: isPro ? leadRow.company_name ?? null : null,
    first_name: isPro ? leadRow.contact_first_name ?? null : leadRow.first_name ?? null,
    last_name: isPro ? leadRow.contact_last_name ?? null : leadRow.last_name ?? null,
    email: leadRow.email ?? null,
    phone: leadRow.phone ?? null,
    siret: leadRow.siret ?? null,
    address: billingAddress ?? siteAddress ?? leadRow.address ?? null,
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
    billing_total_ht: quoteRow.billing_total_ht != null ? Number(quoteRow.billing_total_ht) : null,
    billing_total_vat: quoteRow.billing_total_vat != null ? Number(quoteRow.billing_total_vat) : null,
    billing_total_ttc: quoteRow.billing_total_ttc != null ? Number(quoteRow.billing_total_ttc) : null,
    billing_locked_at: quoteRow.billing_locked_at ?? null,
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
