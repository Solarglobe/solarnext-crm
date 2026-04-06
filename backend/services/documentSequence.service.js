/**
 * Numérotation atomique via document_sequences (QUOTE | INVOICE | CREDIT_NOTE).
 * Formats officiels : {PREFIX}-DEV-YYYY-NNNN, {PREFIX}-FACT-YYYY-NNNN, {PREFIX}-AVR-YYYY-NNNN
 * (PREFIX depuis organizations.settings_json.documents.document_prefix, défaut ORG).
 * Compatibilité lecture / sync : anciens SGQ- / FAC- / AVR- (sans segment DEV/FACT).
 */

import { pool } from "../config/db.js";
import {
  buildOfficialDocumentNumber,
  extractAnnualSequenceFromStoredNumber,
  resolveDocumentPrefixForNumbering,
} from "../utils/documentPrefix.js";

/**
 * @param {import("pg").PoolClient} client
 * @param {string} organizationId
 * @returns {Promise<string>} préfixe brut settings (chaîne vide si absent → ORG au build)
 */
async function getOrganizationDocumentPrefixRaw(client, organizationId) {
  const r = await client.query(`SELECT settings_json FROM organizations WHERE id = $1`, [organizationId]);
  const raw = r.rows[0]?.settings_json?.documents?.document_prefix;
  return raw == null ? "" : String(raw);
}

/**
 * Aligne last_value sur les numéros déjà présents (formats legacy SGQ/FAC/AVR et nouveaux PREFIX-DEV/FACT/AVR).
 */
async function syncSequenceWithExistingDocuments(client, organizationId, documentKind, year) {
  let maxFromRows = 0;
  if (documentKind === "QUOTE") {
    const r = await client.query(
      `SELECT quote_number FROM quotes
       WHERE organization_id = $1 AND (archived_at IS NULL)`,
      [organizationId]
    );
    for (const row of r.rows) {
      const n = extractAnnualSequenceFromStoredNumber(row.quote_number, "QUOTE", year);
      if (n > maxFromRows) maxFromRows = n;
    }
  } else if (documentKind === "INVOICE") {
    const r = await client.query(
      `SELECT invoice_number FROM invoices
       WHERE organization_id = $1 AND (archived_at IS NULL)`,
      [organizationId]
    );
    for (const row of r.rows) {
      const n = extractAnnualSequenceFromStoredNumber(row.invoice_number, "INVOICE", year);
      if (n > maxFromRows) maxFromRows = n;
    }
  } else if (documentKind === "CREDIT_NOTE") {
    const r = await client.query(
      `SELECT credit_note_number FROM credit_notes
       WHERE organization_id = $1 AND (archived_at IS NULL)`,
      [organizationId]
    );
    for (const row of r.rows) {
      const n = extractAnnualSequenceFromStoredNumber(row.credit_note_number, "CREDIT_NOTE", year);
      if (n > maxFromRows) maxFromRows = n;
    }
  }

  if (maxFromRows <= 0) return;

  await client.query(
    `
    INSERT INTO document_sequences (organization_id, document_kind, year, last_value, updated_at)
    VALUES ($1, $2, $3, $4, now())
    ON CONFLICT (organization_id, document_kind, year)
    DO UPDATE SET
      last_value = GREATEST(document_sequences.last_value, $4),
      updated_at = now()
    `,
    [organizationId, documentKind, year, maxFromRows]
  );
}

/**
 * @param {import("pg").PoolClient} client
 * @param {string} organizationId
 * @param {'QUOTE'|'INVOICE'|'CREDIT_NOTE'} documentKind
 * @param {number} [year]
 * @returns {Promise<{ fullNumber: string, seq: number, year: number }>}
 */
export async function allocateNextDocumentNumber(client, organizationId, documentKind, year) {
  const y = year ?? new Date().getFullYear();
  const prefixRaw = await getOrganizationDocumentPrefixRaw(client, organizationId);
  const orgPrefix = resolveDocumentPrefixForNumbering(prefixRaw);

  await syncSequenceWithExistingDocuments(client, organizationId, documentKind, y);

  const bump = await client.query(
    `
    INSERT INTO document_sequences (organization_id, document_kind, year, last_value, updated_at)
    VALUES ($1, $2, $3, 1, now())
    ON CONFLICT (organization_id, document_kind, year)
    DO UPDATE SET
      last_value = document_sequences.last_value + 1,
      updated_at = now()
    RETURNING last_value
    `,
    [organizationId, documentKind, y]
  );
  const seq = bump.rows[0].last_value;
  const fullNumber = buildOfficialDocumentNumber(orgPrefix, documentKind, y, seq);
  return { fullNumber, seq, year: y };
}