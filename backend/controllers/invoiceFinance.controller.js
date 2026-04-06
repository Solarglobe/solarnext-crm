/**
 * Paiements / avoirs / relances rattachés à une facture.
 */

import * as paymentsService from "../services/payments.service.js";
import * as creditNotesService from "../services/creditNotes.service.js";
import * as remindersService from "../services/reminders.service.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

export async function listPayments(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(403).json({ error: "Organization non identifiée" });
    const rows = await paymentsService.listPaymentsForInvoice(org, req.params.invoiceId);
    if (rows === null) return res.status(404).json({ error: "Facture non trouvée" });
    res.json(rows);
  } catch (e) {
    const code = e.statusCode || 500;
    res.status(code).json({ error: e.message });
  }
}

export async function createPayment(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(403).json({ error: "Organization non identifiée" });
    const row = await paymentsService.recordPayment(org, req.params.invoiceId, req.body);
    res.status(201).json(row);
  } catch (e) {
    const code = e.statusCode || (e.message?.includes("trouvée") ? 404 : 400);
    res.status(code).json({ error: e.message });
  }
}

export async function listCreditNotes(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(403).json({ error: "Organization non identifiée" });
    const rows = await creditNotesService.listCreditNotesForInvoice(org, req.params.invoiceId);
    if (rows === null) return res.status(404).json({ error: "Facture non trouvée" });
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function createCreditNote(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(403).json({ error: "Organization non identifiée" });
    const row = await creditNotesService.createDraftCreditNote(org, req.params.invoiceId, req.body);
    res.status(201).json(row);
  } catch (e) {
    const code = e.statusCode || 400;
    res.status(code).json({ error: e.message });
  }
}

export async function listReminders(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(403).json({ error: "Organization non identifiée" });
    const rows = await remindersService.listRemindersForInvoice(org, req.params.invoiceId);
    if (rows === null) return res.status(404).json({ error: "Facture non trouvée" });
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function createReminder(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(403).json({ error: "Organization non identifiée" });
    const row = await remindersService.createReminder(org, req.params.invoiceId, req.body, userId(req));
    res.status(201).json(row);
  } catch (e) {
    const code = e.statusCode || 400;
    res.status(code).json({ error: e.message });
  }
}
