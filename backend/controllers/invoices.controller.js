/**
 * CP-026 — Factures : délégation vers services/invoices.service.js
 */

import { pool } from "../config/db.js";
import * as invoiceService from "../services/invoices.service.js";
import { logAuditEvent } from "../services/audit/auditLog.service.js";
import { AuditActions } from "../services/audit/auditActions.js";
import logger from "../app/core/logger.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

export async function getAll(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(403).json({ error: "Organization non identifiée" });
    const rows = await invoiceService.listInvoices(org, req.query);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function getById(req, res) {
  try {
    const org = orgId(req);
    const data = await invoiceService.getInvoiceDetail(req.params.id, org);
    if (!data) return res.status(404).json({ error: "Facture non trouvée" });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function create(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(403).json({ error: "Organization non identifiée" });
    const data = await invoiceService.createInvoice(org, req.body);
    res.status(201).json(data);
  } catch (e) {
    const msg = e.message || "";
    const code =
      msg.includes("obligatoire") || msg.includes("Invoice cannot have both client and lead") ? 400 : 500;
    res.status(code).json({ error: msg });
  }
}

export async function update(req, res) {
  try {
    const org = orgId(req);
    const data = await invoiceService.updateInvoice(req.params.id, org, req.body);
    if (!data) return res.status(404).json({ error: "Facture non trouvée" });
    res.json(data);
  } catch (e) {
    const status = e.message?.includes("interdite") ? 403 : 400;
    res.status(status).json({ error: e.message });
  }
}

export async function patchStatus(req, res) {
  try {
    const org = orgId(req);
    const { status, cancelled_reason } = req.body;
    if (!status) return res.status(400).json({ error: "status requis" });
    const data = await invoiceService.patchInvoiceStatus(req.params.id, org, status, userId(req), {
      cancelled_reason,
    });
    if (!data) return res.status(404).json({ error: "Facture non trouvée" });
    res.json(data);
  } catch (e) {
    const status = e.message?.includes("interdite") ? 403 : e.message?.includes("requis") ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
}

export async function createFromQuote(req, res) {
  try {
    const org = orgId(req);
    const billingRole = req.body?.billingRole ?? req.body?.billing_role;
    const rawAmt = req.body?.billingAmountTtc ?? req.body?.billing_amount_ttc;
    const rawPreparedTotal = req.body?.preparedTotalTtc ?? req.body?.prepared_total_ttc;
    const rawPreparedHt = req.body?.preparedTotalHt ?? req.body?.prepared_total_ht;
    const rawPreparedVat = req.body?.preparedTotalVat ?? req.body?.prepared_total_vat;
    let billingAmountTtc;
    let preparedTotalTtc;
    let preparedTotalHt;
    let preparedTotalVat;
    if (rawAmt != null && rawAmt !== "") {
      billingAmountTtc = Number(rawAmt);
      if (!Number.isFinite(billingAmountTtc)) {
        return res.status(400).json({ error: "billing_amount_ttc invalide" });
      }
    }
    if (rawPreparedTotal != null && rawPreparedTotal !== "") {
      preparedTotalTtc = Number(rawPreparedTotal);
      if (!Number.isFinite(preparedTotalTtc) || preparedTotalTtc < 0) {
        return res.status(400).json({ error: "prepared_total_ttc invalide" });
      }
    }
    if (rawPreparedHt != null && rawPreparedHt !== "") {
      preparedTotalHt = Number(rawPreparedHt);
      if (!Number.isFinite(preparedTotalHt) || preparedTotalHt < 0) {
        return res.status(400).json({ error: "prepared_total_ht invalide" });
      }
    }
    if (rawPreparedVat != null && rawPreparedVat !== "") {
      preparedTotalVat = Number(rawPreparedVat);
      if (!Number.isFinite(preparedTotalVat) || preparedTotalVat < 0) {
        return res.status(400).json({ error: "prepared_total_vat invalide" });
      }
    }
    const roleUpper = String(billingRole || "STANDARD").trim().toUpperCase();
    if (roleUpper === "DEPOSIT") {
      if (preparedTotalTtc == null || preparedTotalTtc <= 0) {
        return res.status(400).json({
          error: "Préparation obligatoire : prepared_total_ttc doit être strictement positif pour une facture d'acompte.",
        });
      }
      if (preparedTotalHt == null || preparedTotalHt < 0 || !Number.isFinite(preparedTotalHt)) {
        return res.status(400).json({
          error: "Préparation obligatoire : prepared_total_ht requis pour une facture d'acompte.",
        });
      }
      if (preparedTotalVat == null || preparedTotalVat < 0 || !Number.isFinite(preparedTotalVat)) {
        return res.status(400).json({
          error: "Préparation obligatoire : prepared_total_vat requis pour une facture d'acompte.",
        });
      }
    }

    const data = await invoiceService.createInvoiceFromQuote(req.params.quoteId, org, {
      ...(billingRole ? { billingRole } : {}),
      ...(billingAmountTtc !== undefined ? { billingAmountTtc } : {}),
      ...(preparedTotalTtc !== undefined ? { preparedTotalTtc } : {}),
      ...(preparedTotalHt !== undefined ? { preparedTotalHt } : {}),
      ...(preparedTotalVat !== undefined ? { preparedTotalVat } : {}),
    });
    res.status(201).json(data);
  } catch (e) {
    const msg = e.message || "";
    const code =
      msg.includes("accepté") ||
      msg.includes("client") ||
      msg.includes("acompte") ||
      msg.includes("Acompte") ||
      msg.includes("déjà") ||
      msg.includes("Rien") ||
      msg.includes("billingRole") ||
      msg.includes("billing_amount") ||
      msg.includes("lignes") ||
      msg.includes("TTC") ||
      msg.includes("dépasser") ||
      msg.includes("Impossible") ||
      msg.includes("Montant") ||
      msg.includes("non significatif") ||
      msg.includes("total TTC du devis est nul") ||
      msg.includes("Veuillez saisir") ||
      msg.includes("Préparation obligatoire") ||
      msg.includes("base de préparation") ||
      msg.includes("Base de préparation")
        ? 400
        : 500;
    res.status(code).json({ error: e.message });
  }
}

export async function createPreparedStandardFromQuote(req, res) {
  try {
    const org = orgId(req);
    const preparedLinesRaw = req.body?.preparedLines ?? req.body?.prepared_lines;
    const preparedTotalsRaw = req.body?.preparedTotals ?? req.body?.prepared_totals;
    if (!Array.isArray(preparedLinesRaw) || preparedLinesRaw.length < 1) {
      return res.status(400).json({ error: "prepared_lines requis (au moins une ligne)." });
    }
    const preparedLines = preparedLinesRaw.map((line) => ({
      label: line?.label ?? line?.description ?? "",
      description: line?.description ?? line?.label ?? "",
      quantity: Number(line?.quantity) || 0,
      unit_price_ht: Number(line?.unit_price_ht) || 0,
      discount_ht: Number(line?.discount_ht) || 0,
      vat_rate: Number(line?.vat_rate) || 0,
      snapshot_json: line?.snapshot_json && typeof line.snapshot_json === "object" ? line.snapshot_json : {},
    }));
    const preparedTotals =
      preparedTotalsRaw && typeof preparedTotalsRaw === "object"
        ? {
            total_ht: preparedTotalsRaw.total_ht != null ? Number(preparedTotalsRaw.total_ht) : undefined,
            total_vat: preparedTotalsRaw.total_vat != null ? Number(preparedTotalsRaw.total_vat) : undefined,
            total_ttc: preparedTotalsRaw.total_ttc != null ? Number(preparedTotalsRaw.total_ttc) : undefined,
          }
        : undefined;
    const data = await invoiceService.createPreparedStandardInvoiceFromQuote(req.params.quoteId, org, {
      preparedLines,
      preparedTotals,
    });
    res.status(201).json(data);
  } catch (e) {
    const msg = e.message || "";
    const code =
      msg.includes("Préparation") ||
      msg.includes("accepté") ||
      msg.includes("devis") ||
      msg.includes("lignes")
        ? 400
        : 500;
    res.status(code).json({ error: e.message });
  }
}

export async function duplicate(req, res) {
  try {
    const org = orgId(req);
    const data = await invoiceService.duplicateInvoice(req.params.id, org);
    res.status(201).json(data);
  } catch (e) {
    const code = e.statusCode === 404 ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
}

export async function generatePdf(req, res) {
  try {
    const org = orgId(req);
    const data = await invoiceService.generateInvoicePdfRecord(req.params.id, org, userId(req));
    logger.info("INVOICE_PDF_GENERATE_RESULT", {
      invoice_id: data?.observability?.invoice_id ?? req.params.id,
      invoice_number: data?.observability?.invoice_number ?? null,
      main_document_id: data?.observability?.main_document?.id ?? null,
      main_file_name: data?.observability?.main_document?.file_name ?? null,
      main_replaced: data?.observability?.main_document?.replaced ?? false,
      mirror_entity_type: data?.observability?.mirror?.entity_type ?? null,
      mirror_entity_id: data?.observability?.mirror?.entity_id ?? null,
      mirror_document_id: data?.observability?.mirror?.document_id ?? null,
      mirror_file_name: data?.observability?.mirror?.file_name ?? null,
      mirror_replaced: data?.observability?.mirror?.replaced ?? false,
      replaced: data?.replaced === true,
      organization_id: org,
    });
    res.status(201).json(data);
  } catch (e) {
    const code = e.statusCode === 404 ? 404 : e.statusCode === 400 ? 400 : 500;
    res.status(code).json({ error: e.message });
  }
}

export async function getDocumentSnapshot(req, res) {
  try {
    const org = orgId(req);
    const snap = await invoiceService.getInvoiceDocumentSnapshot(req.params.id, org);
    if (snap === null) {
      const row = await pool.query(
        `SELECT id FROM invoices WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
        [req.params.id, org]
      );
      if (row.rows.length === 0) return res.status(404).json({ error: "Facture non trouvée" });
      return res.status(404).json({ error: "Aucun snapshot documentaire figé pour cette facture" });
    }
    res.json({ snapshot: snap });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function recalculateStatus(req, res) {
  try {
    const org = orgId(req);
    const row = await invoiceService.recalculateInvoiceStatusFromAmounts(req.params.id, org);
    if (!row) return res.status(404).json({ error: "Facture non trouvée" });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/** @deprecated Préférer PATCH + service ; conservé pour compat */
export async function remove(req, res) {
  try {
    const org = orgId(req);
    const invoiceId = req.params.id;
    const info = await pool.query(
      `SELECT invoice_number FROM invoices WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
      [invoiceId, org]
    );
    const label = info.rows[0]?.invoice_number ?? null;
    await invoiceService.deleteInvoiceHard(invoiceId, org);
    void logAuditEvent({
      action: AuditActions.INVOICE_DELETED,
      entityType: "invoice",
      entityId: invoiceId,
      organizationId: org,
      userId: userId(req),
      targetLabel: label != null ? String(label) : undefined,
      req,
      statusCode: 204,
      metadata: { hard_delete: true },
    });
    res.status(204).send();
  } catch (e) {
    const code = e.statusCode === 404 ? 404 : e.statusCode === 403 ? 403 : 500;
    res.status(code).json({ error: e.message });
  }
}
