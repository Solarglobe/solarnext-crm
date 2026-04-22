/**
 * CP-ADMIN-ORG-04 — Structure Organisation complète
 * Colonnes métier pour devis, factures, propositions commerciales, branding.
 * Migration idempotente — settings_json conservé.
 */

export const shorthands = undefined;

const COLS = [
  // Identité
  { name: "legal_name", type: "varchar(255)" },
  { name: "trade_name", type: "varchar(255)" },
  { name: "siret", type: "varchar(255)" },
  { name: "vat_number", type: "varchar(255)" },
  { name: "rcs", type: "varchar(255)" },
  { name: "capital_amount", type: "varchar(255)" },
  // Adresse
  { name: "address_line1", type: "varchar(255)" },
  { name: "address_line2", type: "varchar(255)" },
  { name: "postal_code", type: "varchar(255)" },
  { name: "city", type: "varchar(255)" },
  { name: "country", type: "varchar(255)" },
  // Contact
  { name: "phone", type: "varchar(255)" },
  { name: "email", type: "varchar(255)" },
  { name: "website", type: "varchar(255)" },
  // Banque / Facturation
  { name: "iban", type: "varchar(255)" },
  { name: "bic", type: "varchar(255)" },
  { name: "bank_name", type: "varchar(255)" },
  { name: "default_payment_terms", type: "text" },
  { name: "default_invoice_notes", type: "text" },
  { name: "default_quote_validity_days", type: "integer", default: "DEFAULT 30" },
  { name: "default_invoice_due_days", type: "integer", default: "DEFAULT 30" },
  { name: "default_vat_rate", type: "numeric", default: "DEFAULT 20.0" },
  { name: "quote_prefix", type: "varchar(50)", default: "DEFAULT 'DEV'" },
  { name: "invoice_prefix", type: "varchar(50)", default: "DEFAULT 'FAC'" },
  // Branding futur
  { name: "logo_url", type: "varchar(512)" },
  { name: "logo_dark_url", type: "varchar(512)" },
  { name: "pdf_primary_color", type: "varchar(50)" },
  { name: "pdf_secondary_color", type: "varchar(50)" },
];

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = async (pgm) => {
  for (const col of COLS) {
    const def = col.default !== undefined
      ? `${col.type} ${col.default}`
      : col.type;
    pgm.sql(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ${col.name} ${def}`);
  }
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = async (pgm) => {
  for (const col of COLS) {
    pgm.sql(`ALTER TABLE organizations DROP COLUMN IF EXISTS ${col.name}`);
  }
};
