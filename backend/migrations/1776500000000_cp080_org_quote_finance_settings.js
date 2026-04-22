/**
 * CP-080 — Paramètres organisations : quote.prefix, quote.next_number, finance.default_vat_rate
 * Non destructif : merge dans settings_json, alignement next_number sur devis existants + document_sequences.
 */

import {
  extractAnnualSequenceFromStoredNumber,
  sanitizeDocumentPrefixInput,
  resolveDocumentPrefixForNumbering,
} from "../utils/documentPrefix.js";

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = async (pgm) => {
  const year = new Date().getFullYear();
  const { rows } = await pgm.db.query(`SELECT id, settings_json FROM organizations`);

  for (const row of rows) {
    const s =
      row.settings_json && typeof row.settings_json === "object" && !Array.isArray(row.settings_json)
        ? { ...row.settings_json }
        : {};
    const doc = s.documents && typeof s.documents === "object" ? s.documents : {};

    if (typeof s.quote !== "object" || s.quote === null) s.quote = {};
    if (s.quote.prefix == null || String(s.quote.prefix).trim() === "") {
      const fromDoc = doc.document_prefix != null ? sanitizeDocumentPrefixInput(doc.document_prefix) : "";
      s.quote.prefix = resolveDocumentPrefixForNumbering(fromDoc);
    } else {
      s.quote.prefix = resolveDocumentPrefixForNumbering(sanitizeDocumentPrefixInput(s.quote.prefix));
    }

    const qRes = await pgm.db.query(
      `SELECT quote_number FROM quotes WHERE organization_id = $1 AND (archived_at IS NULL)`,
      [row.id]
    );
    let maxFromQuotes = 0;
    for (const qr of qRes.rows) {
      const n = extractAnnualSequenceFromStoredNumber(qr.quote_number, "QUOTE", year);
      if (n > maxFromQuotes) maxFromQuotes = n;
    }
    const seqRes = await pgm.db.query(
      `SELECT last_value FROM document_sequences WHERE organization_id = $1 AND document_kind = 'QUOTE' AND year = $2`,
      [row.id, year]
    );
    const lastSeq = seqRes.rows[0]?.last_value != null ? Number(seqRes.rows[0].last_value) : 0;
    const maxEff = Math.max(maxFromQuotes, lastSeq);
    s.quote.next_number = maxEff + 1;

    if (typeof s.finance !== "object" || s.finance === null) s.finance = {};
    if (s.finance.default_vat_rate == null || s.finance.default_vat_rate === "") {
      s.finance.default_vat_rate = 20;
    }

    await pgm.db.query(`UPDATE organizations SET settings_json = $1::jsonb WHERE id = $2`, [JSON.stringify(s), row.id]);
  }
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const down = () => {};
