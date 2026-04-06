/**
 * CP-026 — Factures : délégation vers services/invoices.service.js
 */

import { pool } from "../config/db.js";
import * as invoiceService from "../services/invoices.service.js";

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
    const code = e.message?.includes("obligatoire") ? 400 : 500;
    res.status(code).json({ error: e.message });
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
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "status requis" });
    const data = await invoiceService.patchInvoiceStatus(req.params.id, org, status, userId(req));
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
    const data = await invoiceService.createInvoiceFromQuote(req.params.quoteId, org, {
      ...(billingRole ? { billingRole } : {}),
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
      msg.includes("lignes") ||
      msg.includes("TTC") ||
      msg.includes("non significatif") ||
      msg.includes("total TTC du devis est nul")
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
    await invoiceService.deleteInvoiceHard(req.params.id, org);
    res.status(204).send();
  } catch (e) {
    const code = e.statusCode === 404 ? 404 : e.statusCode === 403 ? 403 : 500;
    res.status(code).json({ error: e.message });
  }
}
