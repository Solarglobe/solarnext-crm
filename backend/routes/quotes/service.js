/**
 * CP-031 — Moteur Devis V1
 * CP-032C — withTx + assertOrgEntity + assertStatus
 * CP-036 — Automatisation devis signé : lead.status=CLIENT, project_status=SIGNE, activité DEVIS_SIGNE
 */

import { pool } from "../../config/db.js";
import { createAutoActivity } from "../../modules/activities/activity.service.js";
import { withTx } from "../../db/tx.js";
import { assertOrgEntity, assertStatus } from "../../services/guards.service.js";
import { getQuoteCatalogItemById } from "../../services/quoteCatalog.service.js";
import {
  buildQuoteItemSnapshotFromCatalogItem,
  recomputeAndPersistQuoteTotals,
  PRICING_MODE_PERCENT_TOTAL,
} from "../../services/quoteEngine.service.js";
import { computeFinancialLineDbFields, applyDocumentDiscountHt } from "../../services/finance/financialLine.js";
import { roundMoney2 } from "../../services/finance/moneyRounding.js";
import { isQuoteEditable } from "../../services/finance/financialImmutability.js";
import { allocateNextDocumentNumber } from "../../services/documentSequence.service.js";
import { buildQuoteIssuerRecipientSnapshots } from "../../services/documentSnapshot.service.js";
import { listFinancialDocumentsForEntity } from "../../services/financialPdfDocument.service.js";
import { createFinancialQuoteRenderToken } from "../../services/pdfRenderToken.service.js";
import {
  buildFinancialQuoteRendererUrl,
  generatePdfFromFinancialQuoteUrl,
} from "../../services/pdfGeneration.service.js";
import fs from "fs/promises";
import {
  removeQuotePdfDocuments,
  saveQuotePdfDocument,
  findExistingLeadQuotePdfForQuote,
  saveQuotePdfOnLeadDocument,
  removeQuoteSignatureDocuments,
  removeQuoteSignedPdfDocuments,
  saveQuoteSignaturePng,
  saveQuoteSignedPdfDocument,
  QUOTE_DOC_SIGNATURE_CLIENT,
  QUOTE_DOC_SIGNATURE_COMPANY,
  QUOTE_DOC_PDF_SIGNED,
  deleteDocument,
} from "../../services/documents.service.js";
import { getAbsolutePath } from "../../services/localStorage.service.js";
import { addDocumentApiAliases } from "../../services/documentMetadata.service.js";
import {
  persistQuoteOfficialDocumentSnapshot,
  buildQuotePdfPayloadForLivePreview,
} from "../../services/financialDocumentSnapshot.service.js";
import { mergeQuoteOrgDocumentFieldsIntoPayload } from "../../services/quoteDocumentOrgSettings.service.js";
import { buildQuotePdfPayloadFromSnapshot } from "../../services/financialDocumentPdfPayload.service.js";
import { normalizeQuoteStatusInput } from "../../utils/financialDocumentStatus.js";

/**
 * Acompte structuré (metadata_json.deposit). Met à jour deposit_percent pour compat (PERCENT uniquement).
 */
function normalizeDepositPayload(deposit) {
  if (deposit == null || typeof deposit !== "object") {
    throw new Error("deposit invalide");
  }
  const t = String(deposit.type || "").toUpperCase();
  if (t !== "PERCENT" && t !== "AMOUNT") {
    throw new Error("deposit.type invalide (PERCENT ou AMOUNT)");
  }
  const v = Number(deposit.value);
  if (!Number.isFinite(v) || v < 0) {
    throw new Error("deposit.value invalide");
  }
  if (t === "PERCENT" && v > 100) {
    throw new Error("deposit pourcentage invalide (> 100)");
  }
  const note =
    deposit.note != null && String(deposit.note).trim() !== "" ? String(deposit.note).slice(0, 500) : undefined;
  const value = Math.round(v * 100) / 100;
  const obj = { type: t, value, ...(note ? { note } : {}) };
  const deposit_percent = t === "PERCENT" ? Math.min(100, value) : 0;
  return { deposit: obj, deposit_percent };
}

const STATUS_TRANSITIONS = {
  DRAFT: ["READY_TO_SEND", "SENT", "CANCELLED"],
  READY_TO_SEND: ["SENT", "CANCELLED"],
  SENT: ["ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
};

/**
 * Vérifie que client appartient à l'org
 */
export async function assertClientInOrg(clientId, organizationId) {
  const r = await pool.query(
    "SELECT id FROM clients WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
    [clientId, organizationId]
  );
  if (r.rows.length === 0) {
    throw new Error("Client non trouvé ou n'appartient pas à l'organisation");
  }
}

/**
 * Vérifie que lead appartient à l'org (si fourni)
 */
export async function assertLeadInOrg(leadId, organizationId) {
  if (!leadId) return;
  const r = await pool.query(
    "SELECT id FROM leads WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
    [leadId, organizationId]
  );
  if (r.rows.length === 0) {
    throw new Error("Lead non trouvé ou n'appartient pas à l'organisation");
  }
}

/**
 * Vérifie que study appartient à l'org (si fourni)
 */
export async function assertStudyInOrg(studyId, organizationId) {
  if (!studyId) return;
  const r = await pool.query(
    "SELECT id FROM studies WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
    [studyId, organizationId]
  );
  if (r.rows.length === 0) {
    throw new Error("Étude non trouvée ou n'appartient pas à l'organisation");
  }
}

/**
 * Vérifie que study_version appartient à l'étude et à l'org.
 */
export async function assertStudyVersionInOrg(studyVersionId, studyId, organizationId) {
  if (!studyVersionId) return;
  const r = await pool.query(
    `SELECT sv.id FROM study_versions sv
     JOIN studies s ON s.id = sv.study_id AND s.organization_id = sv.organization_id
     WHERE sv.id = $1 AND sv.study_id = $2 AND sv.organization_id = $3`,
    [studyVersionId, studyId, organizationId]
  );
  if (r.rows.length === 0) {
    throw new Error("Version d'étude invalide ou hors organisation");
  }
}

function draftQuoteNumber() {
  return `DRAFT-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Liste devis avec filtres (GET /api/quotes).
 */
export async function listQuotes(organizationId, query = {}) {
  const lead_id = query.lead_id;
  const study_id = query.study_id;
  const client_id = query.client_id;
  const status = query.status;
  const limit = Math.min(500, Math.max(1, parseInt(String(query.limit || "100"), 10) || 100));
  const offset = Math.max(0, parseInt(String(query.offset || "0"), 10) || 0);

  let sql = `
    SELECT q.*, c.company_name, c.first_name, c.last_name,
           l.full_name AS lead_full_name,
           (EXISTS (
             SELECT 1 FROM entity_documents ed
             WHERE ed.organization_id = q.organization_id
               AND ed.entity_type = 'quote' AND ed.entity_id = q.id
               AND ed.document_type = 'quote_pdf'
               AND (ed.archived_at IS NULL)
           )) AS has_pdf,
           (EXISTS (
             SELECT 1 FROM entity_documents ed
             WHERE ed.organization_id = q.organization_id
               AND ed.entity_type = 'quote' AND ed.entity_id = q.id
               AND ed.document_type = '${QUOTE_DOC_PDF_SIGNED}'
               AND (ed.archived_at IS NULL)
           )) AS has_signed_pdf
    FROM quotes q
    LEFT JOIN clients c ON c.id = q.client_id
    LEFT JOIN leads l ON l.id = q.lead_id AND l.organization_id = q.organization_id AND (l.archived_at IS NULL)
    WHERE q.organization_id = $1 AND (q.archived_at IS NULL)`;
  const params = [organizationId];
  let p = 2;

  if (lead_id) {
    sql += ` AND q.lead_id = $${p++}`;
    params.push(lead_id);
  }
  if (study_id) {
    sql += ` AND q.study_id = $${p++}`;
    params.push(study_id);
  }
  if (client_id) {
    sql += ` AND q.client_id = $${p++}`;
    params.push(client_id);
  }
  if (status) {
    sql += ` AND q.status = $${p++}`;
    params.push(String(status).toUpperCase());
  }

  sql += ` ORDER BY q.created_at DESC LIMIT $${p++} OFFSET $${p++}`;
  params.push(limit, offset);

  const r = await pool.query(sql, params);
  return r.rows;
}

/**
 * Détail devis enrichi (documents PDF, etc.).
 */
export async function getQuoteDetail(quoteId, organizationId) {
  const base = await getQuoteById(quoteId, organizationId);
  if (!base) return null;
  const documents = await listFinancialDocumentsForEntity(organizationId, "quote", quoteId);
  return {
    ...base,
    documents,
    has_pdf: documents.some((d) => d.document_type === "quote_pdf"),
    has_signed_pdf: documents.some((d) => d.document_type === QUOTE_DOC_PDF_SIGNED),
  };
}

/**
 * @returns {Promise<{ mode: 'official' | 'draft', payload: object, organizationId: string }>}
 */
function parseOfficialQuoteSnapshotFromRow(quoteRow) {
  const raw = quoteRow.document_snapshot_json;
  if (raw == null) return null;
  if (typeof raw === "object" && raw !== null && Object.keys(raw).length === 0) return null;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t || t === "{}") return null;
    try {
      const o = JSON.parse(t);
      if (typeof o === "object" && o !== null && Object.keys(o).length > 0) return o;
      return null;
    } catch {
      return null;
    }
  }
  return raw;
}

export async function getQuoteDocumentViewModel(quoteId, organizationId) {
  const data = await getQuoteById(quoteId, organizationId);
  if (!data) {
    const err = new Error("Devis non trouvé");
    err.statusCode = 404;
    throw err;
  }
  const { quote, items } = data;
  const snap = parseOfficialQuoteSnapshotFromRow(quote);
  if (snap && typeof snap === "object") {
    try {
      const payload = await mergeQuoteOrgDocumentFieldsIntoPayload(
        buildQuotePdfPayloadFromSnapshot(snap),
        organizationId
      );
      return { mode: "official", payload, organizationId };
    } catch {
      /* snapshot corrompu — retomber sur live */
    }
  }
  const { issuer_snapshot, recipient_snapshot } = await buildQuoteIssuerRecipientSnapshots(quote, organizationId);
  const payload = await mergeQuoteOrgDocumentFieldsIntoPayload(
    buildQuotePdfPayloadForLivePreview(quote, items, organizationId, issuer_snapshot, recipient_snapshot),
    organizationId
  );
  return { mode: "draft", payload, organizationId };
}

/**
 * Construit un customer_snapshot depuis le lead (nom, téléphone, adresse) pour PDF / affichage.
 * Utilisé quand le devis est créé sans client (lead-only). Ne crée pas de Client.
 */
export async function buildCustomerSnapshotFromLead(leadId, organizationId) {
  const leadRes = await pool.query(
    `SELECT l.first_name, l.last_name, l.full_name, l.email, l.phone, l.phone_mobile, l.phone_landline, l.address, l.site_address_id,
            l.customer_type, l.company_name, l.siret
     FROM leads l
     WHERE l.id = $1 AND l.organization_id = $2 AND (l.archived_at IS NULL)`,
    [leadId, organizationId]
  );
  if (leadRes.rows.length === 0) return null;
  const lead = leadRes.rows[0];
  let addressFormatted = lead.address || null;
  if (lead.site_address_id) {
    const addrRes = await pool.query(
      `SELECT address_line1, address_line2, postal_code, city, country_code, formatted_address
       FROM addresses WHERE id = $1 AND organization_id = $2`,
      [lead.site_address_id, organizationId]
    );
    if (addrRes.rows.length > 0) {
      const a = addrRes.rows[0];
      addressFormatted = a.formatted_address || [a.address_line1, a.address_line2, a.postal_code, a.city, a.country_code].filter(Boolean).join(", ");
    }
  }
  return {
    source: "lead",
    customer_type: lead.customer_type ?? "PERSON",
    first_name: lead.first_name ?? null,
    last_name: lead.last_name ?? null,
    company_name: lead.company_name ?? null,
    siret: lead.siret ?? null,
    full_name: (lead.full_name ?? [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim()) || "Sans nom",
    email: lead.email ?? null,
    phone: lead.phone_mobile ?? lead.phone_landline ?? lead.phone ?? null,
    address: addressFormatted,
  };
}

function parseQuoteMetadataJson(quoteRow) {
  const m = quoteRow?.metadata_json;
  if (m == null || m === "") return {};
  if (typeof m === "object" && !Array.isArray(m)) return { ...m };
  if (typeof m === "string") {
    try {
      const o = JSON.parse(m);
      return typeof o === "object" && o !== null && !Array.isArray(o) ? { ...o } : {};
    } catch {
      return {};
    }
  }
  return {};
}

function customerSnapshotHasIdentity(cs) {
  if (!cs || typeof cs !== "object") return false;
  if (String(cs.company_name ?? "").trim()) return true;
  if (String(cs.full_name ?? "").trim()) return true;
  const fn = String(cs.first_name ?? "").trim();
  const ln = String(cs.last_name ?? "").trim();
  return Boolean(fn || ln);
}

/**
 * Même règle que le rendu PDF : fiche client OU snapshot lead exploitable.
 * Met à jour metadata_json.customer_snapshot depuis le lead si besoin (devis lead-only).
 * @param {import("pg").PoolClient} client
 */
async function ensureQuoteRecipientForOfficialFreeze(client, quoteId, organizationId, quoteRow) {
  if (quoteRow.client_id) return quoteRow;

  let meta = parseQuoteMetadataJson(quoteRow);
  if (customerSnapshotHasIdentity(meta.customer_snapshot)) {
    return { ...quoteRow, metadata_json: meta };
  }

  if (quoteRow.lead_id) {
    const built = await buildCustomerSnapshotFromLead(quoteRow.lead_id, organizationId);
    if (built && customerSnapshotHasIdentity(built)) {
      meta = { ...meta, customer_snapshot: built };
      await client.query(
        `UPDATE quotes SET metadata_json = $1::jsonb, updated_at = now() WHERE id = $2 AND organization_id = $3`,
        [JSON.stringify(meta), quoteId, organizationId]
      );
      return { ...quoteRow, metadata_json: meta };
    }
  }

  const err = new Error(
    "Destinataire requis pour figer le devis : rattachez une fiche client au devis, ou renseignez l’identité sur le dossier lead (sans fiche client, le devis s’appuie sur le lead)."
  );
  err.statusCode = 400;
  throw err;
}

/** Snapshot JSON ligne — line_source study_prep | manual ; reference figée pour PDF mode condensé (sans catalogue live). */
function buildQuoteLineSnapshotJsonForWrite(it) {
  const lineSource = it.line_source === "study_prep" ? "study_prep" : "manual";
  const refRaw = it.reference != null ? String(it.reference).trim() : "";
  const ref = refRaw ? refRaw.slice(0, 120) : null;
  const snapObj = {
    name: it.label ?? "",
    description: it.description ?? "",
    ...(ref ? { reference: ref } : {}),
    category: "OTHER",
    line_source: lineSource,
    source: it.catalog_item_id ? { catalogItemId: it.catalog_item_id } : {},
  };
  return JSON.stringify(snapObj);
}

/**
 * Créer devis en draft avec items.
 * Rattachement : client_id et/ou lead_id (au moins un des deux). study_id / study_version_id facultatifs.
 * items: [{ label, description, quantity, unit_price_ht, tva_rate, line_source?, catalog_item_id? }]
 * Si pas de client : customer_snapshot (lead) enregistré dans metadata_json pour le PDF.
 * metadata optionnel : fusionné dans metadata_json (ex. study_import).
 */
export async function createQuote(organizationId, body) {
  const { client_id, lead_id, study_id, study_version_id, items = [], metadata } = body;

  const hasClient = client_id != null && String(client_id).trim() !== "";
  const hasLead = lead_id != null && String(lead_id).trim() !== "";

  if (hasClient) {
    await assertClientInOrg(client_id, organizationId);
    if (lead_id) await assertLeadInOrg(lead_id, organizationId);
    if (study_id) await assertStudyInOrg(study_id, organizationId);
    if (study_version_id && study_id) await assertStudyVersionInOrg(study_version_id, study_id, organizationId);
  } else if (hasLead) {
    await assertLeadInOrg(lead_id, organizationId);
    if (study_id) await assertStudyInOrg(study_id, organizationId);
    if (study_version_id && study_id) await assertStudyVersionInOrg(study_version_id, study_id, organizationId);
  } else {
    throw new Error("client_id ou lead_id requis");
  }

  const quoteNumber = draftQuoteNumber();

  return withTx(pool, async (client) => {
    const clientIdVal = hasClient ? client_id : null;
    const leadIdVal = lead_id || null;
    const studyIdVal = study_id || null;
    const studyVersionVal = study_version_id || null;

    let metadataJson = {};
    if (!hasClient && leadIdVal) {
      const customerSnapshot = await buildCustomerSnapshotFromLead(leadIdVal, organizationId);
      if (customerSnapshot) metadataJson = { customer_snapshot: customerSnapshot };
    }
    if (metadata && typeof metadata === "object") {
      metadataJson = { ...metadataJson, ...metadata };
    }
    if (metadataJson.pdf_show_line_pricing === undefined) {
      metadataJson.pdf_show_line_pricing = true;
    }

    const insQuote = await client.query(
      `INSERT INTO quotes (organization_id, client_id, lead_id, study_id, study_version_id, quote_number, status, total_ht, total_vat, total_ttc, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6, 'DRAFT', 0, 0, 0, $7::jsonb) RETURNING *`,
      [organizationId, clientIdVal, leadIdVal, studyIdVal, studyVersionVal, quoteNumber, JSON.stringify(metadataJson)]
    );
    const quote = insQuote.rows[0];
    const quoteId = quote.id;

    let totalHt = 0;
    let totalTva = 0;
    let totalTtc = 0;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const qty = Number(it.quantity) || 0;
      const up = Number(it.unit_price_ht) || 0;
      const rate = Number(it.tva_rate) || 0;
      const discHt = Number(it.discount_ht) || 0;
      const { total_line_ht: th, total_line_vat: tv, total_line_ttc: tt } = computeFinancialLineDbFields({
        quantity: qty,
        unit_price_ht: up,
        discount_ht: discHt,
        vat_rate: rate,
      });
      totalHt += th;
      totalTva += tv;
      totalTtc += tt;

      const snapJson = buildQuoteLineSnapshotJsonForWrite(it);

      await client.query(
        `INSERT INTO quote_lines (organization_id, quote_id, catalog_item_id, label, description, quantity, unit_price_ht, discount_ht, vat_rate, total_line_ht, total_line_vat, total_line_ttc, position, snapshot_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)`,
        [
          organizationId,
          quoteId,
          it.catalog_item_id ?? null,
          it.label || null,
          it.description || "",
          qty,
          up,
          discHt,
          rate,
          th,
          tv,
          tt,
          i + 1,
          snapJson,
        ]
      );
    }

    totalHt = Math.round(totalHt * 100) / 100;
    totalTva = Math.round(totalTva * 100) / 100;
    totalTtc = Math.round(totalTtc * 100) / 100;

    await client.query(
      `UPDATE quotes SET total_ht = $1, total_vat = $2, total_ttc = $3 WHERE id = $4`,
      [totalHt, totalTva, totalTtc, quoteId]
    );

    const [quoteRow] = (
      await client.query(
        "SELECT * FROM quotes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
        [quoteId, organizationId]
      )
    ).rows;
    const itemsRows = (
      await client.query(
        "SELECT * FROM quote_lines WHERE quote_id = $1 AND organization_id = $2 ORDER BY position",
        [quoteId, organizationId]
      )
    ).rows;

    return { quote: quoteRow, items: itemsRows };
  });
}

/**
 * Récupérer devis avec items.
 * Si pas de client (lead-only) : company_name, first_name, last_name, email issus de metadata_json.customer_snapshot.
 */
export async function getQuoteById(quoteId, organizationId) {
  const quoteRes = await pool.query(
    `SELECT q.*, c.company_name, c.first_name, c.last_name, c.email, c.siret
     FROM quotes q
     LEFT JOIN clients c ON c.id = q.client_id
     WHERE q.id = $1 AND q.organization_id = $2 AND (q.archived_at IS NULL)`,
    [quoteId, organizationId]
  );
  if (quoteRes.rows.length === 0) return null;

  const quote = quoteRes.rows[0];
  if (!quote.client_id && quote.metadata_json?.customer_snapshot) {
    const cs = quote.metadata_json.customer_snapshot;
    quote.first_name = quote.first_name ?? cs.first_name;
    quote.last_name = quote.last_name ?? cs.last_name;
    quote.company_name = quote.company_name ?? cs.company_name ?? cs.full_name ?? [cs.first_name, cs.last_name].filter(Boolean).join(" ");
    quote.email = quote.email ?? cs.email;
    quote.customer_type = quote.customer_type ?? cs.customer_type ?? "PERSON";
    quote.siret = quote.siret ?? cs.siret ?? null;
  }

  const itemsRes = await pool.query(
    "SELECT * FROM quote_lines WHERE quote_id = $1 AND organization_id = $2 ORDER BY position",
    [quoteId, organizationId]
  );

  return { quote, items: itemsRes.rows };
}

/**
 * Modifier devis (lignes + entête si brouillon / prêt à envoyer)
 * items: [{ label, description, quantity, unit_price_ht, tva_rate }]
 */
export async function updateQuote(quoteId, organizationId, body) {
  await withTx(pool, async (client) => {
    const quoteRow = await assertOrgEntity(client, "quotes", quoteId, organizationId);
    if (!isQuoteEditable(quoteRow.status)) {
      throw new Error("Modification interdite : devis figé ou terminé");
    }

    const {
      items,
      valid_until,
      notes,
      metadata_json,
      client_id,
      lead_id,
      study_id,
      study_version_id,
      discount_ht,
      global_discount_percent,
      validity_days,
      commercial_notes,
      technical_notes,
      payment_terms,
      deposit_percent,
      deposit,
      study_import,
      pdf_show_line_pricing,
    } = body;

    if (validity_days !== undefined && body.valid_until === undefined) {
      const days = Math.max(1, Math.min(3650, parseInt(String(validity_days), 10) || 30));
      const u = new Date();
      u.setHours(12, 0, 0, 0);
      u.setDate(u.getDate() + days);
      await client.query(`UPDATE quotes SET valid_until = $1::date, updated_at = now() WHERE id = $2`, [
        u.toISOString().slice(0, 10),
        quoteId,
      ]);
    }

    if (client_id !== undefined) {
      if (client_id) await assertClientInOrg(client_id, organizationId);
      await client.query(`UPDATE quotes SET client_id = $1, updated_at = now() WHERE id = $2`, [
        client_id || null,
        quoteId,
      ]);
    }
    if (lead_id !== undefined) {
      if (lead_id) await assertLeadInOrg(lead_id, organizationId);
      await client.query(`UPDATE quotes SET lead_id = $1, updated_at = now() WHERE id = $2`, [lead_id || null, quoteId]);
    }
    if (study_id !== undefined) {
      if (study_id) await assertStudyInOrg(study_id, organizationId);
      await client.query(`UPDATE quotes SET study_id = $1, updated_at = now() WHERE id = $2`, [study_id || null, quoteId]);
    }
    if (study_version_id !== undefined) {
      const cur = await client.query("SELECT study_id FROM quotes WHERE id = $1", [quoteId]);
      const sid = cur.rows[0]?.study_id;
      if (study_version_id && sid) await assertStudyVersionInOrg(study_version_id, sid, organizationId);
      await client.query(`UPDATE quotes SET study_version_id = $1, updated_at = now() WHERE id = $2`, [
        study_version_id || null,
        quoteId,
      ]);
    }
    if (valid_until !== undefined) {
      await client.query(`UPDATE quotes SET valid_until = $1, updated_at = now() WHERE id = $2`, [valid_until, quoteId]);
    }
    if (notes !== undefined) {
      const cur = await client.query("SELECT metadata_json FROM quotes WHERE id = $1", [quoteId]);
      const meta = { ...(cur.rows[0]?.metadata_json || {}), notes };
      await client.query(`UPDATE quotes SET metadata_json = $1::jsonb, updated_at = now() WHERE id = $2`, [
        JSON.stringify(meta),
        quoteId,
      ]);
    }
    if (metadata_json !== undefined) {
      await client.query(`UPDATE quotes SET metadata_json = $1::jsonb, updated_at = now() WHERE id = $2`, [
        JSON.stringify(metadata_json),
        quoteId,
      ]);
    }
    if (discount_ht !== undefined && !Array.isArray(items)) {
      await client.query(`UPDATE quotes SET discount_ht = $1, updated_at = now() WHERE id = $2`, [discount_ht, quoteId]);
    }

    if (
      global_discount_percent !== undefined ||
      commercial_notes !== undefined ||
      technical_notes !== undefined ||
      payment_terms !== undefined ||
      deposit_percent !== undefined ||
      deposit !== undefined ||
      validity_days !== undefined ||
      study_import !== undefined ||
      pdf_show_line_pricing !== undefined
    ) {
      const cur = await client.query("SELECT metadata_json FROM quotes WHERE id = $1", [quoteId]);
      const meta = { ...(cur.rows[0]?.metadata_json || {}) };
      if (global_discount_percent !== undefined) {
        meta.global_discount_percent = Math.max(0, Math.min(100, Number(global_discount_percent)));
      }
      if (commercial_notes !== undefined) meta.commercial_notes = commercial_notes;
      if (technical_notes !== undefined) meta.technical_notes = technical_notes;
      if (payment_terms !== undefined) meta.payment_terms = payment_terms;
      if (deposit !== undefined) {
        const n = normalizeDepositPayload(deposit);
        meta.deposit = n.deposit;
        meta.deposit_percent = n.deposit_percent;
      } else if (deposit_percent !== undefined) {
        const p = Math.max(0, Math.min(100, Number(deposit_percent)));
        meta.deposit = { type: "PERCENT", value: p };
        meta.deposit_percent = p;
      }
      if (validity_days !== undefined) {
        meta.validity_days = Math.max(1, Math.min(3650, parseInt(String(validity_days), 10) || 30));
      }
      if (study_import !== undefined) {
        meta.study_import = study_import;
      }
      if (pdf_show_line_pricing !== undefined) {
        meta.pdf_show_line_pricing = Boolean(pdf_show_line_pricing);
      }
      await client.query(`UPDATE quotes SET metadata_json = $1::jsonb, updated_at = now() WHERE id = $2`, [
        JSON.stringify(meta),
        quoteId,
      ]);
    }

    if (!Array.isArray(items)) {
      return;
    }

    await client.query("DELETE FROM quote_lines WHERE quote_id = $1 AND organization_id = $2", [
      quoteId,
      organizationId,
    ]);

    let totalHt = 0;
    let totalTva = 0;
    let totalTtc = 0;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const qty = Number(it.quantity) || 0;
      const up = Number(it.unit_price_ht) || 0;
      const rate = Number(it.tva_rate) || 0;
      const { total_line_ht: th, total_line_vat: tv, total_line_ttc: tt } = computeFinancialLineDbFields({
        quantity: qty,
        unit_price_ht: up,
        discount_ht: Number(it.discount_ht) || 0,
        vat_rate: rate,
      });
      totalHt += th;
      totalTva += tv;
      totalTtc += tt;

      const snapJson = buildQuoteLineSnapshotJsonForWrite(it);
      await client.query(
        `INSERT INTO quote_lines (organization_id, quote_id, catalog_item_id, label, description, quantity, unit_price_ht, discount_ht, vat_rate, total_line_ht, total_line_vat, total_line_ttc, position, snapshot_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)`,
        [
          organizationId,
          quoteId,
          it.catalog_item_id ?? null,
          it.label || null,
          it.description || "",
          qty,
          up,
          Number(it.discount_ht) || 0,
          rate,
          th,
          tv,
          tt,
          i + 1,
          snapJson,
        ]
      );
    }

    totalHt = roundMoney2(totalHt);
    totalTva = roundMoney2(totalTva);
    totalTtc = roundMoney2(totalTtc);

    const subtotals = { total_ht: totalHt, total_vat: totalTva, total_ttc: totalTtc };
    let docDiscHt = 0;
    if (global_discount_percent != null && global_discount_percent !== undefined && global_discount_percent !== "") {
      const pct = Math.max(0, Math.min(100, Number(global_discount_percent)));
      docDiscHt = roundMoney2(totalHt * (pct / 100));
    } else if (discount_ht !== undefined) {
      docDiscHt = Math.max(0, roundMoney2(Number(discount_ht)));
    }
    const final = applyDocumentDiscountHt(subtotals, docDiscHt);

    await client.query(
      `UPDATE quotes SET total_ht = $1, total_vat = $2, total_ttc = $3, discount_ht = $4, updated_at = now() WHERE id = $5`,
      [final.total_ht, final.total_vat, final.total_ttc, final.applied_document_discount_ht, quoteId]
    );
  });
  return getQuoteById(quoteId, organizationId);
}

/**
 * Changer statut devis — transitions métier + gel à l'envoi (SENT).
 * CP-036 : Si ACCEPTED → lead + activité
 */
export async function patchQuoteStatus(quoteId, organizationId, newStatus, userId = null) {
  const normalized = normalizeQuoteStatusInput(newStatus);
  if (!normalized) {
    throw new Error("Statut invalide");
  }

  return withTx(pool, async (client) => {
    await assertOrgEntity(client, "quotes", quoteId, organizationId);
    const fullRes = await client.query(
      "SELECT * FROM quotes WHERE id = $1 AND organization_id = $2 FOR UPDATE",
      [quoteId, organizationId]
    );
    const quote = fullRes.rows[0];
    if (!quote) {
      const err = new Error("Non trouvé");
      err.statusCode = 404;
      throw err;
    }

    const allowed = STATUS_TRANSITIONS[quote.status] || [];
    if (!allowed.includes(normalized)) {
      throw new Error(`Transition interdite : ${quote.status} → ${normalized}`);
    }

    if (normalized === "SENT") {
      const quoteReady = await ensureQuoteRecipientForOfficialFreeze(client, quoteId, organizationId, quote);
      const { fullNumber } = await allocateNextDocumentNumber(client, organizationId, "QUOTE");
      const { issuer_snapshot, recipient_snapshot } = await buildQuoteIssuerRecipientSnapshots(quoteReady, organizationId);
      await client.query(
        `UPDATE quotes SET
          status = 'SENT',
          sent_at = COALESCE(sent_at, now()),
          quote_number = $1,
          issuer_snapshot = $2::jsonb,
          recipient_snapshot = $3::jsonb,
          updated_at = now()
        WHERE id = $4`,
        [fullNumber, JSON.stringify(issuer_snapshot), JSON.stringify(recipient_snapshot), quoteId]
      );
      await persistQuoteOfficialDocumentSnapshot(client, quoteId, organizationId, {
        frozenBy: userId,
        generatedFrom: "PATCH_QUOTE_STATUS_SENT",
      });
    } else if (normalized === "ACCEPTED") {
      /** Si client_id absent : copier leads.client_id (meme org, client actif) pour facturation from-quote. */
      let clientIdForAccept = quote.client_id || null;
      if (!clientIdForAccept && quote.lead_id) {
        const leadRes = await client.query(
          `SELECT client_id FROM leads WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
          [quote.lead_id, organizationId]
        );
        const cid = leadRes.rows[0]?.client_id;
        if (cid) {
          const okClient = await client.query(
            `SELECT 1 FROM clients WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
            [cid, organizationId]
          );
          if (okClient.rows.length > 0) {
            clientIdForAccept = cid;
          }
        }
      }
      if (!clientIdForAccept) {
        console.warn(
          `[quotes] Devis ${quoteId} → ACCEPTED sans client_id réutilisable (lead_id=${quote.lead_id ?? "none"})`
        );
      }
      await client.query(
        `UPDATE quotes SET
          status = 'ACCEPTED',
          accepted_at = COALESCE(accepted_at, now()),
          client_id = COALESCE($2::uuid, client_id),
          updated_at = now()
        WHERE id = $1`,
        [quoteId, clientIdForAccept]
      );
    } else if (normalized === "REJECTED") {
      await client.query(
        `UPDATE quotes SET status = 'REJECTED', rejected_at = COALESCE(rejected_at, now()), updated_at = now() WHERE id = $1`,
        [quoteId]
      );
    } else if (normalized === "CANCELLED") {
      await client.query(
        `UPDATE quotes SET status = 'CANCELLED', cancelled_at = COALESCE(cancelled_at, now()), updated_at = now() WHERE id = $1`,
        [quoteId]
      );
    } else if (normalized === "EXPIRED") {
      await client.query(`UPDATE quotes SET status = 'EXPIRED', updated_at = now() WHERE id = $1`, [quoteId]);
    } else {
      await client.query(
        `UPDATE quotes SET status = $1, updated_at = now() WHERE id = $2`,
        [normalized, quoteId]
      );
    }

    return { quoteId, normalized, organizationId, userId };
  }).then(async ({ quoteId: qid, normalized: norm, organizationId: org, userId: uid }) => {
    if (norm === "ACCEPTED") {
      const quote = (
        await pool.query("SELECT * FROM quotes WHERE id = $1", [qid])
      ).rows[0];
      if (quote?.lead_id) {
        const leadRes = await pool.query(
          "SELECT id, status, project_status FROM leads WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
          [quote.lead_id, org]
        );
        if (leadRes.rows.length > 0) {
          const lead = leadRes.rows[0];
          const updates = [];
          const values = [];
          let idx = 1;
          if (lead.status !== "CLIENT") {
            updates.push(`status = $${idx++}`);
            values.push("CLIENT");
          }
          if (lead.project_status !== "SIGNE") {
            updates.push(`project_status = $${idx++}`);
            values.push("SIGNE");
          }
          if (updates.length > 0) {
            values.push(quote.lead_id, org);
            await pool.query(
              `UPDATE leads SET ${updates.join(", ")}, updated_at = now() WHERE id = $${idx++} AND organization_id = $${idx++}`,
              values
            );
          }
          try {
            await createAutoActivity(
              org,
              quote.lead_id,
              uid,
              "DEVIS_SIGNE",
              "Devis signé",
              { quote_id: qid, total_ttc: quote.total_ttc }
            );
          } catch (_) {}
        }
      }
    }
    return getQuoteDetail(qid, org);
  });
}

/**
 * Supprimer devis (uniquement si draft)
 * 404 si archivé, 403 si status != draft
 */
export async function deleteQuote(quoteId, organizationId) {
  return withTx(pool, async (client) => {
    const quoteRow = await assertOrgEntity(client, "quotes", quoteId, organizationId);
    assertStatus(quoteRow, ["DRAFT"]);

    await client.query("DELETE FROM quote_lines WHERE quote_id = $1 AND organization_id = $2", [
      quoteId,
      organizationId,
    ]);
    await client.query("DELETE FROM quotes WHERE id = $1 AND organization_id = $2", [
      quoteId,
      organizationId,
    ]);
    return true;
  });
}

function assertQuoteLinesEditableOrThrow(status) {
  if (!isQuoteEditable(status)) {
    const err = new Error("Modification interdite : devis figé ou terminé");
    err.statusCode = 403;
    throw err;
  }
}

/**
 * Duplique un devis en brouillon (nouveau numéro, sans dates d'émission).
 */
export async function duplicateQuote(quoteId, organizationId) {
  const src = await getQuoteById(quoteId, organizationId);
  if (!src) {
    const err = new Error("Non trouvé");
    err.statusCode = 404;
    throw err;
  }
  const q = src.quote;
  const newNumber = draftQuoteNumber();

  const newId = await withTx(pool, async (client) => {
    const ins = await client.query(
      `INSERT INTO quotes (
        organization_id, client_id, lead_id, study_id, study_version_id, quote_number, status,
        total_ht, total_vat, total_ttc, valid_until, metadata_json, currency, discount_ht
      ) VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9,$10,$11::jsonb, COALESCE($12,'EUR'), COALESCE($13,0))
      RETURNING id`,
      [
        organizationId,
        q.client_id,
        q.lead_id,
        q.study_id,
        q.study_version_id,
        newNumber,
        q.total_ht,
        q.total_vat,
        q.total_ttc,
        q.valid_until ?? null,
        JSON.stringify(q.metadata_json || {}),
        q.currency || "EUR",
        q.discount_ht ?? 0,
      ]
    );
    const nid = ins.rows[0].id;

    for (const it of src.items) {
      const snap =
        typeof it.snapshot_json === "object" && it.snapshot_json !== null
          ? JSON.stringify(it.snapshot_json)
          : it.snapshot_json || "{}";
      await client.query(
        `INSERT INTO quote_lines (
          organization_id, quote_id, catalog_item_id, snapshot_json, label, description,
          quantity, unit_price_ht, vat_rate, total_line_ht, total_line_vat, total_line_ttc,
          position, purchase_unit_price_ht_cents, vat_rate_bps, pricing_mode, is_active, discount_ht
        ) VALUES (
          $1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, COALESCE($17,true), COALESCE($18,0)
        )`,
        [
          organizationId,
          nid,
          it.catalog_item_id ?? null,
          snap,
          it.label,
          it.description ?? "",
          it.quantity,
          it.unit_price_ht,
          it.vat_rate,
          it.total_line_ht,
          it.total_line_vat,
          it.total_line_ttc,
          it.position,
          it.purchase_unit_price_ht_cents ?? null,
          it.vat_rate_bps ?? null,
          it.pricing_mode ?? "FIXED",
          it.is_active,
          it.discount_ht ?? 0,
        ]
      );
    }

    await recomputeAndPersistQuoteTotals({ quoteId: nid, orgId: organizationId });
    return nid;
  });
  return getQuoteById(newId, organizationId);
}

/**
 * Buffer PDF officiel depuis snapshot figé (Playwright) — sans écrire sur le quote.
 */
async function buildOfficialQuotePdfBuffer(quoteId, organizationId) {
  const r = await pool.query(
    "SELECT quote_number, document_snapshot_json, status FROM quotes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
    [quoteId, organizationId]
  );
  if (r.rows.length === 0) {
    const err = new Error("Devis non trouvé");
    err.statusCode = 404;
    throw err;
  }
  const row = r.rows[0];
  const snapRaw = row.document_snapshot_json;
  if (snapRaw == null || (typeof snapRaw === "object" && snapRaw !== null && Object.keys(snapRaw).length === 0)) {
    const err = new Error(
      "PDF impossible : aucun snapshot documentaire figé — passez le devis en « Envoyé » ou finalisez la signature depuis « Présenter »."
    );
    err.statusCode = 400;
    throw err;
  }
  const snapshot = typeof snapRaw === "string" ? JSON.parse(snapRaw) : snapRaw;
  const pdfPayload = buildQuotePdfPayloadFromSnapshot(snapshot);
  const renderToken = createFinancialQuoteRenderToken(quoteId, organizationId);
  const rendererUrl = buildFinancialQuoteRendererUrl(quoteId, renderToken);
  const pdfBuffer = await generatePdfFromFinancialQuoteUrl(rendererUrl);
  return { pdfBuffer, pdfPayload, row };
}

async function persistGeneratedQuotePdfOnQuote(pdfBuffer, pdfPayload, quoteId, organizationId, userId, row) {
  const num = row.quote_number || quoteId;
  await removeQuotePdfDocuments(organizationId, quoteId);
  return saveQuotePdfDocument(pdfBuffer, organizationId, quoteId, userId, {
    fileName: `devis-${num}.pdf`,
    quoteNumber: row.quote_number ?? null,
    metadata: {
      source: "document_snapshot_json",
      snapshot_checksum: pdfPayload.snapshot_checksum,
      business_document_type: "QUOTE_PDF",
    },
  });
}

/**
 * Enregistre une entrée document PDF devis (rendu PDF Playwright + stockage quote).
 */
export async function generateQuotePdfRecord(quoteId, organizationId, userId) {
  const { pdfBuffer, pdfPayload, row } = await buildOfficialQuotePdfBuffer(quoteId, organizationId);
  const doc = await persistGeneratedQuotePdfOnQuote(pdfBuffer, pdfPayload, quoteId, organizationId, userId, row);
  return {
    document: doc,
    pdf_payload: pdfPayload,
    downloadUrl: `/api/documents/${doc.id}/download`,
    message: "PDF devis généré et enregistré (rendu client depuis le snapshot figé).",
  };
}

/**
 * Enregistre le PDF devis sur entity_documents du lead (Documents > Devis), sans upload front.
 * Réutilise le PDF déjà stocké sur le quote ou régénère via le même pipeline que generateQuotePdfRecord.
 * @returns {{ alreadyExists: boolean, document: object }}
 */
export async function addQuotePdfToDocuments(quoteId, organizationId, userId) {
  const q = await pool.query(
    `SELECT lead_id, quote_number FROM quotes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [quoteId, organizationId]
  );
  if (q.rows.length === 0) {
    const err = new Error("Devis non trouvé");
    err.statusCode = 404;
    throw err;
  }
  const { lead_id: leadId, quote_number: quoteNumber } = q.rows[0];
  if (!leadId) {
    const err = new Error("Rattachez un dossier lead à ce devis pour l’ajouter aux documents.");
    err.statusCode = 400;
    throw err;
  }
  await assertLeadInOrg(leadId, organizationId);

  const existingLead = await findExistingLeadQuotePdfForQuote(organizationId, leadId, quoteId);
  if (existingLead) {
    return { alreadyExists: true, document: addDocumentApiAliases(existingLead) };
  }

  const quoteDocRes = await pool.query(
    `SELECT storage_key FROM entity_documents
     WHERE organization_id = $1 AND entity_type = 'quote' AND entity_id = $2
       AND document_type = 'quote_pdf' AND (archived_at IS NULL)
     ORDER BY created_at DESC
     LIMIT 1`,
    [organizationId, quoteId]
  );

  let pdfBuffer;
  const sk = quoteDocRes.rows[0]?.storage_key;
  if (sk) {
    pdfBuffer = await fs.readFile(getAbsolutePath(sk));
  } else {
    const built = await buildOfficialQuotePdfBuffer(quoteId, organizationId);
    await persistGeneratedQuotePdfOnQuote(
      built.pdfBuffer,
      built.pdfPayload,
      quoteId,
      organizationId,
      userId,
      built.row
    );
    pdfBuffer = built.pdfBuffer;
  }

  const num = quoteNumber || quoteId;
  const leadDoc = await saveQuotePdfOnLeadDocument(pdfBuffer, organizationId, leadId, quoteId, userId, {
    quoteNumber: quoteNumber ?? null,
    fileName: `devis-${num}.pdf`,
    metadata: {
      source: "add_to_lead_documents",
      reused_quote_pdf_row: Boolean(sk),
    },
  });

  return { alreadyExists: false, document: addDocumentApiAliases(leadDoc) };
}

const MAX_SIGNATURE_PNG_BYTES = 900000;

/**
 * Attestation « Bon pour accord » — obligatoire côté serveur (workflow Présenter / Signer).
 * @param {object} body
 */
export function assertFinalizeSignedClientReadApproval(body) {
  const approved = body?.client_read_approved;
  if (approved !== true && approved !== "true") {
    const err = new Error(
      "Attestation « Bon pour accord » requise : le client doit avoir lu et approuvé le devis (client_read_approved: true)."
    );
    err.statusCode = 400;
    throw err;
  }
}

function parsePngDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const m = dataUrl.match(/^data:image\/png;base64,([\s\S]+)$/i);
  if (!m) return null;
  try {
    const buf = Buffer.from(m[1].replace(/\s/g, ""), "base64");
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Finalisation métier « devis signé » (terrain) : figement officiel si besoin, snapshot, signatures,
 * PDF signé Playwright, enregistrement document, passage en ACCEPTED. Une seule requête API côté client.
 */
export async function finalizeQuoteSigned(quoteId, organizationId, userId, body = {}) {
  assertFinalizeSignedClientReadApproval(body);

  const clientBuf = parsePngDataUrl(body.signature_client_data_url);
  const companyBuf = parsePngDataUrl(body.signature_company_data_url);
  if (!clientBuf || !companyBuf) {
    const err = new Error("Les deux signatures (images PNG en data URL) sont requises.");
    err.statusCode = 400;
    throw err;
  }
  if (clientBuf.length > MAX_SIGNATURE_PNG_BYTES || companyBuf.length > MAX_SIGNATURE_PNG_BYTES) {
    const err = new Error(`Chaque signature doit faire au plus ${MAX_SIGNATURE_PNG_BYTES} octets.`);
    err.statusCode = 400;
    throw err;
  }

  await withTx(pool, async (client) => {
    await assertOrgEntity(client, "quotes", quoteId, organizationId);
    const fullRes = await client.query(
      "SELECT * FROM quotes WHERE id = $1 AND organization_id = $2 FOR UPDATE",
      [quoteId, organizationId]
    );
    const quote = fullRes.rows[0];
    if (!quote) {
      const err = new Error("Devis non trouvé");
      err.statusCode = 404;
      throw err;
    }

    const signedExists = await client.query(
      `SELECT id FROM entity_documents
       WHERE organization_id = $1 AND entity_type = 'quote' AND entity_id = $2
         AND document_type = $3 AND (archived_at IS NULL)
       LIMIT 1`,
      [organizationId, quoteId, QUOTE_DOC_PDF_SIGNED]
    );
    if (signedExists.rows.length > 0) {
      const err = new Error("Ce devis a déjà un PDF signé enregistré — modification non autorisée.");
      err.statusCode = 400;
      throw err;
    }

    const st = String(quote.status || "").toUpperCase();
    if (["ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"].includes(st)) {
      const err = new Error(`Finalisation impossible : le devis est déjà au statut « ${st} ».`);
      err.statusCode = 400;
      throw err;
    }

    if (st === "DRAFT" || st === "READY_TO_SEND") {
      const quoteReady = await ensureQuoteRecipientForOfficialFreeze(client, quoteId, organizationId, quote);
      const { fullNumber } = await allocateNextDocumentNumber(client, organizationId, "QUOTE");
      const { issuer_snapshot, recipient_snapshot } = await buildQuoteIssuerRecipientSnapshots(quoteReady, organizationId);
      await client.query(
        `UPDATE quotes SET
          status = 'SENT',
          sent_at = COALESCE(sent_at, now()),
          quote_number = $1,
          issuer_snapshot = $2::jsonb,
          recipient_snapshot = $3::jsonb,
          updated_at = now()
        WHERE id = $4`,
        [fullNumber, JSON.stringify(issuer_snapshot), JSON.stringify(recipient_snapshot), quoteId]
      );
      await persistQuoteOfficialDocumentSnapshot(client, quoteId, organizationId, {
        frozenBy: userId,
        generatedFrom: "FINALIZE_QUOTE_SIGNED",
      });
    } else if (st === "SENT") {
      const snapRaw = quote.document_snapshot_json;
      const emptySnap =
        snapRaw == null ||
        (typeof snapRaw === "object" && snapRaw !== null && Object.keys(snapRaw).length === 0);
      if (emptySnap) {
        await persistQuoteOfficialDocumentSnapshot(client, quoteId, organizationId, {
          frozenBy: userId,
          generatedFrom: "FINALIZE_QUOTE_SIGNED_REPAIR",
        });
      }
    } else {
      const err = new Error(`Finalisation impossible depuis le statut « ${st} ».`);
      err.statusCode = 400;
      throw err;
    }
  });

  const r = await pool.query(
    `SELECT id, status, quote_number, document_snapshot_json FROM quotes
     WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [quoteId, organizationId]
  );
  if (r.rows.length === 0) {
    const err = new Error("Devis non trouvé");
    err.statusCode = 404;
    throw err;
  }
  const row = r.rows[0];
  const snapRaw = row.document_snapshot_json;
  if (snapRaw == null || (typeof snapRaw === "object" && snapRaw !== null && Object.keys(snapRaw).length === 0)) {
    const err = new Error("Document non figé après finalisation — contactez le support.");
    err.statusCode = 500;
    throw err;
  }

  await removeQuoteSignatureDocuments(organizationId, quoteId);
  await saveQuoteSignaturePng(clientBuf, organizationId, quoteId, userId, QUOTE_DOC_SIGNATURE_CLIENT);
  await saveQuoteSignaturePng(companyBuf, organizationId, quoteId, userId, QUOTE_DOC_SIGNATURE_COMPANY);

  const snapshot = typeof snapRaw === "string" ? JSON.parse(snapRaw) : snapRaw;
  let pdfPayload;
  try {
    pdfPayload = buildQuotePdfPayloadFromSnapshot(snapshot);
  } catch (pe) {
    const err = new Error(pe.message || "Snapshot invalide");
    err.statusCode = 400;
    throw err;
  }

  const renderToken = createFinancialQuoteRenderToken(quoteId, organizationId);
  const rendererUrl = buildFinancialQuoteRendererUrl(quoteId, renderToken, { quoteSigned: true });
  let pdfBuffer;
  try {
    pdfBuffer = await generatePdfFromFinancialQuoteUrl(rendererUrl);
  } catch (e) {
    const err = new Error(e.message || "Échec de la génération du PDF signé");
    err.statusCode = 502;
    throw err;
  }

  const num = row.quote_number || quoteId;
  let docRow = null;
  try {
    await removeQuoteSignedPdfDocuments(organizationId, quoteId);
    docRow = await saveQuoteSignedPdfDocument(pdfBuffer, organizationId, quoteId, userId, {
      fileName: `devis-signe-${num}.pdf`,
      quoteNumber: row.quote_number ?? null,
      metadata: {
        source: "document_snapshot_json_signed",
        snapshot_checksum: pdfPayload.snapshot_checksum,
        business_document_type: "QUOTE_PDF_SIGNED",
      },
    });
  } catch (e) {
    const err = new Error(e.message || "Échec d'enregistrement du PDF signé");
    err.statusCode = 500;
    throw err;
  }

  try {
    await patchQuoteStatus(quoteId, organizationId, "ACCEPTED", userId);
  } catch (e) {
    try {
      await deleteDocument(docRow.id, organizationId);
    } catch (_) {
      /* best effort */
    }
    throw e;
  }

  return {
    document: docRow,
    downloadUrl: `/api/documents/${docRow.id}/download`,
    message: "Devis signé enregistré — PDF signé généré et statut passé à « Accepté ».",
  };
}

/**
 * Snapshot documentaire officiel (lecture seule).
 */
export async function getQuoteDocumentSnapshot(quoteId, organizationId) {
  const r = await pool.query(
    `SELECT document_snapshot_json FROM quotes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [quoteId, organizationId]
  );
  if (r.rows.length === 0) return null;
  const s = r.rows[0].document_snapshot_json;
  if (s == null) return null;
  return typeof s === "string" ? JSON.parse(s) : s;
}

/**
 * CP-QUOTE-004 — Ajouter une ligne devis depuis le catalogue (snapshot)
 * Refuse PERCENT_TOTAL (400). Retourne { item, totals }.
 */
export async function addItemFromCatalog(quoteId, organizationId, body) {
  const catalogItemId = body.catalogItemId;
  if (!catalogItemId) throw new Error("catalogItemId requis");

  const quoteRow = await pool.query(
    "SELECT id, status FROM quotes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
    [quoteId, organizationId]
  ).then((r) => r.rows[0]);
  if (!quoteRow) {
    const err = new Error("Devis non trouvé");
    err.statusCode = 404;
    throw err;
  }
  assertQuoteLinesEditableOrThrow(quoteRow.status);

  const catalog = await getQuoteCatalogItemById({ orgId: organizationId, id: catalogItemId });
  if (!catalog) {
    const err = new Error("Module catalogue non trouvé");
    err.statusCode = 404;
    throw err;
  }
  if ((catalog.pricing_mode || "").toUpperCase() === PRICING_MODE_PERCENT_TOTAL) {
    const err = new Error("Les modules en pourcentage du total ne sont pas supportés pour l'instant");
    err.statusCode = 400;
    throw err;
  }

  const qtyRaw = body.qty !== undefined ? parseInt(String(body.qty), 10) : 1;
  const qty = Number.isNaN(qtyRaw) ? 1 : qtyRaw;
  if (qty < 1) {
    const err = new Error("La quantité doit être au moins 1");
    err.statusCode = 400;
    throw err;
  }
  let unitPriceHtCents = Number(body.unitPriceHtCents);
  if (Number.isNaN(unitPriceHtCents)) unitPriceHtCents = Number(catalog.sale_price_ht_cents) || 0;
  unitPriceHtCents = Math.max(0, Math.floor(unitPriceHtCents));

  let purchaseUnitPriceHtCents = Number(body.purchaseUnitPriceHtCents);
  if (Number.isNaN(purchaseUnitPriceHtCents)) purchaseUnitPriceHtCents = Number(catalog.purchase_price_ht_cents) || 0;
  purchaseUnitPriceHtCents = Math.max(0, Math.floor(purchaseUnitPriceHtCents));

  let vatRateBps = Number(body.vatRateBps);
  if (Number.isNaN(vatRateBps)) vatRateBps = Number(catalog.default_vat_rate_bps) || 2000;
  vatRateBps = Math.max(0, Math.floor(vatRateBps));
  if (vatRateBps > 30000) {
    const err = new Error("Taux de TVA invalide (max 300 %)");
    err.statusCode = 400;
    throw err;
  }

  const pricingMode = (catalog.pricing_mode || "FIXED").toUpperCase();

  let lineHtCents;
  if (pricingMode === "FIXED") {
    lineHtCents = unitPriceHtCents;
  } else {
    lineHtCents = unitPriceHtCents * qty;
  }
  const lineVatCents = Math.round((lineHtCents * vatRateBps) / 10000);
  const lineTtcCents = lineHtCents + lineVatCents;

  const snapshot = buildQuoteItemSnapshotFromCatalogItem(catalog);
  const posRes = await pool.query(
    "SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM quote_lines WHERE quote_id = $1 AND organization_id = $2",
    [quoteId, organizationId]
  );
  const position = Math.max(1, Math.floor(Number(posRes.rows[0]?.next_pos) || 1));

  const ins = await pool.query(
    `INSERT INTO quote_lines (
      organization_id, quote_id, catalog_item_id, snapshot_json, label, description,
      quantity, unit_price_ht, vat_rate, total_line_ht, total_line_vat, total_line_ttc,
      position, purchase_unit_price_ht_cents, vat_rate_bps, pricing_mode, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, true)
    RETURNING *`,
    [
      organizationId,
      quoteId,
      catalogItemId,
      JSON.stringify(snapshot),
      snapshot.name ?? catalog.name,
      snapshot.description ?? catalog.description ?? "",
      qty,
      unitPriceHtCents / 100,
      vatRateBps / 100,
      lineHtCents / 100,
      lineVatCents / 100,
      lineTtcCents / 100,
      position,
      purchaseUnitPriceHtCents,
      vatRateBps,
      pricingMode,
    ]
  );
  const item = ins.rows[0];

  const totals = await recomputeAndPersistQuoteTotals({ quoteId, orgId: organizationId });
  return {
    item: { ...item, unit_price_ht_cents: unitPriceHtCents, vat_rate_bps: vatRateBps },
    totals: {
      total_ht_cents: totals.total_ht_cents,
      total_vat_cents: totals.total_vat_cents,
      total_ttc_cents: totals.total_ttc_cents,
    },
  };
}

/** CP-QUOTE-005 — Champs patchables pour une ligne devis (snapshot immuable). */
const PATCH_QUOTE_LINE_WHITELIST = new Set([
  "qty",
  "unitPriceHtCents",
  "purchaseUnitPriceHtCents",
  "vatRateBps",
]);

/**
 * CP-QUOTE-004/005 — Modifier une ligne devis (qty, prix, TVA). Snapshot et catalog_item_id immuables.
 */
export async function patchQuoteLine(quoteId, itemId, organizationId, body) {
  if (body && typeof body === "object") {
    for (const key of Object.keys(body)) {
      if (!PATCH_QUOTE_LINE_WHITELIST.has(key)) {
        const err = new Error(
          key === "snapshot_json" || key === "catalog_item_id"
            ? "snapshot is immutable"
            : `Champ non modifiable: ${key}`
        );
        err.statusCode = 400;
        throw err;
      }
    }
  }

  const quoteRow = await pool.query(
    "SELECT id, status FROM quotes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
    [quoteId, organizationId]
  ).then((r) => r.rows[0]);
  if (!quoteRow) {
    const err = new Error("Devis non trouvé");
    err.statusCode = 404;
    throw err;
  }
  assertQuoteLinesEditableOrThrow(quoteRow.status);

  const lineRow = await pool.query(
    "SELECT * FROM quote_lines WHERE id = $1 AND quote_id = $2 AND organization_id = $3",
    [itemId, quoteId, organizationId]
  ).then((r) => r.rows[0]);
  if (!lineRow) {
    const err = new Error("Ligne non trouvée");
    err.statusCode = 404;
    throw err;
  }

  let qty = lineRow.quantity != null ? Number(lineRow.quantity) : 1;
  let unitPriceHtCents = lineRow.unit_price_ht_cents != null
    ? Number(lineRow.unit_price_ht_cents)
    : Math.round(Number(lineRow.unit_price_ht ?? 0) * 100);
  let purchaseUnitPriceHtCents = lineRow.purchase_unit_price_ht_cents != null
    ? Number(lineRow.purchase_unit_price_ht_cents)
    : null;
  let vatRateBps = lineRow.vat_rate_bps != null
    ? Number(lineRow.vat_rate_bps)
    : Math.round(Number(lineRow.vat_rate ?? 0) * 100);
  const pricingMode = (lineRow.pricing_mode || "FIXED").toUpperCase();

  if (body.qty !== undefined) {
    const qtyVal = Number(body.qty);
    if (Number.isNaN(qtyVal) || qtyVal < 1) {
      const err = new Error("La quantité doit être au moins 1");
      err.statusCode = 400;
      throw err;
    }
    qty = Math.floor(qtyVal);
  }
  if (body.unitPriceHtCents !== undefined) unitPriceHtCents = Math.max(0, Number(body.unitPriceHtCents));
  if (body.purchaseUnitPriceHtCents !== undefined) purchaseUnitPriceHtCents = Math.max(0, Number(body.purchaseUnitPriceHtCents));
  if (body.vatRateBps !== undefined) {
    const vatVal = Number(body.vatRateBps);
    if (Number.isNaN(vatVal) || vatVal < 0 || vatVal > 30000) {
      const err = new Error("Taux de TVA invalide (0 à 300 % en centièmes de %)");
      err.statusCode = 400;
      throw err;
    }
    vatRateBps = Math.floor(vatVal);
  }

  let lineHtCents;
  if (pricingMode === "FIXED") {
    lineHtCents = unitPriceHtCents;
  } else {
    lineHtCents = unitPriceHtCents * qty;
  }
  const lineVatCents = Math.round((lineHtCents * vatRateBps) / 10000);
  const lineTtcCents = lineHtCents + lineVatCents;

  const upd = await pool.query(
    `UPDATE quote_lines SET
      quantity = $1, unit_price_ht = $2, vat_rate = $3,
      total_line_ht = $4, total_line_vat = $5, total_line_ttc = $6,
      purchase_unit_price_ht_cents = $7, vat_rate_bps = $8,
      updated_at = now()
     WHERE id = $9 AND quote_id = $10 AND organization_id = $11
     RETURNING *`,
    [
      qty,
      unitPriceHtCents / 100,
      vatRateBps / 100,
      lineHtCents / 100,
      lineVatCents / 100,
      lineTtcCents / 100,
      purchaseUnitPriceHtCents,
      vatRateBps,
      itemId,
      quoteId,
      organizationId,
    ]
  );
  const item = upd.rows[0];
  if (!item) {
    const err = new Error("Ligne non trouvée");
    err.statusCode = 404;
    throw err;
  }

  const totals = await recomputeAndPersistQuoteTotals({ quoteId, orgId: organizationId });
  return {
    item: { ...item, unit_price_ht_cents: unitPriceHtCents, vat_rate_bps: vatRateBps },
    totals: {
      total_ht_cents: totals.total_ht_cents,
      total_vat_cents: totals.total_vat_cents,
      total_ttc_cents: totals.total_ttc_cents,
    },
  };
}

/**
 * CP-QUOTE-004 — Désactiver une ligne (soft delete), recalcul totaux
 */
export async function deactivateQuoteLine(quoteId, itemId, organizationId) {
  const quoteRow = await pool.query(
    "SELECT id, status FROM quotes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
    [quoteId, organizationId]
  ).then((r) => r.rows[0]);
  if (!quoteRow) {
    const err = new Error("Devis non trouvé");
    err.statusCode = 404;
    throw err;
  }
  assertQuoteLinesEditableOrThrow(quoteRow.status);

  const upd = await pool.query(
    `UPDATE quote_lines SET is_active = false, updated_at = now()
     WHERE id = $1 AND quote_id = $2 AND organization_id = $3
     RETURNING id`,
    [itemId, quoteId, organizationId]
  );
  if (upd.rows.length === 0) {
    const err = new Error("Ligne non trouvée");
    err.statusCode = 404;
    throw err;
  }

  const totals = await recomputeAndPersistQuoteTotals({ quoteId, orgId: organizationId });
  return {
    totals: {
      total_ht_cents: totals.total_ht_cents,
      total_vat_cents: totals.total_vat_cents,
      total_ttc_cents: totals.total_ttc_cents,
    },
  };
}
