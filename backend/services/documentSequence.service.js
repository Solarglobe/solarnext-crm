/**
 * Numérotation atomique via document_sequences (QUOTE | INVOICE | CREDIT_NOTE).
 *
 * CP-080 HARDENING — anti-collision :
 * - Une ligne par (organization_id, document_kind, year) — contrainte UNIQUE côté DB.
 * - L’incrément est **une seule instruction** INSERT … ON CONFLICT DO UPDATE
 *   SET last_value = document_sequences.last_value + 1 RETURNING last_value.
 *   PostgreSQL verrouille la ligne cible : les transactions concurrentes sur la même
 *   clé sont sérialisées ; pas deux fois le même last_value pour la même ligne.
 * - Appeler uniquement depuis une transaction (client déjà en BEGIN) : l’appelant
 *   assigne ensuite quote_number dans la même transaction → COMMIT atomique.
 * - Côté métier : contrainte UNIQUE (organization_id, quote_number) sur `quotes`
 *   (migration quotes + garde-fou 1776500001000) — filet si logique applicative dévie.
 *
 * Devis : {PREFIX}-{YYYY}-{NNNN} — préfixe settings_json.quote.prefix puis documents.document_prefix, défaut ORG.
 * Factures / avoirs : {PREFIX}-FACT|AVR-{YYYY}-{NNNN}.
 */

import { pool } from "../config/db.js";
import {
  buildOfficialDocumentNumber,
  buildQuoteCompactOfficialNumber,
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
 * Préfixe numérotation devis : quote.prefix prioritaire, sinon documents.document_prefix.
 */
async function getQuoteOrganizationPrefixRaw(client, organizationId) {
  const r = await client.query(`SELECT settings_json FROM organizations WHERE id = $1`, [organizationId]);
  const s = r.rows[0]?.settings_json ?? {};
  const qp = s.quote?.prefix;
  if (qp != null && String(qp).trim() !== "") return String(qp);
  const raw = s.documents?.document_prefix;
  return raw == null ? "" : String(raw);
}

/**
 * Met à jour settings_json.quote.next_number (miroir du prochain index séquentiel).
 */
async function syncQuoteNextNumberInSettings(client, organizationId, nextNumber) {
  await client.query(`SELECT id FROM organizations WHERE id = $1 FOR UPDATE`, [organizationId]);
  const r = await client.query(`SELECT settings_json FROM organizations WHERE id = $1`, [organizationId]);
  const s = r.rows[0]?.settings_json ?? {};
  const merged = { ...s, quote: { ...(typeof s.quote === "object" && s.quote ? s.quote : {}), next_number: nextNumber } };
  await client.query(`UPDATE organizations SET settings_json = $1::jsonb WHERE id = $2`, [
    JSON.stringify(merged),
    organizationId,
  ]);
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
  const prefixRaw =
    documentKind === "QUOTE"
      ? await getQuoteOrganizationPrefixRaw(client, organizationId)
      : await getOrganizationDocumentPrefixRaw(client, organizationId);
  const orgPrefix = resolveDocumentPrefixForNumbering(prefixRaw);

  await syncSequenceWithExistingDocuments(client, organizationId, documentKind, y);

  /** Incrément atomique (équivalent UPDATE … SET last_value = last_value + 1 … RETURNING) via UPSERT une ligne. */
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
  let fullNumber;
  if (documentKind === "QUOTE") {
    fullNumber = buildQuoteCompactOfficialNumber(orgPrefix, y, seq);
    await syncQuoteNextNumberInSettings(client, organizationId, seq + 1);
  } else {
    fullNumber = buildOfficialDocumentNumber(orgPrefix, documentKind, y, seq);
  }
  return { fullNumber, seq, year: y };
}