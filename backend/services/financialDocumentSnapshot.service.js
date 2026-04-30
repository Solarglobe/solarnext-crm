/**
 * Snapshot documentaire officiel (vérité figée) — distinct des données live.
 * Figé au passage SENT (devis), ISSUED (facture / avoir).
 */

import { createHash } from "crypto";
import { buildQuotePdfPayloadFromSnapshot } from "./financialDocumentPdfPayload.service.js";

export const FINANCIAL_DOCUMENT_SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * Empreinte stable du contenu figé (sans le champ snapshot_checksum lui-même).
 * @param {object} body
 */
export function computeSnapshotChecksum(body) {
  const { snapshot_checksum: _omit, ...rest } = body || {};
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

function num(v) {
  return v != null ? Number(v) : null;
}

function roundMoney2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

/**
 * Acompte structuré figé pour PDF (metadata_json.deposit + total TTC document).
 * @param {object} meta — metadata_json parsé
 * @param {number|string|null|undefined} totalTtcDocument — total TTC du devis (après remise document)
 * @returns {{ deposit: object|null, deposit_display: object|null }}
 */
export function buildQuoteDepositFreeze(meta, totalTtcDocument) {
  const ttc = Math.max(0, roundMoney2(totalTtcDocument));
  /** Aucun acompte structuré exploitable si le devis n’a pas de total TTC positif. */
  if (ttc <= 0.0001) {
    return { deposit: null, deposit_display: null };
  }
  let dep = meta?.deposit;
  if ((!dep || typeof dep !== "object") && meta?.deposit_percent != null) {
    const p = Number(meta.deposit_percent);
    if (Number.isFinite(p) && p > 0) {
      dep = { type: "PERCENT", value: Math.min(100, p) };
    }
  }
  if (!dep || typeof dep !== "object") {
    return { deposit: null, deposit_display: null };
  }
  const t = String(dep.type || "").toUpperCase();
  const v = Number(dep.value);
  if (!Number.isFinite(v) || v <= 0) {
    return { deposit: null, deposit_display: null };
  }
  const noteRaw = dep.note != null && String(dep.note).trim() !== "" ? String(dep.note).slice(0, 500) : null;

  if (t === "PERCENT") {
    const pct = Math.min(100, Math.max(0, v));
    const amountTtc = roundMoney2((ttc * pct) / 100);
    return {
      deposit: {
        type: "PERCENT",
        value: pct,
        ...(noteRaw ? { note: noteRaw } : {}),
      },
      deposit_display: {
        mode: "PERCENT",
        percent: pct,
        total_ttc_document: ttc,
        amount_ttc: amountTtc,
        ...(noteRaw ? { note: noteRaw } : {}),
      },
    };
  }
  if (t === "AMOUNT") {
    const amt = roundMoney2(Math.min(ttc, Math.max(0, v)));
    return {
      deposit: {
        type: "AMOUNT",
        value: amt,
        ...(noteRaw ? { note: noteRaw } : {}),
      },
      deposit_display: {
        mode: "AMOUNT",
        amount_ttc: amt,
        ...(noteRaw ? { note: noteRaw } : {}),
      },
    };
  }
  return { deposit: null, deposit_display: null };
}

function parseJsonb(val) {
  if (val == null) return {};
  if (typeof val === "object") return val;
  try {
    return JSON.parse(String(val));
  } catch {
    return {};
  }
}

/** Annexes légales optionnelles figées dans le snapshot (metadata_json.legal_documents au gel). */
function parseLegalDocumentsFromMeta(meta) {
  const ld = meta?.legal_documents;
  if (!ld || typeof ld !== "object") {
    return { include_rge: false, include_decennale: false };
  }
  return {
    include_rge: Boolean(ld.include_rge),
    include_decennale: Boolean(ld.include_decennale),
  };
}

export function mapQuoteLine(row) {
  const snap = parseJsonb(row.snapshot_json);
  const refRaw = snap?.reference ?? snap?.product_reference ?? null;
  const reference =
    typeof refRaw === "string" && refRaw.trim() ? refRaw.trim().slice(0, 120) : null;
  const rawLineKind = snap?.line_kind;
  const line_kind =
    typeof rawLineKind === "string" && rawLineKind.trim() ? rawLineKind.trim() : null;
  return {
    label: row.label ?? null,
    description: row.description ?? null,
    reference,
    line_kind,
    quantity: num(row.quantity),
    unit_price_ht: num(row.unit_price_ht),
    discount_ht: num(row.discount_ht),
    vat_rate: num(row.vat_rate),
    total_line_ht: num(row.total_line_ht),
    total_line_vat: num(row.total_line_vat),
    total_line_ttc: num(row.total_line_ttc),
    position: row.position != null ? Number(row.position) : null,
  };
}

function mapInvoiceLine(row) {
  return {
    label: row.label ?? null,
    description: row.description ?? null,
    quantity: num(row.quantity),
    unit_price_ht: num(row.unit_price_ht),
    discount_ht: num(row.discount_ht),
    vat_rate: num(row.vat_rate),
    total_line_ht: num(row.total_line_ht),
    total_line_vat: num(row.total_line_vat),
    total_line_ttc: num(row.total_line_ttc),
    position: row.position != null ? Number(row.position) : null,
  };
}

function mapCreditNoteLine(row) {
  return mapInvoiceLine(row);
}

function computeQuoteTotalsFromSnapshotLines(lines) {
  let totalHt = 0;
  let totalVat = 0;
  let totalTtc = 0;
  for (const line of lines || []) {
    totalHt = roundMoney2(totalHt + num(line?.total_line_ht));
    totalVat = roundMoney2(totalVat + num(line?.total_line_vat));
    totalTtc = roundMoney2(totalTtc + num(line?.total_line_ttc));
  }
  return {
    total_ht: totalHt,
    total_vat: totalVat,
    total_ttc: totalTtc,
  };
}

function computeDocumentDiscountHtFromSnapshotLines(lines) {
  let discount = 0;
  for (const line of lines || []) {
    const kind = String(line?.line_kind || "").trim().toUpperCase();
    if (kind !== "DOCUMENT_DISCOUNT") continue;
    const lineHt = Number(line?.total_line_ht);
    if (!Number.isFinite(lineHt) || lineHt >= 0) continue;
    discount = roundMoney2(discount + Math.abs(lineHt));
  }
  return discount;
}

function warnIfQuoteSnapshotTotalsInconsistent(context, lines, totals) {
  const calc = computeQuoteTotalsFromSnapshotLines(lines);
  const dtH = roundMoney2(Math.abs(roundMoney2(Number(totals?.total_ht) || 0) - calc.total_ht));
  const dtV = roundMoney2(Math.abs(roundMoney2(Number(totals?.total_vat) || 0) - calc.total_vat));
  const dtT = roundMoney2(Math.abs(roundMoney2(Number(totals?.total_ttc) || 0) - calc.total_ttc));
  const ttcFromHv = roundMoney2((Number(totals?.total_ht) || 0) + (Number(totals?.total_vat) || 0));
  const ttcDelta = roundMoney2(Math.abs(ttcFromHv - roundMoney2(Number(totals?.total_ttc) || 0)));
  if (dtH > 0.01 || dtV > 0.01 || dtT > 0.01 || ttcDelta > 0.01) {
    console.warn("[financial_snapshot] quote_snapshot_inconsistent", {
      event: "quote_snapshot_inconsistent",
      ...context,
      totals,
      lines_totals: calc,
      deltas: {
        total_ht: dtH,
        total_vat: dtV,
        total_ttc: dtT,
        ttc_vs_ht_plus_vat: ttcDelta,
      },
    });
  }
}

/**
 * @param {object} opts
 * @param {object} opts.quoteRow
 * @param {object[]} opts.lineRows
 * @param {string} opts.organizationId
 * @param {string} opts.frozenAtIso
 * @param {string|null} opts.frozenBy
 * @param {string|null} opts.generatedFrom
 */
export function buildOfficialQuoteDocumentSnapshot(opts) {
  const { quoteRow, lineRows, organizationId, frozenAtIso, frozenBy, generatedFrom } = opts;
  const issuer = parseJsonb(quoteRow.issuer_snapshot);
  const recipient = parseJsonb(quoteRow.recipient_snapshot);
  const meta = parseJsonb(quoteRow.metadata_json);
  const mappedLines = (lineRows || []).map(mapQuoteLine);
  const computedTotals = computeQuoteTotalsFromSnapshotLines(mappedLines);
  const computedDiscountHt = computeDocumentDiscountHtFromSnapshotLines(mappedLines);
  const { deposit, deposit_display } = buildQuoteDepositFreeze(meta, computedTotals.total_ttc);
  const showLinePricing = meta.pdf_show_line_pricing !== false;
  const legal_documents = parseLegalDocumentsFromMeta(meta);

  const body = {
    schema_version: FINANCIAL_DOCUMENT_SNAPSHOT_SCHEMA_VERSION,
    document_type: "QUOTE",
    document_id: quoteRow.id,
    organization_id: organizationId,
    number: quoteRow.quote_number ?? null,
    status: quoteRow.status ?? null,
    sent_at: quoteRow.sent_at ?? null,
    issued_at: quoteRow.sent_at ?? null,
    currency: quoteRow.currency ?? "EUR",
    valid_until: quoteRow.valid_until ?? null,
    notes: quoteRow.notes ?? null,
    commercial_notes: meta.commercial_notes ?? null,
    technical_notes: meta.technical_notes ?? null,
    payment_terms: meta.payment_terms ?? null,
    discount_ht: computedDiscountHt,
    issuer_snapshot: issuer,
    recipient_snapshot: recipient,
    lines: mappedLines,
    totals: {
      total_ht: computedTotals.total_ht,
      total_vat: computedTotals.total_vat,
      total_ttc: computedTotals.total_ttc,
      discount_ht: computedDiscountHt,
    },
    /** Acompte structuré figé (même source que metadata_json.deposit au moment du gel). */
    deposit,
    /** Libellés / montants calculés pour affichage PDF (évite dépendance au live). */
    deposit_display,
    /** Affichage document client (figé au passage SENT) — le rendu PDF consommera ce bloc. */
    pdf_display: {
      show_line_pricing: showLinePricing,
    },
    legal_documents,
    refs: {
      lead_id: quoteRow.lead_id ?? null,
      client_id: quoteRow.client_id ?? null,
      study_id: quoteRow.study_id ?? null,
      study_version_id: quoteRow.study_version_id ?? null,
    },
    created_at: quoteRow.created_at ?? null,
    frozen_at: frozenAtIso,
    frozen_by: frozenBy ?? null,
    generated_from: generatedFrom ?? null,
  };
  warnIfQuoteSnapshotTotalsInconsistent(
    {
      quote_id: quoteRow.id ?? null,
      organization_id: organizationId ?? null,
      generated_from: generatedFrom ?? null,
    },
    mappedLines,
    body.totals
  );
  return { ...body, snapshot_checksum: computeSnapshotChecksum(body) };
}

/**
 * @param {object} opts
 * @param {object} opts.invoiceRow
 * @param {object[]} opts.lineRows
 * @param {object|null} opts.sourceQuoteRow
 * @param {string} opts.organizationId
 * @param {string} opts.frozenAtIso
 * @param {string|null} opts.frozenBy
 * @param {string|null} opts.generatedFrom
 */
export function buildOfficialInvoiceDocumentSnapshot(opts) {
  const { invoiceRow, lineRows, sourceQuoteRow, organizationId, frozenAtIso, frozenBy, generatedFrom } = opts;
  const issuer = parseJsonb(invoiceRow.issuer_snapshot);
  const recipient = parseJsonb(invoiceRow.recipient_snapshot);
  const sourceQuote =
    sourceQuoteRow && sourceQuoteRow.id
      ? {
          quote_id: sourceQuoteRow.id,
          quote_number: sourceQuoteRow.quote_number ?? null,
          status: sourceQuoteRow.status ?? null,
          total_ht: num(sourceQuoteRow.total_ht),
          total_vat: num(sourceQuoteRow.total_vat),
          total_ttc: num(sourceQuoteRow.total_ttc),
          billing_total_ht: num(sourceQuoteRow.billing_total_ht),
          billing_total_vat: num(sourceQuoteRow.billing_total_vat),
          billing_total_ttc: num(sourceQuoteRow.billing_total_ttc),
          billing_locked_at: sourceQuoteRow.billing_locked_at ?? null,
          valid_until: sourceQuoteRow.valid_until ?? null,
          currency: sourceQuoteRow.currency ?? "EUR",
        }
      : null;
  const sourceQuoteSnapshot = parseJsonb(invoiceRow.source_quote_snapshot);

  const body = {
    schema_version: FINANCIAL_DOCUMENT_SNAPSHOT_SCHEMA_VERSION,
    document_type: "INVOICE",
    document_id: invoiceRow.id,
    organization_id: organizationId,
    number: invoiceRow.invoice_number ?? null,
    status: invoiceRow.status ?? null,
    issue_date: invoiceRow.issue_date ?? null,
    issued_at: invoiceRow.issue_date ?? invoiceRow.created_at ?? null,
    currency: invoiceRow.currency ?? "EUR",
    due_date: invoiceRow.due_date ?? null,
    notes: invoiceRow.notes ?? null,
    payment_terms: invoiceRow.payment_terms ?? null,
    issuer_snapshot: issuer,
    recipient_snapshot: recipient,
    source_quote_snapshot: sourceQuoteSnapshot,
    source_quote: sourceQuote,
    lines: (lineRows || []).map(mapInvoiceLine),
    totals: {
      total_ht: num(invoiceRow.total_ht),
      total_vat: num(invoiceRow.total_vat),
      total_ttc: num(invoiceRow.total_ttc),
      total_paid: num(invoiceRow.total_paid),
      total_credited: num(invoiceRow.total_credited),
      amount_due: num(invoiceRow.amount_due),
    },
    refs: {
      client_id: invoiceRow.client_id ?? null,
      quote_id: invoiceRow.quote_id ?? null,
      lead_id: sourceQuoteRow?.lead_id ?? null,
      study_id: sourceQuoteRow?.study_id ?? null,
      study_version_id: sourceQuoteRow?.study_version_id ?? null,
      quote_billing_role:
        invoiceRow?.metadata_json &&
        typeof invoiceRow.metadata_json === "object" &&
        !Array.isArray(invoiceRow.metadata_json)
          ? String(invoiceRow.metadata_json.quote_billing_role ?? "").toUpperCase() || null
          : null,
    },
    created_at: invoiceRow.created_at ?? null,
    frozen_at: frozenAtIso,
    frozen_by: frozenBy ?? null,
    generated_from: generatedFrom ?? null,
  };
  return { ...body, snapshot_checksum: computeSnapshotChecksum(body) };
}

/**
 * @param {object} opts
 * @param {object} opts.creditNoteRow
 * @param {object[]} opts.lineRows
 * @param {object} opts.invoiceRow
 * @param {object|null} opts.sourceQuoteRow
 * @param {string} opts.organizationId
 * @param {string} opts.frozenAtIso
 * @param {string|null} opts.frozenBy
 * @param {string|null} opts.generatedFrom
 */
export function buildOfficialCreditNoteDocumentSnapshot(opts) {
  const { creditNoteRow, lineRows, invoiceRow, sourceQuoteRow, organizationId, frozenAtIso, frozenBy, generatedFrom } =
    opts;
  const issuer = parseJsonb(creditNoteRow.issuer_snapshot);
  const recipient = parseJsonb(creditNoteRow.recipient_snapshot);
  const sourceInv = parseJsonb(creditNoteRow.source_invoice_snapshot);

  const body = {
    schema_version: FINANCIAL_DOCUMENT_SNAPSHOT_SCHEMA_VERSION,
    document_type: "CREDIT_NOTE",
    document_id: creditNoteRow.id,
    organization_id: organizationId,
    number: creditNoteRow.credit_note_number ?? null,
    status: creditNoteRow.status ?? null,
    issue_date: creditNoteRow.issue_date ?? null,
    issued_at: creditNoteRow.issue_date ?? creditNoteRow.created_at ?? null,
    currency: creditNoteRow.currency ?? "EUR",
    reason_code: creditNoteRow.reason_code ?? null,
    reason_text: creditNoteRow.reason_text ?? null,
    issuer_snapshot: issuer,
    recipient_snapshot: recipient,
    source_invoice_snapshot: sourceInv,
    lines: (lineRows || []).map(mapCreditNoteLine),
    totals: {
      total_ht: num(creditNoteRow.total_ht),
      total_vat: num(creditNoteRow.total_vat),
      total_ttc: num(creditNoteRow.total_ttc),
    },
    refs: {
      client_id: creditNoteRow.client_id ?? null,
      invoice_id: creditNoteRow.invoice_id ?? null,
      quote_id: invoiceRow.quote_id ?? null,
      lead_id: sourceQuoteRow?.lead_id ?? null,
      study_id: sourceQuoteRow?.study_id ?? null,
      study_version_id: sourceQuoteRow?.study_version_id ?? null,
    },
    created_at: creditNoteRow.created_at ?? null,
    frozen_at: frozenAtIso,
    frozen_by: frozenBy ?? null,
    generated_from: generatedFrom ?? null,
  };
  return { ...body, snapshot_checksum: computeSnapshotChecksum(body) };
}

/**
 * @param {import("pg").PoolClient} client
 */
export async function persistQuoteOfficialDocumentSnapshot(client, quoteId, organizationId, { frozenBy = null, generatedFrom = null } = {}) {
  const qr = await client.query(`SELECT * FROM quotes WHERE id = $1 AND organization_id = $2`, [quoteId, organizationId]);
  const quoteRow = qr.rows[0];
  if (!quoteRow) return null;
  const lr = await client.query(
    `SELECT * FROM quote_lines WHERE quote_id = $1 AND organization_id = $2 ORDER BY position`,
    [quoteId, organizationId]
  );
  const frozenAtIso = new Date().toISOString();
  const snap = buildOfficialQuoteDocumentSnapshot({
    quoteRow,
    lineRows: lr.rows,
    organizationId,
    frozenAtIso,
    frozenBy,
    generatedFrom,
  });
  await client.query(`UPDATE quotes SET document_snapshot_json = $1::jsonb, updated_at = now() WHERE id = $2`, [
    JSON.stringify(snap),
    quoteId,
  ]);
  return snap;
}

/**
 * @param {import("pg").PoolClient} client
 */
export async function persistInvoiceOfficialDocumentSnapshot(client, invoiceId, organizationId, { frozenBy = null, generatedFrom = null } = {}) {
  const ir = await client.query(`SELECT * FROM invoices WHERE id = $1 AND organization_id = $2`, [invoiceId, organizationId]);
  const invoiceRow = ir.rows[0];
  if (!invoiceRow) return null;
  const lr = await client.query(
    `SELECT * FROM invoice_lines WHERE invoice_id = $1 AND organization_id = $2 ORDER BY position`,
    [invoiceId, organizationId]
  );
  let sourceQuoteRow = null;
  if (invoiceRow.quote_id) {
    const q = await client.query(`SELECT * FROM quotes WHERE id = $1 AND organization_id = $2`, [invoiceRow.quote_id, organizationId]);
    sourceQuoteRow = q.rows[0] ?? null;
  }
  const frozenAtIso = new Date().toISOString();
  const snap = buildOfficialInvoiceDocumentSnapshot({
    invoiceRow,
    lineRows: lr.rows,
    sourceQuoteRow,
    organizationId,
    frozenAtIso,
    frozenBy,
    generatedFrom,
  });
  await client.query(`UPDATE invoices SET document_snapshot_json = $1::jsonb, updated_at = now() WHERE id = $2`, [
    JSON.stringify(snap),
    invoiceId,
  ]);
  return snap;
}

/**
 * @param {import("pg").PoolClient} client
 */
export async function persistCreditNoteOfficialDocumentSnapshot(client, creditNoteId, organizationId, { frozenBy = null, generatedFrom = null } = {}) {
  const qr = await client.query(`SELECT * FROM credit_notes WHERE id = $1 AND organization_id = $2`, [creditNoteId, organizationId]);
  const creditNoteRow = qr.rows[0];
  if (!creditNoteRow) return null;
  const lr = await client.query(
    `SELECT * FROM credit_note_lines WHERE credit_note_id = $1 AND organization_id = $2 ORDER BY position`,
    [creditNoteId, organizationId]
  );
  const inv = await client.query(`SELECT * FROM invoices WHERE id = $1 AND organization_id = $2`, [creditNoteRow.invoice_id, organizationId]);
  const invoiceRow = inv.rows[0];
  let sourceQuoteRow = null;
  if (invoiceRow?.quote_id) {
    const q = await client.query(`SELECT * FROM quotes WHERE id = $1 AND organization_id = $2`, [invoiceRow.quote_id, organizationId]);
    sourceQuoteRow = q.rows[0] ?? null;
  }
  const frozenAtIso = new Date().toISOString();
  const snap = buildOfficialCreditNoteDocumentSnapshot({
    creditNoteRow,
    lineRows: lr.rows,
    invoiceRow,
    sourceQuoteRow,
    organizationId,
    frozenAtIso,
    frozenBy,
    generatedFrom,
  });
  await client.query(`UPDATE credit_notes SET document_snapshot_json = $1::jsonb, updated_at = now() WHERE id = $2`, [
    JSON.stringify(snap),
    creditNoteId,
  ]);
  return snap;
}

/**
 * Même shape que le payload PDF officiel, construit depuis le devis live (aperçu brouillon — non persisté).
 * @param {object} quoteRow — ligne quotes (+ champs clients JOIN éventuels)
 * @param {object[]} lineRows — lignes quote_lines
 * @param {string} organizationId
 * @param {object} issuerSnapshot
 * @param {object} recipientSnapshot
 */
export function buildQuotePdfPayloadForLivePreview(
  quoteRow,
  lineRows,
  organizationId,
  issuerSnapshot,
  recipientSnapshot
) {
  const meta = parseJsonb(quoteRow.metadata_json);
  const mappedLines = (lineRows || []).map(mapQuoteLine);
  const computedTotals = computeQuoteTotalsFromSnapshotLines(mappedLines);
  const computedDiscountHt = computeDocumentDiscountHtFromSnapshotLines(mappedLines);
  const { deposit, deposit_display } = buildQuoteDepositFreeze(meta, computedTotals.total_ttc);
  const showLinePricing = meta.pdf_show_line_pricing !== false;
  const legal_documents = parseLegalDocumentsFromMeta(meta);

  const body = {
    schema_version: FINANCIAL_DOCUMENT_SNAPSHOT_SCHEMA_VERSION,
    document_type: "QUOTE",
    document_id: quoteRow.id,
    organization_id: organizationId,
    number: quoteRow.quote_number ?? null,
    status: quoteRow.status ?? null,
    sent_at: quoteRow.sent_at ?? quoteRow.created_at ?? null,
    issued_at: quoteRow.sent_at ?? quoteRow.created_at ?? null,
    currency: quoteRow.currency ?? "EUR",
    valid_until: quoteRow.valid_until ?? null,
    notes: quoteRow.notes ?? null,
    commercial_notes: meta.commercial_notes ?? null,
    technical_notes: meta.technical_notes ?? null,
    payment_terms: meta.payment_terms ?? null,
    discount_ht: computedDiscountHt,
    issuer_snapshot: issuerSnapshot,
    recipient_snapshot: recipientSnapshot,
    lines: mappedLines,
    totals: {
      total_ht: computedTotals.total_ht,
      total_vat: computedTotals.total_vat,
      total_ttc: computedTotals.total_ttc,
      discount_ht: computedDiscountHt,
    },
    deposit,
    deposit_display,
    pdf_display: {
      show_line_pricing: showLinePricing,
    },
    legal_documents,
    refs: {
      lead_id: quoteRow.lead_id ?? null,
      client_id: quoteRow.client_id ?? null,
      study_id: quoteRow.study_id ?? null,
      study_version_id: quoteRow.study_version_id ?? null,
    },
    created_at: quoteRow.created_at ?? null,
    frozen_at: new Date().toISOString(),
    frozen_by: null,
    generated_from: "LIVE_PREVIEW",
  };
  warnIfQuoteSnapshotTotalsInconsistent(
    {
      quote_id: quoteRow.id ?? null,
      organization_id: organizationId ?? null,
      generated_from: "LIVE_PREVIEW",
    },
    mappedLines,
    body.totals
  );
  const withChecksum = { ...body, snapshot_checksum: computeSnapshotChecksum(body) };
  return buildQuotePdfPayloadFromSnapshot(withChecksum);
}
